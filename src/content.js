// ============================================================================
// PAINEL - exibe as metricas na pagina do anuncio (Etapa 4)
//
// Nao busca dado em lugar nenhum: le o que o coletor.js guardou no
// chrome.storage enquanto a vendedora passava pelas telas de vendedor, e
// combina com o que da para ler da propria pagina do anuncio (preco).
//
// A divisao de responsabilidades e proposital:
//   coletor.js -> CAPTURA (roda nas telas de vendedor)
//   content.js -> EXIBE   (roda na pagina do anuncio)
// Cada um funciona sem o outro estar presente na mesma tela.
// ============================================================================

(function () {
  "use strict";

  const PREFIXO = "mlmetrics";
  const CHAVE_CACHE = "mlmetrics_dados";

  // --------------------------------------------------------------------------
  // Leitura
  // --------------------------------------------------------------------------

  /**
   * Extrai o codigo do anuncio (ex: "MLB3456789012") a partir da URL.
   *
   * O ML usa dois formatos, com e sem hifen depois de "MLB":
   *   produto.mercadolivre.com.br/MLB-3456789012-titulo-_JM
   *   www.mercadolivre.com.br/titulo/p/MLB12345678
   *
   * @returns {string|null} null se nao for pagina de anuncio
   */
  function extrairCodigoAnuncio() {
    const match = window.location.href.match(/MLB-?(\d{6,})/);
    return match ? "MLB" + match[1] : null;
  }

  /**
   * Le o preco do produto na pagina.
   *
   * Tentamos duas fontes, da mais confiavel para a menos:
   *
   * 1. <meta itemprop="price"> - dado estruturado que o ML publica para
   *    buscadores (Google Shopping etc). E o formato mais estavel que existe
   *    na pagina, porque quebra-lo prejudicaria o SEO do proprio ML.
   *
   * 2. A classe do componente de preco. Funciona, mas e o tipo de coisa que
   *    morre num redesenho - por isso fica so como plano B.
   *
   * @returns {number|null} preco em reais
   */
  function lerPreco() {
    const meta = document.querySelector('meta[itemprop="price"]');

    if (meta) {
      // Em dado estruturado o preco vem no padrao internacional
      // ("319.90", ponto decimal), entao parseFloat resolve direto.
      const valor = parseFloat(meta.getAttribute("content"));
      if (!isNaN(valor)) return valor;
    }

    const fracao = document.querySelector(".andes-money-amount__fraction");

    if (fracao) {
      // Aqui o texto esta no formato brasileiro ("1.234"), entao o ponto
      // e separador de milhar e precisa sumir antes de converter.
      const limpo = fracao.textContent.split(".").join("").trim();
      const valor = parseInt(limpo, 10);
      if (!isNaN(valor)) return valor;
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Formatacao
  // --------------------------------------------------------------------------

  /**
   * Formata um numero como moeda brasileira.
   * Intl faz parte do proprio JavaScript - nao precisa de biblioteca.
   */
  function formatarReais(valor) {
    return valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  /**
   * Transforma a data da captura em algo legivel: "hoje", "há 3 dias".
   *
   * Existe para o numero nunca ser exibido sem contexto de idade. Um dado
   * de duas semanas atras mostrado como se fosse de agora leva a decisao
   * errada - e pior do que nao mostrar nada.
   */
  function descreverIdade(timestamp) {
    if (!timestamp) return "origem desconhecida";

    const MS_POR_DIA = 24 * 60 * 60 * 1000;
    const dias = Math.floor((Date.now() - timestamp) / MS_POR_DIA);

    if (dias <= 0) return "atualizado hoje";
    if (dias === 1) return "atualizado ontem";
    return "atualizado há " + dias + " dias";
  }

  // --------------------------------------------------------------------------
  // Calculo
  // --------------------------------------------------------------------------

  /**
   * Deriva as metricas a partir dos insumos.
   *
   * Cada metrica so e calculada se os dados que ela exige existirem -
   * devolvemos null em vez de zero. Zero e uma afirmacao ("converteu 0%"),
   * null e uma ausencia ("nao sei"), e confundir os dois faz o painel
   * mentir com cara de certeza.
   *
   * @param {Object} dados { visitas, vendas } vindos do cache
   * @param {number|null} preco lido da pagina
   */
  function calcular(dados, preco) {
    const visitas = dados.visitas;
    const vendas = dados.vendas;

    const temAmbos = (visitas > 0 && vendas > 0);

    return {
      visitas: (visitas !== undefined) ? visitas : null,
      vendas: (vendas !== undefined) ? vendas : null,

      // Porcentagem de visitas que viraram venda.
      conversao: temAmbos ? (vendas / visitas) * 100 : null,

      // Quantas visitas, em media, para sair uma venda.
      // Math.round porque "vende a cada 7,18 visitas" nao ajuda ninguem.
      visitasPorVenda: temAmbos ? Math.round(visitas / vendas) : null,

      // Receita bruta acumulada. E estimativa: assume que todas as vendas
      // sairam pelo preco atual, o que ignora promocoes passadas.
      receita: (vendas > 0 && preco) ? vendas * preco : null
    };
  }

  // --------------------------------------------------------------------------
  // Exibicao
  // --------------------------------------------------------------------------

  /**
   * Cria uma linha do painel: rotulo em cima, valor embaixo.
   *
   * Usamos textContent (nunca innerHTML) porque parte deste conteudo vem
   * da pagina do Mercado Livre. Com innerHTML, um texto contendo tags
   * seria interpretado como HTML e executado - textContent trata tudo
   * como texto puro, que e o que queremos.
   */
  function criarLinha(rotulo, valor) {
    const linha = document.createElement("div");
    linha.className = PREFIXO + "-linha";

    const textoRotulo = document.createElement("span");
    textoRotulo.className = PREFIXO + "-rotulo";
    textoRotulo.textContent = rotulo;

    const textoValor = document.createElement("span");
    textoValor.className = PREFIXO + "-valor";

    // Travessao quando nao ha dado. Deixa explicito que a metrica existe
    // mas o valor esta faltando, em vez de sumir com a linha e dar a
    // impressao de que o painel esta completo.
    textoValor.textContent = (valor === null) ? "—" : valor;

    linha.appendChild(textoRotulo);
    linha.appendChild(textoValor);
    return linha;
  }

  /**
   * Monta e insere o painel na pagina.
   */
  function montarPainel(codigo, metricas, capturadoEm) {
    // O ML e uma SPA: navegar entre produtos nao recarrega a pagina, entao
    // este script pode rodar de novo. Removemos o painel anterior em vez de
    // so desistir, senao ficariamos exibindo os dados do produto antigo.
    const anterior = document.getElementById(PREFIXO + "-painel");
    if (anterior) anterior.remove();

    const painel = document.createElement("div");
    painel.id = PREFIXO + "-painel";

    const titulo = document.createElement("div");
    titulo.className = PREFIXO + "-titulo";
    titulo.textContent = "ML Metrics";
    painel.appendChild(titulo);

    painel.appendChild(criarLinha(
      "Visitas totais",
      metricas.visitas !== null ? metricas.visitas.toLocaleString("pt-BR") : null
    ));

    painel.appendChild(criarLinha(
      "Vendas",
      metricas.vendas !== null ? metricas.vendas.toLocaleString("pt-BR") : null
    ));

    painel.appendChild(criarLinha(
      "Conversão",
      metricas.conversao !== null ? metricas.conversao.toFixed(1) + "%" : null
    ));

    painel.appendChild(criarLinha(
      "Vende a cada",
      metricas.visitasPorVenda !== null ? metricas.visitasPorVenda + " visitas" : null
    ));

    painel.appendChild(criarLinha(
      "Receita estimada",
      metricas.receita !== null ? formatarReais(metricas.receita) : null
    ));

    const rodape = document.createElement("div");
    rodape.className = PREFIXO + "-status";
    rodape.textContent = descreverIdade(capturadoEm);
    painel.appendChild(rodape);

    document.body.appendChild(painel);
  }

  /**
   * Painel alternativo para quando nao ha dado nenhum deste anuncio.
   *
   * E o caso mais provavel no primeiro uso: a extensao acabou de ser
   * instalada e ninguem passou ainda pelas telas de vendedor. Em vez de
   * nao mostrar nada (que parece extensao quebrada), explicamos o que
   * fazer para os dados aparecerem.
   */
  function montarPainelVazio() {
    const anterior = document.getElementById(PREFIXO + "-painel");
    if (anterior) anterior.remove();

    const painel = document.createElement("div");
    painel.id = PREFIXO + "-painel";

    const titulo = document.createElement("div");
    titulo.className = PREFIXO + "-titulo";
    titulo.textContent = "ML Metrics";

    const aviso = document.createElement("div");
    aviso.className = PREFIXO + "-status";
    aviso.textContent =
      "Sem dados deste anúncio ainda. Abra \"Minhas publicações\" " +
      "uma vez para a extensão capturar as métricas.";

    painel.appendChild(titulo);
    painel.appendChild(aviso);
    document.body.appendChild(painel);
  }

  // --------------------------------------------------------------------------
  // Ponto de entrada
  // --------------------------------------------------------------------------

  const codigo = extrairCodigoAnuncio();

  // Nao e pagina de anuncio (home, busca, carrinho). Sai em silencio.
  if (!codigo) return;

  // chrome.storage e assincrono: devolve por callback, nao por retorno.
  // Toda a montagem do painel acontece dentro dele, ja com o dado em maos.
  chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
    const cache = guardado[CHAVE_CACHE] || {};
    const dados = cache[codigo];

    if (!dados) {
      montarPainelVazio();
      return;
    }

    const preco = lerPreco();
    montarPainel(codigo, calcular(dados, preco), dados.capturadoEm);
  });
})();
