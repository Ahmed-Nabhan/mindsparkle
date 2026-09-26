"""MindSparkle Executa — extract docs + learning modes + ask."""

from __future__ import annotations

import base64
import json
import re
import sys
import zipfile
from io import BytesIO
from typing import Any
from xml.etree import ElementTree as ET

MANIFEST = {
    "name": "tool-dev-mindsparkle",
    "display_name": "MindSparkle Learning Tools",
    "version": "0.2.0",
    "description": "Extract documents and run summarize/quiz/presentation/guide/study/ask modes.",
    "host_capabilities": ["llm.sample", "aps.kv"],
    "tools": [
        {
            "name": "extract_document",
            "description": "Extract plain text from uploaded document bytes (pdf, docx, txt, md, csv, json).",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "content_base64": {"type": "string"},
                    "mime_type": {"type": "string"},
                },
                "required": ["filename", "content_base64"],
                "additionalProperties": False,
            },
        },
        {
            "name": "run_mode",
            "description": "Run summarize, quiz, presentation, guide, or study on document text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["summarize", "quiz", "presentation", "guide", "study"],
                    },
                    "document_text": {"type": "string"},
                    "user_prompt": {"type": "string"},
                    "question_count": {"type": "integer", "default": 5},
                    "slide_count": {"type": "integer", "default": 6},
                },
                "required": ["mode", "document_text"],
                "additionalProperties": False,
            },
        },
        {
            "name": "ask_document",
            "description": "Answer a user question using the provided document text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "document_text": {"type": "string"},
                    "question": {"type": "string"},
                },
                "required": ["document_text", "question"],
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


def _ext(name: str) -> str:
    parts = (name or "").lower().rsplit(".", 1)
    return parts[-1] if len(parts) == 2 else ""


def _decode_base64(payload: str) -> bytes:
    raw = (payload or "").strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


def _extract_docx(data: bytes) -> str:
    with zipfile.ZipFile(BytesIO(data)) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    texts: list[str] = []
    for node in root.findall(".//w:t", ns):
        if node.text:
            texts.append(node.text)
    # Prefer paragraph breaks when possible
    paras: list[str] = []
    for p in root.findall(".//w:p", ns):
        bits = [t.text for t in p.findall(".//w:t", ns) if t.text]
        line = "".join(bits).strip()
        if line:
            paras.append(line)
    return "\n\n".join(paras) if paras else " ".join(texts)


def _extract_pdf(data: bytes) -> tuple[str, str]:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "PDF support requires pypdf. Install dependencies for the executa environment."
        ) from exc
    reader = PdfReader(BytesIO(data))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            pages.append("")
    text = "\n\n".join(p.strip() for p in pages if p and p.strip())
    return text, "pypdf"


def extract_document(filename: str, content_base64: str, mime_type: str = "") -> dict[str, Any]:
    # Guard the Anna stdio 16 MiB frame limit (~12 MiB base64 practical ceiling).
    if content_base64 and len(content_base64) > 10_000_000:
        return {
            "success": False,
            "error": (
                "File payload too large for tool transfer. "
                "Use in-browser extraction (MindSparkle UI) instead of sending raw bytes to the tool."
            ),
        }
    data = _decode_base64(content_base64)
    ext = _ext(filename)
    mime = (mime_type or "").lower()

    if ext in {"txt", "md", "markdown", "csv", "json", "log", "html", "htm"} or mime.startswith("text/"):
        text = data.decode("utf-8", errors="replace")
        engine = "utf8-text"
    elif ext == "docx" or "wordprocessingml" in mime:
        text = _extract_docx(data)
        engine = "docx-xml"
    elif ext == "pdf" or mime == "application/pdf":
        text, engine = _extract_pdf(data)
    else:
        # Best-effort text decode for unknown types
        text = data.decode("utf-8", errors="replace")
        engine = "utf8-fallback"

    text = (text or "").strip()
    if not text:
        return {"success": False, "error": f"No extractable text found in {filename or 'file'}"}
    return {
        "success": True,
        "data": {
            "filename": filename,
            "text": text,
            "chars": len(text),
            "engine": engine,
            "ext": ext,
        },
    }


