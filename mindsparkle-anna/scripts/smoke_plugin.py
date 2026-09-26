#!/usr/bin/env python3
"""Smoke-test the MindSparkle executa over stdio JSON-RPC."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "executas" / "mindsparkle" / "mindsparkle_plugin.py"


def main() -> int:
    proc = subprocess.Popen(
        [sys.executable, str(PLUGIN)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert proc.stdin and proc.stdout

    def call(method: str, params=None, req_id: int = 1):
        req = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            req["params"] = params
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()
        return json.loads(proc.stdout.readline())

    describe = call("describe")
    assert "result" in describe, describe
    assert describe["result"]["name"] == "tool-dev-mindsparkle"

    sample = (
        "Cisco SDA simplifies campus networks. DNA Center orchestrates policy. "
        "Engineers automate switch configuration with Python scripts. "
        "Wireless migrations move legacy SSIDs onto SDA fabric."
    )
    for mode in ["summarize", "quiz", "presentation", "guide", "study"]:
        out = call(
            "invoke",
            {
                "tool": "run_mode",
                "arguments": {"mode": mode, "document_text": sample, "user_prompt": "focus on SDA"},
            },
            req_id=2,
        )
        assert out.get("result", {}).get("success") is True, out
        data = out["result"]["data"]
        assert data.get("markdown"), mode
        print(f"OK {mode}: {data.get('title')} ({len(data['markdown'])} chars)")

    ping = call("invoke", {"tool": "ping", "arguments": {}}, req_id=3)
    assert ping.get("result", {}).get("success") is True, ping
    proc.terminate()
    print("All plugin smoke tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
