// ============================================================================
// DIAGNOSTICO - o que a extensao enxerga numa tela
//
// Monta o conteudo do "Copiar diagnostico": amostras dos textos que parecem
// metrica, filtros de periodo, o que seria capturado e por que cada rotulo
// foi recusado. E o plano de contingencia da extensao: a leitura foi escrita
// sem nunca termos visto as telas de vendedor de verdade, e quando ela falha
// e este conteudo que diz o porque.
//
// So monta - nao grava nem responde nada. Quem guarda o diagnostico no
// storage e responde ao popup e o coletor.js. Sem chrome.* aqui, o arquivo
// roda igual no navegador e no teste em Node.
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
   * Separada de salvarDiagnostico porque o diagnostico pedido pelo popup
   * (diagnosticarTela) faz a mesma coleta sem gravar nada.
   *
   * @param {Document} doc
   * @returns {Array} ate 25 itens { texto, contexto }
   */
  function coletarAmostras(doc) {
    const amostras = [];
    // Mesmo filtro de varrerPagina: o texto de <script>/<style> do ML embute
    // JSONs com palavras-chave, que sujariam o diagnostico com lixo.
    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      MLMetricsLeitura.aceitarNoDeTextoTecnico
    );

    let no = caminhante.nextNode();

    // Ate 12 amostras POR METRICA, 25 no total: o suficiente para entender o
    // padrao da tela sem encher o storage nem gerar um relatorio impossivel
    // de ler. O limite por metrica existe porque uma lista com muitos
    // "visitas" em sequencia enchia as 25 vagas antes de aparecer um unico
    // texto de vendas - justo o que se queria investigar.
    const porMetrica = {};

    while (no && amostras.length < 25) {
      const texto = (no.nodeValue || "").trim();
      const minusculo = texto.toLowerCase();
      const elemento = no.parentElement;

      // O proprio painel ("Visitas totais", "Vendas") nao e texto do ML. Sem
      // esta guarda, o diagnostico de uma pagina de anuncio viria cheio da
      // saida da extensao em vez do que o site mostra.
      const daExtensao = Boolean(elemento &&
        elemento.closest("#mlmetrics-painel, #mlmetrics-aviso"));

      // A primeira metrica que o texto menciona (ou undefined).
      const metrica = Object.keys(MLMetricsLeitura.ROTULOS).filter(function (nome) {
        return MLMetricsLeitura.ROTULOS[nome].some(function (palavra) {
          return minusculo.indexOf(palavra) !== -1;
        });
      })[0];

      const temVaga = metrica !== undefined && (porMetrica[metrica] || 0) < 12;

      // O limite de tamanho descarta paragrafos: se o texto e longo, e
      // prosa mencionando a palavra, nao um rotulo de metrica.
      if (!daExtensao && temVaga && texto.length > 0 && texto.length < 120) {
        porMetrica[metrica] = (porMetrica[metrica] || 0) + 1;

        amostras.push({
          metrica: metrica,
          texto: texto,
          // Janela em volta do rotulo, nao o pai inteiro. Pegar o pai todo
          // arrastava titulo, preco, nome de comprador e numero de pedido
          // que compartilhassem o mesmo elemento - dado de conta que nao
          // devia sair daqui. O numero que queremos ver fica colado no
          // rotulo, entao 20 antes + 80 depois bastam para entender o
          // formato; o resto do card fica de fora de proposito.
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
   * "359 visitas" pode ser o total do anuncio ou so os ultimos 30 dias,
   * conforme o filtro que a tela estiver usando. A extensao ainda nao sabe
   * qual e, e so da para ensinar depois de ver a tela real. So que o filtro
   * costuma ficar num cabecalho ou numa lista de opcoes LONGE dos rotulos -
   * fora da janela de 20 + 80 caracteres das amostras. Sem esta coleta, o
   * primeiro diagnostico da cliente diria "por que nao leu", mas nao "de
   * quando e o numero", e o #47 pediria mais uma rodada com ela.
   *
   * So entra texto CURTO que casa com o vocabulario fechado de periodo
   * (ehTextoDePeriodo): texto de filtro, sem numero de metrica, nome ou
   * titulo. Quando o texto esta num controle que diz se esta escolhido
   * (opcao de lista, radio, aba, botao), vem junto "marcado" - e isso que
   * separa o periodo em uso das outras opcoes da lista.
   *
   * So leitura, para o diagnostico: nao muda o que o coletor grava nem o
   * que o painel mostra.
   *
   * @param {Document} doc
   * @returns {Array} ate 20 itens { onde, texto, marcado? }
   */
  function coletarTextosDePeriodo(doc) {
    const LIMITE_ITENS = 20;
    const achados = [];
    const vistos = {};

    // O mesmo filtro aparece repetido (cabecalho fixo e lista aberta, por
    // exemplo). Repetido nao acrescenta nada e gastaria vaga.
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

    // Texto visivel, com o mesmo filtro das amostras: sem script, style ou
    // oculto, e sem o que a propria extensao desenhou.
    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      MLMetricsLeitura.aceitarNoDeTextoTecnico
    );
    let no = caminhante.nextNode();

    while (no && achados.length < LIMITE_ITENS) {
      const texto = (no.nodeValue || "").replace(/\s+/g, " ").trim();
      const elemento = no.parentElement;
      const daExtensao = Boolean(elemento &&
        elemento.closest("#mlmetrics-painel, #mlmetrics-aviso"));

      // 80 caracteres: rotulo de filtro e curto. Frase longa que menciona
      // "ultimos 30 dias" e explicacao, nao o filtro.
      if (!daExtensao && texto.length > 0 && texto.length <= 80 &&
          ehTextoDePeriodo(texto)) {
        const opcao = elemento ? elemento.closest("option") : null;
        anotar(opcao ? "opcao de lista" : "texto", texto, estadoDoControle(elemento));
      }

      no = caminhante.nextNode();
    }

    // Seletor de datas costuma mostrar o intervalo no VALOR de um campo, que
    // nao e no de texto - o TreeWalker nao ve. Campo escondido, de senha,
    // e-mail ou telefone fica de fora de proposito: pode carregar dado de
    // conta e nunca e o filtro visivel.
    const campos = doc.body.querySelectorAll("input");

    for (let i = 0; i < campos.length && achados.length < LIMITE_ITENS; i++) {
      const campo = campos[i];
      const tipo = String(campo.type || campo.getAttribute("type") || "").toLowerCase();

      if (/^(hidden|password|email|tel)$/.test(tipo)) continue;
      if (campo.closest("[hidden], #mlmetrics-painel, #mlmetrics-aviso")) continue;

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
   * A lista e FECHADA, como em seguidoDeUnidade. Um "dias" solto nao basta:
   * "Chega em 2 dias" e "pausado ha 12 dias" sao prazo, nao recorte de
   * metrica, e encheriam o diagnostico. "Hoje" so vale sozinho ou depois de
   * "de", "desde" e "ate" - "Chega hoje" e entrega. Data sozinha tambem fica
   * de fora: e data de venda ou de publicacao; so o INTERVALO e filtro.
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
   * Uma lista de periodo mostra todas as opcoes ("7 dias", "30 dias", "90
   * dias"), mas so a escolhida vale para os numeros. Os controles contam isso
   * de tres jeitos: opcao de <select> (selected), radio ou checkbox de um
   * <label> (checked) e os atributos aria de botoes e abas. Subimos poucos
   * niveis porque o texto costuma estar num <span> dentro do botao.
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
   * O diagnostico guardado no storage e da ultima pagina que falhou - em
   * qualquer aba, ha qualquer tempo. Quem clica em "Copiar diagnostico" esta
   * olhando UMA tela e espera que o relatorio fale dela. Por isso o popup
   * pergunta direto a esta aba, e a resposta mostra cada trava do coletor
   * aplicada a ela: e vitrine? menciona visita? o que seria capturado agora?
   *
   * So leitura: varre a pagina inteira, mas nao grava nada.
   *
   * Recebe o documento e o endereco por parametro - o coletor passa document
   * e window.location - para rodar tambem fora do navegador.
   *
   * @param {Document} doc
   * @param {Location|Object} local href, hostname e pathname da pagina
   * @returns {Object}
   */
  function diagnosticarTela(doc, local) {
    const url = local.href;
    const vitrine = MLMetricsLeitura.ehPaginaDeCompra(url);

    // Cada rotulo que NAO virou numero, com o motivo (ver varrerPagina).
    const recusas = [];
    const captura = vitrine ? null : MLMetricsLeitura.varrerPagina(doc, url, recusas);

    return {
      host: local.hostname,
      caminho: MLMetricsLeitura.caminhoMascarado(local.pathname),
      // Trava 1: vitrine publica nunca e varrida pelo coletor.
      vitrine: vitrine,
      // Trava 2: pagina sem "visita" fora do painel nao e tela de vendedor.
      mencionaVisita: MLMetricsLeitura.paginaMencionaVisita(doc),
      // O que o coletor gravaria se varresse agora ({} = nada passou pelas
      // travas). Em vitrine ele nem varre, entao fica null.
      capturariaAgora: captura,
      // De qual periodo sao os numeros da tela: textos de filtro, com a opcao
      // escolhida marcada quando o controle diz (#47, ver
      // coletarTextosDePeriodo).
      periodo: coletarTextosDePeriodo(doc),
      // Contagem por motivo primeiro: com 50 anuncios na tela, e ela que
      // mostra de relance se o problema e o mesmo em todos.
      resumoDasRecusas: resumirRecusas(recusas),
      // As primeiras 40, cada uma com o trecho de texto em que aconteceu.
      recusas: recusas.slice(0, 40),
      amostras: coletarAmostras(doc)
    };
  }

  /**
   * Conta as recusas por metrica e motivo, para o diagnostico.
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

  // Publico: o coletor.js usa amostras, periodo e diagnosticarTela; o teste
  // em Node cobra tambem as pecas.
  return {
    coletarAmostras: coletarAmostras,
    coletarTextosDePeriodo: coletarTextosDePeriodo,
    ehTextoDePeriodo: ehTextoDePeriodo,
    estadoDoControle: estadoDoControle,
    diagnosticarTela: diagnosticarTela,
    resumirRecusas: resumirRecusas
  };
})();
