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
//
// As contas e os formatos (qual codigo, qual numero tem prova, conversao,
// receita, idade) moram no calculo.js, carregado antes. Aqui fica so o que
// toca a pagina: preco estruturado, painel, fechar e reagir a URL e ao
// storage.
// ============================================================================

(function () {
  "use strict";

  // Prefixo dos ids e classes do painel NA PAGINA ("mlmetrics-painel"). Nao
  // e chave de storage: o content.css usa os mesmos nomes.
  const PREFIXO = "mlmetrics";

  // Nome da chave do cache no storage - definido so no gravacao.js (CHAVES),
  // carregado antes deste arquivo.
  const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;

  // Pagina cujo painel a pessoa fechou nesta aba (a chave de chaveDaPagina).
  // Para essa pagina o painel nao volta sozinho - nem por gravacao nova no
  // cache, nem pelo poller de URL. Vive so na memoria da aba: recarregar a
  // pagina (F5) mostra o painel de novo.
  let fechadoPara = null;

  // Ultimo codigo de item achado dentro da pagina, e em qual endereco (ver
  // itemDestaPagina).
  let itemAchado = { href: null, codigo: null };

  // --------------------------------------------------------------------------
  // Leitura
  // --------------------------------------------------------------------------

  /**
   * Chave da pagina atual: os codigos candidatos juntos, ou null se a pagina
   * nao identifica anuncio nenhum. Serve para saber se a pagina mudou e para
   * lembrar qual painel foi fechado.
   *
   * @returns {string|null}
   */
  function chaveDaPagina() {
    const codigos = MLMetricsCalculo.codigosDaPagina(window.location.href);

    // Nenhum codigo na URL: nao e pagina de anuncio (home, busca, "Minhas
    // publicacoes"). Nao procuramos codigo DENTRO dela - uma tela de lista
    // tem dezenas, e o painel nao tem o que mostrar ali.
    if (codigos.length === 0) return null;

    // Em rota /up/MLBU... e /p/MLB... o codigo da URL nao e o do item, que e
    // o que o cache guarda. O do item costuma estar nos links da propria
    // pagina (ver codigoDoItemNaPagina) e, quando aparece, vem primeiro.
    const doItem = itemDestaPagina();

    return (doItem && codigos.indexOf(doItem) === -1)
      ? [doItem].concat(codigos).join("|")
      : codigos.join("|");
  }

  /**
   * O codigo do item desta pagina, guardado entre chamadas.
   *
   * O poller chama chaveDaPagina a cada segundo, e a busca percorre os links
   * da pagina. Guardar o resultado por endereco evita repetir isso o tempo
   * todo. Resultado nulo NAO e guardado: os links do ML chegam depois do
   * primeiro desenho, e a proxima chamada tenta de novo.
   *
   * @returns {string|null}
   */
  function itemDestaPagina() {
    if (itemAchado.href !== window.location.href || itemAchado.codigo === null) {
      itemAchado = {
        href: window.location.href,
        codigo: MLMetricsCalculo.codigoDoItemNaPagina(document)
      };
    }

    return itemAchado.codigo;
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
      const valor = MLMetricsCalculo.precoDoJsonLd(blocos[i].textContent);
      if (valor !== null) return valor;
    }

    return null;
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
      MLMetricsCalculo.explicarOrigem(origem.visitas)
    ));

    linhas.push(criarLinha(
      "Vendas",
      metricas.vendas !== null ? metricas.vendas.toLocaleString("pt-BR") : null,
      MLMetricsCalculo.explicarOrigem(origem.vendas)
    ));

    // As tres de baixo sao CALCULADAS, nao lidas. O title diz a conta, para
    // ninguem confundir estimativa com dado do Mercado Livre.
    linhas.push(criarLinha(
      "Conversão",
      metricas.conversao !== null ? MLMetricsCalculo.formatarPercentual(metricas.conversao) : null,
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
        MLMetricsCalculo.formatarReais(preco) + "). Não é o faturamento real: não considera " +
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
      metricas.receita !== null ? MLMetricsCalculo.formatarReais(metricas.receita) : null,
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

    if (capturadoEm && MLMetricsCalculo.diasDesde(capturadoEm) >= MLMetricsCalculo.DIAS_PARA_ALERTA) {
      rodape.className += " " + PREFIXO + "-alerta";
    }

    rodape.textContent = MLMetricsCalculo.descreverIdade(capturadoEm);
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
        const escolha = MLMetricsCalculo.escolherRegistro(chaveNoInicio.split("|"), cache);

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
        montarPainel(MLMetricsCalculo.calcular(provado, preco), idade, provado.origem, preco);
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
