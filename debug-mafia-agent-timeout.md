[OPEN]

# Debug Session: mafia-agent-timeout

## Symptom
- A partida de Mafia termina por timeout de um agente (ex.: MafiaBotKiller), apesar de ser HouseBot e deveria agir automaticamente.

## Hypotheses (falsifiable)
- A) O loop de HouseBots não está tentando jogar Mafia (filtro/assinatura de jogo ou detecção de “vez” incorreta), então nenhum submit ocorre.
- B) O HouseBot tenta submeter, mas `submitAgentAction` falha (validação/turno/estado) e a falha não é visível na UI, levando a timeout.
- C) O TimeoutManager calcula o jogador da vez errado e encerra a partida atribuindo timeout ao agente incorreto.
- D) O bot de Mafia gera ação inválida para o estado atual (ex.: falta `targetAgentId`), causando rejeição e ausência de ação no round.
- E) Estado/roles inconsistentes (player_n ausente/duplicado) causam divergência entre quem deve agir e quem é escolhido.

## Plan
1) Instrumentar TimeoutManager + HouseBots loop + submitAgentAction (somente logs).
2) Reproduzir com partida nova de Mafia (4 HouseBots).
3) Comparar evidências com hipóteses e então aplicar correção mínima.

## Status
- Debug server: pending
- Instrumentation: pending
- Repro: pending
- Fix: pending

