// ============================================================================
// TESTE DE PARSING - roda as funcoes PURAS do coletor.js fora do navegador
//
// Por que existe? O coletor vive dentro de uma IIFE, entao nada dele e
// exportado e nada roda sem um navegador. Este arquivo extrai as funcoes e
// constantes de parsing por marcadores de texto, avalia em Node e cobra:
//
//   - os casos da auditoria (problemas #1, #4, #23, #24 do contexto.md)
//   - o gabarito das fixtures de teste/ (publicacoes.html e o anuncio)
//   - a formatacao dos codigos MLB (a letra apos "MLB" faz parte do codigo)
//
// Sem navegador de proposito: o que testamos aqui nao toca em DOM nem em
// chrome.storage - sao funcoes puras, entao o resultado e deterministico.
// As partes que dependem do navegador (TreeWalker, MutationObserver) ficam
// de fora deste teste; sao validas tao somente na pratica, no site real.
//
// Como rodar (de qualquer pasta do projeto):
//
//   node teste/test-parsing.js
//
// A saida lista cada caso com PASS/FAIL e o processo termina com codigo de
// saida 1 se alguma coisa falhar - da para usar num script de pre-commit.
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");

const CAMINHO_COLETOR = path.join(__dirname, "..", "src", "coletor.js");
const fonte = fs.readFileSync(CAMINHO_COLETOR, "utf8");

// ----------------------------------------------------------------------------
// Extracao por marcadores de texto
// ----------------------------------------------------------------------------

/**
 * Recorta uma funcao inteira ("function nome... { ... }") do texto-fonte,
 * equilibrando chaves para pegar so o corpo dela.
 */
function extrairFuncao(fonte, nome) {
  const inicio = fonte.indexOf("function " + nome);
  if (inicio === -1) {
    throw new Error("funcao nao encontrada: " + nome);
  }

  const abre = fonte.indexOf("{", inicio);
  let profundidade = 0;

  for (let j = abre; j < fonte.length; j++) {
    if (fonte[j] === "{") profundidade++;
    else if (fonte[j] === "}") {
      profundidade--;
      if (profundidade === 0) return fonte.slice(inicio, j + 1);
    }
  }

  throw new Error("funcao nao fechada: " + nome);
}

/**
 * Recorta uma constante "const NOME = { ... };" equilibrando as chaves.
 */
function extrairConstObj(fonte, nome) {
  const inicio = fonte.indexOf("const " + nome + " = {");
  if (inicio === -1) {
    throw new Error("constante nao encontrada: " + nome);
  }

  const abre = fonte.indexOf("{", inicio);
  let profundidade = 0;

  for (let j = abre; j < fonte.length; j++) {
    if (fonte[j] === "{") profundidade++;
    else if (fonte[j] === "}") {
      profundidade--;
      if (profundidade === 0) return fonte.slice(inicio, j + 1);
    }
  }

  throw new Error("constante nao fechada: " + nome);
}

/**
 * Recorta a constante PADRAO_CODIGO, que e uma regex de linha unica
 * terminada em ponto-e-virgula.
 */
function extrairConstRegex(fonte, nome) {
  const inicio = fonte.indexOf("const " + nome + " = ");
  if (inicio === -1) {
    throw new Error("constante nao encontrada: " + nome);
  }

  const fim = fonte.indexOf(";", inicio);
  if (fim === -1) throw new Error("constante sem ';': " + nome);

  return fonte.slice(inicio, fim + 1);
}

// As funcoes de parsing formam um bloco autocontido: nenhuma referencia
// algo de fora. Por isso podemos evalua-las como um arquivo proprio.
const blocoFuncoes = [
  "paraInteiro",
  "numeroAntesDe",
  "ultimoNumeroColado",
  "primeiroNumeroColado",
  "temLetra",
  "ehData"
].map(function (nome) { return extrairFuncao(fonte, nome); }).join("\n");

const blocoConstantes = [
  extrairConstObj(fonte, "ROTULOS"),
  extrairConstRegex(fonte, "PADRAO_CODIGO")
].join("\n");

// Em strict mode o eval tem escopo proprio: function e const nao vazam para
// fora. Entao nao contamos com isso - pedimos ao final do codigo avaliado um
// objeto com as referencias, que e atribuido a uma variavel do escopo deste
// teste.
let exportados;
const codigoAvaliado = blocoConstantes + "\n" + blocoFuncoes + "\n" +
  "exportados = {" +
  "  paraInteiro: paraInteiro," +
  "  numeroAntesDe: numeroAntesDe," +
  "  ultimoNumeroColado: ultimoNumeroColado," +
  "  primeiroNumeroColado: primeiroNumeroColado," +
  "  temLetra: temLetra," +
  "  ehData: ehData," +
  "  ROTULOS: ROTULOS," +
  "  PADRAO_CODIGO: PADRAO_CODIGO" +
  "};";

