// ============================================================================
// POPUP - painel de controle da extensao
//
// Abre ao clicar no icone da extensao. Serve a tres propositos, todos
// pensados para quem NAO e programador:
//
//   1. mostrar que a extensao esta viva e o que ela ja capturou
//   2. permitir apagar dados errados sem reinstalar nada
//   3. entregar um diagnostico copiavel quando algo nao funcionar
//
// O terceiro e o mais importante na fase de testes: sem ele, "nao apareceu
// nada" e tudo que se consegue saber, e nao da para consertar as cegas.
// ============================================================================

(function () {
  "use strict";

  // Os nomes das chaves do storage vem do gravacao.js (CHAVES), carregado
  // pelo popup.html antes deste arquivo - os mesmos das abas e do service
  // worker, sem copia escrita a mao.
  const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;
  const CHAVE_DIAGNOSTICO = MLMetricsGravacao.CHAVES.DIAGNOSTICO;
  // Telas de vendedor que ja entregaram numeros. Entram no relatorio copiado
  // para o diagnostico remoto dizer QUAIS telas a extensao reconheceu. Vao
  // MASCARADAS (ver enderecoMascarado): a forma da rota basta para achar
  // "Minhas publicacoes", sem levar id de vendedor ou de anuncio junto.
  const CHAVE_ORIGENS = MLMetricsGravacao.CHAVES.ORIGENS;

  // Ultimo erro inesperado da leitura (gravado pelo coletor). Aparece em
  // vermelho no topo e vai no relatorio: erro que ninguem ve e o mesmo que
  // erro nenhum, e aqui ele explica por que nada apareceu na tela.
  const CHAVE_ERRO = MLMetricsGravacao.CHAVES.ERRO;

  // Toda chave da extensao no storage comeca com este prefixo. O botao
  // "Limpar dados guardados" apaga pelo prefixo - ver la o porque.
  const PREFIXO_CHAVES = MLMetricsGravacao.PREFIXO_CHAVES;

  const resumo = document.getElementById("resumo");
  const erro = document.getElementById("erro");
  const lista = document.getElementById("lista");
  const aviso = document.getElementById("aviso");
  const campoDiagnostico = document.getElementById("diagnostico");

  // Versao instalada ao lado do nome. A pessoa confere na hora se a
  // atualizacao pegou, sem precisar abrir edge://extensions.
  try {
    document.getElementById("versao").textContent =
      "v" + chrome.runtime.getManifest().version;
  } catch (e) {
    // contexto invalidado: o titulo fica sem versao
  }

  /**
   * Mostra uma mensagem temporaria no rodape do popup.
   */
  function avisar(texto) {
    aviso.textContent = texto;
    setTimeout(function () { aviso.textContent = ""; }, 2500);
  }

  /**
   * Monta uma linha da lista de anuncios capturados.
   */
  function criarItem(codigo, dados) {
    const item = document.createElement("div");
    item.className = "item";

    const linha = document.createElement("div");
    linha.className = "linha";

    const esquerda = document.createElement("span");
    esquerda.className = "codigo";
    esquerda.textContent = codigo;

    const direita = document.createElement("span");
    direita.className = "numeros";

    linha.appendChild(esquerda);
    linha.appendChild(direita);
    item.appendChild(linha);

    // Montamos so o que existe E tem rastro de origem. Escrever "0 visitas"
    // quando nao sabemos quantas foram seria afirmar algo falso - e mostrar
    // um numero sem dizer de onde ele saiu tambem. Embaixo de cada numero vai
    // o texto exato em que ele foi lido (entre as aspas angulares), a tela e
    // a hora: e isso que a pessoa compara com o que o Mercado Livre mostra.
    const origem = dados.origem || {};
    const partes = [];
    let semOrigem = false;

    ["visitas", "vendas"].forEach(function (metrica) {
      if (dados[metrica] === undefined) return;

      if (!origem[metrica]) {
        semOrigem = true;
        return;
      }

      // No formato do ML ("1.234"), para bater com o que a pessoa ve na tela
      // e com o trecho logo abaixo.
      partes.push(Number(dados[metrica]).toLocaleString("pt-BR") + " " + metrica);

      const rastro = document.createElement("div");
      rastro.className = "origem";
      rastro.textContent = metrica + ": " + origem[metrica].trecho +
        " · " + (origem[metrica].tela || "?") +
        " · " + formatarData(origem[metrica].em) +
        (origem[metrica].automatica ? " (automática)" : "");
      item.appendChild(rastro);
    });

    direita.textContent = partes.join(" · ") ||
      (semOrigem ? "sem origem (versão antiga)" : "sem dados");

    return item;
  }

  /**
   * Data curta para o rastro: "14/09, 14:02".
   *
   * @param {number|undefined} timestamp
   * @returns {string}
   */
  function formatarData(timestamp) {
    if (!timestamp) return "?";

    return new Date(timestamp).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  /**
   * Mostra em vermelho o ultimo erro inesperado da leitura, se houver.
   *
   * A mensagem tecnica fica so no relatorio: quem le isto nao e programadora
   * e nao tem o que fazer com ela. O que precisa aparecer e (a) que algo
   * falhou, (b) que pode ser por isso que faltam numeros e (c) o que fazer
   * em seguida.
   *
   * @param {Object|undefined} registro o que o coletor gravou em mlmetrics_erro
   */
  function mostrarErro(registro) {
    if (!registro || !registro.mensagem) {
      erro.hidden = true;
      return;
    }

    erro.hidden = false;
    erro.textContent =
      "A extensão teve um erro ao ler uma tela em " +
      formatarData(registro.quando) + ". Pode ser por isso que estão " +
      "faltando números. Clique em \"Copiar diagnóstico\" e me mande o texto.";
  }

  /**
   * Le o storage e desenha o estado atual.
   */
  function desenhar() {
    try {
      chrome.storage.local.get([CHAVE_CACHE, CHAVE_DIAGNOSTICO, CHAVE_ERRO], function (guardado) {
        if (chrome.runtime.lastError) return;  // contexto invalidado

        mostrarErro(guardado[CHAVE_ERRO]);

        const cache = guardado[CHAVE_CACHE] || {};
        const codigos = Object.keys(cache);

        lista.textContent = "";

        if (codigos.length === 0) {
          resumo.textContent =
            "Nenhum anúncio capturado ainda. Abra \"Minhas publicações\" " +
            "no Mercado Livre e espere a lista carregar por completo.";
          return;
        }

        // Registro sem nenhum rastro de origem veio de versao antiga: nao pode
        // ser conferido e nao aparece no painel. Contamos a parte para a pessoa
        // saber que "Limpar dados guardados" resolve.
        const semOrigem = codigos.filter(function (codigo) {
          const origem = cache[codigo].origem || {};
          return !origem.visitas && !origem.vendas;
        }).length;

        resumo.textContent = codigos.length + " anúncio(s) com dados guardados." +
          (semOrigem > 0
            ? " " + semOrigem + " sem origem (de versão antiga): use " +
              "\"Limpar dados guardados\"."
            : "");

        codigos.forEach(function (codigo) {
          lista.appendChild(criarItem(codigo, cache[codigo]));
        });
      });
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  }

  /**
   * Endereco de origem sem o que pode identificar alguem: o host e a FORMA da
   * rota, pela mesma regra do diagnostico - o caminhoMascarado do leitura.js,
   * que o popup.html carrega antes deste arquivo. Digitos viram "#" e titulo
   * de produto (slug com muitos hifens) vira "(titulo)". A query nunca entra.
   *
   * Ate o lote 26 o popup tinha uma COPIA dessa regra, porque nao carregava os
   * scripts das abas. Copia de regra de privacidade e o pior tipo de copia:
   * corrigir uma e esquecer a outra deixa dado pessoal escapar por um lado so.
   *
   * As origens entram no relatorio para mostrar quais telas de vendedor a
   * extensao reconheceu, e a forma da rota basta para isso. O caminho cru
   * podia levar id de vendedor ou de anuncio para a conversa - justamente o
   * que o diagnostico deixou de guardar por privacidade.
   *
   * @param {string} url
   * @returns {string}
   */
  function enderecoMascarado(url) {
    try {
      const endereco = new URL(url);
      return endereco.hostname + MLMetricsLeitura.caminhoMascarado(endereco.pathname);
    } catch (e) {
      return "(endereco invalido)";
    }
  }

  /**
   * Resumo do historico diario para o relatorio (ver registrarDia no
   * gravacao.js): quantos anuncios tem historico, quantos dias ao todo e o
   * primeiro e o ultimo dia.
   *
   * So contagens e datas, nunca os numeros de cada dia. Meses de historico
   * nao cabem numa conversa e nao ajudam a diagnosticar nada; o que interessa
   * no relatorio e saber se a gravacao esta acontecendo.
   *
   * @param {Object} tudo o storage inteiro da extensao
   * @returns {Object}
   */
  function resumirHistorico(tudo) {
    const dias = [];
    let anuncios = 0;

    Object.keys(tudo).forEach(function (chave) {
      if (chave.indexOf(MLMetricsGravacao.PREFIXO_HISTORICO) !== 0) return;

      anuncios++;
      Object.keys(tudo[chave] || {}).forEach(function (dia) {
        dias.push(dia);
      });
    });

    dias.sort();

    return {
      anuncios: anuncios,
      registros: dias.length,
      primeiroDia: dias[0] || null,
      ultimoDia: dias[dias.length - 1] || null
    };
  }

  /**
   * Pede a aba ativa o diagnostico da tela aberta nela (o coletor.js responde
   * com diagnosticarTela, do diagnostico.js).
   *
   * O diagnostico guardado no storage e da ultima pagina que falhou, em
   * qualquer aba e ha qualquer tempo - nao necessariamente da tela que a
   * pessoa esta olhando quando clica no botao. Perguntar a aba resolve isso.
   * Nao pede permissao nova: sem "tabs", chrome.tabs.query so esconde a URL
   * das abas, e o id (que e o que usamos) continua disponivel.
   *
   * Quando a aba nao responde, o motivo vai escrito no relatorio. O silencio
   * ja e diagnostico: aba que nao e do Mercado Livre, ou aba aberta antes de
   * a extensao ser recarregada (precisa de F5).
   *
   * @param {Function} pronto recebe o diagnostico ou o motivo - sempre chamada
   */
  function pedirDiagnosticoDaAba(pronto) {
    const SEM_RESPOSTA = {
      erro: "A aba aberta não respondeu. Ou ela não é uma página do Mercado " +
            "Livre, ou foi aberta antes de a extensão ser recarregada — nesse " +
            "caso, aperte F5 nela e clique de novo."
    };

    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (abas) {
        if (chrome.runtime.lastError || !abas || abas.length === 0) {
          pronto(SEM_RESPOSTA);
          return;
        }

        // frameId 0: so o documento principal - o coletor nao roda em iframes.
        chrome.tabs.sendMessage(
          abas[0].id,
          { tipo: "diagnosticar" },
          { frameId: 0 },
          function (resposta) {
            // Ler o lastError e obrigatorio: "ninguem escutando" e o caso
            // comum aqui, e sem a leitura o navegador reclama no console.
            if (chrome.runtime.lastError || !resposta) {
              pronto(SEM_RESPOSTA);
              return;
            }
            pronto(resposta);
          }
        );
      });
    } catch (e) {
      pronto(SEM_RESPOSTA);
    }
  }

  // --------------------------------------------------------------------------
  // Acoes
  // --------------------------------------------------------------------------

  document.getElementById("limpar").addEventListener("click", function () {
    // Apaga TODAS as chaves da extensao - tudo que comeca com PREFIXO_CHAVES -
    // e nada alem delas. Listar as chaves uma a uma ja falhou: o botao
    // apagava cache e diagnostico mas deixava as origens aprendidas e a trava
    // da busca automatica, e origens envenenadas por uma versao antiga
    // sobreviviam a limpeza. Pelo prefixo, chave nova ja nasce coberta.
    try {
      chrome.storage.local.get(null, function (tudo) {
        if (chrome.runtime.lastError) return;  // contexto invalidado

        const nossas = Object.keys(tudo).filter(function (chave) {
          return chave.indexOf(PREFIXO_CHAVES) === 0;
        });

        chrome.storage.local.remove(nossas, function () {
          if (chrome.runtime.lastError) return;
          avisar("Dados apagados.");
          desenhar();
        });
      });
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  });

  document.getElementById("copiar").addEventListener("click", function () {
    // Primeiro a tela aberta AGORA (pedirDiagnosticoDaAba), depois o que
    // esta guardado. As duas partes vao juntas no mesmo relatorio.
    pedirDiagnosticoDaAba(function (telaAtual) {
      montarRelatorio(telaAtual);
    });
  });

  /**
   * Junta a tela atual com o que esta guardado e entrega o relatorio.
   *
   * @param {Object} telaAtual resposta da aba ativa, ou o motivo do silencio
   */
  function montarRelatorio(telaAtual) {
    try {
      // null = o storage inteiro: o historico e uma chave por anuncio, e so
      // lendo tudo da para resumi-lo (ver resumirHistorico).
      chrome.storage.local.get(
        null,
        function (guardado) {
          if (chrome.runtime.lastError) return;  // contexto invalidado

          // JSON.stringify com indentacao 2 gera texto legivel para colar
          // numa conversa, em vez de uma linha unica gigante.
          const relatorio = JSON.stringify({
            versao: chrome.runtime.getManifest().version,
            geradoEm: new Date().toISOString(),
            // A tela que a pessoa esta olhando, lida no clique: o que o
            // coletor enxerga nela e o que capturaria agora.
            telaAtual: telaAtual,
            // Erro inesperado da leitura, se aconteceu. Vem antes do resto
            // porque, quando existe, e a explicacao mais provavel para "nao
            // apareceu nada".
            ultimoErro: guardado[CHAVE_ERRO] || null,
            // As telas de vendedor reconhecidas (ate 3), mascaradas. Sao o
            // caminho mais direto para confirmar que estamos olhando a pagina
            // certa.
            origens: (guardado[CHAVE_ORIGENS] || []).map(enderecoMascarado),
            capturado: guardado[CHAVE_CACHE] || {},
            // Se o historico diario esta sendo gravado - so o resumo.
            historico: resumirHistorico(guardado),
            // O ultimo diagnostico gravado sozinho, de qualquer aba. Pode ser
            // de outra tela - por isso a telaAtual vem antes.
            ultimoDiagnosticoGuardado: guardado[CHAVE_DIAGNOSTICO] || null
          }, null, 2);

          navigator.clipboard.writeText(relatorio).then(function () {
            avisar("Copiado. Cole aqui na conversa.");
          }).catch(function () {
            avisar("Clipboard bloqueado: selecione o texto abaixo e use Ctrl+C.");
          });

          // O texto fica SEMPRE na tela, selecionado. A copia automatica e
          // um atalho; se o navegador nao deixar, a pessoa copia na mao ou
          // le o que esta escrito - sem depender do clipboard para nada.
          campoDiagnostico.hidden = false;
          campoDiagnostico.value = relatorio;
          campoDiagnostico.select();
        }
      );
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  }

  desenhar();
})();
