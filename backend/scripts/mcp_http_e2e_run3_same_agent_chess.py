#!/usr/bin/env python3
import json
import os
import time
import tempfile
import urllib.request
from pathlib import Path

BASE_URL = "https://backend-production-77cc.up.railway.app/mcp"
IN_STATE = Path(
    os.environ.get("CONCLAVE_E2E_STATE_PATH")
    or Path(tempfile.gettempdir()) / "conclave" / "mcp_test_agent_state.json"
)


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
            return json.loads(resp.read().decode("utf-8"))

    def initialize(self):
        return self._post(
            {
                "jsonrpc": "2.0",
                "id": self.req_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "mcp-http-e2e-3", "version": "1.0"},
                },
            }
        )

    def call_tool(self, name: str, arguments: dict):
        self.req_id += 1
        res = self._post(
            {
                "jsonrpc": "2.0",
                "id": self.req_id,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }
        )
        if "error" in res:
            raise RuntimeError(f"{name} failed: {res['error']}")
        content = (res.get("result") or {}).get("content") or []
        text = next((c.get("text") for c in content if c.get("type") == "text"), None)
        return json.loads(text) if text else {}


def main():
    if not IN_STATE.exists():
        raise RuntimeError(f"State file not found: {IN_STATE}. Run mcp_http_e2e_run1.py first.")

    state = json.loads(IN_STATE.read_text(encoding="utf-8"))
    agent_id = state["agentId"]
    agent_name = state["agentName"]
    agent_token = state["agentToken"]

    c = McpHttpClient(BASE_URL)
    c.initialize()
    print("agent:", agent_id, agent_name)

    quick = c.call_tool(
        "quickstart_match",
        {
            "gameKey": "chess",
            "agentId": agent_id,
            "agentName": agent_name,
            "agentToken": agent_token,
            "fillWithBots": True,
        },
    )
    match = quick.get("match") or {}
    match_id = match.get("id")
    print("new match:", match_id, "game=chess", "status=", match.get("status"))

    for i in range(1, 40):
        briefing = c.call_tool(
            "get_match_briefing",
            {
                "matchId": match_id,
                "agentId": agent_id,
                "agentName": agent_name,
                "agentToken": agent_token,
            },
        )
        ms = (briefing.get("match") or {}).get("status")
        you = briefing.get("you") or {}
        print(f"briefing #{i} status={ms} isYourTurn={you.get('isYourTurn')} alreadySubmitted={you.get('alreadySubmitted')}")
        if ms == "finished":
            break
        if you.get("isYourTurn") and not you.get("alreadySubmitted"):
            out = c.call_tool(
                "play_next",
                {
                    "matchId": match_id,
                    "agentId": agent_id,
                    "agentName": agent_name,
                    "agentToken": agent_token,
                },
            )
            st = ((out.get("match") or {}).get("status")) or ((out.get("matchResult") or {}).get("match") or {}).get("status")
            print(f"play_next #{i} status={st} actionSubmitted={out.get('actionSubmitted')}")
            if out.get("matchResult") or st == "finished":
                break
        time.sleep(1.2)

    result = c.call_tool(
        "get_match_result",
        {"matchId": match_id, "agentId": agent_id, "agentName": agent_name, "agentToken": agent_token},
    )
    print("summary:", result.get("summaryText"))
    you = result.get("you") or {}
    print("final score:", you.get("score"))

    lb = c.call_tool("get_game_leaderboard", {"gameKey": "chess", "limit": 20})
    row = next((x for x in lb.get("leaderboard", []) if x.get("agentId") == agent_id), None)
    print("chess rank:", row.get("rank") if row else "n/a")


if __name__ == "__main__":
    main()
