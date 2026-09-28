// ============================================================================
// POPUP - painel de controle da extensao
//
// Abre ao clicar no icone. Pensado para quem NAO e programador:
//
//   1. mostrar que a extensao esta viva e o que ela ja capturou
//   2. permitir apagar dados errados sem reinstalar nada
//   3. entregar um diagnostico copiavel quando algo nao funcionar
//
// Usa o leitura.js e o gravacao.js, carregados antes pelo popup.html.
// ============================================================================

(function () {
  "use strict";

  const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;
  const CHAVE_DIAGNOSTICO = MLMetricsGravacao.CHAVES.DIAGNOSTICO;
  const CHAVE_ORIGENS = MLMetricsGravacao.CHAVES.ORIGENS;
  const CHAVE_ERRO = MLMetricsGravacao.CHAVES.ERRO;
  const CHAVE_CONFERENCIA = MLMetricsGravacao.CHAVES.CONFERENCIA;
  const CHAVE_TELAS_FALHANDO = MLMetricsGravacao.CHAVES.TELAS_FALHANDO;
  const PREFIXO_CHAVES = MLMetricsGravacao.PREFIXO_CHAVES;

  const resumo = document.getElementById("resumo");
  const erro = document.getElementById("erro");
  const telas = document.getElementById("telas");
  const caixaDaAba = document.getElementById("aba");
  const lista = document.getElementById("lista");
  const aviso = document.getElementById("aviso");
  const campoDiagnostico = document.getElementById("diagnostico");

  // Versao ao lado do nome: a pessoa confere se a atualizacao pegou.
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
   *
   * So entra numero que existe E tem rastro de origem. Embaixo de cada um vai
   * o texto exato em que foi lido, a tela e a hora - e isso que a pessoa
   * compara com o Mercado Livre.
   *
   * @param {string} codigo
   * @param {Object} dados registro do cache
   * @param {string|undefined} marca "bate" ou "nao" - o que ela ja marcou
   */
  function criarItem(codigo, dados, marca) {
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

    const origem = dados.origem || {};
    const partes = [];
    let semOrigem = false;

    ["visitas", "vendas"].forEach(function (metrica) {
      if (dados[metrica] === undefined) return;

      if (!origem[metrica]) {
        semOrigem = true;
        return;
      }

      // No formato do ML ("1.234"), para bater com a tela e com o trecho.
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

    if (partes.length > 0) item.appendChild(criarConferencia(codigo, marca));

    return item;
  }

  /**
   * Os dois botoes de conferencia de um anuncio ("✓ bate" / "✗ não bate").
   *
   * A pessoa marca e o texto sai pronto (textoDaConferencia). Clicar de novo
   * no mesmo botao desmarca: um clique errado nao pode virar resultado.
   *
   * @param {string} codigo
   * @param {string|undefined} marca
   * @returns {Element}
   */
  function criarConferencia(codigo, marca) {
    const caixa = document.createElement("div");
    caixa.className = "conferir";

    [
      { valor: "bate", texto: "✓ bate", classe: "bate-sim" },
      { valor: "nao", texto: "✗ não bate", classe: "bate-nao" }
    ].forEach(function (opcao) {
      const botao = document.createElement("button");

      botao.type = "button";
      botao.textContent = opcao.texto;
      botao.title = "Comparando com o que o Mercado Livre mostra para " + codigo;
      if (marca === opcao.valor) botao.className = opcao.classe;

      botao.addEventListener("click", function () {
        marcarConferencia(codigo, marca === opcao.valor ? null : opcao.valor);
      });

      caixa.appendChild(botao);
    });

    return caixa;
  }

  /**
   * Grava (ou apaga) a marca de conferencia de um anuncio e redesenha.
   *
   * @param {string} codigo
   * @param {string|null} valor "bate", "nao" ou null para desmarcar
   */
  function marcarConferencia(codigo, valor) {
    try {
      chrome.storage.local.get([CHAVE_CONFERENCIA], function (guardado) {
        if (chrome.runtime.lastError) return;

        const conferencia = guardado[CHAVE_CONFERENCIA] || {};

        if (valor === null) delete conferencia[codigo];
        else conferencia[codigo] = { resultado: valor, quando: Date.now() };

        chrome.storage.local.set({ [CHAVE_CONFERENCIA]: conferencia }, function () {
          if (chrome.runtime.lastError) return;
          desenhar();
        });
      });
    } catch (e) {
      // contexto invalidado: o popup inteiro e recarregado pelo navegador
    }
  }

  /**
   * Texto da conferencia, pronto para colar numa conversa. Leva o trecho de
   * onde cada numero foi lido: quando algo nao bate, e o trecho que diz o que
   * a extensao leu errado.
   *
   * @param {Object} cache mlmetrics_dados
   * @param {Object} conferencia mlmetrics_conferencia
   * @returns {string}
   */
  function textoDaConferencia(cache, conferencia) {
    const codigos = Object.keys(conferencia || {});
    const linhas = [
      "CONFERÊNCIA ML Metrics v" + chrome.runtime.getManifest().version +
        " — " + new Date().toLocaleString("pt-BR"),
      "Números da extensão, comparados com a tela do Mercado Livre."
    ];

    if (codigos.length === 0) {
      linhas.push("");
      linhas.push("Nenhum anúncio marcado ainda: no ícone da extensão, use");
      linhas.push("\"✓ bate\" ou \"✗ não bate\" em cada anúncio conferido.");
      return linhas.join("\n");
    }

    linhas.push(codigos.length + " anúncio(s) marcado(s) de " +
      Object.keys(cache || {}).length + " guardado(s).");

    codigos.forEach(function (codigo) {
      const dados = (cache || {})[codigo] || {};
      const origem = dados.origem || {};

      linhas.push("");
      linhas.push((conferencia[codigo].resultado === "bate" ? "BATEU" : "NÃO BATEU") +
        " — " + codigo);

      ["visitas", "vendas"].forEach(function (metrica) {
        if (dados[metrica] === undefined || !origem[metrica]) return;

        linhas.push("  " + metrica + ": " +
          Number(dados[metrica]).toLocaleString("pt-BR") +
          " · lido em " + origem[metrica].trecho +
          " · " + (origem[metrica].tela || "?") +
          " · " + formatarData(origem[metrica].em));
      });
    });

    return linhas.join("\n");
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
   * Mostra em vermelho o ultimo erro inesperado da leitura, se houver. A
   * mensagem tecnica fica so no relatorio; aqui vai o que aconteceu e o que
   * fazer.
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
   * Mostra em laranja as telas que ENTREGAVAM numeros e pararam
   * (marcarTelaFalhando no coletor). Sem isto, uma mudanca de layout do ML
   * deixaria o painel mostrando numero velho com cara de novo.
   *
   * @param {Object|undefined} falhando { "<tela mascarada>": { quando } }
   */
  function mostrarTelasFalhando(falhando) {
    const nomes = Object.keys(falhando || {});

    if (nomes.length === 0) {
      telas.hidden = true;
      return;
    }

    const desde = nomes.map(function (tela) {
      return tela + " (desde " + formatarData(falhando[tela].quando) + ")";
    }).join("; ");

    telas.hidden = false;
    telas.textContent =
      "Uma tela que já trazia números parou de trazer: " + desde + ". " +
      "O Mercado Livre pode ter mudado o layout. Abra essa tela, espere " +
      "carregar e clique em \"Copiar diagnóstico\".";
  }

  /**
   * Le o storage e desenha o estado atual.
   */
  function desenhar() {
    try {
      chrome.storage.local.get(
        [CHAVE_CACHE, CHAVE_DIAGNOSTICO, CHAVE_ERRO, CHAVE_CONFERENCIA, CHAVE_TELAS_FALHANDO],
        function (guardado) {
          if (chrome.runtime.lastError) return;

          mostrarErro(guardado[CHAVE_ERRO]);
          mostrarTelasFalhando(guardado[CHAVE_TELAS_FALHANDO]);

          const conferencia = guardado[CHAVE_CONFERENCIA] || {};
          const cache = guardado[CHAVE_CACHE] || {};
          const codigos = Object.keys(cache);

          lista.textContent = "";

          if (codigos.length === 0) {
            resumo.textContent =
              "Nenhum anúncio capturado ainda. Abra \"Minhas publicações\" " +
              "no Mercado Livre e espere a lista carregar por completo.";
            return;
          }

          // Registro sem rastro nenhum veio de versao antiga e nao aparece no
          // painel: contado a parte, para a pessoa saber que "Limpar" resolve.
          const semOrigem = codigos.filter(function (codigo) {
            const origem = cache[codigo].origem || {};
            return !origem.visitas && !origem.vendas;
          }).length;

          const marcados = Object.keys(conferencia).length;

          resumo.textContent = codigos.length + " anúncio(s) com dados guardados." +
            (marcados > 0 ? " " + marcados + " conferido(s)." : "") +
            (semOrigem > 0
              ? " " + semOrigem + " sem origem (de versão antiga): use " +
                "\"Limpar dados guardados\"."
              : "");

          codigos.forEach(function (codigo) {
            const marca = conferencia[codigo] ? conferencia[codigo].resultado : undefined;
            lista.appendChild(criarItem(codigo, cache[codigo], marca));
          });
        }
      );
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  }

  /**
   * Endereco de origem sem o que pode identificar alguem: o host e a FORMA da
   * rota (caminhoMascarado, do leitura.js). A query nunca entra.
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
   * Resumo do historico diario para o relatorio: quantos anuncios, quantos
   * registros, primeiro e ultimo dia. So contagens - o que interessa ali e
   * saber se a gravacao esta acontecendo.
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
   * Pede a aba ativa o diagnostico da tela aberta nela (o coletor.js
   * responde com diagnosticarTela).
   *
   * Sem permissao "tabs", chrome.tabs.query esconde a URL das abas fora do
   * ML, mas o id continua disponivel. Aba que nao responde e ela mesma um
   * diagnostico: nao e do ML, ou precisa de F5.
   *
   * @param {Function} pronto recebe o diagnostico (ou o motivo) e a aba -
   *                          sempre chamada
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
          pronto(SEM_RESPOSTA, null);
          return;
        }

        const aba = abas[0];

        // frameId 0: so o documento principal - o coletor nao roda em iframes.
        chrome.tabs.sendMessage(
          aba.id,
          { tipo: "diagnosticar" },
          { frameId: 0 },
          function (resposta) {
            // "Ninguem escutando" e o caso comum: ler o lastError evita o
            // aviso no console.
            if (chrome.runtime.lastError || !resposta) {
              pronto(SEM_RESPOSTA, aba);
              return;
            }
            pronto(resposta, aba);
          }
        );
      });
    } catch (e) {
      pronto(SEM_RESPOSTA, null);
    }
  }

  /**
   * Uma frase sobre a aba aberta AGORA, para o topo do popup: "aperte F5",
   * "aqui nao se captura", "estou lendo N anuncios"...
   *
   * A URL da aba so chega quando ela e do ML (host_permissions) - e isso que
   * separa "aba orfa, precisa de F5" de "voce nao esta no Mercado Livre".
   *
   * @param {Object} resposta o diagnostico da aba, ou o objeto com "erro"
   * @param {Object|null} aba a aba ativa (id e, no ML, url)
   * @returns {string} frase, ou "" quando nao ha nada util a dizer
   */
  function situacaoDaAba(resposta, aba) {
    const noMercadoLivre = Boolean(aba && aba.url &&
      aba.url.indexOf("mercadolivre.com.br") !== -1);

    if (resposta && resposta.erro) {
      if (noMercadoLivre) {
        return "Esta aba do Mercado Livre foi aberta antes da última " +
          "atualização da extensão. Aperte F5 nela e abra este menu de novo.";
      }
      return "Abra uma página do Mercado Livre para eu olhar a tela.";
    }

    if (!resposta) return "";

    if (resposta.vitrine) {
      return "Esta é uma página de produto. A extensão não lê números aqui — " +
        "eles vêm da tela \"Minhas publicações\".";
    }

    const quantos = Object.keys(resposta.capturariaAgora || {}).length;

    if (quantos > 0) {
      return "Estou lendo " + quantos + " anúncio(s) nesta tela.";
    }

    if (!resposta.mencionaVisita) {
      return "Esta tela não mostra visitas. Abra \"Minhas publicações\" e " +
        "espere a lista carregar até o fim.";
    }

    return "Passei por esta tela e não achei números. Clique em \"Copiar " +
      "diagnóstico\" e mande o texto para o Pedro.";
  }

  /**
   * Mostra (ou esconde) a frase sobre a aba aberta.
   */
  function mostrarSituacaoDaAba(resposta, abaAtiva) {
    const frase = situacaoDaAba(resposta, abaAtiva);

    caixaDaAba.hidden = frase === "";
    caixaDaAba.textContent = frase;
  }

  // --------------------------------------------------------------------------
  // Acoes
  // --------------------------------------------------------------------------

  document.getElementById("limpar").addEventListener("click", function () {
    // Apaga TODAS as chaves que comecam com PREFIXO_CHAVES, e nada alem delas.
    // Pelo prefixo, chave nova ja nasce coberta - listar uma a uma ja deixou
    // origens envenenadas sobreviverem a limpeza.
    try {
      chrome.storage.local.get(null, function (tudo) {
        if (chrome.runtime.lastError) return;

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

  /**
   * Entrega um texto para a pessoa copiar: clipboard E no campo, selecionado.
   * O clipboard pode estar bloqueado; com o texto na tela, ela copia na mao.
   *
   * @param {string} texto
   */
  function entregarTexto(texto) {
    navigator.clipboard.writeText(texto).then(function () {
      avisar("Copiado. Cole aqui na conversa.");
    }).catch(function () {
      avisar("Clipboard bloqueado: selecione o texto abaixo e use Ctrl+C.");
    });

    campoDiagnostico.hidden = false;
    campoDiagnostico.value = texto;
    campoDiagnostico.select();
  }

  document.getElementById("conferencia").addEventListener("click", function () {
    try {
      chrome.storage.local.get([CHAVE_CACHE, CHAVE_CONFERENCIA], function (guardado) {
        if (chrome.runtime.lastError) return;

        entregarTexto(textoDaConferencia(
          guardado[CHAVE_CACHE] || {},
          guardado[CHAVE_CONFERENCIA] || {}
        ));
      });
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  });

  document.getElementById("copiar").addEventListener("click", function () {
    // Primeiro a tela aberta AGORA, depois o que esta guardado.
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
      // null = o storage inteiro: o historico e uma chave por anuncio.
      chrome.storage.local.get(
        null,
        function (guardado) {
          if (chrome.runtime.lastError) return;

          // Indentacao 2: texto legivel para colar numa conversa.
          const relatorio = JSON.stringify({
            versao: chrome.runtime.getManifest().version,
            geradoEm: new Date().toISOString(),
            telaAtual: telaAtual,
            // Quando existe, e a explicacao mais provavel para "nao apareceu
            // nada" - por isso vem cedo.
            ultimoErro: guardado[CHAVE_ERRO] || null,
            // As telas de vendedor reconhecidas, mascaradas.
            origens: (guardado[CHAVE_ORIGENS] || []).map(enderecoMascarado),
            capturado: guardado[CHAVE_CACHE] || {},
            historico: resumirHistorico(guardado),
            conferencia: guardado[CHAVE_CONFERENCIA] || {},
            telasFalhando: guardado[CHAVE_TELAS_FALHANDO] || {},
            // O ultimo diagnostico gravado sozinho, de qualquer aba - pode ser
            // de outra tela, por isso a telaAtual vem antes.
            ultimoDiagnosticoGuardado: guardado[CHAVE_DIAGNOSTICO] || null
          }, null, 2);

          entregarTexto(relatorio);
        }
      );
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  }

  desenhar();

  // Assim que o popup abre, pergunta a aba ativa o que acontece nela.
  pedirDiagnosticoDaAba(mostrarSituacaoDaAba);
})();
