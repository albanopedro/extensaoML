// ============================================================================
// TESTE DE PARSING - roda as funcoes PURAS da extensao fora do navegador
//
// Por que existe? A leitura da tela e as contas do painel sao o coracao da
// extensao, e mais de uma regra delas ja quebrou de um jeito que so um caso
// de teste mostraria. Este arquivo carrega os modulos puros de src/
// (leitura.js, diagnostico.js, calculo.js, gravacao.js) do jeito que eles sao
// e cobra:
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
//   - a ordem dos arquivos no manifest (cada um depois de quem ele usa)
//
// Sem navegador de proposito: nada aqui toca em chrome.storage, e o DOM
// entra por um stub fiel das poucas APIs que a leitura usa (mais abaixo).
// MutationObserver, mensagens e o storage de verdade ficam de fora - esses
// se testam no navegador (teste/rodar-no-navegador.html) e na verificacao
// manual (contexto.md).
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

const CAMINHO_BACKGROUND = path.join(__dirname, "..", "src", "background.js");

// ----------------------------------------------------------------------------
// Carga dos modulos
// ----------------------------------------------------------------------------

/**
 * Carrega um arquivo de src/ do jeito que o navegador carrega: o arquivo
 * define uma variavel global (MLMetricsLeitura, por exemplo) e os que vem
 * depois dele no manifest usam essa variavel.
 *
 * new Function roda o arquivo num escopo proprio e devolve a variavel. As
 * dependencias - modulos que o manifest carrega antes - entram como
 * parametros com o mesmo nome da global.
 *
 * Antes da divisao do coletor.js e do content.js, as funcoes ficavam presas
 * em IIFEs que nao exportavam nada, e este teste recortava cada uma do texto
 * do arquivo com um scanner de chaves que pulava comentario, string e regex.
 * Funcionava, mas testava o recorte junto com a funcao: mudar o formato de
 * uma declaracao quebrava o teste sem quebrar a extensao.
 *
 * @param {string} arquivo nome do arquivo em src/
 * @param {string} global nome da variavel que o arquivo define
 * @param {Object} [dependencias] { NomeDaGlobal: valor }
 * @returns {Object}
 */
function carregarModulo(arquivo, global, dependencias) {
  const codigo = fs.readFileSync(path.join(__dirname, "..", "src", arquivo), "utf8");
  const nomes = Object.keys(dependencias || {});
  const valores = nomes.map(function (nome) { return dependencias[nome]; });

  return new Function(nomes.join(","), codigo + "\nreturn " + global + ";")
    .apply(null, valores);
}

const MLMetricsLeitura = carregarModulo("leitura.js", "MLMetricsLeitura");
const MLMetricsDiagnostico = carregarModulo("diagnostico.js", "MLMetricsDiagnostico", {
  MLMetricsLeitura: MLMetricsLeitura
});
const MLMetricsCalculo = carregarModulo("calculo.js", "MLMetricsCalculo");
const MLMetricsGravacao = carregarModulo("gravacao.js", "MLMetricsGravacao");

const {
  numeroAntesDe,
  temLetra,
  ehData,
  seguidoDeUnidade,
  caminhoMascarado,
  LIMITE_TEXTO_POR_NIVEL,
  valorDoRotulo,
  lerRotulo,
  ehPaginaDeCompra,
  paginaMencionaVisita,
  varrerPagina,
  ROTULOS,
  PADRAO_CODIGO
} = MLMetricsLeitura;
const {
  resumirRecusas,
  ehTextoDePeriodo,
  coletarTextosDePeriodo
} = MLMetricsDiagnostico;
const { mudou, faltaOrigem, mesclarOrigem } = MLMetricsGravacao;
const {
  calcular,
  somenteComOrigem,
  escolherRegistro,
  codigosDaPagina,
  precoDoJsonLd,
  diasDesde,
  formatarPercentual
} = MLMetricsCalculo;


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
console.log("=== #47 - textos de periodo no diagnostico ===");
[
  "Últimos 30 dias",
  "Visitas nos ultimos 30 dias",
  "últimas 24 horas",
  "Último mês",
  "Últimos 12 meses",
  "30 dias",
  "7d",
  "Hoje",
  "Vendas desde ontem",
  "Este mês",
  "Mês passado",
  "Período",
  "Desde o início",
  "01/08/2026 - 30/08/2026",
  "16 ago. - 14 set.",
  "1 de agosto a 30 de agosto"
].forEach(function (texto) {
  testar("periodo: reconhece '" + texto + "'", true, ehTextoDePeriodo(texto));
});

