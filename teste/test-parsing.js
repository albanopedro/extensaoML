// ============================================================================
// TESTE DE PARSING - roda as funcoes PURAS do coletor.js e do content.js
// fora do navegador
//
// Por que existe? Os dois arquivos vivem dentro de IIFEs, entao nada deles
// e exportado e nada roda sem um navegador. Este arquivo extrai as funcoes
// e constantes de parsing por marcadores de texto, avalia em Node e cobra:
//
//   - os casos da auditoria (problemas #1, #4, #23, #24 do contexto.md)
//   - o gabarito das fixtures de teste/ (publicacoes.html e o anuncio)
//   - a formatacao dos codigos MLB (a letra apos "MLB" faz parte do codigo)
//   - o escopo de coleta (ehPaginaDeCompra, inclui as rotas /up/ e /p/)
//   - o calculo do painel (calcular, guarda contra NaN)
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
const CAMINHO_CONTENT = path.join(__dirname, "..", "src", "content.js");
const fonte = fs.readFileSync(CAMINHO_COLETOR, "utf8");
const fonteContent = fs.readFileSync(CAMINHO_CONTENT, "utf8");

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

/**
 * Recorta uma constante de valor unico ("const NOME = 12;"), de linha unica
 * terminada em ponto-e-virgula.
 */
function extrairConstValor(fonte, nome) {
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
  "ehData",
  "ehAnoPosDesde",
  "ehPaginaDeCompra",
  "aceitarNoDeTextoTecnico",
  "paginaMencionaVisita",
  "codigosDentroDe",
  "contextoDoAnuncio",
  "valorDoRotulo",
  "descartarImplausiveis",
  "varrerPagina"
].map(function (nome) { return extrairFuncao(fonte, nome); }).join("\n");

// O calculo do painel mora no content.js - tambem funcao pura.
const blocoFuncaoContent = extrairFuncao(fonteContent, "calcular");

const blocoConstantes = [
  extrairConstObj(fonte, "ROTULOS"),
  extrairConstRegex(fonte, "PADRAO_CODIGO"),
  extrairConstValor(fonte, "MAX_NIVEIS")
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
  "  ehAnoPosDesde: ehAnoPosDesde," +
  "  ehPaginaDeCompra: ehPaginaDeCompra," +
  "  aceitarNoDeTextoTecnico: aceitarNoDeTextoTecnico," +
  "  paginaMencionaVisita: paginaMencionaVisita," +
  "  codigosDentroDe: codigosDentroDe," +
  "  contextoDoAnuncio: contextoDoAnuncio," +
  "  valorDoRotulo: valorDoRotulo," +
  "  descartarImplausiveis: descartarImplausiveis," +
  "  varrerPagina: varrerPagina," +
  "  ROTULOS: ROTULOS," +
  "  PADRAO_CODIGO: PADRAO_CODIGO," +
  "  MAX_NIVEIS: MAX_NIVEIS" +
  "};";

eval(codigoAvaliado);

// O content.js tambem e IIFE; mesmo truque para o calcular.
let exportadosContent;
eval(blocoFuncaoContent + "\n" +
  "exportadosContent = { calcular: calcular };");

const {
  numeroAntesDe,
  temLetra,
  ehData,
  ultimoNumeroColado,
  primeiroNumeroColado,
  ehPaginaDeCompra,
  paginaMencionaVisita,
  varrerPagina,
  ROTULOS,
  PADRAO_CODIGO
} = exportados;
const { calcular } = exportadosContent;

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
const limitacoes = [];

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

// #1 (residuo): ano solto precedido de "desde" e data, nao metrica.
// So o "desde" justifica rejeitar: sem ele, "2024 vendas" pode ser
// contagem real e nao pode ser bloqueado so pelo tamanho do numero.
testar("ano com 'desde' antes rejeitado", null, numeroAntesDe("Ativo desde 2024 vendas", "venda"));
testar("ano com 'Desde' antes rejeitado", null, numeroAntesDe("Vendendo Desde 2023 visitas", "visita"));
testar("ano SEM 'desde' continua valendo", 2024, numeroAntesDe("2024 vendas", "venda"));
testar("milhar-normal com 'desde' distante", 359, numeroAntesDe("Desde 2024, 359 visitas totais", "visita"));

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
console.log("=== ehPaginaDeCompra (#34 - vitrine publica nao captura) ===");
// A pagina REAL que gerou o bug: www + rota nova /up/MLBU...
testar("www + /up/MLBU... e vitrine", true, ehPaginaDeCompra("https://www.mercadolivre.com.br/kit-2-omnibox-caixa-organizadora-modular-empilhavel-mbasic/up/MLBU5098517614"));
// Vitrine classica (host proprio) e catalogo (rota /p/MLB...).
testar("produto.mercadolivre e vitrine", true, ehPaginaDeCompra("https://produto.mercadolivre.com.br/MLB-3456789012-capa-extrusora-p/MLB3456789012"));
testar("articulo.mercadolivre e vitrine", true, ehPaginaDeCompra("https://articulo.mercadolivre.com.br/MLB-1234567890-x/MLB1234567890"));
testar("www + rota /p/MLB... e vitrine", true, ehPaginaDeCompra("https://www.mercadolivre.com.br/kit-2-caixa-organizadora/p/MLB1045308375"));
// Telas de VENDEDOR nao podem ser confundidas (nenhuma termina em /up/ ou /p/).
testar("minhas publicacoes nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/herramientas/publicaciones"));
testar("ranking de vendas nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/gz/ranking"));
testar("query com codigo nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/busca?item_id=MLB1234567890"));

