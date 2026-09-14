# CONTEXTO — Revisão da extensão ML Metrics

> Cole este arquivo inteiro no início de uma nova conversa. Ele contém tudo que é
> preciso saber para continuarmos corrigindo os problemas sem refazer a análise.

---

## 1. Quem você é e o que vamos fazer

Você é um engenheiro de software sênior ajudando o Pedro a corrigir, **aos poucos**,
os defeitos de uma extensão de navegador já auditada. A revisão completa **já foi
feita** — está toda na seção 5 deste documento. Não refaça a auditoria do zero: leia
os arquivos relevantes ao item que estamos atacando e parta para a correção.

Cada rodada de trabalho é: **eu escolho um ou mais IDs de problema → você lê o código
envolvido → propõe a correção → aplicamos.**

---

## 2. Regras de trabalho (importantes)

- **Nunca faça commit, push, nem qualquer escrita em git/GitHub.** O Pedro commita
  pessoalmente. Você pode ler `git log` / `git diff`, mas nunca escrever.
- **Não mexa em item que eu não pedi.** Se notar algo novo, aponte no chat e siga com
  o que foi combinado.
- **Não invente refatoração grande.** A base é pequena, sem build, sem dependências e
  sem framework — mantenha assim. JavaScript puro, ES5/ES6 simples, IIFE.
- **Preserve o estilo dos comentários.** O código é fortemente comentado em português
  sem acentos, explicando o *porquê* de cada decisão. Toda alteração precisa manter
  esse padrão, inclusive atualizando o comentário quando o comportamento mudar.
  Comentário que descreve algo que o código não faz mais é defeito.
- **Sem acentos nos comentários de código** (o projeto segue isso). Em texto de
  interface exibido para a usuária, acentos normais.
- **Antes de corrigir, confirme a linha.** Os números de linha deste documento valem
  para o estado do código em 11/09/2026. Depois de cada correção eles saem do lugar.
- **Quem vai usar a extensão não é programadora.** É uma vendedora do Mercado Livre.
  Falha silenciosa é pior que erro visível; número errado com cara de certo é o pior
  cenário de todos.

---

## 3. O projeto

**ML Metrics** — extensão Chrome/Edge (Manifest V3) que mostra métricas de desempenho
(visitas, vendas, conversão, receita estimada) nos anúncios do Mercado Livre de uma
vendedora.

Caminho: `C:\codes\extensaoML`

**Restrição central do projeto:** a API pública do Mercado Livre devolve 403 e
exigiria OAuth ou cookie de sessão. Por isso a extensão **raspa a tela** em vez de
consultar API. Toda a fragilidade descrita abaixo vem daí. A estratégia de raspagem é
por **significado** (achar a palavra "visitas" no texto e pegar o número mais
próximo), não por seletor CSS fixo.

### Arquivos

```
extensaoML/
├── manifest.json            <- manifest DE PRODUCAO (o que vale)
├── INSTRUCOES-CLIENTE.md    <- passo a passo de instalacao para a vendedora
├── icons/                   <- icon16/32/48/128.png (gerados por PowerShell)
├── src/
│   ├── background.js (~46)  SERVICE WORKER (MV3). Faz o fetch das telas
│   │                        aprendidas (sem CORS, com host_permissions).
│   ├── coletor.js (~1129)   CAPTURA. Roda em toda pagina do ML. Acha rotulos
│   │                        no texto, extrai numeros, grava em
│   │                        chrome.storage.local. Onde estavam os piores bugs.
│   ├── content.js (~446)    EXIBE. Le o storage e monta o painel azul na
│   │                        pagina do anuncio. Le o preco da pagina.
│   ├── content.css (~132)   Estilo do painel e do aviso verde.
│   ├── popup.html / popup.js  Painel de controle: lista o capturado, limpa
│   │                        dados, copia diagnostico para o clipboard.
│   └── (sniffer.js REMOVIDO - era codigo morto da Etapa 2, ver #29)
├── teste/
│   ├── publicacoes.html            Fixture da tela "Minhas publicacoes", com gabarito.
│   └── MLB-1111111111-anuncio.html Fixture da pagina de anuncio, com gabarito.
```

### Chaves usadas no `chrome.storage.local`

| Chave | Conteúdo |
|---|---|
| `mlmetrics_dados` | `{ MLB123: { visitas, vendas, capturadoEm } }` — o cache principal |
| `mlmetrics_diagnostico` | amostras de texto colhidas quando a captura falha |
| `mlmetrics_origens` | até 3 URLs de telas de vendedor que já entregaram números |
| `mlmetrics_ultima_busca` | timestamp da última busca automática (trava de 2h) |

### Fluxo

1. `coletor.js` roda em toda página do ML (`document_idle`) e a cada mutação do DOM
   (debounce de 600 ms). Varre os nós de texto com `TreeWalker`, acha rótulos, amarra
   cada número a um código `MLB…`, grava no storage e mostra um toast verde.
2. `content.js` roda na página do anúncio, lê o storage pelo código da URL, lê o preço
   da página e monta o painel azul no canto superior direito.
3. A cada 2 h, o **service worker** (`background.js`) faz `fetch` das URLs aprendidas
   (origem da extensão → sem CORS) e devolve o HTML ao content script, que o parseia
   com o mesmo `varrerPagina` e grava em silêncio (sem toast).

