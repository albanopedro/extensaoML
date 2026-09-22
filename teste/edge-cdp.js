// ============================================================================
// EDGE + CDP - sobe o Edge com a extensao INSTALADA e conversa com ele
//
// Este arquivo e so a mecanica; as verificacoes ficam em
// verificar-no-edge.js. Ele existe porque o harness e a pagina de teste usam
// um "chrome" falso: storage em memoria, sem service worker, sem mensagens
// de verdade. Tudo que depende do navegador - a fila do service worker, o
// script orfao depois de recarregar a extensao, o popup com chrome.tabs -
// so se prova aqui.
//
// Sem dependencia nova: o Edge ja esta na maquina, e o protocolo de
// depuracao (CDP) e conversa por WebSocket, que o Node 22 tem embutido.
//
// Como funciona:
//   1. o Edge sobe com --load-extension (uma copia limpa do que vai para a
//      cliente), --headless (sem janela na frente de ninguem) e um perfil
//      descartavel;
//   2. --host-resolver-rules manda *.mercadolivre.com.br para o servidor
//      local de fixtures, e --ignore-certificate-errors aceita o certificado
//      proprio. Assim as paginas de teste tem o ENDERECO de verdade, que e o
//      que faz o manifest injetar os content scripts nelas;
//   3. cada aba (e o service worker) vira uma "sessao" do CDP, onde da para
//      rodar JavaScript e ler o resultado.
//
// Nada disso toca no Mercado Livre de verdade: o resolvedor de nomes manda
// tudo para 127.0.0.1, e o perfil e novo, sem login.
// ============================================================================

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORTA_CDP = 9223;

/**
 * Pasta descartavel do teste: perfil do Edge, certificado e a copia da
 * extensao. Fica fora do projeto - nada disso pode ser commitado, e o perfil
 * e recriado a cada rodada.
 */
function pastaDoTeste() {
  const pasta = path.join(os.tmpdir(), "ml-metrics-teste-edge");
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

/**
 * Gera (uma vez) o certificado do servidor de fixtures.
 *
 * O endereco precisa ser https://www.mercadolivre.com.br para o manifest
 * injetar os scripts, e https exige certificado. Ele e auto-assinado e so
 * vale dentro deste teste: o Edge sobe com --ignore-certificate-errors.
 *
 * @param {string} pasta
 * @returns {{chave: string, cert: string}} caminhos dos arquivos
 */
function certificado(pasta) {
  const chave = path.join(pasta, "chave.pem");
  const cert = path.join(pasta, "cert.pem");

  if (fs.existsSync(chave) && fs.existsSync(cert)) return { chave: chave, cert: cert };

  const resultado = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", chave, "-out", cert, "-days", "30",
    "-subj", "/CN=www.mercadolivre.com.br",
    "-addext", "subjectAltName=DNS:www.mercadolivre.com.br," +
      "DNS:produto.mercadolivre.com.br,DNS:mercadolivre.com.br,IP:127.0.0.1"
  ], { encoding: "utf8" });

  if (resultado.status !== 0) {
    throw new Error("nao consegui gerar o certificado com o openssl. " +
      "Ele vem com o Git para Windows (Git Bash). Erro: " +
      (resultado.stderr || resultado.error));
  }

  return { chave: chave, cert: cert };
}

/**
 * Prepara a pasta da extensao que sera carregada.
 *
 * Damos preferencia ao ZIP de dist/: e exatamente o que a cliente recebe,
 * entao o teste cobre tambem o que o empacotar.ps1 inclui (ja aconteceu de
 * um arquivo novo nao entrar no zip). Sem zip, carregamos o projeto mesmo.
 *
 * @param {string} raiz pasta do projeto
 * @param {string} pasta pasta descartavel do teste
 * @returns {{caminho: string, origem: string}}
 */
function extensaoParaCarregar(raiz, pasta) {
  const dist = path.join(raiz, "dist");
  const zips = fs.existsSync(dist)
    ? fs.readdirSync(dist).filter(function (nome) { return /\.zip$/.test(nome); })
    : [];

  if (zips.length === 0) return { caminho: raiz, origem: "pasta do projeto (sem zip em dist/)" };

  const zip = path.join(dist, zips.sort().pop());
  const destino = path.join(pasta, "extensao");

  fs.rmSync(destino, { recursive: true, force: true });

  const resultado = spawnSync("powershell", [
    "-NoProfile", "-Command",
    "Expand-Archive -Path '" + zip + "' -DestinationPath '" + destino + "' -Force"
  ], { encoding: "utf8" });

  if (resultado.status !== 0) {
    return { caminho: raiz, origem: "pasta do projeto (falhou descompactar o zip)" };
  }

  return { caminho: destino, origem: path.basename(zip) };
}

