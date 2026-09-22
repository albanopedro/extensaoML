// ============================================================================
// VERIFICACAO NO EDGE - os itens da lista manual, com a extensao INSTALADA
//
// Substitui o ritual de abrir o Edge, carregar a extensao, passar por telas e
// conferir na mao os 11 itens da secao 4 do contexto.md. Aqui tudo isso roda
// sozinho, contra a extensao de verdade: service worker, chrome.storage real,
// mensagens entre popup, aba e service worker, e o script que fica orfao
// quando a extensao e recarregada.
//
// O que ele NAO substitui: olhar. Cor, posicao e tamanho do painel e do popup
// continuam sendo coisa de olho humano (e a pagina teste/rodar-no-navegador.html
// mostra o painel montado). Aqui o que se prova e comportamento.
//
// Como rodar:
//
//   node teste/verificar-no-edge.js            (sem janela)
//   node teste/verificar-no-edge.js --com-janela   (para ver acontecendo)
//
// Precisa do Edge instalado e do openssl (vem com o Git para Windows).
// Carrega o ZIP mais recente de dist/ quando existe - e o que a cliente
// recebe, entao o empacotamento entra na conta.
//
// As fixtures sao servidas como https://www.mercadolivre.com.br/... (ver
// edge-cdp.js): e o endereco que faz o manifest injetar os content scripts.
// Nenhuma requisicao sai desta maquina e o perfil do Edge e novo, sem login.
// ============================================================================

"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const {
  abrirEdge, certificado, esperar, extensaoParaCarregar, pastaDoTeste
} = require("./edge-cdp.js");

const RAIZ = path.join(__dirname, "..");
const PORTA_FIXTURES = 8443;
const COM_JANELA = process.argv.indexOf("--com-janela") !== -1;

// --extensao=<pasta> testa OUTRA copia da extensao, em vez do zip de dist/.
// Serve para conferir um build especifico e, principalmente, para provar que
// este teste reprova de verdade: com uma copia quebrada de proposito, os
// casos correspondentes tem que falhar.
const ESCOLHIDA = (process.argv.find(function (arg) {
  return arg.indexOf("--extensao=") === 0;
}) || "").split("=")[1];

let passou = 0;
const falhas = [];

function testar(descricao, esperado, obtido) {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido);

  if (ok) {
    passou++;
    console.log("PASS | " + descricao);
  } else {
    falhas.push(descricao);
    console.log("FAIL | " + descricao +
      "\n       veio:     " + JSON.stringify(obtido) +
      "\n       esperado: " + JSON.stringify(esperado));
  }
}

// ----------------------------------------------------------------------------
// Servidor das fixtures, com cara de Mercado Livre
// ----------------------------------------------------------------------------

/**
 * Segunda tela de vendedor: a mesma fixture com OUTROS codigos.
 *
 * Serve ao teste das duas abas (#21): duas telas diferentes, cada uma com
 * seus anuncios, gravando ao mesmo tempo. Se uma apagasse o que a outra
 * gravou, os codigos da primeira sumiriam do cache.
 */
function segundaTela(html) {
  return html.replace(/MLB-(\d)(\d{9})/g, "MLB-8$2");
}

/**
 * Uma pagina REAL do Mercado Livre salva em teste/, se existir nesta maquina.
 *
 * Esses arquivos (MLreal*.html, testenomantereal*.html) tem dado da cliente e
 * estao no .gitignore - nunca entram no repositorio. Quem os tem mede o custo
 * da leitura numa pagina do tamanho de verdade (perto de 900 KB); quem nao os
 * tem simplesmente pula esse caso. Nada do conteudo e impresso: so tempo.
 *
 * @returns {string|null} nome do arquivo em teste/
 */
function paginaRealSalva() {
  const candidatas = fs.readdirSync(__dirname).filter(function (nome) {
    return /^(MLreal|testenomantereal).*\.html$/.test(nome);
  });

  return candidatas.length > 0 ? candidatas.sort()[0] : null;
}

function criarServidor() {
  const { chave, cert } = certificado(pastaDoTeste());

  const paginas = {
    "/anuncios/lista": "publicacoes.html",
    "/vendas/lista": "publicacoes.html",
    "/MLB-1111111111-caixa-organizadora": "MLB-1111111111-anuncio.html",
    "/pagina-pesada": paginaRealSalva()
  };

  return https.createServer({
    key: fs.readFileSync(chave),
    cert: fs.readFileSync(cert)
  }, function (req, res) {
    const caminho = req.url.split("?")[0];
    const arquivo = paginas[caminho];

    if (!arquivo) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("fora da lista de fixtures");
      return;
    }

    let html = fs.readFileSync(path.join(__dirname, arquivo), "utf8");
    if (caminho === "/vendas/lista") html = segundaTela(html);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  });
}