console.log("");
console.log("=== calcular (#35 - painel sem NaN) ===");
// Caso normal (gabarito do anuncio).
testar("visitas+vendas+preco", 7, calcular({ visitas: 359, vendas: 50 }, 319.9).visitasPorVenda);
testar("conversao normal", 13.9, Math.round(calcular({ visitas: 359, vendas: 50 }, 319.9).conversao * 10) / 10);
testar("receita normal", 15995, Math.round(calcular({ visitas: 359, vendas: 50 }, 319.9).receita));
// O caso da pagina real /up/: vendas no cache SEM visitas. "vende a cada"
// deve ser null, nunca NaN.
const semVisitas = calcular({ vendas: 1000 }, 19.9);
testar("so vendas: vende-a-cada e null (nao NaN)", null, semVisitas.visitasPorVenda);
testar("so vendas: visitas e null", null, semVisitas.visitas);
testar("so vendas: receita calcula", 19900, semVisitas.receita);
// 500 visitas e 0 vendas: conversao DEVE ser 0 (dado real), vendas por 0 e null.
const zeroVendas = calcular({ visitas: 500, vendas: 0 }, null);
testar("0 vendas: conversao e 0%", 0, zeroVendas.conversao);
testar("0 vendas: vende-a-cada e null", null, zeroVendas.visitasPorVenda);
// Nenhum dado: tudo null.
const vazio = calcular({}, null);
testar("sem dados: tudo null", null, vazio.visitas);
testar("sem dados: vende-a-cada null", null, vazio.visitasPorVenda);

console.log("");
console.log("=== varrerPagina (#36 - so tela de vendedor entrega numeros) ===");
// O coletor toca pouquissimas APIs do DOM (textContent, nodeValue,
// parentElement, closest, querySelectorAll, getAttribute). Em vez de incluir
// um DOM de verdade (dependencia externa), montamos arvores pequenas com um
// stub fiel dessas APIs e mandamos varrerPagina trabalhar nelas - o mesmo
// codigo real do coletor, do jeito que roda no navegador.
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };

function textoDa(conteudo) {
  return { nodeValue: conteudo };
}

/**
 * Casa um seletor SIMPLES contra um no do stub. Entende apenas o subconjunto
 * que o coletor usa: "tag1, tag2, tag3", "#id" e 'tag[attr*="trecho"]'.
 * Divergir daqui para um seletor novo e erro de teste: o coletor nao deve
 * crescer mais que este vocabulario sem o stub crescer junto.
 */
