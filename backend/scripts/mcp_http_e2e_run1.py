#!/usr/bin/env python3
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE_URL = "http://localhost:3012/mcp"
OUT_STATE = Path(__file__).resolve().parent / "mcp_test_agent_state.json"


class McpHttpClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session_id = None
        self.req_id = 1

    def _post(self, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(self.base_url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=20) as resp:
            sid = resp.headers.get("Mcp-Session-Id")
            if sid:
                self.session_id = sid
            raw = resp.read().decode("utf-8")
            return json.loads(raw)

    def initialize(self):
        payload = {
            "jsonrpc": "2.0",
            "id": self.req_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp-http-e2e", "version": "1.0"},
            },
        }
        self.req_id += 1
        return self._post(payload)

    def call_tool(self, name: str, arguments: dict):
        payload = {
            "jsonrpc": "2.0",
            "id": self.req_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        self.req_id += 1
        res = self._post(payload)
        if "error" in res:
            raise RuntimeError(f"{name} failed: {res['error']}")
        content = (res.get("result") or {}).get("content") or []
        text = next((c.get("text") for c in content if c.get("type") == "text"), None)
        return json.loads(text) if text else {}

    def close(self):
        if not self.session_id:
            return
        req = urllib.request.Request(
            self.base_url,
            headers={"Mcp-Session-Id": self.session_id},
            method="DELETE",
        )
        try:
            urllib.request.urlopen(req, timeout=10).read()
        except Exception:
            pass


def main():
    c = McpHttpClient(BASE_URL)
    init = c.initialize()
    print("initialize ok:", init.get("result", {}).get("serverInfo"))

    agent_name = f"mcp-http-agent-{int(time.time())}"
    reg = c.call_tool(
        "register_agent",
        {
            "name": agent_name,
            "owner": "MCP HTTP E2E",
            "description": "Agent created by mcp_http_e2e_run1.py",
            "subscriptions": ["tic_tac_toe", "prisoners_dilemma"],
        },
    )
    agent = reg.get("agent") or {}
    token = reg.get("agentToken")
    print("registered:", agent.get("id"), agent.get("name"))

    quick = c.call_tool(
        "quickstart_match",
        {
            "gameKey": "tic_tac_toe",
            "agentId": agent.get("id"),
            "agentName": agent.get("name"),
            "agentToken": token,
            "fillWithBots": True,
        },
    )
    match_id = (quick.get("match") or {}).get("id")
    print("match created/joined:", match_id, "status:", (quick.get("match") or {}).get("status"))

    for i in range(1, 30):
        briefing = c.call_tool(
            "get_match_briefing",
            {
                "matchId": match_id,
                "agentId": agent.get("id"),
                "agentName": agent.get("name"),
                "agentToken": token,
            },
        )
        match_status = ((briefing.get("match") or {}).get("status")) or "unknown"
        is_your_turn = bool((briefing.get("you") or {}).get("isYourTurn"))
        already_submitted = bool((briefing.get("you") or {}).get("alreadySubmitted"))
        print(f"briefing #{i} status={match_status} isYourTurn={is_your_turn} alreadySubmitted={already_submitted}")

        if match_status == "finished":
            break

        if is_your_turn and not already_submitted:
            out = c.call_tool(
                "play_next",
                {
                    "matchId": match_id,
                    "agentId": agent.get("id"),
                    "agentName": agent.get("name"),
                    "agentToken": token,
                },
            )
            status = ((out.get("match") or {}).get("status")) or ((out.get("matchResult") or {}).get("match") or {}).get("status")
            print(f"play_next #{i} status={status} actionSubmitted={out.get('actionSubmitted')}")
            if out.get("matchResult") or status == "finished":
                break

        time.sleep(1.2)

    result = c.call_tool(
        "get_match_result",
        {"matchId": match_id, "agentId": agent.get("id"), "agentName": agent.get("name"), "agentToken": token},
    )
    you = result.get("you") or {}
    print("final score:", you.get("score"), "summary:", result.get("summaryText"))

    sb = c.call_tool("get_scoreboard", {})
    row = next((x for x in sb if (x.get("agent") or {}).get("id") == agent.get("id")), None)
    print("global elo:", row.get("elo") if row else "n/a")

    game_lb = c.call_tool("get_game_leaderboard", {"gameKey": "tic_tac_toe", "limit": 20})
    agent_row = next((x for x in game_lb.get("leaderboard", []) if x.get("agentId") == agent.get("id")), None)
    print("tic_tac_toe rank:", agent_row.get("rank") if agent_row else "n/a")

    OUT_STATE.write_text(
        json.dumps(
            {
                "agentId": agent.get("id"),
                "agentName": agent.get("name"),
                "agentToken": token,
                "lastGame": "tic_tac_toe",
                "firstMatchId": match_id,
                "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print("state saved to:", OUT_STATE)
    c.close()


if __name__ == "__main__":
    main()
