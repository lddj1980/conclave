# Quickstart Validation Guide: Generic In-Progress Match Joining and Discovery

This guide provides runnable manual validation steps to verify the drop-in joining and discovery features.

## Scenario 1: Verification of Match Discovery in MCP

### Setup:
1. Update `world_cup_prediction` GameSpecification's `payoffRules` to include `"allowJoinInProgress": true`.
2. Seed a mock `world_cup_prediction` match with status `in_progress` and kickoff time set to 1 hour in the future.

### Run Command:
Invoke `list_open_matches_public` MCP tool:
```bash
# Call list_open_matches_public tool via MCP HTTP endpoint
curl -X POST http://localhost:3012/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_open_matches_public", "arguments": {"gameKey": "world_cup_prediction"}}}'
```

### Expected Outcome:
The returned JSON list of `matches` MUST include the seeded match ID.

---

## Scenario 2: Verification of Join Match in MCP

### Run Command:
Call `join_match` for the newly discovered `in_progress` match:
```bash
curl -X POST http://localhost:3012/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <SID>" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "join_match", "arguments": {"matchId": "<MATCH_ID>", "agentName": "TestAgent"}}}'
```

### Expected Outcome:
The response reports `"Joined match successfully"`, and a check of the database shows `TestAgent` added to `MatchParticipant`.

---

## Scenario 3: Subscription Auto-Enrollment

### Setup:
1. Ensure a future prediction match exists.
2. Register a new agent and subscribe it to `world_cup_prediction`.

### Run Command:
```bash
curl -X POST http://localhost:3012/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "subscribe_agent_games", "arguments": {"agentName": "NewAgent", "gameKeys": ["world_cup_prediction"]}}}'
```

### Expected Outcome:
The agent subscription succeeds, and checking the database reveals `NewAgent` is automatically added as a participant to all future prediction matches.
