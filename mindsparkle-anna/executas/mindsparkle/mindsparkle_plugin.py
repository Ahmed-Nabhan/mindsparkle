"""MindSparkle Executa — learning modes for documents."""

from __future__ import annotations

import json
import re
import sys
from typing import Any

MANIFEST = {
    "name": "tool-dev-mindsparkle",
    "display_name": "MindSparkle Learning Tools",
    "version": "0.1.0",
    "description": "Summarize, quiz, presentation, guide, and study tools for documents.",
    "host_capabilities": ["llm.sample", "aps.kv"],
    "tools": [
        {
            "name": "run_mode",
            "description": (
                "Run a MindSparkle learning mode on document text. "
                "Modes: summarize, quiz, presentation, guide, study."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["summarize", "quiz", "presentation", "guide", "study"],
                        "description": "Learning mode to run",
                    },
                    "document_text": {
                        "type": "string",
                        "description": "Source document text",
                    },
                    "user_prompt": {
                        "type": "string",
                        "description": "Optional extra instruction from the user",
                    },
                    "question_count": {
                        "type": "integer",
                        "description": "Quiz question count (quiz mode)",
                        "default": 5,
                    },
                    "slide_count": {
                        "type": "integer",
                        "description": "Presentation slide count",
                        "default": 6,
                    },
                },
                "required": ["mode", "document_text"],
                "additionalProperties": False,
            },
        },
        {
            "name": "ping",
            "description": "Health/smoke test.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    ],
}


def _sentences(text: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    return [p.strip() for p in parts if len(p.strip()) > 20]


def _paragraphs(text: str) -> list[str]:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text or "") if b.strip()]
    if blocks:
        return blocks
    sents = _sentences(text)
    return sents[:8] if sents else ([text.strip()] if text.strip() else [])


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def summarize(document_text: str, user_prompt: str = "") -> dict[str, Any]:
    paras = _paragraphs(document_text)
    sents = _sentences(document_text)
    key_points = sents[:6] if sents else paras[:6]
    overview = " ".join(key_points[:2]) if key_points else "No usable text found."
    focus = user_prompt.strip() or "general understanding"

    markdown = [
        "## Summary",
        "",
        overview,
        "",
        f"**Focus:** {focus}",
        "",
        "### Key points",
    ]
    for i, point in enumerate(key_points[:6], 1):
        markdown.append(f"{i}. {point}")

    if paras:
        markdown.extend(["", "### Sections covered", ""])
        for i, p in enumerate(paras[:5], 1):
            title = (p[:72] + "…") if len(p) > 72 else p
            markdown.append(f"- Section {i}: {title}")

    return {
        "mode": "summarize",
        "title": "Document Summary",
        "markdown": "\n".join(markdown),
        "key_points": key_points[:6],
        "engine": "local-extractive",
    }


