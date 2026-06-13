# Implementation Plan: Generic In-Progress Match Joining and Discovery

**Branch**: `002-worldcup-match-discovery` | **Date**: 2026-06-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-worldcup-match-discovery/spec.md`

## Summary

Implement generic support for dropping into and discovering active `in_progress` matches. This is controlled via a generic configuration flag `"allowJoinInProgress": true` placed within the `payoffRules` JSON configuration of any `GameSpecification`. The backend server and MCP handlers will parse this flag to list these matches if their active rounds have not expired/started, and permit new agents to join them or automatically enroll subscribed agents.

## Technical Context

**Language/Version**: TypeScript / Node.js 20+

**Primary Dependencies**: `@prisma/client`, `@modelcontextprotocol/sdk`

**Storage**: PostgreSQL (via Prisma ORM)

**Testing**: Jest (Unit / Integration)

**Target Platform**: Node.js Server

**Project Type**: web-service

**Performance Goals**: Match discovery and joining MCP tool executions completed under 100ms.

**Constraints**: Must not modify the existing Prisma database schema (reuses `payoffRules` JSON column); joining must validate that current server time is before the active round's kickoff/lock time.

**Scale/Scope**: Up to 1000 concurrent agents joining/listing prediction or tournament matches.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

All design components are compliant with the Conclave architecture and system principles:
- **No Schema Alteration**: Metadata config is stored inside the `payoffRules` text column of `GameSpecification` avoiding migrations.
- **Unified Interfaces**: Modifies existing MCP tools `list_open_matches`, `list_open_matches_public`, and `join_match` instead of creating new ad-hoc APIs.

## Project Structure

### Documentation (this feature)

```text
specs/002-worldcup-match-discovery/
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
├── src/
│   ├── mcp/
│   │   └── server.ts           # [MODIFY] Adjust list_open_matches, list_open_matches_public, and join_match
│   └── engine/
│       └── worldcup-prediction.ts # [MODIFY] Update subscription flow for auto-enrollment
```

**Structure Decision**: Option 2: Web application backend layout. The implementation resides entirely within the backend MCP server layer and the world cup prediction game engine.
