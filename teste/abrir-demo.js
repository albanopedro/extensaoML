// ============================================================================
// DEMONSTRACAO - abre o Edge com a extensao instalada, para VER e CLICAR
//
// Para que serve: experimentar a extensao sem ter conta de vendedor e sem
// depender da cliente. As telas de teste sao servidas no endereco de verdade
// (https://www.mercadolivre.com.br/...), entao a extensao roda nelas
// exatamente como rodaria no site - captura, grava, desenha o painel.
//
// A diferenca para o teste automatico (verificar-no-edge.js) e so esta: aqui
// a janela fica ABERTA para voce mexer, e nada e conferido sozinho.
//
// Como rodar:
//
//   node teste/abrir-demo.js
//
// Para encerrar: feche a janela do Edge, ou Ctrl+C aqui no terminal.
//
// Usa um perfil separado e descartavel: seu Edge do dia a dia, com suas abas
// e seus logins, nao e tocado. Nenhuma requisicao sai desta maquina.
// ============================================================================

"use strict";

const path = require("path");

const { abrirEdge, extensaoParaCarregar, pastaDoTeste } = require("./edge-cdp.js");
const { criarServidor } = require("./servidor-ml-falso.js");

const RAIZ = path.join(__dirname, "..");
const PORTA_FIXTURES = 8443;

const ROTEIRO = [
  "",
  "O que abriu:",
  "  1) \"Minhas publicações\" (tela de vendedor de teste, com 6 anúncios)",
  "  2) a página de um anúncio",
  "",
  "O que experimentar:",
  "  - Na tela de publicações, o aviso VERDE no canto: é a captura acontecendo.",
  "  - No ícone da extensão (canto da barra), a lista de anúncios com o trecho",
  "    « » de onde cada número foi lido. É o que a cliente vai conferir.",
  "  - Marque \"✓ bate\" ou \"✗ não bate\" num anúncio, feche a janelinha e",
  "    abra de novo: a marca continua. Depois clique em \"Copiar conferência\".",
  "  - Na aba do anúncio, o painel AZUL no canto superior direito. Passe o",
  "    mouse sobre um número para ver de onde ele veio; feche no × e recarregue",
  "    a página para ele voltar.",
  "  - \"Copiar diagnóstico\" na tela de publicações: é o texto que a cliente",
  "    vai mandar. Cole num arquivo e leia com:",
  "        node teste/ler-diagnostico.js diagnostico.json",
  "",
  "Os números são de mentira (fixtures do projeto), mas o caminho que eles",
  "percorrem é o de verdade: mesmo coletor, mesmo service worker, mesmo",
  "storage do navegador.",
  ""
];

(async function () {
  const servidor = criarServidor();
  await new Promise(function (r) { servidor.listen(PORTA_FIXTURES, "127.0.0.1", r); });

  const extensao = extensaoParaCarregar(RAIZ, pastaDoTeste());
  console.log("Extensão carregada de: " + extensao.origem);

  const navegador = await abrirEdge({
    extensao: extensao.caminho,
    porta: PORTA_FIXTURES,
    headless: false
  });

  await navegador.abrirAba("https://www.mercadolivre.com.br/anuncios/lista");
  await navegador.abrirAba(
    "https://produto.mercadolivre.com.br/MLB-1111111111-caixa-organizadora");

  console.log(ROTEIRO.join("\n"));
  console.log("Feche a janela do Edge (ou Ctrl+C aqui) para encerrar.");

  function encerrar() {
    navegador.fechar();
    servidor.close();
    process.exit(0);
  }

  navegador.processo.on("exit", encerrar);
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
})();