function casarSeletor(el, seletor) {
  return String(seletor).split(",").some(function (item) {
    item = item.trim();
    if (item === "*") return true;
    if (item.charAt(0) === "#") {
      return el.attrs && el.attrs.id === item.slice(1);
    }
    const br = /\[([a-z]+)\*=(.+)\]$/.exec(item);
    let tag = item;
    let attrNome = null;
    let attrSub = null;
    if (br) {
      tag = item.slice(0, br.index);
      attrNome = br[1];
      attrSub = br[2].replace(/^["']|["']$/g, "");
    }
    if (tag && tag !== "*" && el.tag !== tag) return false;
    if (attrNome) {
      const valor = el.attrs && el.attrs[attrNome];
      if (typeof valor !== "string" || valor.indexOf(attrSub) === -1) return false;
    }
    return true;
  });
}

function elementoDa(tag, attrs, filhos) {
  const el = {
    tag: tag,
    attrs: attrs || {},
    filhos: filhos || [],
    nodeValue: null,
    parentElement: null
  };

  el.textContent = el.filhos.map(function (f) {
    return (f.nodeValue !== null && f.nodeValue !== undefined)
      ? f.nodeValue
      : f.textContent;
  }).join("");

  el.closest = function (seletor) {
    let atual = el;
    while (atual) {
      if (casarSeletor(atual, seletor)) return atual;
      atual = atual.parentElement;
    }
    return null;
  };

  el.querySelectorAll = function (seletor) {
    const achados = [];
    (function varre(nos) {
      nos.forEach(function (f) {
        if (f.tag) {
          if (casarSeletor(f, seletor)) achados.push(f);
          varre(f.filhos || []);
        }
      });
    })(el.filhos || []);
    return achados;
  };

  el.getAttribute = function (nome) {
    return el.attrs[nome] !== undefined ? el.attrs[nome] : null;
  };

  el.filhos.forEach(function (f) { f.parentElement = el; });

  return el;
}

function percorrerTextos(root, mostraTexto, filtro) {
  const textos = [];
  (function varre(nos) {
    nos.forEach(function (f) {
      if (f.tag) varre(f.filhos || []);
      else {
        const decide = typeof filtro === "function" ? filtro : filtro.acceptNode;
        if (decide(f) === NodeFilter.FILTER_ACCEPT) textos.push(f);
      }
    });
  })([root]);
  let i = 0;
  return { nextNode: function () { return i < textos.length ? textos[i++] : null; } };
}

function documentoDa(body) {
  return { body: body, createTreeWalker: percorrerTextos };
}

// Tela de vendedor: dois cards, cada um com o proprio link e as duas
// metricas. Da mesma estrutura que as fixtures de "Minhas publicacoes".
const cardA = elementoDa("section", {}, [
  elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-omni/MLB3456789012" }, [
    textoDa("Omnibox caixa")
  ]),
  elementoDa("span", {}, [textoDa("359 visitas totais")]),
  elementoDa("span", {}, [textoDa("50 vendas")])
]);
const cardB = elementoDa("section", {}, [
  elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-9876543210-capa/MLB9876543210" }, [
    textoDa("Capa extrusora")
  ]),
  elementoDa("span", {}, [textoDa("1.234 visitas totais")])
]);
const corpoVendedor = elementoDa("body", {}, [cardA, cardB]);

const rVendedor = varrerPagina(
  documentoDa(corpoVendedor),
  "https://www.mercadolivre.com.br/herramientas/publicaciones"
);
testar("vendedor: pega os 2 anuncios", 2, Object.keys(rVendedor).length);
testar("vendedor: visitas do MLB3456789012", 359, rVendedor["MLB3456789012"].visitas);
testar("vendedor: vendas do MLB3456789012", 50, rVendedor["MLB3456789012"].vendas);
testar("vendedor: visitas do MLB9876543210", 1234, rVendedor["MLB9876543210"].visitas);

// Vitrine publica: SO "vendido"/"vendas", nenhuma mencao a "visita". E o
// cenario real de /up/ que gerou o bug: antes da trava, o "+1.000 vendidos"
// de outro produto virava metrica deste card. Agora nada deve passar.
const cardPublico = elementoDa("section", {}, [
  elementoDa("a", { href: "https://www.mercadolivre.com.br/kit-2-omni/up/MLBU5098517614" }, [
    textoDa("Kit 2 Omnibox")
  ]),
  elementoDa("span", {}, [textoDa("Novo | 1 vendido")])
]);
const corpoPublico = elementoDa("body", {}, [cardPublico]);

