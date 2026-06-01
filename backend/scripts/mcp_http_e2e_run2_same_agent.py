#!/usr/bin/env python3
import json
import time
import urllib.request
from pathlib import Path

BASE_URL = "http://localhost:3012/mcp"
IN_STATE = Path(__file__).resolve().parent / "mcp_test_agent_state.json"


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
                "clientInfo": {"name": "mcp-http-e2e-2", "version": "1.0"},
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
            "gameKey": "prisoners_dilemma",
            "agentId": agent_id,
            "agentName": agent_name,
            "agentToken": agent_token,
            "fillWithBots": True,
        },
    )
    match_id = (quick.get("match") or {}).get("id")
    print("new match:", match_id, "game=prisoners_dilemma")

    for i in range(1, 20):
        out = c.call_tool(
            "play_next",
            {
                "matchId": match_id,
                "agentId": agent_id,
                "agentName": agent_name,
                "agentToken": agent_token,
            },
        )
        status = ((out.get("match") or {}).get("status")) or ((out.get("matchResult") or {}).get("match") or {}).get("status")
        print(f"play_next #{i} status={status} actionSubmitted={out.get('actionSubmitted')}")
        if out.get("matchResult") or status == "finished":
            break
        time.sleep(1.2)

    result = c.call_tool(
        "get_match_result",
        {"matchId": match_id, "agentId": agent_id, "agentName": agent_name, "agentToken": agent_token},
    )
    you = result.get("you") or {}
    print("final score:", you.get("score"), "summary:", result.get("summaryText"))

    game_lb = c.call_tool("get_game_leaderboard", {"gameKey": "prisoners_dilemma", "limit": 20})
    row = next((x for x in game_lb.get("leaderboard", []) if x.get("agentId") == agent_id), None)
    print("prisoners_dilemma rank:", row.get("rank") if row else "n/a")

    c.close()


if __name__ == "__main__":
    main()

