// IIFE (funcao que se executa sozinha): cria um escopo isolado para nossas
// variaveis nao colidirem com as do proprio site do Mercado Livre.
(function () {
  "use strict";

  // Prefixo usado em todos os nossos IDs/classes de CSS.
  // Evita conflito com as classes do ML, que tambem usam nomes genericos.
  const PREFIXO = "mlmetrics";

  /**
   * Extrai o codigo do anuncio (ex: "MLB3456789012") a partir da URL.
   *
   * O ML usa dois formatos de URL:
   *   produto.mercadolivre.com.br/MLB-3456789012-titulo-do-anuncio-_JM
   *   www.mercadolivre.com.br/titulo-do-anuncio/p/MLB12345678
   *
   * O hifen depois de "MLB" aparece no primeiro formato e nao no segundo,
   * por isso o "-?" na expressao regular (significa "opcional").
   *
   * @returns {string|null} o codigo sem hifen, ou null se nao for pagina de anuncio
   */
  function extrairCodigoAnuncio() {
    const match = window.location.href.match(/MLB-?(\d{6,})/);

    // match[1] e o primeiro grupo de captura, ou seja, so os digitos.
    // Remontamos com "MLB" na frente para ficar no formato padrao da API.
    return match ? "MLB" + match[1] : null;
  }

  /**
   * Monta o painel e coloca na pagina.
   * Por enquanto os valores sao fixos - so queremos provar que a injecao funciona.
   *
   * @param {string} codigoAnuncio
   */
  function injetarPainel(codigoAnuncio) {
    // Guarda de seguranca: se o painel ja existe, nao cria outro.
    // Isso importa porque o ML e uma SPA - ao navegar entre produtos a pagina
    // nao recarrega, entao este script pode acabar rodando mais de uma vez.
    if (document.getElementById(PREFIXO + "-painel")) return;

    const painel = document.createElement("div");
    painel.id = PREFIXO + "-painel";

    // textContent (e nao innerHTML) para os dados vindos da pagina.
    // Como aqui e texto que nos mesmos escrevemos, innerHTML seria seguro,
    // mas ja vamos adotando o habito: na Etapa 4 os dados virao de fora.
    const titulo = document.createElement("div");
    titulo.className = PREFIXO + "-titulo";
    titulo.textContent = "ML Metrics";

    const linha = document.createElement("div");
    linha.className = PREFIXO + "-linha";
    linha.textContent = "Anuncio: " + codigoAnuncio;

    const status = document.createElement("div");
    status.className = PREFIXO + "-status";
    status.textContent = "Etapa 1 - injecao funcionando";

    painel.appendChild(titulo);
    painel.appendChild(linha);
    painel.appendChild(status);

    // Pendura no <body>. O CSS vai posicionar com position:fixed,
    // entao o lugar exato onde inserimos nao importa muito por enquanto.
    document.body.appendChild(painel);
  }

  // ---- Ponto de entrada ----

  const codigo = extrairCodigoAnuncio();

  if (!codigo) {
    // Nao e pagina de anuncio (e a home, uma busca, o carrinho...).
    // Sai em silencio, sem sujar a pagina nem o console do usuario.
    return;
  }

  injetarPainel(codigo);
})();
