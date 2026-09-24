// ============================================================================
// LER DIAGNOSTICO - resume o que a cliente colar na conversa
//
// O "Copiar diagnostico" do popup gera um JSON grande, e o "Copiar
// conferencia" gera um texto. Os dois respondem perguntas diferentes, e as
// respostas ficam espalhadas no meio de muita coisa. Este arquivo le
// qualquer um dos dois e escreve um resumo curto, terminando com o que
// aquilo DECIDE - que e o motivo de a gente ter pedido.
//
// Como rodar:
//
//   node teste/ler-diagnostico.js caminho/do/arquivo.json
//   node teste/ler-diagnostico.js < arquivo.txt
//
// O arquivo com o que ela mandou tem dado dela (nome de produto nos trechos).
// Guarde FORA do repositorio - ou com um nome que o .gitignore ja cobre
// ("diagnostico*.json", "conferencia*.txt"). Este programa so le e imprime na
// tela: nao grava nada, nao manda nada para lugar nenhum.
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Quantos dias separam duas datas, em dias de calendario.
 */
function diasEntre(depois, antes) {
  return Math.round((depois - antes) / (24 * 60 * 60 * 1000));
}

/**
 * Quebra um texto longo em linhas que cabem no terminal, com recuo nas
 * continuacoes. Conclusao que vira uma linha de 300 caracteres nao e lida.
 *
 * @param {string} texto
 * @param {string} recuo espacos das linhas seguintes
 * @param {number} [largura]
 * @returns {string[]}
 */
function quebrar(texto, recuo, largura) {
  const limite = (largura || 78) - recuo.length;
  const linhas = [];
  let atual = "";

  String(texto).split(" ").forEach(function (palavra) {
    if (atual && (atual + " " + palavra).length > limite) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = atual ? atual + " " + palavra : palavra;
    }
  });

  if (atual) linhas.push(atual);

  return linhas.map(function (linha, i) { return (i === 0 ? "" : recuo) + linha; });
}

function formatarData(valor) {
  if (!valor) return "?";
  const data = new Date(valor);
  return isNaN(data.getTime()) ? String(valor) : data.toLocaleString("pt-BR");
}

/**
 * Conta as ocorrencias de cada chave e devolve da mais comum para a menos.
 */
function maisComuns(contagem) {
  return Object.keys(contagem || {})
    .map(function (chave) { return { chave: chave, quantas: contagem[chave] }; })
    .sort(function (a, b) { return b.quantas - a.quantas; });
}

/**
 * Le o texto do "Copiar conferencia" (nao e JSON: e o texto que a vendedora
 * cola). So conta os resultados e lista os que NAO bateram, que sao os
 * unicos que pedem trabalho.
 *
 * @param {string} texto
 * @returns {string[]} linhas do resumo
 */
function lerConferencia(texto) {
  const linhas = texto.split("\n");
  const bateram = [];
  const naoBateram = [];

  linhas.forEach(function (linha) {
    const naoBateu = linha.match(/^NÃO BATEU\s+—\s+(\S+)/);
    const bateu = linha.match(/^BATEU\s+—\s+(\S+)/);

    if (naoBateu) naoBateram.push(naoBateu[1]);
    else if (bateu) bateram.push(bateu[1]);
  });

  const saida = ["CONFERENCIA DOS NUMEROS", ""];

  if (bateram.length + naoBateram.length === 0) {
    saida.push("  Nenhum anúncio marcado — ela clicou em \"Copiar conferência\" antes");
    saida.push("  de marcar \"✓ bate\" ou \"✗ não bate\" nos 3 anúncios.");
    return saida;
  }

  saida.push("  Bateram:     " + bateram.length + (bateram.length ? "  (" + bateram.join(", ") + ")" : ""));
  saida.push("  NÃO bateram: " + naoBateram.length + (naoBateram.length ? "  (" + naoBateram.join(", ") + ")" : ""));
  saida.push("");

  if (naoBateram.length === 0) {
    saida.push("  → A leitura está certa nos anúncios conferidos. Libera mostrar o");
    saida.push("    histórico (vendas/mês e faturamento/mês) assim que o #47 for decidido.");
  } else {
    saida.push("  → Para cada um que não bateu, o trecho « » no texto dela diz o que a");
    saida.push("    extensão leu. Comparar com o número certo aponta a regra a corrigir.");
  }

  return saida;
}

