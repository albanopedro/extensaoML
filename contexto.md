# CONTEXTO — Revisão da extensão ML Metrics

> Cole este arquivo inteiro no início de uma nova conversa. Ele contém tudo que é
> preciso saber para continuarmos corrigindo os problemas sem refazer a análise.
>
> **Atualizado em 25/09/2026, depois do lote 33 (venda arredondada vira piso).** O que falta fazer está
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
  sem framework — mantenha assim. JavaScript puro, ES5/ES6 simples, IIFE. Os
  arquivos de `src/` conversam por variáveis globais (`MLMetricsLeitura`,
  `MLMetricsDiagnostico`, `MLMetricsCalculo`, `MLMetricsGravacao`), na ordem do
  `manifest.json` — cada arquivo depois de quem ele usa (o harness confere).
- **Nome de chave do storage só no `gravacao.js`** (`MLMetricsGravacao.CHAVES`,
  `PREFIXO_CHAVES`, `PREFIXO_HISTORICO`). Nunca escreva `"mlmetrics_…"` à mão em outro
  arquivo (o harness recusa) e nunca mude um valor: é o endereço do que já está
  guardado no navegador da cliente.
- **Preserve o estilo dos comentários.** O código é fortemente comentado em português
  sem acentos, explicando o *porquê* de cada decisão. Toda alteração precisa manter
  esse padrão, inclusive atualizando o comentário quando o comportamento mudar.
  Comentário que descreve algo que o código não faz mais é defeito.
- **Sem acentos nos comentários de código** (o projeto segue isso). Em texto de
  interface exibido para a usuária, acentos normais.
- **Antes de corrigir, confirme a linha.** Os números de linha da seção 5 valem para o
  estado do código em **25/09/2026, depois do lote 33**. Depois de cada correção eles
  saem do lugar.
- **Toda correção entra com caso de teste**: no harness (`node teste/test-parsing.js`)
  quando a função for testável fora do navegador; na página de teste
  (`node teste/servidor-teste.js` e abrir `teste/rodar-no-navegador.html`) quando
  depender de DOM real, painel ou popup; e em `node teste/verificar-no-edge.js` quando
  depender da extensão instalada (service worker, mensagens, storage de verdade).
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