---

## 4. Estado atual

Revisão completa feita em **11/09/2026**. **33 problemas** encontrados e confirmados —
os de parsing foram validados rodando as funções puras em Node, não são teoria.

**Todos os 33 foram corrigidos em 11/09/2026.** A seção 9 (Registro de progresso) lista
o que mudou em cada lote. A lista abaixo (seção 5) fica como referência histórica da
auditoria: os números de linha apontam para o código **antes** das correções.

---

## 5. Os 33 problemas

Formato: `#ID [severidade] título` → onde / causa / impacto.
Mantenha estes IDs estáveis: eu vou me referir a eles pelo número.

---

### GRUPO A — Parsing: números errados lidos como métrica

> **O grupo mais importante.** Todos produzem números plausíveis, passam por todas as
> travas de segurança existentes e se fixam permanentemente no cache. A vendedora não
> tem como perceber que estão errados.

#### #1 [CRÍTICO] A regex não conhece a vírgula decimal — centavos viram métrica

- **Onde:** `src/coletor.js:153` — `Array.from(trecho.matchAll(/\d[\d.]*/g))`
- **Causa:** a regex trata ponto como separador de milhar mas ignora a vírgula. Em
  `R$ 1.299,50` ela casa `"1.299"` e `"50"` como dois números separados, e
  `ultimoNumeroColado` fica com o último.
- **Evidência (saída real das funções do projeto em Node):**
  ```
  "R$ 1.299,50 vendas"              => 50        (deveria ser null)
  "12x R$ 26,65 visitas"            => 65        (deveria ser null)
  "4,5 vendas"                      => 5         (deveria ser null)
  "Publicado em 01.02.2023 visitas" => 1022023   (data virou metrica)
  "Ativo desde 2024 vendas"         => 2024
  ```
- **Impacto:** na tela "Minhas publicações" todo card tem preço. Se o preço cair
  imediatamente antes de um rótulo no `textContent` do ancestral, os centavos viram
  "vendas". `descartarImplausiveis` **não pega** (só descarta se `vendas > visitas`, e
  50 vendas para 359 visitas passa). Pior: como o preço não muda, `mudou()` nunca
  regrava, e a leitura errada se reconfirma para sempre.

#### #2 [CRÍTICO] O TreeWalker varre o conteúdo de `<script>` e `<style>`

- **Onde:** `src/coletor.js:326` — `createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)`
  sem função `acceptNode`.
- **Causa:** `SHOW_TEXT` inclui os nós de texto dentro de `<script>`, `<style>`,
  `<template>` e de elementos com `display:none`. O ML embute JSONs enormes em
  `<script>` (estado pré-carregado, tracking) contendo `"visits"`, `"sold_quantity"`,
  `"vendas"` junto de milhares de números.
- **Impacto duplo:**
  - *Correção:* na tela de métricas de um anúncio só (onde a URL já dá o código e
    `limite = doc.body`), um nó de `<script>` pode virar métrica.
  - *Desempenho:* `numeroAntesDe` faz `texto.toLowerCase()` — cópia inteira da string
    — sobre um JSON de centenas de KB, uma vez por palavra-chave e por nível de
    subida. Trava a aba.

#### #4 [CRÍTICO] `"visualiz"` casa com o botão "Visualizar"

- **Onde:** `src/coletor.js:41` — `visitas: ["visita", "visualiz"]`
- **Causa:** toda tela de vendedor tem "Visualizar anúncio". O mesmo vale para
  `"venda"`, que casa com "À venda", "Sem vendas", "Venda finalizada".
- **Evidência:** `"Estoque 12 Visualizar" | visualiz => 12`
- **Impacto:** o número colado antes do botão (estoque, quantidade, posição na lista)
  vira "visitas totais". Falso positivo muito provável na tela alvo.

#### #23 [BAIXO] `temLetra` tem um intervalo Unicode torto

- **Onde:** `src/coletor.js:177` — `/[a-zA-ZÀ-ú]/`
- **Causa:** o intervalo `À-ú` (U+00C0–U+00FA) **inclui** `×` (U+00D7) e `÷` (U+00F7),
  que não são letras, e **exclui** `ü` (U+00FC), `ý`, `ÿ`.
- **Evidência:** `temLetra('ü') => false` · `temLetra('×') => true`
- **Impacto:** baixo, mas é a função que decide se o número "está colado" no rótulo —
  o coração da heurística. Um `×` ("12 × 50 cm") bloqueia leitura válida.

#### #24 [BAIXO] `numeroAntesDe` só olha a primeira ocorrência do rótulo

- **Onde:** `src/coletor.js:111` — `texto.toLowerCase().indexOf(palavra)`
- **Evidência:** `"visitas 10, total de visitas 5000" => 10`
- **Impacto:** com dois recortes da mesma métrica no mesmo bloco, a regra do "maior
  valor" (`coletor.js:370`) nunca chega a ser aplicada.

---

### GRUPO B — Escopo: número atribuído ao anúncio errado

#### #3 [CRÍTICO] `valorDoRotulo` pode buscar o número em qualquer lugar da página