/**
 * Resume o relatorio do "Copiar diagnostico".
 *
 * @param {Object} relatorio o JSON do popup
 * @param {string} [versaoAtual] versao do manifest neste projeto
 * @returns {string[]} linhas do resumo
 */
function lerDiagnostico(relatorio, versaoAtual) {
  const saida = [];
  const tela = relatorio.telaAtual || {};
  const capturado = relatorio.capturado || {};
  const conclusoes = [];

  saida.push("DIAGNOSTICO DA EXTENSAO");
  saida.push("");
  saida.push("  Versão dela: " + (relatorio.versao || "?") +
    (versaoAtual && relatorio.versao && relatorio.versao !== versaoAtual
      ? "   ⚠ aqui o manifest está em " + versaoAtual
      : ""));
  saida.push("  Gerado em:   " + formatarData(relatorio.geradoEm));

  if (versaoAtual && relatorio.versao && relatorio.versao !== versaoAtual) {
    conclusoes.push("Ela está numa versão antiga (" + relatorio.versao + "): o reload da " +
      "extensão não pegou, ou o zip não foi trocado. O resto do relatório pode ser de " +
      "código velho.");
  }

  // --- Erro e telas que pararam: o que estraga tudo vem primeiro -----------
  if (relatorio.ultimoErro && relatorio.ultimoErro.mensagem) {
    const erro = relatorio.ultimoErro;
    saida.push("");
    saida.push("  ⚠ ERRO na leitura, em " + (erro.onde || "?") + " (" + formatarData(erro.quando) + ")");
    saida.push("    " + erro.mensagem);
    if (erro.tela) saida.push("    tela: " + erro.tela);
    conclusoes.push("Tem erro gravado: a extensão quebrou ao ler uma tela. Isso explica " +
      "número faltando melhor que qualquer outra hipótese — resolver primeiro.");
  }

  const falhando = Object.keys(relatorio.telasFalhando || {});
  if (falhando.length > 0) {
    saida.push("");
    saida.push("  ⚠ Telas que entregavam números e pararam:");
    falhando.forEach(function (nome) {
      saida.push("    " + nome + " (desde " + formatarData(relatorio.telasFalhando[nome].quando) + ")");
    });
    conclusoes.push("Uma tela que já funcionou parou de entregar números: sinal de que o " +
      "Mercado Livre mudou o layout dela.");
  }

  // --- A tela que ela estava olhando --------------------------------------
  saida.push("");
  saida.push("TELA DO CLIQUE");
  saida.push("");

  if (tela.erro) {
    saida.push("  " + tela.erro);
    conclusoes.push("A aba não respondeu: ela clicou fora de uma página do ML, ou a aba " +
      "estava aberta antes da atualização (faltou F5). Peça de novo, na tela " +
      "\"Minhas publicações\".");
  } else {
    const captura = tela.capturariaAgora || {};
    const codigos = Object.keys(captura);

    saida.push("  Endereço:       " + (tela.host || "?") + (tela.caminho || ""));
    saida.push("  É vitrine?      " + (tela.vitrine ? "SIM (a extensão não captura aqui)" : "não"));
    saida.push("  Fala em visita? " + (tela.mencionaVisita ? "sim" : "NÃO"));
    saida.push("  Capturaria:     " + codigos.length + " anúncio(s)");

    if (tela.vitrine) {
      conclusoes.push("O diagnóstico saiu de uma página de produto, não da tela de " +
        "vendedor. Peça outro em \"Minhas publicações\".");
    } else if (!tela.mencionaVisita) {
      conclusoes.push("A tela não tem a palavra \"visita\" fora do painel — ou não é tela " +
        "de vendedor, ou o ML trocou o vocabulário (aí o ROTULOS do leitura.js precisa " +
        "crescer).");
    } else if (codigos.length === 0) {
      conclusoes.push("A tela é de vendedor e mesmo assim nada seria capturado: a resposta " +
        "está nas recusas abaixo.");
    } else {
      conclusoes.push("A captura funciona nessa tela: " + codigos.length + " anúncio(s). " +
        "Guarde o caminho " + (tela.caminho || "") + " — é a tela de vendedor real.");
    }

    // --- Periodo (#47): a pergunta que este relatorio veio responder ------
    saida.push("");
    saida.push("  PERÍODO (decide o #47):");

    const periodo = tela.periodo || [];
    if (periodo.length === 0) {
      saida.push("    nenhum texto de filtro de período reconhecido na tela");
      conclusoes.push("#47 continua aberto: nenhum filtro de período apareceu. Olhe as " +
        "amostras — pode ser um formato que o ehTextoDePeriodo ainda não conhece.");
    } else {
      periodo.forEach(function (item) {
        saida.push("    " + (item.marcado === true ? "[x] " : item.marcado === false ? "[ ] " : "    ") +
          item.texto + "   (" + item.onde + ")");
      });

      const escolhido = periodo.filter(function (item) { return item.marcado === true; });
      if (escolhido.length > 0) {
        conclusoes.push("#47: a tela está filtrada em \"" + escolhido[0].texto + "\" — os " +
          "números lidos são desse recorte, não do total. É isso que a conta de vendas/mês " +
          "precisa saber.");
      } else {
        conclusoes.push("#47: há textos de período na tela, mas nenhum marcado como " +
          "escolhido. Verifique nas amostras qual deles está ativo.");
      }
    }
  }

  // --- Por que cada rotulo nao virou numero --------------------------------
  const recusas = tela.recusas || [];
  const resumo = maisComuns(tela.resumoDasRecusas);

  if (resumo.length > 0) {
    saida.push("");
    saida.push("RÓTULOS QUE NÃO VIRARAM NÚMERO");
    saida.push("");

    resumo.forEach(function (linha) {
      const exemplo = recusas.find(function (recusa) {
        return (recusa.metrica ? recusa.metrica + ": " : "") + recusa.motivo === linha.chave;
      });

      saida.push("  " + String(linha.quantas).padStart(3, " ") + "x  " + linha.chave);
      if (exemplo && exemplo.trecho) saida.push("        ex.: " + exemplo.trecho);
    });

    const campeao = resumo[0];
    if (campeao.quantas >= 3) {
      conclusoes.push("O motivo mais comum de recusa é \"" + campeao.chave + "\" (" +
        campeao.quantas + "x): é por aí que se ganha mais número de uma vez.");
    }
  }

  // --- O que ela ja tem guardado ------------------------------------------
  const codigosGuardados = Object.keys(capturado);
  const comRastro = codigosGuardados.filter(function (codigo) {
    const origem = capturado[codigo].origem || {};
    return origem.visitas || origem.vendas;
  });

  saida.push("");
  saida.push("O QUE ESTÁ GUARDADO NO NAVEGADOR DELA");
  saida.push("");
  saida.push("  Anúncios: " + codigosGuardados.length +
    "  (com rastro de origem: " + comRastro.length + ")");

  codigosGuardados.slice(0, 5).forEach(function (codigo) {
    const dados = capturado[codigo];
    const origem = dados.origem || {};
    const numeros = ["visitas", "vendas"].filter(function (metrica) {
      return dados[metrica] !== undefined;
    }).map(function (metrica) { return metrica + " " + dados[metrica]; });

    saida.push("  " + codigo + ": " + (numeros.join(" · ") || "sem número"));
    ["visitas", "vendas"].forEach(function (metrica) {
      if (origem[metrica]) saida.push("      " + metrica + " ← " + origem[metrica].trecho);
    });
  });

  if (codigosGuardados.length > 5) {
    saida.push("  ... e mais " + (codigosGuardados.length - 5) + " anúncio(s)");
  }

  if (codigosGuardados.length > comRastro.length) {
    conclusoes.push((codigosGuardados.length - comRastro.length) + " anúncio(s) sem rastro " +
      "de origem (gravados por versão antiga): pedir \"Limpar dados guardados\".");
  }

  // --- Historico e origens ------------------------------------------------
  const historico = relatorio.historico || {};
  if (historico.registros !== undefined) {
    saida.push("");
    saida.push("HISTÓRICO DIÁRIO");
    saida.push("  " + (historico.anuncios || 0) + " anúncio(s), " +
      (historico.registros || 0) + " registro(s), de " +
      (historico.primeiroDia || "?") + " a " + (historico.ultimoDia || "?"));

    if (!historico.registros) {
      conclusoes.push("O histórico ainda não gravou nada: ou é a primeira vez que ela " +
        "passa pela tela com esta versão, ou a captura não está acontecendo.");
    }
  }

  const origens = relatorio.origens || [];
  if (origens.length > 0) {
    saida.push("");
    saida.push("TELAS DE VENDEDOR RECONHECIDAS");
    origens.forEach(function (origem) { saida.push("  " + origem); });
  }

  const conferidos = Object.keys(relatorio.conferencia || {});
  if (conferidos.length > 0) {
    const naoBateram = conferidos.filter(function (codigo) {
      return relatorio.conferencia[codigo].resultado !== "bate";
    });

    saida.push("");
    saida.push("CONFERÊNCIA MARCADA POR ELA");
    saida.push("  " + conferidos.length + " anúncio(s) marcado(s), " +
      naoBateram.length + (naoBateram.length === 1 ? " que NÃO bateu" : " que NÃO bateram") +
      (naoBateram.length ? ": " + naoBateram.join(", ") : ""));

    // A conferencia e o que libera (ou trava) mostrar o historico: entra nas
    // conclusoes, nao so na lista.
    if (naoBateram.length === 0) {
      conclusoes.push("Os " + conferidos.length + " anúncio(s) conferidos BATERAM com o " +
        "Mercado Livre: a leitura está certa onde ela olhou. É o que faltava para " +
        "mostrar vendas/mês e faturamento/mês (lote 29).");
    } else {
      conclusoes.push(naoBateram.length + " anúncio(s) NÃO bateram (" + naoBateram.join(", ") +
        "): compare o trecho « » de cada um com o número certo do ML — é ali que está a " +
        "regra de leitura errada. Enquanto isso não fechar, o histórico não deve ser " +
        "exibido.");
    }
  }

  // --- O que isso decide ---------------------------------------------------
  saida.push("");
  saida.push("O QUE ISSO DECIDE");
  saida.push("");

  if (conclusoes.length === 0) {
    saida.push("  Nada de anormal, e nada conclusivo. Vale pedir o diagnóstico de novo");
    saida.push("  na tela \"Minhas publicações\", com a lista carregada até o fim.");
  } else {
    conclusoes.forEach(function (conclusao, i) {
      quebrar((i + 1) + ". " + conclusao, "     ").forEach(function (linha) {
        saida.push("  " + linha);
      });
    });
  }

  return saida;
}

