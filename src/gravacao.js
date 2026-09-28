// ============================================================================
// GRAVACAO - tudo o que toca no chrome.storage da extensao
//
// Tres partes:
//   - os NOMES das chaves do storage (CHAVES), que todo o resto usa daqui;
//   - a REGRA de juntar o que uma tela leu com o que ja estava guardado - a
//     do cache (mesclar) e a do historico diario (registrarDia). Pura, sem
//     storage;
//   - o ACESSO ao storage: ler, gravar, alterar e a gravacao completa de uma
//     varredura, na fila (gravarNaFila).
//
// O arquivo e carregado:
//   - no service worker (importScripts), que faz a gravacao de verdade, uma
//     de cada vez, para duas abas nao apagarem o que a outra gravou (#21);
//   - nas abas (manifest), onde serve de plano B quando o service worker nao
//     responde - pela MESMA funcao, nao por uma copia;
//   - no popup.
// Testado em Node (teste/test-parsing.js), com um chrome falso para o acesso.
// ============================================================================

var MLMetricsGravacao = (function () {
  "use strict";

  // As metricas do cache (as chaves de ROTULOS no leitura.js, que nao e
  // carregado no service worker).
  const METRICAS = ["visitas", "vendas"];

  // De quanto em quanto tempo o "capturadoEm" de um anuncio ESTAVEL e
  // renovado. A cada varredura seria uma gravacao a cada 600ms.
  const INTERVALO_RENOVACAO_MS = 2 * 60 * 1000;

  // Nomes das chaves no chrome.storage.local, definidos so aqui - o unico
  // arquivo carregado em todos os lugares que usam o storage.
  //
  // Os VALORES nao podem mudar: sao o endereco do que ja esta guardado no
  // navegador da cliente. O harness prende os valores.
  //
  // Todos comecam com PREFIXO_CHAVES: o "Limpar dados guardados" do popup
  // apaga pelo prefixo, entao chave nova ja nasce coberta.
  const PREFIXO_CHAVES = "mlmetrics_";

  const CHAVES = Object.freeze({
    CACHE: "mlmetrics_dados",
    DIAGNOSTICO: "mlmetrics_diagnostico",
    ERRO: "mlmetrics_erro",
    ORIGENS: "mlmetrics_origens",
    ULTIMA_BUSCA: "mlmetrics_ultima_busca",
    // "bate" / "nao bate" por anuncio. No storage porque o popup fecha a cada
    // clique fora dele.
    CONFERENCIA: "mlmetrics_conferencia",
    // Telas que ja entregaram numeros e pararam (marcarTelaFalhando).
    TELAS_FALHANDO: "mlmetrics_telas_falhando"
  });

  // Historico diario (registrarDia): uma chave por anuncio,
  // "mlmetrics_historico_MLB123", para gravar so o anuncio que mudou.
  const PREFIXO_HISTORICO = "mlmetrics_historico_";

  // Dias de historico por anuncio: um ano e um mes, para comparar um mes com
  // o mesmo mes do ano anterior. A cota nao limita ("unlimitedStorage").
  const DIAS_DE_HISTORICO = 400;

  /**
   * Diz se os numeros de um anuncio mudaram em relacao ao que ja tinhamos.
   *
   * So as METRICAS contam: "capturadoEm" e o rastro mudam a cada leitura, e
   * compara-los faria o aviso verde disparar sem parar.
   *
   * @param {Object|undefined} antigo
   * @param {Object} novo
   * @returns {boolean}
   */
  function mudou(antigo, novo) {
    if (!antigo) return true;

    return METRICAS.some(function (metrica) {
      // Metrica que esta tela nao mostrou nao conta como mudanca.
      if (novo[metrica] === undefined) return false;
      return antigo[metrica] !== novo[metrica];
    });
  }

  /**
   * Diz se o registro guardado tem numero SEM rastro de origem para alguma
   * metrica que acabou de ser lida de novo (registro de versao antiga).
   * Nesse caso o rastro e gravado na hora, sem esperar a renovacao.
   *
   * @param {Object} guardado registro do cache
   * @param {Object} novo o que esta varredura leu para o mesmo anuncio
   * @returns {boolean}
   */
  function faltaOrigem(guardado, novo) {
    return METRICAS.some(function (metrica) {
      return novo[metrica] !== undefined &&
             !(guardado.origem && guardado.origem[metrica]);
    });
  }

  /**
   * Junta o rastro de origem guardado com o desta leitura, metrica a metrica,
   * carimbando a hora e se a leitura veio da busca automatica. A origem das
   * vendas lidas em outra tela nao pode sumir porque esta tela trouxe visitas.
   *
   * @param {Object|undefined} guardada origem que ja estava no cache
   * @param {Object|undefined} nova origem desta varredura (varrerPagina)
   * @param {number} agora
   * @param {boolean} automatica true quando veio da busca em segundo plano
   * @returns {Object}
   */
  function mesclarOrigem(guardada, nova, agora, automatica) {
    const resultado = Object.assign({}, guardada);

    Object.keys(nova || {}).forEach(function (metrica) {
      resultado[metrica] = Object.assign({}, nova[metrica], {
        em: agora,
        automatica: Boolean(automatica)
      });
    });

    return resultado;
  }

  /**
   * Junta uma varredura ao cache. ALTERA o cache recebido.
   *
   * Mesclar, e nao sobrescrever: cada tela mostra so parte dos anuncios.
   *
   * @param {Object} cache o cache guardado (mlmetrics_dados)
   * @param {Object} novos o que a varredura leu, por codigo de anuncio
   * @param {number} agora
   * @param {boolean} automatica true quando veio da busca em segundo plano
   * @returns {Object} mudancas (codigos com numero novo) e renovados (codigos
   *                   em que so a data e o rastro andaram)
   */
  function mesclar(cache, novos, agora, automatica) {
    // Separar o que MUDOU e obrigatorio: o aviso verde mexe no DOM, o
    // observer varre de novo, e sem esta trava avisaria de novo - em laco.
    const mudancas = Object.keys(novos).filter(function (codigo) {
      return mudou(cache[codigo], novos[codigo]);
    });

    // Numeros iguais, mas RECONFIRMADOS agora. Sem renovar a data, um
    // anuncio estavel passaria a mostrar "dados de N dias atras" logo depois
    // de reconferido.
    const renovados = Object.keys(novos).filter(function (codigo) {
      if (mudancas.indexOf(codigo) !== -1) return false;

      const anterior = cache[codigo];
      if (!anterior) return false;

      if (faltaOrigem(anterior, novos[codigo])) return true;

      return agora - (anterior.capturadoEm || 0) >= INTERVALO_RENOVACAO_MS;
    });

    mudancas.forEach(function (codigo) {
      // A ordem do Object.assign e a regra: o que esta tela mostrou vence o
      // que ja sabiamos, e metrica que ela nao mostrou fica como estava. Vence
      // a leitura NOVA, nao a maior - entre dias diferentes, o numero recente
      // e o correto.
      const anterior = cache[codigo] || {};

      cache[codigo] = Object.assign({}, anterior, novos[codigo], {
        capturadoEm: agora,
        origem: mesclarOrigem(anterior.origem, novos[codigo].origem, agora, automatica)
      });
    });

    renovados.forEach(function (codigo) {
      cache[codigo].capturadoEm = agora;
      cache[codigo].origem = mesclarOrigem(
        cache[codigo].origem, novos[codigo].origem, agora, automatica
      );
    });

    return { mudancas: mudancas, renovados: renovados };
  }

  /**
   * Quantos anuncios do cache tem numero CONFERIVEL - com rastro de origem.
   * Mesmo criterio do painel; e o numero do icone (atualizarDistintivo).
   *
   * @param {Object} cache mlmetrics_dados
   * @returns {number}
   */
  function contarConferiveis(cache) {
    return Object.keys(cache || {}).filter(function (codigo) {
      const registro = cache[codigo] || {};
      const origem = registro.origem || {};

      return METRICAS.some(function (metrica) {
        return registro[metrica] !== undefined && Boolean(origem[metrica]);
      });
    }).length;
  }

  /**
   * Chave do historico de um anuncio no storage.
   *
   * @param {string} codigo ex: "MLB3456789012"
   * @returns {string}
   */
  function chaveDoHistorico(codigo) {
    return PREFIXO_HISTORICO + codigo;
  }

  /**
   * Dia LOCAL de um instante, no formato "AAAA-MM-DD".
   *
   * Local, e nao UTC: em UTC, uma leitura as 22h de Brasilia cairia no dia
   * seguinte. O formato com zeros ordena como texto, o que a poda usa.
   *
   * @param {number} timestamp
   * @returns {string}
   */
  function diaDe(timestamp) {
    const data = new Date(timestamp);
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");

    return data.getFullYear() + "-" + mes + "-" + dia;
  }

  /**
   * Anota no historico de UM anuncio o que a varredura leu hoje. ALTERA o
   * historico recebido.
   *
   * Vendas e faturamento por mes nao aparecem em tela nenhuma do ML: so da
   * para MEDIR, comparando dias. As regras:
   *
   *   - so entra metrica LIDA NESTA varredura e COM rastro - numero que so
   *     esta no cache e de outro dia, e estragaria a conta do mes;
   *   - um registro por dia, no formato do cache (numero + origem);
   *   - numero novo no mesmo dia substitui o anterior; o mesmo numero relido
   *     nao muda nada;
   *   - dia com mais de DIAS_DE_HISTORICO dias sai.
   *
   * @param {Object} historico { "AAAA-MM-DD": registro } de um anuncio
   * @param {Object} novo o que a varredura leu para esse anuncio
   * @param {number} agora
   * @param {boolean} automatica true quando veio da busca em segundo plano
   * @returns {boolean} true quando o historico precisa ser gravado
   */
  function registrarDia(historico, novo, agora, automatica) {
    const hoje = diaDe(agora);
    const origemNova = novo.origem || {};
    let alterou = false;

    METRICAS.forEach(function (metrica) {
      if (novo[metrica] === undefined || !origemNova[metrica]) return;

      const registro = historico[hoje] || {};
      if (registro[metrica] === novo[metrica]) return;

      // So a origem DESTA metrica: a outra, lida mais cedo no mesmo dia,
      // continua com o rastro dela.
      const soEsta = {};
      soEsta[metrica] = origemNova[metrica];

      registro[metrica] = novo[metrica];
      registro.origem = mesclarOrigem(registro.origem, soEsta, agora, automatica);
      historico[hoje] = registro;
      alterou = true;
    });

    // Poda. "AAAA-MM-DD" ordena como data, entao comparar texto basta.
    const corte = diaDe(agora - DIAS_DE_HISTORICO * 24 * 60 * 60 * 1000);

    Object.keys(historico).forEach(function (dia) {
      if (dia < corte) {
        delete historico[dia];
        alterou = true;
      }
    });

    return alterou;
  }

  // --------------------------------------------------------------------------
  // Acesso ao storage
  //
  // Daqui para baixo as funcoes usam chrome.storage.local, sempre do mesmo
  // jeito: toda chamada protegida contra contexto invalidado (extensao
  // recarregada com a aba aberta) e todo callback lendo o lastError. Falha de
  // storage nunca derruba quem chamou - a proxima leitura ou gravacao tenta
  // de novo. No teste em Node, rodam com um chrome falso.
  // --------------------------------------------------------------------------

  /**
   * O erro da ultima chamada ao storage, ou undefined. Ler e obrigatorio:
   * sem isso o navegador reclama de "Unchecked runtime.lastError".
   *
   * @returns {Object|undefined}
   */
  function erroDoStorage() {
    try {
      return chrome.runtime.lastError;
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Le chaves do storage e entrega o que achou. Com erro, nao chama nada.
   *
   * @param {string[]|null} chaves null = o storage inteiro
   * @param {Function} usar recebe { chave: valor }
   * @returns {boolean} false quando nem deu para pedir (contexto invalidado)
   */
  function lerStorage(chaves, usar) {
    try {
      chrome.storage.local.get(chaves, function (guardado) {
        if (erroDoStorage()) return;
        usar(guardado);
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Grava chaves no storage.
   *
   * @param {Object} objeto { chave: valor }
   * @param {Function} [depois] chamada so quando gravou
   * @returns {boolean} false quando nem deu para pedir (contexto invalidado)
   */
  function gravarStorage(objeto, depois) {
    try {
      chrome.storage.local.set(objeto, function () {
        if (erroDoStorage()) return;
        if (depois) depois();
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Le chaves, deixa "alterar" decidir e grava o que ela devolver.
   *
   * @param {string[]} chaves
   * @param {Function} alterar recebe o guardado; devolve { chave: valor } a
   *                           gravar, ou nada para nao gravar
   * @param {Function} [depois] chamada so quando gravou
   */
  function alterarStorage(chaves, alterar, depois) {
    lerStorage(chaves, function (guardado) {
      let novo;

      try {
        novo = alterar(guardado);
      } catch (e) {
        return;  // formato inesperado no storage: nao grava nada
      }

      if (novo) gravarStorage(novo, depois);
    });
  }

  /**
   * Le o cache, mescla a leitura, grava e anota o historico diario - a
   * gravacao completa de uma varredura. Quem chama e o service worker (a
   * gravacao de verdade) e a aba, no plano B.
   *
   * O historico vem DEPOIS do cache, numa gravacao separada. Se ele falhar, o
   * cache ja esta gravado: o historico nunca e o motivo de perder uma leitura.
   *
   * @param {Object} novos o que a varredura leu, por codigo de anuncio
   * @param {boolean} automatica true quando veio da busca em segundo plano
   * @returns {Promise<Object>} { ok, mudancas } ou { ok: false, motivo? } -
   *                            nunca rejeita
   */
  function gravarLeitura(novos, automatica) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([CHAVES.CACHE], function (guardado) {
          if (erroDoStorage()) {
            resolve({ ok: false });
            return;
          }

          const cache = guardado[CHAVES.CACHE] || {};
          const agora = Date.now();
          let resultado;

          try {
            resultado = mesclar(cache, novos, agora, automatica);
          } catch (e) {
            resolve({ ok: false });  // leitura malformada: nao grava nada
            return;
          }

          if (resultado.mudancas.length === 0 && resultado.renovados.length === 0) {
            resolve({ ok: true, mudancas: 0 });
            return;
          }

          chrome.storage.local.set({ [CHAVES.CACHE]: cache }, function () {
            const erro = erroDoStorage();

            // Quota estourada ou contexto invalidado: nao da para gravar.
            if (erro) {
              resolve({ ok: false, motivo: erro.message });
              return;
            }

            const resposta = { ok: true, mudancas: resultado.mudancas.length };
            gravarHistorico(novos, agora, automatica, function () {
              resolve(resposta);
            });
          });
        });
      } catch (e) {
        resolve({ ok: false });  // contexto invalidado
      }
    });
  }

  /**
   * Anota a leitura de cada anuncio no historico diario dele (registrarDia),
   * gravando so as chaves que mudaram.
   *
   * So e chamada quando o cache mudou ou foi renovado. Perto da meia-noite, o
   * dia novo so ganha registro na leitura seguinte - nao compensa uma regra so
   * para isso.
   *
   * @param {Object} novos
   * @param {number} agora
   * @param {boolean} automatica
   * @param {Function} pronto chamada sempre - a fila depende dela para andar
   */
  function gravarHistorico(novos, agora, automatica, pronto) {
    const codigos = Object.keys(novos);
    const chaves = codigos.map(chaveDoHistorico);

    try {
      chrome.storage.local.get(chaves, function (guardado) {
        if (erroDoStorage()) {
          pronto();
          return;
        }

        const alterados = {};

        try {
          codigos.forEach(function (codigo) {
            const chave = chaveDoHistorico(codigo);
            const historico = guardado[chave] || {};

            if (registrarDia(historico, novos[codigo], agora, automatica)) {
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
          const erro = erroDoStorage();
          if (erro) {
            console.warn("[ML METRICS] nao consegui gravar o historico: " + erro.message);
          }
          pronto();
        });
      });
    } catch (e) {
      pronto();  // contexto invalidado
    }
  }

  // Fila de gravacao deste contexto: cada gravacao so comeca quando a
  // anterior terminou, sem que outra entre no meio do ler-mesclar-gravar. No
  // service worker, que e um so, a fila vale para todas as abas (#21); numa
  // aba, so para as gravacoes dela (plano B).
  let filaDeGravacao = Promise.resolve();

  /**
   * Poe uma gravacao (gravarLeitura) na fila deste contexto.
   *
   * @param {Object} novos
   * @param {boolean} automatica
   * @returns {Promise<Object>} a resposta de gravarLeitura - nunca rejeita
   */
  function gravarNaFila(novos, automatica) {
    const tarefa = filaDeGravacao.then(function () {
      return gravarLeitura(novos, automatica);
    });

    // A fila segue mesmo que algo de errado aconteca nesta tarefa.
    filaDeGravacao = tarefa.catch(function () {});

    return tarefa;
  }

  /**
   * Diz se a extensao ainda esta viva para o script desta aba.
   *
   * Extensao recarregada deixa os scripts das abas abertas ORFAOS: sem
   * acesso ao storage ate o F5. O sinal e o chrome.runtime.id sumir. Usada
   * pelo coletor.js e pelo content.js.
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

  return {
    PREFIXO_CHAVES: PREFIXO_CHAVES,
    CHAVES: CHAVES,
    PREFIXO_HISTORICO: PREFIXO_HISTORICO,
    DIAS_DE_HISTORICO: DIAS_DE_HISTORICO,
    mudou: mudou,
    faltaOrigem: faltaOrigem,
    mesclarOrigem: mesclarOrigem,
    mesclar: mesclar,
    contarConferiveis: contarConferiveis,
    chaveDoHistorico: chaveDoHistorico,
    diaDe: diaDe,
    registrarDia: registrarDia,
    lerStorage: lerStorage,
    gravarStorage: gravarStorage,
    alterarStorage: alterarStorage,
    gravarLeitura: gravarLeitura,
    gravarNaFila: gravarNaFila,
    extensaoViva: extensaoViva
  };
})();
