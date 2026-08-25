# Lotocalc

Gerador de jogos para **todas as modalidades das Loterias CAIXA**, com volante interativo,
filtros estatísticos, fechamentos com garantia, conferidor e uma cadeia de hash visualizável.

Roda inteiramente no navegador. Nenhum dado sai do dispositivo — não há servidor, conta nem rede.

## Como abrir

Clique duas vezes em `index.html`. É só isso: não há build, dependência nem instalação.

Para servir por HTTP (opcional, útil ao editar ou para abrir de outro aparelho da rede):

```bash
node serve.mjs
```

Para empacotar tudo num arquivo só:

```bash
node build.mjs
```

Isso escreve `dist/lotocalc.html` (documento completo e autocontido, ~242 KB — bom para mandar
por e-mail ou guardar num pendrive) e `dist/lotocalc.fragmento.html` (o mesmo conteúdo sem as
tags `<html>/<head>/<body>`, para hospedagens que fornecem o próprio esqueleto).

## Modalidades

| Modalidade | Aposta | Universo | Sorteadas |
|---|---|---|---|
| Mega-Sena | 6 a 20 dezenas | 01–60 | 6 |
| Lotofácil | 15 a 20 dezenas | 01–25 | 15 |
| Quina | 5 a 15 dezenas | 01–80 | 5 |
| Lotomania | 50 dezenas | 00–99 | 20 |
| Dupla Sena | 6 a 15 dezenas | 01–50 | 6 (dois sorteios) |
| Timemania | 10 dezenas + Time do Coração | 01–80 | 7 |
| Dia de Sorte | 7 a 15 dezenas + Mês da Sorte | 01–31 | 7 |
| Super Sete | 1 a 3 algarismos em 7 colunas | 0–9 | 7 |
| +Milionária | 6 a 12 dezenas + 2 a 6 trevos | 01–50 / 1–6 | 6 + 2 |
| Loteca | 14 partidas (1, X, 2) | — | 14 |
| Loteria Federal | bilhete de 5 algarismos | 00000–99999 | 1 |

O preço de cada aposta é calculado como a CAIXA calcula: combinações do tamanho da aposta
sobre o tamanho da aposta simples. Uma Mega de 7 dezenas custa C(7,6) = 7 apostas.

## Estratégias

- **Sorteio limpo** — uniforme, igual à surpresinha.
- **Equilibrado** — aplica as faixas estatisticamente mais prováveis de soma, paridade e espalhamento.
- **Cadeia de hash** — ver abaixo.
- **Ponderada por histórico** — puxa para as dezenas mais sorteadas, menos sorteadas ou mais atrasadas.
- **Cobertura uniforme** — reparte o uso das dezenas por igual entre todos os jogos do lote.
- **Fechamento** — combina o pool marcado no volante. No modo **reduzido**, uma busca gulosa
  sobre máscaras de bits encontra o menor conjunto de jogos que garante um mínimo de acertos.
  Exemplo verificado: um pool de 18 dezenas na Lotofácil fecha **13 acertos garantidos em 6 jogos**
  se as 15 sorteadas estiverem no pool — cobertura conferida nos 816 cenários possíveis.

## A cadeia

Cada volta é uma *quarter-round* no estilo ChaCha sobre 128 bits de estado (4 × uint32).
O digest **não vira dezena**. Ele é projetado em quatro parâmetros —
centro, largura, paridade e ritmo — que deformam uma curva de probabilidade sobre o universo
de dezenas; só dessa curva os números são sorteados. Depois, o jogo é reabsorvido pelo estado,
de modo que o jogo N vira o elo que gera o N+1.

A aba **Cadeia** mostra a matemática acontecendo: o mapa dos 128 bits com as células que viraram
na última volta, o gráfico de avalanche (bits alterados por volta — o ideal teórico é 64 de 128,
e a implementação fica em 63,5 a 64,6 na média) e a curva de probabilidade em tempo real.

Três controles:

- **Temperatura** — 0 devolve a curva plana (uniforme); 1 aplica a deformação inteira.
- **Voltas por elo** — quantas iterações a cadeia dá antes de extrair cada jogo.
- **Deriva** — quantas voltas extras separam um elo do seguinte.

## Sementes

A semente comanda todo o sorteio: mesma semente + mesmos ajustes = exatamente os mesmos jogos.
Ela pode vir de:

- um texto qualquer (um verso, um nome, uma data);
- uma **foto**, um **áudio**, um vídeo ou qualquer arquivo — os bytes são absorvidos pela cadeia
  (arquivos acima de 6 MB entram por amostragem de três trechos);
- o **movimento do ponteiro**, cuja irregularidade de posição e ritmo alimenta o coletor de entropia.

Ao lado do campo aparece a *impressão digital* da semente: uma grade espelhada 8×8 derivada do
estado da cadeia. Sementes diferentes, desenhos diferentes.

## Orçamento

Em vez da quantidade de jogos, dá para dizer **quanto quer gastar**. O app calcula quantos jogos
cabem, mostra a sobra e lista o que o mesmo dinheiro compraria com apostas de outros tamanhos.

## Estrutura

```
index.html              marcação
assets/css/app.css      tema claro (papel) e escuro (mesa); a cor da modalidade re-tinge tudo
assets/js/loterias.js   catálogo das modalidades, preços e faixas de premiação
assets/js/rng.js        mulberry32 com semente reprodutível
assets/js/cadeia.js     hash encadeado e projeção em parâmetros
assets/js/semente.js    sementes de texto, arquivo e gesto; impressão digital
assets/js/filtros.js    métricas do jogo e faixas sugeridas
assets/js/gerador.js    motor de geração e fechamentos
assets/js/analise.js    estatísticas, leitura de histórico e conferidor
assets/js/exportar.js   TXT, CSV, JSON e cópia
assets/js/app.js        interface, volante, gráficos em canvas
build.mjs               empacota tudo em dist/lotocalc.html
```

## Atalhos

- `G` — gerar jogos
- `Esc` — fechar a janela aberta

## Avisos

Os **preços e as faixas de premiação são valores de referência** e ficam editáveis no código
(`assets/js/loterias.js`). A CAIXA reajusta as apostas periodicamente — confira em
[loterias.caixa.gov.br](https://loterias.caixa.gov.br). A lista de times da Timemania também
muda de tempos em tempos.

O conferidor informa **quantos acertos** e **qual faixa** cada jogo atingiu; ele não calcula
valores de prêmio, que dependem do rateio de cada concurso.

Loteria é sorteio. Nenhuma estratégia, filtro, peso ou fechamento altera a probabilidade de um
número ser sorteado — eles servem para organizar apostas, cobrir combinações e controlar gasto,
não para prever resultado. Jogue com responsabilidade.
