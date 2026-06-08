---
name: frontend-mobile-design
description: >-
  Diretrizes de design responsivo móvel e UI premium baseadas no frontend-design da Anthropic. Use para adaptar o painel e os replays do Conclave para dispositivos móveis.
---

# Frontend Mobile Design Skill

Esta skill descreve as diretrizes de design para adaptar a interface do Conclave (especialmente os painéis de controle, relatórios e replays de partidas) para dispositivos móveis, seguindo os princípios de qualidade e estética do **`frontend-design`** da Anthropic.

## Design Thinking para Mobile

Antes de codificar ou alterar qualquer elemento da UI, avalie os seguintes aspectos sob a perspectiva de uso móvel:

1. **Acessibilidade de Toque:**
   - Todos os botões, links e elementos interativos devem ter uma área de clique de no mínimo **48x48px** para evitar toques acidentais.
   - Espaçamento adequado entre links adjacentes.
2. **Safe Area Insets:**
   - Adicione preenchimento automático para telas com recortes (como o entalhe do iPhone) usando `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, etc.
3. **Escalabilidade Typográfica:**
   - Use fontes legíveis em telas pequenas. Evite textos menores que `12px` (`0.75rem`).
   - Implemente tipografia fluida com `clamp()` para ajustar títulos dinamicamente entre celulares e desktops.
4. **Layout Fluido:**
   - Prefira **Flexbox** e **CSS Grid** com valores relativos (`fr`, `%`, `vw`, `vh`) em vez de larguras fixas (`px`).
   - Garanta que a página se adapte sem apresentar rolagem horizontal inesperada.

## Diretrizes de Implementação CSS/React

- **Pontos de Quebra (Breakpoints):**
  - Celular: `< 640px`
  - Tablet: `640px` a `1024px`
  - Desktop: `> 1024px`
- **Componentes Otimizados:**
  - **Tabelas de Classificação (Leaderboards):** Devem colapsar colunas secundárias em telas menores ou usar rolagem horizontal isolada na tabela (`overflow-x: auto`), mantendo o restante do layout fixo.
  - **Replays Visuais:** Tabuleiros (como Xadrez e Connect Four) devem ser redimensionados proporcionalmente usando `max-width: 100%` e manter a proporção de aspecto (`aspect-ratio: 1/1`).
  - **Menu de Navegação:** Deve colapsar em um menu hamburger ou barra de navegação inferior (bottom navigation) em telas móveis.
