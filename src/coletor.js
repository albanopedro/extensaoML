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

    // Recorta so o trecho anterior ao rotulo e procura numeros nele.
    const antes = texto.slice(0, posicao);

    // \d[\d.]* = um digito seguido de mais digitos ou pontos.
    // O "g" faz encontrar TODAS as ocorrencias, nao so a primeira.
    const numeros = antes.match(/\d[\d.]*/g);
    if (!numeros) return null;

    return paraInteiro(numeros[numeros.length - 1]);
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
  function acharCodigoAnuncio(elemento) {
    // Caso mais facil: a propria URL da pagina ja identifica o anuncio.
    // Vale quando estamos na tela de metricas de UM anuncio especifico.
    const naUrl = window.location.href.match(/MLB-?(\d{6,})/);
    if (naUrl) return "MLB" + naUrl[1];

    let atual = elemento;

    for (let nivel = 0; nivel < MAX_NIVEIS && atual; nivel++) {
      // querySelector so existe em Element (nao em nos de texto),
      // por isso a checagem antes de chamar.
      if (atual.querySelector) {
        const link = atual.querySelector('a[href*="MLB"]');

        if (link) {
          const achado = link.getAttribute("href").match(/MLB-?(\d{6,})/);
          if (achado) return "MLB" + achado[1];
        }
      }

      atual = atual.parentElement;
    }

    return null;
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
  function valorDoRotulo(elemento, palavra) {
    let atual = elemento;

    // 5 niveis cobrem as estruturas aninhadas que vimos sem chegar
    // ao card do anuncio vizinho.
    for (let nivel = 0; nivel < 5 && atual; nivel++) {
      const valor = numeroAntesDe(atual.textContent, palavra);
      if (valor !== null) return valor;

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

      if (elemento) {
        // Para cada metrica que conhecemos, testamos todas as palavras
        // que podem indica-la neste texto.
        Object.keys(ROTULOS).forEach(function (metrica) {
          ROTULOS[metrica].forEach(function (palavra) {
            // indexOf(...) !== -1 significa "contem".
            if (texto.indexOf(palavra) === -1) return;

            const codigo = acharCodigoAnuncio(elemento);
            const valor = valorDoRotulo(elemento, palavra);

            // So guardamos com as duas pontas: de qual anuncio, e quanto.
            if (!codigo || valor === null) return;

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

    return resultado;
  }

  // --------------------------------------------------------------------------
  // Gravacao no cache
  // --------------------------------------------------------------------------

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
    const codigos = Object.keys(novos);
    if (codigos.length === 0) return;

    chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
      // Se for a primeira vez, nao existe nada guardado ainda.
      const cache = guardado[CHAVE_CACHE] || {};

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

  // Telas de vendedor costumam carregar a lista por JavaScript, um instante
  // depois do "document_idle". Esperamos 1,5s para dar tempo dos numeros
  // aparecerem no DOM antes de varrer.
  // (Na Etapa 5 isso vira um MutationObserver, que e a solucao correta:
  // reage quando o conteudo chega, em vez de apostar num tempo fixo.)
  setTimeout(function () {
    salvar(varrerPagina());
  }, 1500);
})();
