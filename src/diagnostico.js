// ============================================================================
// DIAGNOSTICO - o que a extensao enxerga numa tela
//
// Monta o conteudo do "Copiar diagnostico": amostras dos textos que parecem
// metrica, filtros de periodo, o que seria capturado e por que cada rotulo
// foi recusado. E o que diz o porque quando a leitura falha numa tela real.
//
// So monta - quem grava e responde ao popup e o coletor.js. Sem chrome.*
// aqui, o arquivo roda igual no navegador e no teste em Node.
//
// Depende do leitura.js, carregado antes (ver manifest).
// ============================================================================

var MLMetricsDiagnostico = (function () {
  "use strict";

  // --------------------------------------------------------------------------
  // Amostras e periodo
  // --------------------------------------------------------------------------

  /**
   * Junta as amostras de texto que PARECEM metrica, com a janela em volta.
   *
   * Ate 12 por metrica e 25 no total: o bastante para entender o padrao da
   * tela. O limite por metrica impede que uma lista cheia de "visitas" ocupe
   * todas as vagas antes de aparecer um texto de vendas.
   *
   * @param {Document} doc
   * @returns {Array} ate 25 itens { metrica, texto, contexto }
   */
  function coletarAmostras(doc) {
    const amostras = [];
    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      MLMetricsLeitura.aceitarNoDeTextoTecnico
    );

    let no = caminhante.nextNode();
    const porMetrica = {};

    while (no && amostras.length < 25) {
      const texto = (no.nodeValue || "").trim();
      const minusculo = texto.toLowerCase();

      // A primeira metrica que o texto menciona (ou undefined).
      const metrica = Object.keys(MLMetricsLeitura.ROTULOS).filter(function (nome) {
        return MLMetricsLeitura.ROTULOS[nome].some(function (palavra) {
          return minusculo.indexOf(palavra) !== -1;
        });
      })[0];

      const temVaga = metrica !== undefined && (porMetrica[metrica] || 0) < 12;

      // Texto longo e prosa mencionando a palavra, nao rotulo de metrica.
      if (!MLMetricsLeitura.ehDaExtensao(no.parentElement) && temVaga &&
          texto.length > 0 && texto.length < 120) {
        porMetrica[metrica] = (porMetrica[metrica] || 0) + 1;

        amostras.push({
          metrica: metrica,
          texto: texto,
          // Janela curta em volta do rotulo, nunca o pai inteiro - que pode
          // ter titulo, preco e nome de comprador.
          contexto: MLMetricsLeitura.contextoDoTexto(no, texto)
        });
      }

      no = caminhante.nextNode();
    }

    return amostras;
  }

  /**
   * Junta os textos da tela que dizem DE QUAL PERIODO sao os numeros (#47).
   *
   * "359 visitas" pode ser o total ou so os ultimos 30 dias, conforme o
   * filtro da tela - e o filtro costuma ficar LONGE dos rotulos, fora da
   * janela das amostras. So entra texto curto que casa com o vocabulario
   * fechado de periodo (ehTextoDePeriodo). Quando o texto esta num controle
   * que diz se esta escolhido, vem junto "marcado".
   *
   * @param {Document} doc
   * @returns {Array} ate 20 itens { onde, texto, marcado? }
   */
  function coletarTextosDePeriodo(doc) {
    const LIMITE_ITENS = 20;
    const achados = [];
    const vistos = {};

    // O mesmo filtro aparece repetido (cabecalho e lista aberta): conta uma vez.
    function anotar(onde, texto, marcado) {
      const chave = onde + "|" + texto + "|" + marcado;
      if (vistos[chave] || achados.length >= LIMITE_ITENS) return;
      vistos[chave] = true;

      const item = { onde: onde, texto: texto };
      // Sem controle que diga, "marcado" fica de fora: false afirmaria que a
      // opcao NAO esta escolhida, e isso nao sabemos.
      if (marcado !== undefined) item.marcado = marcado;
      achados.push(item);
    }

    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      MLMetricsLeitura.aceitarNoDeTextoTecnico
    );
    let no = caminhante.nextNode();

    while (no && achados.length < LIMITE_ITENS) {
      const texto = (no.nodeValue || "").replace(/\s+/g, " ").trim();
      const elemento = no.parentElement;

      // Rotulo de filtro e curto; frase longa com "ultimos 30 dias" e prosa.
      if (!MLMetricsLeitura.ehDaExtensao(elemento) && texto.length > 0 && texto.length <= 80 &&
          ehTextoDePeriodo(texto)) {
        const opcao = elemento ? elemento.closest("option") : null;
        anotar(opcao ? "opcao de lista" : "texto", texto, estadoDoControle(elemento));
      }

      no = caminhante.nextNode();
    }

    // Seletor de datas mostra o intervalo no VALOR de um campo, que o
    // TreeWalker nao ve. Campo escondido, de senha, e-mail ou telefone fica
    // de fora: pode ter dado de conta e nunca e o filtro visivel.
    const campos = doc.body.querySelectorAll("input");

    for (let i = 0; i < campos.length && achados.length < LIMITE_ITENS; i++) {
      const campo = campos[i];
      const tipo = String(campo.type || campo.getAttribute("type") || "").toLowerCase();

      if (/^(hidden|password|email|tel)$/.test(tipo)) continue;
      if (campo.closest("[hidden], " + MLMetricsLeitura.SELETOR_DA_EXTENSAO)) continue;

      const valor = String(campo.value || "").replace(/\s+/g, " ").trim();
      if (valor.length > 0 && valor.length <= 80 && ehTextoDePeriodo(valor)) {
        anotar("campo", valor, undefined);
      }
    }

    return achados;
  }

  /**
   * Diz se um texto curto e rotulo de PERIODO: "Ultimos 30 dias", "Este mes",
   * "01/08/2026 - 30/08/2026".
   *
   * A lista e FECHADA. Um "dias" solto nao basta: "Chega em 2 dias" e prazo.
   * "Hoje" so vale sozinho ou depois de "de", "desde" e "ate" ("Chega hoje" e
   * entrega). Data sozinha tambem nao: so o INTERVALO e filtro.
   *
   * @param {string} texto
   * @returns {boolean}
   */
  function ehTextoDePeriodo(texto) {
    const t = texto.toLowerCase();

    // "Ultimos 30 dias", "ultimas 24 horas", "ultimo mes".
    if (/[uú]ltim[oa]s?\s+(\d+\s+)?(dias?|semanas?|m[eê]s|meses|anos?|horas)(?![a-zà-ÿ])/.test(t)) {
      return true;
    }

    // Opcao solta de lista ou aba: "30 dias", "7d", "24 h".
    if (/^\d+\s*(dias?|d|semanas?|meses|anos?|horas|h)$/.test(t)) return true;

    // "Hoje", "Ontem", "Vendas desde ontem".
    if (/^(hoje|ontem)$/.test(t)) return true;
    if (/(^|\s)(de|desde|at[eé])\s+(hoje|ontem)(?![a-zà-ÿ])/.test(t)) return true;

    // "Este mes", "nesta semana", "Mes passado", "semana anterior", "ano atual".
    if (/(^|\s)(est[ea]|nest[ea])\s+(semana|m[eê]s|ano)(?![a-zà-ÿ])/.test(t)) return true;
    if (/(^|\s)(semana|m[eê]s|ano)\s+(atual|passad[oa]|anterior)(?![a-zà-ÿ])/.test(t)) return true;

    // Palavras que so aparecem em filtro de tempo.
    if (/per[ií]odo|desde (o in[ií]cio|sempre|a publica)|tod[oa] o (per[ií]odo|hist[oó]rico)/.test(t)) {
      return true;
    }

    // Intervalo com data curta: "01/08/2026 - 30/08/2026", "01/08 a 30/08".
    if (/\d{1,2}\/\d{1,2}(\/\d{2,4})?(\s*[-–]\s*|\s+(a|at[eé])\s+)\d{1,2}\/\d{1,2}/.test(t)) {
      return true;
    }

    // Intervalo com mes escrito: "16 ago. - 14 set.", "1 de agosto a 30 de agosto".
    return /\d{1,2}\s+(de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(\s+(de\s+)?\d{4})?(\s*[-–]\s*|\s+(a|at[eé])\s+)\d{1,2}\s+(de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/.test(t);
  }

  /**
   * Diz se o controle em volta de um texto esta ESCOLHIDO.
   *
   * Uma lista de periodo mostra todas as opcoes, mas so a escolhida vale.
   * Os controles dizem isso por <option selected>, radio/checkbox de um
   * <label> ou atributos aria. Subimos poucos niveis porque o texto costuma
   * estar num <span> dentro do botao.
   *
   * @param {Element|null} elemento pai do no de texto
   * @returns {boolean|undefined} undefined quando nenhum controle diz
   */
  function estadoDoControle(elemento) {
    if (!elemento) return undefined;

    const opcao = elemento.closest("option");
    if (opcao) return Boolean(opcao.selected);

    // label.control e o campo do rotulo, dentro dele ou ligado por "for".
    const rotulo = elemento.closest("label");
    const controle = rotulo ? rotulo.control : null;
    if (controle && (controle.type === "radio" || controle.type === "checkbox")) {
      return Boolean(controle.checked);
    }

    const ATRIBUTOS = ["aria-selected", "aria-checked", "aria-pressed", "aria-current"];
    let atual = elemento;

    for (let nivel = 0; atual && nivel < 4; nivel++) {
      for (let i = 0; i < ATRIBUTOS.length; i++) {
        const valor = atual.getAttribute(ATRIBUTOS[i]);
        // aria-current ligado vale "page", "date" ou "true"; so "false"
        // desliga. Os outros tres usam "true"/"false".
        if (valor !== null && valor !== undefined) return valor !== "false";
      }
      atual = atual.parentElement;
    }

    return undefined;
  }

  // --------------------------------------------------------------------------
  // Diagnostico da tela
  // --------------------------------------------------------------------------

  /**
   * Diagnostico da tela ABERTA, montado na hora em que o popup pede.
   *
   * O diagnostico guardado no storage e da ultima pagina que falhou, em
   * qualquer aba. Quem clica em "Copiar diagnostico" espera que o relatorio
   * fale da tela que esta olhando - por isso esta resposta aplica cada trava
   * do coletor a ela. So leitura: nao grava nada.
   *
   * @param {Document} doc
   * @param {Location|Object} local href, hostname e pathname da pagina
   * @returns {Object}
   */
  function diagnosticarTela(doc, local) {
    const url = local.href;
    const vitrine = MLMetricsLeitura.ehPaginaDeCompra(url);

    const recusas = [];
    const captura = vitrine ? null : MLMetricsLeitura.varrerPagina(doc, url, recusas);

    return {
      host: local.hostname,
      caminho: MLMetricsLeitura.caminhoMascarado(local.pathname),
      // Trava 1: vitrine publica nunca e varrida.
      vitrine: vitrine,
      // Trava 2: pagina sem "visita" nao e tela de vendedor.
      mencionaVisita: MLMetricsLeitura.paginaMencionaVisita(doc),
      // O que seria gravado agora ({} = nada passou; null = vitrine).
      capturariaAgora: captura,
      periodo: coletarTextosDePeriodo(doc),
      // Contagem por motivo primeiro: com 50 anuncios, mostra de relance se
      // o problema e o mesmo em todos.
      resumoDasRecusas: resumirRecusas(recusas),
      recusas: recusas.slice(0, 40),
      amostras: coletarAmostras(doc)
    };
  }

  /**
   * Conta as recusas por metrica e motivo.
   *
   * @param {Array} recusas
   * @returns {Object} chave "metrica: motivo", valor quantas vezes
   */
  function resumirRecusas(recusas) {
    const resumo = {};

    recusas.forEach(function (recusa) {
      const chave = (recusa.metrica ? recusa.metrica + ": " : "") + recusa.motivo;
      resumo[chave] = (resumo[chave] || 0) + 1;
    });

    return resumo;
  }

  return {
    coletarAmostras: coletarAmostras,
    coletarTextosDePeriodo: coletarTextosDePeriodo,
    ehTextoDePeriodo: ehTextoDePeriodo,
    estadoDoControle: estadoDoControle,
    diagnosticarTela: diagnosticarTela,
    resumirRecusas: resumirRecusas
  };
})();
