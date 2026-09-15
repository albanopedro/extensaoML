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
//   - o que vem depois do numero (#41: %, data sem ano, hora, periodo)
//   - o escopo de coleta (ehPaginaDeCompra, inclui /up/, /p/ e /p/.../s)
//   - o calculo do painel (calcular, guarda contra NaN e Infinity)
//   - o texto oculto que nao pode virar metrica (#52: noscript, [hidden])
//   - o que o diagnostico leva de endereco (caminhoMascarado)
//   - numero preso a outro rotulo (#37) e visita exigida por anuncio (#48)
//   - o rastro de origem de cada numero e o filtro do painel (so com rastro)
//   - a fila de numeros e rotulos (valor antes ou depois, ambiguo, motivos)
//   - o diagnostico das recusas (por que um numero nao virou dado)
//   - o painel: codigos da pagina, preco estruturado, idade e formato
//
// Sem navegador de proposito: nada aqui toca em chrome.storage, e o DOM
// entra por um stub fiel das poucas APIs que o coletor usa (mais abaixo).
// MutationObserver, mensagens e o storage de verdade ficam de fora - esses
// se testam no navegador (ver "Verificacao manual" no contexto.md).
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
 * Acha o "}" que fecha o bloco aberto na posicao "abre", pulando o que nao e
 * codigo: comentarios, strings e regex literais. Contar chaves as cegas
 * quebrava a extracao com um "{" dentro de um comentario, de uma string ou
 * de uma regex.
 *
 * @returns {number} posicao do "}" que fecha, ou -1
 */
function fimDoBloco(fonte, abre) {
  let profundidade = 0;
  let anterior = "";  // ultimo caractere significativo (fora de espaco)

  for (let j = abre; j < fonte.length; j++) {
    const c = fonte[j];
    const seguinte = fonte[j + 1];

    // Comentario de linha.
    if (c === "/" && seguinte === "/") {
      j = fonte.indexOf("\n", j);
      if (j === -1) return -1;
      continue;
    }

    // Comentario de bloco.
    if (c === "/" && seguinte === "*") {
      j = fonte.indexOf("*/", j + 2);
      if (j === -1) return -1;
      j++;
      continue;
    }

    // String simples, dupla ou template (sem interpolacao com chaves).
    if (c === "\"" || c === "'" || c === "`") {
      j++;
      while (j < fonte.length && fonte[j] !== c) {
        if (fonte[j] === "\\") j++;
        j++;
      }
      anterior = c;
      continue;
    }

    // Regex literal: uma "/" onde comeca uma expressao - depois de "(", "=",
    // "||", "return"... Depois de nome ou de ")" ela e divisao.
    const podeSerRegex = (anterior !== "" && "(,=:[!&|?{};".indexOf(anterior) !== -1) ||
      /\breturn\s*$/.test(fonte.slice(Math.max(0, j - 10), j));

    if (c === "/" && podeSerRegex) {
      let classe = false;
      j++;
      while (j < fonte.length) {
        if (fonte[j] === "\\") {
          j += 2;
          continue;
        }
        if (fonte[j] === "[") classe = true;
        else if (fonte[j] === "]") classe = false;
        else if (fonte[j] === "/" && !classe) break;
        j++;
      }
      anterior = "/";
      continue;
    }

    if (c === "{") {
      profundidade++;
    } else if (c === "}") {
      profundidade--;
      if (profundidade === 0) return j;
    }

    if (!/\s/.test(c)) anterior = c;
  }

  return -1;
}

/**
 * Recorta uma funcao inteira ("function nome(...) { ... }") do texto-fonte.
 * Procura "function nome(" - com o parentese - para "calcular" nao casar
 * com uma "calcularOutraCoisa" que venha antes.
 */
function extrairFuncao(fonte, nome) {
  const achado = new RegExp("function " + nome + "\\s*\\(").exec(fonte);
  if (!achado) {
    throw new Error("funcao nao encontrada: " + nome);
  }

  const fim = fimDoBloco(fonte, fonte.indexOf("{", achado.index));
  if (fim === -1) throw new Error("funcao nao fechada: " + nome);

  return fonte.slice(achado.index, fim + 1);
}

