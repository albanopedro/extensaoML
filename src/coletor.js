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

  // --------------------------------------------------------------------------
  // Utilitarios de leitura
  // --------------------------------------------------------------------------

  /**
   * Converte o primeiro numero encontrado num texto para inteiro.
   *
   * Precisa lidar com o formato brasileiro: "1.234" significa mil duzentos
   * e trinta e quatro, entao o ponto e separador de MILHAR e deve sumir.
   * (Se um dia isso rodar em site que usa virgula, aqui muda.)
   *
   * @param {string} texto
   * @returns {number|null}
   */
  function extrairNumero(texto) {
    if (!texto) return null;

    // \d[\d.]* = um digito, seguido de mais digitos ou pontos.
    const encontrado = texto.match(/(\d[\d.]*)/);
    if (!encontrado) return null;

    // split(".").join("") remove TODOS os pontos, nao so o primeiro.
    const limpo = encontrado[1].split(".").join("");
    const numero = parseInt(limpo, 10);

    // parseInt devolve NaN quando nao consegue converter. NaN e o unico
    // valor em JavaScript que nao e igual a si mesmo, mas usar isNaN()
    // deixa a intencao mais clara para quem le.
    return isNaN(numero) ? null : numero;
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
   * Dado o elemento que contem a palavra "visitas", encontra o numero.
   *
   * O numero pode estar em tres lugares, do mais provavel ao menos:
   *   1. no proprio texto      -> "359 visitas totais"
   *   2. num elemento vizinho  -> <span>359</span><span>visitas</span>
   *   3. no elemento pai       -> qualquer estrutura mais aninhada
   *
   * @param {Element} elemento
   * @returns {number|null}
   */
  function numeroProximo(elemento) {
    // 1) no proprio texto
    const proprio = extrairNumero(elemento.textContent);
    if (proprio !== null) return proprio;

    // 2) nos irmaos imediatos, antes e depois
    const anterior = elemento.previousElementSibling;
    if (anterior) {
      const n = extrairNumero(anterior.textContent);
      if (n !== null) return n;
    }

    const seguinte = elemento.nextElementSibling;
    if (seguinte) {
      const n = extrairNumero(seguinte.textContent);
      if (n !== null) return n;
    }

    // 3) no pai - textContent do pai inclui o texto de todos os filhos
    if (elemento.parentElement) {
      return extrairNumero(elemento.parentElement.textContent);
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

      // indexOf(...) !== -1 significa "contem". Usamos "visita" no singular
      // para casar tambem com "visitas" e "visitantes".
      if (texto.indexOf("visita") !== -1) {
        const elemento = no.parentElement;

        if (elemento) {
          const codigo = acharCodigoAnuncio(elemento);
          const visitas = numeroProximo(elemento);

          // So guardamos se temos as duas pontas: de qual anuncio e quantas.
          if (codigo && visitas !== null) {
            // Se o mesmo anuncio aparecer duas vezes, ficamos com o maior
            // valor. Telas costumam mostrar recortes ("visitas hoje" e
            // "visitas totais") e o total e o que interessa.
            if (!resultado[codigo] || visitas > resultado[codigo].visitas) {
              resultado[codigo] = { visitas: visitas };
            }
          }
        }
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
        cache[codigo] = {
          visitas: novos[codigo].visitas,
          // Data da captura. Na Etapa 5 isso permite avisar
          // "dado de 3 dias atras" em vez de mostrar numero velho como novo.
          capturadoEm: Date.now()
        };
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
