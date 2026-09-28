// ============================================================================
// GRAVACAO - a regra de juntar o que uma tela leu com o que ja estava guardado
//
// Aqui fica so a REGRA, sem chrome.storage - a do cache (mesclar) e a do
// historico diario (registrarDia) - e os NOMES das chaves do storage (CHAVES),
// que todo o resto usa daqui. O arquivo e carregado:
//   - no service worker (importScripts), que faz a gravacao de verdade, uma
//     de cada vez, para duas abas nao apagarem o que a outra gravou (#21);
//   - nas abas (manifest), onde serve de plano B quando o service worker nao
//     responde;
//   - no popup.
// Por nao tocar no storage, e testado em Node (teste/test-parsing.js).
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
    extensaoViva: extensaoViva
  };
})();
