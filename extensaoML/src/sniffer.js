// ============================================================================
// SNIFFER - ferramenta temporaria de investigacao (Etapa 2)
//
// Este arquivo NAO faz parte do produto final. Ele existe so para descobrir
// quais endpoints o site do Mercado Livre chama e quais deles carregam os
// numeros que queremos (visitas, vendas, conversao).
//
// Roda com "world": "MAIN" no manifest, ou seja, no MESMO contexto de
// JavaScript da pagina. Um content script comum roda num "mundo isolado":
// enxerga o DOM, mas tem uma copia propria do objeto window. Se sobrescrever
// window.fetch la, sobrescreve so a copia - a pagina continua usando o fetch
// original dela e nao interceptamos nada.
// ============================================================================

(function () {
  "use strict";

  // Se alguma destas palavras aparecer na URL ou no corpo da resposta,
  // consideramos a requisicao suspeita e destacamos no console.
  const TERMOS = [
    "visit",      // visits, visitas
    "visita",
    "conversion", // conversion_rate
    "conversao",
    "sold_quantity",
    "metric",     // metrics, metricas
    "performance",
    "health"      // o ML usa "health" para qualidade do anuncio
  ];

  // Guarda TODAS as URLs vistas, mesmo as que nao deram match.
  // Fica acessivel no console digitando: __mlmetricsUrls
  // Serve de rede de seguranca caso os termos acima nao peguem nada.
  window.__mlmetricsUrls = [];

  /**
   * Verifica se um texto contem algum dos termos suspeitos.
   * Comparamos tudo em minusculo para nao depender de maiusculas/minusculas.
   */
  function ehSuspeito(texto) {
    if (!texto) return false;
    const alvo = texto.toLowerCase();
    return TERMOS.some(function (termo) {
      return alvo.indexOf(termo) !== -1;
    });
  }

  /**
   * Imprime a requisicao no console de forma destacada e agrupada.
   * groupCollapsed = aparece fechado, voce clica para expandir.
   */
  function reportar(origem, url, corpo) {
    console.groupCollapsed(
      "%c[ML METRICS]%c " + origem + " -> " + url,
      "background:#3483fa;color:#fff;padding:2px 6px;border-radius:3px",
      "color:#3483fa;font-weight:bold"
    );
    console.log("URL completa:", url);
    // Cortamos em 3000 caracteres: respostas do ML podem ter centenas de KB
    // e travariam o console.
    console.log("Resposta (primeiros 3000 chars):", corpo.slice(0, 3000));
    console.groupEnd();
  }

  /**
   * Decide se vale a pena tentar ler o corpo da resposta.
   * Nao faz sentido ler imagens, fontes ou CSS - so JSON e texto.
   */
  function ehTextoLegivel(contentType) {
    if (!contentType) return false;
    return contentType.indexOf("json") !== -1 || contentType.indexOf("text") !== -1;
  }

  // --------------------------------------------------------------------------
  // 1) Interceptando fetch()
  // --------------------------------------------------------------------------

  const fetchOriginal = window.fetch;

  window.fetch = function () {
    // "arguments" sao os parametros originais da chamada. Passamos adiante
    // sem alterar nada - nosso objetivo e so observar, nunca interferir.
    const args = arguments;

    // O primeiro argumento pode ser uma string ou um objeto Request.
    const primeiro = args[0];
    const url = (typeof primeiro === "string") ? primeiro : (primeiro && primeiro.url) || "";

    return fetchOriginal.apply(this, args).then(function (resposta) {
      window.__mlmetricsUrls.push(url);

      const contentType = resposta.headers.get("content-type") || "";

      if (ehTextoLegivel(contentType)) {
        // IMPORTANTE: resposta.clone()
        // O corpo de uma Response so pode ser lido UMA vez. Se lessemos a
        // resposta original, a pagina receberia um corpo ja consumido e
        // quebraria. O clone nos da uma copia independente para inspecionar.
        resposta.clone().text().then(function (corpo) {
          if (ehSuspeito(url) || ehSuspeito(corpo)) {
            reportar("fetch", url, corpo);
          }
        }).catch(function () {
          // Se falhar a leitura do clone, ignoramos em silencio.
          // Nunca deixamos o sniffer quebrar a navegacao do usuario.
        });
      }

      // Devolvemos a resposta ORIGINAL, intacta, para a pagina.
      return resposta;
    });
  };

  // --------------------------------------------------------------------------
  // 2) Interceptando XMLHttpRequest (o "fetch antigo")
  //    Partes mais velhas do site do ML ainda podem usar XHR.
  // --------------------------------------------------------------------------

  const openOriginal = XMLHttpRequest.prototype.open;
  const sendOriginal = XMLHttpRequest.prototype.send;

  // Interceptamos o open() so para guardar a URL, que o send() nao recebe.
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__mlmetricsUrl = url;
    return openOriginal.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const xhr = this;

    // "load" dispara quando a resposta chega com sucesso.
    xhr.addEventListener("load", function () {
      const url = xhr.__mlmetricsUrl || "";
      window.__mlmetricsUrls.push(url);

      // Em XHR o corpo ja vem pronto em responseText - nao precisa clonar,
      // porque ler essa propriedade nao consome nada.
      let corpo = "";
      try {
        corpo = xhr.responseText || "";
      } catch (e) {
        // responseType binario (blob/arraybuffer) lanca erro ao ler
        // responseText. Ignoramos.
        return;
      }

      if (ehSuspeito(url) || ehSuspeito(corpo)) {
        reportar("xhr", url, corpo);
      }
    });

    return sendOriginal.apply(this, arguments);
  };

  console.log(
    "%c[ML METRICS]%c sniffer ativo - digite __mlmetricsUrls para ver todas as URLs",
    "background:#3483fa;color:#fff;padding:2px 6px;border-radius:3px",
    "color:#666"
  );
})();
