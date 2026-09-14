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
  //
  // Nao usamos "visualiz" para visitas: toda tela de vendedor tem o botao
  // "Visualizar anuncio", e o numero colado antes dele (estoque, posicao na
  // lista) seria lido como visitas. "visita" cobre o rotulo que o ML usa.
  const ROTULOS = {
    visitas: ["visita"],
    vendas: ["venda", "vendido", "vendida"]
  };

  // Guarda o que a extensao viu quando nao conseguiu capturar nada.
  // Serve para diagnostico remoto - ver salvarDiagnostico().
  const CHAVE_DIAGNOSTICO = "mlmetrics_diagnostico";

  // Enderecos de telas de vendedor que ja entregaram numeros, e quando
  // foi a ultima busca automatica neles.
  const CHAVE_ORIGENS = "mlmetrics_origens";
  const CHAVE_ULTIMA_BUSCA = "mlmetrics_ultima_busca";

  // De quanto em quanto tempo a extensao vai buscar dados sozinha.
  // Duas horas equilibra dado fresco com nao pesar na navegacao dela.
  const INTERVALO_BUSCA_MS = 2 * 60 * 60 * 1000;

  // Ultimo diagnostico gravado: de qual tela e quando (trava do
  // salvarDiagnostico, que e por tela - ver la).
  let ultimoDiagnostico = { caminho: null, quando: 0 };

  // Identificadores de anuncio do Mercado Livre.
  //
  // A letra opcional depois de "MLB" faz parte do codigo, nao e ruido:
  // "MLBU1234567890" e "MLB1234567890" sao identificadores diferentes.
  // Capturamos prefixo e digitos separados e remontamos sem o hifen.
  //
  //   MLB-3456789012   ->  MLB3456789012    anuncio
  //   MLB12345678      ->  MLB12345678      produto de catalogo (/p/)
  //   MLBU1234567890   ->  MLBU1234567890   estrutura nova (/up/)
  const PADRAO_CODIGO = /(MLB[A-Z]?)-?(\d{6,})/;

  // --------------------------------------------------------------------------
  // Utilitarios de leitura
  // --------------------------------------------------------------------------

  /**
   * Converte um texto de numero brasileiro para inteiro.
   *
   * "1.234" no Brasil significa mil duzentos e trinta e quatro: o ponto e
   * separador de MILHAR e precisa sumir antes de converter.
   *
   * Se o texto contem virgula, e um preco decimal (1.234,56) e nao uma
   * metrica inteira - retornamos null para rejeitar.
   *
   * @param {string} bruto ex: "1.234"
   * @returns {number|null}
   */
  function paraInteiro(bruto) {
    // Virgula indica centavos/preco decimal - metricas sao sempre inteiras.
    if (bruto.indexOf(",") !== -1) return null;

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
   * Procuramos a ULTIMA ocorrencia do rotulo, nao a primeira. Telas de
   * vendedor repetem o mesmo rotulo em recortes lado a lado ("visitas
   * hoje" e "visitas totais"); a ultima costuma ser o total, que e o que
   * interessa. E com duas varreduras competindo, a regra do "maior valor"
   * em varrerPagina() decide - aproveitando o que ela ja sabe fazer.
   *
   * @param {string} texto
   * @param {string} palavra rotulo procurado, em minusculo
   * @returns {number|null}
   */
  function numeroAntesDe(texto, palavra) {
    // A leitura mora em lerRotulo, que tambem diz ONDE o numero estava no
    // texto (para o rastro de origem). Aqui fica so o numero.
    const leitura = lerRotulo(texto, palavra);
    return leitura ? leitura.valor : null;
  }

  /**
   * Faz a leitura descrita em numeroAntesDe e devolve tambem a POSICAO dela
   * no texto: de onde ate onde vai o pedaco "numero + rotulo" que virou dado.
   *
   * A posicao existe para o rastro de origem (ver trechoDaLeitura). Cada
   * numero guardado leva junto o texto exato de onde saiu, e e isso que
   * permite conferir o painel contra a tela do Mercado Livre.
   *
   * @param {string} texto
   * @param {string} palavra rotulo procurado, em minusculo
   * @returns {Object|null} valor, inicio e fim da leitura - ou null
   */
  function lerRotulo(texto, palavra) {
    if (!texto) return null;

    const posicao = texto.toLowerCase().lastIndexOf(palavra);
    if (posicao === -1) return null;

    // Fim do rotulo INTEIRO: o rotulo procurado e "visita", mas o texto diz
    // "visitas". As letras que sobram fazem parte da palavra - nao podem ser
    // lidas como palavra estranha antes do numero, e o rastro deve mostrar
    // "visitas" inteiro.
    const sobraDaPalavra = texto
      .slice(posicao + palavra.length)
      .match(/^[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]*/)[0];
    const fimDoRotulo = posicao + palavra.length + sobraDaPalavra.length;

    // Primeiro tentamos antes do rotulo, que e a ordem natural em portugues.
    const trechoAntes = texto.slice(0, posicao);
    const antes = ultimoNumeroColado(trechoAntes);

    if (antes !== null) {
      // Um ANO solto nao e metrica: "Ativo desde 2024 vendas" nao tem valor
      // nenhum, o 2024 e a data em que o anuncio foi ativado. Rejeitamos
      // apenas quando a palavra "desde" aparece imediatamente antes do
      // numero - e ela que denuncia o contexto de tempo. Sem o "desde",
      // "2024 vendas" pode ser metrica legitima (ele vendeu 2024 vezes) e
      // nao pode ser bloqueado pelo tamanho do numero.
      if (ehAnoPosDesde(trechoAntes, antes)) return null;

      // O numero colado ANTES pode ser de OUTRO rotulo. Em "Visitas: 359 |
      // Vendas: 12", o 359 esta logo antes de "Vendas", mas pertence a
      // "Visitas". Quando um rotulo conhecido vem antes do numero, ele e o
      // dono - e a leitura segue para depois do rotulo, onde esta o 12.
      if (!numeroPresoAOutroRotulo(trechoAntes)) {
        const numeros = Array.from(trechoAntes.matchAll(/\d[\d.,]*/g));
        return {
          valor: antes,
          inicio: numeros[numeros.length - 1].index,
          fim: fimDoRotulo
        };
      }
    }

    // Se nao achou (ou o numero de antes tinha outro dono), tentamos depois
    // do rotulo - cobre "Visitas: 359".
    const depois = texto.slice(fimDoRotulo);
    const valorDepois = primeiroNumeroColado(depois);
    if (valorDepois === null) return null;

    const achado = depois.match(/\d[\d.,]*/);
    return {
      valor: valorDepois,
      inicio: posicao,
      fim: fimDoRotulo + achado.index + achado[0].length
    };
  }

  /**
   * Diz se o ultimo numero de um trecho pertence a um rotulo que vem ANTES
   * dele - e portanto nao pode ser atribuido ao rotulo que vem depois.
   *
   *   "Visitas: 359 | "      -> 359 e de "Visitas"       preso
   *   "Estoque 12 - "        -> 12 e do estoque           preso
   *   "Kit 2 caixas 359 "    -> nenhum rotulo conhecido   livre
   *
   * Olhamos o pedaco entre o numero anterior (ou o comeco) e este numero,
   * limitado aos 40 caracteres mais proximos: prosa distante nao conta.
   *
   * O custo e conhecido e aceito. Num texto corrido como "359 visitas 12
   * vendas", o 12 fica entre dois rotulos e nao da para saber de quem ele e -
   * entao as vendas ficam sem leitura. Na duvida, nao mostramos: numero que
   * falta aparece como um traco no painel; numero trocado nao apareceria
   * como nada, pareceria certo.
   *
   * @param {string} trecho texto antes do rotulo, terminando no numero
   * @returns {boolean}
   */
  function numeroPresoAOutroRotulo(trecho) {
    const numeros = Array.from(trecho.matchAll(/\d[\d.,]*/g));
    if (numeros.length === 0) return false;

    const ultimo = numeros[numeros.length - 1];
    const anterior = numeros.length > 1 ? numeros[numeros.length - 2] : null;
    const comeco = anterior ? anterior.index + anterior[0].length : 0;

    const pedaco = trecho
      .slice(Math.max(comeco, ultimo.index - 40), ultimo.index)
      .toLowerCase();

    // Os rotulos das metricas, mais os de quantidade que aparecem ao lado
    // delas nas telas de vendedor. Lista fechada: so rotulo que sabemos que
    // e dono de numero.
    const donos = [].concat(
      ROTULOS.visitas,
      ROTULOS.vendas,
      ["estoque", "quantidade", "unidade", "dispon"]
    );

    return donos.some(function (dono) {
      return pedaco.indexOf(dono) !== -1;
    });
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
    //
    // A regex inclui virgula (\d[\d.,]*) para capturar precos inteiros
    // (ex: "1.234,56") como um so match, em vez de dividir centavos do
    // valor. Depois, paraInteiro() rejeita qualquer match que contenha
    // virgula - centavos nao sao metricas inteiras.
    const numeros = Array.from(trecho.matchAll(/\d[\d.,]*/g));
    if (numeros.length === 0) return null;

    const ultimo = numeros[numeros.length - 1];
    const vao = trecho.slice(ultimo.index + ultimo[0].length);

    if (temLetra(vao)) return null;

    // Percentual nao e contagem: em "+12% visitas" o 12 e variacao, nao
    // quantidade de visitas. O "%" nao e letra, entao temLetra deixa passar.
    if (/^\s*%/.test(vao)) return null;

    // O ultimo numero e uma data brasileira? "Publicado em 01.02.2023
    // visitas" nao tem valor nenhum - rejeitamos o trecho inteiro.
    if (ehData(ultimo[0])) return null;

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
    // Mesma logica de ultimoNumeroColado: incluimos virgula para capturar
    // precos como match unico, e paraInteiro rejeita depois.
    const encontrado = trecho.match(/\d[\d.,]*/);
    if (!encontrado) return null;

    const vao = trecho.slice(0, encontrado.index);

    if (temLetra(vao)) return null;

    // O numero e o DIA de uma data? "Visitas 01/02/2023" daria 1 visita
    // pela leitura normal - rejeitamos o trecho inteiro.
    const depoisDoNumero = trecho.slice(encontrado.index + encontrado[0].length);
    if (ehData(encontrado[0] + depoisDoNumero)) return null;

    // O que vem DEPOIS do numero tambem decide. "Visitas +12%" e variacao,
    // "Ultima visita 14/09" e data sem ano, "Vendas (30 dias) 12" e o periodo
    // do recorte - em nenhum deles o numero e o valor do rotulo. Sem esta
    // checagem, a regra do "maior valor" em varrerPagina deixaria o 30 ou o
    // 16% vencerem a contagem real do mesmo card.
    if (seguidoDeUnidade(depoisDoNumero)) return null;

    return paraInteiro(encontrado[0]);
  }

  /**
   * Diz se ha alguma letra no texto.
   *
   * Um intervalo unico entre as letras A e U de 8 bits (0xC0-0xFA) seria torto: inclui "×" (U+00D7)
   * e "÷" (U+00F7), que nao sao letras, e exclui "ü", "ý" e "ÿ". Por isso
   * usamos tres intervalos que pulam os simbolos e pegam os acentos do
   * portugues mais os diacriticos comuns:
   *   A-Z  a-z  À-Ö  Ø-ö  ø-ÿ
   */
  function temLetra(texto) {
    return /[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/.test(texto);
  }

  /**
   * Diz se um texto comeca com uma data brasileira valida (DD/MM/AAAA ou
   * DD.MM.AAAA, dia 01-31 e mes 01-12).
   *
   * Existe para que um trecho como "Publicado em 01.02.2023 visitas" nao
   * entregue o ano como metrica. Checar MES e DIA e essencial, senao um
   * milhar grande com dois pontos ("1.299.500 visitas") seria rejeitado
   * como se fosse data.
   *
   * @param {string} texto
   * @returns {boolean}
   */
  function ehData(texto) {
    const m = texto.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (!m) return false;

    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);

    return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
  }

  /**
   * Diz se o texto logo depois de um numero o transforma em outra coisa que
   * nao uma contagem: percentual, data sem ano, hora, periodo ou milhar
   * abreviado.
   *
   *   "12%"       -> percentual (variacao, taxa)
   *   "14/09"     -> data sem ano        "14:32" -> hora
   *   "30 dias"   -> periodo do recorte
   *   "12 mil"    -> abreviacao: o valor real e 12.000, nao 12
   *
   * A lista e FECHADA de proposito. Rejeitar qualquer palavra depois do
   * numero quebraria "Visitas 359 Vendas 12", em que o que vem depois e so o
   * proximo rotulo. So bloqueamos o que sabemos que muda o sentido.
   *
   * @param {string} resto texto que vem imediatamente depois do numero
   * @returns {boolean}
   */
  function seguidoDeUnidade(resto) {
    // Percentual, ou barra/dois-pontos colados em outro digito (data e hora).
    if (/^\s*%/.test(resto) || /^[\/:]\d/.test(resto)) return true;

    // Palavra de tempo, mes abreviado ou milhar. O (?!...) do fim exige que a
    // palavra termine ali: "d" nao casa com "de", "h" com "hoje", "min" com
    // "minhas" - so a unidade sozinha conta.
    return /^\s*(dias?|d|h|horas?|min|minutos?|semanas?|m[eê]s|meses|anos?|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|mil|mi|k)(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i.test(resto);
  }

  /**
   * Diz se um valor achado antes do rotulo e um ANO solto precedido de
   * "desde" - ou seja, data de ativacao/publicacao, nao metrica.
   *
   * So o "desde" justifica a rejeicao: um ano de 4 digitos sozinho ("2024
   * vendas") pode perfeitamente ser contagem real de um anuncio popular.
   * Ja "desde 2024" e sempre leitura de tempo - ninguem diz "desde" para
   * apresentar uma quantidade vendida.
   *
   * @param {string} trecho o texto inteiro antes do rotulo, ja com o numero
   * @param {number} valor o numero que foi extraido dele (antes do rotulo)
   * @returns {boolean}
   */
  function ehAnoPosDesde(trecho, valor) {
    // Anos plausiveis (1900-2099). Fora disso nao e ano, e metrica mesmo.
    if (valor < 1900 || valor > 2099) return false;

    // Acha de novo a posicao do numero que sera julgado (o ultimo do trecho
    // - o mesmo que ultimoNumeroColado entregou).
    const numeros = Array.from(trecho.matchAll(/\d[\d.,]*/g));
    if (numeros.length === 0) return false;

    const ultimo = numeros[numeros.length - 1];
    const antesDoNumero = trecho.slice(0, ultimo.index);

    // "Ativo desde 2024" termina em "desde " antes do numero.
    // \s+$ cobre espaco e quebra de linha, e o "i" aceita "Desde".
    return /desde\s+$/i.test(antesDoNumero);
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
  function contextoDoAnuncio(elemento, doc, url) {
    // Caso mais facil: a propria URL da pagina ja identifica o anuncio.
    // Vale quando estamos na tela de metricas de UM anuncio especifico -
    // ali a pagina inteira fala de um produto so, entao o limite e o body.
    //
    // So olhamos o PATH da URL, nunca a query string. Telas de vendedor
    // carregam "MLB..." em parametros de filtro ou retorno (?item_id=MLB123);
    // se testassemos a URL completa, uma listagem inteira seria atribuida a
    // um unico codigo com limite = body. O MLB de anuncio de verdade fica
    // sempre no caminho (produto.mercadolivre.com.br/MLB-123...-p/MLB123...).
    const naUrl = url.split("?")[0].match(PADRAO_CODIGO);
    if (naUrl) {
      return { codigo: naUrl[1] + naUrl[2], limite: doc.body };
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
      const achado = links[i].getAttribute("href").match(PADRAO_CODIGO);
      if (!achado) continue;

      const codigo = achado[1] + achado[2];

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
   * @returns {Object|null} valor e trecho - o numero e o rastro dele
   */
  function valorDoRotulo(elemento, palavra, limite, doc) {
    let atual = elemento;

    // Subimos no maximo ate o LIMITE - o elemento que delimita este anuncio.
    // Sem essa trava, um rotulo em card sem numero faria a busca continuar
    // subindo e encontrar o numero do anuncio de baixo.
    for (let nivel = 0; nivel < 5 && atual; nivel++) {
      // Nunca lemos o textContent do BODY. Quando o codigo veio da URL
      // (limite = doc.body), uma pagina rasa alcanca o body em poucos
      // niveis - e o texto vira a pagina inteira, deixando o rotulo buscar
      // numero em regiao nao relacionada. Antes de ler, recuamos um nivel
      // quando o atual e o body.
      if (atual !== doc.body) {
        const texto = atual.textContent;
        const leitura = lerRotulo(texto, palavra);

        // Devolvemos o numero junto com o RASTRO: o pedaco de texto exato
        // em que ele foi lido, neste nivel do DOM.
        if (leitura !== null) {
          return { valor: leitura.valor, trecho: trechoDaLeitura(texto, leitura) };
        }
      }

      // Chegamos na fronteira do anuncio: daqui para cima ja e territorio
      // de outro, entao paramos mesmo sem ter achado nada.
      if (atual === limite) return null;

      atual = atual.parentElement;
    }

    return null;
  }

  /**
   * Monta o RASTRO de uma leitura: o texto exato que virou numero, marcado
   * entre as aspas angulares (« e »), com um pouco de contexto dos
   * dois lados. Exemplo, com colchetes no lugar das aspas:
   *
   *   "Estoque 12 - [359 visitas] totais"
   *
   * O contexto e o que permite a qualquer pessoa conferir o numero contra a
   * tela do Mercado Livre - e perceber quando ele foi colado no rotulo
   * errado. E curto de proposito (20 caracteres de cada lado): janela maior
   * arrastaria titulo de anuncio e preco para dentro do cache.
   *
   * @param {string} texto o texto em que a leitura foi feita
   * @param {Object} leitura valor, inicio e fim, vindos de lerRotulo
   * @returns {string}
   */
  function trechoDaLeitura(texto, leitura) {
    const CONTEXTO = 20;

    // Espacos e quebras de linha da indentacao do HTML viram um espaco so.
    function compactar(pedaco) {
      return pedaco.replace(/\s+/g, " ");
    }

    const antes = compactar(texto.slice(Math.max(0, leitura.inicio - CONTEXTO), leitura.inicio));
    const lido = compactar(texto.slice(leitura.inicio, leitura.fim)).trim();
    const depois = compactar(texto.slice(leitura.fim, leitura.fim + CONTEXTO));

    return (antes + "«" + lido + "»" + depois).trim();
  }

  // --------------------------------------------------------------------------
  // Varredura da pagina
  // --------------------------------------------------------------------------

  /**
   * Filtro do TreeWalker: diz se um no de texto deve ser examinado.
   *
   * SHOW_TEXT sozinho inclui o texto dentro de <script>, <style>, <template>
   * e de conteudos ocultos. O ML embute JSONs gigantes em <script> com
   * campos "visits" e "sold_quantity" ao lado de milhares de numeros - se
   * um desses nos fosse lido, um numero do JSON entraria como metrica.
   * Alem disso, varrer esse texto e caro: centenas de KB copiadas em
   * minusculo a cada subida do DOM.
   *
   * @param {Node} no
   * @returns {number} NodeFilter.FILTER_ACCEPT ou FILTER_REJECT
   */
  function aceitarNoDeTextoTecnico(no) {
    const pai = no.parentElement;

    // Sem pai, nao temos como saber o contexto - aceitamos por seguranca.
    if (!pai) return NodeFilter.FILTER_ACCEPT;

    // Rejeita nos dentro de script, style e template, e tambem de:
    //  - noscript: com o JavaScript ligado, o conteudo dele e texto cru que
    //    nunca aparece na tela;
    //  - [hidden]: atributo que tira o elemento da tela por completo.
    // aria-hidden NAO entra: o ML marca com ele numeros que APARECEM na tela
    // (a parte visual do preco tem aria-hidden="true"), escondendo so do
    // leitor de tela. Rejeita-lo apagaria texto visivel.
    if (pai.closest("script, style, template, noscript, [hidden]")) {
      return NodeFilter.FILTER_REJECT;
    }

    return NodeFilter.FILTER_ACCEPT;
  }

  /**
   * Diz se a pagina parece TELA DE VENDEDOR: alguma mencao a "visita".
   *
   * E o mesmo custo de pasta que usamos para achar "venda": o coletor
   * diferencia as duas telas pelo vocabulario que cada uma usa. Pagina
   * publica (busca, categoria, vitrine) tem "vendido" e "vendas" aos montes
   * - todos de OUTRO vendedor - mas nunca "visita". A palavra "visita" so
   * existe em telas que acompanham o anuncio de quem vende.
   *
   * Os guardas precisam ser os MESMOS da varredura principal: nao entrar em
   * script/style/template e nao contar o que a propria extensao desenhou.
   * Se o painel dissesse "Visitas" e contasse como sinal, um anuncio publico
   * exibido com painel viraria "tela de vendedor" so por causa do painel.
   *
   * @param {Document} doc
   * @returns {boolean} vale a pena varrer a pagina?
   */
  function paginaMencionaVisita(doc) {
    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      aceitarNoDeTextoTecnico
    );

    let no = caminhante.nextNode();

    while (no) {
      const texto = (no.nodeValue || "").toLowerCase();
      const elemento = no.parentElement;

      if (elemento &&
          !elemento.closest("#mlmetrics-painel, #mlmetrics-aviso") &&
          texto.indexOf("visita") !== -1) {
        return true;
      }

      no = caminhante.nextNode();
    }

    return false;
  }

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
  function varrerPagina(doc, url) {
    // Pagina sem "visita" nao e tela de vendedor: qualquer "vendido" que ela
    // mostre pertence a produto publico de OUTRO vendedor. A varredura
    // inteira e descartada antes de comecar (sairia daqui cheia de numeros
    // com cara de certo, que e o pior modo de erro deste coletor).
    if (!paginaMencionaVisita(doc)) return {};

    const resultado = {};

    // Em qual tela a leitura acontece, para o rastro de origem. Mascarado
    // (ver caminhoMascarado): diz a FORMA da rota, sem codigo nem titulo.
    const tela = caminhoMascarado(new URL(url).pathname);

    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,  // so nos de texto, ignora tags e comentarios
      aceitarNoDeTextoTecnico  // mas NAO o texto de script/style/template
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
        // Primeiro checamos se o texto menciona ALGUMA metrica que
        // conhecemos. So entao vale a pena a busca pelo contexto.
        const menciona = Object.keys(ROTULOS).some(function (metrica) {
          return ROTULOS[metrica].some(function (palavra) {
            return texto.indexOf(palavra) !== -1;
          });
        });

        if (menciona) {
          // O contexto do anuncio (quem e, e ate onde buscar o valor) NAO
          // depende da palavra - e do elemento. Calcula-lo dentro do laco
          // de palavras faria cada sinonimo refazer os querySelectorAll ate
          // 12 niveis de ancestral: na tela de listagem, com 50 cards, eram
          // milhares de varreduras quase do documento inteiro.
          const contexto = contextoDoAnuncio(elemento, doc, url);

          if (contexto) {
            const codigo = contexto.codigo;

            // Para cada metrica que conhecemos, testamos todas as palavras
            // que podem indica-la neste texto.
            Object.keys(ROTULOS).forEach(function (metrica) {
              ROTULOS[metrica].forEach(function (palavra) {
                // indexOf(...) !== -1 significa "contem".
                if (texto.indexOf(palavra) === -1) return;

                const leitura = valorDoRotulo(elemento, palavra, contexto.limite, doc);

                // So guardamos com as duas pontas: de qual anuncio, e quanto.
                if (leitura === null) return;

                if (!resultado[codigo]) resultado[codigo] = { origem: {} };

                // Ficamos com o MAIOR valor encontrado na pagina para cada
                // metrica. Telas costumam mostrar recortes lado a lado
                // ("visitas hoje" e "visitas totais") e o total e o que interessa.
                const atual = resultado[codigo][metrica];
                if (atual === undefined || leitura.valor > atual) {
                  resultado[codigo][metrica] = leitura.valor;

                  // O rastro acompanha o numero que venceu: e a prova de onde
                  // ELE saiu, nao de uma leitura que foi descartada.
                  resultado[codigo].origem[metrica] = {
                    trecho: leitura.trecho,
                    tela: tela
                  };
                }
              });
            });
          }
        }
      }

      no = caminhante.nextNode();
    }

    // A regra que fecha o ciclo: so tela de VENDEDOR entrega numeros, e tela
    // de vendedor SEMPRE mostra visitas. Se a pagina leu apenas vendas - com
    // qualquer sobra de "visita" num banner ou modulo - ela e publica, com
    // vendedores alheios, e os numeros achados nao prestam. O cache real que
    // gerou esta regra tinha 137 anuncios "de dezenas de vendedores" e ZERO
    // visitas: todos vieram de paginas publicas. Visitas e a metrica que a
    // pagina publica nunca exibe, entao sem visita lida nao ha captura.
    //
    // E a regra vale POR ANUNCIO, nao pela pagina inteira. Antes bastava UM
    // card ter visitas para qualquer outro codigo, so com vendas, passar - e
    // um modulo de terceiros dentro da tela de vendedor ("mais vendidos",
    // recomendados) gravaria "+1.000 vendidos" num produto alheio. Codigo sem
    // visita lida nesta varredura fica de fora inteiro: na duvida, nao grava.
    const comVisitas = {};

    Object.keys(resultado).forEach(function (codigo) {
      if (resultado[codigo].visitas !== undefined) {
        comVisitas[codigo] = resultado[codigo];
      }
    });

    return descartarImplausiveis(comVisitas);
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

    // So as METRICAS contam. O rastro de origem muda a cada leitura (hora,
    // tela) mesmo com o numero igual; compara-lo faria tudo parecer
    // diferente, e o aviso verde dispararia sem parar.
    return Object.keys(ROTULOS).some(function (metrica) {
      // Metrica que esta tela nao mostrou nao conta como mudanca.
      if (novo[metrica] === undefined) return false;
      return antigo[metrica] !== novo[metrica];
    });
  }

  /**
   * Diz se o registro guardado tem numero SEM rastro de origem para alguma
   * metrica que acabou de ser lida de novo.
   *
   * Acontece com registro gravado por versao antiga da extensao. Numero sem
   * rastro nao aparece no painel, entao a primeira releitura precisa gravar o
   * rastro na hora, sem esperar o intervalo de renovacao.
   *
   * @param {Object} guardado registro do cache
   * @param {Object} novo o que esta varredura leu para o mesmo anuncio
   * @returns {boolean}
   */
  function faltaOrigem(guardado, novo) {
    return Object.keys(ROTULOS).some(function (metrica) {
      return novo[metrica] !== undefined &&
             !(guardado.origem && guardado.origem[metrica]);
    });
  }

  /**
   * Junta o rastro de origem guardado com o desta leitura, metrica a metrica,
   * carimbando a hora e se a leitura veio da busca automatica.
   *
   * Por metrica, igual aos numeros: a origem das vendas lidas em outra tela
   * nao pode sumir so porque esta tela trouxe as visitas.
   *
   * @param {Object|undefined} guardada origem que ja estava no cache
   * @param {Object|undefined} nova origem desta varredura (varrerPagina)
   * @param {number} agora
   * @param {boolean} automatica true quando veio da busca em segundo plano
   * @returns {Object}
   */
  function mesclarOrigem(guardada, nova, agora, automatica) {
    const resultado = Object.assign({}, guardada);

    Object.keys(nova || {}).forEach(function (metrica) {
      resultado[metrica] = Object.assign({}, nova[metrica], {
        em: agora,
        automatica: Boolean(automatica)
      });
    });

    return resultado;
  }

  // Fila que serializa leitura+escrita do cache DESTA aba.
  //
  // O chrome.storage nao oferece leitura-modificacao-escrita atomica: entre
  // o get e o set, outra operacao pode entrar e gravar por cima. Encadear
  // tudo numa fila unica impede que duas varreduras rapidas da MESMA aba se
  // pisem - o que acontecia com o aviso verde provocando re-varredura.
  // Entre abas DISTINTAS a corrida continua: resolver exigiria centralizar
  // a escrita num service worker (o lote 6 da revisao).
  let filaDoCache = Promise.resolve();

  /**
   * Le o cache, permite modificar, e grava de volta - sempre em sequencia.
   *
   * Todas as operacoes de chrome.storage ficam protegidas contra erro:
   * contexto invalidado e quota estourada terminam a fila em silencio, e a
   * proxima operacao tenta de novo. Nenhuma excecao escapa para o console.
   *
   * @param {Function} acao recebe (cache, gravar). gravar(novoCache) persiste,
   *                        ou gravar(null) para nao escrever nada.
   */
  function comCache(acao) {
    filaDoCache = filaDoCache.then(function () {
      return new Promise(function (resolve) {
        let cache;

        try {
          chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
            if (chrome.runtime.lastError) {
              // Contexto invalidado (extensao recarregada) ou acesso negado.
              resolve();
              return;
            }

            cache = guardado[CHAVE_CACHE] || {};

            acao(cache, function (novoCache) {
              if (novoCache === null || novoCache === undefined) {
                resolve();  // decisao de nao persistir
                return;
              }

              try {
                chrome.storage.local.set({ [CHAVE_CACHE]: novoCache }, function () {
                  // Quota estourada nao tem o que fazer aqui; terminamos a fila.
                  resolve();
                });
              } catch (e) {
                resolve();  // contexto invalidado ao gravar
              }
            });
          });
        } catch (e) {
          resolve();  // contexto invalidado ao ler
        }
      });
    }).catch(function () {
      // A fila nunca para: erro de qualquer operacao deixa a proxima tentar.
    });

    return filaDoCache;
  }

  /**
   * Mescla o que acabamos de achar com o que ja estava guardado.
   *
   * Mesclar em vez de sobrescrever e essencial: cada tela mostra um
   * subconjunto dos anuncios, entao sobrescrever apagaria o que foi
   * capturado nas telas anteriores.
   *
   * @param {Object} novos
   * @param {boolean} emSegundoPlano true quando a origem e a busca manual
   *                        automatica (fetch), nao uma tela que a pessoa
   *                        esta vendo. Nesse caso o aviso verde nao faz
   *                        sentido: mostraria um toast sobre uma pagina que
   *                        nao tem relacao com os numeros capturados.
   */
  function salvar(novos, emSegundoPlano) {
    if (Object.keys(novos).length === 0) return;

    const AGORA = Date.now();

    // De quanto em quanto tempo o "capturadoEm" de um anuncio ESTAVEL e
    // renovado. Reconfirmar a cada varredura gravaria no storage a cada
    // 600ms sem parar; 2 minutos equilibra frescor com nao pesar em I/O.
    const INTERVALO_RENOVACAO_MS = 2 * 60 * 1000;

    // Toda a logica de decidir e persistir roda dentro da fila do cache.
    comCache(function (cache, gravar) {
      // Ficamos so com os anuncios cujos numeros realmente mudaram.
      //
      // Isso e OBRIGATORIO, nao e otimizacao: o MutationObserver la embaixo
      // dispara a cada alteracao do DOM, e mostrar o aviso verde altera o
      // DOM. Sem esta trava, avisar provocaria nova varredura, que avisaria
      // de novo - um loop infinito.
      const mudancas = Object.keys(novos).filter(function (codigo) {
        return mudou(cache[codigo], novos[codigo]);
      });

      // Anuncios ja conhecidos, com numeros IGUAIS ao que a tela mostra.
      // Nao mudaram, mas foram RECONFIRMADOS agora. Sem esta renovacao, um
      // anuncio estavel nunca anda a data e o painel passa a gritar "dados
      // de N dias atras" logo depois de ter sido reconferido - fazendo a
      // vendedora concluir que a extensao quebrou.
      const aRenovar = Object.keys(novos).filter(function (codigo) {
        if (mudancas.indexOf(codigo) !== -1) return false;
        const anterior = cache[codigo];
        if (!anterior) return false; // sem registro, foi para mudancas

        // Registro de versao antiga, sem rastro de origem: renova na hora.
        // Numero sem rastro nao aparece no painel, entao esperar o intervalo
        // deixaria um numero confirmado agora escondido por ate 2 minutos.
        if (faltaOrigem(anterior, novos[codigo])) return true;

        return AGORA - (anterior.capturadoEm || 0) >= INTERVALO_RENOVACAO_MS;
      });

      if (mudancas.length === 0 && aRenovar.length === 0) {
        gravar(null);  // nada o que persistir
        return;
      }

      mudancas.forEach(function (codigo) {
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
        const anterior = cache[codigo] || {};

        cache[codigo] = Object.assign({}, anterior, novos[codigo], {
          // Data da captura. Permite exibir "dado de 3 dias atras"
          // em vez de mostrar numero velho como se fosse de agora.
          capturadoEm: AGORA,
          // O rastro e mesclado por metrica (ver mesclarOrigem), e nao
          // substituido inteiro como faria o Object.assign acima.
          origem: mesclarOrigem(anterior.origem, novos[codigo].origem, AGORA, emSegundoPlano)
        });
      });

      // Os numeros continuam os mesmos; andam a data e o rastro, que passa a
      // apontar para a leitura mais recente que confirmou cada numero.
      aRenovar.forEach(function (codigo) {
        cache[codigo].capturadoEm = AGORA;
        cache[codigo].origem = mesclarOrigem(
          cache[codigo].origem, novos[codigo].origem, AGORA, emSegundoPlano
        );
      });

      gravar(cache);

      // So anunciamos quando algo de fato MUDOU. Reconhecer de novo sem
      // novidade nao merece toast a cada 2 minutos. E a busca em segundo
      // plano nunca anuncia: a pessoa nao esta olhando a tela capturada.
      if (mudancas.length > 0 && !emSegundoPlano) {
        console.log(
          "%c[ML METRICS]%c capturei " + mudancas.length + " anuncio(s):",
          "background:#3483fa;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#3483fa",
          novos
        );

        avisarNaTela(mudancas.length);
      }
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
    // Remove um aviso anterior que ainda esteja na tela. Sem isto, duas
    // capturas rapidas empilham avisos com o mesmo id no canto da tela.
    const existente = document.getElementById("mlmetrics-aviso");
    if (existente) existente.remove();

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

  /**
   * Diz se estamos numa pagina de compra - a vitrine publica do produto.
   *
   * O coletor NAO deve agir aqui, e a razao vale a pena entender.
   *
   * Essa pagina mistura metricas de dois donos diferentes:
   *
   *   "1 vendido"        -> do ANUNCIO
   *   "+1.000 vendas"    -> do VENDEDOR (reputacao dele na plataforma)
   *
   * As duas usam as mesmas palavras e ficam na mesma pagina, entao nao ha
   * como distinguir pelo texto. E como a URL identifica um anuncio, tudo
   * que fosse lido aqui seria atribuido a ele - inclusive o numero que e
   * do vendedor. Foi exatamente assim que um anuncio com uma venda passou
   * a exibir mil.
   *
   * O coletor existe para as telas de vendedor, onde cada numero pertence
   * ao anuncio do seu card. Aqui a extensao so exibe, nunca captura.
   *
   * Detectamos a vitrine pela URL. Dois sinais, ambos sujos de fingir que
   * sao host ou caminho:
   *
   *   - HOST: a vitrine classica mora em subdominio proprio
   *     (produto.mercadolivre.com.br, articulo.mercadolivre.com.br) que
   *     nenhuma tela de vendedor usa.
   *   - CAMINHO: a estrutura NOVA (/up/MLBU...) e a de catalogo (/p/MLB...)
   *     ficam no host www.mercadolivre.com.br - o MESMO das telas de
   *     vendedor - entao o host sozinho nao basta. Nessas rotas o codigo do
   *     produto vem logo depois de "/up/" ou "/p/", as vezes seguido de mais
   *     um segmento: "/p/MLB.../s" e a lista de vendedores do catalogo,
   *     cheia de "+N vendas" de reputacao. Nenhuma tela de vendedor usa
   *     essas rotas.
   *
   * Comparar texto nao e confiavel - as palavras dos botoes mudam e, pior,
   * qualquer ocorrencia delas num <script> ou template oculto desligaria o
   * coletor sem deixar rastro. E ler o textContent de toda a pagina,
   * incluindo os JSONs dos scripts, era caro a cada varredura.
   *
   * Recebe a URL por parametro para poder ser testada fora do navegador.
   *
   * @param {string} url endereco da pagina (window.location.href)
   * @returns {boolean}
   */
  function ehPaginaDeCompra(url) {
    const host = new URL(url).hostname;
    const path = new URL(url).pathname;

    return host.indexOf("produto.mercadolivre") !== -1 ||
           host.indexOf("articulo.mercadolivre") !== -1 ||
           // "/up/MLBU1234567890" (layout novo) e "/p/MLB12345678" (catalogo),
           // no fim do caminho ou seguidos de outro segmento ("/p/MLB.../s").
           // O (\/|$) exige que o codigo termine ali: numa barra ou no fim.
           /\/up\/MLB[A-Z]?\d{6,}(\/|$)/.test(path) ||
           /\/p\/MLB\d{6,}(\/|$)/.test(path);
  }

  /**
   * Varre e guarda, se este for um lugar de onde se deve coletar.
   */
  function coletar() {
    if (ehPaginaDeCompra(window.location.href)) return;

    const achados = varrerPagina(document, window.location.href);

    // Nada capturado numa tela onde deveria haver algo. Em vez de apenas
    // desistir em silencio, registramos o que estava escrito na pagina.
    if (Object.keys(achados).length === 0) {
      salvarDiagnostico();
      return;
    }

    salvar(achados);

    // Deu certo aqui: guardamos o endereco para poder voltar sozinhos depois.
    lembrarOrigem(window.location.href);
  }

  // --------------------------------------------------------------------------
  // Atualizacao automatica
  // --------------------------------------------------------------------------

  /**
   * Guarda os enderecos onde a captura funcionou.
   *
   * Nao sabemos de antemao qual e a URL da tela de publicacoes - o ML pode
   * mudar, e varia conforme o tipo de conta. Entao em vez de adivinhar,
   * APRENDEMOS: toda vez que uma tela entrega numeros, anotamos o endereco
   * dela. Depois a extensao volta nesses enderecos por conta propria.
   *
   * Guardamos no maximo 3, mais recente primeiro, porque telas diferentes
   * podem entregar metricas diferentes.
   */
  function lembrarOrigem(url) {
    // Sem a query string: ela costuma ter filtros e paginacao que nao
    // queremos congelar, alem de eventuais identificadores de sessao.
    const limpa = url.split("?")[0];

    // Telas de UM anuncio tem o codigo (MLB...) no caminho, e nao prestam
    // para voltar depois: cada uma mostra so as metricas daquele anuncio.
    // Guarda-las acabaria enchendo as 3 vagas e expulsando a tela de
    // publicacoes - a unica que vale revisitar. O filtro e a mesma regra
    // usada para achar anuncios dentro da tela de vendas.
    if (limpa.match(PADRAO_CODIGO)) return;

    try {
      chrome.storage.local.get([CHAVE_ORIGENS], function (guardado) {
        if (chrome.runtime.lastError) return;  // contexto invalidado

        const origens = guardado[CHAVE_ORIGENS] || [];

        // Ja e a mais recente: nada a fazer, evita gravacao a toa.
        if (origens[0] === limpa) return;

        const atualizadas = [limpa]
          .concat(origens.filter(function (u) { return u !== limpa; }))
          .slice(0, 3);

        try {
          chrome.storage.local.set({ [CHAVE_ORIGENS]: atualizadas });
        } catch (e) {
          // contexto invalidado: origens nao sao essenciais, tenta depois
        }
      });
    } catch (e) {
      // contexto invalidado antes mesmo do callback
    }
  }

  /**
   * Busca as telas de vendedor sozinha e atualiza os numeros.
   *
   * E isto que faz os dados envelhecerem menos: em vez de depender de a
   * pessoa passar pela tela de publicacoes, a extensao vai buscar. Basta
   * ela ter QUALQUER pagina do Mercado Livre aberta.
   *
   * O fetch NAO acontece aqui - vai para o service worker (background.js).
   * No Manifest V3, fetch de content script carrega a origem da pagina e
   * esbarra em CORS quando a origem guardada nao e o mesmo subdominio
   * aberto. No service worker a origem e a da extensao, e com
   * host_permissions o CORS nao se aplica. A resposta volta como texto e o
   * parse continua aqui, reusando varrerPagina inteiro.
   *
   * Se a tela for montada por JavaScript no navegador, o HTML que chega
   * vem sem os numeros. Nesse caso varrerPagina nao acha nada, salvar()
   * ignora, e tudo segue funcionando pela captura normal - a atualizacao
   * automatica simplesmente nao acrescenta. Degradar assim, sem quebrar,
   * e proposital: nao sabemos ainda como essas telas sao construidas.
   */
  function atualizarEmSegundoPlano() {
    try {
      chrome.storage.local.get(
        [CHAVE_ORIGENS, CHAVE_ULTIMA_BUSCA],
        function (guardado) {
          if (chrome.runtime.lastError) return;  // contexto invalidado

          const origens = guardado[CHAVE_ORIGENS] || [];

          // Ainda nao aprendemos nenhuma tela de vendedor.
          if (origens.length === 0) return;

          const ultima = guardado[CHAVE_ULTIMA_BUSCA] || 0;

          // Trava de frequencia. Sem ela, cada aba do ML dispararia a busca,
          // e navegar pelo site viraria uma enxurrada de requisicoes.
          if (Date.now() - ultima < INTERVALO_BUSCA_MS) return;

          // Marcamos ANTES de buscar, nao depois: se marcassemos no fim,
          // varias abas abertas ao mesmo tempo passariam todas pela trava
          // antes da primeira terminar.
          try {
            chrome.storage.local.set({ [CHAVE_ULTIMA_BUSCA]: Date.now() });
          } catch (e) {
            return;  // contexto invalidado: nem tenta buscar
          }

          origens.forEach(function (url) {
            if (!chrome.runtime.sendMessage) {
              // Sem API de mensagem (nunca deveria no MV3): degrada em
              // silencio, a coleta local continua cobrindo.
              return;
            }

            try {
              chrome.runtime.sendMessage({ tipo: "buscar", url: url }, function (resposta) {
                if (chrome.runtime.lastError) return;  // SW dormiu/reiniciou

                if (!resposta || !resposta.ok) return;

                // DOMParser transforma o texto HTML num documento navegavel,
                // sem exibir nada na tela e sem executar os scripts dele.
                const doc = new DOMParser().parseFromString(resposta.html, "text/html");
                if (!doc.body) return;

                salvar(varrerPagina(doc, url), true);
              });
            } catch (e) {
              // contexto invalidado ao enviar a mensagem
            }
          });
        }
      );
    } catch (e) {
      // contexto invalidado antes mesmo do callback
    }
  }

  /**
   * Janela de texto em volta do rotulo, para o diagnostico.
   *
   * O pai do rotulo pode guardar coisa demais (titulo, preco, nome de
   * comprador). Perfurar ate o rotulo e mostrar so o que esta colado nele
   * mostra onde o numero costuma estar sem vazar o resto do card.
   *
   * @param {Node} no no de texto do rotulo
   * @param {string} rotulo texto do no, ja com trim
   * @returns {string}
   */
  function contextoDoTexto(no, rotulo) {
    const pai = no.parentElement;
    if (!pai) return rotulo;

    const todo = pai.textContent || "";
    const orig = no.nodeValue || "";

    // textContent concatena os nos filhos sem separador; procurar o
    // nodeValue original acha a posicao exata do rotulo.
    const pos = todo.indexOf(orig);
    if (pos === -1) return rotulo;

    const ANTES = 20;
    const DEPOIS = 80;
    const inicio = Math.max(0, pos - ANTES);
    const fim = Math.min(todo.length, pos + orig.length + DEPOIS);
    return todo.slice(inicio, fim).trim();
  }

  /**
   * Guarda uma amostra dos textos que PARECEM metrica mas nao viraram dado.
   *
   * Este e o plano de contingencia da extensao. A heuristica foi escrita sem
   * nunca termos visto as telas de vendedor de verdade, entao ela pode nao
   * reconhecer o formato que o ML usa. Quando isso acontece, quem esta do
   * outro lado so consegue dizer "nao apareceu nada" - e nao da para
   * consertar as cegas.
   *
   * Guardando os trechos de texto que contem as palavras-chave, mais uma
   * JANELA de texto em volta do rotulo (onde o numero costuma estar), fica
   * possivel ver como a tela e montada e ajustar de uma vez, sem varias
   * idas e vindas.
   *
   * Guardamos apenas trechos curtos que mencionam metricas - nao o conteudo
   * da pagina nem dados da conta de quem usa. A janela e estreita de
   * proposito: pegar o pai INTERO (o antigo slice(0,160)) capturava titulo do
   * anuncio, preco, nome de comprador e numero de pedido que por acaso
   * dividissem o mesmo elemento do rotulo - e essa amostra iria para o
   * clipboard no popup.
   */
  function salvarDiagnostico() {
    // Trava de frequencia POR TELA. Numa pagina do ML com DOM inquieto
    // (carrossel, lazy load), uma varredura sem captura acontece a cada 600ms;
    // sem trava, o diagnostico seria regravado a cada uma delas.
    //
    // Mas a trava nao pode ser so de tempo: a central de vendedor navega sem
    // recarregar a pagina (SPA), e uma trava de 3 minutos iniciada na tela
    // anterior impedia justamente a tela que interessa de gravar. Tela nova
    // grava na hora; a mesma tela, so depois do intervalo.
    const INTERVALO_DIAGNOSTICO_MS = 3 * 60 * 1000;
    const agora = Date.now();
    const caminho = caminhoMascarado(window.location.pathname);

    if (caminho === ultimoDiagnostico.caminho &&
        agora - ultimoDiagnostico.quando < INTERVALO_DIAGNOSTICO_MS) {
      return;
    }

    // Marcamos antes de varrer, e nao so quando ha amostra: pagina sem
    // nenhuma palavra-chave tambem precisa da trava, senao seria varrida
    // inteira a cada 600ms so para descobrir que nao tem nada.
    ultimoDiagnostico = { caminho: caminho, quando: agora };

    const amostras = coletarAmostras(document);
    if (amostras.length === 0) return;

    try {
      chrome.storage.local.set({
        [CHAVE_DIAGNOSTICO]: {
          // Host e a FORMA do caminho (ver caminhoMascarado). A query nunca
          // entra - pode carregar identificador de sessao - e o caminho cru
          // pode carregar codigo de produto, id de vendedor e titulo. Mascarado,
          // ele diz de QUAL TELA veio o diagnostico (so o host valia para o
          // site inteiro) sem levar nada disso para o clipboard.
          host: window.location.hostname,
          caminho: caminho,
          quando: agora,
          amostras: amostras
        }
      });
    } catch (e) {
      // Contexto invalidado: diagnostico nao e essencial, proximo ciclo tenta.
    }
  }

  /**
   * Junta as amostras de texto que PARECEM metrica, com a janela em volta.
   *
   * Separada de salvarDiagnostico porque o diagnostico pedido pelo popup
   * (diagnosticarTelaAtual) faz a mesma coleta sem gravar nada.
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
      aceitarNoDeTextoTecnico
    );

    let no = caminhante.nextNode();

    // Paramos em 25 amostras: o suficiente para entender o padrao da tela
    // sem encher o storage nem gerar um relatorio impossivel de ler.
    while (no && amostras.length < 25) {
      const texto = (no.nodeValue || "").trim();
      const minusculo = texto.toLowerCase();
      const elemento = no.parentElement;

      // O proprio painel ("Visitas totais", "Vendas") nao e texto do ML. Sem
      // esta guarda, o diagnostico de uma pagina de anuncio viria cheio da
      // saida da extensao em vez do que o site mostra.
      const daExtensao = Boolean(elemento &&
        elemento.closest("#mlmetrics-painel, #mlmetrics-aviso"));

      const pareceMetrica = Object.keys(ROTULOS).some(function (metrica) {
        return ROTULOS[metrica].some(function (palavra) {
          return minusculo.indexOf(palavra) !== -1;
        });
      });

      // O limite de tamanho descarta paragrafos: se o texto e longo, e
      // prosa mencionando a palavra, nao um rotulo de metrica.
      if (!daExtensao && pareceMetrica && texto.length > 0 && texto.length < 120) {
        amostras.push({
          texto: texto,
          // Janela em volta do rotulo, nao o pai inteiro. Pegar o pai todo
          // arrastava titulo, preco, nome de comprador e numero de pedido
          // que compartilhassem o mesmo elemento - dado de conta que nao
          // devia sair daqui. O numero que queremos ver fica colado no
          // rotulo, entao 20 antes + 80 depois bastam para entender o
          // formato; o resto do card fica de fora de proposito.
          contexto: contextoDoTexto(no, texto)
        });
      }

      no = caminhante.nextNode();
    }

    return amostras;
  }

  /**
   * Caminho da URL com o que pode identificar alguem trocado por marcas.
   *
   * O diagnostico precisa dizer EM QUAL TELA a leitura aconteceu - so o host
   * ("www.mercadolivre.com.br") vale para o site inteiro e nao separa a
   * homepage de "Minhas publicacoes". Mas o caminho completo pode carregar
   * codigo de anuncio, id de vendedor e o titulo do produto. Guardamos a
   * FORMA da rota, sem esses dados:
   *
   *   /anuncios/lista                        -> /anuncios/lista
   *   /vendas/12345678/detalhe               -> /vendas/#/detalhe
   *   /kit-2-caixa-organizadora/up/MLBU123   -> /(titulo)/up/MLBU#
   *
   * Titulo e reconhecido pelo formato de slug: muitas palavras ligadas por
   * hifen. Rota de sistema tem no maximo tres ("publicaciones-y-ventas").
   *
   * @param {string} caminho pathname da URL
   * @returns {string}
   */
  function caminhoMascarado(caminho) {
    return caminho.split("/").map(function (trecho) {
      // Slug de titulo: muitas palavras ligadas por hifen.
      if (trecho.split("-").length > 3) return "(titulo)";

      // Codigo de anuncio, id de vendedor, numero de pedido: os digitos somem,
      // a letra do prefixo fica ("MLBU#") - ela diz o TIPO de codigo.
      return trecho.replace(/\d+/g, "#");
    }).join("/");
  }

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
   * @returns {Object}
   */
  function diagnosticarTelaAtual() {
    const url = window.location.href;
    const vitrine = ehPaginaDeCompra(url);

    return {
      host: window.location.hostname,
      caminho: caminhoMascarado(window.location.pathname),
      // Trava 1: vitrine publica nunca e varrida pelo coletor.
      vitrine: vitrine,
      // Trava 2: pagina sem "visita" fora do painel nao e tela de vendedor.
      mencionaVisita: paginaMencionaVisita(document),
      // O que o coletor gravaria se varresse agora ({} = nada passou pelas
      // travas). Em vitrine ele nem varre, entao fica null.
      capturariaAgora: vitrine ? null : varrerPagina(document, url),
      amostras: coletarAmostras(document)
    };
  }

  /**
   * Diz se a extensao ainda esta viva para este script.
   *
   * Quando a extensao e recarregada ou atualizada em chrome://extensions, os
   * scripts que ja estavam nas abas abertas NAO sao trocados pela versao
   * nova: ficam orfaos, sem acesso ao chrome.storage, e o navegador so
   * injeta a versao nova quando a pagina e recarregada (F5). O sinal de
   * orfandade e o chrome.runtime.id sumir.
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

  // O popup pede o diagnostico DESTA aba quando a pessoa clica em "Copiar
  // diagnostico" (ver diagnosticarTelaAtual). A varredura e sincrona, entao
  // respondemos na hora, sem abrir canal assincrono.
  try {
    chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
      if (!mensagem || mensagem.tipo !== "diagnosticar") return;

      // So a propria extensao pode pedir: outra origem nao dispara varredura.
      if (remetente.id !== chrome.runtime.id) return;

      if (!document.body) {
        responder({ erro: "pagina sem body" });
        return;
      }

      responder(diagnosticarTelaAtual());
    });
  } catch (e) {
    // Contexto invalidado: o popup relata que a aba nao respondeu.
  }

  // Varre uma vez de imediato e liga o observador SO se houver body.
  // Em pagina sem body (XML/SVG aberto direto), nao ha o que varrer e o
  // observer nao pode ser amarrado a um alvo nulo; com a "file:///*" fora
  // do manifest isso quase nao acontece mais, mas e absurdamente barato
  // garantir que nenhuma excecao escape quando acontecer.
  if (document.body) {
    // Varre uma vez: se a pagina ja veio pronta do servidor, os numeros
    // estao la e nao ha o que esperar.
    coletar();

    // Busca automatica: so no site do ML, nunca nos arquivos de teste locais.
    if (window.location.hostname.indexOf("mercadolivre") !== -1) {
      atualizarEmSegundoPlano();
    }

    // Mas telas de vendedor costumam montar a lista por JavaScript, depois
    // do carregamento. Em vez de apostar num tempo fixo ("espera 1,5s e
    // torce"), observamos o DOM e reagimos quando o conteudo chega - funcione
    // a conexao rapida ou lenta.
    let agendado = null;

    /**
     * Diz se uma mutacao do DOM vem da propria extensao.
     *
     * O painel e o aviso sao adicionados e removidos pelo content.js/coletor.
     * Sem esta filtragem, criar o aviso disparava uma mutacao, que reagendava
     * a varredura, que nao achava nada de novo, e por ai em diante - um laco
     * de trabalho inutil que encarecia a navegacao. A varredura ja ignora o
     * texto do painel; aqui paramos o estopim antes dele acontecer.
     *
     * @param {MutationRecord} mutacao
     * @returns {boolean}
     */
    function mutacaoDaExtensao(mutacao) {
      if (mutacao.target && mutacao.target.closest &&
          mutacao.target.closest("#mlmetrics-painel, #mlmetrics-aviso")) {
        return true;
      }

      // Remocao nao tem mais o alvo no DOM, entao checamos os nos removidos.
      const lista = [];
      if (mutacao.addedNodes) lista.push.apply(lista, Array.from(mutacao.addedNodes));
      if (mutacao.removedNodes) lista.push.apply(lista, Array.from(mutacao.removedNodes));

      return lista.some(function (n) {
        return n.nodeType === 1 &&
               (n.id === "mlmetrics-painel" || n.id === "mlmetrics-aviso");
      });
    }

    const observador = new MutationObserver(function (mutacoes) {
      // Extensao recarregada: este script ficou orfao (ver extensaoViva).
      // Continuar varrendo a cada mutacao so gastaria a CPU da aba sem nunca
      // conseguir gravar. Desligamos tudo; a versao nova entra no F5.
      if (!extensaoViva()) {
        observador.disconnect();
        clearTimeout(agendado);
        return;
      }

      // Mudo o DOM da extensao: nao e conteudo do ML, nao vale re-varrer.
      if (mutacoes.some(mutacaoDaExtensao)) return;

      // DEBOUNCE: montar uma lista dispara centenas de mutacoes seguidas.
      // Varrer a cada uma travaria a pagina. Entao cada mutacao CANCELA a
      // varredura agendada e marca outra - o efeito e varrer uma unica vez,
      // 600ms depois que as mudancas pararem.
      clearTimeout(agendado);

      // A conferencia se repete no disparo: a extensao pode ter sido
      // recarregada durante os 600ms de espera.
      agendado = setTimeout(function () {
        if (extensaoViva()) coletar();
      }, 600);
    });

    observador.observe(document.body, {
      childList: true,  // elementos adicionados ou removidos
      subtree: true     // em qualquer profundidade, nao so nos filhos diretos
      // Nao observamos "characterData" (texto alterado no lugar) de proposito:
      // dobraria o volume de eventos para ganhar pouco, ja que o ML troca os
      // elementos inteiros em vez de editar o texto dentro deles.
    });
  }
})();