function esperar(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * Conversa com o Edge pelo protocolo de depuracao.
 *
 * Uma conexao WebSocket so, no nivel do NAVEGADOR; cada aba ou service
 * worker vira uma sessao dentro dela ("flatten"), identificada por
 * sessionId. E assim que da para rodar codigo dentro do service worker da
 * extensao e dentro de cada aba.
 */
class Navegador {
  constructor(processo, socket) {
    this.processo = processo;
    this.socket = socket;
    this.proximoId = 1;
    this.pendentes = new Map();

    // Contextos de JavaScript de cada aba. Interessa o MUNDO ISOLADO da
    // extensao: os content scripts nao rodam no mesmo mundo da pagina, entao
    // so por ele da para chamar as funcoes da extensao de dentro de uma aba.
    this.contextos = [];

    socket.addEventListener("message", (evento) => {
      const mensagem = JSON.parse(evento.data);

      if (!mensagem.id) {
        if (mensagem.method === "Runtime.executionContextCreated") {
          this.contextos.push({
            sessao: mensagem.sessionId,
            id: mensagem.params.context.id,
            nome: mensagem.params.context.name,
            origem: mensagem.params.context.origin
          });
        }
        return;  // demais eventos do protocolonao interessam aqui
      }

      const espera = this.pendentes.get(mensagem.id);
      if (!espera) return;
      this.pendentes.delete(mensagem.id);

      if (mensagem.error) espera.rejeitar(new Error(mensagem.error.message));
      else espera.resolver(mensagem.result);
    });
  }

  /**
   * Envia um comando do CDP. Com sessao, o comando vale para aquela aba ou
   * service worker; sem sessao, para o navegador.
   */
  enviar(metodo, parametros, sessao) {
    const id = this.proximoId++;
    const mensagem = { id: id, method: metodo, params: parametros || {} };

    if (sessao) mensagem.sessionId = sessao;
    this.socket.send(JSON.stringify(mensagem));

    return new Promise((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver: resolver, rejeitar: rejeitar });
      setTimeout(() => {
        if (this.pendentes.delete(id)) rejeitar(new Error("sem resposta do Edge: " + metodo));
      }, 20000);
    });
  }

  /**
   * Lista os alvos (abas, service workers) que o Edge conhece agora.
   */
  async alvos() {
    const resposta = await fetch("http://127.0.0.1:" + PORTA_CDP + "/json/list");
    return resposta.json();
  }

  /**
   * Acha um alvo pela URL (pedaco dela), esperando ele aparecer.
   *
   * @param {RegExp} padrao
   * @param {number} [tentativas]
   * @returns {Object|null}
   */
  async acharAlvo(padrao, tentativas) {
    for (let i = 0; i < (tentativas || 30); i++) {
      const lista = await this.alvos();
      const achado = lista.find(function (alvo) { return padrao.test(alvo.url); });

      if (achado) return achado;
      await esperar(300);
    }
    return null;
  }

  /**
   * Abre uma sessao num alvo, para rodar codigo dentro dele.
   */
  async sessaoDe(alvo) {
    const resultado = await this.enviar("Target.attachToTarget", {
      targetId: alvo.id || alvo.targetId,
      flatten: true
    });
    const sessao = resultado.sessionId;

    // Service worker recem-acordado fica PARADO esperando o depurador: sem
    // estas duas chamadas, o primeiro Runtime.evaluate nunca responde.
    try {
      await this.enviar("Runtime.enable", {}, sessao);
      await this.enviar("Runtime.runIfWaitingForDebugger", {}, sessao);
    } catch (e) {
      // aba comum: ja esta rodando, nao precisa de nada disso
    }

    return sessao;
  }

  /**
   * Roda JavaScript dentro de uma sessao e devolve o valor.
   *
   * Aceita expressao com await: o codigo entra dentro de uma funcao assincrona.
   */
  async rodar(sessao, codigo) {
    const resultado = await this.enviar("Runtime.evaluate", {
      expression: "(async () => { " + codigo + " })()",
      awaitPromise: true,
      returnByValue: true
    }, sessao);

    if (resultado.exceptionDetails) {
      const erro = resultado.exceptionDetails;
      throw new Error("erro dentro do navegador: " +
        ((erro.exception && erro.exception.description) || erro.text));
    }

    return resultado.result.value;
  }

  /**
   * Abre uma aba no endereco dado e espera a pagina carregar.
   */
  /**
   * Roda JavaScript DENTRO do mundo isolado da extensao numa aba.
   *
   * E a unica forma de chamar, de fora, as funcoes que a extensao usa na
   * pagina (MLMetricsLeitura e companhia): elas nao existem no mundo da
   * pagina, de proposito.
   *
   * @param {Object} aba
   * @param {string} nomeDoMundo nome da extensao, como o navegador o mostra
   * @param {string} codigo
   */
  async rodarNaExtensao(aba, nomeDoMundo, codigo) {
    const mundo = this.contextos.filter((contexto) => {
      return contexto.sessao === aba.sessao && contexto.nome.indexOf(nomeDoMundo) !== -1;
    }).pop();

    if (!mundo) throw new Error("nao achei o mundo isolado da extensao nesta aba");

    const resultado = await this.enviar("Runtime.evaluate", {
      expression: "(async () => { " + codigo + " })()",
      awaitPromise: true,
      returnByValue: true,
      contextId: mundo.id
    }, aba.sessao);

    if (resultado.exceptionDetails) {
      const erro = resultado.exceptionDetails;
      throw new Error("erro dentro da extensao: " +
        ((erro.exception && erro.exception.description) || erro.text));
    }

    return resultado.result.value;
  }

  async abrirAba(url) {
    const { targetId } = await this.enviar("Target.createTarget", { url: url });
    const sessao = await this.sessaoDe({ id: targetId });

    for (let i = 0; i < 40; i++) {
      const pronto = await this.rodar(sessao, "return document.readyState;");
      if (pronto === "complete") break;
      await esperar(250);
    }

    return { targetId: targetId, sessao: sessao };
  }

  async ativarAba(aba) {
    await this.enviar("Target.activateTarget", { targetId: aba.targetId });
  }

  async fecharAba(aba) {
    try {
      await this.enviar("Target.closeTarget", { targetId: aba.targetId });
    } catch (e) {
      // aba ja fechada: nao e problema
    }
  }

  async recarregarAba(aba) {
    await this.rodar(aba.sessao, "location.reload(); return true;");
    await esperar(1200);
  }

  fechar() {
    try { this.socket.close(); } catch (e) { /* ja fechado */ }
    try { this.processo.kill(); } catch (e) { /* ja morreu */ }
  }
}

