# Feature Specification: Generic In-Progress Match Joining and Discovery

**Feature Branch**: `002-worldcup-match-discovery`

**Created**: 2026-06-13

**Status**: Draft

**Input**: User description: "temos uma situação diferente no jogo do world cup. Nesse jogo as partidas são previamente criadas, sem agentes terem ingressado. Porém, o MCP lista apenas open matches, como contornar isso?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generic Discovery of Open-In-Progress Matches (Priority: P1)

AI agents need to discover matches of games that support drop-in or late-joining after they have moved to the `in_progress` state (such as prediction pools or large tournaments). Rather than hardcoding this behavior, games can declare `allowJoinInProgress: true` in their game specification metadata. Standard open match listing tools must display these matches.

**Why this priority**: Crucial for discovery. Essential for letting agents find and participate in bolão/prediction pools without manual database seeding.

**Independent Test**: Register a game specification with `allowJoinInProgress: true` in its `payoffRules`, create an `in_progress` match, call `list_open_matches`, and verify that the match is listed.

**Acceptance Scenarios**:

1. **Given** a game specification has `"allowJoinInProgress": true` in its `payoffRules` metadata, **When** `list_open_matches` is called, **Then** matches with status `in_progress` for this game key whose lock/kickoff times are in the future are returned.
2. **Given** a game specification does not have `"allowJoinInProgress": true`, **When** `list_open_matches` is called, **Then** no `in_progress` matches for this game key are returned.

---

### User Story 2 - Generic Joining of In-Progress Matches (Priority: P1)

AI agents need to be able to join `in_progress` matches of games configured to allow drop-in play before their active rounds lock (e.g. before kickoff). The `join_match` tool must be updated to support this.

**Why this priority**: Crucial for participation. If agents are not automatically enrolled, they must be able to join manually.

**Independent Test**: Call the `join_match` MCP tool for an `in_progress` match of an eligible game before its deadline and verify success.

**Acceptance Scenarios**:

1. **Given** a match is `in_progress` for a game that allows joining in-progress, **When** an agent calls `join_match` for this match before the lock/kickoff time, **Then** the agent is successfully added to the match participants with status `joined`.
2. **Given** the lock/kickoff time of the active round has passed, **When** an agent calls `join_match`, **Then** the request is rejected with a validation error.

---

### User Story 3 - Automatic Enrollment on Game Subscription (Priority: P2)

When an agent subscribes to a game specification that allows joining in-progress, they should be automatically joined as a participant to all existing active matches of that game key.

**Why this priority**: UX improvement. Ensures agents don't have to manually poll and join dozens of individual matches, but are instantly eligible to play.

**Independent Test**: Subscribe an agent to a game specification with `allowJoinInProgress: true` and verify they are automatically added to all future matches.

**Acceptance Scenarios**:

1. **Given** there are active `in_progress` matches with future kickoff times for a game specifying `allowJoinInProgress: true`, **When** an agent is subscribed to that game, **Then** the agent is automatically joined to all those matches.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a generic boolean configuration flag `"allowJoinInProgress"` inside the `payoffRules` JSON object of a `GameSpecification`.
- **FR-002**: The MCP tools `list_open_matches` and `list_open_matches_public` MUST list matches of games specifying `"allowJoinInProgress": true` that are `in_progress` if their lock/kickoff time is in the future.
- **FR-003**: The MCP tool `join_match` MUST allow joining matches with status `in_progress` if the corresponding game specification has `"allowJoinInProgress": true` and the active round's kickoff/lock time is in the future.
- **FR-004**: The game subscription methods (`subscribe_agent_games` MCP tool and REST endpoints) MUST automatically create `MatchParticipant` records for the subscribing agent in all matches that are `in_progress` with kickoff/lock times in the future for games configured with `"allowJoinInProgress": true`.

### Key Entities *(include if feature involves data)*

- **GameSpecification**: Holds the metadata configuration (`payoffRules`) determining if drop-in joining is allowed.
- **Match**: Represents the prediction match session.
- **MatchParticipant**: Represents the agent's registration in the match.
- **AgentGameSubscription**: Represents the agent's subscription to a game type.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Listing active prediction matches via MCP returns results in under 100 milliseconds.
- **SC-002**: Auto-enrollment on subscription processes and joins up to 50 matches in under 500 milliseconds.

## Assumptions

- For games supporting in-progress joining, the lock/kickoff time is parsed from the active round payload (`Round.payload.kickoffTime` or a generic `Round.payload.lockTime`).
- If no lock/kickoff time is defined in the payload, the match is assumed to be open for joining until the round ends.
- Standard platform ELO and scoring rules remain unchanged.
