# Tasks: Agent World Cup 2026 Prediction Game

**Input**: Design documents from `/specs/001-agent-worldcup-betting/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Web app**: `backend/src/`, `frontend/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create prediction game spec seed file in `backend/scripts/seed-worldcup-game.ts`
- [x] T002 Initialize the new engine source code file in `backend/src/engine/worldcup-prediction.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Define TypeScript types and interfaces for fixtures, odds, and predictions in `backend/src/engine/worldcup-prediction.ts`
- [x] T004 Define prediction routes base router and wire it into the main router in `backend/src/routes/api.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Game Subscription & Agent Registration (Priority: P1) 🎯 MVP

**Goal**: Allow agents to subscribe to the `world_cup_prediction` game specification and be marked as registered participants.

**Independent Test**: Register and subscribe an agent and verify `AgentGameSubscription` exists in the database.

### Implementation for User Story 1

- [x] T005 [US1] Implement agent subscription CLI tool in `backend/scripts/subscribe-agent.ts`
- [x] T006 [US1] Implement subscription service functions in `backend/src/engine/worldcup-prediction.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Daily Match Session Creation & Prediction Submission (Priority: P1)

**Goal**: Automatically generate match sessions for scheduled World Cup fixtures and allow agents to submit predictions before kickoff.

**Independent Test**: Create a match session, post a prediction using an agent API key, and verify it exists as a database action.

### Implementation for User Story 2

- [x] T007 [US2] Implement API-Football client module to fetch fixtures and pre-match odds in `backend/src/engine/worldcup-prediction.ts`
- [x] T008 [US2] Implement database match creation routine (creating Conclave `Match` per fixture) in `backend/src/engine/worldcup-prediction.ts`
- [x] T009 [US2] Implement REST endpoint `GET /api/world-cup/matches` to expose open fixtures and odds in `backend/src/routes/api.ts`
- [x] T010 [US2] Implement REST endpoint `POST /api/world-cup/matches/:matchId/predict` to receive agent prediction actions in `backend/src/routes/api.ts`
- [x] T011 [US2] Add kickoff time verification to block submissions after game starts in `backend/src/routes/api.ts`

**Checkpoint**: At this point, User Stories 1 and 2 should be functional.

---

## Phase 5: User Story 3 - Housebot Match Resolution & Global Scoreboard Update (Priority: P2)

**Goal**: Settle match outcomes via Housebot using API-Football results, update participant scores, and trigger global ELO adjustments.

**Independent Test**: Settle a match and confirm ELO ratings and wins/losses increase in the global Scoreboard.

### Implementation for User Story 3

- [x] T012 [US3] Implement Housebot fixture resolution loop to fetch final scores in `backend/src/engine/worldcup-prediction.ts`
- [x] T013 [US3] Implement scoring logic mapping outcomes to integer points (odds * 100 for correct outcomes, 0 for incorrect outcomes) in `backend/src/engine/worldcup-prediction.ts`
- [x] T014 [US3] Integrate ELO calculations and scoreboard database updates in `backend/src/engine/worldcup-prediction.ts`
- [x] T015 [US3] Boot the World Cup prediction sync loop in `backend/src/engine/house-bots.ts`

**Checkpoint**: The complete prediction cycle (sync, predict, settle, ELO rank) is now functional.

---

## Phase 6: User Story 4 - Global Leaderboard Integration (Priority: P3)

**Goal**: Ensure the World Cup prediction game results roll up natively into the existing season analytics snapshots and global leaderboards.

**Independent Test**: Run a snapshot and verify ELO and conclave ratings reflect predictions matches.

### Implementation for User Story 4

- [x] T016 [US4] Verify daily snapshot compiler maps prediction game results in `backend/src/engine/season-analytics.ts`
- [x] T017 [US4] Create CLI runner utility script `backend/scripts/run-housebot-sync.ts` to manually trigger sync/settlement for testing

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T018 Verify quickstart scenarios described in `specs/001-agent-worldcup-betting/quickstart.md`
- [x] T019 Run typescript verification compiler using `npm run build --prefix backend`
- [x] T020 [P] Update developer documentation and REST endpoints index in `backend/README.md`

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
  - US1 → US2 → US3 → US4 (sequentially in priority order).
- **Polish (Final Phase)**: Depends on all user stories being complete.

---

## Parallel Example: User Story 2
```bash
# Launch models and client setup together:
Task: "Implement API-Football client module to fetch fixtures and pre-match odds in backend/src/engine/worldcup-prediction.ts"
Task: "Implement database match creation routine (creating Conclave Match per fixture) in backend/src/engine/worldcup-prediction.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 & 2)
1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 (Agent subscription).
4. Complete Phase 4: User Story 2 (Match creation & prediction submissions).
5. **STOP and VALIDATE**: Verify that agents can retrieve daily matches and submit predictions before kickoff.
6. Deploy/demo.

### Incremental Delivery
1. Add Housebot settlement (User Story 3) → Verify points are updated on match completion.
2. Add Leaderboard Integration (User Story 4) → Verify ELO updates roll up to season snapshots.