/**
 * Recorta uma constante "const NOME = { ... };".
 */
function extrairConstObj(fonte, nome) {
  const inicio = fonte.indexOf("const " + nome + " = {");
  if (inicio === -1) {
    throw new Error("constante nao encontrada: " + nome);
  }

  const fim = fimDoBloco(fonte, fonte.indexOf("{", inicio));
  if (fim === -1) throw new Error("constante nao fechada: " + nome);

  return fonte.slice(inicio, fim + 1);
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
  "lerRotulo",
  "pecasDoTexto",
  "pecasColadas",
  "motivoDoNumero",
  "temLetra",
  "ehData",
  "seguidoDeUnidade",
  "ehPaginaDeCompra",
  "aceitarNoDeTextoTecnico",
  "paginaMencionaVisita",
  "codigosDentroDe",
  "contextoDoAnuncio",
  "valorDoRotulo",
  "trechoDaLeitura",
  "descartarImplausiveis",
  "varrerPagina",
  "caminhoMascarado",
  "mudou",
  "faltaOrigem",
  "mesclarOrigem",
  "contextoDoTexto",
  "resumirRecusas"
].map(function (nome) { return extrairFuncao(fonte, nome); }).join("\n");

// O calculo e a escolha do registro do painel moram no content.js - tambem
// funcoes puras.
const blocoFuncaoContent = [
  extrairConstRegex(fonteContent, "PADRAO_CODIGO"),
  extrairFuncao(fonteContent, "calcular"),
  extrairFuncao(fonteContent, "somenteComOrigem"),
  extrairFuncao(fonteContent, "escolherRegistro"),
  extrairFuncao(fonteContent, "codigosDaPagina"),
  extrairFuncao(fonteContent, "precoDoJsonLd"),
  extrairFuncao(fonteContent, "diasDesde"),
  extrairFuncao(fonteContent, "formatarPercentual")
].join("\n");

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
  "  lerRotulo: lerRotulo," +
  "  pecasDoTexto: pecasDoTexto," +
  "  motivoDoNumero: motivoDoNumero," +
  "  resumirRecusas: resumirRecusas," +
  "  temLetra: temLetra," +
  "  ehData: ehData," +
  "  seguidoDeUnidade: seguidoDeUnidade," +
  "  caminhoMascarado: caminhoMascarado," +
  "  mudou: mudou," +
  "  faltaOrigem: faltaOrigem," +
  "  mesclarOrigem: mesclarOrigem," +
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

// O content.js tambem e IIFE; mesmo truque para as funcoes dele.
let exportadosContent;
eval(blocoFuncaoContent + "\n" +
  "exportadosContent = {" +
  "  calcular: calcular," +
  "  somenteComOrigem: somenteComOrigem," +
  "  escolherRegistro: escolherRegistro," +
  "  codigosDaPagina: codigosDaPagina," +
  "  precoDoJsonLd: precoDoJsonLd," +
  "  diasDesde: diasDesde," +
  "  formatarPercentual: formatarPercentual" +
  "};");

const {
  numeroAntesDe,
  temLetra,
  ehData,
  seguidoDeUnidade,
  caminhoMascarado,
  mudou,
  faltaOrigem,
  mesclarOrigem,
  lerRotulo,
  resumirRecusas,
  ehPaginaDeCompra,
  paginaMencionaVisita,
  varrerPagina,
  ROTULOS,
  PADRAO_CODIGO
} = exportados;
const {
  calcular,
  somenteComOrigem,
  escolherRegistro,
  codigosDaPagina,
  precoDoJsonLd,
  diasDesde,
  formatarPercentual
} = exportadosContent;

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
// A reputacao do vendedor e faixa arredondada ("+1.000"): nunca e contagem.
testar("anuncio: '+1.000 vendas' (reputacao) nao vira metrica", null, numeroAntesDe("+1.000 vendas", "venda"));

