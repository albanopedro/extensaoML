// ============================================================================
// COLETOR - captura metricas nas paginas de vendedor (Etapa 3)
//
// Roda em TODA pagina do Mercado Livre, mas so age quando encontra numeros
// de visitas - o que na pratica acontece nas telas de vendedor
// ("Minhas publicacoes", metricas do anuncio, etc).
//
// ESTRATEGIA: nao usamos seletores CSS fixos (tipo ".andes-card span").
// Seletores assim quebram no primeiro redesenho de layout, e nem sabemos
// como e o HTML dessas telas. Em vez disso procuramos pelo SIGNIFICADO:
// achamos a palavra "visitas" no texto e pegamos o numero mais proximo.
// E mais resistente a mudancas do site.
//
// O que for capturado vai para chrome.storage.local, de onde o content.js
// vai ler depois para montar os badges na pagina do anuncio.
// ============================================================================

(function () {
  "use strict";

  // Chave usada dentro do chrome.storage.local. Tudo da extensao fica
  // agrupado embaixo dela para nao espalhar dados soltos.
  const CHAVE_CACHE = "mlmetrics_dados";

  // Ate quantos niveis subir no DOM procurando o codigo do anuncio.
  // 12 e folgado o suficiente para atravessar a arvore de um card de lista
  // sem sair varrendo a pagina inteira.
  const MAX_NIVEIS = 12;

  // Metricas que sabemos capturar, e as palavras que as denunciam no texto.
  //
  // Sao varias palavras por metrica porque o ML nao e consistente: a mesma
  // informacao aparece como "vendas", "vendidos" ou "vendas concretizadas"
  // dependendo da tela. Repare que "vendido" NAO contem "venda" - por isso
  // precisam ser termos separados, e nao um prefixo curto como "vend"
  // (que pegaria "Vender um igual" e sujaria o resultado).
  const ROTULOS = {
    visitas: ["visita"],
    vendas: ["venda", "vendido"]
  };

  // --------------------------------------------------------------------------
  // Utilitarios de leitura
  // --------------------------------------------------------------------------

  /**
   * Converte um texto de numero brasileiro para inteiro.
   *
   * "1.234" no Brasil significa mil duzentos e trinta e quatro: o ponto e
   * separador de MILHAR e precisa sumir antes de converter.
   *
   * @param {string} bruto ex: "1.234"
   * @returns {number|null}
   */
  function paraInteiro(bruto) {
    // split(".").join("") remove TODOS os pontos, nao so o primeiro.
    const numero = parseInt(bruto.split(".").join(""), 10);

    // parseInt devolve NaN quando nao consegue converter.
    return isNaN(numero) ? null : numero;
  }

  /**
   * Pega o numero que aparece ANTES de uma palavra no texto.
   *
   * Por que "antes" e nao simplesmente "o primeiro numero"?
   * Porque em portugues o valor precede o rotulo, enquanto numeros que vem
   * DEPOIS do rotulo costumam descrever o recorte, nao o valor:
   *
   *   "359 visitas totais"              -> 359 e o valor        (antes)
   *   "Visitas nos ultimos 30 dias"     -> 30 e o periodo!      (depois)
   *
   * Pegar o primeiro numero do texto capturaria 30 no segundo caso, que
   * esta errado. Exigir que venha antes elimina essa classe de engano.
   *
   * Quando ha varios numeros antes, ficamos com o ULTIMO - e o mais
   * proximo do rotulo, entao o mais provavel de ser o valor dele.
   *
   * @param {string} texto
   * @param {string} palavra rotulo procurado, em minusculo
   * @returns {number|null}
   */
  function numeroAntesDe(texto, palavra) {
    if (!texto) return null;

    const posicao = texto.toLowerCase().indexOf(palavra);
    if (posicao === -1) return null;

    // Primeiro tentamos antes do rotulo, que e a ordem natural em portugues.
    const antes = ultimoNumeroColado(texto.slice(0, posicao));
    if (antes !== null) return antes;

    // Se nao achou, tentamos depois - cobre "Visitas: 359".
    //
    // Antes disso removemos as letras que sobraram da propria palavra: o
    // rotulo procurado e "visita", mas o texto diz "visitas", entao o "s"
    // ficaria no caminho e seria lido como palavra estranha.
    const depois = texto
      .slice(posicao + palavra.length)
      .replace(/^[a-zA-ZÀ-ú]+/, "");

    return primeiroNumeroColado(depois);
  }

  /**
   * Ultimo numero de um trecho, DESDE QUE ele esteja colado no fim.
   *
   * "Colado" aqui significa: entre o numero e o fim do trecho so pode haver
   * espaco e pontuacao, nunca letras. E o que separa rotulo de prosa:
   *
   *   "359 visitas"                          -> vao " "        vale
   *   "1.234\n   visitas"                    -> vao branco     vale
   *   "R$ 15.995,00Os rotulos... 'visitas'"  -> vao com texto  NAO vale
   *
   * Sem esta regra, a funcao atravessa frases inteiras atras de um numero
   * qualquer e cola ele no rotulo errado. Foi assim que uma legenda acabou
   * virando metrica de anuncio.
   *
   * @param {string} trecho
   * @returns {number|null}
   */
  function ultimoNumeroColado(trecho) {
    // matchAll devolve cada ocorrencia COM a posicao onde ela comeca -
    // e a posicao que permite medir o vao ate o rotulo.
    const numeros = Array.from(trecho.matchAll(/\d[\d.]*/g));
    if (numeros.length === 0) return null;

    const ultimo = numeros[numeros.length - 1];
    const vao = trecho.slice(ultimo.index + ultimo[0].length);

    if (temLetra(vao)) return null;

    return paraInteiro(ultimo[0]);
  }

  /**
   * Primeiro numero de um trecho, DESDE QUE colado no comeco.
   * Mesma regra do anterior, na direcao oposta.
   *
   * @param {string} trecho
   * @returns {number|null}
   */
  function primeiroNumeroColado(trecho) {
    const encontrado = trecho.match(/\d[\d.]*/);
    if (!encontrado) return null;

    const vao = trecho.slice(0, encontrado.index);

    if (temLetra(vao)) return null;

    return paraInteiro(encontrado[0]);
  }

  /**
   * Diz se ha alguma letra no texto. O intervalo À-ú cobre os acentos
   * do portugues, senao "visitas nos últimos" passaria como se nao
   * tivesse letras entre o numero e o rotulo.
   */
  function temLetra(texto) {
    return /[a-zA-ZÀ-ú]/.test(texto);
  }

  /**
   * Procura o codigo do anuncio (MLB...) a partir de um elemento.
   *
   * Numa lista de publicacoes cada card tem um link para o anuncio, entao
   * subimos pelos ancestrais e, em cada nivel, procuramos um link com MLB
   * no endereco. Paramos no primeiro que achar.
   *
   * @param {Element} elemento ponto de partida
   * @returns {string|null}
   */
  function contextoDoAnuncio(elemento) {
    // Caso mais facil: a propria URL da pagina ja identifica o anuncio.
    // Vale quando estamos na tela de metricas de UM anuncio especifico -
    // ali a pagina inteira fala de um produto so, entao o limite e o body.
    const naUrl = window.location.href.match(/MLB-?(\d{6,})/);
    if (naUrl) {
      return { codigo: "MLB" + naUrl[1], limite: document.body };
    }

    let atual = elemento;

    for (let nivel = 0; nivel < MAX_NIVEIS && atual; nivel++) {
      // querySelectorAll so existe em Element (nao em nos de texto),
      // por isso a checagem antes de chamar.
      if (atual.querySelectorAll) {
        const codigos = codigosDentroDe(atual);

        // Exatamente um anuncio aqui dentro: nao ha ambiguidade, e dele.
        // Este elemento tambem vira o LIMITE da busca pelo valor: tudo que
        // pertence a este anuncio esta aqui dentro, e o que esta fora e de
        // outro. Amarrar as duas buscas na mesma fronteira impede que um
        // anuncio herde o numero do vizinho.
        if (codigos.length === 1) {
          return { codigo: codigos[0], limite: atual };
        }

        // Mais de um: subimos demais e ja estamos num container que
        // abraca varios cards. O rotulo que disparou a busca pertence a
        // UM deles, e nao temos como saber qual - entao desistimos.
        //
        // Desistir e melhor que chutar o primeiro: um numero atribuido ao
        // anuncio errado e pior do que numero nenhum, porque nao tem como
        // a vendedora perceber que esta errado.
        if (codigos.length > 1) return null;
      }

      atual = atual.parentElement;
    }

    return null;
  }

  /**
   * Lista os codigos de anuncio distintos que aparecem dentro de um elemento.
   *
   * @param {Element} elemento
   * @returns {string[]}
   */
  function codigosDentroDe(elemento) {
    const links = elemento.querySelectorAll('a[href*="MLB"]');
    const encontrados = [];

    for (let i = 0; i < links.length; i++) {
      const achado = links[i].getAttribute("href").match(/MLB-?(\d{6,})/);
      if (!achado) continue;

      const codigo = "MLB" + achado[1];

      // O mesmo anuncio costuma ter varios links no card (a foto, o titulo,
      // o botao). Contam como um so - por isso guardamos apenas os distintos.
      if (encontrados.indexOf(codigo) === -1) {
        encontrados.push(codigo);
      }
    }

    return encontrados;
  }

  /**
   * Dado o elemento que contem o rotulo, encontra o valor correspondente.
   *
   * O numero nem sempre mora junto do rotulo. Estes tres formatos sao todos
   * plausiveis e aparecem no banco de teste:
   *
   *   <span>359 visitas</span>                    -> junto
   *   <span>1.234</span><span>visitas</span>      -> em irmaos
   *   <div><b>87</b></div><div><small>Visitas...  -> em ramos separados
   *
   * A solucao para os tres e a mesma: subir no DOM. O textContent de um
   * elemento inclui o texto de todos os descendentes, entao em algum nivel
   * acima numero e rotulo acabam no mesmo texto - e ai numeroAntesDe()
   * resolve. Paramos no primeiro nivel que der resposta, porque subir demais
   * comeca a misturar dados de outros anuncios da mesma pagina.
   *
   * @param {Element} elemento
   * @param {string} palavra
   * @returns {number|null}
   */
  function valorDoRotulo(elemento, palavra, limite) {
    let atual = elemento;

    // Subimos no maximo ate o LIMITE - o elemento que delimita este anuncio.
    // Sem essa trava, um rotulo em card sem numero faria a busca continuar
    // subindo e encontrar o numero do anuncio de baixo.
    for (let nivel = 0; nivel < 5 && atual; nivel++) {
      const valor = numeroAntesDe(atual.textContent, palavra);
      if (valor !== null) return valor;

      // Chegamos na fronteira do anuncio: daqui para cima ja e territorio
      // de outro, entao paramos mesmo sem ter achado nada.
      if (atual === limite) return null;

      atual = atual.parentElement;
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Varredura da pagina
  // --------------------------------------------------------------------------

  /**
   * Percorre todos os textos da pagina procurando rotulos de metrica.
   *
   * Usamos TreeWalker em vez de querySelectorAll("*") porque ele percorre
   * diretamente os NOS DE TEXTO, que e onde as palavras realmente moram.
   * E mais rapido e evita pegar o mesmo texto varias vezes (o textContent
   * de um elemento pai repete o texto de todos os filhos).
   *
   * @returns {Object} mapa { MLB123: { visitas: 359 }, ... }
   */
  function varrerPagina() {
    const resultado = {};

    const caminhante = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT  // so nos de texto, ignora tags e comentarios
    );

    let no = caminhante.nextNode();

    while (no) {
      // Comparamos em minusculo para pegar "Visitas", "visitas", "VISITAS".
      const texto = (no.nodeValue || "").toLowerCase();
      const elemento = no.parentElement;

      // Pulamos o que a propria extensao desenhou na tela.
      //
      // O painel do content.js exibe as palavras "Visitas" e "Vendas" junto
      // dos numeros. Sem esta guarda, o coletor leria a propria saida como
      // se fosse dado do Mercado Livre e a realimentaria no cache - um
      // sistema se confirmando sozinho, que e a pior especie de bug porque
      // os numeros continuam parecendo plausiveis.
      //
      // closest() sobe pelos ancestrais procurando quem casa com o seletor.
      if (elemento && !elemento.closest("#mlmetrics-painel, #mlmetrics-aviso")) {
        // Para cada metrica que conhecemos, testamos todas as palavras
        // que podem indica-la neste texto.
        Object.keys(ROTULOS).forEach(function (metrica) {
          ROTULOS[metrica].forEach(function (palavra) {
            // indexOf(...) !== -1 significa "contem".
            if (texto.indexOf(palavra) === -1) return;

            const contexto = contextoDoAnuncio(elemento);
            if (!contexto) return;

            const codigo = contexto.codigo;
            const valor = valorDoRotulo(elemento, palavra, contexto.limite);

            // So guardamos com as duas pontas: de qual anuncio, e quanto.
            if (valor === null) return;

            if (!resultado[codigo]) resultado[codigo] = {};

            // Ficamos com o MAIOR valor encontrado na pagina para cada
            // metrica. Telas costumam mostrar recortes lado a lado
            // ("visitas hoje" e "visitas totais") e o total e o que interessa.
            const atual = resultado[codigo][metrica];
            if (atual === undefined || valor > atual) {
              resultado[codigo][metrica] = valor;
            }
          });
        });
      }

      no = caminhante.nextNode();
    }

    return descartarImplausiveis(resultado);
  }

  /**
   * Remove leituras que nao podem ser verdade.
   *
   * Regra: e impossivel vender mais vezes do que o anuncio foi visitado -
   * toda venda passa por uma visita. Quando isso acontece, o problema nao e
   * um numero ruim, e a LEITURA INTEIRA que interpretou errado: pegou dois
   * numeros quaisquer da tela e colou nos rotulos errados. Por isso
   * descartamos o anuncio todo, nao so a metrica maior.
   *
   * Isto e uma rede de protecao contra o risco central desta abordagem.
   * Como identificamos metricas por palavras no texto, qualquer frase da
   * pagina que contenha "visitas" ou "vendas" pode ser lida como dado - um
   * texto de ajuda, uma avaliacao de comprador, um aviso do proprio site.
   * Nao da para prever todas essas frases, mas da para reconhecer quando o
   * resultado e impossivel.
   *
   * @param {Object} resultado
   * @returns {Object} so os anuncios cujos numeros fazem sentido
   */
  function descartarImplausiveis(resultado) {
    const limpo = {};

    Object.keys(resultado).forEach(function (codigo) {
      const dados = resultado[codigo];

      // So da para checar quando temos as duas metricas. Com uma so,
      // aceitamos - nao ha com o que comparar.
      const comparavel = (dados.visitas !== undefined && dados.vendas !== undefined);

      if (comparavel && dados.vendas > dados.visitas) {
        console.warn(
          "[ML METRICS] leitura descartada em " + codigo +
          ": " + dados.vendas + " vendas para " + dados.visitas + " visitas"
        );
        return;
      }

      limpo[codigo] = dados;
    });

    return limpo;
  }

  // --------------------------------------------------------------------------
  // Gravacao no cache
  // --------------------------------------------------------------------------

  /**
   * Diz se os numeros de um anuncio mudaram em relacao ao que ja tinhamos.
   *
   * Comparamos apenas as metricas. "capturadoEm" muda toda varredura por
   * definicao, entao inclui-lo na comparacao faria tudo parecer sempre
   * diferente - exatamente o que precisamos evitar.
   *
   * @param {Object|undefined} antigo
   * @param {Object} novo
   * @returns {boolean}
   */
  function mudou(antigo, novo) {
    // Nunca vimos este anuncio: e novidade por definicao.
    if (!antigo) return true;

    return Object.keys(novo).some(function (metrica) {
      return antigo[metrica] !== novo[metrica];
    });
  }

  /**
   * Mescla o que acabamos de achar com o que ja estava guardado.
   *
   * Mesclar em vez de sobrescrever e essencial: cada tela mostra um
   * subconjunto dos anuncios, entao sobrescrever apagaria o que foi
   * capturado nas telas anteriores.
   *
   * @param {Object} novos
   */
  function salvar(novos) {
    if (Object.keys(novos).length === 0) return;

    chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
      // Se for a primeira vez, nao existe nada guardado ainda.
      const cache = guardado[CHAVE_CACHE] || {};

      // Ficamos so com os anuncios cujos numeros realmente mudaram.
      //
      // Isso e OBRIGATORIO, nao e otimizacao: o MutationObserver la embaixo
      // dispara a cada alteracao do DOM, e mostrar o aviso verde altera o
      // DOM. Sem esta trava, avisar provocaria nova varredura, que avisaria
      // de novo - um loop infinito.
      const codigos = Object.keys(novos).filter(function (codigo) {
        return mudou(cache[codigo], novos[codigo]);
      });

      if (codigos.length === 0) return;

      codigos.forEach(function (codigo) {
        // Object.assign copia da esquerda para a direita, entao o que vem
        // depois vence. A ordem importa e diz a regra de atualizacao:
        //
        //   cache[codigo]  -> o que ja sabiamos deste anuncio
        //   novos[codigo]  -> o que esta tela mostrou agora (mais recente)
        //
        // Assim uma tela que so mostra visitas ATUALIZA as visitas sem
        // apagar as vendas capturadas em outra tela. E entre a captura
        // velha e a nova vence a NOVA, nao a maior: dentro de uma mesma
        // pagina o maior valor e o total, mas entre dias diferentes o
        // numero recente e o correto, mesmo que seja menor.
        cache[codigo] = Object.assign({}, cache[codigo], novos[codigo], {
          // Data da captura. Permite exibir "dado de 3 dias atras"
          // em vez de mostrar numero velho como se fosse de agora.
          capturadoEm: Date.now()
        });
      });

      chrome.storage.local.set({ [CHAVE_CACHE]: cache }, function () {
        console.log(
          "%c[ML METRICS]%c capturei " + codigos.length + " anuncio(s):",
          "background:#3483fa;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#3483fa",
          novos
        );

        avisarNaTela(codigos.length);
      });
    });
  }

  /**
   * Mostra um aviso discreto no canto da tela.
   *
   * Existe porque quem vai rodar isso e a cliente, nao um programador:
   * ela precisa de um sinal visivel de que funcionou, sem abrir console.
   *
   * @param {number} quantidade
   */
  function avisarNaTela(quantidade) {
    const aviso = document.createElement("div");
    aviso.id = "mlmetrics-aviso";
    aviso.textContent = quantidade + " anuncio(s) atualizado(s)";

    document.body.appendChild(aviso);

    // Some sozinho depois de 4 segundos para nao atrapalhar o uso do site.
    setTimeout(function () {
      aviso.remove();
    }, 4000);
  }

  // --------------------------------------------------------------------------
  // Ponto de entrada
  // --------------------------------------------------------------------------

  // Varre uma vez de imediato: se a pagina ja veio pronta do servidor,
  // os numeros estao la e nao ha o que esperar.
  salvar(varrerPagina());

  // Mas telas de vendedor costumam montar a lista por JavaScript, depois
  // do carregamento. Em vez de apostar num tempo fixo ("espera 1,5s e
  // torce"), observamos o DOM e reagimos quando o conteudo chega - funcione
  // a conexao rapida ou lenta.
  let agendado = null;

  const observador = new MutationObserver(function () {
    // DEBOUNCE: montar uma lista dispara centenas de mutacoes seguidas.
    // Varrer a cada uma travaria a pagina. Entao cada mutacao CANCELA a
    // varredura agendada e marca outra - o efeito e varrer uma unica vez,
    // 600ms depois que as mudancas pararem.
    clearTimeout(agendado);

    agendado = setTimeout(function () {
      salvar(varrerPagina());
    }, 600);
  });

  observador.observe(document.body, {
    childList: true,  // elementos adicionados ou removidos
    subtree: true     // em qualquer profundidade, nao so nos filhos diretos
    // Nao observamos "characterData" (texto alterado no lugar) de proposito:
    // dobraria o volume de eventos para ganhar pouco, ja que o ML troca os
    // elementos inteiros em vez de editar o texto dentro deles.
  });
})();
