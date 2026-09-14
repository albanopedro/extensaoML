// ============================================================================
// POPUP - painel de controle da extensao
//
// Abre ao clicar no icone da extensao. Serve a tres propositos, todos
// pensados para quem NAO e programador:
//
//   1. mostrar que a extensao esta viva e o que ela ja capturou
//   2. permitir apagar dados errados sem reinstalar nada
//   3. entregar um diagnostico copiavel quando algo nao funcionar
//
// O terceiro e o mais importante na fase de testes: sem ele, "nao apareceu
// nada" e tudo que se consegue saber, e nao da para consertar as cegas.
// ============================================================================

(function () {
  "use strict";

  const CHAVE_CACHE = "mlmetrics_dados";
  const CHAVE_DIAGNOSTICO = "mlmetrics_diagnostico";
  // Telas de vendedor que ja entregaram numeros. Entram no relatorio copiado
  // para o diagnostico remoto dizer QUAIS telas a extensao reconheceu - e
  // para nos mostrarmos o endereco exato de "Minhas publicacoes" sem o usuario
  // precisar navegar ate ele. Nao e dado novo: o coletor ja guarda estas
  // URLs; o popup so as inclui quando o botao e clicado.
  const CHAVE_ORIGENS = "mlmetrics_origens";

  const resumo = document.getElementById("resumo");
  const lista = document.getElementById("lista");
  const aviso = document.getElementById("aviso");
  const campoDiagnostico = document.getElementById("diagnostico");

  /**
   * Mostra uma mensagem temporaria no rodape do popup.
   */
  function avisar(texto) {
    aviso.textContent = texto;
    setTimeout(function () { aviso.textContent = ""; }, 2500);
  }

  /**
   * Monta uma linha da lista de anuncios capturados.
   */
  function criarItem(codigo, dados) {
    const item = document.createElement("div");
    item.className = "item";

    const esquerda = document.createElement("span");
    esquerda.className = "codigo";
    esquerda.textContent = codigo;

    const direita = document.createElement("span");
    direita.className = "numeros";

    // Montamos so o que existe. Escrever "0 visitas" quando nao sabemos
    // quantas foram seria afirmar algo falso.
    const partes = [];
    if (dados.visitas !== undefined) partes.push(dados.visitas + " visitas");
    if (dados.vendas !== undefined) partes.push(dados.vendas + " vendas");

    direita.textContent = partes.join(" · ") || "sem dados";

    item.appendChild(esquerda);
    item.appendChild(direita);
    return item;
  }

  /**
   * Le o storage e desenha o estado atual.
   */
  function desenhar() {
    try {
      chrome.storage.local.get([CHAVE_CACHE, CHAVE_DIAGNOSTICO], function (guardado) {
        if (chrome.runtime.lastError) return;  // contexto invalidado

        const cache = guardado[CHAVE_CACHE] || {};
        const codigos = Object.keys(cache);

        lista.textContent = "";

        if (codigos.length === 0) {
          resumo.textContent =
            "Nenhum anúncio capturado ainda. Abra \"Minhas publicações\" " +
            "no Mercado Livre e espere a lista carregar por completo.";
          return;
        }

        resumo.textContent = codigos.length + " anúncio(s) com dados guardados.";

        codigos.forEach(function (codigo) {
          lista.appendChild(criarItem(codigo, cache[codigo]));
        });
      });
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  }

  // --------------------------------------------------------------------------
  // Acoes
  // --------------------------------------------------------------------------

  document.getElementById("limpar").addEventListener("click", function () {
    // Apaga so as nossas chaves, nao o storage inteiro. Hoje da na mesma,
    // mas evita surpresa se a extensao passar a guardar outra coisa.
    try {
      chrome.storage.local.remove([CHAVE_CACHE, CHAVE_DIAGNOSTICO], function () {
        if (chrome.runtime.lastError) return;  // contexto invalidado
        avisar("Dados apagados.");
        desenhar();
      });
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  });

  document.getElementById("copiar").addEventListener("click", function () {
    try {
      chrome.storage.local.get(
        [CHAVE_CACHE, CHAVE_DIAGNOSTICO, CHAVE_ORIGENS],
        function (guardado) {
          if (chrome.runtime.lastError) return;  // contexto invalidado

          // JSON.stringify com indentacao 2 gera texto legivel para colar
          // numa conversa, em vez de uma linha unica gigante.
          const relatorio = JSON.stringify({
            versao: chrome.runtime.getManifest().version,
            geradoEm: new Date().toISOString(),
            // As telas de vendedor reconhecidas (até 3). Sao o caminho mais
            // direto para confirmar que estamos olhando a página certa.
            origens: guardado[CHAVE_ORIGENS] || [],
            capturado: guardado[CHAVE_CACHE] || {},
            diagnostico: guardado[CHAVE_DIAGNOSTICO] || null
          }, null, 2);

          navigator.clipboard.writeText(relatorio).then(function () {
            avisar("Copiado. Cole aqui na conversa.");
          }).catch(function () {
            avisar("Clipboard bloqueado: selecione o texto abaixo e use Ctrl+C.");
          });

          // O texto fica SEMPRE na tela, selecionado. A copia automatica e
          // um atalho; se o navegador nao deixar, a pessoa copia na mao ou
          // le o que esta escrito - sem depender do clipboard para nada.
          campoDiagnostico.hidden = false;
          campoDiagnostico.value = relatorio;
          campoDiagnostico.select();
        }
      );
    } catch (e) {
      // contexto invalidado: popup inteiro e recarregado pelo navegador
    }
  });

  desenhar();
})();