console.log("");
console.log("=== #41 - o que vem DEPOIS do numero ===");
// Numero seguido de percentual, data sem ano, hora, periodo ou milhar
// abreviado nao e o valor do rotulo.
testar("'Ultima visita 14/09' (data sem ano)", null, numeroAntesDe("Ultima visita 14/09", "visita"));
testar("'Ultima venda 14:32' (hora)", null, numeroAntesDe("Ultima venda 14:32", "venda"));
testar("'Visitas +12%' (variacao)", null, numeroAntesDe("Visitas +12%", "visita"));
testar("'Tarifa de venda 16%' (taxa)", null, numeroAntesDe("Tarifa de venda 16%", "venda"));
testar("'Vendas (30 dias) 12' (periodo)", null, numeroAntesDe("Vendas (30 dias) 12", "venda"));
testar("'Visitas 12 mil' (milhar abreviado)", null, numeroAntesDe("Visitas 12 mil", "visita"));
testar("'+12% visitas' (percentual antes do rotulo)", null, numeroAntesDe("+12% visitas", "visita"));
// O que NAO pode quebrar: palavra comum depois do numero continua valendo.
testar("'Visitas: 359' continua valendo", 359, numeroAntesDe("Visitas: 359", "visita"));
testar("'Visitas 359 hoje' - 'h' nao casa com 'hoje'", 359, numeroAntesDe("Visitas 359 hoje", "visita"));
testar("'Vendas 12 de 40' - 'd' nao casa com 'de'", 12, numeroAntesDe("Vendas 12 de 40", "venda"));
testar("'Visitas 359 minhas' - 'min' nao casa com 'minhas'", 359, numeroAntesDe("Visitas 359 minhas", "visita"));
testar("seguidoDeUnidade(' dias')", true, seguidoDeUnidade(" dias"));
testar("seguidoDeUnidade(' meses')", true, seguidoDeUnidade(" meses"));