- **Onde:** `src/coletor.js:295` — laço `for (let nivel = 0; nivel < 5 && atual; …)`
- **Causa:** sobe até 5 níveis lendo `atual.textContent`. Quando o código veio da URL
  (`coletor.js:205`), `limite = doc.body`, e em páginas rasas 5 níveis chegam ao
  `<body>`. Aí `numeroAntesDe` roda sobre o texto da página inteira.
- **Impacto:** métrica vinda de região não relacionada apresentada como dado do
  anúncio — exatamente o modo de falha que o comentário do código diz prevenir.
- **Relacionado:** `MAX_NIVEIS = 12` (`coletor.js:28`) para achar o card, mas só `5`
  para achar o valor. Card a 7 níveis do rótulo = contexto achado, número perdido, sem
  erro nenhum.

#### #7 [ALTO] Código de anúncio vindo da URL sequestra a página inteira

- **Onde:** `src/coletor.js:205` — `const naUrl = url.match(PADRAO_CODIGO)`
- **Causa:** testa a URL **antes** de tudo, usando a URL completa com query string. Se
  a tela de listagem carregar um `MLB…` em qualquer parâmetro (`?item_id=MLB123`,
  retorno de filtro), todas as métricas de todos os cards são atribuídas àquele único
  código, com `limite = body`.
- **Impacto:** como a regra é "fica com o maior valor" (`coletor.js:370`), o maior
  número da página inteira vira a métrica desse anúncio.

#### #10 [ALTO] `ehPaginaDeCompra` é trava frágil e cara

- **Onde:** `src/coletor.js:560` — `doc.body.textContent.toLowerCase()` procurando
  `"adicionar ao carrinho"` / `"comprar agora"`
- **Impacto:**
  - *Falso positivo:* se essas strings aparecerem em `<script>` ou template oculto da
    tela de vendedor (provável — o ML reusa componentes), o coletor **desliga
    completamente** na tela alvo. Sintoma: "não aparece nada", sem erro.
  - *Falso negativo:* se o ML trocar o texto do botão, a reputação do vendedor
    (`+1.000 vendas`) contamina o anúncio — bug que já aconteceu antes.
  - *Custo:* cópia em minúsculas do texto de toda a página, **incluindo os JSONs dos
    `<script>`**, a cada varredura debounced. Megabytes de string a cada 600 ms.

---

### GRUPO C — Manifest, empacotamento e privacidade

#### #5 [CRÍTICO] `file:///*` nos `matches` do manifest de produção

- **Onde:** `manifest.json:16` —
  `"matches": ["https://*.mercadolivre.com.br/*", "file:///*"]`
- **Causa:** configuração de teste que foi para o pacote do cliente.
- **Impacto (quatro frentes):**
  - *Privacidade:* `coletor.js` é injetado em **todo arquivo local que ela abrir**.
    `salvarDiagnostico` grava trechos desse conteúdo no storage, e o botão "Copiar
    diagnóstico" põe tudo no clipboard para ela colar numa conversa.
  - *Crash:* em XML/SVG abertos direto, `document.body` é `null` → `coletor.js:561`
    (`doc.body.textContent`) e `coletor.js:770`
    (`observador.observe(document.body, …)`) lançam `TypeError` não tratado.
  - *Cache poluído:* abrir `teste/publicacoes.html` grava `MLB1111111111` etc. no
    cache real, misturado com os anúncios verdadeiros.
  - *Origens poluídas:* `lembrarOrigem` (`coletor.js:585`) não filtra protocolo, então
    uma URL `file:///…` ocupa um dos 3 slots.

#### #14 [MÉDIO] Pasta `extensaoML/` duplicada dentro do projeto

- **Onde:** `extensaoML/extensaoML/` — cópia antiga completa (Etapa 1): manifest,
  `content.js` com painel de placeholder, `content.css`, `sniffer.js`.
- **Causa:** `INSTRUCOES-CLIENTE.md` manda selecionar "a pasta que contém o
  `manifest.json`" — **existem duas**.
- **Impacto:** se ela escolher a errada, instala a versão antiga, que carrega
  `sniffer.js` com `"world": "MAIN"`: `window.fetch` e `XMLHttpRequest.prototype`
  monkeypatched em toda página do ML, corpos de resposta (até 3000 chars) no console —
  incluindo dados de conta e tokens — e `window.__mlmetricsUrls` crescendo sem limite
  (vazamento de memória).

#### #15 [MÉDIO] Bug no `sniffer.js` que pode quebrar o site do ML

- **Onde:** `src/sniffer.js:89` — `fetchOriginal.apply(this, args)`
- **Causa:** se a página fizer `const f = window.fetch; f(url)` (padrão comum em
  bundlers), `this` é `undefined` e o `apply` lança `TypeError: Illegal invocation`. O
  correto seria `apply(window, args)`.
