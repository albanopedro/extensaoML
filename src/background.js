// ============================================================================
// SERVICE WORKER - grava o cache e busca telas para o coletor
//
// Atende dois pedidos das abas, por mensagem:
//
//   "salvar" - grava o que uma aba leu. O service worker e um so para todas
//              as abas e grava uma leitura de cada vez, entao duas abas do ML
//              abertas nao apagam o que a outra acabou de gravar (#21). A
//              regra da mesclagem mora em gravacao.js.
//
//   "buscar" - busca o HTML de uma tela de vendedor com a sessao dela, para a
//              atualizacao automatica. Hoje a atualizacao esta DESLIGADA no
//              coletor.js (BUSCA_AUTOMATICA_LIGADA) e ninguem pede isto - o
//              atendimento fica pronto para quando for religada.
//
// Por que o fetch mora aqui? No Manifest V3, fetch de content script e
// tratado como originado da PAGINA que o hospeda, entao esta sujeito a CORS.
// Buscar www.mercadolivre.com.br estando numa aba produto.mercadolivre.com.br
// e bloqueado - e com credentials: "include" o servidor precisaria responder
// Access-Control-Allow-Credentials, o que o ML nao faz. No service worker a
// origem da requisicao e a EXTENSAO, e com host_permissions o CORS deixa de
// valer. So o fetch mora aqui; o parse do HTML continua no content script.
// ============================================================================

// A regra da mesclagem (MLMetricsGravacao), compartilhada com as abas.
importScripts("gravacao.js");

const CHAVE_CACHE = "mlmetrics_dados";

// Quanto esperar por uma tela antes de desistir. Sem limite, um servidor que
// nunca responde prenderia a busca - e o service worker acordado - ate o
// navegador derrubar a requisicao por conta propria.
const TEMPO_LIMITE_MS = 20000;

/**
 * Diz se um endereco pode ser buscado com a sessao da vendedora.
 *
 * O fetch daqui sai com os cookies do Mercado Livre. Sem esta trava, qualquer
 * endereco que chegasse na mensagem seria buscado com a sessao dela - um
 * "proxy" autenticado. So aceitamos https e o dominio do ML.
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
    return false;  // nem e um endereco
  }
}

// Fila unica de gravacao. Cada gravacao so comeca quando a anterior terminou:
// le, mescla e grava sem que outra aba entre no meio. E isso que fecha a
// corrida entre abas - antes, cada aba tinha a propria fila.
let filaDeGravacao = Promise.resolve();

/**
 * Poe uma gravacao na fila e devolve a resposta para a aba.
 *
 * @param {Object} novos o que a varredura leu, por codigo de anuncio
 * @param {boolean} automatica true quando veio da busca em segundo plano
 * @returns {Promise<Object>} ok e quantos anuncios mudaram - nunca rejeita
 */
function gravarNaFila(novos, automatica) {
  const tarefa = filaDeGravacao.then(function () {
    return new Promise(function (resolve) {
      chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false });
          return;
        }

        const cache = guardado[CHAVE_CACHE] || {};
        let resultado;

        try {
          resultado = MLMetricsGravacao.mesclar(cache, novos, Date.now(), automatica);
        } catch (e) {
          resolve({ ok: false });  // mensagem malformada: nao grava nada
          return;
        }

        // Nada mudou nem precisa renovar: nao grava, e a aba nao avisa.
        if (resultado.mudancas.length === 0 && resultado.renovados.length === 0) {
          resolve({ ok: true, mudancas: 0 });
          return;
        }

        chrome.storage.local.set({ [CHAVE_CACHE]: cache }, function () {
          if (chrome.runtime.lastError) {
            // Quota estourada ou contexto invalidado: nao da para gravar.
            // A leitura fica so na memoria da aba e some quando ela fechar.
            resolve({ ok: false, motivo: chrome.runtime.lastError.message });
            return;
          }
          resolve({ ok: true, mudancas: resultado.mudancas.length });
        });
      });
    });
  });

  // A fila segue mesmo que alguma coisa de errado aconteca nesta tarefa.
  filaDeGravacao = tarefa.catch(function () {});

  return tarefa;
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

      // Redirecionamento para fora do ML (ou para http) tambem nao serve:
      // o texto que chegaria nao e da tela de vendedor.
      if (!enderecoPermitido(resposta.url)) {
        throw new Error("redirecionado para fora do ML");
      }

      return resposta.text();
    })
    .then(function (html) {
      responder({ ok: true, html: html });
    })
    .catch(function () {
      // Sessao expirada, rede fora, tempo esgotado, pagina mudou de endereco.
      // Nada a fazer: os dados guardados continuam valendo, e o painel
      // mostra a idade deles para quem estiver olhando.
      responder({ ok: false });
    })
    .finally(function () {
      clearTimeout(relogio);
    });
}

chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
  if (!mensagem) return false;

  // So a propria extensao conversa com o service worker. Sem
  // "externally_connectable" no manifest outras origens nem alcancam este
  // listener - conferir o id e a segunda tranca, barata, caso o manifest
  // mude um dia.
  const daExtensao = Boolean(remetente) && remetente.id === chrome.runtime.id;

  if (mensagem.tipo === "salvar") {
    if (!daExtensao || !mensagem.novos || typeof mensagem.novos !== "object") {
      responder({ ok: false });
      return false;
    }

    gravarNaFila(mensagem.novos, Boolean(mensagem.automatica)).then(responder);

    // Canal assincrono: sem este "true" o Chrome encerra o canal quando o
    // listener retorna, e a resposta nunca chega a aba.
    return true;
  }

  if (mensagem.tipo === "buscar") {
    if (!daExtensao || !enderecoPermitido(mensagem.url)) {
      responder({ ok: false });
      return false;
    }

    buscar(mensagem.url, responder);
    return true;  // canal assincrono, mesmo motivo acima
  }

  return false;
});
