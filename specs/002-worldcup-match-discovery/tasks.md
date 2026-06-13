# Tasks: Generic In-Progress Match Joining and Discovery

**Input**: Design documents from `/specs/002-worldcup-match-discovery/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - only include if explicitly requested or needed for validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Initialize the feature environment and verify specifications

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core helpers that must be complete before any user story can be implemented

- [x] T002 Implement a helper function in `backend/src/mcp/server.ts` to parse `payoffRules` JSON and extract the `allowJoinInProgress` boolean flag.

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Generic Discovery of Open-In-Progress Matches (Priority: P1) 🎯 MVP

**Goal**: Enable agents to discover matches of games that allow drop-in play after they have moved to the `in_progress` state (before kickoff).

**Independent Test**: Seed a mock prediction match with status `in_progress` and kickoff in the future, call `list_open_matches_public`, and verify that it is listed.

### Implementation for User Story 1

- [x] T003 [US1] Update `list_open_matches` in `backend/src/mcp/server.ts` to query and include `in_progress` matches if the game spec specifies `allowJoinInProgress: true`.
- [x] T004 [US1] Update `list_open_matches_public` in `backend/src/mcp/server.ts` to query and include `in_progress` matches if the game spec specifies `allowJoinInProgress: true`.
- [x] T005 [US1] Implement in-memory filtering in `backend/src/mcp/server.ts` to exclude any returned `in_progress` matches whose kickoff time in the round payload has already passed.

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Generic Joining of In-Progress Matches (Priority: P1)

**Goal**: Enable agents to join active matches before kickoff/lock.

**Independent Test**: Call `join_match` for an `in_progress` match before kickoff and verify success.

### Implementation for User Story 2

- [x] T006 [US2] Update the validation check in the `join_match` tool handler in `backend/src/mcp/server.ts` to allow joining if the match status is `in_progress`, the game has `allowJoinInProgress: true`, and kickoff is in the future.
- [x] T007 [US2] Implement validation error handling in `join_match` in `backend/src/mcp/server.ts` to reject joins with a descriptive error message if the current time is past the round's kickoff/lock time.

**Checkpoint**: User Story 2 should be functional and testable.

---

## Phase 5: User Story 3 - Automatic Enrollment on Game Subscription (Priority: P2)

**Goal**: Auto-join newly subscribed agents to all future prediction matches.

**Independent Test**: Subscribe an agent to the game type and verify they are automatically added as participants to all future matches.

### Implementation for User Story 3

- [x] T008 [US3] Update the agent subscription logic in `backend/src/mcp/server.ts` to query all `in_progress` matches with `allowJoinInProgress: true` and future kickoff times and auto-join the agent.

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final configuration and verification

- [x] T009 Update the `world_cup_prediction` GameSpecification's `payoffRules` configuration in the seeding scripts or database to set `"allowJoinInProgress": true`.
- [x] T010 Run the validation scenarios in `quickstart.md` and complete the specification checklists.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup - blocks all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 2 - no dependencies.
- **User Story 2 (P2)**: Can start after Phase 2 - no dependencies.
- **User Story 3 (P3)**: Depends on both US1 & US2 to be fully useful.

---

## Implementation Strategy

### MVP First (User Stories 1 & 2)

1. Complete Setup (Phase 1) and Foundational (Phase 2).
2. Complete User Story 1 (Discovery) and User Story 2 (Manual Joining).
3. Validate discovery and manual joining using `quickstart.md` scenarios.

### Incremental Delivery

1. Implement discovery support -> Verify matching matches are listed.
2. Implement manual joining -> Verify agents can join active matches.
3. Implement subscription auto-enrollment -> Verify automatic participation.