console.log("");
console.log("=== #37 - de qual rotulo e o numero (fila de pecas) ===");
// Valor DEPOIS do rotulo ("Rotulo: valor").
testar("'Visitas: 359 | Vendas: 12' -> vendas 12", 12, numeroAntesDe("Visitas: 359 | Vendas: 12", "venda"));
testar("'Visitas: 359 | Vendas: 12' -> visitas 359", 359, numeroAntesDe("Visitas: 359 | Vendas: 12", "visita"));
testar("'Vendas: 12 Visitas: 359' -> visitas 359", 359, numeroAntesDe("Vendas: 12 Visitas: 359", "visita"));
testar("'Visitas totais: 359 | Vendas: 12' -> vendas 12", 12, numeroAntesDe("Visitas totais: 359 | Vendas: 12", "venda"));
testar("'Visitas totais: 359 | Vendas: 12' -> visitas 359 (qualificador)", 359, numeroAntesDe("Visitas totais: 359 | Vendas: 12", "visita"));
testar("'Estoque: 12 | Vendas: 3' -> vendas 3", 3, numeroAntesDe("Estoque: 12 | Vendas: 3", "venda"));
testar("'Estoque: 12 | Vendas' (sem numero de vendas) -> nada", null, numeroAntesDe("Estoque: 12 | Vendas", "venda"));
// Valor ANTES do rotulo, em texto corrido. A 0.1.3 perdia as vendas no
// primeiro caso e gravava 5 vendas no segundo.
testar("'359 visitas 12 vendas' -> vendas 12", 12, numeroAntesDe("359 visitas 12 vendas", "venda"));
testar("'359 visitas 12 vendas' -> visitas 359", 359, numeroAntesDe("359 visitas 12 vendas", "visita"));
testar("'359 visitas 12 vendas 5 disponiveis' -> vendas 12 (nao 5)", 12, numeroAntesDe("359 visitas 12 vendas 5 disponiveis", "venda"));
testar("'15 visitas hoje 4.200 visitas totais' -> 4200", 4200, numeroAntesDe("15 visitas hoje 4.200 visitas totais", "visita"));
// Ambiguo nao vira leitura: um titulo terminado em numero antes das metricas.
testar("'Tamanho 42 Visitas 359 Vendas 12' -> visitas nada (ambiguo)", null, numeroAntesDe("Tamanho 42 Visitas 359 Vendas 12", "visita"));
testar("'Tamanho 42 Visitas 359 Vendas 12' -> vendas nada (ambiguo)", null, numeroAntesDe("Tamanho 42 Visitas 359 Vendas 12", "venda"));
// Palavra comum antes do numero nao e dona dele; "revenda" nao e "venda".
testar("'Kit 2 caixas 359 visitas' -> 359", 359, numeroAntesDe("Kit 2 caixas 359 visitas", "visita"));
testar("'12 vendas · revenda' -> 12", 12, numeroAntesDe("12 vendas · revenda", "venda"));
// Numero que nao e contagem, e o motivo que o diagnostico mostra.
testar("'R$ 49 vendas' (preco inteiro) -> nada", null, numeroAntesDe("R$ 49 vendas", "venda"));
testar("'+1.000 vendidos' (faixa arredondada) -> nada", null, numeroAntesDe("+1.000 vendidos", "vendido"));
testar("recusa explica: ambiguo", true, /ambiguo/.test(lerRotulo("Estoque: 12 | Vendas", "venda").recusa));
testar("recusa explica: preco", "preco", lerRotulo("R$ 49 vendas", "venda").recusa);
testar("rotulo sem numero nenhum -> null, sem recusa", null, lerRotulo("Vendas", "venda"));

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
console.log("=== lerRotulo - o que conta como colado ===");
testar("quebra de linha entre numero e rotulo cola", 1234, numeroAntesDe("1.234\n   visitas", "visita"));
testar("legenda entre numero e rotulo nao cola", null, numeroAntesDe("R$ 15.995,00 Os rotulos 'visitas'", "visita"));
testar("numero apos ':' cola", 359, numeroAntesDe("Visitas: 359", "visita"));
testar("espacos antes do numero nao atrapalham", 1, numeroAntesDe("  1 vendido", "vendido"));
testar("palavra entre rotulo e numero nao cola", null, numeroAntesDe("Visitas abc 359", "visita"));

console.log("");
console.log("=== PADRAO_CODIGO (formatos MLB) ===");
function codigoDe(texto) {
  const m = (texto || "").match(PADRAO_CODIGO);
  return m ? m[1] + m[2] : null;
}
testar("anuncio com hifen", "MLB3456789012", codigoDe("MLB-3456789012"));
testar("estrutura nova MLBU", "MLBU0000000001", codigoDe("MLBU0000000001"));
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
// A mesma forma da pagina real que gerou o bug (www + rota nova /up/MLBU...),
// com slug e codigo ficticios: o endereco real nao entra no repositorio.
testar("www + /up/MLBU... e vitrine", true, ehPaginaDeCompra("https://www.mercadolivre.com.br/kit-2-caixa-organizadora-modular/up/MLBU0000000001"));
// Vitrine classica (host proprio) e catalogo (rota /p/MLB...).
testar("produto.mercadolivre e vitrine", true, ehPaginaDeCompra("https://produto.mercadolivre.com.br/MLB-3456789012-capa-extrusora-p/MLB3456789012"));
testar("articulo.mercadolivre e vitrine", true, ehPaginaDeCompra("https://articulo.mercadolivre.com.br/MLB-1234567890-x/MLB1234567890"));
testar("www + rota /p/MLB... e vitrine", true, ehPaginaDeCompra("https://www.mercadolivre.com.br/kit-2-caixa-organizadora/p/MLB1045308375"));
// Telas de VENDEDOR nao podem ser confundidas (nenhuma termina em /up/ ou /p/).
testar("minhas publicacoes nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/herramientas/publicaciones"));
testar("ranking de vendas nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/gz/ranking"));
testar("query com codigo nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/busca?item_id=MLB1234567890"));
// #55: a lista de vendedores do catalogo ("/p/MLB.../s") tambem e vitrine,
// cheia de "+N vendas" de reputacao de vendedores alheios.
testar("www + /p/MLB.../s e vitrine", true, ehPaginaDeCompra("https://www.mercadolivre.com.br/kit-2-caixa-organizadora/p/MLB1045308375/s"));
testar("www + /up/MLBU.../ com barra final e vitrine", true, ehPaginaDeCompra("https://www.mercadolivre.com.br/kit/up/MLBU0000000001/"));
testar("codigo no caminho sem /p/ ou /up/ nao e vitrine", false, ehPaginaDeCompra("https://www.mercadolivre.com.br/anuncios/MLB1234567890/modificar"));

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
// #39: sem nenhuma visita nao ha taxa - nunca "NaN%" nem "Infinity%".
testar("0 visitas e 0 vendas: conversao null (nao NaN)", null, calcular({ visitas: 0, vendas: 0 }, 10).conversao);
testar("0 visitas e 3 vendas: conversao null (nao Infinity)", null, calcular({ visitas: 0, vendas: 3 }, 10).conversao);
// Nenhum dado: tudo null.
const vazio = calcular({}, null);
testar("sem dados: tudo null", null, vazio.visitas);
testar("sem dados: vende-a-cada null", null, vazio.visitasPorVenda);