// Prazo, entrega, data solta e rotulo de metrica nao sao filtro de periodo.
[
  "Chega em 2 dias",
  "Anuncio pausado ha 12 dias.",
  "Chega hoje",
  "359 visitas totais",
  "Estoque: 12 unidades",
  "Venda em 14/09/2026",
  "Todos",
  "Mesa Aquecida"
].forEach(function (texto) {
  testar("periodo: ignora '" + texto + "'", false, ehTextoDePeriodo(texto));
});

// Filtro em quatro formatos (botao, abas com aria, lista, campo de datas) e o
// que NAO pode entrar: painel da extensao, noscript, campo escondido, prazo de
// entrega, frase longa e o mesmo filtro repetido.
const opcao7 = elementoDa("option", {}, [textoDa("Últimos 7 dias")]);
const opcao60 = elementoDa("option", {}, [textoDa("Últimos 60 dias")]);
opcao60.selected = true;
const campoDatas = elementoDa("input", { type: "text" }, []);
campoDatas.value = "01/08/2026 - 30/08/2026";
const campoEscondido = elementoDa("input", { type: "hidden" }, []);
campoEscondido.value = "02/08/2026 - 31/08/2026";

const corpoPeriodo = elementoDa("body", {}, [
  elementoDa("div", { id: "mlmetrics-painel" }, [textoDa("Últimos 45 dias")]),
  elementoDa("button", {}, [elementoDa("span", {}, [textoDa("Últimos 30 dias")])]),
  elementoDa("div", {}, [
    elementoDa("span", { "aria-selected": "false" }, [textoDa("7 dias")]),
    elementoDa("span", { "aria-selected": "true" }, [textoDa("90 dias")])
  ]),
  elementoDa("select", {}, [opcao7, opcao60]),
  campoDatas,
  campoEscondido,
  elementoDa("noscript", {}, [textoDa("Últimos 15 dias")]),
  elementoDa("section", {}, [
    elementoDa("span", {}, [textoDa("Últimos 30 dias")]),
    elementoDa("span", {}, [textoDa("Chega em 2 dias")]),
    elementoDa("p", {}, [textoDa("Os números desta tela consideram as vendas e as visitas dos últimos 30 dias, sem devoluções.")])
  ])
]);
const periodo = coletarTextosDePeriodo(documentoDa(corpoPeriodo));

testar("periodo: so o filtro, na ordem da tela, com a opcao marcada", JSON.stringify([
  { onde: "texto", texto: "Últimos 30 dias" },
  { onde: "texto", texto: "7 dias", marcado: false },
  { onde: "texto", texto: "90 dias", marcado: true },
  { onde: "opcao de lista", texto: "Últimos 7 dias", marcado: false },
  { onde: "opcao de lista", texto: "Últimos 60 dias", marcado: true },
  { onde: "campo", texto: "01/08/2026 - 30/08/2026" }
]), JSON.stringify(periodo));
testar("periodo: filtro repetido entra uma vez", 1,
  periodo.filter(function (p) { return p.texto === "Últimos 30 dias"; }).length);
testar("periodo: painel da extensao fica de fora", false,
  periodo.some(function (p) { return p.texto === "Últimos 45 dias"; }));
testar("periodo: campo escondido fica de fora", false,
  periodo.some(function (p) { return /02\/08/.test(p.texto); }));
testar("periodo: frase longa fica de fora", false,
  periodo.some(function (p) { return p.texto.length > 80; }));

