# Como instalar e testar

Leva uns 5 minutos. Não precisa instalar programa nenhum.

## Antes de começar

Duas coisas importantes:

- **Não vou pedir a sua senha do Mercado Livre**, e você não deve me passar.
  A extensão funciona dentro do seu navegador, com você já logada. Ela não
  envia nada para lugar nenhum — nenhum número sai do seu computador.
- **Guarde a pasta num lugar definitivo** antes de instalar (Documentos, por
  exemplo). Se ela for movida ou apagada depois, a extensão para de funcionar.

### O que a extensão faz por conta própria

Com alguma extensão do Mercado Livre aberta, a ML Metrics visita sozinha, a
cada 2 horas, as telas de vendedor que já capturaram dados — para atualizar
os números sem você precisar passar por todas elas de novo. Isso acontece
dentro do seu navegador, com você já logada. É um comportamento silencioso:
você não precisa fazer nada, e pode notá-lo como se a página "abrisse e
fechasse" sozinha de vez em quando.

Como essa visita automática acontece com a sua sessão do Mercado Livre, evite
ter dúvidas de segurança: as telas são consultadas de forma idêntica a um
acesso seu de verdade, sem pressa nem repetições em série.

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

## Testando

1. Entre no Mercado Livre e faça login normalmente.

2. Abra **"Minhas publicações"** (a lista dos seus anúncios).

3. Espere a lista carregar por completo e role a página até o fim.

4. Veja se aparece um **aviso verde no canto inferior direito**, com um texto
   parecido com "12 anúncio(s) atualizado(s)". Ele some sozinho depois de
   alguns segundos.

5. Agora abra um dos seus anúncios.

6. Veja se aparece um **painel azul no canto superior direito**, com visitas,
   vendas e conversão.

## O que me contar

Me manda um print de cada tela (a lista de publicações e o anúncio aberto) e
me diz:

- O aviso verde apareceu? Com qual número?
- O painel azul apareceu? Os números batem com o que o Mercado Livre mostra?
- Apareceu algum número que você sabe que está errado?

**Se nada aparecer, também me avisa** — é informação útil, não é problema.
Nesse caso o print da tela de "Minhas publicações" me ajuda muito, porque é
com base no que está escrito nela que eu ajusto o programa.

### Atalho: em vez de print, "Copiar diagnóstico"

Se você não conseguir mandar print, dá para mandar um relatório pronto, só com
texto:

1. Vá até a tela que quer me mostrar (por exemplo, "Minhas publicações").
2. Clique no **ícone da extensão** (o quadradinho da ML Metrics no topo).
3. Clique no botão **"Copiar diagnóstico"**.
4. Cole o texto aqui na conversa.

O relatório traz quais telas de vendedor a extensão reconheceu, os números
guardados e — quando algo não foi capturado — pedaços do texto da tela. É a
forma mais rápida de eu ver o que está acontecendo no seu navegador.

## Se quiser desinstalar

Volte em `edge://extensions` (ou `chrome://extensions`) e clique em
**Remover** no quadrinho da ML Metrics. Não fica nada para trás.
