"""MindSparkle Executa — extract docs + learning modes + ask (LLM-first)."""

from __future__ import annotations

import base64
import json
import re
import sys
import uuid
import zipfile
from io import BytesIO
from typing import Any
from xml.etree import ElementTree as ET

MANIFEST = {
    "name": "tool-dev-mindsparkle",
    "display_name": "MindSparkle Learning Tools",
    "version": "0.3.0",
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

# Set True only after host initialize advertises sampling capability.
_HOST_SAMPLING = False

SYSTEM = (
    "You are MindSparkle, an elite tutor. Be concrete, specific, and useful. "
    "Use only facts supported by the document. Never invent citations. "
    "Avoid generic study advice that could apply to any document."
)

MODE_PROMPTS = {
    "summarize": """Write high-value study notes for THIS document only.

## TL;DR
2 sharp sentences. No filler.

## Core Ideas
8-12 bullets. Each bullet = one concrete claim (names, numbers, mechanisms, decisions). No vague phrases like "important concept".

## Deep Dive
3 subsections (### Title) covering the strongest themes. 3-5 sentences each that synthesize, not quote.

## Key Terms
- **Term** — precise definition from context

## Exam Traps
3 misconceptions a student might form from skimming.

## Next Study Moves
3 actions tied to THIS material (not generic "run quiz").""",
    "quiz": """Return ONLY valid JSON (no markdown fences):
{"questions":[{"id":1,"question":"...","options":["...","...","...","..."],"answer_index":0,"explanation":"..."}]}

Rules:
- Exactly 6 hard but fair multiple-choice questions
- Cover beginning, middle, AND end of the document
- Options similar length; only one clearly correct
- No "all of the above" / "none of the above"
- explanation: one sentence grounded in the text""",
    "presentation": """Return ONLY valid JSON (no markdown fences):
{"slides":[{"title":"...","bullets":["...","...","..."]}]}

Rules:
- Exactly 8 slides
- Slide 1 = hook/overview, last slide = takeaways + call to action
- 3-4 punchy bullets per slide (teach/pitch ready)
- Cover whole document arc""",
    "guide": """Return ONLY valid JSON (no markdown fences):
{"steps":[{"step":1,"title":"...","detail":"...","action":"..."}]}

Rules:
- 7 progressive steps (foundations → advanced)
- detail: 2-3 sentences grounded in the document
- action: one concrete learner task for that step""",
    "study": """Return ONLY valid JSON (no markdown fences):
{"concepts":[{"term":"...","note":"..."}],"hooks":["..."],"checklist":["..."],"drills":["..."]}

Rules:
- 8-12 concepts with clear term + explanation from the doc
- 4 memory hooks (mnemonics/analogies tied to content)
- 6 revision checklist items
- 3 self-test drill prompts""",
}


def _write(envelope: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(envelope) + "\n")
    sys.stdout.flush()


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


def _sample_document(text: str, max_chars: int = 24000) -> str:
    raw = text or ""
    if len(raw) <= max_chars:
        return raw
    head = int(max_chars * 0.4)
    mid = int(max_chars * 0.25)
    mid2 = int(max_chars * 0.15)
    tail = max_chars - head - mid - mid2
    q1 = max(0, len(raw) // 4 - mid // 2)
    q3 = max(0, (3 * len(raw)) // 4 - mid2 // 2)
    return "\n\n".join(
        [
            raw[:head],
            "[... sample ~25% ...]",
            raw[q1 : q1 + mid],
            "[... sample ~75% ...]",
            raw[q3 : q3 + mid2],
            "[... end sample ...]",
            raw[-tail:],
        ]
    )


def _extract_docx(data: bytes) -> str:
    with zipfile.ZipFile(BytesIO(data)) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paras: list[str] = []
    for p in root.findall(".//w:p", ns):
        bits = [t.text for t in p.findall(".//w:t", ns) if t.text]
        line = "".join(bits).strip()
        if line:
            paras.append(line)
    if paras:
        return "\n\n".join(paras)
    texts = [node.text for node in root.findall(".//w:t", ns) if node.text]
    return " ".join(texts)


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
    if sents[0] not in picked:
        picked = [sents[0], *picked]
    if sents[-1] not in picked:
        picked.append(sents[-1])
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


def _request_sampling(messages: list[dict[str, Any]], max_tokens: int = 2200) -> str:
    """Reverse-RPC sampling/createMessage; only call when _HOST_SAMPLING is True."""
    rid = str(uuid.uuid4())
    _write(
        {
            "jsonrpc": "2.0",
            "id": rid,
            "method": "sampling/createMessage",
            "params": {
                "messages": messages,
                "systemPrompt": SYSTEM,
                "maxTokens": max_tokens,
                "temperature": 0.35,
            },
        }
    )
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        env = json.loads(line)
        if env.get("id") == rid and "method" not in env:
            if "error" in env:
                raise RuntimeError(env["error"].get("message", "sampling failed"))
            result = env.get("result") or {}
            content = result.get("content") or {}
            if isinstance(content, dict):
                return str(content.get("text") or "").strip()
            if isinstance(content, list):
                return "\n".join(str(c.get("text") or "") for c in content if isinstance(c, dict)).strip()
            return str(result.get("text") or "").strip()
        _dispatch(env)
    raise RuntimeError("stdin closed before sampling response arrived")


def _parse_json_blob(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                return data if isinstance(data, dict) else None
            except Exception:  # noqa: BLE001
                return None
    return None


def _llm_mode(mode: str, document_text: str, user_prompt: str = "") -> dict[str, Any] | None:
    if not _HOST_SAMPLING:
        return None
    task = MODE_PROMPTS.get(mode)
    if not task:
        return None
    extra = f"\n\nLearner focus: {user_prompt.strip()}" if user_prompt.strip() else ""
    sample = _sample_document(document_text)
    try:
        text = _request_sampling(
            [
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": f"{task}{extra}\n\nDOCUMENT:\n{sample}",
                    },
                }
            ],
            max_tokens=2800 if mode == "summarize" else 2200,
        )
    except Exception:  # noqa: BLE001
        return None
    if not text:
        return None

    titles = {
        "summarize": "Document Summary",
        "quiz": "Practice Quiz",
        "presentation": "Presentation Outline",
        "guide": "Learning Guide",
        "study": "Study Pack",
    }

    if mode == "summarize":
        return {
            "mode": "summarize",
            "title": titles[mode],
            "markdown": text,
            "engine": "host-llm.sample",
        }

    data = _parse_json_blob(text)
    if not data:
        return {
            "mode": mode,
            "title": titles[mode],
            "markdown": text,
            "engine": "host-llm.sample",
        }

    out: dict[str, Any] = {
        "mode": mode,
        "title": titles[mode],
        "engine": "host-llm.sample",
        "markdown": text,
    }
    if mode == "quiz" and isinstance(data.get("questions"), list):
        out["questions"] = data["questions"]
        out["markdown"] = _quiz_md(data["questions"], user_prompt)
    elif mode == "presentation" and isinstance(data.get("slides"), list):
        out["slides"] = data["slides"]
        out["markdown"] = _slides_md(data["slides"])
    elif mode == "guide" and isinstance(data.get("steps"), list):
        out["steps"] = data["steps"]
        out["markdown"] = _guide_md(data["steps"], user_prompt)
    elif mode == "study" and isinstance(data.get("concepts"), list):
        out["concepts"] = data["concepts"]
        out["markdown"] = _study_md(data, user_prompt)
    return out


def _llm_ask(document_text: str, question: str) -> dict[str, Any] | None:
    if not _HOST_SAMPLING:
        return None
    sample = _sample_document(document_text)
    prompt = f"""Answer using ONLY the document.

## Direct Answer
Clear, complete answer in your own words.

## Supporting Evidence
2-4 short bullets quoting or closely paraphrasing the source.

## Extra Clarity
Only if needed — definitions, edge cases, or common confusion.

Question: {question}

DOCUMENT:
{sample}"""
    try:
        text = _request_sampling(
            [{"role": "user", "content": {"type": "text", "text": prompt}}],
            max_tokens=1800,
        )
    except Exception:  # noqa: BLE001
        return None
    if not text:
        return None
    return {
        "mode": "ask",
        "title": "Document Answer",
        "markdown": text,
        "engine": "host-llm.sample",
    }


def _quiz_md(questions: list[dict[str, Any]], user_prompt: str = "") -> str:
    md = ["## Quiz", ""]
    if user_prompt.strip():
        md.extend([f"_Focus:_ {user_prompt.strip()}", ""])
    for i, q in enumerate(questions, 1):
        md.append(f"**Q{q.get('id', i)}. {q.get('question', '')}**")
        for idx, opt in enumerate(q.get("options") or []):
            md.append(f"- {chr(ord('A') + idx)}) {opt}")
        ans_i = int(q.get("answer_index") or 0)
        md.append(f"**Answer:** {chr(ord('A') + ans_i)}")
        if q.get("explanation"):
            md.append(f"**Why:** {q['explanation']}")
        md.append("")
    return "\n".join(md)


def _slides_md(slides: list[dict[str, Any]]) -> str:
    md = ["## Presentation outline", ""]
    for i, slide in enumerate(slides, 1):
        md.append(f"### Slide {i}: {slide.get('title', '')}")
        for b in slide.get("bullets") or []:
            if b:
                md.append(f"- {b}")
        md.append("")
    return "\n".join(md)


def _guide_md(steps: list[dict[str, Any]], user_prompt: str = "") -> str:
    md = ["## Learning Guide", ""]
    if user_prompt.strip():
        md.extend([f"**Goal:** {user_prompt.strip()}", ""])
    for s in steps:
        md.append(f"### Step {s.get('step', '')} — {s.get('title', '')}")
        md.append(str(s.get("detail") or ""))
        md.append(f"**Action:** {s.get('action', '')}")
        md.append("")
    return "\n".join(md)


def _study_md(data: dict[str, Any], user_prompt: str = "") -> str:
    md = ["## Study Pack", ""]
    if user_prompt.strip():
        md.extend([f"**Focus:** {user_prompt.strip()}", ""])
    md.append("### Must-Know Concepts")
    for c in data.get("concepts") or []:
        md.append(f"- **{c.get('term', '')}** — {c.get('note', '')}")
    if data.get("hooks"):
        md.extend(["", "### Memory Hooks"])
        for h in data["hooks"]:
            md.append(f"- {h}")
    if data.get("checklist"):
        md.extend(["", "### Revision Checklist"])
        for item in data["checklist"]:
            md.append(f"- [ ] {item}")
    if data.get("drills"):
        md.extend(["", "### Weak-Spot Drills"])
        for d in data["drills"]:
            md.append(f"- {d}")
    return "\n".join(md)


def summarize(document_text: str, user_prompt: str = "") -> dict[str, Any]:
    paras = _paragraphs(document_text)
    sents = _sentences(document_text)
    key_points = _pick_diverse(sents, 10) if sents else paras[:10]
    overview = " ".join(key_points[:2]) if key_points else "No usable text found."
    focus = user_prompt.strip() or "general understanding"
    concepts = []
    for point in key_points[:8]:
        words = re.findall(r"[A-Za-z][A-Za-z\-]{4,}", point)
        if words:
            concepts.append(f"- **{' / '.join(words[:3])}** — {point[:160]}")

    markdown = [
        "## TL;DR",
        "",
        overview,
        "",
        f"**Focus:** {focus}",
        "",
        "## Core Ideas",
    ]
    for i, point in enumerate(key_points[:10], 1):
        markdown.append(f"{i}. {point}")
    if concepts:
        markdown.extend(["", "## Key Terms", *concepts])
    if paras:
        markdown.extend(["", "## Sections Covered", ""])
        for i, p in enumerate(paras[:6], 1):
            title = (p[:80] + "…") if len(p) > 80 else p
            markdown.append(f"- Section {i}: {title}")
    markdown.extend(
        [
            "",
            "## Next Study Moves",
            "- Re-run with Anna LLM enabled for a tutor-quality rewrite",
            "- Use **Quiz** on the weakest sections above",
            "- Ask a specific “why/how” question in chat",
        ]
    )

    return {
        "mode": "summarize",
        "title": "Document Summary",
        "markdown": "\n".join(markdown),
        "key_points": key_points[:10],
        "engine": "local-extractive",
    }


def quiz(document_text: str, question_count: int = 5, user_prompt: str = "") -> dict[str, Any]:
    sents = _sentences(document_text)
    count = _clamp(int(question_count or 5), 3, 10)
    questions = []
    picks = _pick_diverse(sents, count) if sents else []
    if not picks:
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
        for i, sent in enumerate(picks, 1):
            words = [w for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", sent)]
            topic = words[0] if words else "the topic"
            questions.append(
                {
                    "id": i,
                    "question": f"Which statement best matches idea {i} from the material?",
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

    return {
        "mode": "quiz",
        "title": "Practice Quiz",
        "markdown": _quiz_md(questions, user_prompt),
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
    return {
        "mode": "presentation",
        "title": "Presentation Outline",
        "markdown": _slides_md(slides),
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
    return {
        "mode": "guide",
        "title": "Learning Guide",
        "markdown": _guide_md(steps, user_prompt),
        "steps": steps,
        "engine": "local-extractive",
    }


def study(document_text: str, user_prompt: str = "") -> dict[str, Any]:
    sents = _sentences(document_text)
    concepts = []
    for i, sent in enumerate(_pick_diverse(sents, 10) or sents[:10], 1):
        words = re.findall(r"[A-Za-z][A-Za-z\-]{4,}", sent)
        label = " / ".join(words[:3]) if words else f"Concept {i}"
        concepts.append({"term": label, "note": sent[:220]})
    data = {
        "concepts": concepts,
        "hooks": [
            "Teach each concept to an imaginary classmate",
            "Write one example that is not copied from the text",
        ],
        "checklist": [
            "Recite each concept without looking",
            "Mark weak points",
            "Run Quiz mode on those weak points",
        ],
        "drills": ["What would break if the main claim were false?"],
    }
    return {
        "mode": "study",
        "title": "Study Pack",
        "markdown": _study_md(data, user_prompt),
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
        "## Direct Answer",
        "",
        f"**Question:** {q or 'N/A'}",
        "",
        "### Supporting Evidence",
    ]
    for i, ev in enumerate(evidence, 1):
        md.append(f"{i}. {ev}")
    md.extend(
        [
            "",
            "### Short synthesis",
            " ".join(evidence[:2]) if evidence else "No matching passages found.",
            "",
            "_Tip:_ Restart with Anna LLM enabled (`npx anna-app login` then `npx anna-app dev`) for tutor-quality answers._",
        ]
    )
    return {
        "mode": "ask",
        "title": "Document Answer",
        "markdown": "\n".join(md),
        "evidence": evidence,
        "engine": "local-retrieval",
    }


LOCAL_HANDLERS = {
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
        return {
            "success": True,
            "data": {
                "pong": True,
                "app": "mindsparkle",
                "version": MANIFEST["version"],
                "host_sampling": _HOST_SAMPLING,
            },
        }

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
        llm = _llm_ask(text, question)
        return {"success": True, "data": llm or ask_document(text, question)}

    if method == "run_mode":
        mode = (args or {}).get("mode")
        text = (args or {}).get("document_text") or ""
        if mode not in LOCAL_HANDLERS:
            return {"success": False, "error": f"unknown mode: {mode}"}
        if not str(text).strip():
            return {"success": False, "error": "document_text is required"}
        llm = _llm_mode(mode, text, (args or {}).get("user_prompt", "") or "")
        return {"success": True, "data": llm or LOCAL_HANDLERS[mode](args or {})}

    return {"success": False, "error": f"unknown method: {method}"}


def _dispatch(env: dict[str, Any]) -> None:
    global _HOST_SAMPLING
    method = env.get("method")
    rid = env.get("id")
    try:
        if method == "initialize":
            # Only hosts that speak the v2 handshake call initialize.
            # Smoke tests skip this, so local fallbacks never hang on sampling.
            _HOST_SAMPLING = True
            result = {
                "protocolVersion": "2.0",
                "server_info": {"name": MANIFEST["display_name"], "version": MANIFEST["version"]},
                "capabilities": {"sampling": {}},
            }
        elif method == "describe":
            result = MANIFEST
        elif method == "health":
            result = {"status": "ready", "host_sampling": _HOST_SAMPLING}
        elif method == "invoke":
            params = env.get("params") or {}
            result = invoke(params.get("tool", ""), params.get("arguments") or {})
        else:
            raise ValueError(f"unknown rpc: {method}")
        _write({"jsonrpc": "2.0", "id": rid, "result": result})
    except Exception as e:  # noqa: BLE001
        _write(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": str(e)},
            }
        )


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        _dispatch(json.loads(line))


if __name__ == "__main__":
    main()