const muitosPeriodos = [];
for (let n = 1; n <= 25; n++) {
  muitosPeriodos.push(elementoDa("span", {}, [textoDa("Últimos " + n + " dias")]));
}
testar("periodo: no maximo 20 textos", 20,
  coletarTextosDePeriodo(documentoDa(elementoDa("body", {}, muitosPeriodos))).length);

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
console.log("=== #38 - card com link do item e do catalogo ===");
const LISTA = "https://www.mercadolivre.com.br/anuncios/lista";

const cardItemCatalogo = elementoDa("section", {}, [
  elementoDa("a", { href: "https://produto.mercadolivre.com.br/MLB-3456789012-caixa-_JM" }, [
    textoDa("Caixa organizadora")
  ]),
  elementoDa("a", { href: "https://www.mercadolivre.com.br/caixa/p/MLB12345678" }, [
    textoDa("Ver no catalogo")
  ]),
  elementoDa("span", {}, [textoDa("42 visitas")]),
  elementoDa("span", {}, [textoDa("3 vendas")])
]);
const rItemCatalogo = varrerPagina(documentoDa(elementoDa("body", {}, [cardItemCatalogo])), LISTA);
testar("#38: item + catalogo grava no item (visitas)", 42,
  rItemCatalogo["MLB3456789012"] ? rItemCatalogo["MLB3456789012"].visitas : "sem registro");
testar("#38: item + catalogo grava no item (vendas)", 3,
  rItemCatalogo["MLB3456789012"] ? rItemCatalogo["MLB3456789012"].vendas : "sem registro");
testar("#38: nada gravado no codigo do catalogo", undefined, rItemCatalogo["MLB12345678"]);

const cardDoisItens = elementoDa("section", {}, [
  elementoDa("a", { href: "https://produto.mercadolivre.com.br/MLB-1111111111-a" }, [textoDa("A")]),
  elementoDa("a", { href: "https://produto.mercadolivre.com.br/MLB-2222222222-b" }, [textoDa("B")]),
  elementoDa("span", {}, [textoDa("42 visitas")])
]);
testar("#38: dois itens diferentes no bloco continuam ambiguos", 0,
  Object.keys(varrerPagina(documentoDa(elementoDa("body", {}, [cardDoisItens])), LISTA)).length);

const cardSoUp = elementoDa("section", {}, [
  elementoDa("a", { href: "https://www.mercadolivre.com.br/caixa/up/MLBU0000000001" }, [textoDa("Caixa")]),
  elementoDa("span", {}, [textoDa("42 visitas")])
]);
const rSoUp = varrerPagina(documentoDa(elementoDa("body", {}, [cardSoUp])), LISTA);
testar("#38: so user product: grava no MLBU", 42,
  rSoUp["MLBU0000000001"] ? rSoUp["MLBU0000000001"].visitas : "sem registro");

console.log("");
console.log("=== Limite de tamanho por nivel do DOM ===");
const blocoPequeno = elementoDa("div", {}, [
  elementoDa("span", {}, [textoDa("359")]),
  elementoDa("span", {}, [textoDa("visitas")])
]);
const blocoGrande = elementoDa("div", {}, [
  elementoDa("span", {}, [textoDa("359")]),
  elementoDa("span", {}, [textoDa("visitas")]),
  elementoDa("p", {}, [textoDa("x".repeat(LIMITE_TEXTO_POR_NIVEL + 100))])
]);
const leituraPequena = valorDoRotulo(blocoPequeno.filhos[1], "visita", blocoPequeno, { body: null });
testar("bloco pequeno: le o numero", 359, leituraPequena ? leituraPequena.valor : null);
testar("bloco grande demais: para de subir sem ler", null,
  valorDoRotulo(blocoGrande.filhos[1], "visita", blocoGrande, { body: null }));

console.log("");
console.log("=== #40 - vendas acima das visitas: mostrar com alerta ===");
const acima = calcular({ visitas: 5, vendas: 12 }, 10);
testar("#40: os numeros continuam", 12, acima.vendas);
testar("#40: marca o alerta", true, acima.vendasAcimaDasVisitas);
testar("#40: sem taxa de conversao", null, acima.conversao);
testar("#40: sem 'vende a cada'", null, acima.visitasPorVenda);
testar("#40: caso normal nao marca alerta", false, calcular({ visitas: 359, vendas: 50 }, 10).vendasAcimaDasVisitas);

