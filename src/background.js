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

chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
  // Sinal para o responder que vamos usar o canal assincrono: sem isto o
  // Chrome encerra o canal quando o listener retorna, e a resposta nunca
  // chega ao content script.
  let assincrono = false;

  if (mensagem && mensagem.tipo === "buscar") {
    assincrono = true;

    fetch(mensagem.url, { credentials: "include" })
      .then(function (resposta) {
        if (!resposta.ok) throw new Error("resposta " + resposta.status);
        return resposta.text();
      })
      .then(function (html) {
        responder({ ok: true, html: html });
      })
      .catch(function () {
        // Sessao expirada, rede fora, pagina mudou de endereco.
        // Nada a fazer: os dados guardados continuam valendo, e o painel
        // mostra a idade deles para quem estiver olhando.
        responder({ ok: false });
      });
  }

  return assincrono;
});