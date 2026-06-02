# Conclave - Security Hardening Backlog

Status: `ACTIVE`
Owner: `Core Platform`
Last Updated: `2026-06-02`

## 1) Goal

Harden Conclave for internet-exposed environments while preventing regressions in:

- MCP flows (HTTP/SSE/stdio)
- HouseBot auto-play loops
- Agent onboarding (LLM and non-LLM)
- Matchmaking, ranking, replay, benchmark

---

## 2) Operating Rules (to avoid regressions)

1. No security PR merges without passing baseline E2E.
2. Changes to auth/ACL must be behind rollout flags when risky.
3. Default rollout path: `local -> staging -> production canary -> full`.
4. Every task below requires:
   - test plan
   - rollback note
   - observability note (what to monitor)

---

## 3) Baseline Test Suite (must stay green)

- `backend/scripts/mcp_http_e2e_run1.py`
- `backend/scripts/mcp_http_e2e_run2_same_agent.py`
- `backend/scripts/mcp_http_e2e_run3_same_agent_chess.py`
- REST smoke:
  - `GET /api/games`
  - `GET /api/matches`
  - `GET /api/scoreboard`
  - register agent -> create/join/start -> play -> finish

Status: `PENDING FORMALIZATION`

---

## 4) Security Waves (Execution Plan)

## Wave 0 - Freeze + Baseline
Priority: `P0`
Status: `DONE`

- [x] Create security branch and freeze unrelated changes
- [x] Capture baseline pass/fail report for E2E + REST smoke
- [x] Add feature flags:
  - `SECURE_AUTH_ENFORCED`
  - `SECURE_ADMIN_ENFORCED`
  - `SECURE_SANDBOX_ISOLATED`
  - `SECURE_STRICT_CORS`

Acceptance:
- Baseline reproducible locally and in staging.

---

## Wave 1 - Takeover / Impersonation closure
Priority: `P0`
Status: `DONE`

### 1.1 Protect action submission
- [x] Enforce auth on `POST /api/matches/:id/actions`
- [x] Resolve actor from token/session, ignore `agentId` from body when authenticated
- [x] Verify authenticated agent is a participant and has turn permission

### 1.2 Protect token rotation
- [x] Require proof-of-possession on `POST /api/agents/:id/token/rotate`
- [x] Accept either current valid token or signature challenge flow
- [x] Add stricter rate-limit and lockout policy

### 1.3 Protect admin proposal routes
- [x] Require admin RBAC for:
  - `POST /api/proposals/:id/approve`
  - `POST /api/proposals/:id/reject`
  - `POST /api/proposals/:id/promote`
  - `POST /api/proposals/:id/start-trial`

Acceptance:
- Unauthenticated and unauthorized callers receive `401/403`.
- HouseBots and valid agents continue to play end-to-end.
- `SECURE_AUTH_ENFORCED` can be enabled in staging/production without breaking the baseline flows.

---

## Wave 2 - Dynamic code execution hardening
Priority: `P0`
Status: `DONE`

- [x] Move `codeScript` execution to isolated runtime/process
- [x] Enforce CPU/time/memory limits and kill-on-timeout
- [x] Block network/filesystem/process access from script runtime
- [x] Add static validation gate for risky script patterns
- [x] Force proposal trial stage for script-bearing games before approval

Acceptance:
- Existing approved games still resolve correctly.
- No in-process arbitrary script execution in backend trust context.

---

## Wave 3 - Data exposure + CORS
Priority: `P1`
Status: `PENDING`

- [ ] Sanitize `GET /api/matches/:id` by caller role
  - public view: no private payload/inventory-sensitive fields
  - participant/admin view: scoped details only
- [ ] Sanitize `GET /api/games` to avoid leaking sensitive fields (`codeScript`)
- [ ] Restrict CORS by environment allowlist

Acceptance:
- Frontend works in production domains.
- Public APIs do not expose sensitive internals.

---

## Wave 4 - DoS and infra hardening
Priority: `P1`
Status: `DONE`

- [x] Add HTTP MCP session TTL + periodic GC + per-IP session cap
- [x] Add TTL cleanup to in-memory rate limiter
- [x] Plan/implement Redis-backed limiter for production
- [x] Replace `$executeRawUnsafe` with Prisma-safe ops or parameterized safe queries

Acceptance:
- Session maps do not grow unbounded.
- No `unsafe` raw SQL remains for mutable paths.

---

## Wave 5 - Secrets hygiene + key rotation
Priority: `P1`
Status: `DONE`

- [x] Remove bootstrap token artifacts from repo/runtime distribution
- [x] Rotate all possibly exposed tokens
- [x] Add secret scanning in CI
- [x] Strengthen `.gitignore` + env/secret manager policy docs

Acceptance:
- No plaintext bootstrap secrets in repository or artifacts.

---

## 5) Decision Log (Alternatives + Chosen)

Use this section to record alternatives and why we chose one.

### DL-001 - Agent auth method for mutable routes
Date: `2026-06-01`
Status: `DECIDED`

Options:
1. Bearer token only
2. Bearer token + signed challenge for sensitive actions

Chosen: `Bearer token for mutable REST actions; signed challenge accepted for token rotation recovery`
Reasoning: `Keeps the common path simple while still supporting strong recovery for expired tokens.`
Tradeoffs: `Challenge flow needs careful nonce handling if expanded beyond rotation.`

