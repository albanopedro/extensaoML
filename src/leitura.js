// ============================================================================
// LEITURA - o que e numero, de qual rotulo e de qual anuncio
//
// Recebe um documento e um endereco e devolve os numeros achados, cada um com
// o rastro de origem. Nao toca em chrome.storage, mensagens nem
// window.location - tudo entra por parametro, para o teste em Node
// (teste/test-parsing.js) carregar o arquivo como ele e.
//
// ESTRATEGIA: nada de seletor CSS fixo, que quebra no primeiro redesenho do
// site. Procuramos pelo SIGNIFICADO: achamos a palavra "visitas" no texto e
// pegamos o numero colado nela.
//
// Carregado antes do diagnostico.js, do coletor.js e do calculo.js (ordem do
// manifest), que usam tudo por MLMetricsLeitura.
// ============================================================================

var MLMetricsLeitura = (function () {
  "use strict";

  // Ate quantos niveis subir no DOM procurando o codigo do anuncio: o
  // bastante para atravessar um card de lista sem varrer a pagina inteira.
  const MAX_NIVEIS = 12;

  // Maior texto (em caracteres) que a busca pelo valor le num nivel do DOM.
  // Um card tem centenas; acima disso ja e um pedaco grande da pagina.
  const LIMITE_TEXTO_POR_NIVEL = 5000;

  // Metricas que sabemos capturar e as palavras que as denunciam no texto.
  //
  // "vendido" NAO contem "venda", por isso sao termos separados - um prefixo
  // curto como "vend" pegaria "Vender um igual". E "visualiz" fica de fora das
  // visitas: toda tela tem o botao "Visualizar anuncio", e o numero antes dele
  // (estoque, posicao) seria lido como visitas.
  const ROTULOS = {
    visitas: ["visita"],
    vendas: ["venda", "vendido", "vendida"]
  };

  // Codigo de anuncio. A letra opcional depois de "MLB" faz parte do codigo:
  // "MLBU123..." e "MLB123..." sao identificadores diferentes. Prefixo e
  // digitos sao capturados separados e remontados sem o hifen.
  //
  //   MLB-3456789012   ->  MLB3456789012    anuncio
  //   MLB12345678      ->  MLB12345678      produto de catalogo (/p/)
  //   MLBU1234567890   ->  MLBU1234567890   user product (/up/)
  const PADRAO_CODIGO = /(MLB[A-Z]?)-?(\d{6,})/;

  // Os elementos que a propria extensao desenha na pagina. Nenhuma leitura
  // pode olhar para eles: o painel escreve "Visitas" e "Vendas" ao lado de
  // numeros, e le-los seria a extensao se confirmando sozinha.
  const SELETOR_DA_EXTENSAO = "#mlmetrics-painel, #mlmetrics-aviso";

  // --------------------------------------------------------------------------
  // Utilitarios de leitura
  // --------------------------------------------------------------------------

  /**
   * Converte um numero brasileiro em inteiro: "1.234" -> 1234.
   *
   * O ponto e separador de milhar. Texto com virgula e decimal (preco,
   * media), nunca contagem - devolve null.
   *
   * @param {string} bruto
   * @returns {number|null}
   */
  function paraInteiro(bruto) {
    if (bruto.indexOf(",") !== -1) return null;

    const numero = parseInt(bruto.split(".").join(""), 10);
    return isNaN(numero) ? null : numero;
  }

  /**
   * So o valor de lerRotulo, ou null quando nao ha leitura segura.
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
   * O ML escreve o valor antes ou depois do rotulo, e com varias metricas
   * lado a lado o mesmo numero fica ENTRE dois rotulos:
   *
   *   "359 visitas 12 vendas"       -> valor antes do rotulo
   *   "Visitas: 359 | Vendas: 12"   -> valor depois do rotulo
   *
   * Olhar so o vizinho imediato erra um dos dois formatos com numero
   * plausivel ("359 visitas 12 vendas 5 disponiveis" dava 5 vendas). Por isso
   * montamos a fila de pecas COLADAS em volta do rotulo e deixamos as PONTAS
   * dizerem o formato:
   *
   *   comeca com numero e termina com rotulo   -> valor antes    (N R N R)
   *   comeca com rotulo e termina com numero   -> valor depois   (R N R N)
   *   comeca e termina com numero              -> ambiguo        (N R N)
   *   comeca e termina com rotulo              -> ambiguo        (R N R)
   *
   * Ambiguo nao vira leitura, nem numero que nao e contagem (ver
   * motivoDoNumero). Entre varias ocorrencias do rotulo vale a ULTIMA: telas
   * repetem o rotulo em recortes ("visitas hoje", "visitas totais") e a
   * ultima costuma ser o total.
   *
   * @param {string} texto
   * @param {string} palavra rotulo procurado, em minusculo
   * @returns {Object|null} { valor, inicio, fim } quando leu; { recusa, inicio,
   *                        fim } quando o numero nao serve; null sem numero
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

    // Rotulo sozinho: nenhum numero colado nele.
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
   * Rotulo e toda palavra que COMECA com uma metrica ou com uma quantidade
   * que aparece ao lado delas: sem "Estoque" como rotulo, o 12 de
   * "Estoque: 12 | Vendas" pareceria das vendas. Ate dois qualificadores
   * depois do rotulo ("Visitas totais", "Vendas do mes") sao absorvidos para
   * nao partir a fila.
   *
   * Numero que nao e contagem continua sendo peca, com o motivo: um preco
   * colado no rotulo ocupa o lugar do valor, em vez de ser pulado para um
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
   * pode ser grande.
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

    // FORMA de data com ponto, valida ou nao: "31.04.2023" nao existe no
    // calendario (ehData diz que nao e data), mas tambem nao e contagem - sem
    // esta linha virava 31.042.023 visitas. Milhar de verdade nao casa: o
    // grupo do meio dele tem tres digitos ("1.299.500").
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(bruto)) return "data ou hora";
    if (bruto.indexOf(",") !== -1) return "decimal (preco ou media)";
    if (seguidoDeUnidade(depois)) return "seguido de unidade (%, periodo, mil)";

    // "R$ 49 vendas": preco inteiro colado no rotulo.
    if (/R\$\s*$/i.test(antes)) return "preco";

    // "+1.000 vendidos": faixa arredondada da pagina publica e da reputacao
    // do vendedor. Nunca e a contagem exata.
    if (/\+\s*$/.test(antes)) return "faixa arredondada (+N)";

    const valor = paraInteiro(bruto);
    if (valor === null) return "nao e numero inteiro";

    // "Ativo desde 2024": ano, nao quantidade. So com o "desde" - "2024
    // vendas" sozinho pode ser contagem real.
    if (valor >= 1900 && valor <= 2099 && /desde\s+$/i.test(antes)) {
      return "ano (desde ...)";
    }

    return null;
  }

  /**
   * Diz se ha alguma letra no texto.
   *
   * Tres intervalos, e nao um so de 0xC0 a 0xFF: assim ficam de fora "×"
   * (U+00D7) e "÷" (U+00F7), que nao sao letras.
   *   A-Z  a-z  À-Ö  Ø-ö  ø-ÿ
   */
  function temLetra(texto) {
    return /[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/.test(texto);
  }

  /**
   * Diz se um texto comeca com uma data brasileira valida (DD/MM/AAAA ou
   * DD.MM.AAAA, dia e mes possiveis no calendario).
   *
   * Checar dia e mes e o que separa data de milhar grande com dois pontos
   * ("1.299.500 visitas"). Bissexto nao e validado: basta distinguir data de
   * metrica.
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

    const DIAS_MAXIMOS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (dia > DIAS_MAXIMOS[mes]) return false;

    return true;
  }

  /**
   * Diz se o texto logo depois de um numero o transforma em outra coisa que
   * nao contagem:
   *
   *   "12%"       -> percentual          "14/09", "14:32" -> data, hora
   *   "30 dias"   -> periodo do recorte  "12 mil"         -> vale 12.000
   *
   * A lista e FECHADA de proposito: rejeitar qualquer palavra depois do
   * numero quebraria "Visitas 359 Vendas 12", em que o que vem depois e so o
   * proximo rotulo.
   *
   * @param {string} resto texto que vem imediatamente depois do numero
   * @returns {boolean}
   */
  function seguidoDeUnidade(resto) {
    if (/^\s*%/.test(resto) || /^[\/:]\d/.test(resto)) return true;

    // O (?!...) exige que a unidade termine ali: "d" nao casa com "de", "h"
    // com "hoje", "min" com "minhas".
    return /^\s*(dias?|d|h|horas?|min|minutos?|semanas?|m[eê]s|meses|anos?|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|mil|mi|k)(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i.test(resto);
  }

  /**
   * Descobre de qual anuncio e um rotulo, e ate onde buscar o valor dele.
   *
   * Se a URL ja traz o codigo (tela de UM anuncio), a pagina inteira e dele.
   * Senao subimos pelos ancestrais ate achar um bloco com links de UM
   * anuncio so - esse bloco vira o LIMITE da busca pelo valor, para um
   * anuncio nunca herdar o numero do vizinho.
   *
   * @param {Element} elemento ponto de partida
   * @param {Document} doc
   * @param {string} url endereco da pagina
   * @param {Object} [saida] quando passado, recebe em "motivo" por que nao
   *                         deu para definir o anuncio (para o diagnostico)
   * @returns {Object|null} codigo e limite - ou null
   */
  function contextoDoAnuncio(elemento, doc, url, saida) {
    // So o PATH da URL, nunca a query: telas de vendedor carregam "MLB..." em
    // parametros de filtro (?item_id=MLB123), e a listagem inteira seria
    // atribuida a um codigo so.
    const naUrl = url.split("?")[0].match(PADRAO_CODIGO);
    if (naUrl) {
      return { codigo: naUrl[1] + naUrl[2], limite: doc.body };
    }

    let atual = elemento;

    for (let nivel = 0; nivel < MAX_NIVEIS && atual; nivel++) {
      if (atual.querySelectorAll) {
        const codigos = codigosDentroDe(atual);

        if (codigos.length === 1) {
          return { codigo: codigos[0], limite: atual };
        }

        // Mais de um: ja estamos num container que abraca varios cards, e
        // nao da para saber de qual e o rotulo. Um numero no anuncio errado
        // e pior do que nenhum - ninguem percebe que esta errado.
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
   * Um card pode ter link do ITEM e tambem do produto de catalogo (/p/) ou do
   * user product (/up/) do mesmo anuncio. Havendo item, valem so os itens -
   * os agrupadores em volta sao do mesmo anuncio. Sem item, valem os
   * agrupadores. Dois codigos na lista que vale = ambiguidade.
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
      const lista = /\/(p|up)\/MLB/.test(href) ? agrupadores : itens;

      // A foto, o titulo e o botao linkam o mesmo anuncio: conta uma vez.
      if (lista.indexOf(codigo) === -1) lista.push(codigo);
    }

    return itens.length > 0 ? itens : agrupadores;
  }

  /**
   * Dado o elemento que contem o rotulo, encontra o valor correspondente.
   *
   * O numero nem sempre mora junto do rotulo:
   *
   *   <span>359 visitas</span>                    -> junto
   *   <span>1.234</span><span>visitas</span>      -> em irmaos
   *   <div><b>87</b></div><div><small>Visitas...  -> em ramos separados
   *
   * Subindo no DOM, em algum nivel numero e rotulo acabam no mesmo
   * textContent - e ai lerRotulo() resolve. Paramos no primeiro nivel que
   * responder, e nunca passamos do LIMITE do anuncio.
   *
   * @param {Element} elemento
   * @param {string} palavra
   * @param {Element} limite bloco do anuncio (contextoDoAnuncio)
   * @param {Document} doc
   * @returns {Object|null} { valor, trecho } ou { recusa, trecho } - ou null
   */
  function valorDoRotulo(elemento, palavra, limite, doc) {
    let atual = elemento;

    for (let nivel = 0; nivel < 5 && atual; nivel++) {
      // Nunca lemos o texto do BODY: seria a pagina inteira, com numero de
      // regiao que nao tem nada a ver com o rotulo.
      if (atual !== doc.body) {
        const texto = atual.textContent;

        // Bloco grande demais: numero e rotulo colados nunca precisam disso,
        // e a leitura custa proporcional ao texto.
        if (texto.length > LIMITE_TEXTO_POR_NIVEL) return null;

        const leitura = lerRotulo(texto, palavra);

        if (leitura !== null) {
          const trecho = trechoDaLeitura(texto, leitura);

          // Recusada: paramos de subir. Um nivel acima o texto so cresce, e a
          // fila pode parecer resolvida por acidente.
          if (leitura.recusa) return { recusa: leitura.recusa, trecho: trecho };

          return { valor: leitura.valor, trecho: trecho };
        }
      }

      // Fronteira do anuncio: daqui para cima e territorio de outro.
      if (atual === limite) return null;

      atual = atual.parentElement;
    }

    return null;
  }

  /**
   * Monta o RASTRO de uma leitura: o texto exato que virou numero, entre « e
   * », com 20 caracteres de contexto de cada lado:
   *
   *   "Estoque 12 - «359 visitas» totais"
   *
   * E o que permite conferir o numero contra a tela do ML. A janela e curta
   * de proposito, para nao arrastar titulo e preco para dentro do cache.
   *
   * @param {string} texto o texto em que a leitura foi feita
   * @param {Object} leitura inicio e fim, vindos de lerRotulo
   * @returns {string}
   */
  function trechoDaLeitura(texto, leitura) {
    const CONTEXTO = 20;

    // A indentacao do HTML vira um espaco so.
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
   * Fica de fora o texto de <script>, <style>, <template>, <noscript> e
   * [hidden] - o ML embute JSONs com "visits" e "sold_quantity" em <script>,
   * e um numero dali entraria como metrica. aria-hidden NAO entra: o ML
   * marca com ele numeros que APARECEM na tela (a parte visual do preco).
   *
   * @param {Node} no
   * @returns {number} NodeFilter.FILTER_ACCEPT ou FILTER_REJECT
   */
  function aceitarNoDeTextoTecnico(no) {
    const pai = no.parentElement;

    if (!pai) return NodeFilter.FILTER_ACCEPT;

    if (pai.closest("script, style, template, noscript, [hidden]")) {
      return NodeFilter.FILTER_REJECT;
    }

    return NodeFilter.FILTER_ACCEPT;
  }

  /**
   * Diz se o elemento foi desenhado pela propria extensao (painel ou aviso).
   *
   * @param {Element|null} elemento
   * @returns {boolean}
   */
  function ehDaExtensao(elemento) {
    return Boolean(elemento && elemento.closest(SELETOR_DA_EXTENSAO));
  }

  /**
   * Percorre os textos VISIVEIS da pagina, um no de texto por vez - o unico
   * jeito de varrer a pagina neste projeto (leitura, portao e diagnostico).
   *
   * Duas guardas que todo percurso precisa, e que por isso moram so aqui:
   *   - o filtro tecnico (aceitarNoDeTextoTecnico): nada de script, style,
   *     template, noscript ou [hidden];
   *   - nada do que a propria extensao desenhou (ehDaExtensao).
   *
   * TreeWalker em vez de querySelectorAll("*"): ele percorre os NOS DE TEXTO,
   * onde as palavras moram, sem repetir o texto dos filhos em cada pai.
   *
   * @param {Document} doc
   * @param {Function} visitar recebe (no, elemento pai); devolver true para
   *                           o percurso ali
   */
  function paraCadaTexto(doc, visitar) {
    const caminhante = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      aceitarNoDeTextoTecnico
    );

    let no = caminhante.nextNode();

    while (no) {
      if (!ehDaExtensao(no.parentElement) && visitar(no, no.parentElement) === true) return;
      no = caminhante.nextNode();
    }
  }

  /**
   * Diz se a pagina parece TELA DE VENDEDOR: alguma mencao a "visita".
   *
   * Pagina publica (busca, vitrine) tem "vendido" e "vendas" aos montes -
   * todos de OUTRO vendedor - mas nunca "visita", que so existe em telas de
   * quem vende. O painel da extensao nao conta, senao um anuncio publico com
   * painel viraria "tela de vendedor".
   *
   * @param {Document} doc
   * @returns {boolean}
   */
  function paginaMencionaVisita(doc) {
    let achou = false;

    paraCadaTexto(doc, function (no, elemento) {
      achou = Boolean(elemento) && (no.nodeValue || "").toLowerCase().indexOf("visita") !== -1;
      return achou;
    });

    return achou;
  }

  /**
   * Percorre todos os textos da pagina procurando rotulos de metrica.
   *
   * @param {Document} doc
   * @param {string} url endereco da pagina
   * @param {Array} [recusas] quando passado (so no diagnostico), recebe cada
   *                          rotulo que NAO virou numero, com o motivo
   * @returns {Object} mapa { MLB123: { visitas: 359, origem: {...} }, ... }
   */
  function varrerPagina(doc, url, recusas) {
    // Sem "visita" nao e tela de vendedor: qualquer "vendido" ali e de OUTRO
    // vendedor.
    if (!paginaMencionaVisita(doc)) return {};

    const resultado = {};

    // Em qual tela a leitura acontece, para o rastro - so a forma da rota.
    let tela;
    try {
      tela = caminhoMascarado(new URL(url).pathname);
    } catch (e) {
      tela = "(url invalida)";
    }

    paraCadaTexto(doc, function (no, elemento) {
      if (!elemento) return;

      const texto = (no.nodeValue || "").toLowerCase();

      const menciona = Object.keys(ROTULOS).some(function (metrica) {
        return ROTULOS[metrica].some(function (palavra) {
          return texto.indexOf(palavra) !== -1;
        });
      });
      if (!menciona) return;

      // O contexto depende do elemento, nao da palavra: calculado uma vez
      // aqui, e nao para cada sinonimo.
      const saida = {};
      const contexto = contextoDoAnuncio(elemento, doc, url, saida);

      if (!contexto) {
        if (recusas) {
          recusas.push({
            motivo: saida.motivo,
            trecho: contextoDoTexto(no, (no.nodeValue || "").trim())
          });
        }
        return;
      }

      const codigo = contexto.codigo;

      Object.keys(ROTULOS).forEach(function (metrica) {
        ROTULOS[metrica].forEach(function (palavra) {
          if (texto.indexOf(palavra) === -1) return;

          const leitura = valorDoRotulo(elemento, palavra, contexto.limite, doc);

          // Sem leitura, ou recusada: nada vai para o cache, e o diagnostico
          // (quando pedido) guarda o porque.
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

          // O MAIOR valor da pagina vence: telas mostram recortes lado a lado
          // ("visitas hoje", "visitas totais") e o total interessa. O rastro
          // acompanha o numero que venceu.
          const atual = resultado[codigo][metrica];
          if (atual === undefined || leitura.valor > atual) {
            resultado[codigo][metrica] = leitura.valor;
            resultado[codigo].origem[metrica] = {
              trecho: leitura.trecho,
              tela: tela
            };
          }
        });
      });
    });

    // Tela de vendedor SEMPRE mostra visitas, e a pagina publica nunca. Por
    // isso, POR ANUNCIO: codigo sem visita lida nesta varredura fica de fora
    // inteiro - um modulo de terceiros dentro da tela de vendedor ("mais
    // vendidos") gravaria "+1.000 vendidos" num produto alheio.
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
   * Nao e impossivel (#40): "vendidos" conta UNIDADES, e um comprador leva
   * varias numa visita so. Os numeros ficam, o painel mostra um alerta, e
   * aqui so avisamos no console e, no diagnostico, como AVISO.
   *
   * @param {Object} resultado
   * @param {Array} [recusas] quando passado, recebe um aviso por anuncio
   * @returns {Object} o proprio resultado, sem tirar nada
   */
  function anotarImplausiveis(resultado, recusas) {
    Object.keys(resultado).forEach(function (codigo) {
      const dados = resultado[codigo];

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
   * Janela de texto em volta do rotulo (20 antes, 80 depois), para o
   * diagnostico e as recusas.
   *
   * So o que esta colado no rotulo: o pai inteiro pode ter titulo, preco e
   * nome de comprador, que nao devem sair daqui.
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
   * A mesma pagina traz "+1000 vendas" da REPUTACAO do vendedor e "+100
   * vendidos" dos recomendados - ler isso sem cuidado ja fez um anuncio de
   * uma venda exibir mil (#34). As travas:
   *
   *   - so "vendido/vendida", nunca "venda/vendas" (a reputacao usa "vendas");
   *   - o subtitulo do anuncio ("Novo | 1 vendido") vence tudo - os
   *     recomendados nao tem a condicao junto;
   *   - sem subtitulo, so numero exato; "+N" e recusado por motivoDoNumero;
   *   - mais de um valor diferente na pagina: nao devolve nada.
   *
   * @param {Document} doc
   * @returns {Object|null} { valor, aproximado, trecho } ou null
   */
  function vendidosDaPagina(doc) {
    // Condicao, separador e numero COLADOS. O separador e so espaco (o ML
    // escreve "Novo  |  +500 vendidos", com dois de cada lado) e no maximo
    // uma barra ou traco - uma frase que so menciona "novo" nao casa.
    const SUBTITULO = /(novo|usado|recondicionado)\s*[|·•\-–]?\s*(\+?)\s*([\d.]+)\s*vendid[oa]s?/i;

    const doSubtitulo = [];
    const exatos = [];

    paraCadaTexto(doc, function (no) {
      const texto = (no.nodeValue || "").trim();

      // Texto curto: "1 vendido" e um rotulo, nao um paragrafo.
      if (texto.length === 0 || texto.length >= 120 || !/vendid[oa]s?/i.test(texto)) return;

      const subtitulo = texto.match(SUBTITULO);

      if (subtitulo) {
        const valor = paraInteiro(subtitulo[3]);

        if (valor !== null && !doSubtitulo.some(function (achado) {
          return achado.valor === valor && achado.aproximado === Boolean(subtitulo[2]);
        })) {
          doSubtitulo.push({
            valor: valor,
            // "+25 vendidos" quer dizer "mais de 25": o painel mostra "+25",
            // nunca 25 como exato.
            aproximado: Boolean(subtitulo[2]),
            trecho: "«" + texto + "»"
          });
        }
      }

      const leitura = lerRotulo(texto.toLowerCase(), "vendid");

      if (leitura && leitura.valor !== undefined &&
          !exatos.some(function (achado) { return achado.valor === leitura.valor; })) {
        exatos.push({
          valor: leitura.valor,
          aproximado: false,
          trecho: trechoDaLeitura(texto, leitura)
        });
      }
    });

    if (doSubtitulo.length === 1) return doSubtitulo[0];

    return exatos.length === 1 ? exatos[0] : null;
  }

  // --------------------------------------------------------------------------
  // Escopo e endereco
  // --------------------------------------------------------------------------

  /**
   * Diz se esta tela JA entregou numeros alguma vez (esta nas origens).
   *
   * Separa "tela que nunca deu nada" (a maioria, normal) de "tela que dava e
   * parou" (sinal de que o ML mudou). Compara sem a query, como as origens
   * sao guardadas.
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
   * O coletor NAO age aqui: a pagina mistura "1 vendido" (do ANUNCIO) com
   * "+1.000 vendas" (do VENDEDOR), com as mesmas palavras, e tudo seria
   * atribuido ao anuncio da URL.
   *
   * Detectamos pela URL:
   *   - HOST: a vitrine classica mora em produto./articulo.mercadolivre;
   *   - CAMINHO: /up/MLBU... e /p/MLB... (as vezes seguidos de "/s", a lista
   *     de vendedores do catalogo) ficam no mesmo host das telas de vendedor,
   *     mas nenhuma tela de vendedor usa essas rotas.
   *
   * @param {string} url endereco da pagina
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
      return false;
    }

    return host.indexOf("produto.mercadolivre") !== -1 ||
           host.indexOf("articulo.mercadolivre") !== -1 ||
           // O (\/|$) exige que o codigo termine ali: numa barra ou no fim.
           /\/up\/MLB[A-Z]?\d{6,}(\/|$)/.test(path) ||
           /\/p\/MLB\d{6,}(\/|$)/.test(path);
  }

  /**
   * Caminho da URL com o que pode identificar alguem trocado por marcas.
   *
   * Diz EM QUAL TELA algo aconteceu sem levar codigo de anuncio, id de
   * vendedor ou titulo de produto:
   *
   *   /anuncios/lista                        -> /anuncios/lista
   *   /vendas/12345678/detalhe               -> /vendas/#/detalhe
   *   /kit-2-caixa-organizadora/up/MLBU123   -> /(titulo)/up/MLBU#
   *
   * Titulo e slug com muitas palavras ligadas por hifen; rota de sistema tem
   * no maximo tres ("publicaciones-y-ventas").
   *
   * @param {string} caminho pathname da URL
   * @returns {string}
   */
  function caminhoMascarado(caminho) {
    return caminho.split("/").map(function (trecho) {
      if (trecho.split("-").length > 3) return "(titulo)";

      // Os digitos somem, a letra do prefixo fica ("MLBU#"): ela diz o TIPO.
      return trecho.replace(/\d+/g, "#");
    }).join("/");
  }

  // Tudo publico: o coletor, o diagnostico e o calculo usam as funcoes de
  // varrer, escopo e endereco; as pecas menores ficam expostas para o teste.
  return {
    MAX_NIVEIS: MAX_NIVEIS,
    LIMITE_TEXTO_POR_NIVEL: LIMITE_TEXTO_POR_NIVEL,
    ROTULOS: ROTULOS,
    PADRAO_CODIGO: PADRAO_CODIGO,
    SELETOR_DA_EXTENSAO: SELETOR_DA_EXTENSAO,
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
    ehDaExtensao: ehDaExtensao,
    paraCadaTexto: paraCadaTexto,
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
