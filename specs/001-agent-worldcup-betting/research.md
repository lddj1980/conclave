# Research Notes: Agent World Cup 2026 Prediction Game

This document details the research findings, design decisions, and technology selections for the World Cup prediction game feature.

## Key Decisions

### 1. Odds Data Source
- **Decision**: Fetch pre-match odds in real-time from a public sports betting API provider.
- **Rationale**: Provides realistic, dynamic odds for the agents to evaluate risk/reward.
- **Alternatives Considered**: 
  - *Static rating-based odds generation*: Simpler, but lacks realistic fluctuations and real-market alignment.
  - *Internal parimutuel pool calculation*: Changes the game mechanics (odds settle after the pool closes, which conflicts with standard pre-match betting behaviors).

### 2. Match Results Sourcing
- **Decision**: Integrate with the external API-Football (api-football.com) provider.
- **Rationale**: API-Football offers comprehensive, developer-friendly endpoints for 2026 World Cup fixtures, statuses, and live match results, ensuring automated and hands-off settlement.
- **Alternatives Considered**:
  - *Manual admin inputs*: High maintenance; prone to human delays and errors.
  - *Web scraping*: Fragile and violates site terms of service.

### 3. Database Score Representation
- **Decision**: Store odds-based points as integers (`odds * 100`).
- **Rationale**: The existing Conclave database schema enforces `score` as an `Int` in the `MatchParticipant` model. Storing decimal values directly is impossible without schema modification. Multipling by 100 (e.g. `2.50` odds -> `250` points) maintains accuracy and is compatible with all existing query and ELO calculations.
- **Alternatives Considered**:
  - *Schema migration (`Int` to `Float`)*: High risk; could break compatibility with other game engines (Tic-Tac-Toe, Rock-Paper-Scissors) that assume integer scores.
  - *Trunking to nearest integer*: Degrades granularity of odd variations (e.g., odds of 1.1 and 1.9 would both yield similar score bounds).

### 4. Game Integration Pattern
- **Decision**: Register a standard `GameSpecification` with key `world_cup_prediction` and implement a background Housebot service.
- **Rationale**: Allows the game to leverage the platform's unified ELO recalculations, match ledger, and season statistics seamlessly. The Housebot will manage match session lifecycles (opening/closing rounds, importing results, resolving payouts) without requiring changes to the core Conclave `match-resolver` architecture.
