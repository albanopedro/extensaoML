// ============================================================================
// SERVICE WORKER - busca as telas de vendedor para o coletor (Etapa 6)
//
// Por que um service worker para fazer o fetch?
//
// No Manifest V3, fetch de content script e tratado como originado da
// PAGINA que o hospeda, entao esta sujeito a CORS. Buscar
// www.mercadolivre.com.br estando numa aba produto.mercadolivre.com.br e
// bloqueado por CORS de origem cruzada - e com credentials: "include" o
// servidor precisaria responder Access-Control-Allow-Credentials, o que o
// ML nao faz. A atualizacao automatica so funcionava por acidente, quando
// a origem guardada casava exatamente com o subdominio aberto.
//
// No service worker a origem da requisicao e a EXTENSAO, e com
// host_permissions cobrindo os dominios do ML o CORS deixa de valer.
// So o fetch mora aqui; o parse do HTML continua no content script, que ja
// tem toda a heuristica de varrerPagina. O SW so transporta o texto.
// ============================================================================

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

chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
  if (!mensagem || mensagem.tipo !== "buscar") return false;

  // So a propria extensao pede busca, e so para o dominio do ML. Sem
  // "externally_connectable" no manifest outras origens nem alcancam este
  // listener - conferir o id e a segunda tranca, barata, caso o manifest
  // mude um dia.
  if (!remetente || remetente.id !== chrome.runtime.id ||
      !enderecoPermitido(mensagem.url)) {
    responder({ ok: false });
    return false;
  }

  const controle = new AbortController();
  const relogio = setTimeout(function () {
    controle.abort();
  }, TEMPO_LIMITE_MS);

  fetch(mensagem.url, { credentials: "include", signal: controle.signal })
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

  // Canal assincrono: sem este "true" o Chrome encerra o canal quando o
  // listener retorna, e a resposta nunca chega ao content script.
  return true;
});
