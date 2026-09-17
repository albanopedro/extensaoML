// ============================================================================
// CALCULO - o que o painel mostra, sem tocar na pagina
//
// Qual codigo identifica o anuncio da URL, quais numeros tem prova de origem,
// as contas (conversao, "vende a cada", receita) e os formatos (moeda,
// percentual, idade do dado). Tudo puro: recebe valores por parametro, nao le
// DOM nem chrome.storage.
//
// Saiu do content.js para o teste em Node (teste/test-parsing.js) carregar o
// arquivo como ele e, em vez de recortar funcao do texto. Carregado antes do
// content.js (ver manifest), que usa tudo por MLMetricsCalculo.
// ============================================================================

var MLMetricsCalculo = (function () {
  "use strict";

  // Identificadores de anuncio do Mercado Livre.
  //
  // Existem varios formatos, e a letra opcional depois de "MLB" faz parte
  // do codigo - NAO e ruido a ser descartado. "MLBU1234567890" e
  // "MLB1234567890" sao identificadores diferentes, de espacos distintos.
  // Por isso capturamos o prefixo e os digitos em grupos separados e
  // remontamos: o unico caractere que sumiu e o hifen.
  //
  //   MLB-3456789012   ->  MLB3456789012    anuncio (produto.mercadolivre)
  //   MLB12345678      ->  MLB12345678      produto de catalogo (/p/)
  //   MLBU1234567890   ->  MLBU1234567890   estrutura nova (/up/)
  const PADRAO_CODIGO = /(MLB[A-Z]?)-?(\d{6,})/;

  // A partir de quantos dias o dado passa a ser exibido como suspeito.
  // Tres dias e curto o bastante para que um anuncio ativo nao pareca
  // parado, e longo o bastante para nao alarmar por causa de um fim de semana.
  const DIAS_PARA_ALERTA = 3;

  // --------------------------------------------------------------------------
  // Codigo e preco
  // --------------------------------------------------------------------------

  /**
   * Codigos que podem identificar o anuncio desta pagina, do mais confiavel
   * para o menos.
   *
   * O ML usa tres espacos de codigo: o do ITEM (MLB-3456789012), que e o que
   * a tela de vendedor usa e o que o coletor guarda; o do produto de CATALOGO
   * (/p/MLB19655437); e o do user product (/up/MLBU...). Na vitrine, o
   * caminho traz o de catalogo ou de user product, e o do ITEM vem nos
   * parametros (pdp_filters=item_id:MLB..., item_id=MLB..., wid=MLB...).
   * Pegar so o primeiro MLB da URL fazia o painel procurar o codigo errado e
   * dizer "Sem dados" num anuncio que tinha dados.
   *
   * So olhamos os parametros que SABEMOS que carregam o item. Um MLB em
   * qualquer outro parametro (busca, filtro) e ignorado: numa tela de
   * vendedor com "?search=MLB...", isso punha painel onde nao devia.
   *
   * Recebe a URL por parametro para poder ser testada fora do navegador.
   *
   * @param {string} href endereco da pagina
   * @returns {string[]} codigos distintos, na ordem de confianca
   */
  function codigosDaPagina(href) {
    const candidatos = [];

    function anotar(achado) {
      if (!achado) return;

      // achado[1] e o prefixo ("MLB" ou "MLBU"), achado[2] sao os digitos.
      const codigo = achado[1] + achado[2];
      if (candidatos.indexOf(codigo) === -1) candidatos.push(codigo);
    }

    let endereco;
    try {
      endereco = new URL(href);
    } catch (e) {
      return candidatos;
    }

    // Os parametros podem vir na query ou depois do "#": o ML usa os dois.
    const grupos = [
      endereco.searchParams,
      new URLSearchParams(endereco.hash.replace(/^#/, ""))
    ];

    grupos.forEach(function (parametros) {
      const filtros = parametros.get("pdp_filters") || "";
      anotar(filtros.match(/item_id[:=](MLB[A-Z]?)-?(\d{6,})/));
      anotar((parametros.get("item_id") || "").match(PADRAO_CODIGO));
      anotar((parametros.get("wid") || "").match(PADRAO_CODIGO));
    });

    // Por ultimo, o caminho: na vitrine classica ele e o proprio item.
    anotar(endereco.pathname.match(PADRAO_CODIGO));

    return candidatos;
  }

  /**
   * Procura o preco das ofertas num bloco JSON-LD - que pode ser um objeto,
   * uma lista ou trazer um "@graph" dentro.
   *
   * @param {string} texto conteudo do script application/ld+json
   * @returns {number|null}
   */
  function precoDoJsonLd(texto) {
    let dado;

    try {
      dado = JSON.parse(texto);
    } catch (e) {
      return null;  // bloco malformado: ignora, nao quebra o painel
    }

    const fila = [dado];

    while (fila.length > 0) {
      const item = fila.shift();
      if (!item || typeof item !== "object") continue;

      if (Array.isArray(item)) {
        fila.push.apply(fila, item);
        continue;
      }

      const ofertas = [].concat(item.offers || []);

      for (let i = 0; i < ofertas.length; i++) {
        const valor = parseFloat(ofertas[i] && ofertas[i].price);
        if (valor > 0) return valor;
      }

      if (item["@graph"]) fila.push(item["@graph"]);
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
   * Formata percentual como no Brasil e no ML: "13,9%", com virgula.
   * toFixed dava "13.9%", que a pessoa le diferente do que o site mostra.
   */
  function formatarPercentual(valor) {
    return valor.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }) + "%";
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

    const dias = diasDesde(timestamp);

    if (dias <= 0) return "atualizado hoje";
    if (dias === 1) return "atualizado ontem";

    if (dias >= DIAS_PARA_ALERTA) {
      // Acima do limite, avisamos de forma explicita em vez de so informar
      // a data. Numero velho apresentado com a mesma confianca de um numero
      // novo induz a decisao errada - e quem le nao tem como desconfiar.
      return "dados de " + dias + " dias atrás — abra \"Minhas publicações\" " +
             "para atualizar";
    }

    return "atualizado há " + dias + " dias";
  }

  /**
   * Quantos dias de CALENDARIO separam a data da captura de hoje.
   *
   * Contar blocos de 24 horas dizia "atualizado hoje" para uma leitura feita
   * ontem a noite. Comparamos a meia-noite de cada data; o Math.round absorve
   * a hora a mais ou a menos dos dias de horario de verao.
   *
   * @param {number} timestamp
   * @param {number} [agora] so para teste; o padrao e Date.now()
   * @returns {number}
   */
  function diasDesde(timestamp, agora) {
    const MS_POR_DIA = 24 * 60 * 60 * 1000;
    const hoje = new Date(agora === undefined ? Date.now() : agora);
    const dia = new Date(timestamp);

    hoje.setHours(0, 0, 0, 0);
    dia.setHours(0, 0, 0, 0);

    return Math.round((hoje - dia) / MS_POR_DIA);
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

    // "Pelo menos um definido" e diferente de "maior que zero". O caso de
    // 500 visitas e 0 vendas PRECISA mostrar "0%" - zero e um dado real
    // (ninguem comprou), nao uma ausencia. So null sinaliza "nao sei".
    const temAmbos = (visitas !== undefined && vendas !== undefined);

    // visitasPorVenda e receita dividem por vendas: com 0 vendas nao ha o
    // que calcular, entao essas duas continuam exigindo vendas > 0. E a
    // "vende a cada" ainda exige VISITAS: um anuncio pode ter vendas no
    // cache sem nenhuma visita lida (a captura por telas nem sempre pega as
    // duas; foi o que a pagina real /up/ mostrou com "1.000 vendas" e zero
    // visitas). Dividir por 0 daria Infinity, e dividir indefinido daria
    // NaN - os dois seriam impressos como "NaN visitas", numero com cara de
    // certo que nao e. Sem visita, "vende a cada" nao tem o que responder.
    const temVendas = (vendas !== undefined && vendas > 0);

    // Vendas acima das visitas (#40): pode ser venda de varias unidades para o
    // mesmo comprador - "vendidos" conta unidades, nao pedidos. Os numeros
    // continuam valendo, mas taxa e "vende a cada" deixam de fazer sentido:
    // dariam conversao acima de 100% e "vende a cada 0 visitas".
    const acimaDasVisitas = temAmbos && vendas > visitas;

    return {
      visitas: (visitas !== undefined) ? visitas : null,
      vendas: (vendas !== undefined) ? vendas : null,

      // 0% e dado (converteu nada); null e ausencia (nao sei). Mas sem
      // nenhuma visita nao existe taxa: 0 vendas / 0 visitas daria NaN e
      // 3 / 0 daria Infinity, impressos como "NaN%" e "Infinity%". E anuncio
      // recem-criado ("0 visitas, 0 vendas") e caso comum, nao excecao.
      conversao: (temAmbos && visitas > 0 && !acimaDasVisitas) ? (vendas / visitas) * 100 : null,

      // Math.round porque "vende a cada 7,18 visitas" nao ajuda ninguem.
      visitasPorVenda: (temVendas && visitas > 0 && !acimaDasVisitas) ? Math.round(visitas / vendas) : null,

      // Receita bruta acumulada. E estimativa: assume que todas as vendas
      // sairam pelo preco atual, o que ignora promocoes passadas.
      receita: temVendas && preco ? vendas * preco : null,

      // O painel mostra um alerta, em vez de esconder o anuncio.
      vendasAcimaDasVisitas: acimaDasVisitas
    };
  }

  /**
   * Fica so com os numeros que tem RASTRO DE ORIGEM.
   *
   * Cada numero que o coletor grava leva junto o texto exato de onde foi lido,
   * a tela e a hora (ver trechoDaLeitura no leitura.js). Numero sem esse
   * rastro - gravado por uma versao antiga da extensao - nao tem como ser
   * conferido, e numero que nao pode ser conferido nao entra no painel.
   *
   * @param {Object|undefined} dados registro do cache
   * @returns {Object} visitas e vendas so quando provadas, mais a origem delas
   */
  function somenteComOrigem(dados) {
    const provado = { origem: {} };
    if (!dados) return provado;

    const origem = dados.origem || {};

    ["visitas", "vendas"].forEach(function (metrica) {
      if (dados[metrica] !== undefined && origem[metrica]) {
        provado[metrica] = dados[metrica];
        provado.origem[metrica] = origem[metrica];
      }
    });

    return provado;
  }

  /**
   * Escolhe, entre os codigos candidatos da pagina, o primeiro que tem numero
   * provado no cache.
   *
   * @param {string[]} codigos candidatos, na ordem de confianca
   * @param {Object} cache mlmetrics_dados
   * @returns {Object|null} codigo e provado (ver somenteComOrigem) - ou null
   */
  function escolherRegistro(codigos, cache) {
    for (let i = 0; i < codigos.length; i++) {
      const provado = somenteComOrigem(cache[codigos[i]]);

      if (provado.visitas !== undefined || provado.vendas !== undefined) {
        return { codigo: codigos[i], provado: provado };
      }
    }

    return null;
  }

  /**
   * Texto do "de onde veio" de um numero lido, para o title da linha.
   *
   * @param {Object|undefined} origem trecho, tela, em e automatica
   * @returns {string|null}
   */
  function explicarOrigem(origem) {
    if (!origem) return null;

    const quando = origem.em
      ? new Date(origem.em).toLocaleString("pt-BR")
      : "data desconhecida";

    return "Lido na tela " + (origem.tela || "?") +
      (origem.automatica ? " (busca automática)" : "") +
      ", em " + quando + ":\n" + origem.trecho;
  }

  // Publico: o content.js usa tudo, e o teste em Node cobra cada peca.
  return {
    PADRAO_CODIGO: PADRAO_CODIGO,
    DIAS_PARA_ALERTA: DIAS_PARA_ALERTA,
    codigosDaPagina: codigosDaPagina,
    precoDoJsonLd: precoDoJsonLd,
    formatarReais: formatarReais,
    formatarPercentual: formatarPercentual,
    descreverIdade: descreverIdade,
    diasDesde: diasDesde,
    calcular: calcular,
    somenteComOrigem: somenteComOrigem,
    escolherRegistro: escolherRegistro,
    explicarOrigem: explicarOrigem
  };
})();