console.log("");
console.log("=== codigosDaPagina (#38/#54 - o painel acha o anuncio) ===");
testar("vitrine classica: o item do caminho", "MLB3456789012",
  codigosDaPagina("https://produto.mercadolivre.com.br/MLB-3456789012-caixa-_JM").join("|"));
testar("catalogo: item do pdp_filters antes do catalogo", "MLB3456789012|MLB19655437",
  codigosDaPagina("https://www.mercadolivre.com.br/caixa/p/MLB19655437?pdp_filters=item_id:MLB3456789012").join("|"));
testar("estrutura nova: wid depois do # antes do MLBU", "MLB3456789012|MLBU0000000001",
  codigosDaPagina("https://www.mercadolivre.com.br/caixa/up/MLBU0000000001#wid=MLB3456789012&sid=unico").join("|"));
testar("tela de vendedor com ?search=MLB: nenhum codigo", "",
  codigosDaPagina("https://www.mercadolivre.com.br/anuncios/lista?search=MLB3456789012").join("|"));
testar("endereco invalido nao quebra", "", codigosDaPagina("nao e url").join("|"));

const cacheCandidatos = {
  MLB19655437: { vendas: 1000 },
  MLB3456789012: { visitas: 359, origem: { visitas: { trecho: "x" } } }
};
testar("escolherRegistro pula registro sem rastro", "MLB3456789012",
  escolherRegistro(["MLB19655437", "MLB3456789012"], cacheCandidatos).codigo);
testar("escolherRegistro sem nada provado -> null", null,
  escolherRegistro(["MLB19655437"], cacheCandidatos));

console.log("");
console.log("=== Painel: preco estruturado, idade e formato ===");
testar("JSON-LD: preco da oferta", 19.9, precoDoJsonLd('{"@type":"Product","offers":{"price":19.9}}'));
testar("JSON-LD: lista com @graph e preco em texto", 49.9,
  precoDoJsonLd('[{"@graph":[{"@type":"Product","offers":[{"price":"49.90"}]}]}]'));
testar("JSON-LD: sem oferta -> null", null, precoDoJsonLd('{"@type":"BreadcrumbList"}'));
testar("JSON-LD: malformado -> null", null, precoDoJsonLd("nao e json"));
testar("idade: ontem a noite nao e 'hoje'", 1,
  diasDesde(new Date(2026, 8, 13, 23, 30).getTime(), new Date(2026, 8, 14, 0, 30).getTime()));
