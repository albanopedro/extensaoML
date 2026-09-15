# CONTEXTO — Revisão da extensão ML Metrics

> Cole este arquivo inteiro no início de uma nova conversa. Ele contém tudo que é
> preciso saber para continuarmos corrigindo os problemas sem refazer a análise.
>
> **Atualizado em 15/09/2026, depois do lote 21 (robustez geral).** O que falta fazer está
> na **seção 5**. O que já foi feito está resumido e sinalizado na **seção 6**.

---

## 1. Quem você é e o que vamos fazer

Você é um engenheiro de software sênior ajudando o Pedro a corrigir, **aos poucos**,
os defeitos de uma extensão de navegador já auditada. Houve **duas revisões completas**
(11/09 e 14/09/2026). Não refaça a auditoria do zero: leia os arquivos relevantes ao
item que estamos atacando e parta para a correção.

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
- **Antes de corrigir, confirme a linha.** Os números de linha da seção 5 valem para o
  estado do código em **15/09/2026, depois do lote 21**. Depois de cada correção eles
  saem do lugar.
- **Toda correção entra com caso no harness** (`node teste/test-parsing.js`) quando a
  função for testável fora do navegador. Ver #53.
- **Nunca coloque dado real no repositório** (código MLB, título ou slug de produto,
  nome de vendedor). Use valores fictícios como `MLB1234567890` / `MLBU0000000001`.
  O repositório é público (ver #50).
- **Quem vai usar a extensão não é programadora.** É uma vendedora do Mercado Livre.
  Falha silenciosa é pior que erro visível; número errado com cara de certo é o pior
  cenário de todos.

---

## 3. O projeto

**ML Metrics** — extensão Chrome/Edge (Manifest V3) que mostra métricas de desempenho
(visitas, vendas, conversão, receita estimada) nos anúncios do Mercado Livre de uma
vendedora.

Caminho: `C:\codes\extensaoML` · versão no manifest: **0.1.4**

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
├── empacotar.ps1            <- gera dist\ML-Metrics-<versao>.zip (so manifest,
│                               icons e src). E ESTE zip que vai para a cliente.
├── icons/                   <- icon16/32/48/128.png
├── src/
│   ├── background.js (~93)  SERVICE WORKER (MV3). Faz o fetch das telas
│   │                        aprendidas (so https no dominio do ML, so a
│   │                        pedido da extensao, com tempo limite).
│   ├── coletor.js (~1790)   CAPTURA. Roda em toda pagina do ML. Le cada
│   │                        rotulo pela fila de numeros e rotulos e grava em
│   │                        chrome.storage.local COM o rastro de origem de
│   │                        cada numero. Responde o diagnostico do popup,
│   │                        inclusive por que cada numero foi recusado.
│   ├── content.js (~756)    EXIBE. Acha o codigo do item na URL, le o
│   │                        storage e monta o painel azul - so com numero
│   │                        que tem rastro. Preco so de dado estruturado.
│   ├── content.css (~132)   Estilo do painel e do aviso verde.
│   └── popup.html / popup.js (~325)  Painel de controle: lista o capturado
│                            com a origem de cada numero, limpa dados, copia
│                            diagnostico da aba aberta.
├── teste/
│   ├── test-parsing.js             Harness Node (159 casos, 159/159 PASS em 15/09).
│   ├── publicacoes.html            Fixture da tela "Minhas publicacoes", com gabarito.
│   ├── MLB-1111111111-anuncio.html Fixture da pagina de anuncio, com gabarito.
│   ├── vitrine-up-sanitizada.html  Fixture sanitizada da vitrine /up/ real.
│   └── MLreal* / testenomantereal* PAGINAS REAIS - no .gitignore, NAO commitar
│                                   e NAO enviar para a cliente.
└── dist/                    <- zips gerados (no .gitignore)
```

### Chaves usadas no `chrome.storage.local`

Todas começam com `mlmetrics_`. O botão "Limpar dados guardados" apaga pelo prefixo.

| Chave | Conteúdo |
|---|---|
| `mlmetrics_dados` | `{ MLB123: { visitas, vendas, capturadoEm, origem: { visitas: { trecho, tela, em, automatica }, vendas: {…} } } }` — o cache principal. Número sem `origem` não é exibido. |
| `mlmetrics_diagnostico` | `{ host, caminho (mascarado), quando, amostras }` — gravado quando a captura falha |
| `mlmetrics_origens` | até 3 URLs (sem query) de telas de vendedor que já entregaram números |
| `mlmetrics_ultima_busca` | timestamp da última busca automática (trava de 2 h) |

### Fluxo

1. **`coletor.js`** roda em toda página do ML (`document_idle`) e a cada mutação do
   DOM — inclusive texto e link trocados no lugar (debounce de 600 ms, ignorando lotes
   só com mutações da própria extensão). As travas, em ordem:
   1. `ehPaginaDeCompra(url)` — vitrine pública (host `produto.`/`articulo.` ou rota
      `/up/MLB…` / `/p/MLB…`, inclusive `/p/MLB…/s`) → não coleta.
   2. `paginaMencionaVisita(doc)` — sem "visita" fora do painel → nada.
   3. `TreeWalker` sobre nós de texto (sem `script`/`style`/`template`/`noscript`/
      `[hidden]`), amarrando cada número a um código `MLB…` pelo card
      (`contextoDoAnuncio`). A leitura de cada rótulo (`lerRotulo`) monta a **fila de
      peças coladas** — número, rótulo, número… — e as pontas dizem o formato: começa
      com número → valor antes do rótulo; começa com rótulo → valor depois; pontas
      iguais → ambíguo, não lê. Número que não é contagem (data, hora, decimal, %,
      período, "mil", `R$`, `+N`, "desde 2024") é recusado (`motivoDoNumero`). Uma
      recusa para de subir no DOM.
   4. Visita exigida **por anúncio** — código sem visita lida nesta varredura fica
      de fora.
   5. `descartarImplausiveis` — descarta anúncio com vendas > visitas.

   Cada número sai com o **rastro de origem** (`trechoDaLeitura`: o texto exato entre
   « », com 20 caracteres de contexto, mais a tela mascarada). Grava pela fila
   `comCache` (rastro mesclado por métrica e carimbado com a hora), mostra o toast
   verde e lembra o endereço da tela (nunca URL de anúncio isolado). Sem captura → `salvarDiagnostico` (trava de 3 min **por tela**).
   Se a extensão for recarregada, o script vira órfão e se desliga (`extensaoViva`).
2. **`content.js`** roda em URL que contém `MLB…`: monta os códigos candidatos
   (`codigosDaPagina`: `item_id`/`wid` da query ou do `#` primeiro, o caminho por
   último), usa o primeiro com número provado (`escolherRegistro`), **descarta número
   sem rastro de origem** (`somenteComOrigem`), lê o preço **só de dado estruturado**
   (`meta[itemprop=price]` ou JSON-LD) e monta o painel
   azul com botão de fechar. Passar o mouse sobre uma linha mostra de onde o número
   veio (ou a conta, nos calculados). A idade exibida é a da leitura mais antiga. O fechamento vale para aquele anúncio até o F5. Reage a
   troca de URL (poller de 1 s, que para quando o script fica órfão) e a
   `chrome.storage.onChanged` — só quando o registro do anúncio da tela mudou.
