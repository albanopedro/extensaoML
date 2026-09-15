// ============================================================================
// GRAVACAO - a regra de juntar o que uma tela leu com o que ja estava guardado
//
// Por que um arquivo so para isso?
//
// Antes cada aba gravava o cache por conta propria: lia, mesclava e gravava
// de volta. Com duas abas do Mercado Livre abertas, as duas liam o mesmo
// cache antigo e a segunda gravacao apagava o que a primeira tinha acabado de
// gravar (#21). Agora a gravacao mora no SERVICE WORKER, que e um so para
// todas as abas e grava uma leitura de cada vez.
//
// Aqui fica so a REGRA, sem chrome.storage. O arquivo e carregado:
//   - no service worker (importScripts), que faz a gravacao de verdade;
//   - nas abas (manifest), onde serve de plano B quando o service worker nao
//     responde - melhor gravar com risco de corrida do que perder a leitura.
// Por nao tocar em nada do navegador, e testado em Node (teste/test-parsing.js).
// ============================================================================

var MLMetricsGravacao = (function () {
  "use strict";

  // As metricas que existem no cache. Sao as chaves de ROTULOS no coletor.js,
  // repetidas aqui porque este arquivo tambem roda no service worker, onde o
  // coletor nao existe.
  const METRICAS = ["visitas", "vendas"];

  // De quanto em quanto tempo o "capturadoEm" de um anuncio ESTAVEL e
  // renovado. Reconfirmar a cada varredura gravaria no storage a cada 600ms
  // sem parar; 2 minutos equilibra frescor com nao pesar em I/O.
  const INTERVALO_RENOVACAO_MS = 2 * 60 * 1000;

  /**
   * Diz se os numeros de um anuncio mudaram em relacao ao que ja tinhamos.
   *
   * So as METRICAS contam. "capturadoEm" e o rastro de origem mudam a cada
   * leitura mesmo com o numero igual; compara-los faria tudo parecer sempre
   * diferente, e o aviso verde dispararia sem parar.
   *
   * @param {Object|undefined} antigo
   * @param {Object} novo
   * @returns {boolean}
   */
  function mudou(antigo, novo) {
    // Nunca vimos este anuncio: e novidade por definicao.
    if (!antigo) return true;

    return METRICAS.some(function (metrica) {
      // Metrica que esta tela nao mostrou nao conta como mudanca.
      if (novo[metrica] === undefined) return false;
      return antigo[metrica] !== novo[metrica];
    });
  }

  /**
   * Diz se o registro guardado tem numero SEM rastro de origem para alguma
   * metrica que acabou de ser lida de novo.
   *
   * Acontece com registro gravado por versao antiga da extensao. Numero sem
   * rastro nao aparece no painel, entao a primeira releitura precisa gravar o
   * rastro na hora, sem esperar o intervalo de renovacao.
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
   * carimbando a hora e se a leitura veio da busca automatica.
   *
   * Por metrica, igual aos numeros: a origem das vendas lidas em outra tela
   * nao pode sumir so porque esta tela trouxe as visitas.
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
   * Mesclar em vez de sobrescrever e essencial: cada tela mostra um
   * subconjunto dos anuncios, entao sobrescrever apagaria o que foi capturado
   * nas telas anteriores.
   *
   * @param {Object} cache o cache guardado (mlmetrics_dados)
   * @param {Object} novos o que a varredura leu, por codigo de anuncio
   * @param {number} agora
   * @param {boolean} automatica true quando veio da busca em segundo plano
   * @returns {Object} mudancas (codigos com numero novo) e renovados (codigos
   *                   em que so a data e o rastro andaram)
   */
  function mesclar(cache, novos, agora, automatica) {
    // Anuncios cujos numeros realmente mudaram.
    //
    // Isso e OBRIGATORIO, nao e otimizacao: o MutationObserver do coletor
    // dispara a cada alteracao do DOM, e mostrar o aviso verde altera o DOM.
    // Sem esta trava, avisar provocaria nova varredura, que avisaria de novo -
    // um loop infinito.
    const mudancas = Object.keys(novos).filter(function (codigo) {
      return mudou(cache[codigo], novos[codigo]);
    });

    // Anuncios ja conhecidos, com numeros IGUAIS ao que a tela mostra. Nao
    // mudaram, mas foram RECONFIRMADOS agora. Sem esta renovacao, um anuncio
    // estavel nunca anda a data e o painel passa a gritar "dados de N dias
    // atras" logo depois de ter sido reconferido - fazendo a vendedora
    // concluir que a extensao quebrou.
    const renovados = Object.keys(novos).filter(function (codigo) {
      if (mudancas.indexOf(codigo) !== -1) return false;

      const anterior = cache[codigo];
      if (!anterior) return false;  // sem registro, foi para mudancas

      // Registro de versao antiga, sem rastro de origem: renova na hora.
      // Numero sem rastro nao aparece no painel, entao esperar o intervalo
      // deixaria um numero confirmado agora escondido por ate 2 minutos.
      if (faltaOrigem(anterior, novos[codigo])) return true;

      return agora - (anterior.capturadoEm || 0) >= INTERVALO_RENOVACAO_MS;
    });

    mudancas.forEach(function (codigo) {
      // Object.assign copia da esquerda para a direita, entao o que vem
      // depois vence. A ordem importa e diz a regra de atualizacao:
      //
      //   anterior        -> o que ja sabiamos deste anuncio
      //   novos[codigo]   -> o que esta tela mostrou agora (mais recente)
      //
      // Assim uma tela que so mostra visitas ATUALIZA as visitas sem apagar
      // as vendas capturadas em outra tela. E entre a captura velha e a nova
      // vence a NOVA, nao a maior: dentro de uma mesma pagina o maior valor e
      // o total, mas entre dias diferentes o numero recente e o correto,
      // mesmo que seja menor.
      const anterior = cache[codigo] || {};

      cache[codigo] = Object.assign({}, anterior, novos[codigo], {
        // Data da captura. Permite exibir "dado de 3 dias atras" em vez de
        // mostrar numero velho como se fosse de agora.
        capturadoEm: agora,
        // O rastro e mesclado por metrica (ver mesclarOrigem), e nao
        // substituido inteiro como faria o Object.assign acima.
        origem: mesclarOrigem(anterior.origem, novos[codigo].origem, agora, automatica)
      });
    });

    // Os numeros continuam os mesmos; andam a data e o rastro, que passa a
    // apontar para a leitura mais recente que confirmou cada numero.
    renovados.forEach(function (codigo) {
      cache[codigo].capturadoEm = agora;
      cache[codigo].origem = mesclarOrigem(
        cache[codigo].origem, novos[codigo].origem, agora, automatica
      );
    });

    return { mudancas: mudancas, renovados: renovados };
  }

  return {
    mudou: mudou,
    faltaOrigem: faltaOrigem,
    mesclarOrigem: mesclarOrigem,
    mesclar: mesclar
  };
})();