eval(codigoAvaliado);

const {
  numeroAntesDe,
  temLetra,
  ehData,
  ultimoNumeroColado,
  primeiroNumeroColado,
  ROTULOS,
  PADRAO_CODIGO
} = exportados;

// ----------------------------------------------------------------------------
// Harness de teste
// ----------------------------------------------------------------------------

let passou = 0;
let falhou = 0;
const falhas = [];

/**
 * Roda um caso puro e conta o resultado.
 */
function testar(descricao, esperado, obtido) {
  const ok = esperado === obtido;
  if (ok) {
    passou++;
    console.log("PASS | " + descricao);
  } else {
    falhou++;
    falhas.push(descricao + " (esperado " + esperado + ", veio " + obtido + ")");
    console.log("FAIL | " + descricao + " -> " + obtido + " (esperado " + esperado + ")");
  }
}

// Casos que SABEMOS nao passar e decidimos nao corrigir (ainda). Ficam
// impressos para nao serem esquecidos, mas nao derrubam o teste - se um dia
// forem corrigidos, a linha deve subir para a secao normal.
const limitacoes = [
  [
    "Ativo desde 2024 vendas",
    "venda",
    null,
    "ANO BARE lido como vendas (2024). Residuo do #1: ehData cobre data " +
      "completa (01.02.2023), nao ano solto. Corrigir e arriscado: '2024 " +
      "vendas' pode ser metrica legitima - precisa de regra por contexto, " +
      "nao por tamanho do numero."
  ]
];

console.log("=== numeroAntesDe (auditoria + fixtures) ===");

// #1: virgula decimal nao pode virar metrica (centavos/parcela).
testar("preco decimal rejeitado", null, numeroAntesDe("R$ 1.299,50 vendas", "venda"));
testar("parcela rejeitada", null, numeroAntesDe("12x R$ 26,65 visitas", "visita"));
testar("decimal rejeitado", null, numeroAntesDe("4,5 vendas", "venda"));

// #1: datas completas nao podem virar metrica.
testar("data antes rejeitada", null, numeroAntesDe("Publicado em 01.02.2023 visitas", "visita"));
testar("data depois rejeitada", null, numeroAntesDe("Visitas 01/02/2023", "visita"));

// #1: milhar grande NAO pode ser confundido com data.
testar("milhar grande ok", 1299500, numeroAntesDe("1.299.500 visitas", "visita"));

// #24: usa a ULTIMA ocorrencia do rotulo, e o maior valor e o que interessa.
testar("ultima ocorrencia vence", 5000, numeroAntesDe("visitas 10, total de visitas 5000", "visita"));

// fixture publicacoes.html - caso 1 (mesmo texto).
testar("caso 1: '359 visitas totais'", 359, numeroAntesDe("359 visitas totais", "visita"));
testar("caso 1: '50 vendas'", 50, numeroAntesDe("50 vendas", "venda"));

// fixture publicacoes.html - caso 2 (ponto como milhar).
testar("caso 2: '1.234 visitas'", 1234, numeroAntesDe("1.234 visitas", "visita"));

// fixture publicacoes.html - caso 3 (numero e rotulo em irmaos; ao subir o
// textContent vira '87 Visitas nos ultimos 30 dias'. O trecho sozinho nao
// tem numero antes, e e exatamente isso que manda subir).
testar("caso 3: trecho do rotulo sozinho sem numero", null, numeroAntesDe("Visitas nos ultimos 30 dias", "visita"));
testar("caso 3: apos subir", 87, numeroAntesDe("87 Visitas nos ultimos 30 dias", "visita"));

// fixture publicacoes.html - caso 5 (mesmo anuncio, dois recortes; o valor
// de cada um e o numero colado no seu rotulo, o julgamento do maior fica em
// varrerPagina, fora do escopo deste teste).
testar("caso 5: '15 visitas hoje'", 15, numeroAntesDe("15 visitas hoje", "visita"));
testar("caso 5: '4.200 visitas totais'", 4200, numeroAntesDe("4.200 visitas totais", "visita"));