const recusasAcima = [];
const cardAcima = elementoDa("section", {}, [
  elementoDa("a", { href: "https://produto.mercadolivre.com.br/MLB-3456789012-caixa" }, [textoDa("Caixa")]),
  elementoDa("span", {}, [textoDa("5 visitas")]),
  elementoDa("span", {}, [textoDa("12 vendas")])
]);
const rAcima = varrerPagina(documentoDa(elementoDa("body", {}, [cardAcima])), LISTA, recusasAcima);
testar("#40: a varredura nao descarta mais o anuncio", 12,
  rAcima["MLB3456789012"] ? rAcima["MLB3456789012"].vendas : "descartado");
testar("#40: o diagnostico anota o aviso", true,
  recusasAcima.some(function (r) { return /aviso/.test(r.motivo); }));

console.log("");
console.log("=== 0.1.7 e lote 24 - data invalida, URL quebrada ===");
// A 0.1.7 apertou o ehData (dia por mes). Isso AFROUXOU o motivoDoNumero:
// "31.04.2023" nao existe no calendario, entao deixou de ser data - e, sem a
// regra de FORMA, virava 31.042.023 visitas. Estes casos prendem os dois
// lados da regra.
testar("ehData: 31 de abril nao e data", false, ehData("31.04.2023"));
testar("ehData: 29 de fevereiro e data", true, ehData("29.02.2024"));
testar("ehData: 30 de fevereiro nao e data", false, ehData("30.02.2024"));
testar("ehData: 31 de dezembro e data", true, ehData("31.12.2023"));
testar("data invalida com ponto nao vira metrica", null,
  numeroAntesDe("Publicado em 31.04.2023 visitas", "visita"));
testar("data invalida com barra nao vira metrica", null,
  numeroAntesDe("Visitas 31/04/2023", "visita"));
testar("milhar com ponto continua sendo metrica", 1299500,
  numeroAntesDe("1.299.500 visitas", "visita"));

// A 0.1.7 passou a tolerar URL invalida (extensao rodando em pagina com
// endereco estranho). A leitura nao pode parar por causa disso, e o rastro
// precisa dizer que a tela nao pode ser identificada.
testar("url invalida nao e vitrine", false, ehPaginaDeCompra("nao-e-uma-url"));
const rUrlInvalida = varrerPagina(documentoDa(corpoVendedor), "nao-e-uma-url");
testar("url invalida: a leitura continua", 359, rUrlInvalida["MLB3456789012"].visitas);
testar("url invalida: o rastro diz que a tela e desconhecida", "(url invalida)",
  rUrlInvalida["MLB3456789012"].origem.visitas.tela);

console.log("");
console.log("=== manifest - cada arquivo depois de quem ele usa ===");
// Os arquivos de src/ conversam por variaveis globais: o leitura.js define
// MLMetricsLeitura, e o coletor.js usa. Se o manifest carregar um arquivo
// ANTES do que ele usa, a global ainda nao existe, o script morre no
// carregamento e nada funciona naquela aba - sem nem o registrarErro para
// contar, porque ele tambem nao carregou. O teste no navegador nao pega isso:
// ele carrega a propria lista de arquivos, nao a do manifest.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const ordemDoManifest = manifest.content_scripts[0].js;

/**
 * Confere uma lista de arquivos carregados em sequencia: cada global
 * MLMetrics... que um arquivo usa precisa ter sido definida por um arquivo
 * ANTERIOR da lista.
 *
 * @param {string} onde rotulo do teste ("manifest", "popup.html")
 * @param {string[]} arquivos caminhos relativos a raiz do projeto, na ordem
 */
