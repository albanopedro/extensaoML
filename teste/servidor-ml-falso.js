// ============================================================================
// SERVIDOR "MERCADO LIVRE" LOCAL - serve as fixtures no endereco de verdade
//
// A extensao so entra em paginas https://*.mercadolivre.com.br (e o manifest
// que manda). Para exercitar a extensao INSTALADA sem depender do site nem de
// conta nenhuma, servimos as fixtures aqui e o navegador sobe com
// --host-resolver-rules mandando esse dominio para 127.0.0.1 (ver edge-cdp.js).
//
// Usado por dois programas:
//   - teste/verificar-no-edge.js  (verificacao automatica, sem janela)
//   - teste/abrir-demo.js         (janela aberta, para olhar e clicar)
//
// Nada sai desta maquina: o servidor escuta so em 127.0.0.1 e entrega uma
// lista FECHADA de arquivos.
// ============================================================================

"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const { certificado, pastaDoTeste } = require("./edge-cdp.js");

/**
 * Uma pagina REAL do Mercado Livre salva em teste/, se existir nesta maquina.
 *
 * Esses arquivos (MLreal*.html, testenomantereal*.html) tem dado da cliente e
 * estao no .gitignore - nunca entram no repositorio. Quem os tem exercita a
 * extensao numa pagina do tamanho de verdade (perto de 900 KB); quem nao os
 * tem simplesmente nao usa as rotas que dependem dela.
 *
 * @returns {string|null} nome do arquivo em teste/
 */
function paginaRealSalva() {
  const candidatas = fs.readdirSync(__dirname).filter(function (nome) {
    return /^(MLreal|testenomantereal).*\.html$/.test(nome);
  });

  return candidatas.length > 0 ? candidatas.sort()[0] : null;
}

/**
 * Segunda tela de vendedor: a mesma fixture com OUTROS codigos.
 *
 * Serve ao caso das duas abas (#21): duas telas diferentes, cada uma com seus
 * anuncios, gravando ao mesmo tempo. Se uma apagasse o que a outra gravou, os
 * codigos da primeira sumiriam do cache.
 */
function segundaTela(html) {
  return html.replace(/MLB-(\d)(\d{9})/g, "MLB-8$2");
}

/**
 * Cria o servidor https com as telas de teste.
 *
 * @returns {https.Server}
 */
function criarServidor() {
  const { chave, cert } = certificado(pastaDoTeste());

  const paginas = {
    "/anuncios/lista": "publicacoes.html",
    "/vendas/lista": "publicacoes.html",
    "/MLB-1111111111-caixa-organizadora": "MLB-1111111111-anuncio.html",
    // Vitrine nova: o endereco so tem o codigo MLBU do caminho, e o do item
    // esta dentro da pagina (lote 29).
    "/kit-2-caixa/up/MLBU0000000001": "vitrine-up-sanitizada.html",
    "/pagina-pesada": paginaRealSalva(),
    // A mesma pagina real, num endereco com a forma /up/.
    "/vitrine-real/up/MLBU0000000099": paginaRealSalva()
  };

  return https.createServer({
    key: fs.readFileSync(chave),
    cert: fs.readFileSync(cert)
  }, function (req, res) {
    const caminho = req.url.split("?")[0];
    const arquivo = paginas[caminho];

    if (!arquivo) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("fora da lista de fixtures");
      return;
    }

    let html = fs.readFileSync(path.join(__dirname, arquivo), "utf8");
    if (caminho === "/vendas/lista") html = segundaTela(html);

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(html);
  });
}

module.exports = {
  criarServidor: criarServidor,
  paginaRealSalva: paginaRealSalva
};