Caminho: `C:\codes\extensaoML` · versão no manifest: **0.2.7**

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
├── MENSAGEM-CLIENTE.md      <- mensagem pronta para mandar com o zip, e a
│                               lista do que precisa voltar dela
├── empacotar.ps1            <- gera dist\ML-Metrics-<versao>.zip (so manifest,
│                               icons e src). E ESTE zip que vai para a cliente.
├── icons/                   <- icon16/32/48/128.png
├── src/
│   ├── background.js (~251) SERVICE WORKER (MV3). GRAVA o cache para todas
│   │                        as abas, uma leitura de cada vez (#21), e busca
│   │                        telas para a atualizacao automatica (desligada).
│   │
│   │   Scripts de conteudo, NA ORDEM DO MANIFEST (cada um usa os de cima):
│   ├── gravacao.js (~298)   AS REGRAS de gravar: mesclar no cache e anotar o
│   │                        dia no historico. Roda no service worker, nas abas
│   │                        (plano B) e no popup (prefixo do historico).
│   ├── leitura.js (~1084)   LE a tela, sem chrome.*: fila de numeros e
│   │                        rotulos, motivo de recusa, card do anuncio,
│   │                        varredura com rastro, vitrine, caminho mascarado.
│   ├── diagnostico.js (~353) MONTA o diagnostico, sem chrome.*: amostras,
│   │                        periodo, recusas, diagnosticarTela.
│   ├── coletor.js (~757)    ORQUESTRA a captura: observer, gravacao (SW ou
│   │                        plano B), diagnostico guardado, erros
│   │                        (registrarErro), resposta ao popup.
│   ├── calculo.js (~353)    CONTAS e FORMATOS do painel, sem DOM: codigo da
│   │                        URL, numero com prova, conversao, receita, idade.
│   ├── content.js (~435)    EXIBE. Le o storage, o preco estruturado e monta
│   │                        o painel azul - so com numero que tem rastro.
│   │
│   ├── content.css (~132)   Estilo do painel e do aviso verde.
│   └── popup.html / popup.js (~408)  Painel de controle (mostra a versao): lista o capturado
│                            com a origem de cada numero, limpa dados, copia
│                            diagnostico da aba aberta.
├── teste/
│   ├── test-parsing.js             Harness Node (283 casos, 283/283 PASS em 24/09):
│   │                               carrega leitura/diagnostico/calculo/gravacao
│   │                               como sao, o service worker e a ordem do manifest.
│   ├── servidor-teste.js           Servidor local (127.0.0.1, lista fechada).
│   ├── rodar-no-navegador.html     Teste em DOM real (71 casos, 71/71 PASS).
│   ├── ler-diagnostico.js          Resume o que a cliente colar (diagnostico
│   │                               ou conferencia) e diz o que aquilo decide.
│   ├── abrir-demo.js               Abre o Edge com a extensao instalada e as
│   │                               telas de teste, para VER e clicar.
│   ├── servidor-ml-falso.js        As fixtures servidas em https://...
│   │                               mercadolivre.com.br (usado pelos dois).
│   ├── verificar-no-edge.js        Os 11 itens da lista manual, com a extensao
│   │                               INSTALADA no Edge (21 casos, 21/21 PASS).
│   ├── edge-cdp.js                 A mecanica: sobe o Edge com a extensao,
│   │                               serve as fixtures como https://...mercadolivre
│   │                               e conversa por CDP (WebSocket do Node).
│   ├── publicacoes.html            Fixture da tela "Minhas publicacoes", com gabarito.
│   ├── MLB-1111111111-anuncio.html Fixture da pagina de anuncio, com gabarito.
│   ├── vitrine-up-sanitizada.html  Fixture sanitizada da vitrine /up/ real.
│   └── MLreal* / testenomantereal* PAGINAS REAIS - no .gitignore, NAO commitar
│                                   e NAO enviar para a cliente.
└── dist/                    <- zips gerados (no .gitignore)
```

### Chaves usadas no `chrome.storage.local`

Todas começam com `mlmetrics_`. O botão "Limpar dados guardados" apaga pelo prefixo.
Os nomes são definidos **uma vez só**, em `gravacao.js` (`CHAVES`, congelado com
`Object.freeze`), e usados dali pelo service worker, pelas abas e pelo popup (lote 26b).

| Chave | Conteúdo |
|---|---|
| `mlmetrics_dados` | `{ MLB123: { visitas, vendas, capturadoEm, origem: { visitas: { trecho, tela, em, automatica }, vendas: {…} } } }` — o cache principal. Número sem `origem` não é exibido. |
| `mlmetrics_diagnostico` | `{ host, caminho (mascarado), quando, amostras, periodo }` — gravado quando a captura falha |
| `mlmetrics_origens` | até 3 URLs (sem query) de telas de vendedor que já entregaram números |
| `mlmetrics_erro` | `{ onde, mensagem, pilha, host, tela (mascarada), quando, versao }` — último erro inesperado da leitura (lote 24). Aparece em vermelho no popup e no relatório |
| `mlmetrics_conferencia` | `{ MLB123: { resultado: "bate"\|"nao", quando } }` — o que a vendedora marcou na conferência (lote 27). Gravado porque o popup fecha a cada clique fora dele |
| `mlmetrics_telas_falhando` | `{ "<tela mascarada>": { quando, versao } }` — telas que **já entregaram** números e pararam (lote 27). Vira o aviso laranja do popup |
| `mlmetrics_historico_<código>` | uma chave **por anúncio** (lote 26): `{ "AAAA-MM-DD": { visitas, vendas, origem: {…} } }` — um registro por dia no formato do cache, com o rastro de cada número; 400 dias. Ainda não é exibido. O manifest pede `unlimitedStorage` para o histórico nunca tirar espaço do cache. |
| `mlmetrics_ultima_busca` | timestamp da última busca automática (trava de 2 h). Com a busca desligada, a chave não é mais criada. |

### Fluxo

1. **`coletor.js`** roda em toda página do ML (`document_idle`) e a cada mutação do
   DOM — inclusive texto e link trocados no lugar (debounce de 600 ms, ignorando lotes
   só com mutações da própria extensão). Ele orquestra; as travas abaixo moram em
   `leitura.js` (`MLMetricsLeitura`) desde o lote 25. As travas, em ordem:
   1. `ehPaginaDeCompra(url)` — vitrine pública (host `produto.`/`articulo.` ou rota
      `/up/MLB…` / `/p/MLB…`, inclusive `/p/MLB…/s`) → não coleta.
   2. `paginaMencionaVisita(doc)` — sem "visita" fora do painel → nada.
   3. `TreeWalker` sobre nós de texto (sem `script`/`style`/`template`/`noscript`/
      `[hidden]`), amarrando cada número a um código `MLB…` pelo card
      (`contextoDoAnuncio`; card com link do item e do catálogo vale o item — #38). A
      leitura de cada rótulo (`lerRotulo`) monta a **fila de
      peças coladas** — número, rótulo, número… — e as pontas dizem o formato: começa
      com número → valor antes do rótulo; começa com rótulo → valor depois; pontas
      iguais → ambíguo, não lê. Número que não é contagem (data, hora, decimal, %,
      período, "mil", `R$`, `+N`, "desde 2024") é recusado (`motivoDoNumero`). Uma
      recusa — ou um nível com mais de 5 mil caracteres — para a subida no DOM.
   4. Visita exigida **por anúncio** — código sem visita lida nesta varredura fica
      de fora.
   5. `anotarImplausiveis` — vendas acima das visitas **não** descartam mais o anúncio
      (#40): os números ficam e o painel mostra um alerta.

   Cada número sai com o **rastro de origem** (`trechoDaLeitura`: o texto exato entre
   « », com 20 caracteres de contexto, mais a tela mascarada). A gravação vai por
   mensagem ao **service worker**, que mescla (`gravacao.js`: por métrica, rastro
   carimbado com a hora) e grava uma leitura de cada vez para todas as abas; se ele não
   responder, a aba grava sozinha pela mesma regra. Na mesma tarefa da fila, **depois**
   do cache e numa gravação separada, cada leitura entra no **histórico diário** do
   anúncio (`registrarDia`, lote 26): um registro por dia, só com as métricas lidas
   naquela varredura e com rastro; a última leitura do dia vence; 400 dias por anúncio.
   Falha no histórico nunca desfaz o cache. Depois mostra o toast verde e lembra
   o endereço da tela (nunca URL de anúncio isolado). Sem captura → `salvarDiagnostico` (trava de 3 min **por tela**).
   Se a extensão for recarregada, o script vira órfão e se desliga (`extensaoViva`).
   **Tela conhecida que parou de entregar** (lote 27): varredura sem captura numa tela
   que está em `mlmetrics_origens` marca `mlmetrics_telas_falhando`
   (`marcarTelaFalhando`); captura na mesma tela tira a marca (`limparTelaFalhando`).
   No máximo uma gravação por carregamento de página, e uma varredura vazia **depois**
   de uma captura não acusa nada (`estadoDaTela`).
   **Exceção inesperada na leitura não é mais silenciosa** (lote 24): `coletar()` inteiro
   fica em `try/catch` e `registrarErro` grava `mlmetrics_erro` (função, mensagem, 3
   linhas de pilha, tela mascarada, versão), com trava de 1 min para a mesma mensagem.
2. **`content.js`** roda em URL que contém `MLB…` (as contas e os formatos citados
   aqui moram em `calculo.js`, `MLMetricsCalculo`): monta os códigos candidatos
   (`codigosDaPagina`: `item_id`/`wid` da query ou do `#` primeiro, o caminho por
   último), usa o primeiro com número provado (`escolherRegistro`), **descarta número
   sem rastro de origem** (`somenteComOrigem`), lê o preço **só de dado estruturado**
   (`meta[itemprop=price]` ou JSON-LD) e monta o painel
   azul com botão de fechar. Passar o mouse sobre uma linha mostra de onde o número
   veio (ou a conta, nos calculados). A idade exibida é a da leitura mais antiga. Sem
   número conferido, **não há painel** (#46). Vendas acima das visitas → alerta no
   painel, sem conversão nem "vende a cada" (#40). O fechamento vale para aquele anúncio até o F5. Reage a
   troca de URL (poller de 1 s, que para quando o script fica órfão) e a
   `chrome.storage.onChanged` — só quando o registro do anúncio da tela mudou.
3. **Busca automática: DESLIGADA** (`BUSCA_AUTOMATICA_LIGADA = false` no coletor).
   Quando ligada, a cada 2 h o coletor pede ao **service worker** o HTML das origens
   aprendidas; o SW confere quem pediu e o endereço (só https no domínio do ML, também
   depois de redirecionamento), faz o `fetch` com a sessão e tempo limite de 20 s, e o
   content script parseia com `DOMParser` + `varrerPagina` e grava em silêncio.
   Desligada porque a tela de vendedor é montada por JavaScript, e o HTML buscado muito
   provavelmente não traz os números.
4. **Popup** (com a versão ao lado do nome):
   - **Aviso vermelho no topo** quando existe `mlmetrics_erro`: diz que a extensão
     falhou ao ler uma tela, quando foi, e manda copiar o diagnóstico (lote 24).
   - **Aviso laranja** quando existe `mlmetrics_telas_falhando`: uma tela que já trazia
     números parou de trazer, desde quando, e o que fazer (lote 27).
   - **Situação da aba** (lote 30): ao abrir, o popup pergunta à aba ativa e mostra uma
     linha azul dizendo o que há nela — aba do ML sem extensão ("aperte F5"), página de
     produto, tela de vendedor com N anúncios lidos, ou tela sem número ("copie o
     diagnóstico"). A URL da aba só é visível no domínio do ML (`host_permissions`), e é
     isso que separa "aba órfã" de "você não está no Mercado Livre".
   - **Conferência** (lote 27): cada anúncio com número conferível ganha "✓ bate" e
     "✗ não bate"; a marca vai para `mlmetrics_conferencia` (sobrevive ao popup fechar)
     e clicar de novo desmarca. **"Copiar conferência"** monta o texto pronto, com o
     resultado e o trecho « » de cada número.
   - "Limpar dados guardados" apaga todas as chaves `mlmetrics_`.
   - A lista mostra, embaixo de cada número, o rastro (trecho « », tela, hora).
     Registro sem rastro aparece como "sem origem (versão antiga)".
   - "Copiar diagnóstico" pede à **aba ativa** um diagnóstico na hora
     (`chrome.tabs.sendMessage` → `MLMetricsDiagnostico.diagnosticarTela`) e monta o relatório:
     `versao`, `telaAtual` (host, caminho mascarado, vitrine, mencionaVisita,
     capturariaAgora, **periodo** — textos de filtro de período, com `marcado` na opção
     escolhida (#47) —, **resumoDasRecusas** e **recusas** — por que cada rótulo não
     virou número —, amostras com até 12 por métrica; ou o erro "a aba não respondeu,
     aperte F5"),
     `ultimoErro`, `origens` mascaradas (pela regra do `leitura.js`, que o popup carrega
     desde o lote 26), `capturado`, `historico` (só o resumo: anúncios, registros,
     primeiro e último dia), `conferencia`, `telasFalhando` e
     `ultimoDiagnosticoGuardado`. O
     texto aparece sempre num `<textarea>`, além do clipboard.
5. **Envio para a cliente:** `powershell -ExecutionPolicy Bypass -File .\empacotar.ps1`
   → `dist\ML-Metrics-<versão>.zip`. Nunca zipar a pasta de trabalho.

---

## 4. Estado atual

| O quê | Situação |
|---|---|
| Revisão 1 (11/09) — #1 a #33 | ✅ corrigidos (lotes 1–8). Seção 6. |
| Página real (14/09) — #34 a #36 | ✅ corrigidos (lotes 10, 12 e 16). Seção 6. |
| Revisão 2 (14/09) — #37 a #55 | ✅ **17 resolvidos** (#37, #38, #39, #40, #41, #42, #43, #44, #45, #46, #48, #49, #51, #52, #53, #54, #55) · ⚠️ **parciais**: #47 (período aberto), #50 (decisão do repositório). |
| Pedido do Pedro (14/09) — #56 | ✅ **só dado com prova**: todo número exibido tem rastro de origem conferível (lote 20). |
| Relato da cliente (15/09) — #57 a #61 | ✅ **lote 21**: "no anúncio aparecem só as visitas" levou à troca da leitura por fila de peças (#57), à recusa de preço inteiro e faixa "+N" (#58), ao diagnóstico com o motivo de cada recusa (#59), à receita só com preço estruturado (#60) e a acabamentos (#61). |
| Pedido do Pedro (15/09) — lote 22 | ✅ "pode fazer tudo": limite de custo da leitura, teste no navegador versionado, testes da gravação, versão no popup, #38 (item + catálogo), #21 (gravação única no service worker) e as três decisões recomendadas — #46 (sem painel "Sem dados"), #40 (alerta em vez de descarte) e busca automática desligada. |
| Pedido do Pedro (15/09) — lote 23a | ✅ **período no diagnóstico** (preparo do #47): `telaAtual.periodo` traz os textos de filtro de período da tela ("Últimos 30 dias", intervalo de datas, abas, lista) e marca a opção escolhida. Não muda o que é gravado nem o painel. |
| Pedro (15/09) — 0.1.7 | ✅ robustez feita por ele: tempo limite do plano B (SW que não responde), `ehData` validando dia por mês, `try/catch` em volta do `new URL` (varrer e vitrine), `lastError.message` nas falhas de gravação. **Entrou sem caso de teste e sem registro aqui** — coberto no lote 24. |
| Pedido do Pedro (17/09) — lote 24 | ✅ **erro visível**: `coletar()` e o diagnóstico em `try/catch`, `mlmetrics_erro` no storage, aviso vermelho no popup e `ultimoErro` no relatório. Mais os testes que faltavam da 0.1.7 e o buraco que ela abriu (`31.04.2023` virava 31.042.023) fechado em `motivoDoNumero`. |
| Pedido do Pedro (17/09) — lote 25 | ✅ **`coletor.js` dividido** (2.015 → 696 linhas): a leitura foi para `leitura.js` e a montagem do diagnóstico para `diagnostico.js`; as contas e formatos do painel saíram do `content.js` para `calculo.js`. O harness **não recorta mais função do texto-fonte**: carrega os arquivos como são. Nenhum comportamento mudou. Junto, os quatro `var` da 0.1.7 viraram `const`/`let`. |
| Pedido do Pedro (18/09) — lote 26 | ✅ **histórico diário gravado** (ainda sem exibir): cada leitura entra num registro por dia e por anúncio, com rastro, para no futuro dar vendas/mês e faturamento/mês. `unlimitedStorage` no manifest. E o popup passou a usar a regra de mascarar do `leitura.js` em vez de uma cópia. |
| Pedido do Pedro (18/09) — lote 26b | ✅ **chaves do storage num lugar só**: `"mlmetrics_dados"` e as outras estavam escritas à mão em 5 arquivos; agora só no `gravacao.js`, e o harness recusa nome escrito à mão. Nenhum comportamento mudou. |
| Pedido do Pedro (21/09) — lote 27 | ✅ **conferência num clique** (marca "bate"/"não bate" por anúncio, gravada, e "Copiar conferência" com o texto pronto) e **aviso de tela que parou de entregar números** (laranja no popup, quando uma tela que já funcionou deixa de entregar). |
| Pedido do Pedro (21/09) — lote 28 | ✅ **verificação no Edge automatizada**: `node teste/verificar-no-edge.js` sobe o Edge com a extensão instalada e roda os 11 itens da antiga lista manual (**21/21**). Provado com defeito de propósito: quebrando o `extensaoViva` do `content.js`, o item do script órfão reprova. |
| Instalação do Pedro (24/09) — lote 29 | ✅ **painel aparecia em anúncio nenhum** numa rota `/up/MLBU…`: a URL só tem o código de user product, e o cache guarda o do ITEM — nunca casavam. Agora o painel procura o código do item **nos links da própria página** (`codigoDoItemNaPagina`), por dominância. Provado na página real salva. |
| Pedido do Pedro (25/09) — lote 30 | ✅ **o popup conta o que há na aba aberta**: aba do ML que não responde pede F5 (o tropeço que o próprio Pedro viveu em 24/09), página de produto explica que ali não se captura, tela de vendedor diz quantos anúncios está lendo — ou pede o diagnóstico quando não achou nada. |
| Pedido do Pedro (25/09) — lotes 31 e 32 | ✅ **número de anúncios capturados no ícone** (sinal de "estou viva" sem abrir o popup) e **o painel passou a funcionar em qualquer anúncio aberto**: em página de produto ele lê o "N vendido" **da própria página**, sem gravar nada, deixando claro de onde veio. Visitas continuam impossíveis ali — só o dono as vê. |
| Revisão 1 — resíduo #21 | ✅ corrida entre abas resolvida no lote 22 (gravação única no service worker). |
| Harness | **306/306 PASS** (+17 nos lotes 31 a 33: contagem do ícone e a leitura do "N vendido" da página de produto — número exato, faixa arredondada como piso, e as recusas que separam o número do anúncio do da reputação). `node --check` ok em todos os JS. |
| Teste em DOM real | ✅ **versionado** (lote 22): `node teste/servidor-teste.js` e abrir `http://127.0.0.1:5178/teste/rodar-no-navegador.html` → **57/57 PASS** (+8 no lote 27: aviso laranja no popup; marcar, copiar e desmarcar a conferência; tela conhecida que parou vira aviso; tela desconhecida não; tela que voltou a entregar sai do aviso). Cobre o gabarito de `publicacoes.html`, números antes dos rótulos em irmãos, leitura ambígua e o motivo no diagnóstico, card com item + catálogo (#38), painel completo, fechar, vendas acima das visitas (#40), anúncio sem dado sem painel (#46), item do `pdp_filters`, script órfão e o período no diagnóstico com controles reais (lista, radio, botão, campo de datas). |
| Verificação no Edge | ✅ **30/30 PASS** (lote 28): extensão instalada de verdade, a partir do ZIP de `dist/`. Cobre os 11 itens da lista manual e mede o custo da leitura numa página real salva — **888 KB: 3 ms no portão, 7 ms na varredura completa** (22/09). |
| Pacote | `dist\ML-Metrics-0.2.7.zip` (inclui `gravacao.js`). Zips anteriores apagados (superados). |

### ⚠️ Repositório público — decisão do Pedro

Em 14/09/2026, `https://github.com/albanopedro/extensaoML` respondeu **HTTP 200 sem
login**: o repositório é **público**. Ele contém este `contexto.md` (anotações sobre a
cliente e o diagnóstico dela) e, **no histórico do git**, o código `MLBU` e o slug reais
do anúncio salvo (já trocados por fictícios na versão atual dos arquivos). Apagar do
arquivo não tira do histórico. O caminho simples é **tornar o repositório privado** no
GitHub (Settings → General → Danger Zone → Change visibility). Claude não escreve em
git/GitHub — é ação do Pedro.

### Verificação com a extensão instalada — agora automática (lote 28)

```bash
node teste/verificar-no-edge.js            # sem janela
node teste/verificar-no-edge.js --com-janela   # para ver acontecendo
```

Sobe o Edge com a extensão **instalada** (o ZIP mais recente de `dist/`, que é o que a
cliente recebe), serve as fixtures como `https://www.mercadolivre.com.br/...` e roda os
11 itens abaixo — **21/21 PASS**. É o único teste onde existem service worker, mensagens
e `chrome.storage` de verdade. Precisa do Edge e do `openssl` (vem com o Git para
Windows); nada sai da máquina e o perfil do Edge é novo, sem login.

**O que ele NÃO cobre, e continua sendo de olho:** aparência do painel e do popup (cor,
posição, texto cortado) e qualquer coisa na tela real do Mercado Livre.

### Ver funcionando sem conta de vendedor (lote 29b)

```bash
node teste/abrir-demo.js
```

Abre o Edge **com janela**, com a extensão instalada e as telas de teste servidas no
endereço de verdade. Dá para ver o aviso verde da captura, o painel no anúncio, o rastro
« » no popup e a conferência — clicando, não lendo. Perfil descartável: o Edge do dia a
dia não é tocado. Encerra ao fechar a janela (ou Ctrl+C).

Serve quando não há conta de vendedor à mão — foi o caso em 24/09, quando o Pedro
instalou a extensão e, como não tem anúncio nenhum, não havia tela de vendedor real
onde ela pudesse capturar.

Os itens, todos cobertos pelo comando acima:

1. **#44** — numa aba do ML, ícone → "Copiar diagnóstico": o relatório tem `telaAtual`
   com `host`, `caminho` mascarado, `vitrine`, `mencionaVisita`, `capturariaAgora`,
   `periodo` e `amostras`. Numa tela com filtro de período, `periodo` lista o filtro e
   marca o escolhido (`marcado: true`). Com tudo funcionando, `ultimoErro` vem `null` e
   o popup não mostra o aviso vermelho.
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
8. **#21** — com duas telas de vendedor abertas em abas diferentes (F5 nas duas), o
   popup lista os anúncios das duas; nenhuma apaga o que a outra gravou.
9. **Popup** — o título mostra "ML Metrics v0.2.7".
10. **Histórico (lote 26)** — depois de capturar numa tela de vendedor, "Copiar
    diagnóstico": `historico.anuncios` > 0 e `historico.ultimoDia` = hoje. Em
    `edge://extensions` → Detalhes da ML Metrics, a extensão aceita a permissão nova
    (`unlimitedStorage` não mostra aviso). "Limpar dados guardados" zera o
    `historico`.
11. **Conferência (lote 27)** — no popup, marcar "✓ bate" num anúncio, **fechar** o
    popup e reabrir: a marca continua lá. "Copiar conferência" traz o resultado e o
    trecho « ». Clicar de novo no mesmo botão desmarca.

### Ação pendente (depois da verificação)

1. Enviar `dist\ML-Metrics-0.2.7.zip` à cliente, com o texto do
   **`MENSAGEM-CLIENTE.md`** (instalação em 4 passos e as 3 coisas que precisam voltar).
2. A cliente segue **"Depois de uma atualização"** do guia: substituir os arquivos na
   mesma pasta, recarregar a extensão, conferir a versão **0.2.7** (também no popup),
   **F5** nas abas do ML.
3. A cliente clica **"Limpar dados guardados"** (agora apaga também as origens
   envenenadas pelo build antigo).
4. A cliente abre **"Minhas publicações"**, espera carregar, clica em **"Copiar
   diagnóstico" nessa tela** e cola na conversa. Se as vendas ainda não aparecerem,
   `telaAtual.resumoDasRecusas` e `telaAtual.recusas` dizem o motivo exato. O
   `telaAtual.periodo` decide o #47 (período), e o mesmo `telaAtual` valida #38, #48 e
   #57 na tela real. **Salve o texto dela num arquivo e rode
   `node teste/ler-diagnostico.js <arquivo>`**: ele resume e diz o que aquilo decide.
5. A cliente faz a **conferência de 3 anúncios** (passo 7 do guia): no popup, marca
   **"✓ bate"** ou **"✗ não bate"** em cada um e clica em **"Copiar conferência"** —
   o texto já sai com os números e o trecho « » de cada um (lote 27).

### Teste na conta do Pedro (não feito)

Em 14/09 o Claude in Chrome não estava conectado. Com ele instalado e logado, e com a
autorização do Pedro, Claude pode abrir a tela de anúncios de uma conta do Pedro (se
ela tiver pelo menos um anúncio) só para ler a estrutura — sem salvar dado pessoal no
projeto. Seria o primeiro contato com a tela real antes da cliente.

### Maior risco aberto

Continua o mesmo desde o começo: **a tela real de vendedor nunca foi vista.** As três
tentativas de arquivo real vieram como vitrine pública. O período (#47) só se resolve
de verdade com ela; a leitura por fila (#57), a trava por anúncio (#48) e a regra do
card com item + catálogo (#38) foram feitas às cegas e precisam ser validadas nela. O
diagnóstico da aba ativa com motivos (#44, #59) e a conferência com rastro (#56) foram
feitos justamente para trazê-la e checá-la.

---

## 5. O que precisa ser feito — problemas abertos

Formato: `#ID [severidade] título` → onde / causa / evidência / impacto / direção.
Mantenha estes IDs estáveis: eu vou me referir a eles pelo número.

### 5.1 Pendências do projeto (funcionalidade — só isto falta em termos de código)

Depois do lote 26, **sobram três coisas de projeto**, e as três dependem da tela real
de vendedor (nunca vista — ver "Maior risco aberto" na seção 4):

| # | Sev. | Título | Status | Depende da tela real? | Lote |
|---|---|---|---|---|---|
| #47 | MÉDIO | Período (7/30 dias) não é registrado junto do rastro (observer resolvido no lote 21; o período já vem no diagnóstico desde o lote 23a) | ⚠️ parcial | Sim (período) | 23b |
| — | — | **Exibir vendas/mês e faturamento/mês** a partir do histórico diário (a gravação já existe desde o lote 26) | ⬜ | Sim — conferência dos 3 anúncios **e** #47 | 34 |
| — | — | Decisão: religar a busca automática? | ⬜ | Sim (o HTML buscado traz os números?) | — |

Nenhuma das três tem como avançar sem o `telaAtual.periodo`/`telaAtual` de uma tela de
vendedor real (via "Copiar diagnóstico" da cliente, ou de uma conta com anúncio, se
disponível). Não há mais nenhum item de código pendente fora destas três.

**Por que exibir o histórico depende do #47:** a conta "vendas do mês" muda de natureza
conforme o que a tela mostra. Se o número lido for o **total** do anúncio, vendas/mês é
a diferença entre o registro de hoje e o de 30 dias atrás. Se for um **recorte** ("últimos
30 dias"), a diferença não significa nada — o próprio número já é vendas/mês. Por isso
cada dia do histórico guarda o trecho « » e a tela: quando o #47 disser qual é o caso,
os registros já gravados continuam interpretáveis.

### 5.2 Pendências administrativas (não é código — fora do escopo do projeto em si)

Ficam aqui só para não se perder, mas **não bloqueiam nem dependem de trabalho de
código**: são decisões e ações do Pedro fora do repositório/extensão em si.

| # | Sev. | Título | Status | Quem resolve |
|---|---|---|---|---|
| #50 | MÉDIO | Privacidade no repositório GitHub (resíduo: repo público + histórico) | ⚠️ parcial | Pedro (GitHub) |
| — | — | Enviar a 0.2.7 à cliente (commits em dia; a verificação virou `node teste/verificar-no-edge.js`) | ⬜ | Pedro |

---

### GRUPO L — Painel e reatividade

#### #47 [MÉDIO] Período (7/30 dias) não é registrado — ⚠️ parcial

- **Já feito (lote 21):** o observer passou a ver texto e link trocados no lugar
  (`characterData` e `attributes: href`, no fim de `src/coletor.js`) e só ignora um lote de
  mutações quando **todas** são da extensão (`every`, `:1760`).
- **Já feito (lote 23a):** o diagnóstico traz `periodo` (`coletarTextosDePeriodo`,
  hoje em `src/diagnostico.js`): textos curtos de filtro de período da tela — "Últimos 30 dias",
  "Este mês", intervalo de datas, inclusive no valor de um campo — com `marcado` quando
  o controle (lista, radio, aba, botão) diz qual está escolhido. Vocabulário fechado
  (`ehTextoDePeriodo`), no máximo 20 textos, sem campo escondido, de senha, e-mail ou
  telefone. Só diagnóstico: não muda gravação nem painel.
- **Falta:** nada registra o **período** do número lido. Se a tela estiver com filtro
  de 30 dias, o painel mostra essas visitas como se fossem o total. (Desde o lote 20 o
  painel diz só "Visitas", e o rastro mostra o texto exato que foi lido.)
- **Direção (lote 23b):** com o `telaAtual.periodo` da tela real, decidir como ler o
  filtro escolhido e guardar o período junto do rastro.

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
| #18 | MÉDIO | Painel vazio em qualquer anúncio | ✅ | 4, 22 | o painel "Sem dados" deixou de existir (#46) |
| #19 | MÉDIO | Conversão 0% exibida como "sem dado" | ✅ | 4, 19 | 0/0 e 3/0 resolvidos no #39 |
| #20 | MÉDIO | Diagnóstico capturava demais | ✅ | 6, 11, 18 | caminho mascarado (#44), origens mascaradas (#50) |
| #21 | MÉDIO | Sobrescrita concorrente entre abas | ✅ | 5, 22 | gravação única no service worker (`gravacao.js` + fila do `background.js`); testado com três gravações simultâneas |
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
| #38 | CRÍTICO | Card com link do item e do catálogo era ignorado | ✅ | 21, 22 | Lote 21: exibição (`codigosDaPagina` + `escolherRegistro`). Lote 22: `codigosDentroDe` separa os links de item dos de catálogo (`/p/`) e user product (`/up/`); um item só → é dele; dois itens → continua ambíguo. **Validar na tela real.** |
| #40 | ALTO | Vendas acima das visitas descartavam o anúncio | ✅ | 22 | Decisão (recomendação aceita): mostrar com alerta. `anotarImplausiveis` não descarta, só avisa (console e diagnóstico); `calcular` marca `vendasAcimaDasVisitas` e deixa conversão e "vende a cada" em branco; o painel mostra o alerta. |
| #46 | MÉDIO | Painel "Sem dados" em anúncio de qualquer vendedor | ✅ | 22 | Decisão (recomendação aceita): sem painel quando não há número conferido; `montarPainelVazio` removido; a dica ficou no popup. |
| #53 | BAIXO | Harness frágil e com lacunas | ✅ | 21, 22 | Extração robusta (lote 21); `gravacao.js` e o service worker testados no Node, com três gravações simultâneas (lote 22); teste em DOM real versionado (`teste/servidor-teste.js` + `teste/rodar-no-navegador.html`, 31 casos). |
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

### Lote 22 — decisões e acabamentos (15/09/2026)

| Item | O que foi feito |
|---|---|
| Busca automática | **Desligada** (`BUSCA_AUTOMATICA_LIGADA = false`, recomendação aceita). O código e o atendimento validado no service worker ficam prontos para religar se a tela real mostrar que o HTML buscado traz os números. Guia da cliente: a extensão não faz nada por conta própria. |
| Custo da leitura | `LIMITE_TEXTO_POR_NIVEL = 5000`: a busca pelo valor para de subir num bloco maior que isso (medido: ~7 ms por leitura num bloco de 100 mil caracteres, repetido por rótulo e por nível). |
| Versão no popup | "ML Metrics v0.1.5" ao lado do nome; o guia manda conferir ali. |

### Lote 23a — período no diagnóstico (15/09/2026)

| Item | O que foi feito |
|---|---|
| #47 (preparo) | `coletarTextosDePeriodo`, `ehTextoDePeriodo` e `estadoDoControle` em `coletor.js`; `telaAtual.periodo` e `mlmetrics_diagnostico.periodo`. O filtro costuma ficar longe dos rótulos, fora da janela das amostras: sem isso, o primeiro diagnóstico da cliente não diria de quando são os números. |
| Guia da cliente | "Copiar diagnóstico" explica que o relatório traz o período e qual está escolhido. |
| Testes | Harness +30 (vocabulário, stub com botão, abas aria, lista, campo, exclusões e limite) → **221/221**; navegador +6 com controles reais (`option.selected`, `label.control.checked`, `aria-pressed`, `input.value`) → **37/37**. `manifest.json` → **0.1.6**, zip gerado. |

### 0.1.7 — robustez feita pelo Pedro (15/09/2026)

Commit `2fedda6`, sem caso de teste e sem registro aqui na época. O lote 24 cobriu as
quatro mudanças com teste:

| Item | O que mudou |
|---|---|
| Plano B por tempo | `TIMEOUT_PLANO_B_MS = 3000` no `salvar`: se o service worker não responder (pode ser derrubado no meio da fila), a aba grava sozinha. Antes, só o `lastError` disparava o plano B — resposta que nunca chega deixava a leitura sem ninguém. |
| `ehData` por calendário | Valida o dia máximo de cada mês (fevereiro aceita 29). **Efeito colateral:** afrouxou o `motivoDoNumero` — ver lote 24. |
| URL inválida | `try/catch` em volta do `new URL` em `varrerPagina` (rastro vira "(url invalida)") e em `ehPaginaDeCompra` (devolve `false`). |
| Mensagem do `lastError` | Falha de gravação (quota, contexto inválido) agora leva a mensagem ao console e à resposta do service worker. |

### Lote 24 — erro visível e a dívida da 0.1.7 (17/09/2026)

| Item | O que foi feito |
|---|---|
| Falha silenciosa na leitura | `coletar()` inteiro em `try/catch` + `registrarErro`: grava `mlmetrics_erro` (função, mensagem, 3 linhas de pilha, host, tela mascarada, hora, versão), com trava de 1 min por mensagem repetida — o observer chama a leitura a cada 600 ms. O diagnóstico do popup também ficou protegido: se `diagnosticarTelaAtual` quebrar, a resposta é o erro, não o silêncio que virava "aperte F5". |
| Erro que aparece | Aviso vermelho no topo do popup ("a extensão teve um erro ao ler uma tela em …, clique em Copiar diagnóstico") e `ultimoErro` no relatório. Sem erro, nada aparece. |
| Buraco aberto pela 0.1.7 | `ehData` mais rigoroso deixou de reconhecer data inválida, e `31.04.2023` passava a valer **31.042.023 visitas**. `motivoDoNumero` passou a recusar a **forma** de data com ponto (`\d{1,2}.\d{1,2}.\d{2,4}`); milhar de verdade ("1.299.500") não casa porque o grupo do meio tem três dígitos. |
| Testes que faltavam | Harness +10 (dia por mês, data inválida com ponto e com barra, milhar preservado, URL quebrada na varredura e na vitrine) → **231/231**. Navegador +5 (erro na leitura virando registro, sem inventar métrica; plano B por tempo com service worker mudo) → **42/42**. `manifest.json` → **0.1.8**, zip gerado. |

### Lote 25 — `coletor.js` dividido (17/09/2026)

Pedido do Pedro, depois da sugestão "quebrar o coletor.js e apagar o extrator do harness".
**Nenhum comportamento mudou**: é o mesmo código em outros arquivos.

| Item | O que foi feito |
|---|---|
| Divisão | `coletor.js` (2.015 linhas) virou `leitura.js` (1.084: fila de peças, motivos, card, varredura, vitrine, caminho mascarado), `diagnostico.js` (353: amostras, período, `diagnosticarTela`, recusas) e `coletor.js` (696: observer, gravação, diagnóstico guardado, erros, popup). Do `content.js` (747) saiu `calculo.js` (353: códigos da URL, número com prova, contas, formatos); ficaram 435 linhas. Cada módulo novo segue o padrão do `gravacao.js`: `var MLMetricsX = (function () { … return {…}; })();`. |
| Como foi feito | Um script copiou o **texto exato** de cada função (comentários inclusive) para o arquivo novo e prefixou as chamadas entre arquivos (`MLMetricsLeitura.varrerPagina`…). Conferido: toda linha do original está em algum arquivo novo, menos as 19 alteradas de propósito; nenhuma chamada entre arquivos ficou sem prefixo. |
| Mudança de assinatura | `diagnosticarTelaAtual()` virou `diagnosticarTela(doc, local)`: o coletor passa `document` e `window.location`. Só isso deixou de ler global. |
| Manifest | `content_scripts.js` na ordem `gravacao → leitura → diagnostico → coletor → calculo → content`. Fora de ordem, o script morre ao carregar sem nem o `registrarErro` para contar — por isso o harness confere a ordem (e falha, testado trocando a ordem de propósito). |
| Harness | Saíram o scanner de chaves (`fimDoBloco`) e os extratores (`extrairFuncao`, `extrairConst…`, `eval`): `carregarModulo` roda cada arquivo com `new Function`, como o navegador. +6 casos (ordem do manifest) → **237/237**. |
| Teste no navegador | Listas `SCRIPTS_COLETOR`, `SCRIPTS_PAINEL` e `SCRIPTS_TODOS` na ordem do manifest → **42/42**. |
| Acabamento (item 3) | Os quatro `var` da 0.1.7 viraram `const`/`let`; `ehPaginaDeCompra` passou a ler a URL uma vez só. |
| Versão | `manifest.json` → **0.1.9**; zip com 15 entradas, inclusive os três arquivos novos. |

### Lote 26 — histórico diário gravado e popup sem cópia de regra (18/09/2026)

Pedido do Pedro: "gravar agora, sem mostrar nada" (item 1) e tirar a duplicação do popup
(item 2). Gravar desde já porque vendas/mês precisa de um mês de leituras; mostrar só
depois da conferência dos 3 anúncios e do #47 (ver seção 5.1).

| Item | O que foi feito |
|---|---|
| Regra | `gravacao.js`: `registrarDia(historico, novo, agora, automatica)` — só métricas **lidas nesta varredura e com rastro** (número que só está no cache, lido outro dia, não vira dado de hoje); um registro por dia no formato do cache (número + origem com trecho, tela, hora, automática); número novo no mesmo dia vence (fechamento); o mesmo número relido não regrava e mantém o rastro da primeira leitura; poda em `DIAS_DE_HISTORICO = 400`. Mais `diaDe` (dia **local**, "AAAA-MM-DD") e `chaveDoHistorico` (`mlmetrics_historico_<código>`). |
| Onde grava | `background.js` (`gravarHistorico`) e plano B da aba (`gravarHistoricoNestaAba` no `coletor.js`): na **mesma tarefa da fila** do cache, **depois** dele e numa gravação separada. Uma chave por anúncio — gravar um dia não reescreve o histórico dos outros. Falha no histórico nunca desfaz o cache; exceção nele chama `pronto()` mesmo assim, para a fila não travar. |
| Limite conhecido | Só grava quando o cache mudou ou foi renovado (a cada 2 min por anúncio). Perto da meia-noite, o dia novo só ganha registro na leitura seguinte. |
| Espaço | `"unlimitedStorage"` no manifest. Sem ele a cota é 10 MB, e centenas de anúncios × 400 dias a encheriam — cota cheia impede o **cache** de gravar. Permissão sem aviso de instalação. O harness confere que ela está lá. |
| Popup (item 2) | `popup.html` carrega `leitura.js` e `gravacao.js` antes do `popup.js`. `enderecoMascarado` usa `MLMetricsLeitura.caminhoMascarado` (acabou a cópia da regra de privacidade). Relatório ganhou `historico`: só contagens e datas (`anuncios`, `registros`, `primeiroDia`, `ultimoDia`), nunca os números de cada dia. |
| Guia da cliente | "O que a extensão faz por conta própria" explica a anotação diária, só no navegador dela, e que "Limpar" apaga junto. |
| Testes | Harness +24 → **261/261** (regras do histórico; histórico no SW com três gravações simultâneas; remetente de fora não cria histórico; ordem dos scripts do `popup.html` pela mesma `conferirOrdem` do manifest; `unlimitedStorage`). Navegador +7 → **49/49** (histórico gravado pela aba na fixture; popup de verdade aberto como `srcdoc` com `chrome` falso). `manifest.json` → **0.2.0**. |

### Lote 26b — chaves do storage num lugar só (18/09/2026)

Pedido do Pedro ("arroche"). **Nenhum comportamento mudou.**

| Item | O que foi feito |
|---|---|
| Problema | Os nomes das chaves estavam escritos à mão em 5 arquivos (`background.js`, `coletor.js`, `content.js`, `popup.js` e o prefixo do histórico no `gravacao.js`): 12 declarações. Erro de digitação em uma delas quebraria a extensão sem erro nenhum — a aba gravaria num nome e o painel leria de outro. |
| Solução | `gravacao.js` define `PREFIXO_CHAVES` e `CHAVES` (congelado com `Object.freeze`), porque é o único arquivo carregado em todos os lugares: service worker, abas e popup. Os outros arquivos mantêm os nomes locais (`CHAVE_CACHE`...), mas o valor vem de `MLMetricsGravacao.CHAVES`. |
| Ordem | `content.js` passou a usar o `gravacao.js` — já é o primeiro do manifest; a `conferirOrdem` do harness confere. O teste no navegador carrega o `gravacao.js` também nos cenários só do painel. |
| Testes | Harness +6 → **267/267**: valores presos (renomear uma chave faria a versão nova não achar o que a antiga gravou), todos com o prefixo do "Limpar", `CHAVES` congelado, e **nenhum arquivo de `src/` além do `gravacao.js` com `"mlmetrics_` escrito à mão**. Navegador **49/49**. `manifest.json` → **0.2.1**. |

### Lote 27 — conferência num clique e aviso de tela que parou (21/09/2026)

Pedido do Pedro, depois de eu apontar que os dois atacam o mesmo problema: descobrir
cedo quando alguma coisa não está batendo. A conferência é o passo que destrava o
projeto, e ela dependia de a cliente anotar números à mão.

| Item | O que foi feito |
|---|---|
| Conferência no popup | Cada anúncio com número conferível ganha **"✓ bate"** e **"✗ não bate"**. A marca vai para `mlmetrics_conferencia` — gravada porque o popup **fecha** a cada clique fora dele, e ela precisa sobreviver à ida até a tela do ML. Clicar de novo no mesmo botão desmarca (erro de clique não pode virar resultado errado). O resumo mostra quantos foram conferidos. |
| "Copiar conferência" | Botão principal do popup: monta o texto pronto para colar na conversa, com "BATEU"/"NÃO BATEU" por anúncio, os números e **o trecho « » de cada um** — sem o trecho, "não bateu" não dá para consertar. Usa o mesmo `entregarTexto` do diagnóstico (clipboard + textarea, extraído da duplicação). |
| Tela que parou de entregar | `marcarTelaFalhando` / `limparTelaFalhando` no `coletor.js` + `ehOrigemConhecida` no `leitura.js`. Varredura sem captura numa tela **que já entregou números** grava `mlmetrics_telas_falhando`; a primeira hora é mantida (diz há quanto tempo parou); captura na mesma tela tira a marca. `estadoDaTela` garante uma gravação por carregamento e impede falso alarme depois de uma captura. |
| Por que isso importa | Quando o ML muda o layout, a extensão para de capturar **em silêncio** e o painel segue mostrando a última leitura — número velho com cara de novo. Agora vira aviso laranja no popup, e o guia diz o que fazer. |
| Guia da cliente | Passo 7 reescrito para os botões e o "Copiar conferência"; "O que me contar" ganhou o aviso laranja. |
| Testes | Harness +4 → **271/271** (`ehOrigemConhecida`: mesma URL, query ignorada, outra tela, sem origens). Navegador +8 → **57/57** (aviso laranja; marcar, copiar e desmarcar; tela conhecida que parou; tela desconhecida que não acusa; tela que voltou e saiu do aviso). `manifest.json` → **0.2.2**. |

### Lote 28 — a verificação no Edge virou comando (21/09/2026)

Pedido do Pedro. **Nenhuma mudança na extensão** — só ferramenta de teste (`teste/`).
Antes, toda versão exigia o ritual: abrir o Edge, carregar a extensão, passar por telas
e conferir 11 itens na mão.

| Item | O que foi feito |
|---|---|
| Como funciona | `teste/edge-cdp.js` sobe o Edge **sem janela**, com perfil descartável e a extensão carregada por `--load-extension` (com `--disable-features=DisableLoadExtensionCommandLineSwitch`, exigido desde o Chromium 137). `--host-resolver-rules` manda `*.mercadolivre.com.br` para um servidor HTTPS local com as fixtures, e `--ignore-certificate-errors` aceita o certificado gerado na hora pelo `openssl`. Assim as páginas de teste têm o **endereço de verdade**, que é o que faz o manifest injetar os content scripts. A conversa com o navegador é por CDP, em WebSocket — o do próprio Node, sem dependência nova. |
| O que ele carrega | O **ZIP mais recente de `dist/`**, descompactado num diretório temporário: é o que a cliente recebe, então o empacotamento entra na conta (já aconteceu de arquivo novo não entrar no zip). `--extensao=<pasta>` aponta para outra cópia. |
| Os 21 casos | Captura numa tela de vendedor real (storage e service worker de verdade) e rastro; histórico do dia; diagnóstico da aba ativa com travas, período, amostras e recusas; aba fora do ML que não responde; duas telas de vendedor sem uma apagar a outra; painel no anúncio e o fechar que dura; popup com versão, rastro, conferência que sobrevive a reabrir, texto pronto e "Limpar"; e a extensão recarregada deixando a aba órfã — painel some, aba não responde, e volta depois do F5. |
| Prova de que reprova | Rodado contra uma cópia com defeito de propósito (`extensaoViva` do `content.js` devolvendo sempre `true`): o item do script órfão **falhou**, como devia. Teste que nunca reprova não vale nada. |
| Esperas | Nada de `sleep` fixo: cada passo espera a condição acontecer (`ate`). A primeira versão passava por causa de dado da rodada anterior — hoje o perfil do Edge é apagado a cada execução. |
| O que continua de olho | Aparência do painel e do popup, e a tela real do Mercado Livre. |

### Lote 28b — custo medido e mensagem pronta (22/09/2026)

| Item | O que foi feito |
|---|---|
| Custo da leitura | A verificação no Edge passou a medir, **dentro do mundo isolado da extensão** (`rodarNaExtensao`), quanto custa ler uma página real salva em `teste/` — as que têm dado da cliente e ficam fora do repositório. Em 888 KB: **3 ms** no portão (`paginaMencionaVisita`, que roda a cada lote de mutações em qualquer página do ML) e **7 ms** na varredura completa (com um rótulo plantado, já que a página salva é vitrine). Limites de 100 ms e 500 ms, para pegar regressão grande sem falhar em máquina ocupada. Sem página salva, o caso é **pulado**, não falha. → **23/23**. |
| Mensagem pronta | `MENSAGEM-CLIENTE.md`: o texto para mandar junto com o zip (instalar em 4 passos, e depois diagnóstico + conferência dos 3 anúncios), mais a lista do que precisa voltar. Tira o atrito do passo que está travando o projeto. |

### Lote 33 — venda arredondada vira piso, não silêncio (25/09/2026)

Pedro abriu outro anúncio e não apareceu painel: a página dizia **"Novo | +25 vendidos"**,
e a regra do lote 32 recusava faixas arredondadas. Recusar era seguro, mas deixava a
extensão muda em boa parte dos anúncios — os que mais vendem.

| Item | O que foi feito |
|---|---|
| A âncora | O número do próprio anúncio vem junto da **condição**: "Novo \| 1 vendido", "Usado \| +1.000 vendidos". Os produtos recomendados da mesma página aparecem como "+100 vendidos", **sem condição**. Conferido nas duas páginas reais salvas: o subtítulo com condição existe uma vez só. `vendidosDaPagina` passou a procurar esse padrão primeiro e, sem ele, cai na regra antiga (um único número exato na página). |
| Como aparece | Vendas: **"+25"** — com o sinal, para ninguém ler como total exato. Receita: **"a partir de R$ 497,50"**. O title explica: "o Mercado Livre arredonda esse número nesta página: o total real é maior que 25". |
| O que continua fora | "+10mil vendidos": abreviação de milhar não vira número. Melhor nada do que 10 lido como dez mil, ou 10 mil lido como 10. |
| Testes | Harness +6 → **306/306**; navegador +2 → **71/71** (o "+25" no painel e a receita "a partir de"); Edge **30/30**. A fixture sanitizada ganhou o preço em dado estruturado, como na página real. `manifest.json` → **0.2.7**. |

### Lote 32 — o painel em qualquer anúncio (25/09/2026)

Pedido do Pedro: *"quero que a extensão funcione em qualquer publicação que eu abrir"*.
Antes, sem número capturado daquele anúncio, não havia painel nenhum — e para quem não é
dono do anúncio isso é sempre o caso.

| Item | O que foi feito |
|---|---|
| O que dá para ler numa página de produto | **"N vendido"** do anúncio e o preço. **Visitas não existem ali** — o ML só as mostra para o dono. Sem visitas, não há conversão nem "vende a cada"; sobra vendas e receita estimada. |
| A trava | `vendidosDaPagina(doc)` no `leitura.js`: só a palavra "vendido/vendida" (a reputação do vendedor fala em "vendas"); número exato colado ao rótulo; "+100", "+1.000" e "+10mil" caem nas recusas que já existiam; e **se sobrar mais de um valor diferente na página, não devolve nada**. Conferido na página real salva: o anúncio aparece uma vez ("Novo \| 1 vendido") e todo o resto é "+N vendidos" das vitrines de recomendação. |
| Não grava | O número lido da página **não entra no cache**. Misturar origem pública com o que vem das telas de vendedor foi o desastre do lote 16 (137 anúncios falsos guardados). Aqui ele é lido, mostrado e esquecido. |
| Diz de onde veio | Rodapé: "Lido desta página de produto, agora." Mais a linha "as visitas não aparecem em página de produto: o Mercado Livre só mostra isso para quem é dono do anúncio". O rastro de cada número continua no title. |
| Testes | Harness +6 → **300/300** (número exato, faixas arredondadas, dois valores = ambíguo, painel da própria extensão ignorado, "vendas" da reputação não conta). Navegador +4 → **69/69**. Edge +1 → **30/30**, na **página real salva**: o painel aparece com o vendido lido dela. `manifest.json` → **0.2.6**. |

### Lote 31 — número de anúncios no ícone (25/09/2026)

| Item | O que foi feito |
|---|---|
| Por quê | Para saber se capturou, era preciso abrir o popup. O número no ícone responde de relance — e ficar vazio depois de uma passada por "Minhas publicações" também é resposta. |
| Como | `contarConferiveis` no `gravacao.js` (mesmo critério do painel: número **com rastro**) e `atualizarDistintivo` no `background.js`, chamado pelo `chrome.storage.onChanged` e a cada acordada do service worker — que o MV3 desliga quando fica ocioso. Vazio quando é zero (um "0" no ícone parece defeito); acima de 99 vira "99+". |
| Testes | Harness +4 → contagem pura e o ícone acompanhando três gravações simultâneas no service worker. Edge +2: o número bate com o capturado, e some depois de "Limpar dados guardados". |

### Lote 30 — o popup contando o que há na aba (25/09/2026)

Pedido do Pedro, depois de ele mesmo tropeçar: reinstalou a extensão, a aba do ML já
estava aberta (sem extensão rodando nela) e o popup só dizia "nenhum anúncio capturado".
Verdade, mas inútil — não dava para saber que faltava um F5.

| Item | O que foi feito |
|---|---|
| Como funciona | Ao abrir, o popup chama o `pedirDiagnosticoDaAba` que já existia (agora devolvendo também a aba) e mostra uma linha azul no topo, decidida por `situacaoDaAba`. |
| As frases | Aba do ML que não responde → **"aperte F5 nela"**; aba fora do ML → "abra uma página do Mercado Livre"; vitrine → "aqui a extensão não lê números, eles vêm de Minhas publicações"; tela de vendedor com captura → **"estou lendo N anúncio(s) nesta tela"**; tela de vendedor sem número → "clique em Copiar diagnóstico"; tela que nem fala em visitas → "abra Minhas publicações". |
| Como separa órfã de "não é o ML" | A URL da aba só chega quando ela é do Mercado Livre — é o que o `host_permissions` deixa ver, sem pedir a permissão "tabs". |
| Testes | Navegador +6 → **65/65**: o `chrome` falso ganhou uma aba de mentira (`{ url, resposta }`), e cada frase tem um caso. Harness **289/289** e Edge **27/27** seguem. `manifest.json` → **0.2.4**. |

### Lote 29 — o painel achando o item dentro da página (24/09/2026)

Pedro instalou a extensão e abriu um anúncio real: **nada apareceu**. O popup dizia
"nenhum anúncio capturado", que estava certo — mas havia um segundo defeito escondido
atrás disso.

| Item | O que foi feito |
|---|---|
| O defeito | Na rota nova (`/kit-2-…/up/MLBU5098…?pdp_filters=seller_id:…`) **não existe código de item na URL**: o painel procurava pelo `MLBU…`, e o cache só tem o `MLB…` do item, gravado em "Minhas publicações". Mesmo com o número capturado, o painel não apareceria ali. Era a metade da exibição do #38, que tinha ficado aberta. |
| A evidência | As duas páginas reais salvas em `teste/` (fora do repositório): o item da própria página aparece **24 vezes** nos links (`pdp_filters=item_id:MLB…`, `wid=MLB…`), e **cada** produto recomendado aparece **1 vez**. |
| A regra | `codigoDoItemNaPagina(doc)` no `calculo.js`: conta os códigos de item nos `href` da página (aceitando `%3A` e `%253A`) e só devolve o campeão se ele aparecer ao menos **3 vezes** e **3× mais** que o segundo. Sem vencedor claro, devolve `null` e o painel segue com o que a URL diz — a mesma política de "na dúvida, não mostra". |
| Onde entra | `chaveDaPagina()` no `content.js` põe o item na frente dos códigos da URL, **só quando a URL já identifica um anúncio** (numa tela de lista não se procura nada). O resultado fica guardado por endereço: o poller chama isso a cada segundo. |
| Custo | 0 ms na página real de 888 KB (medido na verificação do Edge). |
| Testes | Harness +6 → **289/289** (dominância, `wid`, `%253A`, poucas ocorrências, empate, nenhum link). Navegador +2 → **59/59**: a vitrine sanitizada passou a ter links de item e responde também na rota `/kit-2-caixa/up/MLBU0000000001`. Edge +4 → **27/27**, incluindo **a página real salva**: a extensão acha o código dentro dela, semeamos o cache com esse código e o painel aparece — o caso exato do print do Pedro. `manifest.json` → **0.2.3**. |

### Lote 28c — leitor do diagnóstico (24/09/2026)

Pedido do Pedro. Só ferramenta (`teste/`), nada em `src/`.

```bash
node teste/ler-diagnostico.js diagnostico.json     # ou:  ... < conferencia.txt
```

| Item | O que foi feito |
|---|---|
| O que faz | Lê **os dois** textos que a cliente cola — o JSON do "Copiar diagnóstico" e o texto do "Copiar conferência" — e escreve um resumo curto: versão dela (avisa se for antiga), erro gravado, telas que pararam, a tela do clique com as travas, **o período (que decide o #47)**, recusas por motivo com um exemplo de trecho, o que está guardado, histórico, origens e conferência. |
| O que importa | Termina em **"O QUE ISSO DECIDE"**: conclusões prontas, do tipo "o diagnóstico saiu de uma página de produto, peça outro em Minhas publicações", "#47: a tela está filtrada em Últimos 30 dias", "N anúncios não bateram: compare o trecho « » com o número certo". Linhas quebradas em 78 colunas. |
| Privacidade | O arquivo colado tem texto das telas dela (nome de produto nos trechos). O `.gitignore` passou a cobrir `diagnostico*.json/txt` e `conferencia*.txt`, para não commitar sem querer. O leitor só imprime: não grava nem envia nada. |
| Testes | Harness +12 → **283/283**: período marcado e ausente, vitrine, tela sem "visita", erro, motivo de recusa mais comum, versão antiga, conferência que bateu e que não bateu, quebra de linha e texto colado errado (não estoura). |

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

O lote 22 fechou tudo o que dependia só de código ou de decisão: gravação única entre
abas, testes reproduzíveis no navegador, e três decisões de produto a favor de mostrar
só o que é conferível — nada de painel "Sem dados", alerta em vez de descarte e nenhuma
consulta automática com a sessão dela. O que sobrou depende da tela real.

O lote 23a preparou essa tela: o diagnóstico agora também diz **de quando** são os
números (textos de filtro de período, com a opção escolhida), para o #47 se resolver já
na primeira rodada da cliente.

O lote 24 fechou o último jeito de a extensão falhar sem contar: exceção no meio da
leitura. Ela não mata mais o observer em silêncio — vira registro, aviso vermelho no
popup e linha no relatório. Junto veio a lição da 0.1.7: mudança sem caso de teste
abriu um buraco (data inválida virando milhão de visitas) que ninguém teria visto.

O lote 25 não mudou o que a extensão faz, e sim o custo de mexer nela: a leitura, o
diagnóstico e as contas do painel viraram arquivos próprios, e o teste passou a
carregar esses arquivos como eles são. Mudar o formato de uma função não quebra mais o
teste por engano — agora, se o teste quebra, é a função.

O lote 26 começou a juntar o dado que nenhuma tela do ML dá: quanto cada anúncio tinha
em cada dia. Ainda não aparece nada — a leitura precisa passar pela conferência antes de
virar um mês de conta. Mas cada dia gravado carrega o próprio rastro, então, quando a
tela real disser o que o número significa (#47), o histórico já estará lá, conferível.

---

## 8. Ordem de correção sugerida

| Ordem | Lote | IDs | Status | Por quê |
|---|---|---|---|---|
| — | 17 — Preparar o teste real | #42, #43, #50, #51 | ✅ (#50 ⚠️) | Feito em 14/09. |
| — | 18 — Diagnóstico confiável | #44 | ✅ | Feito em 14/09. |
| — | 19 — Correções independentes | #39, #41, #45, #52, #55 | ✅ | Feito em 14/09. |
| — | 20 — Só dado com prova | #37, #48, #56 | ✅ | Feito em 14/09. |
| — | 21 — Robustez geral (relato da cliente) | #57–#61, #49, #54; parte de #38, #47, #53 | ✅ | Feito em 15/09. |
| — | 22 — Tudo que não dependia da tela real | #21, #38, #40, #46, #53; limite de custo; versão no popup; busca desligada | ✅ | Feito em 15/09. |
| — | 23a — Período no diagnóstico | #47 (preparo) | ✅ | Feito em 15/09. |
| — | 0.1.7 — robustez (Pedro) | — | ✅ | Feito em 15/09, testado no lote 24. |
| — | 24 — Erro visível + dívida da 0.1.7 | — | ✅ | Feito em 17/09. |
| — | 25 — `coletor.js` dividido + harness sem extrator | — | ✅ | Feito em 17/09. |
| — | 26 — Histórico diário gravado + popup sem cópia de regra | — | ✅ | Feito em 18/09. Exibir fica para o lote 29. |
| — | 26b — Chaves do storage num lugar só | — | ✅ | Feito em 18/09. |
| — | 27 — Conferência num clique + aviso de tela que parou | — | ✅ | Feito em 21/09. |
| — | 28 — Verificação no Edge automatizada | — | ✅ | Feito em 21/09. Só `teste/`. |
| 1 | **Enviar a 0.2.7 + decisão do repositório** | #50 | ⬜ | Seção 4. O commit e a verificação dos 11 itens já estão resolvidos (lote 28). |
| 2 | **★ Ação — capturar "Minhas publicações" real + conferência de 3 anúncios** | — | ⬜ | "Copiar diagnóstico" na tela (`telaAtual`, com `resumoDasRecusas`) e passo 7 do guia. Decide #47 e valida #38, #48 e #57. |
| 3 | **23b — Período no rastro** | #47 | ⬜ | Com o `telaAtual.periodo` da tela real, registrar o recorte (7/30 dias) junto do rastro. |
| 4 | **Decisão — religar a busca automática?** | — | ⬜ | Só se a tela real mostrar que o HTML buscado traz os números. |
| — | **Contínuo** | #53 | ⬜ | Cada lote entra com casos no harness. |

---

## 9. Como me pedir para trabalhar

Exemplos do que dizer numa nova conversa, depois de colar este arquivo:

- `"chegou o diagnóstico da tela real, vamos no lote 23b"`
- `"resolve o #47"`
- `"me mostra o que o diagnóstico da cliente diz antes de mexer"`
- `"vale religar a busca automática?"`

O que eu espero de você em cada rodada:

1. Ler o trecho de código real (os números de linha podem ter mudado).
2. Explicar a correção em uma ou duas frases antes de escrever código.
3. Aplicar mantendo o padrão de comentários do projeto.
4. Acrescentar o caso de teste e rodar os três: `node teste/test-parsing.js`, a página
   `teste/rodar-no-navegador.html` (com `node teste/servidor-teste.js`) e, quando mexer
   em algo que depende do navegador, `node teste/verificar-no-edge.js`.
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
| 22 — Tudo que não dependia da tela real | ✅ feito | 15/09/2026 | Pedido do Pedro: "pode fazer tudo". **Limite de custo:** `LIMITE_TEXTO_POR_NIVEL = 5000` em `valorDoRotulo` (medido ~7 ms por leitura em bloco de 100 mil caracteres). **#21:** `src/gravacao.js` (regra pura de mesclar, carregada no SW e nas abas) + fila única no `background.js` (`gravarNaFila`, mensagem "salvar"); o coletor manda gravar e, sem resposta, grava na aba (`gravarNestaAba`); `comCache` e a mesclagem saíram do coletor. **#38:** `codigosDentroDe` prefere o item quando o card também tem link de catálogo/user product. **#40 (decisão):** `anotarImplausiveis` não descarta; `calcular.vendasAcimaDasVisitas`; alerta no painel. **#46 (decisão):** sem painel "Sem dados" (`montarPainelVazio` removido). **Busca automática (decisão):** `BUSCA_AUTOMATICA_LIGADA = false`; guia: a extensão não faz nada sozinha. **Popup:** versão ao lado do nome. **#53:** harness com `gravacao.js` e service worker (três gravações simultâneas, remetente alheio, busca fora do ML e sem https) → **191/191**; teste em DOM real versionado (`teste/servidor-teste.js`, `teste/rodar-no-navegador.html`) → **31/31**. `manifest.json` → **0.1.5** (content_scripts com `gravacao.js`), zip gerado. |
| 23a — Período no diagnóstico | ✅ feito | 15/09/2026 | Pedido do Pedro: preparar o diagnóstico para o #47. `telaAtual.periodo` (e `mlmetrics_diagnostico.periodo`): textos curtos de filtro de período (`ehTextoDePeriodo`, vocabulário fechado), com `marcado` pela opção de `<select>`, radio/checkbox do `<label>` ou `aria-selected/checked/pressed/current` (`estadoDoControle`); intervalo de datas também no valor de campo (sem campo escondido, senha, e-mail ou telefone); até 20, sem repetição, sem o painel. Só leitura: gravação e painel não mudam. Guia: o diagnóstico traz o período. Harness **221/221**; navegador **37/37** (controles reais). `manifest.json` → **0.1.6**, zip gerado. |
| Enviar a 0.2.7 + repositório | ⬜ a fazer | | Seção 4 (Pedro). Commit e verificação já saíram do caminho. |
| 0.1.7 — robustez (Pedro) | ✅ feito | 15/09/2026 | Commit `2fedda6`, direto por ele: tempo limite do plano B, `ehData` por calendário, `try/catch` no `new URL`, `lastError.message`. Entrou sem teste e sem registro — dívida paga no lote 24. |
| 24 — Erro visível | ✅ feito | 17/09/2026 | Pedido do Pedro ("o que dá para melhorar"). **Falha silenciosa:** `coletar()` e o diagnóstico em `try/catch`; `registrarErro` grava `mlmetrics_erro` (onde, mensagem, 3 linhas de pilha, host, tela mascarada, hora, versão) com trava de 1 min; aviso vermelho no popup e `ultimoErro` no relatório. **Dívida da 0.1.7:** `motivoDoNumero` recusa a forma de data com ponto — sem isso, `31.04.2023` virava 31.042.023 visitas. Harness **231/231**, navegador **42/42**. `manifest.json` → **0.1.8**, zip gerado. |
| 25 — `coletor.js` dividido | ✅ feito | 17/09/2026 | Pedido do Pedro (itens 2 e 3 das melhorias). `leitura.js` (`MLMetricsLeitura`), `diagnostico.js` (`MLMetricsDiagnostico`) e `calculo.js` (`MLMetricsCalculo`) saíram de `coletor.js` (2.015 → 696) e `content.js` (747 → 435), com o texto exato de cada função movido por script e as chamadas entre arquivos prefixadas. `diagnosticarTelaAtual()` → `diagnosticarTela(doc, local)`. Manifest na ordem de dependência. Harness sem extrator (`carregarModulo`), +6 casos da ordem do manifest → **237/237**; navegador **42/42**. Os quatro `var` da 0.1.7 → `const`/`let`. `manifest.json` → **0.1.9**, zip gerado. |
| 26 — Histórico diário | ✅ feito | 18/09/2026 | Pedido do Pedro ("gravar agora, sem mostrar" + popup sem cópia). `registrarDia`/`diaDe`/`chaveDoHistorico` no `gravacao.js`; `gravarHistorico` no SW e `gravarHistoricoNestaAba` no plano B, na mesma fila e depois do cache; chave `mlmetrics_historico_<código>`, 400 dias, só métrica lida e com rastro. `unlimitedStorage`. Popup carrega `leitura.js`/`gravacao.js` (sem cópia do `caminhoMascarado`) e resume o histórico no relatório. Guia atualizado. Harness **261/261**, navegador **49/49**. `manifest.json` → **0.2.0**, zip gerado. |
| 26b — Chaves num lugar só | ✅ feito | 18/09/2026 | Pedido do Pedro ("arroche"). `PREFIXO_CHAVES` e `CHAVES` (congelado) no `gravacao.js`; `background.js`, `coletor.js`, `content.js` e `popup.js` usam dali (eram 12 declarações escritas à mão). Harness +6 → **267/267** (valores presos, prefixo, congelado, nenhum literal fora do `gravacao.js`); navegador **49/49** (painel carrega `gravacao.js`). `manifest.json` → **0.2.1**, zip gerado. |
| 27 — Conferência e aviso de tela | ✅ feito | 21/09/2026 | Pedido do Pedro. Popup: "✓ bate"/"✗ não bate" por anúncio (gravado em `mlmetrics_conferencia`, sobrevive ao popup fechar, clique repetido desmarca) e "Copiar conferência" com números + trecho « ». Coletor: `marcarTelaFalhando`/`limparTelaFalhando` + `ehOrigemConhecida` → aviso laranja quando uma tela que já entregou números para de entregar. Guia: passo 7 e "O que me contar". Harness **271/271**, navegador **57/57**. `manifest.json` → **0.2.2**, zip gerado. |
| 28 — Verificação no Edge | ✅ feito | 21/09/2026 | Pedido do Pedro. `teste/verificar-no-edge.js` + `teste/edge-cdp.js`: Edge sem janela com a extensão instalada (ZIP de `dist/`), fixtures servidas como `https://www.mercadolivre.com.br/...`, conversa por CDP. **21/21**, cobrindo os 11 itens da antiga lista manual. Reprova provada com cópia quebrada de propósito. Nenhum arquivo de `src/` mudou. |
| 28b — Custo medido + mensagem | ✅ feito | 22/09/2026 | Pedido do Pedro. A verificação no Edge mede a leitura numa página real salva (888 KB: 3 ms no portão, 7 ms na varredura), pulando quando o arquivo não existe → **23/23**. `MENSAGEM-CLIENTE.md` com o texto pronto para enviar o zip. Nada em `src/`. |
| 28c — Leitor do diagnóstico | ✅ feito | 24/09/2026 | Pedido do Pedro. `teste/ler-diagnostico.js`: lê o JSON do "Copiar diagnóstico" ou o texto do "Copiar conferência" e resume, terminando em "O QUE ISSO DECIDE" (período/#47, vitrine, tela sem "visita", recusas por motivo, conferência que não bateu, versão antiga). `.gitignore` cobrindo os arquivos colados. Harness **283/283**. Nada em `src/`. |
| 29 — Item achado na página | ✅ feito | 24/09/2026 | Pedro instalou e não apareceu painel num anúncio `/up/MLBU…`: a URL não tem código de item e o cache só guarda item. `codigoDoItemNaPagina` (`calculo.js`) acha o item nos links da página por dominância (≥3 e 3× o segundo; senão `null`), e `chaveDaPagina` o põe na frente. Fecha a metade da exibição do #38. Harness **289/289**, navegador **59/59**, Edge **27/27** (inclusive na página real salva). `manifest.json` → **0.2.3**. |
| 29b — Demonstração no Edge | ✅ feito | 24/09/2026 | `node teste/abrir-demo.js`: Edge com janela, extensão instalada e as telas de teste no endereço de verdade, para ver e clicar sem conta de vendedor. O servidor das fixtures virou `teste/servidor-ml-falso.js`, compartilhado com a verificação (que seguiu **27/27** depois da mudança). Nada em `src/`. |
| 30 — Popup conta a aba | ✅ feito | 25/09/2026 | Pedido do Pedro, depois de viver o tropeço: aba aberta antes do reload fica sem extensão e o popup não dizia nada. Agora ele pergunta à aba ao abrir (`situacaoDaAba`) e mostra uma linha azul: F5, página de produto, "lendo N anúncios", "copie o diagnóstico" ou "abra Minhas publicações". Navegador **65/65**, harness **289/289**, Edge **27/27**. `manifest.json` → **0.2.4**. |
| 31 — Ícone com o total | ✅ feito | 25/09/2026 | `contarConferiveis` (`gravacao.js`) + `atualizarDistintivo` (`background.js`): o ícone mostra quantos anúncios têm número com rastro, vazio quando é zero, "99+" acima disso. Atualiza por `storage.onChanged` e a cada acordada do service worker. Harness **293**, Edge **29/29**. |
| 32 — Painel em qualquer anúncio | ✅ feito | 25/09/2026 | Pedido do Pedro. Em página de produto, sem nada capturado, o painel mostra o "N vendido" lido **da própria página** (`vendidosDaPagina` no `leitura.js`), sem gravar, dizendo de onde veio. Só palavra "vendido", número exato, "+N" recusado, dois valores diferentes = nada. Visitas ali não existem. Harness **300/300**, navegador **69/69**, Edge **30/30** (inclusive na página real salva). `manifest.json` → **0.2.6**. |
| 33 — Venda arredondada como piso | ✅ feito | 25/09/2026 | Anúncio com "Novo \| +25 vendidos" ficava sem painel. `vendidosDaPagina` passou a usar o subtítulo (condição + vendidos) como âncora — o que separa o número do anúncio dos "+N" das vitrines — e o painel mostra "+25" e "a partir de R$ …". "+10mil" continua fora. Harness **306/306**, navegador **71/71**, Edge **30/30**. `manifest.json` → **0.2.7**. |
| 34 — Exibir o histórico | ⬜ a fazer | | Vendas/mês e faturamento/mês no painel. Depende da conferência e do #47 (total ou recorte muda a conta). |
| ★ Capturar tela real + conferência | ⬜ a fazer | | Cliente, com a 0.2.7: "Copiar diagnóstico" em "Minhas publicações" e passo 7 do guia. |
| 23b — Período no rastro | ⬜ a fazer | | #47: com o `telaAtual.periodo` da tela real, guardar o período junto do rastro. |
