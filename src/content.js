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

  // Pagina cujo painel a pessoa fechou nesta aba (a chave de chaveDaPagina).
  // Para essa pagina o painel nao volta sozinho - nem por gravacao nova no
  // cache, nem pelo poller de URL. Vive so na memoria da aba: recarregar a
  // pagina (F5) mostra o painel de novo.
  let fechadoPara = null;

  // --------------------------------------------------------------------------
  // Leitura
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
   * Chave da pagina atual: os codigos candidatos juntos, ou null se a pagina
   * nao identifica anuncio nenhum. Serve para saber se a pagina mudou e para
   * lembrar qual painel foi fechado.
   *
   * @returns {string|null}
   */
  function chaveDaPagina() {
    const codigos = codigosDaPagina(window.location.href);
    return codigos.length > 0 ? codigos.join("|") : null;
  }

  /**
   * Tira o painel da tela, se houver.
   */
  function removerPainel() {
    const anterior = document.getElementById(PREFIXO + "-painel");
    if (anterior) anterior.remove();
  }

  /**
   * Diz se a extensao ainda esta viva para este script.
   *
   * Mesma regra do coletor.js: extensao recarregada deixa o script das abas
   * abertas orfao, e o sinal e o chrome.runtime.id sumir.
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

  /**
   * Le o preco do produto nos DADOS ESTRUTURADOS da pagina.
   *
   * Duas fontes, as duas publicadas pelo ML para buscadores (Google Shopping
   * etc.) - por isso estaveis, ja que quebra-las prejudicaria o SEO do
   * proprio ML:
   *
   *   1. <meta itemprop="price" content="319.90">
   *   2. <script type="application/ld+json"> com "offers": o preco
   *
   * O preco do componente visual (".andes-money-amount") NAO e mais usado.
   * Na tela ele aparece varias vezes - riscado, parcela, "a partir de" - e
   * qualquer heuristica para escolher um pode pegar o errado. Como o preco
   * so serve para a RECEITA ESTIMADA, e melhor ela ficar em branco do que
   * mostrar uma conta feita com o preco errado.
   *
   * @returns {number|null} preco em reais
   */
  function lerPreco() {
    const meta = document.querySelector('meta[itemprop="price"]');

    if (meta) {
      // Em dado estruturado o preco vem no padrao internacional
      // ("319.90", ponto decimal), entao parseFloat resolve direto.
      const valor = parseFloat(meta.getAttribute("content"));
      if (valor > 0) return valor;
    }

    const blocos = document.querySelectorAll('script[type="application/ld+json"]');

    for (let i = 0; i < blocos.length; i++) {
      const valor = precoDoJsonLd(blocos[i].textContent);
      if (valor !== null) return valor;
    }

    return null;
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
   * a tela e a hora (ver trechoDaLeitura no coletor.js). Numero sem esse
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
  function criarLinha(rotulo, valor, explicacao) {
    const linha = document.createElement("div");
    linha.className = PREFIXO + "-linha";

    // Passar o mouse sobre a linha mostra DE ONDE o numero veio, ou como ele
    // foi calculado. E o que permite conferir o painel contra a tela do ML.
    if (explicacao) linha.title = explicacao;

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
   * Botao que fecha o painel.
   *
   * O painel e fixo na tela e nao faz parte do layout do ML; sem como fecha-lo
   * e preciso recarregar a pagina para faze-lo sumir. O botao remove o painel
   * e anota o anuncio em fechadoPara: enquanto a aba nao for recarregada, o
   * painel DAQUELE anuncio nao volta sozinho. Outro anuncio abre normalmente.
   */
  function criarBotaoFechar(painel) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = PREFIXO + "-fechar";
    botao.title = "Fechar painel";
    botao.textContent = "×";
    botao.addEventListener("click", function () {
      // Anotar antes de remover: uma gravacao no cache que chegue entre os
      // dois passos ja encontra o anuncio marcado como fechado.
      fechadoPara = chaveDaPagina();
      painel.remove();
    });
    return botao;
  }

  /**
   * Monta e insere o painel na pagina.
   *
   * @param {Object} metricas resultado de calcular
   * @param {number} capturadoEm idade a exibir no rodape
   * @param {Object} origem rastro de cada numero lido (somenteComOrigem)
   * @param {number|null} preco preco lido da pagina, para explicar a receita
   */
  function montarPainel(metricas, capturadoEm, origem, preco) {
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
    painel.appendChild(criarBotaoFechar(painel));
    painel.appendChild(titulo);

    // A ultima linha vem seguida do rodape de status. Sem isto, uma borda
    // solta de divisor fica fazendo par entre a ultima metrica e o rodape.
    const linhas = [];

    // "Visitas", e nao "Visitas totais": nada garante que a tela lida mostrava
    // o total, e nao o recorte de um periodo (7, 30 dias). O rastro no title
    // mostra o texto exato - la da para ver se era total ou recorte.
    linhas.push(criarLinha(
      "Visitas",
      metricas.visitas !== null ? metricas.visitas.toLocaleString("pt-BR") : null,
      explicarOrigem(origem.visitas)
    ));

    linhas.push(criarLinha(
      "Vendas",
      metricas.vendas !== null ? metricas.vendas.toLocaleString("pt-BR") : null,
      explicarOrigem(origem.vendas)
    ));

    // As tres de baixo sao CALCULADAS, nao lidas. O title diz a conta, para
    // ninguem confundir estimativa com dado do Mercado Livre.
    linhas.push(criarLinha(
      "Conversão",
      metricas.conversao !== null ? formatarPercentual(metricas.conversao) : null,
      metricas.conversao !== null
        ? "Calculado: vendas ÷ visitas × 100."
        : (metricas.vendasAcimaDasVisitas ? "Sem taxa: vendas acima das visitas." : null)
    ));

    linhas.push(criarLinha(
      "Vende a cada",
      metricas.visitasPorVenda !== null ? metricas.visitasPorVenda + " visitas" : null,
      metricas.visitasPorVenda !== null ? "Calculado: visitas ÷ vendas, arredondado." : null
    ));

    let explicacaoReceita = null;

    if (metricas.receita !== null) {
      explicacaoReceita = "Estimativa: vendas × preço atual desta página (" +
        formatarReais(preco) + "). Não é o faturamento real: não considera " +
        "promoções, variações nem mudanças de preço.";
    } else if (metricas.vendas && !preco) {
      // Sem preco confiavel a conta nao e feita - e o traco precisa dizer
      // por que, senao parece defeito.
      explicacaoReceita = "Sem estimativa: esta página não informa o preço " +
        "nos dados estruturados, e o preço visível pode ser parcela ou " +
        "valor riscado.";
    }

    linhas.push(criarLinha(
      "Receita estimada",
      metricas.receita !== null ? formatarReais(metricas.receita) : null,
      explicacaoReceita
    ));

    linhas.forEach(function (linha) {
      painel.appendChild(linha);
    });

    // A ultima linha nao ganha divisor embaixo: o rodape ja separa do mundo.
    // A marca (PREFIXO "-ultima") e aplicada por JS porque CSS nao sabe, de
    // forma confiavel, "a ultima linha do grupo": last-of-type contaria as
    // DIVs e o rodape e uma div tambem.
    linhas[linhas.length - 1].className += " " + PREFIXO + "-ultima";

    // Vendas acima das visitas: os numeros sao os que a tela mostrou, e o
    // painel avisa em vez de esconder (#40). Antes o anuncio inteiro era
    // descartado em silencio - justo o que vende em quantidade.
    if (metricas.vendasAcimaDasVisitas) {
      const alerta = document.createElement("div");
      alerta.className = PREFIXO + "-status " + PREFIXO + "-alerta";
      alerta.textContent = "Vendas acima das visitas: pode ser venda de várias " +
        "unidades para o mesmo comprador. Confira no Mercado Livre.";
      painel.appendChild(alerta);
    }

    const rodape = document.createElement("div");
    rodape.className = PREFIXO + "-status";

    if (capturadoEm && diasDesde(capturadoEm) >= DIAS_PARA_ALERTA) {
      rodape.className += " " + PREFIXO + "-alerta";
    }

    rodape.textContent = descreverIdade(capturadoEm);
    painel.appendChild(rodape);

    // Sem esta dica ninguem descobre que passar o mouse mostra a origem.
    const dica = document.createElement("div");
    dica.className = PREFIXO + "-dica";
    dica.textContent = "Passe o mouse sobre um número para ver de onde ele veio.";
    painel.appendChild(dica);

    document.body.appendChild(painel);
  }

  // --------------------------------------------------------------------------
  // Ponto de entrada
  // --------------------------------------------------------------------------

  /**
   * Decide o que mostrar na tela atual. Pode ser chamada quantas vezes for
   * preciso - cada chamada substitui o painel anterior.
   */
  function atualizar() {
    // Guardamos a chave da pagina no momento da chamada. A leitura do
    // storage e assincrona, e navegar rapido entre anuncios pode fazer o
    // callback voltar depois que a URL ja mudou de novo (condicao de
    // corrida). Sem esta conferencia, o painel do anuncio A desenharia sobre
    // a pagina de B. Se a URL mudou, a proxima chamada do poller resolve.
    const chaveNoInicio = chaveDaPagina();

    // Saiu de uma pagina de anuncio (foi para a home, busca, carrinho).
    // Tiramos o painel: melhor nada do que numeros de outro produto.
    if (!chaveNoInicio) {
      removerPainel();
      return;
    }

    // A pessoa fechou o painel desta pagina: respeitamos (ver fechadoPara).
    if (chaveNoInicio === fechadoPara) return;

    // chrome.storage e assincrono: devolve por callback, nao por retorno.
    // Toda a montagem do painel acontece dentro dele, ja com o dado em maos.
    try {
      chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
        if (chrome.runtime.lastError) return;  // contexto invalidado

        // A pagina mudou enquanto o storage respondia, ou a pessoa fechou o
        // painel nesse meio tempo: nada a fazer aqui.
        if (chaveDaPagina() !== chaveNoInicio) return;
        if (chaveNoInicio === fechadoPara) return;

        const cache = guardado[CHAVE_CACHE] || {};

        // O primeiro candidato da pagina (ver codigosDaPagina) com numero COM
        // rastro de origem. Registro de versao antiga, sem rastro, conta como
        // "sem dado" (ver somenteComOrigem).
        const escolha = escolherRegistro(chaveNoInicio.split("|"), cache);

        if (!escolha) {
          // Sem dado conferivel deste anuncio: nenhum painel. Um painel com
          // numeros que ainda esteja na tela sai - e o que acontece logo
          // depois de "Limpar dados guardados", quando o cache inteiro some.
          //
          // Nao existe mais o painel "Sem dados" (#46). Ele aparecia em TODO
          // anuncio aberto - inclusive de outros vendedores, que nunca vao ter
          // dado - com uma instrucao que nao resolvia nada. A dica de abrir
          // "Minhas publicacoes" ficou no popup.
          removerPainel();
          return;
        }

        const provado = escolha.provado;

        // A idade exibida e a da leitura MAIS ANTIGA entre os numeros do
        // painel. Se as visitas foram lidas hoje e as vendas ha 10 dias, o
        // painel precisa dizer 10 dias - nao "hoje".
        const datas = Object.keys(provado.origem)
          .map(function (metrica) { return provado.origem[metrica].em; })
          .filter(Boolean);
        const idade = datas.length > 0
          ? Math.min.apply(null, datas)
          : cache[escolha.codigo].capturadoEm;

        const preco = lerPreco();
        montarPainel(calcular(provado, preco), idade, provado.origem, preco);
      });
    } catch (e) {
      // contexto invalidado: o painel antigo sai, a proxima leitura tenta.
      removerPainel();
    }
  }

  atualizar();

  // O Mercado Livre e uma SPA: clicar de um produto para outro troca o
  // conteudo e a URL sem recarregar a pagina. Este script nao roda de novo
  // sozinho, entao sem isto o painel ficaria exibindo o produto anterior.
  //
  // Por que verificar a URL periodicamente em vez de escutar um evento?
  // Porque nao existe evento bom para isso aqui. "popstate" so dispara no
  // botao voltar, nao em navegacao normal. E sobrescrever history.pushState
  // nao funciona: content scripts rodam num mundo isolado, com uma copia
  // propria de window - a pagina continuaria usando a versao original dela.
  //
  // Comparar uma string uma vez por segundo custa praticamente nada, e e a
  // solucao que nao depende de detalhe interno do site.
  let urlAnterior = window.location.href;

  const poller = setInterval(function () {
    // Extensao recarregada: este script ficou orfao (ver extensaoViva).
    // Paramos o poller e tiramos o painel - numero de uma versao que ja nao
    // roda nao deve ficar na tela. A versao nova entra no F5 da pagina.
    if (!extensaoViva()) {
      clearInterval(poller);
      const anterior = document.getElementById(PREFIXO + "-painel");
      if (anterior) anterior.remove();
      return;
    }

    if (window.location.href === urlAnterior) return;

    urlAnterior = window.location.href;

    // Pequena espera: a URL muda antes do conteudo novo terminar de chegar,
    // e precisamos do preco do produto NOVO, nao do que ainda esta na tela.
    setTimeout(atualizar, 500);
  }, 1000);

  // Reage a captura em tempo real: quando o coletor grava dados novos para o
  // anuncio que esta na tela, o painel atualiza sozinho, sem esperar o poller
  // de URL ou um navegar. Sem este listener o vendedor teria de recarregar a
  // pagina para ver numeros que ja foram capturados ha segundos.
  try {
    chrome.storage.onChanged.addListener(function (mudancas, area) {
      // area "local" = chrome.storage.local; sync nao e usada por nos.
      if (area !== "local") return;
      if (!mudancas[CHAVE_CACHE]) return;

      // Qualquer gravacao no cache dispara este evento: de outra aba, de
      // outro anuncio, ou so a renovacao periodica da data. Remontar o painel
      // a cada uma fazia ele piscar - e voltar depois de fechado. So reagimos
      // quando o registro DO ANUNCIO DA TELA mudou de verdade.
      const chave = chaveDaPagina();
      if (!chave) return;

      const antes = mudancas[CHAVE_CACHE].oldValue || {};
      const depois = mudancas[CHAVE_CACHE].newValue || {};

      // JSON.stringify compara o conteudo: objetos lidos do storage nunca sao
      // o mesmo objeto, entao === diria sempre "diferente". Olhamos TODOS os
      // candidatos da pagina - o dado pode ter chegado para qualquer um deles.
      const mudouAlgum = chave.split("|").some(function (codigo) {
        return JSON.stringify(antes[codigo]) !== JSON.stringify(depois[codigo]);
      });
      if (!mudouAlgum) return;

      atualizar();
    });
  } catch (e) {
    // contexto invalidado: sem reacao em tempo real, o poller de URL cobre.
  }
})();
