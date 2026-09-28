// ============================================================================
// SERVICE WORKER - grava o cache e busca telas para o coletor
//
// Atende dois pedidos das abas, por mensagem:
//
//   "salvar" - grava o que uma aba leu. O service worker e um so para todas
//              as abas e grava uma leitura de cada vez, entao duas abas do ML
//              nao apagam o que a outra acabou de gravar (#21). A gravacao
//              inteira (gravarNaFila) mora em gravacao.js.
//
//   "buscar" - busca o HTML de uma tela de vendedor com a sessao dela, para a
//              atualizacao automatica - hoje DESLIGADA no coletor.js
//              (BUSCA_AUTOMATICA_LIGADA). O fetch mora aqui porque, no content
//              script, ele carrega a origem da pagina e esbarra em CORS; aqui
//              a origem e a extensao, e com host_permissions o CORS nao vale.
// ============================================================================

importScripts("gravacao.js");

const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;

// Quanto esperar por uma tela antes de desistir, para um servidor que nunca
// responde nao prender o service worker acordado.
const TEMPO_LIMITE_MS = 20000;

/**
 * Diz se um endereco pode ser buscado com a sessao da vendedora: so https e
 * o dominio do ML. Sem esta trava o service worker seria um "proxy"
 * autenticado para qualquer endereco que chegasse na mensagem.
 *
 * @param {string} url
 * @returns {boolean}
 */
function enderecoPermitido(url) {
  try {
    const endereco = new URL(url);
    const host = endereco.hostname;

    return endereco.protocol === "https:" &&
      (host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br"));
  } catch (e) {
    return false;
  }
}

/**
 * Busca uma tela de vendedor e devolve o HTML para a aba.
 *
 * @param {string} url endereco ja validado
 * @param {Function} responder
 */
function buscar(url, responder) {
  const controle = new AbortController();
  const relogio = setTimeout(function () {
    controle.abort();
  }, TEMPO_LIMITE_MS);

  fetch(url, { credentials: "include", signal: controle.signal })
    .then(function (resposta) {
      if (!resposta.ok) throw new Error("resposta " + resposta.status);

      // Redirecionamento para fora do ML (ou para http) nao serve.
      if (!enderecoPermitido(resposta.url)) {
        throw new Error("redirecionado para fora do ML");
      }

      return resposta.text();
    })
    .then(function (html) {
      responder({ ok: true, html: html });
    })
    .catch(function () {
      // Sessao expirada, rede fora, tempo esgotado: os dados guardados
      // continuam valendo, e o painel mostra a idade deles.
      responder({ ok: false });
    })
    .finally(function () {
      clearTimeout(relogio);
    });
}

chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
  if (!mensagem) return false;

  // So a propria extensao conversa com o service worker. Sem
  // "externally_connectable" outras origens nem chegam aqui - conferir o id
  // e uma segunda tranca, caso o manifest mude um dia.
  const daExtensao = Boolean(remetente) && remetente.id === chrome.runtime.id;

  if (mensagem.tipo === "salvar") {
    if (!daExtensao || !mensagem.novos || typeof mensagem.novos !== "object") {
      responder({ ok: false });
      return false;
    }

    // A fila do gravacao.js: no service worker ela e uma so para todas as abas.
    MLMetricsGravacao.gravarNaFila(mensagem.novos, Boolean(mensagem.automatica)).then(responder);

    // Canal assincrono: sem este "true" a resposta nunca chega a aba.
    return true;
  }

  if (mensagem.tipo === "buscar") {
    if (!daExtensao || !enderecoPermitido(mensagem.url)) {
      responder({ ok: false });
      return false;
    }

    buscar(mensagem.url, responder);
    return true;
  }

  return false;
});

// ----------------------------------------------------------------------------
// Numero no icone da extensao
// ----------------------------------------------------------------------------

/**
 * Mostra no icone quantos anuncios tem numero conferivel - o sinal de "estou
 * viva e trabalhando" sem abrir o popup. Vazio quando e zero (um "0" parece
 * defeito); acima de 99, "99+".
 *
 * @param {Object|undefined} cache mlmetrics_dados
 */
function atualizarDistintivo(cache) {
  const quantos = MLMetricsGravacao.contarConferiveis(cache || {});
  const texto = quantos === 0 ? "" : (quantos > 99 ? "99+" : String(quantos));

  try {
    chrome.action.setBadgeText({ text: texto });
    chrome.action.setBadgeBackgroundColor({ color: "#3483fa" });
  } catch (e) {
    // Sem chrome.action: o icone fica sem numero, e nada depende disso.
  }
}

chrome.storage.onChanged.addListener(function (mudancas, area) {
  if (area !== "local" || !mudancas[CHAVE_CACHE]) return;
  atualizarDistintivo(mudancas[CHAVE_CACHE].newValue);
});

// O service worker e desligado quando fica ocioso e o numero do icone volta
// zerado depois de um reinicio do navegador: reconferido a cada acordada.
MLMetricsGravacao.lerStorage([CHAVE_CACHE], function (guardado) {
  atualizarDistintivo(guardado[CHAVE_CACHE]);
});
