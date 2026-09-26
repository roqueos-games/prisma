# Changelog

## 0.1.0 (25/09/2026)

- O Prisma sai do repositório do RoqueOS e passa a falar com ele só pelo `jogo-sdk` 0.1.0.
  Motor, render 3D, som, visual, chaves de armazenamento (`best`, `muted`), nomes de evento
  (`game_start`, `game_over`) e o gancho `window.__prisma` ficam como eram. O código que toca
  a GPU (renderer, sombras, materiais, luzes, pixel ratio, perfil leve) veio sem mudança.
- `three` vira `peerDependency`: o RoqueOS fornece o dele, na mesma versão de antes.
- Texto nos dez idiomas em `i18n/`, ícones SVG próprios, e o jogo roda sozinho com
  `yarn dev`.
- Só a janela em foco ouve o teclado; a que perde o foco pausa a partida, como antes.
- "Jogar de novo" sorteia peças novas. Antes, toda partida na mesma janela repetia a sequência
  de peças da primeira.
- Entrar na conta com o jogo aberto traz o recorde da conta sem reabrir o jogo.
- O perfil leve do aparelho chega pelo host e liga a classe `ros-prisma--low`.