def _pick_diverse(sents: list[str], count: int = 8) -> list[str]:
    if not sents:
        return []
    if len(sents) <= count:
        return sents
    step = max(1, len(sents) // count)
    picked = [sents[i] for i in range(0, len(sents), step)]
    # always include early + late signal
    if sents[0] not in picked:
        picked = [sents[0], *picked]
    if sents[-1] not in picked:
        picked.append(sents[-1])
    # de-dupe preserve order
    out: list[str] = []
    seen = set()
    for s in picked:
        key = s[:80]
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= count:
            break
    return out


def summarize(document_text: str, user_prompt: str = "") -> dict[str, Any]:
    paras = _paragraphs(document_text)
    sents = _sentences(document_text)
    key_points = _pick_diverse(sents, 8) if sents else paras[:8]
    overview = " ".join(key_points[:2]) if key_points else "No usable text found."
    focus = user_prompt.strip() or "general understanding"
    concepts = []
    for point in key_points[:6]:
        words = re.findall(r"[A-Za-z][A-Za-z\-]{4,}", point)
        if words:
            concepts.append(f"- **{' / '.join(words[:3])}** — {point[:160]}")

    markdown = [
        "## Summary",
        "",
        overview,
        "",
        f"**Focus:** {focus}",
        "",
        "## Key Takeaways",
    ]
    for i, point in enumerate(key_points[:8], 1):
        markdown.append(f"{i}. {point}")
    if concepts:
        markdown.extend(["", "## Important Concepts", *concepts])
    if paras:
        markdown.extend(["", "## Sections Covered", ""])
        for i, p in enumerate(paras[:6], 1):
            title = (p[:80] + "…") if len(p) > 80 else p
            markdown.append(f"- Section {i}: {title}")
    markdown.extend(
        [
            "",
            "## Next Steps",
            "- Run **Quiz** on weak points",
            "- Run **Guide** for a study path",
            "- Ask a specific question in chat",
        ]
    )

    return {
        "mode": "summarize",
        "title": "Document Summary",
        "markdown": "\n".join(markdown),
        "key_points": key_points[:8],
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
                "explanation": "Upload richer document text for better quizzes.",
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
                    "question": f"Which statement best matches idea {i + 1} from the material?",
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
        ans = chr(ord("A") + int(q["answer_index"]))
        md.append(f"Answer: {ans}")
        md.append(f"_Why:_ {q['explanation']}")
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
    slides = [
        {
            "title": "Overview",
            "bullets": [
                "Purpose of this deck",
                "Source document highlights",
                user_prompt.strip() or "General walkthrough",
            ],
        }
    ]
    for i, p in enumerate(paras[: count - 2], 1):
        sents = _sentences(p) or [p]
        slides.append({"title": f"Section {i}", "bullets": [s[:120] for s in sents[:3]]})
    slides.append(
        {
            "title": "Takeaways",
            "bullets": [
                "Review the key sections above",
                "Convert uncertain points into quiz practice",
                "Ask MindSparkle follow-up questions in chat",
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
    for i, p in enumerate(paras[:7], 1):
        steps.append(
            {
                "step": i,
                "title": f"Step {i}",
                "detail": p[:300],
                "action": "Read carefully, then explain this section aloud in your own words.",
            }
        )
    if not steps:
        steps = [
            {
                "step": 1,
                "title": "Add source material",
                "detail": "Upload a PDF/DOCX/TXT document to build a learning path.",
                "action": "Attach a file, then run Guide again.",
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
    for i, sent in enumerate(sents[:10], 1):
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
            "### Memory tips",
            "- Teach each concept to an imaginary classmate",
            "- Write one example that is not copied from the text",
            "",
            "### Revision checklist",
            "- Recite each concept without looking",
            "- Mark weak points",
            "- Run Quiz mode on those weak points",
        ]
    )

    return {
        "mode": "study",
        "title": "Study Pack",
        "markdown": "\n".join(md),
        "concepts": concepts,
        "engine": "local-extractive",
    }


def ask_document(document_text: str, question: str) -> dict[str, Any]:
    q = (question or "").strip()
    sents = _sentences(document_text)
    q_words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", q)}
    ranked: list[tuple[int, str]] = []
    for sent in sents:
        score = sum(1 for w in q_words if w in sent.lower())
        if score:
            ranked.append((score, sent))
    ranked.sort(key=lambda x: x[0], reverse=True)
    evidence = [s for _, s in ranked[:4]] or sents[:3] or [document_text[:400]]

    md = [
        "## Answer",
        "",
        f"**Question:** {q or 'N/A'}",
        "",
        "### Best matching evidence from your document",
    ]
    for i, ev in enumerate(evidence, 1):
        md.append(f"{i}. {ev}")
    md.extend(
        [
            "",
            "### Short synthesis",
            " ".join(evidence[:2]) if evidence else "No matching passages found.",
            "",
            "_Tip:_ For richer answers, press **Run mode** on Summarize, or connect Anna LLM.",
        ]
    )
    return {
        "mode": "ask",
        "title": "Document Answer",
        "markdown": "\n".join(md),
        "evidence": evidence,
        "engine": "local-retrieval",
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
        return {"success": True, "data": {"pong": True, "app": "mindsparkle", "version": "0.2.0"}}

    if method == "extract_document":
        return extract_document(
            (args or {}).get("filename", "document"),
            (args or {}).get("content_base64", ""),
            (args or {}).get("mime_type", ""),
        )

    if method == "ask_document":
        text = (args or {}).get("document_text") or ""
        question = (args or {}).get("question") or ""
        if not str(text).strip():
            return {"success": False, "error": "document_text is required"}
        if not str(question).strip():
            return {"success": False, "error": "question is required"}
        return {"success": True, "data": ask_document(text, question)}

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