def quiz(document_text: str, question_count: int = 5, user_prompt: str = "") -> dict[str, Any]:
    sents = _sentences(document_text)
    count = _clamp(int(question_count or 5), 3, 10)
    questions = []
    if not sents:
        questions.append(
            {
                "id": 1,
                "question": "What is the main topic of this document?",
                "options": ["Not enough text provided", "Mathematics", "History", "Sports"],
                "answer_index": 0,
                "explanation": "Upload or paste more document text for richer quizzes.",
            }
        )
    else:
        for i in range(min(count, len(sents))):
            sent = sents[i]
            words = [w for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", sent)]
            topic = words[0] if words else "the topic"
            questions.append(
                {
                    "id": i + 1,
                    "question": f"According to the material, which statement best matches point {i + 1}?",
                    "options": [
                        sent[:140],
                        f"{topic} is unrelated to this document.",
                        "The document never mentions this idea.",
                        "This point contradicts the source text.",
                    ],
                    "answer_index": 0,
                    "explanation": sent[:220],
                }
            )

    md = ["## Quiz", ""]
    if user_prompt.strip():
        md.append(f"_User focus:_ {user_prompt.strip()}")
        md.append("")
    for q in questions:
        md.append(f"**Q{q['id']}. {q['question']}**")
        for idx, opt in enumerate(q["options"]):
            letter = chr(ord("A") + idx)
            md.append(f"- {letter}) {opt}")
        md.append("")

    return {
        "mode": "quiz",
        "title": "Practice Quiz",
        "markdown": "\n".join(md),
        "questions": questions,
        "engine": "local-extractive",
    }


def presentation(document_text: str, slide_count: int = 6, user_prompt: str = "") -> dict[str, Any]:
    paras = _paragraphs(document_text)
    count = _clamp(int(slide_count or 6), 4, 10)
    slides = [{"title": "Overview", "bullets": ["Purpose of this deck", "Source document highlights", user_prompt.strip() or "General walkthrough"]}]
    for i, p in enumerate(paras[: count - 2], 1):
        sents = _sentences(p) or [p]
        slides.append(
            {
                "title": f"Section {i}",
                "bullets": [s[:120] for s in sents[:3]],
            }
        )
    slides.append(
        {
            "title": "Takeaways",
            "bullets": [
                "Review the key sections above",
                "Convert uncertain points into quiz practice",
                "Ask MindSparkle for a deeper guide if needed",
            ],
        }
    )

    md = ["## Presentation outline", ""]
    for i, slide in enumerate(slides, 1):
        md.append(f"### Slide {i}: {slide['title']}")
        for b in slide["bullets"]:
            if b:
                md.append(f"- {b}")
        md.append("")

    return {
        "mode": "presentation",
        "title": "Presentation Outline",
        "markdown": "\n".join(md),
        "slides": slides,
        "engine": "local-extractive",
    }


def guide(document_text: str, user_prompt: str = "") -> dict[str, Any]:
    paras = _paragraphs(document_text)
    steps = []
    for i, p in enumerate(paras[:6], 1):
        steps.append(
            {
                "step": i,
                "title": f"Step {i}",
                "detail": p[:280],
                "action": "Read carefully, then explain this section in your own words.",
            }
        )
    if not steps:
        steps = [
            {
                "step": 1,
                "title": "Add source material",
                "detail": "Paste or upload a document to build a learning path.",
                "action": "Attach text, then run Guide again.",
            }
        ]

    md = ["## Learning Guide", ""]
    if user_prompt.strip():
        md.append(f"**Goal:** {user_prompt.strip()}")
        md.append("")
    for s in steps:
        md.append(f"### {s['title']}")
        md.append(s["detail"])
        md.append(f"_Action:_ {s['action']}")
        md.append("")

    return {
        "mode": "guide",
        "title": "Learning Guide",
        "markdown": "\n".join(md),
        "steps": steps,
        "engine": "local-extractive",
    }


def study(document_text: str, user_prompt: str = "") -> dict[str, Any]:
    sents = _sentences(document_text)
    concepts = []
    for i, sent in enumerate(sents[:8], 1):
        words = re.findall(r"[A-Za-z][A-Za-z\-]{4,}", sent)
        label = " / ".join(words[:3]) if words else f"Concept {i}"
        concepts.append({"term": label, "note": sent[:220]})

    md = ["## Study Pack", ""]
    if user_prompt.strip():
        md.append(f"**Focus:** {user_prompt.strip()}")
        md.append("")
    md.append("### Key concepts")
    for c in concepts:
        md.append(f"- **{c['term']}** — {c['note']}")
    md.extend(
        [
            "",
            "### Revision checklist",
            "- Recite each concept without looking",
            "- Write one example for every key idea",
            "- Run Quiz mode to stress-test weak spots",
        ]
    )

    return {
        "mode": "study",
        "title": "Study Pack",
        "markdown": "\n".join(md),
        "concepts": concepts,
        "engine": "local-extractive",
    }


HANDLERS = {
    "summarize": lambda args: summarize(args.get("document_text", ""), args.get("user_prompt", "")),
    "quiz": lambda args: quiz(
        args.get("document_text", ""),
        args.get("question_count", 5),
        args.get("user_prompt", ""),
    ),
    "presentation": lambda args: presentation(
        args.get("document_text", ""),
        args.get("slide_count", 6),
        args.get("user_prompt", ""),
    ),
    "guide": lambda args: guide(args.get("document_text", ""), args.get("user_prompt", "")),
    "study": lambda args: study(args.get("document_text", ""), args.get("user_prompt", "")),
}


def invoke(method: str, args: dict) -> dict:
    if method == "ping":
        return {"success": True, "data": {"pong": True, "app": "mindsparkle"}}

    if method == "run_mode":
        mode = (args or {}).get("mode")
        text = (args or {}).get("document_text") or ""
        if mode not in HANDLERS:
            return {"success": False, "error": f"unknown mode: {mode}"}
        if not str(text).strip():
            return {"success": False, "error": "document_text is required"}
        return {"success": True, "data": HANDLERS[mode](args or {})}

    return {"success": False, "error": f"unknown method: {method}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if req.get("method") == "describe":
                result = MANIFEST
            elif req.get("method") == "health":
                result = {"status": "ready"}
            elif req.get("method") == "invoke":
                params = req.get("params") or {}
                result = invoke(params.get("tool", ""), params.get("arguments") or {})
            else:
                raise ValueError(f"unknown rpc: {req.get('method')}")
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "result": result}) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": req.get("id"),
                        "error": {"code": -32601, "message": str(e)},
                    }
                )
                + "\n"
            )
        sys.stdout.flush()


if __name__ == "__main__":
    main()