// ----------------------------------------------------------------------------
// Atalhos para conversar com a extensao
// ----------------------------------------------------------------------------

/**
 * Abre (ou reabre) uma sessao no service worker da extensao.
 *
 * Reabrir e necessario depois de recarregar a extensao - o service worker
 * antigo morre - e tambem quando o navegador desliga o service worker por
 * inatividade, que e o comportamento normal do Manifest V3.
 */
async function sessaoDoServiceWorker(navegador) {
  const alvo = await navegador.acharAlvo(/^chrome-extension:\/\/[a-z]+\/src\/background\.js$/);
  if (!alvo) throw new Error("nao achei o service worker da extensao");

  const sessao = await navegador.sessaoDe(alvo);

  // O service worker aparece como alvo antes de as APIs da extensao estarem
  // prontas: rodar codigo cedo demais da "chrome is not defined".
  for (let i = 0; i < 30; i++) {
    const pronto = await navegador.rodar(sessao,
      "return typeof chrome !== 'undefined' && Boolean(chrome.runtime);");

    if (pronto) break;
    await esperar(300);
  }

  return { id: alvo.url.split("/")[2], sessao: sessao };
}

function armazenamento(navegador, sw) {
  return navegador.rodar(sw.sessao, "return await chrome.storage.local.get(null);");
}

/**
 * Espera uma condicao acontecer, em vez de dormir um tempo fixo.
 *
 * Tempo fixo aqui e teste que falha sozinho: a captura depende do
 * MutationObserver, do service worker acordar e do storage gravar, e isso
 * varia com a maquina. Devolve o ultimo valor lido - se nunca ficou bom, e
 * ele que o teste mostra na falha.
 *
 * @param {Function} ler funcao assincrona que devolve o valor
 * @param {Function} bom recebe o valor e diz se ja da
 * @param {number} [segundos]
 */
async function ate(ler, bom, segundos) {
  const limite = Date.now() + (segundos || 10) * 1000;
  let valor = null;

  while (Date.now() < limite) {
    valor = await ler();
    if (bom(valor)) return valor;
    await esperar(300);
  }

  return valor;
}

function chavesDaExtensao(guardado) {
  return Object.keys(guardado).filter(function (chave) {
    return chave.indexOf("mlmetrics_") === 0;
  }).sort();
}

// ----------------------------------------------------------------------------
// A verificacao
// ----------------------------------------------------------------------------