- **Impacto:** requisições do próprio ML falhando. Não está no manifest de produção,
  mas está no pacote e é carregado pelo manifest da pasta duplicada (#14).
- **Menor, mesmo arquivo:** `sniffer.js:132` adiciona um listener `load` a cada
  `send()` — XHR reaproveitado acumula listeners.

#### #20 [MÉDIO] O diagnóstico captura mais do que o comentário promete

- **Onde:** `src/coletor.js:723` — `no.parentElement.textContent.trim().slice(0, 160)`
- **Causa:** grava **160 caracteres arbitrários** do elemento em volta, não só o
  rótulo. O comentário afirma "não o conteúdo da página nem nada da conta de quem
  usa", mas na tela de vendedor esse recorte pode incluir título do anúncio, preço,
  nome de comprador, número de pedido — e isso vai para o clipboard.
- **Relacionado:** `coletor.js:738` grava `url: href.split("?")[0]` — o **path** ainda
  pode conter identificador de vendedor.
- **Relacionado 2:** `coletor.js:578` — o diagnóstico é **sobrescrito** toda vez que
  uma página sem métricas é varrida. A amostra útil é apagada assim que ela navega
  para a home. Na prática o diagnóstico quase sempre chega vazio ou irrelevante.

#### #29 [BAIXO] Manifest incompleto

- **Onde:** `manifest.json`
- **Causa:** sem `"icons"` e sem `"action.default_icon"` (navegador mostra o ícone
  genérico de quebra-cabeça, dificultando achar a extensão). Sem `host_permissions`
  (ver #6). `sniffer.js` está no pacote mas não é referenciado — código morto
  embarcado.

#### #32 [BAIXO] Documentação com afirmação imprecisa

- **Onde:** `INSTRUCOES-CLIENTE.md` — *"Ela não acessa sua conta de fora nem envia nada
  para lugar nenhum."*
- **Causa:** a segunda metade é verdadeira. A primeira não: `atualizarEmSegundoPlano`
  faz requisições autenticadas à conta dela a cada 2 h, com os cookies de sessão, sem
  ação dela.
- **Impacto:** promessa ao cliente que o código não cumpre. Vale mencionar também que
  fetches automáticos repetidos podem, em tese, disparar detecção de bot do ML.

---

### GRUPO D — Rede e ciclo de vida

#### #6 [CRÍTICO] A atualização automática provavelmente nunca funciona (CORS)

- **Onde:** `src/coletor.js:661` — `fetch(url, { credentials: "include" })` a partir de
  um content script.
- **Causa:** no Manifest V3 o `fetch` de content script é tratado como originado da
  **página**, sujeito a CORS, e o manifest não declara `host_permissions` nenhum.
  - página `www.mercadolivre.com.br` → origem igual: funciona.
  - página `produto.mercadolivre.com.br` → `www.mercadolivre.com.br`: **origens
    diferentes**, bloqueado. Com `credentials: "include"` exigiria
    `Access-Control-Allow-Credentials` + origem explícita, que o ML não manda.
- **Impacto:** a funcionalidade só funciona por acidente, quando ela está no subdomínio
  exato da origem guardada. O `.catch()` vazio garante que ninguém descobre — falha
  100% silenciosa.
- **Correção real:** mover para um service worker com `host_permissions`.

#### #13 [ALTO] Zero tratamento de erro nas chamadas `chrome.*`

- **Onde:** `coletor.js`, `content.js`, `popup.js` — nenhum `chrome.runtime.lastError`
  verificado, nenhum `try/catch` em volta do `chrome.storage`.
- **Impacto:** quando a extensão é recarregada em `chrome://extensions` (algo que a
  cliente vai fazer — está nas instruções), as abas do ML já abertas ficam com scripts
  órfãos. Toda chamada a `chrome.storage` lança `"Extension context invalidated"`. Como
  o MutationObserver e o `setInterval` continuam rodando, o console enche de exceções
  **a cada 600 ms / 1 s, para sempre**. Quota estourada também falha em silêncio.

#### #17 [MÉDIO] A lista de origens se enche de URLs inúteis

- **Onde:** `src/coletor.js:585` — `lembrarOrigem(window.location.href)`
- **Causa:** chamada em toda coleta bem-sucedida, inclusive na tela de métricas de
  **um** anúncio (cuja URL contém o MLB). Só cabem 3, ordem "mais recente primeiro".
- **Impacto:** visitar três anúncios individuais **expulsa a URL de "Minhas
  publicações"** — a única que valeria a pena revisitar. A funcionalidade se
  autossabota.

#### #21 [MÉDIO] Sobrescrita concorrente entre abas

- **Onde:** `src/coletor.js:462` e `:606` — padrão `get` → modificar → `set`, não
  atômico. Também `:646` (`CHAVE_ULTIMA_BUSCA`).
- **Impacto:** duas abas do ML salvando ao mesmo tempo: a segunda escreve por cima do
  objeto inteiro, perdendo o que a primeira gravou. E as duas podem passar juntas pela
  trava de frequência de 2 h.

---

### GRUPO E — Desempenho

#### #11 [ALTO] Loop de realimentação entre o aviso e o MutationObserver

- **Onde:** `src/coletor.js:518` (`avisarNaTela`) + `:762` (observer)
- **Causa:** `avisarNaTela` faz `appendChild` no body → o observer dispara →
  `coletar()` roda de novo (varredura completa). O `remove()` 4 s depois dispara outra.
  O corte de `mudou()` impede a *gravação*, mas não impede a *varredura*, que é a parte
  cara.
- **Agravante:** `coletor.js:571-579` — quando nada é capturado, `salvarDiagnostico()`
  grava no storage. Numa página do ML com DOM inquieto (carrosséis, lazy load,
  banners), isso vira **uma gravação no `chrome.storage` a cada 600 ms**,
  indefinidamente, em toda aba aberta.

#### #12 [ALTO] Complexidade quadrática na tela de listagem

- **Onde:** `src/coletor.js:355` — `contextoDoAnuncio` chamado **dentro** do laço de
  palavras, recalculado para cada sinônimo do mesmo rótulo. E ele faz
  `querySelectorAll('a[href*="MLB"]')` (`coletor.js:250`) em **cada um dos até 12
  níveis** de ancestral, sobre subárvores cada vez maiores.
- **Impacto:** com 50 cards × ~4 nós de texto com rótulo × 5 palavras × 12 níveis, são
  milhares de `querySelectorAll` sobre o documento quase inteiro. Travamento
  perceptível exatamente na tela de "Minhas publicações".

---

### GRUPO F — Exibição e experiência da usuária

#### #8 [ALTO] `capturadoEm` mente sobre a idade do dado

- **Onde:** `src/coletor.js:472-493`
- **Causa:** só os códigos cujos números **mudaram** são regravados, e `capturadoEm` só
  é atualizado dentro desse `forEach`.
- **Impacto:** um anúncio estável nunca tem a data renovada. Depois de 3 dias o painel
  exibe *"dados de N dias atrás — abra Minhas publicações para atualizar"* com destaque
  amarelo, mesmo tendo sido reconferido há 5 minutos. Ela vai abrir "Minhas
  publicações", o aviso não vai sumir, e vai concluir que a extensão está quebrada.
- **Inverso:** se `visitas` veio de hoje e `vendas` de 10 dias atrás, o merge do
  `Object.assign` carimba um único `capturadoEm = agora` nos dois. Dado velho
  apresentado como novo — o oposto do que o código diz querer.

#### #9 [ALTO] Condição de corrida na navegação SPA

- **Onde:** `src/content.js:344-352` — poller de 1 s agenda `setTimeout(atualizar, 500)`,
  e `atualizar` lê o storage de forma assíncrona.
- **Causa:** ao navegar rápido entre dois anúncios, duas chamadas ficam em voo. Não há
  cancelamento nem verificação de que a URL ainda é a mesma quando o callback retorna.
- **Impacto:** se o callback do anúncio A resolver depois do de B, `montarPainel` remove
  o painel de B e desenha o de A. Painel exibindo métricas do produto anterior sobre a
  página do produto atual. Erro invisível.

#### #16 [MÉDIO] `lerPreco` pega o primeiro preço da página

- **Onde:** `src/content.js:78` —
  `document.querySelector(".andes-money-amount__fraction")`
- **Causa:** devolve a **primeira** ocorrência, que na página do ML costuma ser o preço
  riscado (antes do desconto) ou o valor da parcela ("12x R$ 26,65"). O `parseInt` ainda
  descarta os centavos.
- **Impacto:** "Receita estimada" errada por uma ordem de grandeza quando o
  `<meta itemprop="price">` não existe.

#### #18 [MÉDIO] `montarPainelVazio` aparece em qualquer anúncio do ML

- **Onde:** `src/content.js:319` — não há verificação de que o anúncio é dela.
- **Impacto:** navegando no ML como compradora, ela vê a caixa azul *"Sem dados deste
  anúncio ainda. Abra 'Minhas publicações'…"* sobre **todo** produto que abrir. Ruído
  constante, e sugere uma ação que nunca vai resolver.

#### #19 [MÉDIO] Conversão de 0% é exibida como "sem dado"

- **Onde:** `src/content.js:156` — `temAmbos = (visitas > 0 && vendas > 0)`
- **Impacto:** um anúncio com 500 visitas e 0 vendas mostra "—" na conversão. O caso que
  mais precisa de atenção é o que o painel se recusa a informar. `0%` é um dado, não uma
  ausência.

#### #25 [BAIXO] `id` duplicado no aviso verde

- **Onde:** `src/coletor.js:518` — `avisarNaTela` cria `<div id="mlmetrics-aviso">` sem
  remover o anterior. A busca em segundo plano trata 3 origens em paralelo.
- **Impacto:** até 3 elementos com o mesmo `id` empilhados na mesma posição `fixed`.
  HTML inválido; `getElementById` só enxerga o primeiro.

#### #26 [BAIXO] Aviso verde em página que não é de coleta

- **Onde:** `salvar()` é compartilhado entre a coleta local e a busca em segundo plano
  (`coletor.js:661`).
- **Impacto:** o toast "N anúncio(s) atualizado(s)" aparece enquanto ela está numa
  página de produto qualquer, sem relação com o que está vendo.

#### #27 [BAIXO] Sobreposição do painel sem como fechar

- **Onde:** `src/content.css:3` — `position: fixed; top: 90px; right: 16px; z-index:
  999999`, sem botão de fechar.
- **Impacto:** bloqueia cliques nos controles do ML naquela região (carrinho,
  notificações, menu da conta). Não há como dispensar o painel.

#### #31 [BAIXO] Sem refresh reativo do painel

- **Onde:** `src/content.js` não escuta `chrome.storage.onChanged`.
- **Impacto:** se a coleta acontecer com a página do anúncio já aberta, o painel só
  atualiza se a URL mudar.

---

### GRUPO G — Higiene

#### #22 [BAIXO] Regra de CSS que nunca se aplica

- **Onde:** `src/content.css:50` — `#mlmetrics-painel .mlmetrics-linha:last-of-type`
- **Causa:** `:last-of-type` compara por **tipo de elemento** (`div`), não por classe. O
  último `div` filho do painel é o `.mlmetrics-status` (rodapé), então nenhuma
  `.mlmetrics-linha` satisfaz o seletor.
- **Impacto:** a última métrica ("Receita estimada") mantém a linha divisória, que fica
  flutuando logo acima do rodapé. Só cosmético.

#### #28 [BAIXO] Parâmetro morto

- **Onde:** `src/content.js:211` — `montarPainel(codigo, metricas, capturadoEm)` nunca
  usa `codigo`.

#### #30 [BAIXO] `clipboardWrite` não declarado

- **Onde:** `src/popup.js:109` — `navigator.clipboard.writeText` a partir do popup.
- **Impacto:** funciona em Chrome recente com gesto do usuário, mas é historicamente
  instável em popups (que perdem foco facilmente) e a permissão não está no manifest. O
  `.catch` mostra "Não consegui copiar", então falha graciosamente — mas é o caminho
  principal de diagnóstico.

#### #33 [BAIXO] `.git/.MERGE_MSG.swp` no repositório

- Arquivo de swap do Vim, resquício de um merge interrompido. Só sujeira.

---

### GRUPO H — Descobertas em 14/09/2026 (pegando a página real)

> A cliente/Pedro salvou a página real `teste/MLreal.html` (908 KB). Não é
> "Minhas publicações" — é a **vitrine pública** de um anúncio da estrutura
> nova (`www.mercadolivre.com.br/…/up/MLBU5098517614`). Ainda assim pegou dois
> defeitos que a auditoria de 11/09 não cobriu porque **nunca tinha visto a
> tela real**. Números de linha valem para o código antes das correções de hoje.

#### #34 [CRÍTICO] Vitrine `/up/` e `/p/` no host `www` escapa do `ehPaginaDeCompra`

- **Onde:** `src/coletor.js:783` — `ehPaginaDeCompra` só olhava
  `produto.mercadolivre` / `articulo.mercadolivre`.
- **Causa:** a estrutura nova mora em `www.mercadolivre.com.br/…/up/MLBU…` e o
  catálogo em `…/p/MLB…` — hosts que as telas de vendedor TAMBÉM usam. Como a
  URL da vitrine tem o código do produto no **caminho**, `contextoDoAnuncio`
  assumia a página inteira como dele (`limite = doc.body`) e capturava
  QUALQUER número com cara de métrica.
- **Evidência (painel real salvo na página):** o produto tem 1 venda
  ("Novo | 1 vendido"), e o painel mostrava **Vendas: 1.000 / Receita
  estimada: R$ 19.900,00** — o "+1000 vendidos" de OUTRO produto na faixa
  "Mais vendidos" foi atribuído a ele. Número errado com cara de certo,
  exatamente o pior cenário do projeto, acontecendo de verdade.
- **Correção (hoje):** `ehPaginaDeCompra(url)` agora recebe a URL e detecta a
  vitrine por host **ou** pelas rotas `/up/MLB…` e `/p/MLB…` no fim do caminho
  (marca que telas de vendedor não têm). Fica coberto por teste no harness.

#### #35 [ALTO] Painel imprimia "Vende a cada: NaN visitas"

- **Onde:** `src/content.js:189` — `visitasPorVenda: temVendas ? Math.round(visitas/vendas) : null`.
- **Causa:** quando o cache tem `vendas` mas **nenhuma** `visitas` (a captura
  por telas nem sempre pega as duas — foi o que a página real mostrou),
  `Math.round(undefined / vendas)` = `NaN`; e `NaN !== null` passava na
  montagem e virava texto "NaN visitas".
- **Correção (hoje):** `visitasPorVenda` exige `visitas > 0` além de
  `vendas > 0`. Coberto por teste.

#### #36 [CRÍTICO] Coleta em páginas públicas (não-seller)

- **Onde:** `src/coletor.js` — `varrerPagina` aceitava QUALQUER página do ML.
- **Causa:** o coletor diferencia telas pelo vocabulário: página pública
  (busca, categoria, vitrine) mostra "vendido"/"vendas" de OUTROS vendedores
  aos montes; "visita" só existe em tela que acompanha o anúncio de quem
  vende. Sem essa diferença em jogo, uma busca pública virava "coleta" e
  enchia o cache com números de produtos alheios (dados públicos — não vaza
  nada —, mas polui o diagnóstico e o painel da vendedora).
- **Correção (hoje):** `paginaMencionaVisita(doc)` — primeira passada barata
  com os MESMOS guardas da varredura principal (sem script/style/template e
  ignorando o próprio painel `#mlmetrics-painel`); se a página não menciona
  "visita", `varrerPagina` retorna `{}` antes de começar. A guarda do painel é
  essencial: sem ela, o próprio painel ("Visitas totais") credenciaria uma
  página pública como tela de vendedor.
- **Teste:** stub de DOM fiel (só as APIs que o coletor usa: `textContent`,
  `closest`, `querySelectorAll`, `getAttribute`, `parentElement`) no harness —
  tela de vendedor entrega números, vitrine pública não entrega nada, painel
  não credencia página pública, painel não interfere em tela de vendedor real.
  Substitui as fixtures reais até chegarem; 78/78 PASS.

---

## 6. Leitura de conjunto (o diagnóstico de fundo)

A arquitetura está certa e os comentários mostram que o risco correto foi antecipado:
atribuir número ao anúncio errado. O problema é que **as defesas construídas
(`descartarImplausiveis`, `ehPaginaDeCompra`, o limite do card) não cobrem o modo de
falha que realmente vai acontecer**: preço lido como métrica (#1), `<script>` lido como
texto visível (#2) e "Visualizar" lido como "visualizações" (#4). Os três produzem
números plausíveis, passam por todas as travas e se fixam no cache.

---

## 7. Ordem de correção sugerida

| Lote | IDs | Por quê |
|---|---|---|
| **1 — Empacotamento** | #5, #14, #29, #33 | Minutos de trabalho, elimina risco de privacidade e de instalação errada. Ganho imediato. |
| **2 — Parsing** | #1, #2, #4, #23, #24 | Elimina a maior parte dos números errados. É o coração do produto. |
| **3 — Escopo** | #3, #7, #10 | Fecha o resto dos casos de número atribuído ao anúncio errado. |
| **4 — Confiança** | #8, #9, #19, #16, #18 | O que a usuária percebe como "quebrado" mesmo quando funciona. |
| **5 — Robustez** | #13, #11, #12, #21 | Para de encher o console de erro e de travar a tela de listagem. |
| **6 — Rede** | #6, #17, #20, #32 | Exige decisão de arquitetura (service worker). Deixar por último. |
| **7 — Acabamento** | #15, #22, #25, #26, #27, #28, #30, #31 | Cosmético e código morto. |

Um teste que valeria a pena antes do lote 2: capturar o HTML real de uma tela de "Minhas
publicações" e transformar em fixture no `teste/`. Hoje as fixtures foram escritas **sem
nunca ter visto a tela real** — é a premissa mais frágil do projeto, e os próprios
comentários do código admitem isso.

---

## 8. Como me pedir para trabalhar

Exemplos do que dizer numa nova conversa, depois de colar este arquivo:

- `"vamos no lote 1"`
- `"resolve o #1 e o #4"`
- `"me mostra como você corrigiria o #2 antes de aplicar"`
- `"o #6 vale a pena ou a gente desliga a atualização automática?"`

O que eu espero de você em cada rodada:

1. Ler o trecho de código real (os números de linha podem ter mudado).
2. Explicar a correção em uma ou duas frases antes de escrever código.
3. Aplicar mantendo o padrão de comentários do projeto.
4. Dizer o que **não** foi corrigido junto e por quê.
5. Nunca commitar.

---

## 9. Registro de progresso

Atualize esta tabela conforme formos resolvendo, para a próxima janela saber onde
paramos.

| Lote | Status | Data | Observações |
|---|---|---|---|
| 1 — Empacotamento | ✅ feito | 11/09/2026 | #5, #14, #29. #33 ja nao existia (não achei .swp). |
| 2 — Parsing | ✅ feito | 11/09/2026 | #1, #2, #4, #23, #24. Datas foram além do #1: nova funcao `ehData`. Validado em Node (test_parsing), TODOS PASSARAM. |
| 3 — Escopo | ✅ feito | 11/09/2026 | #3, #7, #10. |
| 4 — Confiança | ✅ feito | 11/09/2026 | #8, #9, #19, #16, #18. Limite conhecido do #8: merge ainda carimba data unica (por anuncio, nao por metrica). |
| 5 — Robustez | ✅ feito | 11/09/2026 | #13, #11, #12, #21. A fila `comCache` serializa get/set na mesma aba; entre abas a corrida persiste (nao resolvido - o SW do #6 moveu so o fetch, nao a escrita). |
| 6 — Rede | ✅ feito | 11/09/2026 | #6 (fetch movido p/ service worker c/ host_permissions), #17 (origens nao guardam URL de anuncio isolado), #20 (diagnostico so guarda janela do rotulo), #32 (INSTRUCOES sincera). sniffer.js removido (era item do #29). |
| 7 — Acabamento | ✅ feito | 11/09/2026 | #15, #22, #25, #26, #27, #28, #30, #31. #15 em sniffer (fora do manifest prod.). #25 ja feito no #11. |
| 8 — Arremate | ✅ feito | 14/09/2026 | Criado `teste/test-parsing.js` (harness Node, 52 casos, TODOS PASS, exit 0): cobre #1/#4/#23/#24, o gabarito das fixtures, os formatos MLB e a regra "desde". `.git/.MERGE_MSG.swp` — o do #33 EXISTIA de verdade (dentro de `.git/`, por isso nao foi achado antes) — apagado. Comentario `coletor.js:569` tipado. **Residuo do #1 resolvido com regra estreita**: `ehAnoPosDesde` rejeita ano solto (1900–2099) só quando precedido imediatamente de "desde" ("Ativo desde 2024 vendas" → null); "2024 vendas" sem "desde" continua valendo. Regra nova e reversível — observar se a tela real mostra "desde" antes de métrica real (improvável). |
| 9 — Sanidade | ✅ feito | 14/09/2026 | `node --check` em todos os JS, `manifest.json` validado, 4 ícones são PNG reais e não vazios. |
| 10 — Página real | ✅ feito | 14/09/2026 | A cliente salvou `teste/MLreal.html` (vitrine `/up/` real, não é "Minhas publicações"). **#34** (vitrine `/up/` e `/p/` no host `www` escapava do `ehPaginaDeCompra` → capturava "+1000 vendidos" de outro produto; painel real mostrou 1.000 vendas / R$ 19.900 para 1 venda) e **#35** ("Vende a cada: NaN visitas") corrigidos e cobertos no harness (agora 69/69 PASS). **PENDENTE — PRIVACIDADE:** `MLreal.html` + `MLreal_files/` têm dados reais (nomes de produto, vendedor, JSONs de sessão) — **não commitar**; descartar ou transformar em fixture sanitizada. |
| 11 — Privacidade | ✅ feito | 14/09/2026 | Auditoria de vazamento: **a única requisição de rede da extensão é o `fetch` do background para telas de vendedor aprendidas (domínios do ML, com a sessão dela)** — nada de analytics/beacon/imagem remota, manifest não permite código remoto. Blindagens aplicadas: (1) diagnóstico agora grava só `window.location.hostname` (antes guardava caminho, que pode ter código de produto/vendedor); (2) criado `.gitignore` com `teste/MLreal*` para página real nunca entrar no repo. O que sai do computador (via "Copiar diagnóstico", manualmente) = códigos MLB + números + hostname + amostras de texto. |
| 12 — Coleta só em tela de vendedor | ✅ feito | 14/09/2026 | **#36** — `paginaMencionaVisita(doc)` + desvio cedo em `varrerPagina`: página pública (só "vendido") não entrega número nenhum. Stub de DOM fiel (sem dependência externa) no harness cobrindo o caso real de `/up/` — agora **78/78 PASS**. Pedido da cliente após esclarecer a política de privacidade ("não quero que nenhum dado vaze"): a trava é por comportamento (vocabulário "visita"), não por URL adivinhada — então quando a tela real de "Minhas publicações" chegar, se ela tiver "visitas", a captura continua funcionando sem eu ter chutado endereço. |
| 13 — Prova empírica no arquivo real | ✅ feito | 14/09/2026 | Varri o texto visível de `MLreal.html` (sem script/style/template): **41 menções a venda/vendido e ZERO a "visita" fora do painel**. As únicas 2 "visita" da página estão DENTRO de `<div id="mlmetrics-painel">` (texto que a própria extensão injetou e que a trava ignora). Ou seja: no único dado real que temos, a premissa da trava bate, com dupla proteção (a URL `/up/` já para antes, e o gate segura os "+N vendidos"). Criei `teste/vitrine-up-sanitizada.html`, fixture **commitável** com a estrutura real do `/up/` e valores fictícios, para o corpus de teste não depender da página privada. |
| 14 — Elo de diagnóstico remoto | ✅ feito | 14/09/2026 | A 3ª tentativa de arquivo real (`testenomantereal.html`) veio **de novo como vitrine pública** (`/up/`) — segunda confirmação de que a tela de vendedor nunca foi capturada. Solução estrutural (Pedro autorizou resolver): o "Copiar diagnóstico" do popup agora inclui **`origens`** (URLs das telas de vendedor já reconhecidas, que o coletor guardava mas o relatório não trazia). Zero permission nova, zero reload, zero dado novo — o endereço real de "Minhas publicações" chega ao diagnóstico pelo fluxo de sempre. E o guia da cliente ganhou a seção **"Atalho: em vez de print, Copiar diagnóstico"** (cliente na tela → ícone → copiar → colar). |
| 15 — Clipboard à prova de falhas | ✅ feito | 14/09/2026 | O usuário relatou "Ctrl+V sem nada": a cópia automática do popup falhou em algum momento (clipboard bloqueado/sem foco). Agora o relatório **sempre** aparece num `<textarea>` selecionado dentro do popup — o clipboard é só atalho; se falhar, a pessoa copia na mão (Ctrl+C) ou lê o texto. E `INSTRUCOES-CLIENTE.md` ganhou a seção **"Depois de uma atualização" (recarregar a extensão)** — mudança de código só tem efeito após o reload no `edge://extensions`. |
| 16 — Diagnóstico real: cache poluído e build antigo | ✅ feito | 14/09/2026 | O 1º "Copiar diagnóstico" real veio. Provas: (a) **build antigo ativo** — diagnóstico com URL completa + query e `MLBU5098517614 = vendas 1000` recém-capturado: o bug #34 ainda rodava no navegador; (b) **137 anúncios no cache, TODOS sem `visitas`**, com `origens` só na homepage — o coletor nunca viu a tela de vendedor e encharcou o cache de chips públicos ("+1.000 vendidos") atribuídos a produtos alheios. Correção estrutural: além de "a página menciona visita", agora **é preciso ter lido ao menos uma VISITA** (`leuVisitas` em `varrerPagina`) — tela de vendedor sempre mostra visitas; página pública (banner, homepage, busca) nunca produz. Caso real vira teste no harness ("banner com 'visita', só vendas: nada") → **79/79**. `manifest.json` subiu para **0.1.1** (a versão no próximo diagnóstico prova que o reload aconteceu). **AÇÃO PENDENTE (usuário):** recarregar a extensão, confirmar versão 0.1.1, **Limpar dados guardados** (apaga as 137 leituras falsas), e aí sim testar "Minhas publicações". |
