// ============================================================================
// PAINEL - exibe as metricas na pagina do anuncio (Etapa 4)
//
// Nao busca dado em lugar nenhum: le o que o coletor.js guardou no
// chrome.storage e combina com o que a propria pagina do anuncio diz (preco).
//
//   coletor.js -> CAPTURA (roda nas telas de vendedor)
//   content.js -> EXIBE   (roda na pagina do anuncio)
//
// As contas e os formatos moram no calculo.js, carregado antes. Aqui fica so
// o que toca a pagina: preco estruturado, painel, fechar e reagir a URL e ao
// storage.
// ============================================================================

(function () {
  "use strict";

  // Prefixo dos ids e classes do painel NA PAGINA - o content.css usa os
  // mesmos nomes. Nao e chave de storage.
  const PREFIXO = "mlmetrics";

  const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;

  // Pagina cujo painel a pessoa fechou nesta aba (a chave de chaveDaPagina).
  // O painel dela nao volta sozinho ate o F5.
  let fechadoPara = null;

  // Ultimo codigo de item achado dentro da pagina, e em qual endereco.
  let itemAchado = { href: null, codigo: null };

  // --------------------------------------------------------------------------
  // Leitura
  // --------------------------------------------------------------------------

  /**
   * Chave da pagina atual: os codigos candidatos juntos, ou null se a pagina
   * nao identifica anuncio nenhum. Diz se a pagina mudou e qual painel foi
   * fechado.
   *
   * @returns {string|null}
   */
  function chaveDaPagina() {
    const codigos = MLMetricsCalculo.codigosDaPagina(window.location.href);

    // Sem codigo na URL nao e pagina de anuncio (home, busca, listas).
    if (codigos.length === 0) return null;

    // Em /up/ e /p/ o codigo da URL nao e o do item, que e o que o cache
    // guarda. O do item, quando achado nos links da pagina, vem primeiro.
    const doItem = itemDestaPagina();

    return (doItem && codigos.indexOf(doItem) === -1)
      ? [doItem].concat(codigos).join("|")
      : codigos.join("|");
  }

  /**
   * O codigo do item desta pagina, guardado por endereco: o poller chama
   * chaveDaPagina a cada segundo. Resultado nulo NAO e guardado - os links do
   * ML chegam depois do primeiro desenho.
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
   * Painel com o que a PROPRIA PAGINA diz, quando nao ha nada capturado.
   *
   * So em pagina de produto, e so com o "N vendido" do anuncio. Esse numero
   * NAO vai para o cache - o cache guarda so o que veio das telas de
   * vendedor. E o painel diz de onde ele saiu.
   *
   * @returns {boolean} true se montou o painel
   */
  function mostrarOQueAPaginaDiz() {
    if (!MLMetricsLeitura.ehPaginaDeCompra(window.location.href)) return false;

    const vendidos = MLMetricsLeitura.vendidosDaPagina(document);
    if (!vendidos) return false;

    const agora = Date.now();
    const origem = {
      vendas: {
        trecho: vendidos.trecho,
        tela: "esta página de produto",
        em: agora
      }
    };

    const preco = lerPreco();
    montarPainel(
      MLMetricsCalculo.calcular({
        vendas: vendidos.valor,
        vendasAproximadas: vendidos.aproximado
      }, preco),
      agora,
      origem,
      preco,
      true
    );

    return true;
  }

  /**
   * Le o preco do produto nos DADOS ESTRUTURADOS da pagina:
   *
   *   1. <meta itemprop="price" content="319.90">
   *   2. <script type="application/ld+json"> com "offers"
   *
   * Sao publicados para buscadores, por isso estaveis. O preco visivel NAO e
   * usado: aparece riscado, em parcela, "a partir de" - e a receita fica em
   * branco antes de ser calculada com o preco errado.
   *
   * @returns {number|null} preco em reais
   */
  function lerPreco() {
    const meta = document.querySelector('meta[itemprop="price"]');

    if (meta) {
      // Padrao internacional ("319.90"): parseFloat resolve direto.
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
   * Cria uma linha do painel: rotulo em cima, valor embaixo. O title mostra
   * de onde o numero veio, ou como foi calculado.
   *
   * Sempre textContent, nunca innerHTML: parte do conteudo vem da pagina.
   */
  function criarLinha(rotulo, valor, explicacao) {
    const linha = document.createElement("div");
    linha.className = PREFIXO + "-linha";

    if (explicacao) linha.title = explicacao;

    const textoRotulo = document.createElement("span");
    textoRotulo.className = PREFIXO + "-rotulo";
    textoRotulo.textContent = rotulo;

    const textoValor = document.createElement("span");
    textoValor.className = PREFIXO + "-valor";

    // Travessao quando nao ha dado: a metrica existe, o valor falta.
    textoValor.textContent = (valor === null) ? "—" : valor;

    linha.appendChild(textoRotulo);
    linha.appendChild(textoValor);
    return linha;
  }

  /**
   * Botao que fecha o painel. O anuncio fica anotado em fechadoPara: o painel
   * DELE nao volta sozinho ate o F5; outro anuncio abre normalmente.
   */
  function criarBotaoFechar(painel) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = PREFIXO + "-fechar";
    botao.title = "Fechar painel";
    botao.textContent = "×";
    botao.addEventListener("click", function () {
      // Anotar antes de remover: uma gravacao que chegue entre os dois passos
      // ja encontra o anuncio marcado como fechado.
      fechadoPara = chaveDaPagina();
      painel.remove();
    });
    return botao;
  }

  /**
   * Monta e insere o painel na pagina, no lugar do anterior - o ML e uma SPA,
   * e o painel antigo seria de outro produto.
   *
   * @param {Object} metricas resultado de calcular
   * @param {number} capturadoEm idade a exibir no rodape
   * @param {Object} origem rastro de cada numero lido (somenteComOrigem)
   * @param {number|null} preco preco lido da pagina, para explicar a receita
   * @param {boolean} [daPagina] true quando o numero foi lido AGORA da pagina
   *                  de produto, e nao capturado numa tela de vendedor
   */
  function montarPainel(metricas, capturadoEm, origem, preco, daPagina) {
    removerPainel();

    const painel = document.createElement("div");
    painel.id = PREFIXO + "-painel";

    const titulo = document.createElement("div");
    titulo.className = PREFIXO + "-titulo";
    titulo.textContent = "ML Metrics";
    painel.appendChild(criarBotaoFechar(painel));
    painel.appendChild(titulo);

    const linhas = [];

    // "Visitas", e nao "Visitas totais": nada garante que a tela lida
    // mostrava o total, e nao um recorte de periodo.
    linhas.push(criarLinha(
      "Visitas",
      metricas.visitas !== null ? metricas.visitas.toLocaleString("pt-BR") : null,
      MLMetricsCalculo.explicarOrigem(origem.visitas)
    ));

    // "+25 vendidos" quer dizer "mais de 25": o "+" fica, senao o piso vira
    // numero exato aos olhos de quem le.
    const vendasEscritas = metricas.vendas !== null
      ? (metricas.vendasAproximadas ? "+" : "") + metricas.vendas.toLocaleString("pt-BR")
      : null;

    linhas.push(criarLinha(
      "Vendas",
      vendasEscritas,
      metricas.vendasAproximadas
        ? "O Mercado Livre arredonda esse número nesta página: o total real é " +
          "maior que " + metricas.vendas.toLocaleString("pt-BR") + ".\n" +
          MLMetricsCalculo.explicarOrigem(origem.vendas)
        : MLMetricsCalculo.explicarOrigem(origem.vendas)
    ));

    // As tres de baixo sao CALCULADAS: o title diz a conta, para ninguem
    // confundir estimativa com dado do Mercado Livre.
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
      explicacaoReceita = (metricas.vendasAproximadas
        ? "Piso: o número de vendas desta página é arredondado, então a receita " +
          "real é maior. Conta: vendas × preço atual ("
        : "Estimativa: vendas × preço atual desta página (") +
        MLMetricsCalculo.formatarReais(preco) + "). Não é o faturamento real: não considera " +
        "promoções, variações nem mudanças de preço.";
    } else if (metricas.vendas && !preco) {
      // Sem preco confiavel o traco precisa dizer por que, senao parece defeito.
      explicacaoReceita = "Sem estimativa: esta página não informa o preço " +
        "nos dados estruturados, e o preço visível pode ser parcela ou " +
        "valor riscado.";
    }

    linhas.push(criarLinha(
      "Receita estimada",
      metricas.receita !== null
        ? (metricas.vendasAproximadas ? "a partir de " : "") +
          MLMetricsCalculo.formatarReais(metricas.receita)
        : null,
      explicacaoReceita
    ));

    linhas.forEach(function (linha) {
      painel.appendChild(linha);
    });

    // A ultima linha nao ganha divisor: o rodape ja separa. Marcada por JS
    // porque last-of-type contaria o rodape, que tambem e div.
    linhas[linhas.length - 1].className += " " + PREFIXO + "-ultima";

    // Vendas acima das visitas (#40): o painel avisa em vez de esconder.
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

    // Numero lido da propria pagina e de agora, e precisa dizer de onde veio
    // - a mesma pagina mostra numeros do VENDEDOR logo ao lado.
    rodape.textContent = daPagina
      ? "Lido desta página de produto, agora."
      : MLMetricsCalculo.descreverIdade(capturadoEm);
    painel.appendChild(rodape);

    if (daPagina) {
      const aviso = document.createElement("div");
      aviso.className = PREFIXO + "-dica";
      aviso.textContent = "As visitas não aparecem em página de produto: " +
        "o Mercado Livre só mostra isso para quem é dono do anúncio.";
      painel.appendChild(aviso);
    }

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
   * Decide o que mostrar na tela atual. Cada chamada substitui o painel
   * anterior.
   */
  function atualizar() {
    // A leitura do storage e assincrona: se a URL mudar ate o callback
    // voltar, o painel do anuncio A desenharia sobre a pagina de B. Por isso
    // a chave e guardada agora e conferida la.
    const chaveNoInicio = chaveDaPagina();

    if (!chaveNoInicio) {
      removerPainel();
      return;
    }

    if (chaveNoInicio === fechadoPara) return;

    try {
      chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
        if (chrome.runtime.lastError) return;

        if (chaveDaPagina() !== chaveNoInicio) return;
        if (chaveNoInicio === fechadoPara) return;

        const cache = guardado[CHAVE_CACHE] || {};

        // O primeiro candidato da pagina com numero COM rastro de origem.
        const escolha = MLMetricsCalculo.escolherRegistro(chaveNoInicio.split("|"), cache);

        if (!escolha) {
          // Sem dado capturado: em pagina de produto ainda da para mostrar o
          // "N vendido" dela. Fora isso, nenhum painel (nao existe painel
          // "Sem dados", #46) - e um painel antigo sai, como depois de
          // "Limpar dados guardados".
          if (!mostrarOQueAPaginaDiz()) removerPainel();
          return;
        }

        const provado = escolha.provado;

        // A idade exibida e a da leitura MAIS ANTIGA do painel: visitas de
        // hoje com vendas de 10 dias atras e dado de 10 dias.
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

  // O ML e uma SPA: trocar de produto muda a URL sem recarregar a pagina.
  // Nao ha evento bom para isso num content script - "popstate" so vem do
  // botao voltar, e sobrescrever history.pushState nao alcanca a pagina
  // (mundo isolado). Comparar a URL uma vez por segundo custa quase nada.
  let urlAnterior = window.location.href;

  const poller = setInterval(function () {
    // Extensao recarregada: script orfao. Para o poller e tira o painel -
    // numero de uma versao que ja nao roda nao fica na tela.
    if (!MLMetricsGravacao.extensaoViva()) {
      clearInterval(poller);
      removerPainel();
      return;
    }

    if (window.location.href === urlAnterior) return;

    urlAnterior = window.location.href;

    // A URL muda antes do conteudo novo chegar, e o preco precisa ser o do
    // produto NOVO.
    setTimeout(atualizar, 500);
  }, 1000);

  // Captura nova do anuncio da tela atualiza o painel na hora, sem F5.
  try {
    chrome.storage.onChanged.addListener(function (mudancas, area) {
      if (area !== "local") return;
      if (!mudancas[CHAVE_CACHE]) return;

      // Qualquer gravacao no cache dispara isto (outra aba, outro anuncio,
      // renovacao da data). Remontar a cada uma fazia o painel piscar e
      // voltar depois de fechado: so reagimos quando o registro de algum
      // candidato DESTA pagina mudou de verdade.
      const chave = chaveDaPagina();
      if (!chave) return;

      const antes = mudancas[CHAVE_CACHE].oldValue || {};
      const depois = mudancas[CHAVE_CACHE].newValue || {};

      // JSON.stringify compara conteudo: objetos lidos do storage nunca sao
      // o mesmo objeto.
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