testar("idade: mesmo dia e 0", 0,
  diasDesde(new Date(2026, 8, 14, 0, 10).getTime(), new Date(2026, 8, 14, 23, 50).getTime()));
testar("percentual com virgula, como no ML", "13,9%", formatarPercentual(13.93));

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
 * que o coletor usa: "tag1, tag2, tag3", "#id", "[attr]" e
 * 'tag[attr*="trecho"]'.
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
    // "[attr]" ou "tag[attr]": so a PRESENCA do atributo (ex.: [hidden]).
    const presenca = /^([a-z]*)\[([a-z-]+)\]$/.exec(item);
    if (presenca) {
      if (presenca[1] && el.tag !== presenca[1]) return false;
      return Boolean(el.attrs) && el.attrs[presenca[2]] !== undefined;
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
  elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-caixa/MLB3456789012" }, [
    textoDa("Caixa organizadora")
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
  elementoDa("a", { href: "https://www.mercadolivre.com.br/kit-2-caixa/up/MLBU0000000001" }, [
    textoDa("Kit 2 Caixa")
  ]),
  elementoDa("span", {}, [textoDa("Novo | 1 vendido")])
]);
const corpoPublico = elementoDa("body", {}, [cardPublico]);

const rPublico = varrerPagina(
  documentoDa(corpoPublico),
  "https://www.mercadolivre.com.br/kit-2-caixa/up/MLBU0000000001"
);
testar("publica: gate nao deixa nada passar", 0, Object.keys(rPublico).length);
testar("publica: paginaMencionaVisita false", false, paginaMencionaVisita(documentoDa(corpoPublico)));

// O painel da propria extensao escreve "Visitas totais" na tela. Sem a
// guarda, so a presenca do painel faria uma pagina publica virar "tela de
// vendedor" e liberar os "vendidos" dela.
const corpoPainelPublico = elementoDa("body", {}, [
  elementoDa("div", { id: "mlmetrics-painel" }, [textoDa("Visitas totais 9.999")]),
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/kit/up/MLBU0000000001" }, [
      textoDa("Kit")
    ]),
    elementoDa("span", {}, [textoDa("1 vendido")])
  ])
]);
const rPainel = varrerPagina(
  documentoDa(corpoPainelPublico),
  "https://www.mercadolivre.com.br/kit/up/MLBU0000000001"
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
    elementoDa("a", { href: "https://www.mercadolivre.com.br/kit-2-caixa/up/MLBU0000000001" }, [
      textoDa("Kit 2 Caixa")
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

// #52: texto de <noscript> e de elemento [hidden] nao aparece na tela - nao
// pode virar metrica, nem vencer o valor visivel pela regra do maior valor,
// nem credenciar pagina publica como tela de vendedor.
const corpoOculto = elementoDa("body", {}, [
  elementoDa("noscript", {}, [textoDa("9.999 visitas")]),
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-caixa/MLB3456789012" }, [
      textoDa("Caixa organizadora")
    ]),
    elementoDa("div", { hidden: "" }, [textoDa("777 visitas totais")]),
    elementoDa("span", {}, [textoDa("359 visitas totais")])
  ])
]);
const rOculto = varrerPagina(
  documentoDa(corpoOculto),
  "https://www.mercadolivre.com.br/herramientas/publicaciones"
);
testar("oculto: noscript e [hidden] nao vencem o valor visivel", 359, rOculto["MLB3456789012"].visitas);

const corpoNoscriptPublico = elementoDa("body", {}, [
  elementoDa("noscript", {}, [textoDa("Ative o JavaScript para ver as visitas")]),
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/kit/up/MLBU0000000001" }, [
      textoDa("Kit")
    ]),
    elementoDa("span", {}, [textoDa("1 vendido")])
  ])
]);
testar("oculto: noscript nao credencia pagina publica", false, paginaMencionaVisita(documentoDa(corpoNoscriptPublico)));