3. A cada 2 h o coletor pede ao **service worker** o HTML das origens aprendidas. O SW
   confere quem pediu e o endereço (só https no domínio do ML, também depois de
   redirecionamento), faz o `fetch` com a sessão e tempo limite de 20 s, devolve o
   texto, e o content script parseia com `DOMParser` + `varrerPagina` e grava em
   silêncio (sem toast).
4. **Popup:**
   - "Limpar dados guardados" apaga todas as chaves `mlmetrics_`.
   - A lista mostra, embaixo de cada número, o rastro (trecho « », tela, hora).
     Registro sem rastro aparece como "sem origem (versão antiga)".
   - "Copiar diagnóstico" pede à **aba ativa** um diagnóstico na hora
     (`chrome.tabs.sendMessage` → `diagnosticarTelaAtual`) e monta o relatório:
     `versao`, `telaAtual` (host, caminho mascarado, vitrine, mencionaVisita,
     capturariaAgora, **resumoDasRecusas** e **recusas** — por que cada rótulo não
     virou número —, amostras com até 12 por métrica; ou o erro "a aba não respondeu,
     aperte F5"),
     `origens` mascaradas, `capturado` e `ultimoDiagnosticoGuardado`. O texto aparece
     sempre num `<textarea>`, além do clipboard.
5. **Envio para a cliente:** `powershell -ExecutionPolicy Bypass -File .\empacotar.ps1`
   → `dist\ML-Metrics-<versão>.zip`. Nunca zipar a pasta de trabalho.

---

## 4. Estado atual

| O quê | Situação |
|---|---|
| Revisão 1 (11/09) — #1 a #33 | ✅ corrigidos (lotes 1–8). Seção 6. |
| Página real (14/09) — #34 a #36 | ✅ corrigidos (lotes 10, 12 e 16). Seção 6. |
| Revisão 2 (14/09) — #37 a #55 | ✅ **13 resolvidos** (#37, #39, #41, #42, #43, #44, #45, #48, #49, #51, #52, #54, #55) · ⚠️ **parciais**: #38 (exibição resolvida; captura de card com 2 códigos aberta), #47 (observer resolvido; período aberto), #50 (decisão do repositório), #53 (contínuo) · ⬜ **abertos**: #40, #46. |
| Pedido do Pedro (14/09) — #56 | ✅ **só dado com prova**: todo número exibido tem rastro de origem conferível (lote 20). |
| Relato da cliente (15/09) — #57 a #61 | ✅ **lote 21**: "no anúncio aparecem só as visitas" levou à troca da leitura por fila de peças (#57), à recusa de preço inteiro e faixa "+N" (#58), ao diagnóstico com o motivo de cada recusa (#59), à receita só com preço estruturado (#60) e a acabamentos (#61). |
| Resíduos aceitos | ⚠️ #21 (corrida entre abas). Seção 6. |
| Harness | **159/159 PASS** (+30 casos no lote 21). `node --check` ok em todos os JS. |
| Teste em DOM real | ✅ lote 21, no navegador interno (servidor local só com `src/` e fixtures fictícias, `chrome` falso): gabarito de `publicacoes.html` exato; card com números antes dos rótulos em elementos irmãos ("359 visitas 12 vendas 5 disponíveis") → **359 / 12** — a 0.1.3 perdia as vendas ou gravava 5; "Estoque: 5 \| Vendas" recusado, com o motivo no diagnóstico; painel com 13,9%; receita "—" explicada quando falta preço estruturado; código do item do `pdp_filters` escolhido antes do código do caminho. |
| Pacote | `dist\ML-Metrics-0.1.4.zip`. Zips anteriores apagados (superados). |

### ⚠️ Repositório público — decisão do Pedro

Em 14/09/2026, `https://github.com/albanopedro/extensaoML` respondeu **HTTP 200 sem
login**: o repositório é **público**. Ele contém este `contexto.md` (anotações sobre a
cliente e o diagnóstico dela) e, **no histórico do git**, o código `MLBU` e o slug reais
do anúncio salvo (já trocados por fictícios na versão atual dos arquivos). Apagar do
arquivo não tira do histórico. O caminho simples é **tornar o repositório privado** no
GitHub (Settings → General → Danger Zone → Change visibility). Claude não escreve em
git/GitHub — é ação do Pedro.

### Verificação manual pendente (Pedro, antes de enviar à cliente)

O harness não cobre o que depende do navegador. O comportamento dos itens 1, 3, 5, 6 e
7 já passou no teste em DOM real com `chrome` falso (lotes 20 e 21); falta confirmar com
a extensão de verdade (mensagens popup ↔ aba e storage reais). Com a extensão carregada
(0.1.4):

1. **#44** — numa aba do ML, ícone → "Copiar diagnóstico": o relatório tem `telaAtual`
   com `host`, `caminho` mascarado, `vitrine`, `mencionaVisita`, `capturariaAgora` e
   `amostras`.
2. **#44** — numa aba que não é do ML (ex.: `edge://extensions`), "Copiar diagnóstico":
   `telaAtual.erro` com a mensagem de F5.
3. **#42** — com uma aba do ML aberta, recarregar a extensão e, **sem F5**, copiar o
   diagnóstico nessa aba: deve dizer que a aba não respondeu; um painel que estivesse
   na tela some em ~1 s. Depois do F5, volta a responder.
4. **#43** — "Limpar dados guardados" e copiar o diagnóstico: `origens: []`,
   `capturado: {}`, `ultimoDiagnosticoGuardado: null`.
5. **#45** — num anúncio com painel, fechar no ×: o painel não volta sozinho enquanto
   a aba não for recarregada.
6. **#56** — depois de capturar numa tela de vendedor, abrir o ícone: cada número tem
   embaixo o trecho « » de onde saiu. No painel do anúncio, passar o mouse sobre um
   número mostra a mesma origem.
7. **#59** — numa tela de vendedor, "Copiar diagnóstico": `telaAtual.resumoDasRecusas`
   conta os rótulos que não viraram número, por motivo, e `telaAtual.recusas` mostra o
   trecho de cada um.

### Ação pendente (depois da verificação)

1. Rodar `empacotar.ps1` e enviar `dist\ML-Metrics-0.1.4.zip` à cliente.
2. A cliente segue **"Depois de uma atualização"** do guia: substituir os arquivos na
   mesma pasta, recarregar a extensão, conferir a versão **0.1.4**, **F5** nas abas do ML.
3. A cliente clica **"Limpar dados guardados"** (agora apaga também as origens
   envenenadas pelo build antigo).
4. A cliente abre **"Minhas publicações"**, espera carregar, clica em **"Copiar
   diagnóstico" nessa tela** e cola na conversa. Se as vendas ainda não aparecerem,
   `telaAtual.resumoDasRecusas` e `telaAtual.recusas` dizem o motivo exato. O campo
   `telaAtual` é o material que destrava os lotes 22–24.
5. A cliente faz a **conferência de 3 anúncios** (passo 7 do guia): número do ML ×
   número da extensão, com o trecho « » de cada um.

### Teste na conta do Pedro (não feito)

Em 14/09 o Claude in Chrome não estava conectado. Com ele instalado e logado, e com a
autorização do Pedro, Claude pode abrir a tela de anúncios de uma conta do Pedro (se
ela tiver pelo menos um anúncio) só para ler a estrutura — sem salvar dado pessoal no
projeto. Seria o primeiro contato com a tela real antes da cliente.

### Maior risco aberto

Continua o mesmo desde o começo: **a tela real de vendedor nunca foi vista.** As três
tentativas de arquivo real vieram como vitrine pública. A captura de card com dois
códigos (#38), o período (#47) e a plausibilidade (#40) só se resolvem de verdade com
ela; a leitura por fila (#57) e a trava por anúncio (#48) recusam o que é ambíguo e
precisam ser validadas nela. O diagnóstico da aba ativa com motivos (#44, #59) e a
conferência com rastro (#56) foram feitos justamente para trazê-la e checá-la.

---

## 5. O que precisa ser feito — problemas abertos

Formato: `#ID [severidade] título` → onde / causa / evidência / impacto / direção.
Mantenha estes IDs estáveis: eu vou me referir a eles pelo número.

### Resumo

| # | Sev. | Título | Status | Depende da tela real? | Lote |
|---|---|---|---|---|---|
| #38 | CRÍTICO | Card com link do item **e** do catálogo tem 2 códigos e é ignorado (a exibição foi resolvida no lote 21) | ⚠️ parcial | Sim (links dos cards) | 22 |
| #40 | ALTO | "Vendas nunca passam de visitas" é falso e só vale por varredura | ⬜ | Sim (unidade ou pedido) | 23 |
| #46 | MÉDIO | #18 pela metade: painel "Sem dados" em anúncio de qualquer vendedor | ⬜ | Decisão (mostrar ou não) | 22 |
| #47 | MÉDIO | Período (7/30 dias) não é registrado (o observer foi resolvido no lote 21) | ⚠️ parcial | Sim (período) | 24 |
| #50 | MÉDIO | Privacidade no repositório (resíduo: repo público + histórico) | ⚠️ parcial | Não — decisão do Pedro | — |
| #53 | BAIXO | Harness: lacunas que sobraram | ⚠️ parcial | Não | contínuo |

---

### GRUPO I — Plausibilidade

#### #40 [ALTO] "Vendas nunca passam de visitas" é falso, e só vale por varredura

- **Onde:** `src/coletor.js:867-897` — `descartarImplausiveis`; merge em `:1113-1121`.
  Desde o lote 21 o descarte aparece no diagnóstico ("vendas maiores que visitas").
- **Causa 1:** no ML, "vendidos" costuma contar **unidades**. Um comprador leva 12
  unidades numa visita só.
- **Causa 2:** a checagem roda sobre o resultado da varredura, **antes** do merge.
  Visitas de uma tela antiga + vendas de uma tela nova podem deixar vendas > visitas
  no cache.
- **Evidência (Node, 14/09):**
  ```
  descartarImplausiveis({ MLB1: { visitas: 5, vendas: 12 } })  => {}   (so console.warn)
  ```
- **Impacto:** anúncio legítimo de venda em quantidade desaparece em silêncio; do outro
  lado, conversão acima de 100% passa pelo merge sem trava.
- **Direção (decisão):** (a) virar alerta visual no painel em vez de descartar;
  (b) tolerância (ex.: vendas > visitas × N); (c) checar também depois do merge.
  Confirmar na tela real se "vendas" é unidade ou pedido.

---

### GRUPO J — Identidade e escopo: número atribuído ao anúncio errado

#### #38 [CRÍTICO] Card com link do item e do catálogo é ignorado — ⚠️ parcial

- **Já feito (lote 21):** a exibição. O `content.js` monta os códigos candidatos
  (`codigosDaPagina`, `src/content.js:69`) — `item_id`/`wid` da query ou do `#`
  primeiro, o caminho por último — e usa o primeiro com número provado
  (`escolherRegistro`, `:382`). Testado no harness e em DOM real.
- **Falta — onde:** `src/coletor.js:431-491` e `:494-512` — `contextoDoAnuncio` /
  `codigosDentroDe` (desistência em `:472`).
- **Causa:** o ML tem três espaços de identificador: item (`MLB-3456789012`), produto
  de catálogo (`/p/MLB…`) e user product (`/up/MLBU…`). Um card de "Minhas publicações"
  com link do item **e** link do catálogo tem 2 códigos distintos → o coletor desiste
  do card (verificado: resultado `{}`). Mesmo risco para user product que agrupa vários
  itens. Desde o lote 21 isso aparece no diagnóstico como "bloco com N anúncios".
- **Direção:** na tela real, ver para onde apontam os links do card. Se for sempre item
  + catálogo do mesmo produto, preferir o código de item (`MLB` sem letra) quando os
  outros forem de catálogo ou user product.

---

### GRUPO L — Painel e reatividade

#### #46 [MÉDIO] #18 pela metade: painel "Sem dados" em anúncio de qualquer vendedor

- **Onde:** `src/content.js:653-665`.
- **Causa:** a correção do #18 só esconde o painel vazio quando o cache está VAZIO. Com
  um anúncio capturado, todo produto aberto mostra "Sem dados deste anúncio ainda. Abra
  'Minhas publicações'…".
- **Impacto:** ruído em toda navegação como compradora, com uma promessa que nunca se
  cumpre para produto alheio. Somado ao #38, aparece também nos anúncios dela.
- **Direção:** não mostrar painel vazio por padrão (a dica fica no popup), ou só em
  anúncio reconhecido como dela. Depende do #38.

#### #47 [MÉDIO] Período (7/30 dias) não é registrado — ⚠️ parcial

- **Já feito (lote 21):** o observer passou a ver texto e link trocados no lugar
  (`characterData` e `attributes: href`, `src/coletor.js:1783`) e só ignora um lote de
  mutações quando **todas** são da extensão (`every`, `:1760`).
- **Falta:** nada registra o **período** do número lido. Se a tela estiver com filtro
  de 30 dias, o painel mostra essas visitas como se fossem o total. (Desde o lote 20 o
  painel diz só "Visitas", e o rastro mostra o texto exato que foi lido.)
- **Direção:** ler o rótulo do filtro na tela real e guardar junto do rastro.

---

### GRUPO M — Segurança, privacidade e testes

#### #50 [MÉDIO] Privacidade no repositório — ⚠️ parcial

- **Já feito (lote 17):** `empacotar.ps1` com lista de inclusão (zip conferido: só
  `manifest.json`, `icons/`, `src/`); `dist/` no `.gitignore`; código e slug reais
  trocados por fictícios em `teste/test-parsing.js`, nos comentários de
  `src/coletor.js` e `src/content.js` e no registro do lote 16 deste arquivo; `origens`
  e diagnóstico agora vão com o caminho mascarado.
- **Falta (decisão do Pedro):** o repositório `github.com/albanopedro/extensaoML` é
  **público** (HTTP 200 sem login em 14/09). O **histórico** do git (commits até
  `35f583a`) ainda tem o código `MLBU` e o slug reais, e este `contexto.md` traz
  anotações sobre a cliente. Opções: tornar o repositório privado (resolve de uma vez);
  reescrever o histórico (não recomendado; e Claude não escreve em git).

#### #53 [BAIXO] Harness: lacunas que sobraram — ⚠️ parcial

- **Onde:** `teste/test-parsing.js`; fixtures em `teste/`.
- **Já feito (lote 21):** a extração ignora comentários, strings e regex (`fimDoBloco`,
  `:58`) e procura `function nome(`; os comentários velhos das fixtures foram
  corrigidos.
- **Já coberto:** lotes 17–19 (#39, #41, #52, #55, `caminhoMascarado`, stub com
  `[attr]`); lote 20 (#37, #48, rastro, `mudou`, `mesclarOrigem`, `faltaOrigem`,
  `somenteComOrigem`); lote 21 (fila de peças, motivos de recusa, diagnóstico,
  `codigosDaPagina`, `escolherRegistro`, `precoDoJsonLd`, `diasDesde`,
  `formatarPercentual`, card com números em elementos irmãos).
- **Falta:**
  - `salvar` inteiro (a fila com o storage) não tem teste automático.
  - O que depende do navegador (popup ↔ aba, script órfão, fechar painel, observer) só
    foi testado à mão, em DOM real com `chrome` falso (lotes 20 e 21).
  - As fixtures HTML só rodam com um servidor local (não abrem mais em `file:///` desde
    o #5), e esse servidor não está versionado.
- **Direção:** cada correção dos próximos lotes entra com caso no harness.

---

## 6. O que já foi feito — problemas resolvidos

Legenda: ✅ feito · ⚠️ feito com resíduo ou parcial (o resíduo virou item aberto ou
limitação aceita).

### Revisão 1 e página real (#1 a #36)

> As descrições completas foram **retiradas** deste arquivo em 14/09/2026 para ele
> continuar cabendo numa conversa. O texto original (causa, evidência, impacto) está no
> git: `git show 35f583a:contexto.md`.

| # | Sev. | Título | Status | Lote | Observação |
|---|---|---|---|---|---|
| #1 | CRÍTICO | Regex sem vírgula decimal — centavos viravam métrica | ✅ | 2, 8 | + `ehData` e `ehAnoPosDesde` |
| #2 | CRÍTICO | TreeWalker lia `<script>`/`<style>` | ✅ | 2, 19 | `noscript` e `[hidden]` completados no #52 |
| #3 | CRÍTICO | `valorDoRotulo` buscava número no body | ✅ | 3 | |
| #4 | CRÍTICO | `"visualiz"` casava com "Visualizar" | ✅ | 2 | |
| #5 | CRÍTICO | `file:///*` no manifest de produção | ✅ | 1 | fixtures não abrem mais no navegador → **#53** |
| #6 | CRÍTICO | Atualização automática bloqueada por CORS | ✅ | 6, 21 | fetch no SW, com remetente e endereço validados (#49) |
| #7 | ALTO | `MLB` da query sequestrava a página | ✅ | 3, 21 | `content.js` só lê os parâmetros que carregam o item (#54) |
| #8 | ALTO | `capturadoEm` mentia a idade do dado | ✅ | 4, 16, 20 | o rastro guarda a hora por métrica; o painel mostra a idade da leitura mais antiga (#56) |
| #9 | ALTO | Condição de corrida na navegação SPA | ✅ | 4 | |
| #10 | ALTO | `ehPaginaDeCompra` frágil e caro | ✅ | 3, 10, 19 | `/p/MLB…/s` completado no #55 |
| #11 | ALTO | Loop aviso ↔ MutationObserver | ✅ | 5, 21 | `every` no lugar de `some` (#47) |
| #12 | ALTO | Complexidade quadrática na listagem | ✅ | 5 | |
| #13 | ALTO | Sem tratamento de erro nas chamadas `chrome.*` | ✅ | 5, 17 | script órfão agora se desliga (#42) |
| #14 | MÉDIO | Pasta `extensaoML/` duplicada | ✅ | 1 | |
| #15 | MÉDIO | Bug no `sniffer.js` | ✅ | 7 | arquivo removido |
| #16 | MÉDIO | `lerPreco` pegava o primeiro preço | ✅ | 4, 21 | hoje só dado estruturado (#60) |
| #17 | MÉDIO | Lista de origens enchia de URLs inúteis | ✅ | 6, 17 | "Limpar" agora apaga as origens (#43) |
| #18 | MÉDIO | Painel vazio em qualquer anúncio | ⚠️ | 4 | **parcial** → reaberto como **#46** |
| #19 | MÉDIO | Conversão 0% exibida como "sem dado" | ✅ | 4, 19 | 0/0 e 3/0 resolvidos no #39 |
| #20 | MÉDIO | Diagnóstico capturava demais | ✅ | 6, 11, 18 | caminho mascarado (#44), origens mascaradas (#50) |
| #21 | MÉDIO | Sobrescrita concorrente entre abas | ⚠️ | 5 | **limitação aceita:** fila só na mesma aba; entre abas continua |
| #22 | BAIXO | CSS `:last-of-type` que nunca se aplicava | ✅ | 7 | |
| #23 | BAIXO | `temLetra` com intervalo Unicode torto | ✅ | 2 | |
| #24 | BAIXO | `numeroAntesDe` só via a primeira ocorrência | ✅ | 2 | |
| #25 | BAIXO | `id` duplicado no aviso verde | ✅ | 5 | |
| #26 | BAIXO | Aviso verde em página que não é de coleta | ✅ | 7 | |
| #27 | BAIXO | Painel sem como fechar | ✅ | 7, 19 | fechar agora dura (#45) |
| #28 | BAIXO | Parâmetro morto em `montarPainel` | ✅ | 7 | |
| #29 | BAIXO | Manifest incompleto | ✅ | 1 | |
| #30 | BAIXO | `clipboardWrite` não declarado | ✅ | 7, 15 | + textarea de apoio no popup |
| #31 | BAIXO | Sem refresh reativo do painel | ✅ | 7, 19 | refresh filtrado pelo anúncio da tela (#45) |
| #32 | BAIXO | Documentação com afirmação imprecisa | ✅ | 6, 17 | voltou e foi corrigido de novo no #51 |
| #33 | BAIXO | `.git/.MERGE_MSG.swp` no repositório | ✅ | 8 | |
| #34 | CRÍTICO | Vitrine `/up/` e `/p/` no host `www` escapava | ✅ | 10 | |
| #35 | ALTO | Painel imprimia "Vende a cada: NaN visitas" | ✅ | 10 | |
| #36 | CRÍTICO | Coleta em páginas públicas (não-seller) | ✅ | 12, 16, 20 | trava agora vale por anúncio (#48) |

### Revisão 2 (#37 a #55) e pedido #56 — resolvidos em 14/09/2026

| # | Sev. | Título | Status | Lote | O que foi feito |
|---|---|---|---|---|---|
| #39 | ALTO | Conversão "NaN%" e "Infinity%" | ✅ | 19 | `calcular`: conversão exige `visitas > 0`. 2 casos no harness. |
| #41 | ALTO | Número depois do rótulo aceito sem olhar o que vem em seguida | ✅ | 19 | `seguidoDeUnidade` rejeita `%`, `DD/MM`, hora, dias/meses/anos, mês abreviado, "mil"/"k" (lista fechada); `%` também rejeitado antes do rótulo. **Conservador:** "Vendas (30 dias) 12" dá `null`, não 12. 13 casos. |
| #42 | ALTO | Depois de recarregar a extensão, abas abertas ficavam sem script | ✅ | 17 | `extensaoViva()`: coletor desliga o observer e o disparo agendado; content para o poller e tira o painel. Guia: substituir arquivos na mesma pasta, conferir versão, F5 nas abas. |
| #43 | ALTO | "Limpar dados guardados" não apagava origens nem a trava | ✅ | 17 | Apaga todas as chaves com prefixo `mlmetrics_`. |
| #44 | ALTO | Diagnóstico não correspondia à tela aberta | ✅ | 18 | Popup pede `diagnosticar` à aba ativa (`chrome.tabs.query` + `sendMessage`, frameId 0, sem permissão nova); coletor responde `diagnosticarTelaAtual()`. Aba muda vira mensagem com F5. Diagnóstico guardado: trava de 3 min **por tela**, `host` + `caminho` mascarado, amostras ignoram o painel. **Precisa de verificação manual.** |
| #45 | MÉDIO | Fechar o painel não durava | ✅ | 19 | `fechadoPara` por anúncio na aba; `onChanged` só remonta se o registro do anúncio da tela mudou; painel com números sai quando o dado some (ex.: após Limpar). |
| #51 | MÉDIO | Afirmações erradas no guia da cliente | ✅ | 17 | "página", consulta invisível, leitura não idêntica a um acesso, "você decide o que me manda"; seções de atualização e diagnóstico reescritas. |
| #52 | BAIXO | Conteúdo oculto ainda era lido | ✅ | 19 | Filtro inclui `noscript` e `[hidden]`. `aria-hidden` fica de fora de propósito (a parte visual do preço do ML usa `aria-hidden="true"`: 158 ocorrências na página real). **Limite:** ao subir no DOM, o `textContent` do ancestral ainda inclui texto oculto — o filtro vale para o nó do rótulo. 2 casos. |
| #55 | BAIXO | `/p/MLB…/s` não era vitrine | ✅ | 19 | Regex aceita o código seguido de `/` ou fim do caminho. 3 casos. |
| #37 | CRÍTICO | Layout "Rótulo: valor": vendas herdava o número das visitas | ✅ | 20, 21 | Lote 20: `numeroPresoAOutroRotulo` ("Visitas: 359 \| Vendas: 12" → 359 e 12), conservador demais — em texto corrido perdia vendas e num caso gravava o número do rótulo seguinte. **Refeito no lote 21 (#57)** pela fila de peças. |
| #48 | MÉDIO | Trava `leuVisitas` valia por página | ✅ | 20 | Visita exigida por anúncio: código sem visita lida na varredura fica de fora. 2 casos. |
| #56 | ALTO | Número exibido sem prova de origem (pedido do Pedro: "ter certeza que mostra dado real, não inventado") | ✅ | 20 | Auditoria: só existe um ponto que grava métrica, sempre a partir de texto da página — nada inventado. Cada leitura agora grava `origem[métrica] = { trecho « », tela mascarada, em, automatica }` (`lerRotulo`, `trechoDaLeitura`, `mesclarOrigem`). Painel e popup só exibem número com rastro (`somenteComOrigem`); o title de cada linha mostra a origem ou a conta; "Visitas totais" virou "Visitas"; receita explicada como estimativa; popup com fundo branco e números no formato do ML; guia com conferência de 3 anúncios. Harness + DOM real. |
| #49 | MÉDIO | Service worker buscava qualquer URL recebida | ✅ | 21 | `enderecoPermitido`: só `https` no domínio do ML, também depois de redirecionamento; confere `remetente.id`; tempo limite de 20 s (`AbortController`). A decisão de manter a busca automática continua (seção 8). |
| #54 | BAIXO | `content.js` usava a URL com query | ✅ | 21 | `codigosDaPagina` só lê `pdp_filters`/`item_id`/`wid` (query ou `#`) e o caminho; `?search=MLB…` não gera painel. |
| #50 | MÉDIO | Privacidade no empacotamento e no repositório | ⚠️ | 17 | Parcial — o que falta está na seção 5. |

### Relato da cliente (15/09) — #57 a #61, resolvidos no lote 21

Relato: "no anúncio dela aparecem só as visitas". A investigação mostrou que a regra
conservadora do #37 (0.1.3) era a causa provável — e escondia um erro pior.

| # | Sev. | Problema | Status | O que foi feito |
|---|---|---|---|---|
| #57 | CRÍTICO | Leitura pelo vizinho imediato: número perdido ou errado em texto corrido. Na 0.1.3: "359 visitas 12 vendas" → vendas **nada** (sintoma da cliente); "359 visitas 12 vendas 5 disponíveis" → vendas **5**; "Tamanho 42 Visitas 359" → visitas **42**; "12 vendas · revenda" → nada. | ✅ | `lerRotulo` reescrito: fila de peças coladas (`pecasDoTexto`, `pecasColadas`) com as pontas decidindo "valor antes" ou "valor depois"; pontas iguais → ambíguo, não lê; recusa para de subir no DOM; qualificadores ("totais", "hoje", "do mês") não partem a fila; o rótulo precisa começar a palavra. Saíram `ultimoNumeroColado`, `primeiroNumeroColado`, `ehAnoPosDesde` e `numeroPresoAOutroRotulo`. |
| #58 | ALTO | Número que não é contagem aceito: preço inteiro ("R$ 49 vendas" → 49) e faixa arredondada ("+1.000 vendidos" → 1.000). | ✅ | `motivoDoNumero` recusa `R$` e `+N`, além de data, hora, decimal, %, período, "mil" e "desde 2024". |
| #59 | ALTO | O diagnóstico não dizia por que um número não virou dado. | ✅ | `varrerPagina(doc, url, recusas)` anota cada rótulo recusado (ambíguo, preço, bloco com N anúncios, sem link, sem número, anúncio sem visitas, vendas > visitas) com o trecho; `telaAtual.resumoDasRecusas` e as 40 primeiras `recusas`; amostras com até 12 por métrica. |
| #60 | MÉDIO | A receita estimada usava o preço visível por heurística (podia ser parcela ou valor riscado). | ✅ | `lerPreco` só lê dado estruturado (`meta[itemprop=price]` ou JSON-LD `offers.price`); sem ele a receita fica "—", com a explicação no title. |
| #61 | BAIXO | Acabamentos: idade em blocos de 24 h ("hoje" para ontem à noite), percentual "13.9%", avisos "Unchecked runtime.lastError". | ✅ | `diasDesde` por dia de calendário; `formatarPercentual` ("13,9%"); callbacks lendo `lastError` nas gravações. |

---

## 7. Leitura de conjunto (o diagnóstico de fundo)

Na revisão 1, o risco central era **"qual texto é métrica"**: preço lido como métrica
(#1), `<script>` lido como texto visível (#2), "Visualizar" lido como visita (#4).
Isso foi fechado, e hoje há travas em camadas: URL de vitrine, vocabulário "visita",
`leuVisitas`, `descartarImplausiveis`, filtro de texto técnico/oculto e rejeição de
unidades depois do número.

Na revisão 2, o risco mudou para duas perguntas que as travas **não** respondem:

- **De qual rótulo é este número?** (#37) — a heurística "número antes do rótulo"
  roubava o valor do rótulo vizinho. Resolvido de forma conservadora no lote 20.
- **De qual anúncio é este ID?** (#38, #48) — captura e exibição usam espaços de ID
  diferentes (#38, aberto); a trava de visitas valia para a página inteira (#48,
  resolvido no lote 20).

As duas só se respondem com a tela real de vendedor. Os lotes 17–19 destravaram o
**ciclo de teste com a cliente**: a aba não fica mais sem script sem aviso (#42), a
limpeza é completa (#43) e o diagnóstico passou a ser da tela aberta (#44). A próxima
rodada com a cliente deve trazer, finalmente, a tela real.

O lote 20 mudou o que "confiar no painel" significa: todo número exibido carrega o
texto exato de onde foi lido (#56), e as duas leituras ambíguas conhecidas (#37, #48)
passaram a ser recusadas em vez de chutadas. Número real no lugar errado ainda é
possível se a fronteira de um card for mal detectada na tela real — mas agora o rastro
deixa isso visível na conferência, em vez de escondido atrás de um número plausível.

O lote 21 corrigiu um efeito colateral do próprio lote 20: a regra "na dúvida, não
grava" do #37 olhava só o vizinho imediato e, em texto corrido, perdia vendas reais — e
num caso gravava o número do rótulo seguinte. A leitura agora olha a fila inteira de
números e rótulos e só recusa quando as pontas da fila não dizem o formato. Cada recusa
vai para o diagnóstico com o motivo, para a próxima rodada com a cliente responder "por
que não apareceu" em vez de só "não apareceu".

---

## 8. Ordem de correção sugerida

| Ordem | Lote | IDs | Status | Por quê |
|---|---|---|---|---|
| — | 17 — Preparar o teste real | #42, #43, #50, #51 | ✅ (#50 ⚠️) | Feito em 14/09. |
| — | 18 — Diagnóstico confiável | #44 | ✅ | Feito em 14/09. |
| — | 19 — Correções independentes | #39, #41, #45, #52, #55 | ✅ | Feito em 14/09. |
| — | 20 — Só dado com prova | #37, #48, #56 | ✅ | Feito em 14/09. |
| — | 21 — Robustez geral (relato da cliente) | #57–#61, #49, #54; parte de #38, #47, #53 | ✅ | Feito em 15/09. |
| 1 | **Verificação manual + decisão do repositório** | #42, #43, #44, #45, #50, #56, #59 | ⬜ | Seção 4. Antes de mandar a 0.1.4 para a cliente. |
| 2 | **★ Ação — capturar "Minhas publicações" real + conferência de 3 anúncios** | — | ⬜ | "Copiar diagnóstico" na tela (`telaAtual`, com `resumoDasRecusas`) e passo 7 do guia. Decide #38, #40, #47 e valida #48/#57. |
| 3 | **22 — Identidade e painel vazio** | #38, #46 | ⬜ | Card com dois códigos; decidir se o painel "Sem dados" continua. |
| 4 | **23 — Plausibilidade** | #40 | ⬜ | Decisão: descartar, alertar ou tolerar vendas > visitas. |
| 5 | **24 — Período** | #47 | ⬜ | Registrar o recorte (7/30 dias) junto do rastro. |
| 6 | **Decisão — busca automática** | — | ⬜ | Com a tela real: se o HTML buscado não traz os números (tela montada por JavaScript), desligar a busca a cada 2 h. |
| — | **Contínuo** | #53 | ⬜ | Cada lote entra com casos no harness. |

---

## 9. Como me pedir para trabalhar

Exemplos do que dizer numa nova conversa, depois de colar este arquivo:

- `"chegou o diagnóstico da tela real, vamos no lote 22"`
- `"resolve o #46"`
- `"me mostra como você corrigiria o #38 antes de aplicar"`
- `"a busca automática vale a pena ou a gente desliga?"`

O que eu espero de você em cada rodada:

1. Ler o trecho de código real (os números de linha podem ter mudado).
2. Explicar a correção em uma ou duas frases antes de escrever código.
3. Aplicar mantendo o padrão de comentários do projeto.
4. Acrescentar o caso no harness e rodar `node teste/test-parsing.js`.
5. Dizer o que **não** foi corrigido junto e por quê.
6. Atualizar o resumo da seção 5, a seção 6 e o registro da seção 10.
7. Se a mudança vai para a cliente: subir a versão no `manifest.json` e gerar o zip
   com `empacotar.ps1`.
8. Nunca commitar.

---

## 10. Registro de progresso

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
| 16 — Diagnóstico real: cache poluído e build antigo | ✅ feito | 14/09/2026 | O 1º "Copiar diagnóstico" real veio. Provas: (a) **build antigo ativo** — diagnóstico com URL completa + query e `MLBU… = vendas 1000` (código real removido deste registro em 14/09, #50) recém-capturado: o bug #34 ainda rodava no navegador; (b) **137 anúncios no cache, TODOS sem `visitas`**, com `origens` só na homepage — o coletor nunca viu a tela de vendedor e encharcou o cache de chips públicos ("+1.000 vendidos") atribuídos a produtos alheios. Correção estrutural: além de "a página menciona visita", agora **é preciso ter lido ao menos uma VISITA** (`leuVisitas` em `varrerPagina`) — tela de vendedor sempre mostra visitas; página pública (banner, homepage, busca) nunca produz. Caso real vira teste no harness ("banner com 'visita', só vendas: nada") → **79/79**. `manifest.json` subiu para **0.1.1** (a versão no próximo diagnóstico prova que o reload aconteceu). **AÇÃO PENDENTE (usuário):** recarregar a extensão, confirmar versão 0.1.1, **Limpar dados guardados** (apaga as 137 leituras falsas), e aí sim testar "Minhas publicações". ⚠️ *Substituída pela ação pendente da seção 4 (versão 0.1.3).* |
| Revisão 2 | ✅ feita | 14/09/2026 | Revisão sênior completa depois do lote 16. **19 problemas novos (#37–#55)**; os de parsing, cálculo e ID foram confirmados rodando as funções do projeto no Node. O harness continuava 79/79 — os defeitos novos estavam fora do que ele cobria. Descrições de #1–#36 retiradas deste arquivo (ficam no git, `35f583a`) e resumidas na seção 6. |
| 17 — Preparar o teste real | ✅ feito | 14/09/2026 | **#42:** `extensaoViva()` em `coletor.js` (desliga o MutationObserver e o disparo agendado) e em `content.js` (para o poller e tira o painel); guia com substituir-na-mesma-pasta, conferir versão e F5 nas abas. **#43:** "Limpar" apaga pelo prefixo `mlmetrics_`. **#51:** guia reescrito nos 4 trechos. **#50 (parcial):** `empacotar.ps1` (lista de inclusão; ZipArchive do .NET com `/` — o `Compress-Archive` do PS 5.1 gravava `\`); zip 0.1.2 conferido com 11 entradas; `dist/` no `.gitignore`; código/slug reais trocados por fictícios em `test-parsing.js`, comentários de `coletor.js`/`content.js` e no registro do lote 16. Repositório confirmado **público** — decisão do Pedro. `manifest.json` → **0.1.2**. |
| 18 — Diagnóstico confiável | ✅ feito | 14/09/2026 | **#44:** popup pede o diagnóstico à aba ativa (`chrome.tabs.query` + `chrome.tabs.sendMessage`, frameId 0, sem permissão nova); o coletor responde `diagnosticarTelaAtual()` (host, caminho mascarado, vitrine, mencionaVisita, capturariaAgora, amostras) e confere `remetente.id`. Aba que não responde vira mensagem com instrução de F5. Diagnóstico guardado: trava de 3 min por tela, `host` + `caminho` no lugar de `url`, amostras ignoram o painel (`coletarAmostras`). Relatório: `telaAtual`, `origens` mascaradas (`enderecoMascarado`, mesma regra de `caminhoMascarado`), `capturado`, `ultimoDiagnosticoGuardado`. **Falta verificação manual no navegador** (seção 4). |
| 19 — Correções independentes | ✅ feito | 14/09/2026 | **#39** conversão exige visitas > 0. **#41** `seguidoDeUnidade` + `%` antes do rótulo. **#45** `fechadoPara` + `onChanged` filtrado pelo anúncio + painel sai quando o dado some. **#52** `noscript, [hidden]` no filtro (aria-hidden fora, de propósito); stub do harness entende `[attr]`. **#55** `/p/MLB…/s`. Harness **103/103** (+24 casos), `node --check` ok. |
| 20 — Só dado com prova | ✅ feito | 14/09/2026 | Pedido do Pedro: "ter certeza que ele vai mostrar dados reais, e não inventados". Auditoria: um único ponto grava métrica, sempre de texto lido na página. **#56:** rastro de origem por métrica (`lerRotulo`, `trechoDaLeitura`, `mesclarOrigem`, `faltaOrigem`; `mudou` passou a comparar só métricas); painel e popup só exibem número com rastro (`somenteComOrigem`); title com origem ou conta; "Visitas totais" → "Visitas"; idade = leitura mais antiga (resolve o #8 no que é exibido). **#37:** `numeroPresoAOutroRotulo` (conservador). **#48:** visita exigida por anúncio. Guia: passo 7 (conferência de 3 anúncios) e "O que me contar". Popup: fundo branco explícito e números no formato do ML. Harness **129/129**. **Teste em DOM real** no navegador interno (servidor local só com `src/` e fixtures fictícias; `chrome` falso): coletor bateu com o gabarito de `publicacoes.html`; painel bateu com o gabarito do anúncio; registro sem origem → "Sem dados"; fechar dura; órfão tira o painel; popup mostra o rastro. Claude in Chrome **não conectado** — teste na conta do Pedro não foi feito. `manifest.json` → **0.1.3**. |
| 21 — Robustez geral | ✅ feito | 15/09/2026 | Relato da cliente: "no anúncio aparecem só as visitas". Verificado no Node que a regra do #37 da 0.1.3 perdia vendas em texto corrido ("359 visitas 12 vendas") e gravava número errado ("… 12 vendas 5 disponíveis" → 5), além de aceitar "R$ 49" e "+1.000". **#57:** `lerRotulo` por fila de peças coladas (pontas decidem antes/depois; ambíguo recusa; recusa para de subir). **#58:** `motivoDoNumero` (preço, faixa +N, data, hora, decimal, %, período, mil, ano). **#59:** recusas com motivo no diagnóstico (`resumoDasRecusas`, `recusas`) e amostras por métrica. **#60:** preço só estruturado (meta ou JSON-LD). **#61:** idade por calendário, "13,9%", `lastError` lido. **#49:** SW valida remetente, https + domínio (também após redirect) e tem timeout. **#54 / #38 (exibição):** `codigosDaPagina` + `escolherRegistro`. **#47 (observer):** `characterData`, `href`, `every`. **#53:** extração que ignora comentário, string e regex. Guia: o diagnóstico explica recusas. Fixtures: comentários corrigidos, gabarito "13,9%". Harness **159/159**. **DOM real** (servidor local, `chrome` falso): gabarito exato; irmãos "359 visitas 12 vendas 5 disponíveis" → 359/12; "Estoque: 5 \| Vendas" recusado com motivo; painel 13,9%; receita "—" sem preço estruturado; item do `pdp_filters` escolhido. `manifest.json` → **0.1.4**, zip gerado. |
| Verificação manual + repositório | ⬜ a fazer | | Seção 4 (Pedro). |
| ★ Capturar tela real + conferência | ⬜ a fazer | | Cliente, com a 0.1.4: "Copiar diagnóstico" em "Minhas publicações" e passo 7 do guia. |
| 22 — Identidade e painel vazio | ⬜ a fazer | | #38 (captura), #46 |
| 23 — Plausibilidade | ⬜ a fazer | | #40 |
| 24 — Período | ⬜ a fazer | | #47 (período) |
| Contínuo — Harness | ⬜ a fazer | | #53 |