async function verificar() {
  const servidor = criarServidor();
  await new Promise(function (r) { servidor.listen(PORTA_FIXTURES, "127.0.0.1", r); });

  const extensao = ESCOLHIDA
    ? { caminho: ESCOLHIDA, origem: ESCOLHIDA }
    : extensaoParaCarregar(RAIZ, pastaDoTeste());
  console.log("Extensao carregada de: " + extensao.origem);
  console.log("");

  const navegador = await abrirEdge({
    extensao: extensao.caminho,
    porta: PORTA_FIXTURES,
    headless: !COM_JANELA
  });

  try {
    let sw = await sessaoDoServiceWorker(navegador);
    const versao = await navegador.rodar(sw.sessao, "return chrome.runtime.getManifest().version;");

    console.log("ML Metrics v" + versao + " viva no Edge (id " + sw.id + ")");
    console.log("");

    // --- Captura numa tela de vendedor de verdade --------------------------
    const lista = await navegador.abrirAba("https://www.mercadolivre.com.br/anuncios/lista");

    let guardado = await ate(
      function () { return armazenamento(navegador, sw); },
      function (tudo) { return Boolean((tudo.mlmetrics_dados || {}).MLB1111111111); }
    );
    const cache = guardado.mlmetrics_dados || {};

    testar("captura: a tela de vendedor entrega numeros para o storage real", 359,
      (cache.MLB1111111111 || {}).visitas);
    testar("captura: com rastro de origem (#56)", true,
      Boolean(((cache.MLB1111111111 || {}).origem || {}).visitas));

    // Item 10 da lista: historico diario.
    const hoje = await navegador.rodar(sw.sessao,
      "return MLMetricsGravacao.diaDe(Date.now());");
    const historico = (await ate(
      function () { return armazenamento(navegador, sw); },
      function (tudo) { return Boolean(tudo["mlmetrics_historico_MLB1111111111"]); },
      5
    ))["mlmetrics_historico_MLB1111111111"] || {};

    testar("item 10 - historico: o dia de hoje foi gravado", 359,
      (historico[hoje] || {}).visitas);

    // --- Itens 1 e 7: diagnostico da aba ativa -----------------------------
    // O popup pergunta a aba ATIVA (chrome.tabs.query + sendMessage). Aqui o
    // pedido sai do service worker, que e o mesmo caminho de mensagem; o
    // popup em si e testado logo abaixo, na aba dele.
    await navegador.ativarAba(lista);

    const diagnostico = await ate(
      function () {
        return navegador.rodar(sw.sessao, `
          const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
          try {
            const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: "diagnosticar" }, { frameId: 0 });
            return { ok: true, url: aba.url, resposta: resposta };
          } catch (e) {
            return { ok: false, url: aba.url, erro: String(e.message || e) };
          }
        `);
      },
      function (resultado) { return resultado.ok === true; }
    );

    const tela = (diagnostico.resposta || {});

    testar("item 1 - diagnostico: a aba do ML responde", true, diagnostico.ok);
    testar("item 1 - diagnostico: host, caminho mascarado e travas",
      ["www.mercadolivre.com.br", "/anuncios/lista", false, true],
      [tela.host, tela.caminho, tela.vitrine, tela.mencionaVisita]);
    testar("item 1 - diagnostico: traz periodo e amostras", true,
      Array.isArray(tela.periodo) && Array.isArray(tela.amostras));
    testar("item 7 - diagnostico (#59): recusas com motivo", true,
      Boolean(tela.resumoDasRecusas) && Array.isArray(tela.recusas));

    // --- Item 2: aba que nao e do Mercado Livre ----------------------------
    const foraDoML = await navegador.abrirAba("about:blank");
    await navegador.ativarAba(foraDoML);
    await esperar(400);

    const semResposta = await navegador.rodar(sw.sessao, `
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
      try {
        await chrome.tabs.sendMessage(aba.id, { tipo: "diagnosticar" }, { frameId: 0 });
        return { respondeu: true };
      } catch (e) {
        return { respondeu: false };
      }
    `);

    testar("item 2 - aba fora do ML nao responde (vira a mensagem de F5)", false,
      semResposta.respondeu);
    await navegador.fecharAba(foraDoML);

    // --- Item 8: duas telas de vendedor ao mesmo tempo (#21) ---------------
    const vendas = await navegador.abrirAba("https://www.mercadolivre.com.br/vendas/lista");

    guardado = await ate(
      function () { return armazenamento(navegador, sw); },
      function (tudo) { return Boolean((tudo.mlmetrics_dados || {}).MLB8111111111); }
    );
    const codigos = Object.keys(guardado.mlmetrics_dados || {}).sort();

    testar("item 8 - duas abas: nenhuma apaga o que a outra gravou", true,
      codigos.indexOf("MLB1111111111") !== -1 && codigos.indexOf("MLB8111111111") !== -1);

    // --- Item 5: painel no anuncio e o fechar que dura (#45) ---------------
    const anuncio = await navegador.abrirAba(
      "https://produto.mercadolivre.com.br/MLB-1111111111-caixa-organizadora");

    const painel = await ate(
      function () {
        return navegador.rodar(anuncio.sessao, `
          const p = document.getElementById("mlmetrics-painel");
          return p ? p.textContent.replace(/\\s+/g, " ").trim() : null;
        `);
      },
      function (texto) { return Boolean(texto); }
    );

    testar("painel: aparece no anuncio com os numeros capturados", true,
      Boolean(painel) && painel.indexOf("359") !== -1);

    await navegador.rodar(anuncio.sessao,
      "document.querySelector('#mlmetrics-painel .mlmetrics-fechar').click(); return true;");

    // Gravacao nova no cache: antes do #45 isso fazia o painel voltar sozinho.
    await navegador.rodar(sw.sessao, `
      const g = await chrome.storage.local.get("mlmetrics_dados");
      const cache = g.mlmetrics_dados;
      cache.MLB1111111111.visitas = 999;
      cache.MLB1111111111.origem.visitas.em = Date.now();
      await chrome.storage.local.set({ mlmetrics_dados: cache });
      return true;
    `);
    await esperar(1200);

    testar("item 5 - painel fechado nao volta com gravacao nova", null,
      await navegador.rodar(anuncio.sessao,
        "return document.getElementById('mlmetrics-painel');"));

    // --- Popup de verdade: itens 9, 6, 11 e 4 ------------------------------
    const popup = await navegador.abrirAba("chrome-extension://" + sw.id + "/src/popup.html");
    await esperar(900);

    testar("item 9 - popup mostra a versao instalada", "v" + versao,
      await navegador.rodar(popup.sessao,
        "return document.getElementById('versao').textContent;"));

    testar("item 6 - popup mostra o trecho de onde cada numero saiu", true,
      await navegador.rodar(popup.sessao, `
        const rastro = document.querySelector(".item .origem");
        return Boolean(rastro) && rastro.textContent.indexOf("«") !== -1;
      `));

    // Item 11: marcar a conferencia, fechar o popup e reabrir.
    await navegador.rodar(popup.sessao,
      "document.querySelector('.item .conferir button').click(); return true;");

    guardado = await ate(
      function () { return armazenamento(navegador, sw); },
      function (tudo) { return Boolean(tudo.mlmetrics_conferencia); },
      5
    );
    const marcados = Object.keys(guardado.mlmetrics_conferencia || {});

    testar("item 11 - conferencia: a marca vai para o storage", 1, marcados.length);

    await navegador.recarregarAba(popup);

    testar("item 11 - conferencia: a marca continua depois de reabrir o popup", true,
      await navegador.rodar(popup.sessao, `
        return Boolean(document.querySelector(".item .conferir button.bate-sim"));
      `));

    await navegador.rodar(popup.sessao,
      "document.getElementById('conferencia').click(); return true;");
    await esperar(600);

    testar("item 11 - conferencia: o texto sai pronto, com resultado e rastro", true,
      await navegador.rodar(popup.sessao, `
        const texto = document.getElementById("diagnostico").value;
        return /BATEU/.test(texto) && texto.indexOf("«") !== -1;
      `));

    // Item 4: limpar TUDO pelo prefixo.
    await navegador.rodar(popup.sessao,
      "document.getElementById('limpar').click(); return true;");
    await esperar(900);

    testar("item 4 - limpar apaga todas as chaves da extensao", [],
      chavesDaExtensao(await armazenamento(navegador, sw)));

    // --- Custo da leitura numa pagina real (pesada) ------------------------
    // A leitura roda a cada mutacao do DOM, e a pagina do ML e grande. Se ela
    // pesar, a navegacao da cliente engasga - e ninguem associaria isso a
    // extensao. Medimos na pagina real salva (fora do repositorio); sem ela,
    // o caso e pulado.
    const pesada = paginaRealSalva();

    if (!pesada) {
      console.log("PULADO | custo da leitura: nenhuma pagina real salva em teste/");
    } else {
      const aba = await navegador.abrirAba("https://www.mercadolivre.com.br/pagina-pesada");
      await esperar(1500);

      const tamanho = await navegador.rodar(aba.sessao,
        "return document.documentElement.outerHTML.length;");

      // O portao: roda em TODA pagina do ML, a cada lote de mutacoes. E o
      // custo que a cliente paga o tempo todo, mesmo onde nao ha o que ler.
      const portao = await navegador.rodarNaExtensao(aba, "ML Metrics", `
        const tempos = [];
        for (let i = 0; i < 3; i++) {
          const inicio = performance.now();
          MLMetricsLeitura.paginaMencionaVisita(document);
          tempos.push(performance.now() - inicio);
        }
        return Math.round(Math.min(...tempos));
      `);

      // A varredura inteira: so acontece em tela de vendedor. Como a pagina
      // salva e uma vitrine, plantamos um rotulo para o pior caso rodar.
      const varredura = await navegador.rodarNaExtensao(aba, "ML Metrics", `
        const enfeite = document.createElement("div");
        enfeite.innerHTML = '<a href="/MLB-1234567890-teste">anuncio</a>' +
          "<span>359 visitas totais</span><span>12 vendas</span>";
        document.body.appendChild(enfeite);

        const tempos = [];
        for (let i = 0; i < 3; i++) {
          const inicio = performance.now();
          MLMetricsLeitura.varrerPagina(document, location.href);
          tempos.push(performance.now() - inicio);
        }
        enfeite.remove();
        return Math.round(Math.min(...tempos));
      `);

      console.log("       (pagina de " + Math.round(tamanho / 1024) + " KB: portao " +
        portao + " ms, varredura completa " + varredura + " ms)");

      // Medido em 22/09/2026 nesta pagina de 888 KB: portao 3 ms, varredura
      // completa 7 ms. Os limites sao folgados de proposito (maquina ocupada
      // mede pior): o que se quer pegar e regressao grande, do tipo "ficou
      // dez vezes mais lento", nao milissegundo.
      testar("custo: o portao de cada mutacao fica abaixo de 100 ms", true, portao < 100);
      testar("custo: a varredura completa fica abaixo de 500 ms", true, varredura < 500);

      await navegador.fecharAba(aba);
    }

    // --- Item 3: extensao recarregada deixa a aba orfa (#42) ---------------
    // Por ultimo: recarregar a extensao mata os content scripts de TODAS as
    // abas abertas. Antes, semeamos o cache de novo e abrimos um anuncio com
    // painel, para ver o painel sumir sozinho.
    //
    // A aba de anuncio anterior sai de cena: a busca por aba (tabs.query com
    // a URL) acharia as duas, e o teste acabaria perguntando para a errada.
    await navegador.fecharAba(anuncio);
    await navegador.rodar(sw.sessao, `
      const agora = Date.now();
      await chrome.storage.local.set({
        mlmetrics_dados: {
          MLB1111111111: {
            visitas: 359, vendas: 50, capturadoEm: agora,
            origem: {
              visitas: { trecho: "«359 visitas»", tela: "/anuncios/lista", em: agora },
              vendas: { trecho: "«50 vendas»", tela: "/anuncios/lista", em: agora }
            }
          }
        }
      });
      return true;
    `);

    const orfa = await navegador.abrirAba(
      "https://produto.mercadolivre.com.br/MLB-1111111111-caixa-organizadora");

    testar("painel: volta a aparecer numa aba nova", true, await ate(
      function () {
        return navegador.rodar(orfa.sessao,
          "return Boolean(document.getElementById('mlmetrics-painel'));");
      },
      function (tem) { return tem === true; }
    ));

    await navegador.rodar(sw.sessao, "chrome.runtime.reload(); return true;").catch(function () {
      // o reload derruba a propria sessao: a falha aqui e esperada
    });
    await esperar(2500);

    sw = await sessaoDoServiceWorker(navegador);

    testar("item 3 - extensao recarregada: o painel da aba antiga some sozinho", null,
      await navegador.rodar(orfa.sessao,
        "return document.getElementById('mlmetrics-painel');"));

    const depoisDoReload = await navegador.rodar(sw.sessao, `
      const abas = await chrome.tabs.query({ url: "https://produto.mercadolivre.com.br/*" });
      if (abas.length === 0) return { semAba: true };
      try {
        await chrome.tabs.sendMessage(abas[0].id, { tipo: "diagnosticar" }, { frameId: 0 });
        return { respondeu: true };
      } catch (e) {
        return { respondeu: false };
      }
    `);

    testar("item 3 - e a aba antiga so volta a responder depois do F5", false,
      depoisDoReload.respondeu);

    await navegador.recarregarAba(orfa);

    const depoisDoF5 = await ate(
      function () {
        return navegador.rodar(sw.sessao, `
          const abas = await chrome.tabs.query({ url: "https://produto.mercadolivre.com.br/*" });
          try {
            await chrome.tabs.sendMessage(abas[0].id, { tipo: "diagnosticar" }, { frameId: 0 });
            return { respondeu: true };
          } catch (e) {
            return { respondeu: false, erro: String(e.message || e) };
          }
        `);
      },
      function (resultado) { return resultado.respondeu === true; }
    );

    testar("item 3 - depois do F5 a aba responde de novo", true, depoisDoF5.respondeu);
  } finally {
    navegador.fechar();
    servidor.close();
  }
}

verificar().then(function () {
  console.log("");
  console.log("RESUMO: " + passou + "/" + (passou + falhas.length) + " ok");

  if (falhas.length > 0) {
    console.log("FALHAS:");
    falhas.forEach(function (f) { console.log("  - " + f); });
    process.exitCode = 1;
  }
}, function (erro) {
  console.log("");
  console.log("ERRO ao rodar a verificacao: " + erro.message);
  process.exitCode = 1;
});