console.log("");
console.log("=== caminhoMascarado (#44/#50 - diagnostico sem dado pessoal) ===");
testar("rota de sistema fica igual", "/anuncios/lista", caminhoMascarado("/anuncios/lista"));
testar("digitos viram #", "/vendas/#/detalhe", caminhoMascarado("/vendas/12345678/detalhe"));
testar("titulo de produto some, tipo de codigo fica", "/(titulo)/up/MLBU#", caminhoMascarado("/kit-2-caixa-organizadora-modular/up/MLBU0000000001"));
testar("rota de ate 3 palavras fica", "/publicaciones-y-ventas", caminhoMascarado("/publicaciones-y-ventas"));

console.log("");
console.log("=== #48 - visita exigida POR ANUNCIO ===");
// Tela de vendedor com um modulo de terceiro que so mostra vendidos: o card
// dela (com visitas) passa, o produto alheio (so vendas) nao entra.
const corpoMisto = elementoDa("body", {}, [
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-caixa/MLB3456789012" }, [
      textoDa("Caixa organizadora")
    ]),
    elementoDa("span", {}, [textoDa("359 visitas")]),
    elementoDa("span", {}, [textoDa("50 vendas")])
  ]),
  elementoDa("aside", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-5555555555-outro/MLB5555555555" }, [
      textoDa("Produto de outra loja")
    ]),
    elementoDa("span", {}, [textoDa("+1.000 vendidos")])
  ])
]);
const rMisto = varrerPagina(
  documentoDa(corpoMisto),
  "https://www.mercadolivre.com.br/anuncios/lista"
);
testar("#48: card com visitas continua", 359, rMisto["MLB3456789012"].visitas);
testar("#48: produto alheio so com vendas nao entra", undefined, rMisto["MLB5555555555"]);

console.log("");
console.log("=== Rastro de origem - todo numero leva o texto de onde saiu ===");
const rRastro = rMisto["MLB3456789012"];
testar("rastro: trecho exato das visitas", "«359 visitas»", rRastro.origem.visitas.trecho);
testar("rastro: trecho exato das vendas", "«50 vendas»", rRastro.origem.vendas.trecho);
testar("rastro: tela mascarada", "/anuncios/lista", rRastro.origem.visitas.tela);

// #37 num DOM: "<b>Visitas</b> 359 <b>Vendas</b> 12" - antes da correcao dava
// vendas 359. O rastro das vendas mostra o dono de cada numero.
const cardRotuloValor = elementoDa("section", {}, [
  elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-caixa/MLB3456789012" }, [
    textoDa("Caixa organizadora")
  ]),
  elementoDa("p", {}, [
    elementoDa("b", {}, [textoDa("Visitas")]),
    textoDa(" 359 "),
    elementoDa("b", {}, [textoDa("Vendas")]),
    textoDa(" 12")
  ])
]);
const rRotuloValor = varrerPagina(
  documentoDa(elementoDa("body", {}, [cardRotuloValor])),
  "https://www.mercadolivre.com.br/anuncios/lista"
);
testar("#37 no DOM: visitas 359", 359, rRotuloValor["MLB3456789012"].visitas);
testar("#37 no DOM: vendas 12 (nao 359)", 12, rRotuloValor["MLB3456789012"].vendas);
testar("#37 no DOM: rastro das vendas", "Visitas 359 «Vendas 12»", rRotuloValor["MLB3456789012"].origem.vendas.trecho);

// Gravacao: o rastro nao pode disparar "mudou" nem apagar a origem da outra
// metrica; registro antigo sem rastro precisa ser renovado.
testar("mudou ignora o rastro (mesmo numero)", false,
  mudou({ visitas: 359, origem: { visitas: { em: 1 } } }, { visitas: 359, origem: { visitas: { em: 2 } } }));