const rPublico = varrerPagina(
  documentoDa(corpoPublico),
  "https://www.mercadolivre.com.br/kit-2-omni/up/MLBU5098517614"
);
testar("publica: gate nao deixa nada passar", 0, Object.keys(rPublico).length);
testar("publica: paginaMencionaVisita false", false, paginaMencionaVisita(documentoDa(corpoPublico)));

// O painel da propria extensao escreve "Visitas totais" na tela. Sem a
// guarda, so a presenca do painel faria uma pagina publica virar "tela de
// vendedor" e liberar os "vendidos" dela.
const corpoPainelPublico = elementoDa("body", {}, [
  elementoDa("div", { id: "mlmetrics-painel" }, [textoDa("Visitas totais 9.999")]),
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/kit/up/MLBU5098517614" }, [
      textoDa("Kit")
    ]),
    elementoDa("span", {}, [textoDa("1 vendido")])
  ])
]);
const rPainel = varrerPagina(
  documentoDa(corpoPainelPublico),
  "https://www.mercadolivre.com.br/kit/up/MLBU5098517614"
);
testar("painel nao vira tela de vendedor", 0, Object.keys(rPainel).length);

// Pagina que SO MENCIONA "visita" num banner e so "le" vendas: a passada
// inicial deixa entrar (achou a palavra), mas nenhuma VISITA foi lida. E o
// modo de falha real que poluiu o cache da vendedora (137 anuncios, ZERO
// visitas): modulo publico "+1.000 vendidos" atribuido a produto alheio, com
// um "visita" qualquer de propaganda na pagina. Regra final: sem visita
// lida, nao ha captura.
const corpoBannerVendido = elementoDa("body", {}, [
  elementoDa("div", {}, [
    textoDa("Receba produtos mais visitados na sua caixa de entrada")
  ]),
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/kit-2-omni/up/MLBU5098517614" }, [
      textoDa("Kit 2 Omnibox")
    ]),
    elementoDa("span", {}, [textoDa("+1.000 vendidos")])
  ])
]);
const rBanner = varrerPagina(
  documentoDa(corpoBannerVendido),
  "https://www.mercadolivre.com.br/"
);
testar("banner com 'visita', so vendas: nada", 0, Object.keys(rBanner).length);

// Painel presente numa pagina de vendedor de verdade: o painel e ignorado,
// mas as metricas reais fora dele continuam valendo.
const corpoPainelVendedor = elementoDa("body", {}, [
  elementoDa("div", { id: "mlmetrics-painel" }, [textoDa("Visitas totais 9.999")]),
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-1111111111-x/MLB1111111111" }, [
      textoDa("Anuncio")
    ]),
    elementoDa("span", {}, [textoDa("359 visitas totais")]),
    elementoDa("span", {}, [textoDa("50 vendas")])
  ])
]);
const rPainelVendedor = varrerPagina(
  documentoDa(corpoPainelVendedor),
  "https://www.mercadolivre.com.br/herramientas/publicaciones"
);
testar("painel ignorado, visitas reais valem", 359, rPainelVendedor["MLB1111111111"].visitas);
testar("painel ignorado, vendas reais valem", 50, rPainelVendedor["MLB1111111111"].vendas);

console.log("");
if (limitacoes.length > 0) {
  console.log("=== Limitacoes conhecidas (nao derrubam o teste) ===");
  limitacoes.forEach(function (l) {
    const obtido = numeroAntesDe(l[0], l[1]);
    const emDia = obtido === l[2];
    console.log((emDia ? "  LIMITACAO ATIVA | " : "  RESOLVIDA? REVISE | ") + l[0] + " -> " + obtido);
    console.log("  Motivo: " + l[3]);
  });
  console.log("");
}
console.log("RESUMO: " + passou + "/" + (passou + falhou) + " ok");
if (falhas.length > 0) {
  console.log("FALHAS:");
  falhas.forEach(function (f) { console.log("  - " + f); });
  process.exitCode = 1;
}