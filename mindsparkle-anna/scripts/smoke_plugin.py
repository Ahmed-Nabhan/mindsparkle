#!/usr/bin/env python3
"""Smoke-test the MindSparkle executa over stdio JSON-RPC."""

from __future__ import annotations

import base64
import json
import subprocess
import sys
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "executas" / "mindsparkle" / "mindsparkle_plugin.py"


def _tiny_docx(text: str) -> bytes:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>
</w:document>"""
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""",
        )
        zf.writestr(
            "word/_rels/document.xml.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>""",
        )
        zf.writestr("word/document.xml", document_xml)
    return buf.getvalue()


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
    tools = {t["name"] for t in describe["result"]["tools"]}
    assert {"run_mode", "extract_document", "ask_document", "ping"} <= tools

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

    ask = call(
        "invoke",
        {
            "tool": "ask_document",
            "arguments": {"document_text": sample, "question": "What does DNA Center do?"},
        },
        req_id=3,
    )
    assert ask.get("result", {}).get("success") is True, ask
    print("OK ask_document")

    docx_bytes = _tiny_docx("MindSparkle extracts DOCX text for learning modes.")
    extracted = call(
        "invoke",
        {
            "tool": "extract_document",
            "arguments": {
                "filename": "sample.docx",
                "content_base64": base64.b64encode(docx_bytes).decode("ascii"),
                "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
        },
        req_id=4,
    )
    assert extracted.get("result", {}).get("success") is True, extracted
    assert "MindSparkle" in extracted["result"]["data"]["text"]
    print("OK extract_document docx")

    txt = call(
        "invoke",
        {
            "tool": "extract_document",
            "arguments": {
                "filename": "notes.txt",
                "content_base64": base64.b64encode(b"Plain text lecture notes about routing.").decode("ascii"),
                "mime_type": "text/plain",
            },
        },
        req_id=5,
    )
    assert txt.get("result", {}).get("success") is True, txt
    print("OK extract_document txt")

    ping = call("invoke", {"tool": "ping", "arguments": {}}, req_id=6)
    assert ping.get("result", {}).get("success") is True, ping
    proc.terminate()
    print("All plugin smoke tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
