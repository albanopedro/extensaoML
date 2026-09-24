// ============================================================================
// SERVIDOR DE TESTE - serve a extensao e as fixtures para o teste no navegador
//
// Como rodar, na pasta do projeto:
//
//   node teste/servidor-teste.js
//
// e abrir no navegador: http://127.0.0.1:5178/teste/rodar-no-navegador.html
//
// Por que um servidor? As fixtures nao abrem mais do disco com a extensao
// (file:///* saiu do manifest, #5), e uma pagina aberta de file:/// nao
// carrega scripts de outra pasta. Servida por http, a pagina de teste carrega
// o coletor.js e o content.js DE VERDADE sobre as fixtures.
//
// Seguranca: so escuta em 127.0.0.1 - nada fora deste computador alcanca - e
// so entrega uma lista FECHADA de arquivos: src/, a pagina de teste e as
// fixtures ficticias. As paginas reais de teste/ (MLreal*, testenomantereal*)
// nunca sao servidas.
// ============================================================================

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const PORTA = 5178;
const PAGINA_DE_TESTE = "/teste/rodar-no-navegador.html";

const PERMITIDOS = [
  /^\/src\/[\w.-]+$/,
  /^\/teste\/rodar-no-navegador\.html$/,
  /^\/teste\/publicacoes\.html$/,
  /^\/teste\/MLB-1111111111-anuncio\.html$/,
  /^\/teste\/vitrine-up-sanitizada\.html$/
];

// A vitrine sanitizada tambem responde numa rota com a FORMA da real
// ("/kit-2-caixa/up/MLBU..."). O painel decide o que procurar a partir do
// endereco, entao testar o caso do /up/ exige um endereco de /up/ - com o
// arquivo aberto direto, o caminho nao tem codigo nenhum.
const ROTA_DA_VITRINE = "/kit-2-caixa/up/MLBU0000000001";
const ARQUIVO_DA_VITRINE = "/teste/vitrine-up-sanitizada.html";

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

http.createServer(function (pedido, resposta) {
  const rota = decodeURIComponent(pedido.url.split("?")[0]);

  // A raiz leva direto para a pagina de teste.
  if (rota === "/") {
    resposta.writeHead(302, { Location: PAGINA_DE_TESTE });
    resposta.end();
    return;
  }

  const caminho = rota === ROTA_DA_VITRINE ? ARQUIVO_DA_VITRINE : rota;

  if (!PERMITIDOS.some(function (regra) { return regra.test(caminho); })) {
    resposta.writeHead(403);
    resposta.end("fora da lista de arquivos do teste");
    return;
  }

  fs.readFile(path.join(RAIZ, caminho), function (erro, dados) {
    if (erro) {
      resposta.writeHead(404);
      resposta.end("nao encontrado");
      return;
    }

    resposta.writeHead(200, {
      "Content-Type": TIPOS[path.extname(caminho)] || "application/octet-stream",
      // Sem cache: o teste sempre roda a versao atual dos arquivos.
      "Cache-Control": "no-store"
    });
    resposta.end(dados);
  });
}).listen(PORTA, "127.0.0.1", function () {
  console.log("Teste no navegador: http://127.0.0.1:" + PORTA + PAGINA_DE_TESTE);
});
