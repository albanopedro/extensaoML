// ============================================================================
// SERVICE WORKER - grava o cache e mostra o numero no icone
//
// Atende um pedido das abas, por mensagem:
//
//   "salvar" - grava o que uma aba leu. O service worker e um so para todas
//              as abas e grava uma leitura de cada vez, entao duas abas do ML
//              nao apagam o que a outra acabou de gravar (#21). A gravacao
//              inteira (gravarNaFila) mora em gravacao.js.
// ============================================================================

importScripts("gravacao.js");

const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;

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
    MLMetricsGravacao.gravarNaFila(mensagem.novos).then(responder);

    // Canal assincrono: sem este "true" a resposta nunca chega a aba.
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