/**
 * Sobe o Edge com a extensao carregada e conecta no protocolo.
 *
 * @param {Object} opcoes { extensao, porta, headless }
 * @returns {Promise<Navegador>}
 */
async function abrirEdge(opcoes) {
  if (!fs.existsSync(EDGE)) {
    throw new Error("nao achei o Edge em " + EDGE);
  }

  // Perfil NOVO a cada rodada. Reaproveitar o anterior deixava o storage da
  // extensao com o que a rodada passada gravou, e o teste passava a olhar
  // dado velho - chegou a dar "capturou" antes de a pagina carregar.
  const perfil = path.join(pastaDoTeste(), "perfil");
  fs.rmSync(perfil, { recursive: true, force: true });

  const argumentos = [
    "--remote-debugging-port=" + PORTA_CDP,
    "--user-data-dir=" + perfil,
    "--load-extension=" + opcoes.extensao,
    "--disable-extensions-except=" + opcoes.extensao,
    // Desde o Chromium 137 o --load-extension so vale com esta chave.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    // Todo endereco do ML cai no servidor de fixtures deste teste.
    "--host-resolver-rules=MAP *.mercadolivre.com.br 127.0.0.1:" + opcoes.porta,
    "--ignore-certificate-errors",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "about:blank"
  ];

  if (opcoes.headless !== false) argumentos.unshift("--headless=new");

  const processo = spawn(EDGE, argumentos, { stdio: "ignore" });

  let endereco = null;
  for (let i = 0; i < 40; i++) {
    await esperar(400);
    try {
      const resposta = await fetch("http://127.0.0.1:" + PORTA_CDP + "/json/version");
      endereco = (await resposta.json()).webSocketDebuggerUrl;
      if (endereco) break;
    } catch (e) {
      // o Edge ainda esta subindo
    }
  }

  if (!endereco) {
    processo.kill();
    throw new Error("o Edge subiu mas nao abriu o protocolo de depuracao");
  }

  const socket = new WebSocket(endereco);
  await new Promise(function (resolve, rejeitar) {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", function () { rejeitar(new Error("nao conectei no Edge")); });
  });

  const navegador = new Navegador(processo, socket);
  await navegador.enviar("Target.setDiscoverTargets", { discover: true });

  return navegador;
}

module.exports = {
  PORTA_CDP: PORTA_CDP,
  abrirEdge: abrirEdge,
  certificado: certificado,
  esperar: esperar,
  extensaoParaCarregar: extensaoParaCarregar,
  pastaDoTeste: pastaDoTeste
};
