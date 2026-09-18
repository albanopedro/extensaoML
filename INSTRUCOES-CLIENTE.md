# Como instalar e testar

Leva uns 5 minutos. Não precisa instalar programa nenhum.

## Antes de começar

Duas coisas importantes:

- **Não vou pedir a sua senha do Mercado Livre**, e você não deve me passar.
  A extensão funciona dentro do seu navegador, com você já logada. Ela não
  envia nada para lugar nenhum: os números ficam guardados no seu navegador.
  Só sai o que você mesma decidir me mandar — um print ou o "Copiar
  diagnóstico" (explicado lá embaixo).
- **Guarde a pasta num lugar definitivo** antes de instalar (Documentos, por
  exemplo). Se ela for movida ou apagada depois, a extensão para de funcionar.

### O que a extensão faz por conta própria

Nada. Ela só lê as telas do Mercado Livre que **você** abre, no momento em
que você abre. Não consulta nenhuma página sozinha e não abre abas nem
janelas. Para os números se atualizarem, basta passar de vez em quando por
"Minhas publicações".

Desde a versão 0.2.0, cada vez que ela lê seus anúncios também guarda uma
anotação por dia de cada um (visitas e vendas daquele dia), **só no seu
navegador**. É isso que vai permitir mostrar, mais para frente, quanto cada
anúncio vende por mês — por enquanto nada disso aparece na tela. Quanto mais
vezes por semana você passar por "Minhas publicações", mais completo fica. O
botão "Limpar dados guardados" apaga essas anotações junto com o resto.

## Instalando

1. Descompacte a pasta que eu enviei e coloque onde ela vá ficar.

2. Abra o navegador e digite na barra de endereços:
   - No Edge: `edge://extensions`
   - No Chrome: `chrome://extensions`

3. Ligue a chave **"Modo do desenvolvedor"**.
   - No Edge fica no canto inferior esquerdo.
   - No Chrome, no canto superior direito.

4. Clique em **"Carregar sem compactação"** e selecione a pasta que você
   descompactou. Ela precisa ser a pasta que contém o arquivo `manifest.json`.

5. Deve aparecer um quadrinho escrito **ML Metrics**. Instalação feita.

## Depois de uma atualização

Quando eu mandar uma versão nova, siga os passos na ordem — pular qualquer um
deles faz o navegador continuar usando a versão antiga:

1. Descompacte o arquivo novo e **coloque os arquivos dele no lugar dos
   antigos, na mesma pasta** que você escolheu na instalação. Não carregue a
   pasta nova como uma segunda extensão: ficariam duas ML Metrics ligadas ao
   mesmo tempo.
2. Abra `edge://extensions` (ou `chrome://extensions`).
3. No quadrinho da **ML Metrics**, clique no **ícone de recarregar** (a seta
   circular que fica no canto do quadrinho). Confira se o número da versão é
   o que eu mandei: ele aparece no quadrinho, em **Detalhes**, e também ao
   lado do nome quando você clica no ícone da extensão.
4. **Aperte F5 em todas as abas do Mercado Livre que estiverem abertas.** A
   extensão só volta a funcionar numa aba depois que ela é recarregada — sem
   o F5, a aba fica sem extensão e parece que nada aparece.
5. Pronto. Pode repetir o teste.

## Testando

1. Entre no Mercado Livre e faça login normalmente.

2. Abra **"Minhas publicações"** (a lista dos seus anúncios).

3. Espere a lista carregar por completo e role a página até o fim.

4. Veja se aparece um **aviso verde no canto inferior direito**, com um texto
   parecido com "12 anúncio(s) atualizado(s)". Ele some sozinho depois de
   alguns segundos.

5. Agora abra um dos seus anúncios.

6. Veja se aparece um **painel azul no canto superior direito**, com visitas,
   vendas e conversão. Um traço (—) no lugar de um número quer dizer que a
   extensão não teve certeza e preferiu não mostrar. Se o painel não aparecer,
   é porque ela ainda não tem números conferidos desse anúncio.

7. **Confira os números — é o passo mais importante.** Escolha 3 anúncios:
   - Anote as visitas e as vendas que o **Mercado Livre** mostra para cada um
     em "Minhas publicações".
   - Clique no **ícone da extensão**. Cada anúncio aparece com os números e,
     embaixo de cada número, **o pedaço de texto de onde ele foi lido** (a
     parte entre « »), a tela e a hora.
   - No painel azul de cada anúncio, **passe o mouse sobre um número**:
     aparece a mesma origem.
   - Os números da extensão precisam ser **iguais** aos do Mercado Livre.

   A "Receita estimada" é uma conta (vendas × preço atual), não o faturamento
   real — ela fica fora dessa conferência.

## O que me contar

Me manda um print de cada tela (a lista de publicações e o anúncio aberto) e
me diz:

- O aviso verde apareceu? Com qual número?
- O painel azul apareceu?
- **Nos 3 anúncios que você conferiu, os números bateram com o Mercado Livre?**
  Se algum não bateu, me mande o texto que aparece entre « » para ele (está
  no ícone da extensão).
- Apareceu algum número que você sabe que está errado?
- **Apareceu um aviso vermelho** quando você clicou no ícone da extensão? Se sim,
  me mande o "Copiar diagnóstico" dessa tela: o aviso quer dizer que a extensão
  travou ao ler alguma coisa, e o diagnóstico me diz o quê.

**Se nada aparecer, também me avisa** — é informação útil, não é problema.
Nesse caso o print da tela de "Minhas publicações" me ajuda muito, porque é
com base no que está escrito nela que eu ajusto o programa.

### Atalho: em vez de print, "Copiar diagnóstico"

Se você não conseguir mandar print, dá para mandar um relatório pronto, só com
texto:

1. Vá até a tela que quer me mostrar (por exemplo, "Minhas publicações") e
   espere ela carregar por completo.
2. Clique no **ícone da extensão** (o quadradinho da ML Metrics no topo).
3. Clique no botão **"Copiar diagnóstico"**.
4. Cole o texto aqui na conversa. Se o navegador não deixar copiar, o texto
   aparece numa caixa dentro da janelinha: clique nela, aperte Ctrl+A e
   depois Ctrl+C.

O relatório lê a tela que está aberta **no momento do clique** e mostra o que
a extensão enxergou nela. Quando algum número não aparece (por exemplo, as
vendas), o relatório diz o motivo. Ele também traz os filtros de período que
aparecem na tela (como "Últimos 30 dias") e qual deles está escolhido, para eu
saber de quando são os números. Também traz quais telas de vendedor ela já
reconheceu e os números guardados. Os endereços vão sem números e sem nome de
produto. É a forma mais rápida de eu ver o que está acontecendo no seu
navegador.

Se o relatório disser que **"a aba aberta não respondeu"**, aperte F5 nessa
aba, espere carregar e clique de novo.

## Se quiser desinstalar

Volte em `edge://extensions` (ou `chrome://extensions`) e clique em
**Remover** no quadrinho da ML Metrics. Não fica nada para trás.
