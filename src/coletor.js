// ============================================================================
// COLETOR - captura metricas nas paginas de vendedor (Etapa 3)
//
// Roda em TODA pagina do Mercado Livre, mas so grava quando encontra numeros
// de visitas - na pratica, nas telas de vendedor ("Minhas publicacoes",
// metricas do anuncio).
//
// Este arquivo ORQUESTRA: decide quando varrer (observer), manda gravar
// (service worker, ou a propria aba no plano B), guarda o diagnostico e os
// erros e responde ao popup. A leitura mora no leitura.js e o diagnostico no
// diagnostico.js, carregados antes (ver manifest).
// ============================================================================

(function () {
  "use strict";

  const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;
  const CHAVE_DIAGNOSTICO = MLMetricsGravacao.CHAVES.DIAGNOSTICO;
  const CHAVE_ERRO = MLMetricsGravacao.CHAVES.ERRO;
  const CHAVE_ORIGENS = MLMetricsGravacao.CHAVES.ORIGENS;
  const CHAVE_ULTIMA_BUSCA = MLMetricsGravacao.CHAVES.ULTIMA_BUSCA;
  const CHAVE_TELAS_FALHANDO = MLMetricsGravacao.CHAVES.TELAS_FALHANDO;

  // O que ja aconteceu NESTE carregamento da pagina: null, "marcada"
  // (varredura sem captura numa tela conhecida) ou "entregou". O aviso de
  // tela falhando e gravado no maximo uma vez, e uma varredura vazia DEPOIS
  // de uma captura (a lista se remontando) nao acusa falha.
  let estadoDaTela = null;

  // Busca automatica (atualizarEmSegundoPlano): DESLIGADA. As telas de
  // vendedor sao montadas por JavaScript, e o HTML buscado pelo service
  // worker muito provavelmente chega sem os numeros. Religar so depois que a
  // tela real mostrar que o HTML traz os numeros.
  const BUSCA_AUTOMATICA_LIGADA = false;
  const INTERVALO_BUSCA_MS = 2 * 60 * 60 * 1000;

  // Quanto esperar pelo service worker antes de gravar na aba (plano B). Um
  // SW derrubado pelo navegador nunca responde - sem esta trava a leitura
  // ficaria sem ninguem que a grave.
  const TIMEOUT_PLANO_B_MS = 3000;

  // Travas de repeticao do salvarDiagnostico e do registrarErro.
  let ultimoDiagnostico = { caminho: null, quando: 0 };
  let ultimoErro = { mensagem: null, quando: 0 };

  // --------------------------------------------------------------------------
  // Gravacao no cache
  // --------------------------------------------------------------------------

  /**
   * Grava o que a varredura achou.
   *
   * Quem grava de verdade e o SERVICE WORKER, um so para todas as abas, uma
   * leitura de cada vez (#21). Se ele nao responder, a aba grava sozinha pela
   * mesma regra (gravacao.js) - perder a leitura seria pior que o risco de
   * corrida numa situacao rara.
   *
   * @param {Object} novos o que a varredura leu, por codigo de anuncio
   * @param {boolean} emSegundoPlano true quando veio da busca automatica: o
   *                        aviso verde apareceria sobre uma pagina sem relacao
   */
  function salvar(novos, emSegundoPlano) {
    if (Object.keys(novos).length === 0) return;

    function depoisDeGravar(mudancas) {
      // So quando algo MUDOU: o aviso mexe no DOM, o observer varreria de
      // novo e avisaria de novo.
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

      // Quem chegar primeiro - a resposta do SW ou o tempo limite - decide.
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

          if (chrome.runtime.lastError || !resposta || !resposta.ok) {
            gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
            return;
          }

          depoisDeGravar(resposta.mudancas);
        }
      );
    } catch (e) {
      // Aba orfa (extensao recarregada): a versao nova grava depois do F5.
    }
  }

  // Fila do plano B: duas gravacoes da MESMA aba nao se pisam. Entre abas
  // quem garante a ordem e o service worker.
  let filaDoCache = Promise.resolve();

  /**
   * Plano B: le, mescla e grava o cache daqui mesmo, sem o service worker.
   * Erro de storage (contexto invalidado, quota) termina a tarefa em
   * silencio, e a proxima gravacao tenta de novo.
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
              resolve();
              return;
            }

            const cache = guardado[CHAVE_CACHE] || {};
            const agora = Date.now();
            const resultado = MLMetricsGravacao.mesclar(cache, novos, agora, emSegundoPlano);

            if (resultado.mudancas.length === 0 && resultado.renovados.length === 0) {
              resolve();
              return;
            }

            chrome.storage.local.set({ [CHAVE_CACHE]: cache }, function () {
              if (chrome.runtime.lastError) {
                console.warn(
                  "[ML METRICS] nao consegui gravar o cache: " +
                  chrome.runtime.lastError.message
                );
                resolve();
                return;
              }

              pronto(resultado.mudancas.length);

              // Historico diario depois do cache, na mesma fila - mesma regra
              // do gravarHistorico do background.js.
              gravarHistoricoNestaAba(novos, agora, emSegundoPlano, resolve);
            });
          });
        } catch (e) {
          resolve();
        }
      });
    }).catch(function () {
      // A fila nunca para: erro de uma gravacao deixa a proxima tentar.
    });
  }

  /**
   * Plano B do historico diario: o mesmo que o gravarHistorico do
   * background.js, daqui da aba (ver registrarDia no gravacao.js).
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
          pronto();
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
      pronto();
    }
  }

  /**
   * Aviso discreto no canto da tela, que some em 4 segundos. Quem usa nao e
   * programadora: precisa ver que funcionou sem abrir o console.
   *
   * @param {number} quantidade
   */
  function avisarNaTela(quantidade) {
    // Duas capturas rapidas nao empilham avisos.
    const existente = document.getElementById("mlmetrics-aviso");
    if (existente) existente.remove();

    const aviso = document.createElement("div");
    aviso.id = "mlmetrics-aviso";
    aviso.textContent = quantidade + " anuncio(s) atualizado(s)";

    document.body.appendChild(aviso);

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
   * Tudo dentro de try/catch: uma excecao aqui mataria o callback do
   * observer em silencio. Registrada, vira uma linha no "Copiar diagnostico".
   */
  function coletar() {
    try {
      if (MLMetricsLeitura.ehPaginaDeCompra(window.location.href)) return;

      const achados = MLMetricsLeitura.varrerPagina(document, window.location.href);

      // Nada capturado: registra o que a pagina mostrava e, se esta tela ja
      // entregou numeros antes, avisa que ela parou.
      if (Object.keys(achados).length === 0) {
        salvarDiagnostico();
        marcarTelaFalhando();
        return;
      }

      salvar(achados);
      lembrarOrigem(window.location.href);
      limparTelaFalhando();
    } catch (e) {
      registrarErro("coletar", e);
    }
  }

  /**
   * Marca a tela atual como "ja entregou numeros e agora nao entrega".
   *
   * Quando o ML muda de layout, a captura para e o painel segue mostrando a
   * ultima leitura - numero velho com cara de novo. Aqui isso vira um aviso
   * no popup. So vale para tela que JA funcionou (esta em CHAVE_ORIGENS), e
   * guarda o caminho mascarado.
   */
  function marcarTelaFalhando() {
    if (estadoDaTela !== null) return;
    estadoDaTela = "marcada";

    try {
      chrome.storage.local.get([CHAVE_ORIGENS, CHAVE_TELAS_FALHANDO], function (guardado) {
        if (chrome.runtime.lastError) return;

        try {
          const origens = guardado[CHAVE_ORIGENS] || [];
          if (!MLMetricsLeitura.ehOrigemConhecida(window.location.href, origens)) return;

          const tela = MLMetricsLeitura.caminhoMascarado(window.location.pathname);
          const falhando = guardado[CHAVE_TELAS_FALHANDO] || {};

          // Ja avisado: a hora da PRIMEIRA falha diz ha quanto tempo parou.
          if (falhando[tela]) return;

          falhando[tela] = {
            quando: Date.now(),
            versao: chrome.runtime.getManifest().version
          };

          chrome.storage.local.set({ [CHAVE_TELAS_FALHANDO]: falhando }, function () {
            if (chrome.runtime.lastError) return;
          });
        } catch (e) {
          // contexto invalidado dentro do callback: o aviso nao e essencial
        }
      });
    } catch (e) {
      // contexto invalidado antes do callback
    }
  }

  /**
   * Tira a tela atual da lista de telas falhando: ela voltou a entregar.
   */
  function limparTelaFalhando() {
    if (estadoDaTela === "entregou") return;
    estadoDaTela = "entregou";

    try {
      chrome.storage.local.get([CHAVE_TELAS_FALHANDO], function (guardado) {
        if (chrome.runtime.lastError) return;

        try {
          const falhando = guardado[CHAVE_TELAS_FALHANDO] || {};
          const tela = MLMetricsLeitura.caminhoMascarado(window.location.pathname);

          if (!falhando[tela]) return;

          delete falhando[tela];

          chrome.storage.local.set({ [CHAVE_TELAS_FALHANDO]: falhando }, function () {
            if (chrome.runtime.lastError) return;
          });
        } catch (e) {
          // contexto invalidado dentro do callback
        }
      });
    } catch (e) {
      // contexto invalidado antes do callback
    }
  }

  // --------------------------------------------------------------------------
  // Atualizacao automatica
  // --------------------------------------------------------------------------

  /**
   * Guarda os enderecos onde a captura funcionou (no maximo 3, mais recente
   * primeiro). Nao sabemos de antemao a URL da tela de publicacoes, entao
   * APRENDEMOS com as telas que entregam numeros.
   */
  function lembrarOrigem(url) {
    // Sem a query: filtros, paginacao e eventuais identificadores de sessao.
    const limpa = url.split("?")[0];

    // Tela de UM anuncio (codigo no caminho) nao presta para revisitar e
    // expulsaria a tela de publicacoes das 3 vagas.
    if (limpa.match(MLMetricsLeitura.PADRAO_CODIGO)) return;

    try {
      chrome.storage.local.get([CHAVE_ORIGENS], function (guardado) {
        if (chrome.runtime.lastError) return;

        try {
          const origens = guardado[CHAVE_ORIGENS] || [];

          if (origens[0] === limpa) return;

          const atualizadas = [limpa]
            .concat(origens.filter(function (u) { return u !== limpa; }))
            .slice(0, 3);

          chrome.storage.local.set({ [CHAVE_ORIGENS]: atualizadas }, function () {
            if (chrome.runtime.lastError) return;
          });
        } catch (e) {
          // contexto invalidado dentro do callback
        }
      });
    } catch (e) {
      // contexto invalidado antes do callback
    }
  }

  /**
   * Busca sozinha as telas de vendedor aprendidas e atualiza os numeros
   * (hoje desligada - ver BUSCA_AUTOMATICA_LIGADA).
   *
   * O fetch fica no service worker: la a origem e a da extensao e o CORS nao
   * se aplica. O HTML volta como texto e e varrido aqui. Se a tela for
   * montada por JavaScript, o HTML vem sem numeros e nada e gravado - a
   * captura normal segue cobrindo.
   */
  function atualizarEmSegundoPlano() {
    try {
      chrome.storage.local.get(
        [CHAVE_ORIGENS, CHAVE_ULTIMA_BUSCA],
        function (guardado) {
          if (chrome.runtime.lastError) return;

          const origens = guardado[CHAVE_ORIGENS] || [];
          if (origens.length === 0) return;

          const ultima = guardado[CHAVE_ULTIMA_BUSCA] || 0;

          // Sem trava de frequencia, cada aba do ML dispararia a busca.
          if (Date.now() - ultima < INTERVALO_BUSCA_MS) return;

          // Marcado ANTES de buscar: varias abas abertas juntas passariam
          // todas pela trava antes da primeira terminar.
          try {
            chrome.storage.local.set({ [CHAVE_ULTIMA_BUSCA]: Date.now() }, function () {
              if (chrome.runtime.lastError) return;
            });
          } catch (e) {
            return;
          }

          origens.forEach(function (url) {
            if (!chrome.runtime.sendMessage) return;

            try {
              chrome.runtime.sendMessage({ tipo: "buscar", url: url }, function (resposta) {
                if (chrome.runtime.lastError) return;

                if (!resposta || !resposta.ok) return;

                // DOMParser monta o documento sem exibir nem executar scripts.
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
      // contexto invalidado antes do callback
    }
  }

  // --------------------------------------------------------------------------
  // Diagnostico guardado e erros
  // --------------------------------------------------------------------------

  /**
   * Guarda uma amostra dos textos que PARECEM metrica mas nao viraram dado,
   * para ajustar a leitura sem varias idas e vindas com a cliente.
   *
   * So trechos curtos em volta dos rotulos - nunca o conteudo da pagina nem
   * dados da conta.
   */
  function salvarDiagnostico() {
    // Trava POR TELA: a mesma tela grava no maximo a cada 3 minutos (com DOM
    // inquieto, uma varredura vazia acontece a cada 600ms), mas tela nova
    // grava na hora - a central de vendedor navega sem recarregar.
    const INTERVALO_DIAGNOSTICO_MS = 3 * 60 * 1000;
    const agora = Date.now();
    const caminho = MLMetricsLeitura.caminhoMascarado(window.location.pathname);

    if (caminho === ultimoDiagnostico.caminho &&
        agora - ultimoDiagnostico.quando < INTERVALO_DIAGNOSTICO_MS) {
      return;
    }

    // Marcado antes de varrer: pagina sem palavra-chave tambem precisa da
    // trava, senao seria varrida inteira a cada 600ms.
    ultimoDiagnostico = { caminho: caminho, quando: agora };

    const amostras = MLMetricsDiagnostico.coletarAmostras(document);
    if (amostras.length === 0) return;

    try {
      chrome.storage.local.set({
        [CHAVE_DIAGNOSTICO]: {
          // Host e caminho mascarado: diz a tela sem codigo, id nem titulo. A
          // query nunca entra.
          host: window.location.hostname,
          caminho: caminho,
          quando: agora,
          amostras: amostras,
          // Sem o periodo, numero lido nao diz se e total ou recorte (#47).
          periodo: MLMetricsDiagnostico.coletarTextosDePeriodo(document)
        }
      }, function () {
        if (chrome.runtime.lastError) return;
      });
    } catch (e) {
      // Contexto invalidado: diagnostico nao e essencial.
    }
  }

  /**
   * Guarda o ultimo erro inesperado da leitura, para o diagnostico e para o
   * aviso vermelho do popup. Sem isto a falha e silenciosa: nada aparece e
   * ninguem sabe por que.
   *
   * So a mensagem, o comeco da pilha da propria extensao e o caminho
   * mascarado - nada da pagina.
   *
   * @param {string} onde nome da funcao que quebrou
   * @param {Error} erro
   */
  function registrarErro(onde, erro) {
    const mensagem = String((erro && erro.message) || erro);
    const agora = Date.now();

    // O observer chama coletar a cada 600ms: a mesma mensagem so e regravada
    // depois de um minuto.
    const REPETICAO_MS = 60 * 1000;

    if (mensagem === ultimoErro.mensagem &&
        agora - ultimoErro.quando < REPETICAO_MS) {
      return;
    }
    ultimoErro = { mensagem: mensagem, quando: agora };

    console.error("[ML METRICS] erro em " + onde + ": " + mensagem);

    try {
      chrome.storage.local.set({
        [CHAVE_ERRO]: {
          onde: onde,
          mensagem: mensagem,
          pilha: String((erro && erro.stack) || "").split("\n").slice(0, 3).join(" | "),
          host: window.location.hostname,
          tela: MLMetricsLeitura.caminhoMascarado(window.location.pathname),
          quando: agora,
          // Diz se o erro e desta build ou de uma antiga guardada no storage.
          versao: chrome.runtime.getManifest().version
        }
      }, function () {
        if (chrome.runtime.lastError) return;
      });
    } catch (e) {
      // Contexto invalidado: o erro fica so no console desta aba.
    }
  }

  // --------------------------------------------------------------------------
  // Ciclo de vida
  // --------------------------------------------------------------------------

  // O popup pede o diagnostico DESTA aba ("Copiar diagnostico" e a linha
  // azul do topo). A varredura e sincrona: respondemos na hora.
  try {
    chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
      if (!mensagem || mensagem.tipo !== "diagnosticar") return;

      // So a propria extensao pode pedir.
      if (remetente.id !== chrome.runtime.id) return;

      if (!document.body) {
        responder({ erro: "pagina sem body" });
        return;
      }

      // Se o diagnostico quebrar, o popup ficaria sem resposta e mandaria
      // apertar F5 - a pista errada. Respondemos com o erro.
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

  // Pagina sem body (XML/SVG aberto direto) nao tem o que varrer nem onde
  // amarrar o observer.
  if (document.body) {
    // Pagina que ja veio pronta do servidor: os numeros ja estao la.
    coletar();

    if (BUSCA_AUTOMATICA_LIGADA && window.location.hostname.indexOf("mercadolivre") !== -1) {
      atualizarEmSegundoPlano();
    }

    // Telas de vendedor montam a lista por JavaScript depois do carregamento:
    // em vez de apostar num tempo fixo, reagimos quando o DOM muda.
    let agendado = null;

    /**
     * Diz se uma mutacao do DOM vem da propria extensao (painel ou aviso).
     * Sem este filtro, criar o aviso disparava uma varredura, que nao achava
     * nada de novo - um laco de trabalho inutil.
     *
     * @param {MutationRecord} mutacao
     * @returns {boolean}
     */
    function mutacaoDaExtensao(mutacao) {
      // Mutacao de texto tem um no de TEXTO como alvo: vale o pai dele.
      const alvo = (mutacao.target && mutacao.target.nodeType === 3)
        ? mutacao.target.parentElement
        : mutacao.target;

      if (alvo && alvo.closest && MLMetricsLeitura.ehDaExtensao(alvo)) {
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
      // Extensao recarregada: script orfao, que nunca mais conseguiria
      // gravar. Desliga tudo; a versao nova entra no F5.
      if (!MLMetricsGravacao.extensaoViva()) {
        observador.disconnect();
        clearTimeout(agendado);
        return;
      }

      // Lote SO com mudancas da extensao nao conta. Se misturar com mudanca
      // do site, a do site vale.
      if (mutacoes.every(mutacaoDaExtensao)) return;

      // DEBOUNCE: montar uma lista dispara centenas de mutacoes. Varremos uma
      // vez so, 600ms depois que elas pararem - conferindo de novo se a
      // extensao continua viva.
      clearTimeout(agendado);

      agendado = setTimeout(function () {
        if (MLMetricsGravacao.extensaoViva()) coletar();
      }, 600);
    });

    observador.observe(document.body, {
      childList: true,
      subtree: true,
      // Texto trocado NO LUGAR: filtro de periodo e paginacao reaproveitam
      // as linhas e o React so troca o texto do no.
      characterData: true,
      // Link trocado no lugar: a mesma linha passa a ser de outro anuncio.
      attributes: true,
      attributeFilter: ["href"]
    });
  }
})();
