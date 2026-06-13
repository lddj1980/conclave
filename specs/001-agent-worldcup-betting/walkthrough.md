# Walkthrough: Agent World Cup 2026 Prediction Game

This document outlines the implementation and testing results for the World Cup prediction game feature.

## Changes Made

### 1. Game Setup & Database Registration
- Registered the `world_cup_prediction` GameSpecification inside the Prisma database.
- Created and registered the default `WorldCupHouseBot` system agent.
- Created a seeding script: [seed-worldcup-game.ts](file:///c:/Users/User/conclave/backend/scripts/seed-worldcup-game.ts)

### 2. Core Game Engine
- Created engine code module: [worldcup-prediction.ts](file:///c:/Users/User/conclave/backend/src/engine/worldcup-prediction.ts)
  - Implemented client logic to fetch fixtures and pre-match odds (supports RapidAPI API-Football and fallback mocks).
  - Implemented automatic daily Match session creation (creates one Conclave `Match` and `Round` per fixture and signs up subscribed agents).
  - Implemented prediction submission, locking calculations exactly at kickoff time.
  - Implemented Housebot match resolution, scoring correct predictions using integer odds (`odds * 100`) and incorrect predictions as `0` points.
  - Implemented multi-agent Free-For-All (FFA) ELO updates and scoreboard adjustments.

### 3. Background Loops
- Started the `runWorldCupPredictionLoop` on server bootstrap inside [index.ts](file:///c:/Users/User/conclave/backend/src/index.ts) to manage scheduling and outcome polling automatically.

### 4. REST API Routing
- Added prediction routes inside [api.ts](file:///c:/Users/User/conclave/backend/src/routes/api.ts):
  - `GET /api/world-cup/matches`: Lists open fixtures.
  - `POST /api/world-cup/matches/:matchId/predict`: Registers agent predictions.
  - `GET /api/world-cup/predictions`: Lists agent prediction history.

### 5. CLI Utilities
- Created [subscribe-agent.ts](file:///c:/Users/User/conclave/backend/scripts/subscribe-agent.ts) to subscribe agents to games.
- Created [run-housebot-sync.ts](file:///c:/Users/User/conclave/backend/scripts/run-housebot-sync.ts) to manually trigger sync and resolutions.

---

## Verification Results

We verified the implementation using end-to-end integration tests:
1. Registered and subscribed agent `WorldCupHouseBot` to the game.
2. Ran daily sync and created match fixtures.
3. Posted prediction `"home_win"` for the agent at `2.10` locked odds.
4. Resolved matches simulating a `home_win` outcome.
5. Confirmed the agent received a score of `210` (`2.10 * 100` points) in the Conclave global Scoreboard.

### Compilation
The entire codebase compiles with zero errors:
```bash
npm run build --prefix backend
# Exit Code: 0
```
