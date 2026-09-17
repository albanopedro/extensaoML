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

  // Guarda o que a extensao viu quando nao conseguiu capturar nada.
  // Serve para diagnostico remoto - ver salvarDiagnostico().
  const CHAVE_DIAGNOSTICO = "mlmetrics_diagnostico";

  // Ultimo erro inesperado da leitura (ver registrarErro). Existe porque
  // excecao no meio da varredura e invisivel para quem usa: a aba continua
  // aberta, nada aparece na tela e o diagnostico nao teria o que dizer.
  const CHAVE_ERRO = "mlmetrics_erro";

  // Enderecos de telas de vendedor que ja entregaram numeros, e quando
  // foi a ultima busca automatica neles.
  const CHAVE_ORIGENS = "mlmetrics_origens";
  const CHAVE_ULTIMA_BUSCA = "mlmetrics_ultima_busca";

  // Busca automatica das telas de vendedor (ver atualizarEmSegundoPlano):
  // DESLIGADA. As telas de vendedor do ML sao montadas por JavaScript, e o
  // HTML buscado pelo service worker muito provavelmente chega sem os
  // numeros - a busca usaria a sessao da vendedora a cada 2 horas sem trazer
  // nada. Religar so depois que a tela real mostrar que o HTML traz os
  // numeros: basta trocar para true.
  const BUSCA_AUTOMATICA_LIGADA = false;

  // De quanto em quanto tempo a busca automatica roda, quando ligada.
  // Duas horas equilibra dado fresco com nao pesar na navegacao dela.
  const INTERVALO_BUSCA_MS = 2 * 60 * 60 * 1000;

  // Quanto esperar pelo service worker antes de gravar na aba (plano B).
  // Se o SW morrer no meio da fila ou simplesmente nao responder, a aba
  // precisa gravar sozinha para nao perder a leitura. Sem esta trava o
  // plano B so dispara com lastError, e uma resposta que nunca chega
  // (SW derrubado pelo navegador) deixa a leitura sem ninguem que a grave.
  const TIMEOUT_PLANO_B_MS = 3000;

  // Ultimo diagnostico gravado: de qual tela e quando (trava do
  // salvarDiagnostico, que e por tela - ver la).
  let ultimoDiagnostico = { caminho: null, quando: 0 };

  // Ultimo erro ja gravado: qual mensagem e quando (trava do registrarErro).
  let ultimoErro = { mensagem: null, quando: 0 };

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
   * primeiro (ver codigosDaPagina no content.js). Dois itens diferentes
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
    var tela;
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

  // --------------------------------------------------------------------------
  // Gravacao no cache
  // --------------------------------------------------------------------------

  /**
   * Grava o que a varredura achou.
   *
   * A gravacao de verdade e feita pelo SERVICE WORKER (background.js), que e
   * um so para todas as abas e grava uma leitura de cada vez. Antes cada aba
   * lia, mesclava e gravava por conta propria, e duas abas do ML abertas
   * apagavam o que a outra tinha acabado de gravar (#21). A regra da mesclagem
   * mora em gravacao.js e e a mesma nos dois lados.
   *
   * Se o service worker nao responder (acabou de ser atualizado, falhou ao
   * acordar), a aba grava sozinha pela mesma regra - perder a leitura seria
   * pior do que o risco de corrida numa situacao rara.
   *
   * @param {Object} novos o que a varredura leu, por codigo de anuncio
   * @param {boolean} emSegundoPlano true quando veio da busca automatica, nao
   *                        de uma tela que a pessoa esta vendo. Nesse caso o
   *                        aviso verde nao faz sentido: apareceria sobre uma
   *                        pagina sem relacao com os numeros capturados.
   */
  function salvar(novos, emSegundoPlano) {
    if (Object.keys(novos).length === 0) return;

    function depoisDeGravar(mudancas) {
      // So anunciamos quando algo de fato MUDOU. Reconhecer de novo sem
      // novidade nao merece toast a cada 2 minutos - e, sem esta trava, o
      // aviso mexeria no DOM, o observer varreria de novo e avisaria de novo.
      if (mudancas > 0 && !emSegundoPlano) {
        console.log(
          "%c[ML METRICS]%c capturei " + mudancas + " anuncio(s):",
          "background:#3483fa;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#3483fa",
          novos
        );

        avisarNaTela(mudancas);
      }
    }

    try {
      // Sem API de mensagem (pagina de teste fora da extensao): grava aqui.
      if (typeof chrome.runtime.sendMessage !== "function") {
        gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
        return;
      }

      // Sem resposta do SW em TIMEOUT_PLANO_B_MS: o SW pode ter sido
      // derrubado pelo navegador no meio da fila. A aba grava sozinha
      // (plano B) para nao perder a leitura. O timer e cancelado se o SW
      // responder a tempo - um unico timer por chamada, sem acumulo.
      let usado = false;

      var timerPlanoB = setTimeout(function () {
        if (usado) return;
        usado = true;
        gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
      }, TIMEOUT_PLANO_B_MS);

      chrome.runtime.sendMessage(
        { tipo: "salvar", novos: novos, automatica: Boolean(emSegundoPlano) },
        function (resposta) {
          if (usado) return;
          usado = true;
          clearTimeout(timerPlanoB);

          // lastError aqui e o service worker que nao respondeu: plano B.
          if (chrome.runtime.lastError || !resposta || !resposta.ok) {
            gravarNestaAba(novos, emSegundoPlano, depoisDeGravar);
            return;
          }

          depoisDeGravar(resposta.mudancas);
        }
      );
    } catch (e) {
      // Contexto invalidado: a extensao foi recarregada e esta aba ficou
      // orfa. Nao ha como gravar daqui - a versao nova grava depois do F5.
    }
  }

  // Fila do plano B (gravarNestaAba): impede que duas gravacoes da MESMA aba
  // se pisem. Entre abas quem garante a ordem e o service worker.
  let filaDoCache = Promise.resolve();

  /**
   * Plano B: le, mescla e grava o cache daqui mesmo, sem o service worker.
   *
   * Todas as operacoes de chrome.storage ficam protegidas contra erro:
   * contexto invalidado e quota estourada terminam a fila em silencio, e a
   * proxima gravacao tenta de novo.
   *
   * @param {Object} novos
   * @param {boolean} emSegundoPlano
   * @param {Function} pronto recebe quantos anuncios mudaram, depois de gravar
   */
  function gravarNestaAba(novos, emSegundoPlano, pronto) {
    filaDoCache = filaDoCache.then(function () {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
            if (chrome.runtime.lastError) {
              resolve();  // contexto invalidado ou acesso negado
              return;
            }

            const cache = guardado[CHAVE_CACHE] || {};
            const resultado = MLMetricsGravacao.mesclar(cache, novos, Date.now(), emSegundoPlano);

            if (resultado.mudancas.length === 0 && resultado.renovados.length === 0) {
              resolve();  // nada o que persistir
              return;
            }

            chrome.storage.local.set({ [CHAVE_CACHE]: cache }, function () {
              // Ler o lastError evita o aviso "Unchecked runtime.lastError".
              // Quota estourada nao tem o que fazer aqui: avisamos e seguimos.
              if (chrome.runtime.lastError) {
                console.warn(
                  "[ML METRICS] nao consegui gravar o cache: " +
                  chrome.runtime.lastError.message
                );
              } else {
                pronto(resultado.mudancas.length);
              }
              resolve();
            });
          });
        } catch (e) {
          resolve();  // contexto invalidado
        }
      });
    }).catch(function () {
      // A fila nunca para: erro de uma gravacao deixa a proxima tentar.
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
    try {
      var host = new URL(url).hostname;
      var path = new URL(url).pathname;
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
   * Varre e guarda, se este for um lugar de onde se deve coletar.
   *
   * O corpo inteiro fica dentro de try/catch porque a leitura roda em cima
   * de uma tela que nao controlamos. Uma excecao aqui (formato novo do ML,
   * DOM em estado inesperado) mataria o callback do observer em silencio: a
   * aba fica aberta, nada aparece, e quem esta do outro lado so consegue
   * dizer "nao apareceu nada". Registrado, o mesmo caso vira uma linha no
   * "Copiar diagnostico" com a mensagem e a funcao que quebrou.
   */
  function coletar() {
    try {
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
    } catch (e) {
      registrarErro("coletar", e);
    }
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

        try {
          const origens = guardado[CHAVE_ORIGENS] || [];

          // Ja e a mais recente: nada a fazer, evita gravacao a toa.
          if (origens[0] === limpa) return;

          const atualizadas = [limpa]
            .concat(origens.filter(function (u) { return u !== limpa; }))
            .slice(0, 3);

          chrome.storage.local.set({ [CHAVE_ORIGENS]: atualizadas }, function () {
            // Ler o lastError evita o aviso "Unchecked runtime.lastError".
            if (chrome.runtime.lastError) return;
          });
        } catch (e) {
          // contexto invalidado dentro do callback: origens nao sao essenciais
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
            chrome.storage.local.set({ [CHAVE_ULTIMA_BUSCA]: Date.now() }, function () {
              // Ler o lastError evita o aviso "Unchecked runtime.lastError".
              if (chrome.runtime.lastError) return;
            });
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
          amostras: amostras,
          // O periodo vai junto: sem ele, numero lido nao diz se e total ou
          // recorte (#47, ver coletarTextosDePeriodo).
          periodo: coletarTextosDePeriodo(document)
        }
      }, function () {
        // Ler o lastError evita o aviso "Unchecked runtime.lastError".
        if (chrome.runtime.lastError) return;
      });
    } catch (e) {
      // Contexto invalidado: diagnostico nao e essencial, proximo ciclo tenta.
    }
  }

  /**
   * Guarda o ultimo erro inesperado da leitura, para o diagnostico.
   *
   * Sem isto, excecao no meio da varredura e a pior falha possivel neste
   * projeto: silenciosa. O callback do observer morre, a aba segue aberta,
   * o painel nao aparece e o diagnostico mostra uma tela "normal" - quem
   * esta do outro lado so consegue dizer "nao apareceu nada", e nao da para
   * consertar as cegas. Gravado, o mesmo caso chega pelo "Copiar
   * diagnostico" com a mensagem, a funcao que quebrou e a tela.
   *
   * Nao guarda nada da pagina: so a mensagem do erro, a pilha da propria
   * extensao e o caminho mascarado.
   *
   * @param {string} onde nome da funcao que quebrou
   * @param {Error} erro
   */
  function registrarErro(onde, erro) {
    const mensagem = String((erro && erro.message) || erro);
    const agora = Date.now();

    // Trava de repeticao: o observer chama coletar a cada 600ms, e um erro
    // que se repete gravaria no storage o tempo todo. Mensagem nova grava na
    // hora; a mesma mensagem, so depois de um minuto.
    const REPETICAO_MS = 60 * 1000;

    if (mensagem === ultimoErro.mensagem &&
        agora - ultimoErro.quando < REPETICAO_MS) {
      return;
    }
    ultimoErro = { mensagem: mensagem, quando: agora };

    // No console para quem abrir o F12, e no storage para o "Copiar
    // diagnostico" - que e como a cliente conta o que aconteceu.
    console.error("[ML METRICS] erro em " + onde + ": " + mensagem);

    try {
      chrome.storage.local.set({
        [CHAVE_ERRO]: {
          onde: onde,
          mensagem: mensagem,
          // Duas primeiras linhas da pilha: dizem a funcao e a linha do
          // arquivo. A pilha inteira encheria o relatorio.
          pilha: String((erro && erro.stack) || "").split("\n").slice(0, 3).join(" | "),
          host: window.location.hostname,
          // Mascarado, como no resto do diagnostico: a FORMA da rota, sem
          // codigo de anuncio nem titulo de produto.
          tela: caminhoMascarado(window.location.pathname),
          quando: agora,
          // A versao diz se o erro e desta build ou de uma antiga que ficou
          // guardada no storage.
          versao: chrome.runtime.getManifest().version
        }
      }, function () {
        // Ler o lastError evita o aviso "Unchecked runtime.lastError"; se a
        // gravacao falhar, nao ha plano melhor do que o console.
        if (chrome.runtime.lastError) return;
      });
    } catch (e) {
      // Contexto invalidado: o erro fica so no console desta aba.
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
      const metrica = Object.keys(ROTULOS).filter(function (nome) {
        return ROTULOS[nome].some(function (palavra) {
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
          contexto: contextoDoTexto(no, texto)
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
      aceitarNoDeTextoTecnico
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

    // Cada rotulo que NAO virou numero, com o motivo (ver varrerPagina).
    const recusas = [];
    const captura = vitrine ? null : varrerPagina(document, url, recusas);

    return {
      host: window.location.hostname,
      caminho: caminhoMascarado(window.location.pathname),
      // Trava 1: vitrine publica nunca e varrida pelo coletor.
      vitrine: vitrine,
      // Trava 2: pagina sem "visita" fora do painel nao e tela de vendedor.
      mencionaVisita: paginaMencionaVisita(document),
      // O que o coletor gravaria se varresse agora ({} = nada passou pelas
      // travas). Em vitrine ele nem varre, entao fica null.
      capturariaAgora: captura,
      // De qual periodo sao os numeros da tela: textos de filtro, com a opcao
      // escolhida marcada quando o controle diz (#47, ver
      // coletarTextosDePeriodo).
      periodo: coletarTextosDePeriodo(document),
      // Contagem por motivo primeiro: com 50 anuncios na tela, e ela que
      // mostra de relance se o problema e o mesmo em todos.
      resumoDasRecusas: resumirRecusas(recusas),
      // As primeiras 40, cada uma com o trecho de texto em que aconteceu.
      recusas: recusas.slice(0, 40),
      amostras: coletarAmostras(document)
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

      // O diagnostico varre a tela com o mesmo codigo da captura. Se ele
      // quebrar, o popup ficaria sem resposta e mandaria apertar F5 - a
      // pista errada. Respondemos com o erro, que e justamente o que
      // interessa saber nessa hora.
      try {
        responder(diagnosticarTelaAtual());
      } catch (e) {
        registrarErro("diagnosticarTelaAtual", e);
        responder({
          erro: "a extensao quebrou ao ler esta tela: " +
            String((e && e.message) || e)
        });
      }
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

    // Busca automatica: so quando ligada (ver BUSCA_AUTOMATICA_LIGADA) e so no
    // site do ML, nunca nos arquivos de teste locais.
    if (BUSCA_AUTOMATICA_LIGADA && window.location.hostname.indexOf("mercadolivre") !== -1) {
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
      // Mutacao de texto (characterData) tem um no de TEXTO como alvo, que nao
      // tem closest - o elemento que interessa e o pai dele.
      const alvo = (mutacao.target && mutacao.target.nodeType === 3)
        ? mutacao.target.parentElement
        : mutacao.target;

      if (alvo && alvo.closest &&
          alvo.closest("#mlmetrics-painel, #mlmetrics-aviso")) {
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

      // Lote SO com mudancas da propria extensao: nao e conteudo do ML, nao
      // vale re-varrer. Se o lote mistura mudanca nossa com mudanca do site,
      // a do site conta - antes, uma unica mutacao nossa descartava o lote
      // inteiro, e a tela nova do ML ficava sem varredura.
      if (mutacoes.every(mutacaoDaExtensao)) return;

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
      childList: true,      // elementos adicionados ou removidos
      subtree: true,        // em qualquer profundidade, nao so nos filhos diretos

      // Texto trocado NO LUGAR. Quando so o numero muda (filtro de periodo,
      // pagina 2 reaproveitando as linhas), o React altera o texto do no que
      // ja existe - sem isto, a varredura nem era disparada. O debounce acima
      // absorve o volume extra de eventos.
      characterData: true,

      // Link trocado no lugar: a mesma linha passa a ser de outro anuncio.
      attributes: true,
      attributeFilter: ["href"]
    });
  }
})();
