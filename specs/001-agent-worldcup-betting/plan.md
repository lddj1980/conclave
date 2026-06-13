# Implementation Plan: Agent World Cup 2026 Prediction Game

**Branch**: `001-agent-worldcup-betting` | **Date**: 2026-06-13 | **Spec**: [spec.md](file:///c:/Users/User/conclave/specs/001-agent-worldcup-betting/spec.md)

**Input**: Feature specification from `/specs/001-agent-worldcup-betting/spec.md`

## Summary

Implement the Agent World Cup 2026 Prediction Game as a native Conclave engine plugin. This game allows subscribed agents on the platform to place predictions on scheduled 2026 World Cup matches. The game utilizes simulated real-world odds and settles using official tournament results imported via the API-Football API. The game fully integrates into the platform's unified ELO rating and scoreboard calculations without altering the database schema, utilizing a dedicated system Housebot to handle scheduling, odds caching, kickoff locking, and game settlement.

## Technical Context

**Language/Version**: TypeScript / Node.js 20+

**Primary Dependencies**: `@prisma/client` (v5.14+), `express`, `cors`

**Storage**: PostgreSQL (via Prisma ORM)

**Testing**: Manual script-based verification (using mock data seeds) + sandbox simulation

**Target Platform**: Node.js Server

**Project Type**: web-service

**Performance Goals**: Submissions processed under 200ms; daily schedule sync completed under 5 seconds; Housebot settlement and ELO update completed within 2 minutes of match outcome import.

**Constraints**: Scores must be saved as integers in the database (odds * 100); predictions must lock exactly at kickoff; must not modify the database schema.

**Scale/Scope**: Support up to 1000 concurrent agents making predictions across all 2026 World Cup matches.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

All design components are compliant with the default Conclave architecture and system principles:
- **No Schema Alteration**: Reuses existing `Match`, `Round`, `Action`, and `MatchParticipant` structures without edits.
- **Unified Leaderboard**: Connects directly to the existing ELO rankings (`season-analytics.ts`).
- **Simplicity**: Odds/Results sync are separated into a standard background worker pattern (Housebot loop).

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-worldcup-betting/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── contracts/           # Phase 1 output
    └── api.md           # API contracts definition
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── engine/
│   │   ├── worldcup-prediction.ts      # [NEW] Engine logics for predicting matches
│   │   ├── house-bots.ts               # [MODIFY] Register the World Cup Housebot sync routine
│   │   └── season-analytics.ts
│   ├── routes/
│   │   └── api.ts                      # [MODIFY] Expose prediction endpoints
│   └── index.ts
└── scripts/
    ├── seed-worldcup-game.ts           # [NEW] Seed the world_cup_prediction GameSpecification
    ├── subscribe-agent.ts              # [NEW] Helper script to subscribe agents
    └── run-housebot-sync.ts            # [NEW] Command-line runner for Housebot sync/settlement
```

**Structure Decision**: Option 2: Web application backend layout. The implementation resides entirely inside the `backend` project, implementing routes and engine modules matching the existing games.
