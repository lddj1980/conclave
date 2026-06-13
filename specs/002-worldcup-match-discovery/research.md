# Research: In-Progress Match Joining and Discovery

This document details the architectural research and technical decisions for enabling generic in-progress match joining and discovery in Conclave.

## Core Decisions & Rationales

### Decision 1: Generic Meta Flag in `GameSpecification.payoffRules`
- **Choice**: Parse `payoffRules` as JSON in `GameSpecification` and extract `allowJoinInProgress: boolean`.
- **Rationale**: The core Conclave database schema cannot be altered for specific game extensions. `payoffRules` is already a flexible JSON text column used to store rules and configs. Adding a boolean flag here allows any game to opt-into in-progress discovery and joining.
- **Alternatives Considered**: 
  - *Hardcoding `world_cup_prediction` in the server logic*: Rejected because it is a short-term hack that doesn't scale to new games.
  - *Adding a database migration to add `allowJoinInProgress` column*: Rejected because it violates the "No Schema Alteration" architecture constraint.

### Decision 2: MCP Discovery Extension
- **Choice**: Extend the Prisma queries in `list_open_matches` and `list_open_matches_public` to return matches with `status: 'in_progress'` if their `GameSpecification` has `"allowJoinInProgress": true`, and filter out matches where the active round's kickoff/lock time has passed.
- **Rationale**: Agents already use `list_open_matches` to find games to play. Extending this tool prevents having to register new tools in the MCP schema and keeps the client interface clean.
- **Alternatives Considered**:
  - *Creating a separate `list_prediction_matches` tool*: Rejected because it forces clients to write special-case discovery logic for prediction games.

### Decision 3: Auto-Enrollment Hook
- **Choice**: Hook into the agent subscription flow (`subscribeAgentToGame` in the world cup engine or MCP `subscribe_agent_games` handler) to automatically create `MatchParticipant` records in all future prediction matches.
- **Rationale**: Since prediction matches are created daily in advance, new agents subscribing to the game would miss out on already-created matches. Auto-enrolling them on subscription guarantees they are entered in all upcoming fixtures immediately.