function conferirOrdem(onde, arquivos) {
  const globaisDefinidas = [];

  arquivos.forEach(function (arquivo) {
    // Sem as linhas de comentario: cabecalho que cita "MLMetricsLeitura."
    // nao e uso de verdade.
    const codigo = fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8")
      .split("\n")
      .filter(function (linha) { return !/^\s*(\/\*\*|\*|\/\/)/.test(linha); })
      .join("\n");
    const definida = (codigo.match(/^var (MLMetrics\w+) =/m) || [])[1];
    const usadas = (codigo.match(/MLMetrics\w+(?=\.)/g) || []).filter(function (global, i, todas) {
      return global !== definida && todas.indexOf(global) === i;
    });

    usadas.forEach(function (global) {
      testar(onde + ": " + arquivo + " vem depois de quem define " + global, true,
        globaisDefinidas.indexOf(global) !== -1);
    });

    if (definida) globaisDefinidas.push(definida);
  });
}

conferirOrdem("manifest", ordemDoManifest);

// O popup tem a propria lista, nas tags <script> do popup.html (lote 26): ele
// passou a usar leitura.js e gravacao.js em vez de copias das regras.
const scriptsDoPopup = (fs.readFileSync(path.join(__dirname, "..", "src", "popup.html"), "utf8")
  .match(/<script src="[^"]+"><\/script>/g) || [])
  .map(function (tag) { return "src/" + tag.match(/src="([^"]+)"/)[1]; });
conferirOrdem("popup.html", scriptsDoPopup);
testar("popup.html: carrega o popup.js por ultimo", "src/popup.js",
  scriptsDoPopup[scriptsDoPopup.length - 1]);

// Sem "unlimitedStorage" a cota e de 10 MB, e o historico diario de centenas
// de anuncios a enche em meses. Cota cheia nao falha so o historico: o CACHE
// tambem deixa de gravar, e o painel para de receber numero novo.
testar("manifest: pede unlimitedStorage (historico nao disputa cota com o cache)", true,
  (manifest.permissions || []).indexOf("unlimitedStorage") !== -1);

// Modulo fora do manifest nao carrega na pagina: o arquivo existe, os testes
// passam, e a extensao de verdade quebra.
testar("manifest: todo modulo de src/ esta na lista", "", [
  "src/gravacao.js", "src/leitura.js", "src/diagnostico.js", "src/calculo.js"
].filter(function (arquivo) { return ordemDoManifest.indexOf(arquivo) === -1; }).join(", "));

console.log("");
console.log("=== gravacao.js - a regra de mesclar no cache ===");
const T0 = 1000000;
const origemDe = function (trecho) { return { trecho: trecho, tela: "/anuncios/lista" }; };
const cacheG = {};

const g1 = MLMetricsGravacao.mesclar(cacheG, { MLB1: { visitas: 359, origem: { visitas: origemDe("a") } } }, T0, false);
testar("mesclar: anuncio novo conta como mudanca", "MLB1", g1.mudancas.join(","));
testar("mesclar: carimba a hora no rastro", T0, cacheG.MLB1.origem.visitas.em);

MLMetricsGravacao.mesclar(cacheG, { MLB1: { vendas: 50, origem: { vendas: origemDe("b") } } }, T0 + 1000, false);
testar("mesclar: tela so com vendas mantem as visitas", 359, cacheG.MLB1.visitas);
testar("mesclar: e mantem o rastro das visitas", "a", cacheG.MLB1.origem.visitas.trecho);

const g3 = MLMetricsGravacao.mesclar(cacheG, { MLB1: { visitas: 359, origem: { visitas: origemDe("c") } } }, T0 + 2000, false);
testar("mesclar: mesmo numero logo depois nao grava nada", 0, g3.mudancas.length + g3.renovados.length);

const g4 = MLMetricsGravacao.mesclar(cacheG, { MLB1: { visitas: 359, origem: { visitas: origemDe("d") } } }, T0 + 3 * 60 * 1000, false);
testar("mesclar: mesmo numero depois de 2 min renova a data", "MLB1", g4.renovados.join(","));
testar("mesclar: a renovacao aponta o rastro para a leitura nova", "d", cacheG.MLB1.origem.visitas.trecho);

MLMetricsGravacao.mesclar(cacheG, { MLB1: { visitas: 300, origem: { visitas: origemDe("e") } } }, T0 + 4 * 60 * 1000, false);
testar("mesclar: numero novo menor vence (vale o mais recente)", 300, cacheG.MLB1.visitas);

const cacheAntigo = { MLB2: { visitas: 10, capturadoEm: T0 } };
const g6 = MLMetricsGravacao.mesclar(cacheAntigo, { MLB2: { visitas: 10, origem: { visitas: origemDe("f") } } }, T0 + 1000, false);
testar("mesclar: registro antigo sem rastro renova na hora", "MLB2", g6.renovados.join(","));
testar("mesclar: e ganha o rastro", "f", cacheAntigo.MLB2.origem.visitas.trecho);

console.log("");
console.log("=== gravacao.js - historico diario (lote 26) ===");
// Datas locais montadas pelo proprio Date: o teste vale em qualquer fuso.
const DIA_18 = new Date(2026, 8, 18, 10, 0).getTime();
const DIA_18_NOITE = new Date(2026, 8, 18, 23, 50).getTime();
const DIA_19 = new Date(2026, 8, 19, 9, 0).getTime();
const leituraDe = function (visitas, vendas, marca) {
  const novo = { origem: {} };
  if (visitas !== undefined) {
    novo.visitas = visitas;
    novo.origem.visitas = { trecho: "«" + visitas + " visitas» " + marca, tela: "/anuncios/lista" };
  }
  if (vendas !== undefined) {
    novo.vendas = vendas;
    novo.origem.vendas = { trecho: "«" + vendas + " vendas» " + marca, tela: "/anuncios/lista" };
  }
  return novo;
};

testar("historico: chave por anuncio, com o prefixo que o Limpar apaga",
  "mlmetrics_historico_MLB1", MLMetricsGravacao.chaveDoHistorico("MLB1"));
testar("historico: dia local com zeros", "2026-01-05",
  MLMetricsGravacao.diaDe(new Date(2026, 0, 5, 0, 1).getTime()));
testar("historico: 23h50 ainda e o mesmo dia", "2026-09-18", MLMetricsGravacao.diaDe(DIA_18_NOITE));

const hist = {};
testar("historico: primeira leitura do dia grava", true,
  MLMetricsGravacao.registrarDia(hist, leituraDe(359, 12, "a"), DIA_18, false));
testar("historico: um registro no dia, com os dois numeros", "359/12",
  hist["2026-09-18"].visitas + "/" + hist["2026-09-18"].vendas);
testar("historico: cada numero leva o rastro de onde veio", "«359 visitas» a",
  hist["2026-09-18"].origem.visitas.trecho);
testar("historico: e a hora da leitura", DIA_18, hist["2026-09-18"].origem.visitas.em);

testar("historico: mesmo numero de novo no dia nao muda nada", false,
  MLMetricsGravacao.registrarDia(hist, leituraDe(359, 12, "b"), DIA_18 + 60 * 60 * 1000, false));
testar("historico: e o rastro fica o da primeira leitura", "«359 visitas» a",
  hist["2026-09-18"].origem.visitas.trecho);

MLMetricsGravacao.registrarDia(hist, leituraDe(361, undefined, "c"), DIA_18_NOITE, false);
testar("historico: numero novo no mesmo dia vence (fechamento do dia)", 361, hist["2026-09-18"].visitas);
testar("historico: a outra metrica do dia continua", 12, hist["2026-09-18"].vendas);

const semRastro = { visitas: 999 };
testar("historico: numero sem rastro de origem nao entra", false,
  MLMetricsGravacao.registrarDia(hist, semRastro, DIA_18_NOITE, false));

MLMetricsGravacao.registrarDia(hist, leituraDe(370, undefined, "d"), DIA_19, false);
testar("historico: dia seguinte ganha registro proprio", "2026-09-18,2026-09-19",
  Object.keys(hist).sort().join(","));
testar("historico: so entra o que foi lido naquele dia (vendas nao e copiada)", undefined,
  hist["2026-09-19"].vendas);

const histVelho = { "2025-01-01": { visitas: 1, origem: {} } };
MLMetricsGravacao.registrarDia(histVelho, leituraDe(5, undefined, "e"), DIA_18, false);
testar("historico: dia com mais de " + MLMetricsGravacao.DIAS_DE_HISTORICO + " dias sai", "2026-09-18",
  Object.keys(histVelho).join(","));

const histAuto = {};
MLMetricsGravacao.registrarDia(histAuto, leituraDe(7, undefined, "f"), DIA_18, true);
testar("historico: marca leitura da busca automatica", true,
  histAuto["2026-09-18"].origem.visitas.automatica);

console.log("");
console.log("=== chaves do storage num lugar so (lote 26b) ===");
// Os nomes sao o ENDERECO do que ja esta guardado no navegador da cliente:
// trocar "mlmetrics_dados" por outro nome faria a versao nova nao achar nada
// do que a antiga gravou. Por isso os valores ficam presos aqui.
testar("chaves: os nomes de sempre", JSON.stringify({
  CACHE: "mlmetrics_dados",
  DIAGNOSTICO: "mlmetrics_diagnostico",
  ERRO: "mlmetrics_erro",
  ORIGENS: "mlmetrics_origens",
  ULTIMA_BUSCA: "mlmetrics_ultima_busca"
}), JSON.stringify(MLMetricsGravacao.CHAVES));
testar("chaves: prefixo do historico de sempre", "mlmetrics_historico_",
  MLMetricsGravacao.PREFIXO_HISTORICO);
testar("chaves: todas comecam com o prefixo que o Limpar apaga", "",
  Object.keys(MLMetricsGravacao.CHAVES)
    .map(function (nome) { return MLMetricsGravacao.CHAVES[nome]; })
    .concat(MLMetricsGravacao.PREFIXO_HISTORICO)
    .filter(function (chave) { return chave.indexOf(MLMetricsGravacao.PREFIXO_CHAVES) !== 0; })
    .join(", "));
testar("chaves: nao da para alterar durante a execucao", true,
  Object.isFrozen(MLMetricsGravacao.CHAVES));

// Nome de chave escrito a mao fora do gravacao.js e exatamente o erro que
// esta mudanca evita: a aba gravaria num nome e o painel leria de outro.
const PASTA_SRC = path.join(__dirname, "..", "src");
const escritasAMao = fs.readdirSync(PASTA_SRC)
  .filter(function (nome) { return /\.js$/.test(nome) && nome !== "gravacao.js"; })
  .filter(function (nome) {
    return /["']mlmetrics_/.test(fs.readFileSync(path.join(PASTA_SRC, nome), "utf8"));
  });
testar("chaves: nenhum outro arquivo de src/ escreve nome de chave a mao", "",
  escritasAMao.join(", "));

// ----------------------------------------------------------------------------
// Service worker (background.js) - com chrome falso, sem navegador
// ----------------------------------------------------------------------------

/**
 * chrome falso para o service worker: storage em memoria com atraso
 * aleatorio (para que gravacoes simultaneas realmente se cruzem, como no
 * navegador) e captura do listener de mensagens.
 */
function chromeParaServiceWorker() {
  const armazem = {};
  let ouvinte = null;

  function copia(valor) {
    return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
  }

  function atraso() {
    return Math.floor(Math.random() * 6);
  }

  return {
    armazem: armazem,
    enviar: function (mensagem, remetente) {
      return new Promise(function (resolve) {
        ouvinte(mensagem, remetente, resolve);
      });
    },
    runtime: {
      id: "extensao-teste",
      lastError: undefined,
      onMessage: {
        addListener: function (funcao) { ouvinte = funcao; }
      }
    },
    storage: {
      local: {
        get: function (chaves, callback) {
          const resposta = {};
          [].concat(chaves).forEach(function (chave) {
            if (armazem[chave] !== undefined) resposta[chave] = copia(armazem[chave]);
          });
          setTimeout(function () { callback(resposta); }, atraso());
        },
        set: function (objeto, callback) {
          setTimeout(function () {
            Object.keys(objeto).forEach(function (chave) {
              armazem[chave] = copia(objeto[chave]);
            });
            if (callback) callback();
          }, atraso());
        }
      }
    }
  };
}

async function testesDoServiceWorker() {
  console.log("");
  console.log("=== background.js - gravacao unica para todas as abas (#21) ===");

  const chromeSW = chromeParaServiceWorker();
  globalThis.chrome = chromeSW;
  globalThis.importScripts = function (nome) {
    const codigo = fs.readFileSync(path.join(__dirname, "..", "src", nome), "utf8");
    globalThis.MLMetricsGravacao = new Function(codigo + "\nreturn MLMetricsGravacao;")();
  };
  new Function(fs.readFileSync(CAMINHO_BACKGROUND, "utf8"))();

  const daExtensao = { id: "extensao-teste" };

  // Tres abas gravando AO MESMO TEMPO. Sem a fila unica, as leituras
  // simultaneas do cache fariam uma gravacao apagar a outra.
  const respostas = await Promise.all([
    chromeSW.enviar({ tipo: "salvar", novos: { MLB1: { visitas: 10, origem: { visitas: origemDe("a") } } } }, daExtensao),
    chromeSW.enviar({ tipo: "salvar", novos: { MLB2: { visitas: 20, origem: { visitas: origemDe("b") } } } }, daExtensao),
    chromeSW.enviar({ tipo: "salvar", novos: { MLB1: { vendas: 3, origem: { vendas: origemDe("c") } } } }, daExtensao)
  ]);

  const cache = chromeSW.armazem.mlmetrics_dados || {};
  testar("SW: tres abas gravando juntas nao apagam nada", "MLB1,MLB2", Object.keys(cache).sort().join(","));
  testar("SW: o mesmo anuncio junta visitas e vendas de abas diferentes", "10/3",
    cache.MLB1 ? cache.MLB1.visitas + "/" + cache.MLB1.vendas : "sem registro");
  testar("SW: responde quantos anuncios mudaram", 1, respostas[0].mudancas);

  const repetida = await chromeSW.enviar(
    { tipo: "salvar", novos: { MLB2: { visitas: 20, origem: { visitas: origemDe("b") } } } }, daExtensao);
  testar("SW: leitura repetida nao conta como mudanca (sem aviso verde)", 0, repetida.mudancas);

  const deFora = await chromeSW.enviar({ tipo: "salvar", novos: { MLB9: { visitas: 1 } } }, { id: "outra-extensao" });
  testar("SW: pedido de fora da extensao e recusado", false, deFora.ok);
  testar("SW: e nao grava nada", undefined, (chromeSW.armazem.mlmetrics_dados || {}).MLB9);
  testar("SW: nem historico", undefined, chromeSW.armazem.mlmetrics_historico_MLB9);

  // As tres gravacoes simultaneas do comeco tambem passaram pelo historico,
  // dentro da mesma fila: duas abas nao podem apagar o dia uma da outra.
  const hoje = MLMetricsGravacao.diaDe(Date.now());
  const histMLB1 = (chromeSW.armazem.mlmetrics_historico_MLB1 || {})[hoje] || {};
  testar("SW: historico do dia junta visitas e vendas de abas diferentes", "10/3",
    histMLB1.visitas + "/" + histMLB1.vendas);
  testar("SW: historico grava o rastro de cada numero", "a",
    histMLB1.origem ? histMLB1.origem.visitas.trecho : "sem rastro");
  testar("SW: cada anuncio na propria chave de historico", 20,
    ((chromeSW.armazem.mlmetrics_historico_MLB2 || {})[hoje] || {}).visitas);

  const buscaFora = await chromeSW.enviar({ tipo: "buscar", url: "https://example.com/" }, daExtensao);
  testar("SW: busca fora do dominio do ML e recusada", false, buscaFora.ok);

  const buscaHttp = await chromeSW.enviar({ tipo: "buscar", url: "http://www.mercadolivre.com.br/anuncios" }, daExtensao);
  testar("SW: busca sem https e recusada", false, buscaHttp.ok);
}

function imprimirResumo() {
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
}

// Os testes do service worker sao assincronos: o resumo so sai depois deles.
testesDoServiceWorker().then(imprimirResumo, function (erro) {
  falhou++;
  falhas.push("erro nos testes do service worker: " + erro.message);
  imprimirResumo();
});