testar("mudou ve numero diferente", true, mudou({ visitas: 359 }, { visitas: 360 }));
const mesclada = mesclarOrigem({ vendas: { trecho: "a" } }, { visitas: { trecho: "b" } }, 123, false);
testar("mesclarOrigem guarda a origem da outra metrica", "a", mesclada.vendas.trecho);
testar("mesclarOrigem carimba a hora", 123, mesclada.visitas.em);
testar("faltaOrigem: registro antigo sem rastro", true, faltaOrigem({ visitas: 359 }, { visitas: 359 }));

// Painel: so entra numero com rastro.
const soVisitasProvadas = somenteComOrigem({ visitas: 359, vendas: 1000, origem: { visitas: { trecho: "x" } } });
testar("painel: numero com rastro entra", 359, soVisitasProvadas.visitas);
testar("painel: numero sem rastro nao entra", undefined, soVisitasProvadas.vendas);
testar("painel: registro de versao antiga nao mostra nada", undefined, somenteComOrigem({ visitas: 359, vendas: 12 }).visitas);
testar("painel: sem registro nao quebra", undefined, somenteComOrigem(undefined).visitas);

console.log("");
console.log("=== Numero antes do rotulo, em elementos irmaos ===");
// <span>359</span><span>visitas</span><span>12</span><span>vendas</span> no
// mesmo bloco: o textContent vira "359visitas12vendas". A 0.1.3 perdia as
// vendas aqui ("numero entre dois rotulos"); a fila de pecas resolve.
const cardIrmaos = elementoDa("section", {}, [
  elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-caixa/MLB3456789012" }, [
    textoDa("Caixa organizadora")
  ]),
  elementoDa("div", {}, [
    elementoDa("span", {}, [textoDa("359")]),
    elementoDa("span", {}, [textoDa("visitas")]),
    elementoDa("span", {}, [textoDa("12")]),
    elementoDa("span", {}, [textoDa("vendas")])
  ])
]);
const rIrmaos = varrerPagina(
  documentoDa(elementoDa("body", {}, [cardIrmaos])),
  "https://www.mercadolivre.com.br/anuncios/lista"
);
testar("irmaos: visitas 359", 359, rIrmaos["MLB3456789012"].visitas);
testar("irmaos: vendas 12", 12, rIrmaos["MLB3456789012"].vendas);

console.log("");
console.log("=== Diagnostico: por que um numero nao virou dado ===");
const recusas = [];
const corpoRecusas = elementoDa("body", {}, [
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-3456789012-caixa/MLB3456789012" }, [
      textoDa("Caixa organizadora")
    ]),
    elementoDa("span", {}, [textoDa("359 visitas")]),
    elementoDa("span", {}, [textoDa("Estoque: 5 | Vendas")])
  ]),
  // Bloco com dois anuncios: nao da para saber de qual e o rotulo.
  elementoDa("section", {}, [
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-1111111111-a/MLB1111111111" }, [
      textoDa("Anuncio A")
    ]),
    elementoDa("a", { href: "https://www.mercadolivre.com.br/itm/MLB-2222222222-b/MLB2222222222" }, [
      textoDa("Anuncio B")
    ]),
    elementoDa("span", {}, [textoDa("Vendas: 7")])
  ])
]);
const rRecusas = varrerPagina(
  documentoDa(corpoRecusas),
  "https://www.mercadolivre.com.br/anuncios/lista",
  recusas
);
const motivos = recusas.map(function (r) { return r.motivo; }).join(" | ");
testar("recusas: a leitura valida continua", 359, rRecusas["MLB3456789012"].visitas);
testar("recusas: vendas ambiguas aparecem com motivo", true, /ambiguo/.test(motivos));
testar("recusas: bloco com varios anuncios aparece com motivo", true, /bloco com 2 anuncios/.test(motivos));
testar("recusas: resumo agrupa por motivo", true, Object.keys(resumirRecusas(recusas)).length >= 2);
testar("recusas: sem lista, a varredura nao reclama", 359,
  varrerPagina(documentoDa(corpoRecusas), "https://www.mercadolivre.com.br/anuncios/lista")["MLB3456789012"].visitas);

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