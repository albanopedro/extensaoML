// ============================================================================
// LEITURA - o que e numero, de qual rotulo e de qual anuncio
//
// A parte da captura que so LE: recebe um documento e um endereco e devolve
// os numeros achados, cada um com o rastro de origem. Nao toca em
// chrome.storage, em mensagens nem em window.location - tudo entra por
// parametro. Saiu do coletor.js por dois motivos:
//
//   - o coletor.js tinha passado de 2 mil linhas, misturando a leitura com
//     gravacao, observer, busca automatica e diagnostico;
//   - o teste em Node (teste/test-parsing.js) carrega este arquivo como ele
//     e. Com tudo preso dentro do IIFE do coletor, o teste precisava recortar
//     cada funcao do texto do arquivo por marcadores - e uma mudanca de
//     formato quebrava o recorte, nao a funcao.
//
// ESTRATEGIA: nao usamos seletores CSS fixos (tipo ".andes-card span").
// Seletores assim quebram no primeiro redesenho de layout, e nem sabemos
// como e o HTML dessas telas. Em vez disso procuramos pelo SIGNIFICADO:
// achamos a palavra "visitas" no texto e pegamos o numero mais proximo.
// E mais resistente a mudancas do site.
//
// Carregado antes do diagnostico.js e do coletor.js (ordem do manifest), que
// usam tudo por MLMetricsLeitura.
// ============================================================================