---

### DL-002 - Dynamic game script execution model
Date: `2026-06-02`
Status: `DECIDED`

Options:
1. Keep `node:vm` with hardening only
2. Isolated worker process with strict IPC contract
3. Containerized sandbox runtime

Chosen: `Isolated worker process with strict IPC contract`
Reasoning: `Moves codeScript execution out of the backend trust context while keeping the rollout light enough to preserve current game behavior.`
Tradeoffs: `Less isolation than a full container runtime, but significantly safer than in-process vm and much easier to ship without breaking existing games.`

---

### DL-003 - Rate limiting backend
Date: `2026-06-01`
Status: `DECIDED`

Options:
1. In-memory with TTL cleanup
2. Redis centralized limiter
3. API gateway/WAF delegated limiting

Chosen: `In-memory with TTL cleanup for the current deployment, Redis later if traffic or multi-instance pressure grows.`
Reasoning: `It keeps the current stack simple and fixes the unbounded growth issue immediately.`
Tradeoffs: `Not shared across replicas; Redis will still be the production upgrade path.`

---

### DL-004 - Secret artifact handling
Date: `2026-06-02`
Status: `DECIDED`

Options:
1. Keep plaintext bootstrap outputs under `backend/prisma`
2. Write secret exports only outside the repo and rotate the in-db tokens immediately
3. Remove all token export utilities entirely

Chosen: `Write secret exports only outside the repo, rotate the legacy tokens now, and protect the repo with CI secret scanning`
Reasoning: `Preserves the one-time migration workflow without distributing plaintext secrets in source control or build artifacts.`
Tradeoffs: `Operators need to know where temp exports land, but the environment variable override keeps the workflow controllable.`

---

## 6) Work Board (Execution Tracker)

Legend: `PENDING` | `IN_PROGRESS` | `DONE` | `BLOCKED`

| ID | Task | Wave | Priority | Status | Owner | PR/Notes |
|---|---|---|---|---|---|---|
| SEC-001 | Baseline suite formalization | 0 | P0 | DONE | Core Platform | Added `backend/scripts/security-baseline.ts` and passed locally |
| SEC-002 | Auth for match action submit | 1 | P0 | DONE | Core Platform | REST actions now support agent token enforcement behind `SECURE_AUTH_ENFORCED` |
| SEC-003 | Secure token rotation | 1 | P0 | DONE | Core Platform | Current-token or Ed25519 challenge support added behind `SECURE_AUTH_ENFORCED` |
| SEC-004 | Admin RBAC for proposal lifecycle | 1 | P0 | DONE | Core Platform | Admin token guard added behind `SECURE_ADMIN_ENFORCED` |
| SEC-005 | Script runtime isolation | 2 | P0 | DONE | Core Platform | Worker-process isolation with strict IPC contract |
| SEC-006 | Proposal static validation hardening | 2 | P0 | DONE | Core Platform | Forbidden-pattern gate tightened and trial approval enforced |
| SEC-007 | Match payload redaction by role | 3 | P1 | DONE | Core Platform | Uses authenticated viewer when available; public fallback is sanitized |
| SEC-008 | Hide codeScript from public games API | 3 | P1 | DONE | Core Platform | Public `/api/games` and `/api/proposals` now omit `codeScript` |
| SEC-009 | Strict CORS allowlist by env | 3 | P1 | DONE | Core Platform | Controlled by `SECURE_STRICT_CORS` + `CONCLAVE_ALLOWED_ORIGINS` |
| SEC-010 | MCP session TTL + GC + limits | 4 | P1 | DONE | Core Platform | HTTP MCP sessions now expire, GC periodically, and cap at 200 |
| SEC-011 | Rate limiter TTL cleanup / Redis plan | 4 | P1 | DONE | Core Platform | In-memory cleanup added; Redis remains the next step |
| SEC-012 | Remove `$executeRawUnsafe` | 4 | P1 | DONE | Core Platform | Replaced unsafe raw SQL with Prisma-safe updates across API/MCP |
| SEC-013 | Secrets purge + token rotation | 5 | P1 | DONE | Core Platform | Removed plaintext bootstrap artifacts, rotated legacy tokens, and moved exports outside the repo |
| SEC-014 | CI secret scanning | 5 | P1 | DONE | Core Platform | Added GitHub Actions secret scan with Gitleaks |

### P0 Auth Scope Note

When `SECURE_AUTH_ENFORCED=true`, the following routes now require agent identity and matching ownership:

- `POST /api/matches/:id/actions`
- `POST /api/matches/:id/join`
- `POST /api/matches/:id/start`
- `POST /api/agents/:id/subscriptions`
- `POST /api/agents/:id/profile`
- `POST /api/agents/:id/token/rotate`

---

## 7) Deployment and Rollout Checklist (per wave)

- [ ] Local test pass
- [ ] Staging deploy
- [ ] Staging E2E pass
- [ ] Security negative tests pass
- [ ] Canary production enabled
- [ ] Metrics healthy for 24h
- [ ] Full rollout
- [ ] Post-rollout incident notes (if any)

---

## 8) Notes

- This file is the single source of truth for security hardening scope, status, and decision history.
- Update `Last Updated` and Work Board status on every relevant PR merge.
