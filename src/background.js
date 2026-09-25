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

// As regras de gravar e os nomes das chaves do storage (MLMetricsGravacao),
// os mesmos das abas e do popup.
importScripts("gravacao.js");

const CHAVE_CACHE = MLMetricsGravacao.CHAVES.CACHE;

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
        const agora = Date.now();
        let resultado;

        try {
          resultado = MLMetricsGravacao.mesclar(cache, novos, agora, automatica);
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

          // O historico vem DEPOIS do cache, numa gravacao separada, mas
          // dentro da mesma tarefa da fila - duas abas nao se atropelam nele
          // tambem. Se ele falhar, o cache ja esta gravado: o historico e um
          // extra, nunca o motivo de perder uma leitura.
          const resposta = { ok: true, mudancas: resultado.mudancas.length };
          gravarHistorico(novos, agora, automatica, function () {
            resolve(resposta);
          });
        });
      });
    });
  });

  // A fila segue mesmo que alguma coisa de errado aconteca nesta tarefa.
  filaDeGravacao = tarefa.catch(function () {});

  return tarefa;
}

/**
 * Anota a leitura de cada anuncio no historico diario dele (ver registrarDia
 * no gravacao.js). So grava as chaves que mudaram.
 *
 * So e chamada quando o cache mudou ou foi renovado: o mesmo numero relido
 * em menos de 2 minutos nao chega aqui, e ele ja esta no historico do dia.
 * (Perto da meia-noite, o dia novo so ganha registro na leitura seguinte, 2
 * minutos depois - nao compensa uma regra so para isso.)
 *
 * @param {Object} novos o que a varredura leu, por codigo de anuncio
 * @param {number} agora
 * @param {boolean} automatica
 * @param {Function} pronto chamada sempre, com ou sem erro - a fila depende
 *                          dela para andar
 */
function gravarHistorico(novos, agora, automatica, pronto) {
  const codigos = Object.keys(novos);
  const chaves = codigos.map(MLMetricsGravacao.chaveDoHistorico);

  chrome.storage.local.get(chaves, function (guardado) {
    if (chrome.runtime.lastError) {
      pronto();
      return;
    }

    const alterados = {};

    try {
      codigos.forEach(function (codigo) {
        const chave = MLMetricsGravacao.chaveDoHistorico(codigo);
        const historico = guardado[chave] || {};

        if (MLMetricsGravacao.registrarDia(historico, novos[codigo], agora, automatica)) {
          alterados[chave] = historico;
        }
      });
    } catch (e) {
      // Leitura em formato inesperado: sem historico desta vez, mas a fila
      // NAO pode travar - pronto() tem que ser chamada de qualquer jeito.
      pronto();
      return;
    }

    if (Object.keys(alterados).length === 0) {
      pronto();
      return;
    }

    chrome.storage.local.set(alterados, function () {
      if (chrome.runtime.lastError) {
        console.warn("[ML METRICS] nao consegui gravar o historico: " +
          chrome.runtime.lastError.message);
      }
      pronto();
    });
  });
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

// ----------------------------------------------------------------------------
// Numero no icone da extensao
// ----------------------------------------------------------------------------

/**
 * Mostra no icone quantos anuncios tem numero conferivel.
 *
 * Por que: hoje, para saber se a extensao esta capturando, e preciso abrir o
 * popup. O numero no icone responde isso de relance - e, se ele ficar vazio
 * depois de uma passada por "Minhas publicacoes", isso tambem e resposta.
 * Vale mais para quem nao e tecnica: e o sinal de "estou viva e trabalhando".
 *
 * Vazio quando nao ha nada: um "0" no icone parece defeito. Acima de 99 vira
 * "99+", que e o que cabe no espaco.
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
    // Navegador sem chrome.action (ou contexto invalidado): o icone fica sem
    // numero, e nada mais depende disso.
  }
}

// Toda gravacao no cache - venha de qual aba vier - atualiza o numero.
chrome.storage.onChanged.addListener(function (mudancas, area) {
  if (area !== "local" || !mudancas[CHAVE_CACHE]) return;
  atualizarDistintivo(mudancas[CHAVE_CACHE].newValue);
});

// O service worker do Manifest V3 e desligado quando fica ocioso e acorda a
// cada evento. Em toda acordada reconferimos o numero: depois de um reinicio
// do navegador ele volta zerado, e ficaria mentindo "nao capturei nada".
try {
  chrome.storage.local.get([CHAVE_CACHE], function (guardado) {
    if (chrome.runtime.lastError) return;
    atualizarDistintivo(guardado[CHAVE_CACHE]);
  });
} catch (e) {
  // contexto invalidado durante a atualizacao da extensao
}