var MLMetricsLeitura = (function () {
  "use strict";

  // Ate quantos niveis subir no DOM procurando o codigo do anuncio.
  // 12 e folgado o suficiente para atravessar a arvore de um card de lista
  // sem sair varrendo a pagina inteira.
  const MAX_NIVEIS = 12;

  // Maior texto (em caracteres) que a busca pelo valor le num nivel do DOM.
  // Um card de lista tem centenas de caracteres; acima disso ja e um pedaco
  // grande da pagina, onde nao ha numero "colado" no rotulo a descobrir.
  const LIMITE_TEXTO_POR_NIVEL = 5000;

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
   * Valor de um rotulo no texto: "359 visitas" -> 359, "Visitas: 359" -> 359.
   *
   * O nome e historico - a primeira versao so olhava o numero ANTES do
   * rotulo. Hoje quem decide e lerRotulo, que explica as regras; aqui fica
   * so o numero, ou null quando nao ha leitura segura.
   *
   * @param {string} texto
   * @param {string} palavra rotulo procurado, em minusculo
   * @returns {number|null}
   */
  function numeroAntesDe(texto, palavra) {
    const leitura = lerRotulo(texto, palavra);
    return (leitura && leitura.valor !== undefined) ? leitura.valor : null;
  }

  /**
   * Le o valor de um rotulo olhando a FILA de numeros e rotulos em volta dele.
   *
   * O ML pode escrever o valor antes ou depois do rotulo, e quando varias
   * metricas ficam lado a lado o mesmo numero fica ENTRE dois rotulos:
   *
   *   "359 visitas 12 vendas"       -> valor antes do rotulo  (12 e das vendas)
   *   "Visitas: 359 | Vendas: 12"   -> valor depois do rotulo (359 e das visitas)
   *
   * Olhar so o vizinho imediato erra um dos dois formatos - e erra com numero
   * plausivel: "359 visitas 12 vendas 5 disponiveis" dava 5 vendas. Por isso
   * montamos a fila de pecas COLADAS em volta do rotulo (numero, rotulo,
   * numero, rotulo...; colado = entre uma peca e a outra so espaco e
   * pontuacao, nunca palavra) e deixamos as PONTAS da fila dizerem o formato:
   *
   *   comeca com numero e termina com rotulo   -> valor antes    (N R N R)
   *   comeca com rotulo e termina com numero   -> valor depois   (R N R N)
   *   comeca e termina com numero              -> ambiguo        (N R N)
   *   comeca e termina com rotulo              -> ambiguo        (R N R)
   *
   * Ambiguo nao vira leitura: na duvida, nao mostramos. O mesmo vale quando o
   * numero escolhido nao e contagem - decimal, data, hora, percentual,
   * periodo, preco, ano, faixa "+1.000" (ver motivoDoNumero).
   *
   * Entre varias ocorrencias do rotulo vale a ULTIMA que comeca uma palavra:
   * telas repetem o rotulo em recortes ("visitas hoje", "visitas totais") e a
   * ultima costuma ser o total. "revenda" nao conta como "venda".
   *
   * A posicao devolvida (inicio e fim) alimenta o rastro de origem (ver
   * trechoDaLeitura) e o diagnostico das recusas.
   *
   * @param {string} texto
   * @param {string} palavra rotulo procurado, em minusculo
   * @returns {Object|null} valor, inicio e fim quando ha leitura; recusa,
   *                        inicio e fim quando ha numero mas ele nao pode ser
   *                        usado; null quando nada esta colado no rotulo
   */
  function lerRotulo(texto, palavra) {
    if (!texto) return null;

    const pecas = pecasDoTexto(texto);

    // A ultima peca de rotulo que comeca com a palavra procurada.
    let indice = -1;
    for (let i = pecas.length - 1; i >= 0; i--) {
      if (pecas[i].tipo === "rotulo" && pecas[i].palavra.indexOf(palavra) === 0) {
        indice = i;
        break;
      }
    }
    if (indice === -1) return null;

    // Estende a fila para os dois lados enquanto as pecas se alternam
    // (numero, rotulo, numero...) e continuam coladas.
    let primeira = indice;
    while (primeira > 0 &&
           pecas[primeira - 1].tipo !== pecas[primeira].tipo &&
           pecasColadas(texto, pecas[primeira - 1], pecas[primeira])) {
      primeira--;
    }

    let ultima = indice;
    while (ultima < pecas.length - 1 &&
           pecas[ultima + 1].tipo !== pecas[ultima].tipo &&
           pecasColadas(texto, pecas[ultima], pecas[ultima + 1])) {
      ultima++;
    }

    // Rotulo sozinho: nenhum numero colado nele neste texto.
    if (primeira === ultima) return null;

    const comecaComNumero = pecas[primeira].tipo === "numero";
    const terminaComNumero = pecas[ultima].tipo === "numero";

    if (comecaComNumero === terminaComNumero) {
      return {
        recusa: comecaComNumero
          ? "numero dos dois lados do rotulo (ambiguo)"
          : "numero entre dois rotulos (ambiguo)",
        inicio: pecas[primeira].inicio,
        fim: pecas[ultima].fim
      };
    }

    // Fila que comeca com numero: cada rotulo e dono do numero ANTES dele.
    // Fila que comeca com rotulo: cada rotulo e dono do numero DEPOIS dele.
    const rotulo = pecas[indice];
    const numero = comecaComNumero ? pecas[indice - 1] : pecas[indice + 1];
    const inicio = Math.min(numero.inicio, rotulo.inicio);
    const fim = Math.max(numero.fim, rotulo.fim);

    if (numero.motivo) {
      return { recusa: numero.motivo, inicio: inicio, fim: fim };
    }

    return { valor: numero.valor, inicio: inicio, fim: fim };
  }

  /**
   * Quebra o texto nas pecas que importam para a leitura: NUMEROS e ROTULOS.
   *
   * Rotulo e toda palavra que COMECA com um rotulo conhecido: as metricas
   * (ROTULOS) e as quantidades que costumam aparecer ao lado delas nas telas
   * de vendedor. Sem conhecer "Estoque" como rotulo, o 12 de
   * "Estoque: 12 | Vendas" pareceria ser das vendas. Logo depois do rotulo
   * absorvemos ate dois qualificadores ("Visitas totais", "Vendas do mes"),
   * para que eles nao partam a fila.
   *
   * Numero leva junto o motivo de nao ser contagem, quando houver. Mesmo sem
   * servir, continua sendo peca: um preco colado no rotulo ocupa o lugar do
   * valor, e o rotulo fica sem leitura - em vez de pular o preco e pegar um
   * numero mais longe.
   *
   * @param {string} texto
   * @returns {Object[]} pecas em ordem de posicao
   */
  function pecasDoTexto(texto) {
    const pecas = [];

    const donos = [].concat(
      ROTULOS.visitas,
      ROTULOS.vendas,
      ["estoque", "dispon", "quantidade", "unidade", "pergunta", "favorit", "avalia", "opini"]
    );

    // Palavras inteiras, com acento (mesmos intervalos de temLetra).
    const palavras = /[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]+/g;

    // Qualificadores que podem ficar entre o rotulo e o valor.
    const qualificador = /^\s+(totais|total|hoje|acumulad[ao]s?|brutas?|concretizadas?|realizadas?|[u\u00FA]nic[ao]s|no|na|do|da|per[i\u00ED]odo|m[e\u00EA]s)(?![a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF])/i;

    let achado;

    while ((achado = palavras.exec(texto)) !== null) {
      const palavra = achado[0].toLowerCase();

      const ehRotulo = donos.some(function (dono) {
        return palavra.indexOf(dono) === 0;
      });
      if (!ehRotulo) continue;

      let fim = achado.index + achado[0].length;

      for (let i = 0; i < 2; i++) {
        const extra = texto.slice(fim, fim + 40).match(qualificador);
        if (!extra) break;
        fim += extra[0].length;
      }

      pecas.push({ tipo: "rotulo", palavra: palavra, inicio: achado.index, fim: fim });

      // A busca continua depois dos qualificadores ja absorvidos.
      palavras.lastIndex = fim;
    }

    // Datas e horas entram como UMA peca ("14/09", "01.02.2023", "14:32"):
    // sem isso, "01/02/2023" viraria tres numeros colados.
    const numeros = /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?!\d)|\d{1,2}\.\d{1,2}\.\d{4}(?!\d)|\d{1,2}:\d{2}(?!\d)|\d[\d.,]*/g;

    while ((achado = numeros.exec(texto)) !== null) {
      const inicio = achado.index;
      const fim = inicio + achado[0].length;

      pecas.push({
        tipo: "numero",
        valor: paraInteiro(achado[0]),
        motivo: motivoDoNumero(texto, inicio, fim),
        inicio: inicio,
        fim: fim
      });
    }

    return pecas.sort(function (a, b) {
      return a.inicio - b.inicio;
    });
  }

  /**
   * Diz se duas pecas vizinhas estao COLADAS: entre elas so espaco e no
   * maximo tres sinais (": ", " | ", " - ", " (") - nunca uma palavra.
   *
   * @param {string} texto
   * @param {Object} a peca da esquerda
   * @param {Object} b peca da direita
   * @returns {boolean}
   */
  function pecasColadas(texto, a, b) {
    const vao = texto.slice(a.fim, b.inicio);
    if (temLetra(vao)) return false;
    return vao.replace(/\s+/g, "").length <= 3;
  }

  /**
   * Diz por que um numero NAO e uma contagem - ou null quando e.
   *
   *   "14/09", "14:32", "01.02.2023"   -> data ou hora
   *   "26,65"                          -> decimal (preco, media)
   *   "12%", "30 dias", "12 mil"       -> seguido de unidade
   *   "R$ 49"                          -> preco
   *   "+1.000"                         -> faixa arredondada
   *   "desde 2024"                     -> ano
   *
   * So olha uma janela curta em volta do numero: o texto de um nivel do DOM
   * pode ser grande, e copiar o texto inteiro para cada numero seria caro.
   *
   * @param {string} texto o texto inteiro
   * @param {number} inicio posicao do numero
   * @param {number} fim posicao logo depois do numero
   * @returns {string|null}
   */
  function motivoDoNumero(texto, inicio, fim) {
    const bruto = texto.slice(inicio, fim);
    const antes = texto.slice(Math.max(0, inicio - 40), inicio);
    const depois = texto.slice(fim, fim + 40);

    if (/[\/:]/.test(bruto) || ehData(bruto)) return "data ou hora";

    // FORMA de data com ponto, valida ou nao. "31.04.2023" nao existe no
    // calendario, entao o ehData diz "nao e data" - mas tambem nao e
    // contagem: sem esta linha o numero virava 31.042.023 visitas. A barra e
    // os dois-pontos ja caem no teste acima; aqui sobra o ponto. Milhar de
    // verdade nao casa, porque o grupo do meio tem tres digitos
    // ("1.299.500").
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(bruto)) return "data ou hora";
    if (bruto.indexOf(",") !== -1) return "decimal (preco ou media)";
    if (seguidoDeUnidade(depois)) return "seguido de unidade (%, periodo, mil)";

    // "R$ 49 vendas": preco inteiro colado no rotulo.
    if (/R\$\s*$/i.test(antes)) return "preco";

    // "+1.000 vendidos": faixa arredondada que o ML mostra em pagina publica e
    // na reputacao do vendedor. Nunca e a contagem exata.
    if (/\+\s*$/.test(antes)) return "faixa arredondada (+N)";

    const valor = paraInteiro(bruto);
    if (valor === null) return "nao e numero inteiro";

    // "Ativo desde 2024": ano, nao quantidade. So com o "desde" - "2024
    // vendas" sozinho pode ser contagem real de um anuncio popular.
    if (valor >= 1900 && valor <= 2099 && /desde\s+$/i.test(antes)) {
      return "ano (desde ...)";
    }

    return null;
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

    if (mes < 1 || mes > 12) return false;
    if (dia < 1) return false;

    // Meses com no maximo 30 dias: abril, junho, setembro, novembro.
    // Fevereiro aceita 29 (ano bisexto existe) - nao vamos validar bisexto
    // porque so precisamos distinguir data de metrica, nao validar calendario.
    const DIAS_MAXIMOS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (dia > DIAS_MAXIMOS[mes]) return false;

    return true;
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
   * Procura o codigo do anuncio (MLB...) a partir de um elemento.
   *
   * Numa lista de publicacoes cada card tem um link para o anuncio, entao
   * subimos pelos ancestrais e, em cada nivel, procuramos um link com MLB
   * no endereco. Paramos no primeiro que achar.
   *
   * @param {Element} elemento ponto de partida
   * @param {Document} doc
   * @param {string} url endereco da pagina
   * @param {Object} [saida] quando passado, recebe em "motivo" por que nao
   *                         deu para definir o anuncio (para o diagnostico)
   * @returns {Object|null} codigo e limite - ou null
   */
  function contextoDoAnuncio(elemento, doc, url, saida) {
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
        if (codigos.length > 1) {
          if (saida) {
            saida.motivo = "bloco com " + codigos.length +
              " anuncios: nao da para saber de qual e o rotulo";
          }
          return null;
        }
      }

      atual = atual.parentElement;
    }

    if (saida) {
      saida.motivo = "nenhum link de anuncio (MLB) perto do rotulo";
    }
    return null;
  }

  /**
   * Lista os codigos de anuncio distintos que aparecem dentro de um elemento.
   *
   * Um card de "Minhas publicacoes" pode ter link do ITEM e tambem link do
   * produto de CATALOGO (/p/MLB...) ou do user product (/up/MLBU...) do mesmo
   * anuncio. Contados juntos, dariam dois codigos - e o card seria ignorado
   * por ambiguidade (#38). Por isso separamos pelo ENDERECO do link: havendo
   * exatamente UM item, os links de catalogo/user product em volta sao do
   * mesmo anuncio, e o codigo e o do item - que e tambem o que o painel procura
   * primeiro (ver codigosDaPagina no calculo.js). Dois itens diferentes
   * continuam sendo ambiguidade.
   *
   * @param {Element} elemento
   * @returns {string[]}
   */
  function codigosDentroDe(elemento) {
    const links = elemento.querySelectorAll('a[href*="MLB"]');
    const itens = [];
    const agrupadores = [];

    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute("href") || "";
      const achado = href.match(PADRAO_CODIGO);
      if (!achado) continue;

      const codigo = achado[1] + achado[2];

      // Catalogo (/p/) e user product (/up/) agrupam anuncios; o resto e o
      // proprio anuncio.
      const lista = /\/(p|up)\/MLB/.test(href) ? agrupadores : itens;

      // O mesmo anuncio costuma ter varios links no card (a foto, o titulo,
      // o botao). Contam como um so - por isso guardamos apenas os distintos.
      if (lista.indexOf(codigo) === -1) lista.push(codigo);
    }

    // Havendo item, valem so os itens (um so = e dele; dois = ambiguo). Sem
    // item nenhum, vale o que houver de catalogo/user product, pela mesma regra.
    return itens.length > 0 ? itens : agrupadores;
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
   * acima numero e rotulo acabam no mesmo texto - e ai lerRotulo() resolve.
   * Paramos no primeiro nivel que der resposta, porque subir demais comeca a
   * misturar dados de outros anuncios da mesma pagina.
   *
   * @param {Element} elemento
   * @param {string} palavra
   * @returns {Object|null} valor e trecho quando leu; recusa e trecho quando
   *                        achou numero que nao pode usar; null sem nada
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

        // Bloco grande demais: paramos de subir. Numero e rotulo colados nunca
        // precisam de um bloco desse tamanho, e a leitura custa proporcional ao
        // texto - medido: cerca de 7 ms num bloco de 100 mil caracteres,
        // repetido para cada rotulo e cada nivel. Numa pagina em que o codigo
        // vem da URL (o limite e o body), isso podia travar a aba a cada
        // varredura.
        if (texto.length > LIMITE_TEXTO_POR_NIVEL) return null;

        const leitura = lerRotulo(texto, palavra);

        if (leitura !== null) {
          // O RASTRO: o pedaco de texto exato em que o numero foi lido (ou
          // recusado), neste nivel do DOM.
          const trecho = trechoDaLeitura(texto, leitura);

          // Leitura recusada (ambigua, preco, data...): paramos de subir. Um
          // nivel acima o texto so fica maior, e a fila pode parecer
          // resolvida por acidente - colando o numero no rotulo errado.
          if (leitura.recusa) return { recusa: leitura.recusa, trecho: trecho };

          return { valor: leitura.valor, trecho: trecho };
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
   * @param {Document} doc
   * @param {string} url endereco da pagina
   * @param {Array} [recusas] quando passado (so no diagnostico), recebe cada
   *                          rotulo que NAO virou numero, com o motivo
   * @returns {Object} mapa { MLB123: { visitas: 359 }, ... }
   */
  function varrerPagina(doc, url, recusas) {
    // Pagina sem "visita" nao e tela de vendedor: qualquer "vendido" que ela
    // mostre pertence a produto publico de OUTRO vendedor. A varredura
    // inteira e descartada antes de comecar (sairia daqui cheia de numeros
    // com cara de certo, que e o pior modo de erro deste coletor).
    if (!paginaMencionaVisita(doc)) return {};

    const resultado = {};

    // Em qual tela a leitura acontece, para o rastro de origem. Mascarado
    // (ver caminhoMascarado): diz a FORMA da rota, sem codigo nem titulo.
    let tela;
    try {
      tela = caminhoMascarado(new URL(url).pathname);
    } catch (e) {
      tela = "(url invalida)";
    }

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
          const saida = {};
          const contexto = contextoDoAnuncio(elemento, doc, url, saida);

          // Rotulo sem anuncio definido: no diagnostico, anota o porque.
          if (!contexto && recusas) {
            recusas.push({
              motivo: saida.motivo,
              trecho: contextoDoTexto(no, (no.nodeValue || "").trim())
            });
          }

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
                // Sem leitura, ou com leitura recusada, nada vai para o cache -
                // e o diagnostico (quando pedido) guarda o porque. E isso que
                // responde "por que as vendas nao apareceram?".
                if (leitura === null || leitura.recusa) {
                  if (recusas) {
                    recusas.push({
                      codigo: codigo,
                      metrica: metrica,
                      motivo: leitura ? leitura.recusa : "nenhum numero colado ao rotulo",
                      trecho: leitura
                        ? leitura.trecho
                        : contextoDoTexto(no, (no.nodeValue || "").trim())
                    });
                  }
                  return;
                }

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
      } else if (recusas) {
        const origemVendas = resultado[codigo].origem.vendas;
        recusas.push({
          codigo: codigo,
          metrica: "vendas",
          motivo: "anuncio sem visitas lidas nesta tela (trava contra produto de outro vendedor)",
          trecho: origemVendas ? origemVendas.trecho : ""
        });
      }
    });

    return anotarImplausiveis(comVisitas, recusas);
  }

  /**
   * Anota as leituras em que as vendas passam das visitas - sem descartar.
   *
   * A regra antiga era "e impossivel vender mais do que visitar", e o anuncio
   * inteiro era descartado. Nao e impossivel (#40): no ML "vendidos" conta
   * UNIDADES, e um comprador leva varias numa visita so. Descartar apagava em
   * silencio justamente o anuncio que vende em quantidade.
   *
   * Hoje os numeros ficam - cada um com o rastro de onde saiu, para ser
   * conferido - e o painel mostra um alerta (content.js). Aqui so registramos
   * no console e, quando o diagnostico pede, na lista de recusas como AVISO.
   *
   * @param {Object} resultado
   * @param {Array} [recusas] quando passado, recebe um aviso por anuncio
   * @returns {Object} o proprio resultado, sem tirar nada
   */
  function anotarImplausiveis(resultado, recusas) {
    Object.keys(resultado).forEach(function (codigo) {
      const dados = resultado[codigo];

      // So da para comparar quando temos as duas metricas.
      const comparavel = (dados.visitas !== undefined && dados.vendas !== undefined);
      if (!comparavel || dados.vendas <= dados.visitas) return;

      console.warn(
        "[ML METRICS] vendas acima das visitas em " + codigo +
        ": " + dados.vendas + " vendas para " + dados.visitas + " visitas"
      );

      if (recusas) {
        recusas.push({
          codigo: codigo,
          motivo: "aviso: vendas acima das visitas (numeros mantidos, o painel mostra alerta)",
          trecho: dados.vendas + " vendas, " + dados.visitas + " visitas"
        });
      }
    });

    return resultado;
  }

  /**
   * Janela de texto em volta do rotulo, para o diagnostico e para o trecho
   * das recusas da varredura.
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
   * Le o "N vendido(s)" DO ANUNCIO numa pagina publica de produto.
   *
   * A pagina de produto nao mostra visitas - elas so existem para quem e dono
   * do anuncio. Mas mostra quantas unidades ja foram vendidas, e esse numero
   * e do anuncio. E o unico dado real que da para mostrar a quem abre um
   * anuncio que nao e seu.
   *
   * O perigo aqui tem historia: a mesma pagina traz "+1000 vendas" da
   * REPUTACAO do vendedor e "+100 vendidos" dos produtos recomendados. Ler
   * isso sem cuidado foi o pior defeito do projeto (#34), com um anuncio de
   * uma venda exibindo mil. As travas, em camadas:
   *
   *   - so a palavra "vendido/vendida", nunca "venda/vendas" - a reputacao
   *     do vendedor fala em "vendas";
   *   - numero exato colado ao rotulo (lerRotulo); "+100", "+1.000" e
   *     "+10mil" sao recusados por motivoDoNumero;
   *   - se sobrar MAIS DE UM valor diferente na pagina, nao devolve nada:
   *     na duvida, nao mostra.
   *
   * Conferido na pagina real salva: o anuncio aparece uma vez ("Novo | 1
   * vendido") e todos os outros sao "+N vendidos", que caem nas recusas.
   *
   * @param {Document} doc
   * @returns {Object|null} { valor, trecho } ou null
   */
  function vendidosDaPagina(doc) {
    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      aceitarNoDeTextoTecnico
    );

    const achados = [];
    let no = caminhante.nextNode();

    while (no) {
      const texto = (no.nodeValue || "").trim();
      const elemento = no.parentElement;
      const daExtensao = Boolean(elemento &&
        elemento.closest("#mlmetrics-painel, #mlmetrics-aviso"));

      // Texto curto: "1 vendido" e um rotulo, nao um paragrafo que menciona
      // a palavra.
      if (!daExtensao && texto.length > 0 && texto.length < 120 &&
          /vendid[oa]s?/i.test(texto)) {
        const leitura = lerRotulo(texto.toLowerCase(), "vendid");

        if (leitura && leitura.valor !== undefined &&
            !achados.some(function (achado) { return achado.valor === leitura.valor; })) {
          achados.push({ valor: leitura.valor, trecho: trechoDaLeitura(texto, leitura) });
        }
      }

      no = caminhante.nextNode();
    }

    return achados.length === 1 ? achados[0] : null;
  }

  // --------------------------------------------------------------------------
  // Escopo e endereco
  // --------------------------------------------------------------------------

  /**
   * Diz se esta tela JA entregou numeros alguma vez (esta na lista de
   * origens aprendidas).
   *
   * Serve para separar "tela que nunca deu nada" de "tela que dava e parou".
   * A primeira e a maioria das paginas do ML e nao significa nada; a segunda
   * e sinal de que o site mudou (ver marcarTelaFalhando no coletor.js).
   *
   * Compara sem a query, do mesmo jeito que as origens sao guardadas: os
   * filtros e a paginacao da tela mudam a query o tempo todo.
   *
   * @param {string} url endereco da pagina
   * @param {string[]|undefined} origens telas que ja entregaram numeros
   * @returns {boolean}
   */
  function ehOrigemConhecida(url, origens) {
    const limpa = String(url).split("?")[0];

    return (origens || []).some(function (origem) {
      return origem === limpa;
    });
  }

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
    let host;
    let path;

    try {
      const endereco = new URL(url);
      host = endereco.hostname;
      path = endereco.pathname;
    } catch (e) {
      return false;  // endereco invalido: nao e vitrine
    }

    return host.indexOf("produto.mercadolivre") !== -1 ||
           host.indexOf("articulo.mercadolivre") !== -1 ||
           // "/up/MLBU1234567890" (layout novo) e "/p/MLB12345678" (catalogo),
           // no fim do caminho ou seguidos de outro segmento ("/p/MLB.../s").
           // O (\/|$) exige que o codigo termine ali: numa barra ou no fim.
           /\/up\/MLB[A-Z]?\d{6,}(\/|$)/.test(path) ||
           /\/p\/MLB\d{6,}(\/|$)/.test(path);
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

  // Tudo publico. O coletor.js e o diagnostico.js usam as funcoes de varrer,
  // de escopo e de endereco; as pecas menores (paraInteiro, lerRotulo...)
  // ficam expostas para o teste em Node cobrar cada uma diretamente.
  return {
    MAX_NIVEIS: MAX_NIVEIS,
    LIMITE_TEXTO_POR_NIVEL: LIMITE_TEXTO_POR_NIVEL,
    ROTULOS: ROTULOS,
    PADRAO_CODIGO: PADRAO_CODIGO,
    paraInteiro: paraInteiro,
    numeroAntesDe: numeroAntesDe,
    lerRotulo: lerRotulo,
    pecasDoTexto: pecasDoTexto,
    pecasColadas: pecasColadas,
    motivoDoNumero: motivoDoNumero,
    temLetra: temLetra,
    ehData: ehData,
    seguidoDeUnidade: seguidoDeUnidade,
    contextoDoAnuncio: contextoDoAnuncio,
    codigosDentroDe: codigosDentroDe,
    valorDoRotulo: valorDoRotulo,
    trechoDaLeitura: trechoDaLeitura,
    aceitarNoDeTextoTecnico: aceitarNoDeTextoTecnico,
    paginaMencionaVisita: paginaMencionaVisita,
    varrerPagina: varrerPagina,
    anotarImplausiveis: anotarImplausiveis,
    contextoDoTexto: contextoDoTexto,
    vendidosDaPagina: vendidosDaPagina,
    ehPaginaDeCompra: ehPaginaDeCompra,
    ehOrigemConhecida: ehOrigemConhecida,
    caminhoMascarado: caminhoMascarado
  };
})();