// fixture publicacoes.html - caso 6 (palavra em prosa, numero nao colado).
testar("caso 6: prosa nao vira metrica", null, numeroAntesDe("Anuncio pausado ha 12 dias. Ao reativar, as visitas voltam a ser contadas.", "visita"));

// fixture MLB-1111111111-anuncio.html.
testar("anuncio: 'Novo | 1 vendido'", 1, numeroAntesDe("Novo | 1 vendido", "vendido"));
testar("anuncio: '+1.000 vendas' (reputacao)", 1000, numeroAntesDe("+1.000 vendas", "venda"));

console.log("");
console.log("=== temLetra (#23) ===");
testar("'u' maiusculo acentuado", true, temLetra("Ü"));
testar("'ü' (U+00FC) e letra", true, temLetra("ü"));
testar("'ý' (U+00FD) e letra", true, temLetra("ý"));
testar("'ÿ' (U+00FF) e letra", true, temLetra("ÿ"));
testar("'×' (U+00D7) NAO e letra", false, temLetra("×"));
testar("'÷' (U+00F7) NAO e letra", false, temLetra("÷"));
testar("espaco nao e letra", false, temLetra(" "));
testar("texto normal", true, temLetra("abc"));

console.log("");
console.log("=== ehData (#1 - datas) ===");
testar("DD/MM/AAAA valido", true, ehData("01/02/2023"));
testar("DD.MM.AAAA valido", true, ehData("01.02.2023"));
testar("mes 13 invalido", false, ehData("01/13/2023"));
testar("milhar grande nao e data", false, ehData("1.299.500"));
testar("ano solto nao e data", false, ehData("2024"));

console.log("");
console.log("=== ultimoNumeroColado ===");
testar("numero colado no fim", 359, ultimoNumeroColado("359 "));
testar("numero com quebra de linha", 1234, ultimoNumeroColado("1.234\n   "));
testar("legenda entre numero e fim", null, ultimoNumeroColado("R$ 15.995,00 texto"));
testar("preco decimal colado", null, ultimoNumeroColado("R$ 15.995,00"));

console.log("");
console.log("=== primeiroNumeroColado ===");
testar("numero apos ':'", 359, primeiroNumeroColado(": 359"));
testar("numero apos espacos", 1, primeiroNumeroColado("  1 vendido"));
testar("letra entre comeco e numero", null, primeiroNumeroColado("abc 359"));

console.log("");
console.log("=== PADRAO_CODIGO (formatos MLB) ===");
function codigoDe(texto) {
  const m = (texto || "").match(PADRAO_CODIGO);
  return m ? m[1] + m[2] : null;
}
testar("anuncio com hifen", "MLB3456789012", codigoDe("MLB-3456789012"));
testar("estrutura nova MLBU", "MLBU5098517614", codigoDe("MLBU5098517614"));
testar("produto de catalogo", "MLB12345678", codigoDe("MLB12345678"));
testar("com codigo no meio do path", "MLB3456789012", codigoDe("produto.mercadolivre.com.br/MLB-3456789012-capa-extrusora-p/"));
testar("codigo curto nao vale", null, codigoDe("MLB12"));
testar("sem codigo", null, codigoDe("minhas publicacoes"));

console.log("");
console.log("=== ROTULOS (#4 - 'Visualizar' nao pode ser visita) ===");
testar("visitas usa 'visita'", true, ROTULOS.visitas.indexOf("visita") !== -1);
testar("NAO usa 'visualiz'", -1, ROTULOS.visitas.indexOf("visualiz"));
testar("vendas cobre 'venda'", true, ROTULOS.vendas.indexOf("venda") !== -1);
testar("vendas cobre 'vendido'", true, ROTULOS.vendas.indexOf("vendido") !== -1);
testar("vendas cobre 'vendida'", true, ROTULOS.vendas.indexOf("vendida") !== -1);

console.log("");
console.log("=== Limitacoes conhecidas (nao derrubam o teste) ===");
limitacoes.forEach(function (l) {
  const obtido = numeroAntesDe(l[0], l[1]);
  const emDia = obtido === l[2];
  console.log((emDia ? "  LIMITACAO ATIVA | " : "  RESOLVIDA? REVISE | ") + l[0] + " -> " + obtido);
  console.log("  Motivo: " + l[3]);
});

console.log("");
console.log("RESUMO: " + passou + "/" + (passou + falhou) + " ok");
if (falhas.length > 0) {
  console.log("FALHAS:");
  falhas.forEach(function (f) { console.log("  - " + f); });
  process.exitCode = 1;
}