/**
 * Descobre o que foi colado (JSON do diagnostico ou texto da conferencia) e
 * devolve o resumo.
 *
 * @param {string} texto
 * @param {string} [versaoAtual]
 * @returns {string}
 */
function resumir(texto, versaoAtual) {
  const limpo = String(texto || "").trim();

  if (limpo.length === 0) return "Não veio nada para ler.";

  if (/^CONFER[ÊE]NCIA/i.test(limpo)) return lerConferencia(limpo).join("\n");

  let relatorio;
  try {
    relatorio = JSON.parse(limpo);
  } catch (e) {
    return "Isto não é o texto do \"Copiar diagnóstico\" nem o do \"Copiar " +
      "conferência\".\nSe ela colou junto com outra mensagem, mande só do \"{\" até o " +
      "\"}\" final.";
  }

  return lerDiagnostico(relatorio, versaoAtual).join("\n");
}

/**
 * Versao do manifest deste projeto, para comparar com a que ela tem.
 */
function versaoDoProjeto() {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    return manifest.version;
  } catch (e) {
    return null;
  }
}

if (require.main === module) {
  const arquivo = process.argv[2];
  const texto = arquivo
    ? fs.readFileSync(arquivo, "utf8")
    : fs.readFileSync(0, "utf8");  // veio pela entrada padrao

  console.log("");
  console.log(resumir(texto, versaoDoProjeto()));
  console.log("");
}

module.exports = { resumir: resumir, lerDiagnostico: lerDiagnostico, lerConferencia: lerConferencia };
