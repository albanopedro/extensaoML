// ============================================================================
// COLETOR - captura metricas nas paginas de vendedor (Etapa 3)
//
// Roda em TODA pagina do Mercado Livre, mas so age quando encontra numeros
// de visitas - o que na pratica acontece nas telas de vendedor
// ("Minhas publicacoes", metricas do anuncio, etc).
//
// Este arquivo ORQUESTRA: decide quando varrer (observer), manda gravar
// (service worker, ou a propria aba no plano B), guarda o diagnostico e os
// erros e responde ao popup. A leitura em si mora no leitura.js e a montagem
// do diagnostico no diagnostico.js - os dois carregados antes deste (ver
// manifest).
//
// O que for capturado vai para chrome.storage.local, de onde o content.js
// vai ler depois para montar os badges na pagina do anuncio.
// ============================================================================

(function () {
  "use strict";

  // Os nomes das chaves do storage vem do gravacao.js (CHAVES), carregado
  // antes deste arquivo: escritos a mao aqui e em outros tres arquivos, um
  // erro de digitacao faria a aba gravar num nome e o painel ler de outro.

  // O cache principal: numeros e rastro de cada anuncio.
  const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;

  // Guarda o que a extensao viu quando nao conseguiu capturar nada.
  // Serve para diagnostico remoto - ver salvarDiagnostico().
  const CHAVE_DIAGNOSTICO = MLMetricsGravacao.CHAVES.DIAGNOSTICO;

  // Ultimo erro inesperado da leitura (ver registrarErro). Existe porque
  // excecao no meio da varredura e invisivel para quem usa: a aba continua
  // aberta, nada aparece na tela e o diagnostico nao teria o que dizer.
  const CHAVE_ERRO = MLMetricsGravacao.CHAVES.ERRO;

  // Enderecos de telas de vendedor que ja entregaram numeros, e quando
  // foi a ultima busca automatica neles.
  const CHAVE_ORIGENS = MLMetricsGravacao.CHAVES.ORIGENS;
  const CHAVE_ULTIMA_BUSCA = MLMetricsGravacao.CHAVES.ULTIMA_BUSCA;

  // Busca automatica das telas de vendedor (ver atualizarEmSegundoPlano):
  // DESLIGADA. As telas de vendedor do ML sao montadas por JavaScript, e o
  // HTML buscado pelo service worker muito provavelmente chega sem os
  // numeros - a busca usaria a sessao da vendedora a cada 2 horas sem trazer
  // nada. Religar so depois que a tela real mostrar que o HTML traz os
  // numeros: basta trocar para true.
  const BUSCA_AUTOMATICA_LIGADA = false;

  // De quanto em quanto tempo a busca automatica roda, quando ligada.
  // Duas horas equilibra dado fresco com nao pesar na navegacao dela.
  const INTERVALO_BUSCA_MS = 2 * 60 * 60 * 1000;

  // Quanto esperar pelo service worker antes de gravar na aba (plano B).
  // Se o SW morrer no meio da fila ou simplesmente nao responder, a aba
  // precisa gravar sozinha para nao perder a leitura. Sem esta trava o
  // plano B so dispara com lastError, e uma resposta que nunca chega
  // (SW derrubado pelo navegador) deixa a leitura sem ninguem que a grave.
  const TIMEOUT_PLANO_B_MS = 3000;

  // Ultimo diagnostico gravado: de qual tela e quando (trava do
  // salvarDiagnostico, que e por tela - ver la).
  let ultimoDiagnostico = { caminho: null, quando: 0 };

  // Ultimo erro ja gravado: qual mensagem e quando (trava do registrarErro).
  let ultimoErro = { mensagem: null, quando: 0 };

  // --------------------------------------------------------------------------
  // Gravacao no cache
  // --------------------------------------------------------------------------

  /**
   * Grava o que a varredura achou.
   *
   * A gravacao de verdade e feita pelo SERVICE WORKER (background.js), que e
   * um so para todas as abas e grava uma leitura de cada vez. Antes cada aba
   * lia, mesclava e gravava por conta propria, e duas abas do ML abertas
   * apagavam o que a outra tinha acabado de gravar (#21). A regra da mesclagem
   * mora em gravacao.js e e a mesma nos dois lados.
   *
   * Se o service worker nao responder (acabou de ser atualizado, falhou ao
   * acordar), a aba grava sozinha pela mesma regra - perder a leitura seria
   * pior do que o risco de corrida numa situacao rara.
   *
   * @param {Object} novos o que a varredura leu, por codigo de anuncio
   * @param {boolean} emSegundoPlano true quando veio da busca automatica, nao
   *                        de uma tela que a pessoa esta vendo. Nesse caso o
   *                        aviso verde nao faz sentido: apareceria sobre uma
   *                        pagina sem relacao com os numeros capturados.
   */
  function salvar(novos, emSegundoPlano) {
    if (Object.keys(novos).length === 0) return;

    function depoisDeGravar(mudancas) {
      // So anunciamos quando algo de fato MUDOU. Reconhecer de novo sem
      // novidade nao merece toast a cada 2 minutos - e, sem esta trava, o
      // aviso mexeria no DOM, o observer varreria de novo e avisaria de novo.
      if (mudancas > 0 && !emSegundoPlano) {
        console.log(
          "%c[ML METRICS]%c capturei " + mudancas + " anuncio(s):",
          "background:#3483fa;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#3483fa",
          novos
        );

        avisarNaTela(mudancas);
      }
    }

    try {
      // Sem API de mensagem (pagina de teste fora da extensao): grava aqui.
      if (typeof chrome.runtime.sendMessage !== "function") {
        gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
        return;
      }

      // Sem resposta do SW em TIMEOUT_PLANO_B_MS: o SW pode ter sido
      // derrubado pelo navegador no meio da fila. A aba grava sozinha
      // (plano B) para nao perder a leitura. O timer e cancelado se o SW
      // responder a tempo - um unico timer por chamada, sem acumulo.
      let usado = false;

      const timerPlanoB = setTimeout(function () {
        if (usado) return;
        usado = true;
        gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
      }, TIMEOUT_PLANO_B_MS);

      chrome.runtime.sendMessage(
        { tipo: "salvar", novos: novos, automatica: Boolean(emSegundoPlano) },
        function (resposta) {
          if (usado) return;
          usado = true;
          clearTimeout(timerPlanoB);

          // lastError aqui e o service worker que nao respondeu: plano B.
          if (chrome.runtime.lastError || !resposta || !resposta.ok) {
            gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
            return;
          }

          depoisDeGravar(resposta.mudancas);
        }
      );
    } catch (e) {
      // Contexto invalidado: a extensao foi recarregada e esta aba ficou
      // orfa. Nao ha como gravar daqui - a versao nova grava depois do F5.
    }
  }

  // Fila do plano B (gravarNestaAba): impede que duas gravacoes da MESMA aba
  // se pisem. Entre abas quem garante a ordem e o service worker.
  let filaDoCache = Promise.resolve();

  /**
   * Plano B: le, mescla e grava o cache daqui mesmo, sem o service worker.
   *
   * Todas as operacoes de chrome.storage ficam protegidas contra erro:
   * contexto invalidado e quota estourada terminam a fila em silencio, e a
   * proxima gravacao tenta de novo.
   *
   * @param {Object} novos
   * @param {boolean} emSegundoPlano
   * @param {Function} pronto recebe quantos anuncios mudaram, depois de gravar
   */
  function gravarNestaAba(novos, emSegundoPlano, pronto) {
    filaDoCache = filaDoCache.then(function () {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
            if (chrome.runtime.lastError) {
              resolve();  // contexto invalidado ou acesso negado
              return;
            }

            const cache = guardado[CHAVE_CACHE] || {};
            const agora = Date.now();
            const resultado = MLMetricsGravacao.mesclar(cache, novos, agora, emSegundoPlano);

            if (resultado.mudancas.length === 0 && resultado.renovados.length === 0) {
              resolve();  // nada o que persistir
              return;
            }

            chrome.storage.local.set({ [CHAVE_CACHE]: cache }, function () {
              // Ler o lastError evita o aviso "Unchecked runtime.lastError".
              // Quota estourada nao tem o que fazer aqui: avisamos e seguimos.
              if (chrome.runtime.lastError) {
                console.warn(
                  "[ML METRICS] nao consegui gravar o cache: " +
                  chrome.runtime.lastError.message
                );
                resolve();
                return;
              }

              pronto(resultado.mudancas.length);

              // Historico diario, depois do cache e dentro da mesma fila -
              // mesma regra do service worker (gravarHistorico no
              // background.js).
              gravarHistoricoNestaAba(novos, agora, emSegundoPlano, resolve);
            });
          });
        } catch (e) {
          resolve();  // contexto invalidado
        }
      });
    }).catch(function () {
      // A fila nunca para: erro de uma gravacao deixa a proxima tentar.
    });
  }

  /**
   * Plano B do historico diario: o mesmo que o gravarHistorico do
   * background.js faz, daqui da aba (ver registrarDia no gravacao.js).
   *
   * @param {Object} novos
   * @param {number} agora
   * @param {boolean} emSegundoPlano
   * @param {Function} pronto chamada sempre - a fila da aba depende dela
   */
  function gravarHistoricoNestaAba(novos, agora, emSegundoPlano, pronto) {
    const codigos = Object.keys(novos);
    const chaves = codigos.map(MLMetricsGravacao.chaveDoHistorico);

    try {
      chrome.storage.local.get(chaves, function (guardado) {
        if (chrome.runtime.lastError) {
          pronto();
          return;
        }

        const alterados = {};

        try {
          codigos.forEach(function (codigo) {
            const chave = MLMetricsGravacao.chaveDoHistorico(codigo);
            const historico = guardado[chave] || {};

            if (MLMetricsGravacao.registrarDia(historico, novos[codigo], agora, emSegundoPlano)) {
              alterados[chave] = historico;
            }
          });
        } catch (e) {
          pronto();  // formato inesperado: sem historico desta vez
          return;
        }

        if (Object.keys(alterados).length === 0) {
          pronto();
          return;
        }

        chrome.storage.local.set(alterados, function () {
          if (chrome.runtime.lastError) {
            console.warn("[ML METRICS] nao consegui gravar o historico: " +
              chrome.runtime.lastError.message);
          }
          pronto();
        });
      });
    } catch (e) {
      pronto();  // contexto invalidado
    }
  }

  /**
   * Mostra um aviso discreto no canto da tela.
   *
   * Existe porque quem vai rodar isso e a cliente, nao um programador:
   * ela precisa de um sinal visivel de que funcionou, sem abrir console.
   *
   * @param {number} quantidade
   */
  function avisarNaTela(quantidade) {
    // Remove um aviso anterior que ainda esteja na tela. Sem isto, duas
    // capturas rapidas empilham avisos com o mesmo id no canto da tela.
    const existente = document.getElementById("mlmetrics-aviso");
    if (existente) existente.remove();

    const aviso = document.createElement("div");
    aviso.id = "mlmetrics-aviso";
    aviso.textContent = quantidade + " anuncio(s) atualizado(s)";

    document.body.appendChild(aviso);

    // Some sozinho depois de 4 segundos para nao atrapalhar o uso do site.
    setTimeout(function () {
      aviso.remove();
    }, 4000);
  }

  // --------------------------------------------------------------------------
  // Ponto de entrada
  // --------------------------------------------------------------------------

  /**
   * Varre e guarda, se este for um lugar de onde se deve coletar.
   *
   * O corpo inteiro fica dentro de try/catch porque a leitura roda em cima
   * de uma tela que nao controlamos. Uma excecao aqui (formato novo do ML,
   * DOM em estado inesperado) mataria o callback do observer em silencio: a
   * aba fica aberta, nada aparece, e quem esta do outro lado so consegue
   * dizer "nao apareceu nada". Registrado, o mesmo caso vira uma linha no
   * "Copiar diagnostico" com a mensagem e a funcao que quebrou.
   */
  function coletar() {
    try {
      if (MLMetricsLeitura.ehPaginaDeCompra(window.location.href)) return;

      const achados = MLMetricsLeitura.varrerPagina(document, window.location.href);

      // Nada capturado numa tela onde deveria haver algo. Em vez de apenas
      // desistir em silencio, registramos o que estava escrito na pagina.
      if (Object.keys(achados).length === 0) {
        salvarDiagnostico();
        return;
      }

      salvar(achados);

      // Deu certo aqui: guardamos o endereco para poder voltar sozinhos depois.
      lembrarOrigem(window.location.href);
    } catch (e) {
      registrarErro("coletar", e);
    }
  }

  // --------------------------------------------------------------------------
  // Atualizacao automatica
  // --------------------------------------------------------------------------

  /**
   * Guarda os enderecos onde a captura funcionou.
   *
   * Nao sabemos de antemao qual e a URL da tela de publicacoes - o ML pode
   * mudar, e varia conforme o tipo de conta. Entao em vez de adivinhar,
   * APRENDEMOS: toda vez que uma tela entrega numeros, anotamos o endereco
   * dela. Depois a extensao volta nesses enderecos por conta propria.
   *
   * Guardamos no maximo 3, mais recente primeiro, porque telas diferentes
   * podem entregar metricas diferentes.
   */
  function lembrarOrigem(url) {
    // Sem a query string: ela costuma ter filtros e paginacao que nao
    // queremos congelar, alem de eventuais identificadores de sessao.
    const limpa = url.split("?")[0];

    // Telas de UM anuncio tem o codigo (MLB...) no caminho, e nao prestam
    // para voltar depois: cada uma mostra so as metricas daquele anuncio.
    // Guarda-las acabaria enchendo as 3 vagas e expulsando a tela de
    // publicacoes - a unica que vale revisitar. O filtro e a mesma regra
    // usada para achar anuncios dentro da tela de vendas.
    if (limpa.match(MLMetricsLeitura.PADRAO_CODIGO)) return;

    try {
      chrome.storage.local.get([CHAVE_ORIGENS], function (guardado) {
        if (chrome.runtime.lastError) return;  // contexto invalidado

        try {
          const origens = guardado[CHAVE_ORIGENS] || [];

          // Ja e a mais recente: nada a fazer, evita gravacao a toa.
          if (origens[0] === limpa) return;

          const atualizadas = [limpa]
            .concat(origens.filter(function (u) { return u !== limpa; }))
            .slice(0, 3);

          chrome.storage.local.set({ [CHAVE_ORIGENS]: atualizadas }, function () {
            // Ler o lastError evita o aviso "Unchecked runtime.lastError".
            if (chrome.runtime.lastError) return;
          });
        } catch (e) {
          // contexto invalidado dentro do callback: origens nao sao essenciais
        }
      });
    } catch (e) {
      // contexto invalidado antes mesmo do callback
    }
  }

  /**
   * Busca as telas de vendedor sozinha e atualiza os numeros.
   *
   * E isto que faz os dados envelhecerem menos: em vez de depender de a
   * pessoa passar pela tela de publicacoes, a extensao vai buscar. Basta
   * ela ter QUALQUER pagina do Mercado Livre aberta.
   *
   * O fetch NAO acontece aqui - vai para o service worker (background.js).
   * No Manifest V3, fetch de content script carrega a origem da pagina e
   * esbarra em CORS quando a origem guardada nao e o mesmo subdominio
   * aberto. No service worker a origem e a da extensao, e com
   * host_permissions o CORS nao se aplica. A resposta volta como texto e o
   * parse continua aqui, reusando varrerPagina inteiro.
   *
   * Se a tela for montada por JavaScript no navegador, o HTML que chega
   * vem sem os numeros. Nesse caso varrerPagina nao acha nada, salvar()
   * ignora, e tudo segue funcionando pela captura normal - a atualizacao
   * automatica simplesmente nao acrescenta. Degradar assim, sem quebrar,
   * e proposital: nao sabemos ainda como essas telas sao construidas.
   */
  function atualizarEmSegundoPlano() {
    try {
      chrome.storage.local.get(
        [CHAVE_ORIGENS, CHAVE_ULTIMA_BUSCA],
        function (guardado) {
          if (chrome.runtime.lastError) return;  // contexto invalidado

          const origens = guardado[CHAVE_ORIGENS] || [];

          // Ainda nao aprendemos nenhuma tela de vendedor.
          if (origens.length === 0) return;

          const ultima = guardado[CHAVE_ULTIMA_BUSCA] || 0;

          // Trava de frequencia. Sem ela, cada aba do ML dispararia a busca,
          // e navegar pelo site viraria uma enxurrada de requisicoes.
          if (Date.now() - ultima < INTERVALO_BUSCA_MS) return;

          // Marcamos ANTES de buscar, nao depois: se marcassemos no fim,
          // varias abas abertas ao mesmo tempo passariam todas pela trava
          // antes da primeira terminar.
          try {
            chrome.storage.local.set({ [CHAVE_ULTIMA_BUSCA]: Date.now() }, function () {
              // Ler o lastError evita o aviso "Unchecked runtime.lastError".
              if (chrome.runtime.lastError) return;
            });
          } catch (e) {
            return;  // contexto invalidado: nem tenta buscar
          }

          origens.forEach(function (url) {
            if (!chrome.runtime.sendMessage) {
              // Sem API de mensagem (nunca deveria no MV3): degrada em
              // silencio, a coleta local continua cobrindo.
              return;
            }

            try {
              chrome.runtime.sendMessage({ tipo: "buscar", url: url }, function (resposta) {
                if (chrome.runtime.lastError) return;  // SW dormiu/reiniciou

                if (!resposta || !resposta.ok) return;

                // DOMParser transforma o texto HTML num documento navegavel,
                // sem exibir nada na tela e sem executar os scripts dele.
                const doc = new DOMParser().parseFromString(resposta.html, "text/html");
                if (!doc.body) return;

                salvar(MLMetricsLeitura.varrerPagina(doc, url), true);
              });
            } catch (e) {
              // contexto invalidado ao enviar a mensagem
            }
          });
        }
      );
    } catch (e) {
      // contexto invalidado antes mesmo do callback
    }
  }

  // --------------------------------------------------------------------------
  // Diagnostico guardado e erros
  // --------------------------------------------------------------------------

  /**
   * Guarda uma amostra dos textos que PARECEM metrica mas nao viraram dado.
   *
   * Este e o plano de contingencia da extensao. A heuristica foi escrita sem
   * nunca termos visto as telas de vendedor de verdade, entao ela pode nao
   * reconhecer o formato que o ML usa. Quando isso acontece, quem esta do
   * outro lado so consegue dizer "nao apareceu nada" - e nao da para
   * consertar as cegas.
   *
   * Guardando os trechos de texto que contem as palavras-chave, mais uma
   * JANELA de texto em volta do rotulo (onde o numero costuma estar), fica
   * possivel ver como a tela e montada e ajustar de uma vez, sem varias
   * idas e vindas.
   *
   * Guardamos apenas trechos curtos que mencionam metricas - nao o conteudo
   * da pagina nem dados da conta de quem usa. A janela e estreita de
   * proposito: pegar o pai INTERO (o antigo slice(0,160)) capturava titulo do
   * anuncio, preco, nome de comprador e numero de pedido que por acaso
   * dividissem o mesmo elemento do rotulo - e essa amostra iria para o
   * clipboard no popup.
   */
  function salvarDiagnostico() {
    // Trava de frequencia POR TELA. Numa pagina do ML com DOM inquieto
    // (carrossel, lazy load), uma varredura sem captura acontece a cada 600ms;
    // sem trava, o diagnostico seria regravado a cada uma delas.
    //
    // Mas a trava nao pode ser so de tempo: a central de vendedor navega sem
    // recarregar a pagina (SPA), e uma trava de 3 minutos iniciada na tela
    // anterior impedia justamente a tela que interessa de gravar. Tela nova
    // grava na hora; a mesma tela, so depois do intervalo.
    const INTERVALO_DIAGNOSTICO_MS = 3 * 60 * 1000;
    const agora = Date.now();
    const caminho = MLMetricsLeitura.caminhoMascarado(window.location.pathname);

    if (caminho === ultimoDiagnostico.caminho &&
        agora - ultimoDiagnostico.quando < INTERVALO_DIAGNOSTICO_MS) {
      return;
    }

    // Marcamos antes de varrer, e nao so quando ha amostra: pagina sem
    // nenhuma palavra-chave tambem precisa da trava, senao seria varrida
    // inteira a cada 600ms so para descobrir que nao tem nada.
    ultimoDiagnostico = { caminho: caminho, quando: agora };

    const amostras = MLMetricsDiagnostico.coletarAmostras(document);
    if (amostras.length === 0) return;

    try {
      chrome.storage.local.set({
        [CHAVE_DIAGNOSTICO]: {
          // Host e a FORMA do caminho (ver caminhoMascarado). A query nunca
          // entra - pode carregar identificador de sessao - e o caminho cru
          // pode carregar codigo de produto, id de vendedor e titulo. Mascarado,
          // ele diz de QUAL TELA veio o diagnostico (so o host valia para o
          // site inteiro) sem levar nada disso para o clipboard.
          host: window.location.hostname,
          caminho: caminho,
          quando: agora,
          amostras: amostras,
          // O periodo vai junto: sem ele, numero lido nao diz se e total ou
          // recorte (#47, ver coletarTextosDePeriodo).
          periodo: MLMetricsDiagnostico.coletarTextosDePeriodo(document)
        }
      }, function () {
        // Ler o lastError evita o aviso "Unchecked runtime.lastError".
        if (chrome.runtime.lastError) return;
      });
    } catch (e) {
      // Contexto invalidado: diagnostico nao e essencial, proximo ciclo tenta.
    }
  }

  /**
   * Guarda o ultimo erro inesperado da leitura, para o diagnostico.
   *
   * Sem isto, excecao no meio da varredura e a pior falha possivel neste
   * projeto: silenciosa. O callback do observer morre, a aba segue aberta,
   * o painel nao aparece e o diagnostico mostra uma tela "normal" - quem
   * esta do outro lado so consegue dizer "nao apareceu nada", e nao da para
   * consertar as cegas. Gravado, o mesmo caso chega pelo "Copiar
   * diagnostico" com a mensagem, a funcao que quebrou e a tela.
   *
   * Nao guarda nada da pagina: so a mensagem do erro, a pilha da propria
   * extensao e o caminho mascarado.
   *
   * @param {string} onde nome da funcao que quebrou
   * @param {Error} erro
   */
  function registrarErro(onde, erro) {
    const mensagem = String((erro && erro.message) || erro);
    const agora = Date.now();

    // Trava de repeticao: o observer chama coletar a cada 600ms, e um erro
    // que se repete gravaria no storage o tempo todo. Mensagem nova grava na
    // hora; a mesma mensagem, so depois de um minuto.
    const REPETICAO_MS = 60 * 1000;

    if (mensagem === ultimoErro.mensagem &&
        agora - ultimoErro.quando < REPETICAO_MS) {
      return;
    }
    ultimoErro = { mensagem: mensagem, quando: agora };

    // No console para quem abrir o F12, e no storage para o "Copiar
    // diagnostico" - que e como a cliente conta o que aconteceu.
    console.error("[ML METRICS] erro em " + onde + ": " + mensagem);

    try {
      chrome.storage.local.set({
        [CHAVE_ERRO]: {
          onde: onde,
          mensagem: mensagem,
          // Duas primeiras linhas da pilha: dizem a funcao e a linha do
          // arquivo. A pilha inteira encheria o relatorio.
          pilha: String((erro && erro.stack) || "").split("\n").slice(0, 3).join(" | "),
          host: window.location.hostname,
          // Mascarado, como no resto do diagnostico: a FORMA da rota, sem
          // codigo de anuncio nem titulo de produto.
          tela: MLMetricsLeitura.caminhoMascarado(window.location.pathname),
          quando: agora,
          // A versao diz se o erro e desta build ou de uma antiga que ficou
          // guardada no storage.
          versao: chrome.runtime.getManifest().version
        }
      }, function () {
        // Ler o lastError evita o aviso "Unchecked runtime.lastError"; se a
        // gravacao falhar, nao ha plano melhor do que o console.
        if (chrome.runtime.lastError) return;
      });
    } catch (e) {
      // Contexto invalidado: o erro fica so no console desta aba.
    }
  }

  // --------------------------------------------------------------------------
  // Ciclo de vida
  // --------------------------------------------------------------------------

  /**
   * Diz se a extensao ainda esta viva para este script.
   *
   * Quando a extensao e recarregada ou atualizada em chrome://extensions, os
   * scripts que ja estavam nas abas abertas NAO sao trocados pela versao
   * nova: ficam orfaos, sem acesso ao chrome.storage, e o navegador so
   * injeta a versao nova quando a pagina e recarregada (F5). O sinal de
   * orfandade e o chrome.runtime.id sumir.
   *
   * @returns {boolean}
   */
  function extensaoViva() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // O popup pede o diagnostico DESTA aba quando a pessoa clica em "Copiar
  // diagnostico" (ver diagnosticarTela, em diagnostico.js). A varredura e
  // sincrona, entao respondemos na hora, sem abrir canal assincrono.
  try {
    chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
      if (!mensagem || mensagem.tipo !== "diagnosticar") return;

      // So a propria extensao pode pedir: outra origem nao dispara varredura.
      if (remetente.id !== chrome.runtime.id) return;

      if (!document.body) {
        responder({ erro: "pagina sem body" });
        return;
      }

      // O diagnostico varre a tela com o mesmo codigo da captura. Se ele
      // quebrar, o popup ficaria sem resposta e mandaria apertar F5 - a
      // pista errada. Respondemos com o erro, que e justamente o que
      // interessa saber nessa hora.
      try {
        responder(MLMetricsDiagnostico.diagnosticarTela(document, window.location));
      } catch (e) {
        registrarErro("diagnosticarTela", e);
        responder({
          erro: "a extensao quebrou ao ler esta tela: " +
            String((e && e.message) || e)
        });
      }
    });
  } catch (e) {
    // Contexto invalidado: o popup relata que a aba nao respondeu.
  }

  // Varre uma vez de imediato e liga o observador SO se houver body.
  // Em pagina sem body (XML/SVG aberto direto), nao ha o que varrer e o
  // observer nao pode ser amarrado a um alvo nulo; com a "file:///*" fora
  // do manifest isso quase nao acontece mais, mas e absurdamente barato
  // garantir que nenhuma excecao escape quando acontecer.
  if (document.body) {
    // Varre uma vez: se a pagina ja veio pronta do servidor, os numeros
    // estao la e nao ha o que esperar.
    coletar();

    // Busca automatica: so quando ligada (ver BUSCA_AUTOMATICA_LIGADA) e so no
    // site do ML, nunca nos arquivos de teste locais.
    if (BUSCA_AUTOMATICA_LIGADA && window.location.hostname.indexOf("mercadolivre") !== -1) {
      atualizarEmSegundoPlano();
    }

    // Mas telas de vendedor costumam montar a lista por JavaScript, depois
    // do carregamento. Em vez de apostar num tempo fixo ("espera 1,5s e
    // torce"), observamos o DOM e reagimos quando o conteudo chega - funcione
    // a conexao rapida ou lenta.
    let agendado = null;

    /**
     * Diz se uma mutacao do DOM vem da propria extensao.
     *
     * O painel e o aviso sao adicionados e removidos pelo content.js/coletor.
     * Sem esta filtragem, criar o aviso disparava uma mutacao, que reagendava
     * a varredura, que nao achava nada de novo, e por ai em diante - um laco
     * de trabalho inutil que encarecia a navegacao. A varredura ja ignora o
     * texto do painel; aqui paramos o estopim antes dele acontecer.
     *
     * @param {MutationRecord} mutacao
     * @returns {boolean}
     */
    function mutacaoDaExtensao(mutacao) {
      // Mutacao de texto (characterData) tem um no de TEXTO como alvo, que nao
      // tem closest - o elemento que interessa e o pai dele.
      const alvo = (mutacao.target && mutacao.target.nodeType === 3)
        ? mutacao.target.parentElement
        : mutacao.target;

      if (alvo && alvo.closest &&
          alvo.closest("#mlmetrics-painel, #mlmetrics-aviso")) {
        return true;
      }

      // Remocao nao tem mais o alvo no DOM, entao checamos os nos removidos.
      const lista = [];
      if (mutacao.addedNodes) lista.push.apply(lista, Array.from(mutacao.addedNodes));
      if (mutacao.removedNodes) lista.push.apply(lista, Array.from(mutacao.removedNodes));

      return lista.some(function (n) {
        return n.nodeType === 1 &&
               (n.id === "mlmetrics-painel" || n.id === "mlmetrics-aviso");
      });
    }

    const observador = new MutationObserver(function (mutacoes) {
      // Extensao recarregada: este script ficou orfao (ver extensaoViva).
      // Continuar varrendo a cada mutacao so gastaria a CPU da aba sem nunca
      // conseguir gravar. Desligamos tudo; a versao nova entra no F5.
      if (!extensaoViva()) {
        observador.disconnect();
        clearTimeout(agendado);
        return;
      }

      // Lote SO com mudancas da propria extensao: nao e conteudo do ML, nao
      // vale re-varrer. Se o lote mistura mudanca nossa com mudanca do site,
      // a do site conta - antes, uma unica mutacao nossa descartava o lote
      // inteiro, e a tela nova do ML ficava sem varredura.
      if (mutacoes.every(mutacaoDaExtensao)) return;

      // DEBOUNCE: montar uma lista dispara centenas de mutacoes seguidas.
      // Varrer a cada uma travaria a pagina. Entao cada mutacao CANCELA a
      // varredura agendada e marca outra - o efeito e varrer uma unica vez,
      // 600ms depois que as mudancas pararem.
      clearTimeout(agendado);

      // A conferencia se repete no disparo: a extensao pode ter sido
      // recarregada durante os 600ms de espera.
      agendado = setTimeout(function () {
        if (extensaoViva()) coletar();
      }, 600);
    });

    observador.observe(document.body, {
      childList: true,      // elementos adicionados ou removidos
      subtree: true,        // em qualquer profundidade, nao so nos filhos diretos

      // Texto trocado NO LUGAR. Quando so o numero muda (filtro de periodo,
      // pagina 2 reaproveitando as linhas), o React altera o texto do no que
      // ja existe - sem isto, a varredura nem era disparada. O debounce acima
      // absorve o volume extra de eventos.
      characterData: true,

      // Link trocado no lugar: a mesma linha passa a ser de outro anuncio.
      attributes: true,
      attributeFilter: ["href"]
    });
  }
})();
