// ============================================================================
// CALCULO - o que o painel mostra, sem tocar na pagina
//
// Qual codigo identifica o anuncio da URL, quais numeros tem prova de origem,
// as contas (conversao, "vende a cada", receita) e os formatos (moeda,
// percentual, idade do dado). Tudo puro: recebe valores por parametro, nao le
// chrome.storage - por isso o teste em Node carrega o arquivo como ele e.
//
// Depende do leitura.js e e carregado antes do content.js (ver manifest).
// ============================================================================

var MLMetricsCalculo = (function () {
  "use strict";

  // O formato do codigo de anuncio e um so, definido no leitura.js.
  const PADRAO_CODIGO = MLMetricsLeitura.PADRAO_CODIGO;

  // A partir de quantos dias o dado passa a ser exibido como suspeito: curto
  // o bastante para um anuncio ativo nao parecer parado, longo o bastante
  // para um fim de semana nao alarmar.
  const DIAS_PARA_ALERTA = 3;

  // --------------------------------------------------------------------------
  // Codigo e preco
  // --------------------------------------------------------------------------

  /**
   * Codigos que podem identificar o anuncio desta pagina, do mais confiavel
   * para o menos.
   *
   * O cache guarda o codigo do ITEM. Na vitrine, o caminho traz o de
   * catalogo (/p/) ou de user product (/up/), e o do item vem nos parametros
   * (pdp_filters=item_id:MLB..., item_id=MLB..., wid=MLB...). So esses
   * parametros contam: um MLB em "?search=MLB..." poria painel onde nao deve.
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
      return null;
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

  // Para valer como "o item desta pagina", o codigo precisa aparecer em pelo
  // menos 3 links e no triplo do segundo colocado. Nas paginas reais salvas,
  // o item aparece 24 vezes e cada produto recomendado, 1.
  const MINIMO_DE_LINKS = 3;
  const VANTAGEM_SOBRE_O_SEGUNDO = 3;

  // Teto de links olhados (pagina real tem ~340), so contra pagina fora do comum.
  const MAX_LINKS = 2000;

  /**
   * Procura, DENTRO da pagina, o codigo do ITEM que ela esta mostrando.
   *
   * Numa URL como /kit-2-caixa.../up/MLBU0000000001?pdp_filters=seller_id%3A123
   * nao existe codigo de item, e o cache so tem o do item. Mas os links da
   * propria pagina carregam "item_id:MLB..." e "wid=MLB...". Como ela tambem
   * linka outros produtos, a regra e por dominancia; sem vencedor claro,
   * devolve null.
   *
   * @param {Document} doc
   * @returns {string|null}
   */
  function codigoDoItemNaPagina(doc) {
    const links = doc.querySelectorAll("a[href]");
    const vezes = {};

    for (let i = 0; i < links.length && i < MAX_LINKS; i++) {
      const href = links[i].getAttribute("href") || "";

      // O ML codifica esses parametros, as vezes duas vezes ("%253A").
      // Trocar so o que interessa evita o decodeURIComponent, que estoura
      // com "%" solto no endereco.
      const limpo = href.replace(/%253A|%3A/gi, ":").replace(/%26/gi, "&");
      const achados = limpo.match(/(item_id[:=]|wid=)MLB[A-Z]?\d{6,}/gi) || [];

      achados.forEach(function (achado) {
        const codigo = achado.match(/MLB[A-Z]?\d{6,}/i)[0];
        vezes[codigo] = (vezes[codigo] || 0) + 1;
      });
    }

    const ordenados = Object.keys(vezes).sort(function (a, b) {
      return vezes[b] - vezes[a];
    });

    if (ordenados.length === 0) return null;

    const campeao = ordenados[0];
    const segundo = ordenados.length > 1 ? vezes[ordenados[1]] : 0;

    if (vezes[campeao] < MINIMO_DE_LINKS) return null;
    if (segundo > 0 && vezes[campeao] < segundo * VANTAGEM_SOBRE_O_SEGUNDO) return null;

    return campeao;
  }

  // --------------------------------------------------------------------------
  // Formatacao
  // --------------------------------------------------------------------------

  /**
   * Formata um numero como moeda brasileira.
   */
  function formatarReais(valor) {
    return valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  /**
   * Formata percentual como no ML: "13,9%", com virgula.
   */
  function formatarPercentual(valor) {
    return valor.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }) + "%";
  }

  /**
   * Idade legivel da captura: "atualizado hoje", "há 3 dias". Numero nunca
   * aparece sem idade: dado velho com cara de novo leva a decisao errada.
   */
  function descreverIdade(timestamp) {
    if (!timestamp) return "origem desconhecida";

    const dias = diasDesde(timestamp);

    if (dias <= 0) return "atualizado hoje";
    if (dias === 1) return "atualizado ontem";

    if (dias >= DIAS_PARA_ALERTA) {
      return "dados de " + dias + " dias atrás — abra \"Minhas publicações\" " +
             "para atualizar";
    }

    return "atualizado há " + dias + " dias";
  }

  /**
   * Quantos dias de CALENDARIO separam a data da captura de hoje.
   *
   * Compara a meia-noite de cada data (blocos de 24h diziam "hoje" para uma
   * leitura de ontem a noite); o Math.round absorve o horario de verao.
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
   * Metrica sem os dados que exige vira null, nunca zero: zero e uma
   * afirmacao ("converteu 0%"), null e "nao sei".
   *
   * @param {Object} dados { visitas, vendas, vendasAproximadas }
   * @param {number|null} preco lido da pagina
   */
  function calcular(dados, preco) {
    const visitas = dados.visitas;
    const vendas = dados.vendas;

    // 500 visitas e 0 vendas PRECISA mostrar "0%" - por isso "definido", e
    // nao "maior que zero".
    const temAmbos = (visitas !== undefined && vendas !== undefined);

    // "Vende a cada" e receita dividem por vendas: exigem vendas > 0.
    const temVendas = (vendas !== undefined && vendas > 0);

    // Vendas acima das visitas (#40): os numeros valem, mas taxa e "vende a
    // cada" dariam conversao acima de 100% e "a cada 0 visitas".
    const acimaDasVisitas = temAmbos && vendas > visitas;

    return {
      visitas: (visitas !== undefined) ? visitas : null,
      vendas: (vendas !== undefined) ? vendas : null,

      // Sem visitas nao existe taxa: daria "NaN%" ou "Infinity%".
      conversao: (temAmbos && visitas > 0 && !acimaDasVisitas) ? (vendas / visitas) * 100 : null,

      visitasPorVenda: (temVendas && visitas > 0 && !acimaDasVisitas) ? Math.round(visitas / vendas) : null,

      // Estimativa: assume que todas as vendas sairam pelo preco atual.
      receita: temVendas && preco ? vendas * preco : null,

      vendasAcimaDasVisitas: acimaDasVisitas,

      // "+25 vendidos" da pagina de produto: o numero e PISO, nao total.
      vendasAproximadas: Boolean(dados.vendasAproximadas)
    };
  }

  /**
   * Fica so com os numeros que tem RASTRO DE ORIGEM. Numero sem rastro
   * (gravado por versao antiga) nao pode ser conferido e nao entra no painel.
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
   * O primeiro codigo candidato da pagina que tem numero provado no cache.
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
   * Texto do "de onde veio" de um numero, para o title da linha do painel.
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

  return {
    DIAS_PARA_ALERTA: DIAS_PARA_ALERTA,
    codigosDaPagina: codigosDaPagina,
    codigoDoItemNaPagina: codigoDoItemNaPagina,
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
