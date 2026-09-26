/**
 * MindSparkle — Anna App UI (Phase 1+)
 * Welcome entrance · multi-format docs · chat-first learning modes
 */
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const DEV_FALLBACK_TOOL_ID = "tool-dev-mindsparkle";
const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__.mindsparkle) ||
  DEV_FALLBACK_TOOL_ID;

const STORAGE_DOC_KEY = "mindsparkle:document";
const STORAGE_DOC_META_KEY = "mindsparkle:document_meta";
const STORAGE_MODE_KEY = "mindsparkle:mode";
const STORAGE_ENTERED_KEY = "mindsparkle:entered";

const MODES = [
  { id: "summarize", short: "SU", title: "Summarize", blurb: "Executive overview + key points." },
  { id: "quiz", short: "QZ", title: "Quiz", blurb: "Practice questions with answer keys." },
  { id: "presentation", short: "PR", title: "Presentation", blurb: "Slide-ready outline from the source." },
  { id: "guide", short: "GD", title: "Guide", blurb: "Step-by-step learning path." },
  { id: "study", short: "ST", title: "Study", blurb: "Concept notes + revision checklist." },
];

const MODE_PROMPTS = {
  summarize:
    "Create a professional study summary with: overview, 5-8 key points, and section coverage. Markdown only.",
  quiz:
    "Create 5 multiple-choice questions from the document. Options A-D, then show Answer + short explanation for each. Markdown.",
  presentation:
    "Create a presentation outline with 6 slides. Each slide: title + 2-4 bullets. Markdown.",
  guide:
    "Create a step-by-step learning guide. Each step: title, explanation, and a concrete action. Markdown.",
  study:
    "Create a study pack: key concepts (term — note), memory tips, and a revision checklist. Markdown.",
};

const TEXT_EXTS = new Set(["txt", "md", "markdown", "csv", "json", "log", "html", "htm"]);
const BINARY_EXTS = new Set(["pdf", "docx"]);

const $ = (sel) => document.querySelector(sel);

const els = {
  entrance: $("#entrance"),
  enterBtn: $("#enter-btn"),
  workspace: $("#workspace"),
  showEntrance: $("#show-entrance"),
  app: $("#workspace"),
  railToggle: $("#rail-toggle"),
  railIcons: $("#rail-icons"),
  sidebar: $("#sidebar"),
  sidebarClose: $("#sidebar-close"),
  modeList: $("#mode-list"),
  modeTitle: $("#mode-title"),
  modePill: $("#mode-pill"),
  connPill: $("#conn-pill"),
  chat: $("#chat"),
  docInput: $("#doc-input"),
  docMeta: $("#doc-meta"),
  dropzone: $("#dropzone"),
  fileInput: $("#file-input"),
  clearDoc: $("#clear-doc"),
  exportBtn: $("#export-btn"),
  promptInput: $("#prompt-input"),
  sendBtn: $("#send-btn"),
  runMode: $("#run-mode"),
  hint: $("#hint"),
};

let anna = null;
let busy = false;
let activeMode = "summarize";
let lastMarkdown = "";
let docMeta = { name: "", type: "", chars: 0 };

function setConn(online, label) {
  els.connPill.textContent = label || (online ? "Anna connected" : "Standalone preview");
  els.connPill.classList.toggle("online", online);
  els.connPill.classList.toggle("offline", !online);
}

function setBusy(on) {
  busy = on;
  els.sendBtn.disabled = on;
  els.runMode.disabled = on;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function renderMarkdownLite(md) {
  const lines = String(md || "").split("\n");
  const html = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${formatInline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${formatInline(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function addMessage(role, content, { markdown = false, engine = "" } = {}) {
  const node = document.createElement("article");
  node.className = `msg ${role}${markdown ? " markdown" : ""}`;
  if (role !== "system") {
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = role === "user" ? "You" : "MindSparkle";
    node.appendChild(lab);
  }
  const body = document.createElement("div");
  if (markdown) body.innerHTML = renderMarkdownLite(content);
  else body.textContent = content;
  node.appendChild(body);
  if (engine) {
    const tag = document.createElement("span");
    tag.className = "engine-tag";
    tag.textContent = engine;
    node.appendChild(tag);
  }
  els.chat.appendChild(node);
  els.chat.scrollTop = els.chat.scrollHeight;
}

function currentMode() {
  return MODES.find((m) => m.id === activeMode) || MODES[0];
}

function setMode(modeId, { persist = true } = {}) {
  activeMode = modeId;
  const mode = currentMode();
  els.modeTitle.textContent = mode.title;
  els.modePill.textContent = mode.title;
  els.hint.textContent = `${mode.title}: ${mode.blurb} Upload any document, then Run mode — or ask in chat.`;
  els.modeList.querySelectorAll(".mode-card").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === modeId);
  });
  els.railIcons.querySelectorAll(".rail-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === modeId);
  });
  if (persist && anna) {
    anna.storage.set({ key: STORAGE_MODE_KEY, value: modeId }).catch(() => {});
  }
}

function setSidebarOpen(open) {
  els.app.classList.toggle("sidebar-open", open);
  els.sidebar.hidden = !open;
  els.railToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function showEntrance() {
  els.entrance.hidden = false;
  els.workspace.hidden = true;
}

function enterWorkspace({ persist = true } = {}) {
  els.entrance.hidden = true;
  els.workspace.hidden = false;
  setSidebarOpen(true);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_ENTERED_KEY, "1");
    } catch {
      /* ignore */
    }
    if (anna?.storage?.set) {
      anna.storage.set({ key: STORAGE_ENTERED_KEY, value: true }).catch(() => {});
    }
  }
}

function updateDocMeta(meta) {
  docMeta = { ...docMeta, ...meta };
  const name = docMeta.name || "Pasted text";
  const chars = docMeta.chars || (els.docInput.value || "").length;
  const type = docMeta.type ? ` · ${docMeta.type.toUpperCase()}` : "";
  els.docMeta.textContent = chars ? `${name}${type} · ${chars.toLocaleString()} chars` : "No file yet";
}

function buildModeUi() {
  els.railIcons.innerHTML = "";
  els.modeList.innerHTML = "";
  for (const mode of MODES) {
    const railBtn = document.createElement("button");
    railBtn.type = "button";
    railBtn.className = "rail-btn";
    railBtn.dataset.mode = mode.id;
    railBtn.title = mode.title;
    railBtn.textContent = mode.short;
    railBtn.addEventListener("click", () => {
      setMode(mode.id);
      setSidebarOpen(true);
    });
    els.railIcons.appendChild(railBtn);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "mode-card";
    card.dataset.mode = mode.id;
    card.innerHTML = `<strong>${mode.title}</strong><span>${mode.blurb}</span>`;
    card.addEventListener("click", () => setMode(mode.id));
    els.modeList.appendChild(card);
  }
}

function getDocumentText() {
  return (els.docInput.value || "").trim();
}

function extOf(name = "") {
  const parts = String(name).toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function callTool(method, args) {
  if (!anna?.tools?.invoke) throw new Error("Tools unavailable");
  const result = await anna.tools.invoke({
    tool_id: TOOL_ID,
    method,
    args,
  });
  const data =
    result?.data?.data ||
    result?.data ||
    result?.result?.data ||
    result?.result ||
    result;
  if (data?.success === false) throw new Error(data.error || "Tool failed");
  return data?.data || data;
}

async function extractWithTool(file) {
  const base64 = await fileToBase64(file);
  const data = await callTool("extract_document", {
    filename: file.name,
    content_base64: base64,
    mime_type: file.type || "",
  });
  return {
    text: data.text || data.document_text || "",
    engine: data.engine || "executa-extract",
  };
}

async function loadFile(file) {
  if (!file) return;
  const ext = extOf(file.name);
  setBusy(true);
  addMessage("system", `Reading “${file.name}”…`);
  try {
    let text = "";
    let engine = "browser-text";
    if (TEXT_EXTS.has(ext) || (file.type || "").startsWith("text/")) {
      text = await file.text();
    } else if (BINARY_EXTS.has(ext) || file.type === "application/pdf") {
      if (anna?.tools?.invoke) {
        const extracted = await extractWithTool(file);
        text = extracted.text;
        engine = extracted.engine;
      } else {
        throw new Error("PDF/DOCX extraction needs Anna connection. Paste text or reconnect.");
      }
    } else if (anna?.tools?.invoke) {
      const extracted = await extractWithTool(file);
      text = extracted.text;
      engine = extracted.engine;
    } else {
      text = await file.text();
    }

    if (!String(text).trim()) throw new Error("No extractable text found in this file.");
    els.docInput.value = text;
    updateDocMeta({ name: file.name, type: ext || "file", chars: text.length });
    if (anna?.storage?.set) {
      await anna.storage.set({ key: STORAGE_DOC_KEY, value: text.slice(0, 200000) });
      await anna.storage.set({
        key: STORAGE_DOC_META_KEY,
        value: { name: file.name, type: ext, chars: text.length },
      });
    }
    const last = els.chat.querySelector(".msg.system:last-of-type");
    if (last && /Reading/.test(last.textContent || "")) last.remove();
    addMessage(
      "system",
      `Loaded “${file.name}” (${text.length.toLocaleString()} chars) via ${engine}.`,
    );
  } catch (e) {
    const last = els.chat.querySelector(".msg.system:last-of-type");
    if (last && /Reading/.test(last.textContent || "")) last.remove();
    addMessage("assistant", `Could not read file: ${e?.message || e}`);
  } finally {
    setBusy(false);
    els.fileInput.value = "";
  }
}

async function invokeToolMode(mode, documentText, userPrompt) {
  const data = await callTool("run_mode", {
    mode,
    document_text: documentText,
    user_prompt: userPrompt || "",
    question_count: 5,
    slide_count: 6,
  });
  if (!data?.markdown) throw new Error("Unexpected tool response");
  return data;
}

async function invokeLlm(modeOrAsk, documentText, userPrompt, { ask = false } = {}) {
  const instruction = ask
    ? `Answer the user's question using only the document. Be precise and cite ideas from the text. Markdown.`
    : MODE_PROMPTS[modeOrAsk] || MODE_PROMPTS.summarize;
  const clipped = documentText.slice(0, 28000);
  const userBit = ask
    ? `Question: ${userPrompt}\n\nDOCUMENT:\n${clipped}`
    : `${instruction}${userPrompt ? `\n\nUser request: ${userPrompt}` : ""}\n\nDOCUMENT:\n${clipped}`;

  const reply = await anna.llm.complete({
    messages: [
      {
        role: "system",
        content: {
          type: "text",
          text: "You are MindSparkle, an elite study coach. Be clear, structured, and practical.",
        },
      },
      { role: "user", content: { type: "text", text: userBit } },
    ],
    maxTokens: 2000,
  });
  const text =
    reply?.content?.text ||
    reply?.message?.content?.text ||
    reply?.text ||
    "";
  if (!text) throw new Error("Empty LLM response");
  return {
    mode: ask ? "ask" : modeOrAsk,
    title: ask ? "Answer" : currentMode().title,
    markdown: text,
    engine: "anna.llm.complete",
  };
}

async function invokeAskTool(documentText, question) {
  const data = await callTool("ask_document", {
    document_text: documentText,
    question,
  });
  if (!data?.markdown) throw new Error("Unexpected ask response");
  return data;
}

function localFallback(mode, documentText, userPrompt) {
  const sentences = documentText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  if (mode === "summarize") {
    const points = sentences.slice(0, 6);
    return {
      markdown: [
        "## Summary",
        "",
        points.slice(0, 2).join(" ") || documentText.slice(0, 280),
        "",
        "### Key points",
        ...points.map((p, i) => `${i + 1}. ${p}`),
      ].join("\n"),
      engine: "standalone-local",
    };
  }
  if (mode === "quiz") {
    const md = ["## Quiz", ""];
    (sentences.length ? sentences : [documentText]).slice(0, 5).forEach((s, i) => {
      md.push(`**Q${i + 1}. What best matches this idea?**`);
      md.push(`- A) ${s.slice(0, 120)}`);
      md.push("- B) Unrelated claim");
      md.push("- C) Opposite claim");
      md.push("- D) Not in the document");
      md.push(`Answer: A`);
      md.push("");
    });
    return { markdown: md.join("\n"), engine: "standalone-local" };
  }
  if (mode === "presentation") {
    const md = ["## Presentation outline", "", "### Slide 1: Overview", `- ${userPrompt || "Document walkthrough"}`];
    sentences.slice(0, 4).forEach((s, i) => {
      md.push(`### Slide ${i + 2}: Section ${i + 1}`);
      md.push(`- ${s.slice(0, 120)}`);
    });
    return { markdown: md.join("\n"), engine: "standalone-local" };
  }
  if (mode === "guide") {
    const md = ["## Learning Guide", ""];
    sentences.slice(0, 5).forEach((s, i) => {
      md.push(`### Step ${i + 1}`);
      md.push(s.slice(0, 220));
      md.push("_Action:_ Explain this in your own words.");
      md.push("");
    });
    return { markdown: md.join("\n"), engine: "standalone-local" };
  }
  const md = ["## Study Pack", "", "### Key concepts"];
  sentences.slice(0, 6).forEach((s) => md.push(`- ${s.slice(0, 160)}`));
  md.push("", "### Revision checklist", "- Recite each concept", "- Run Quiz mode next");
  return { markdown: md.join("\n"), engine: "standalone-local" };
}

async function runLearning({ userPrompt = "", fromChat = false } = {}) {
  const doc = getDocumentText();
  if (!doc) {
    setSidebarOpen(true);
    addMessage("system", "Upload or paste a document first.");
    return;
  }

  const mode = currentMode();
  const asking = fromChat && Boolean(userPrompt.trim());
  if (asking) addMessage("user", userPrompt);
  else addMessage("user", `Run ${mode.title}${userPrompt ? `: ${userPrompt}` : ""}`);

  setBusy(true);
  addMessage("system", asking ? "Thinking…" : `Working on ${mode.title}…`);
  try {
    let result = null;
    if (anna?.llm?.complete) {
      try {
        result = await invokeLlm(mode.id, doc, userPrompt, { ask: asking });
      } catch (e) {
        console.warn("[mindsparkle] llm failed", e);
      }
    }
    if (!result && anna?.tools?.invoke) {
      result = asking
        ? await invokeAskTool(doc, userPrompt)
        : await invokeToolMode(mode.id, doc, userPrompt);
    }
    if (!result) {
      if (asking) {
        result = {
          markdown: `Based on the document, focus on: ${doc.slice(0, 400)}…\n\n(Connect Anna LLM for fuller answers.)`,
          engine: "standalone-local",
        };
      } else {
        result = localFallback(mode.id, doc, userPrompt);
      }
    }

    const last = els.chat.querySelector(".msg.system:last-of-type");
    if (last && /(Working on|Thinking)/.test(last.textContent || "")) last.remove();
    lastMarkdown = result.markdown || "";
    addMessage("assistant", lastMarkdown || "No output.", {
      markdown: true,
      engine: result.engine || "",
    });
    if (anna?.storage?.set) {
      await anna.storage.set({
        key: `mindsparkle:last:${asking ? "ask" : mode.id}`,
        value: { at: Date.now(), engine: result.engine || "unknown" },
      });
    }
  } catch (e) {
    const last = els.chat.querySelector(".msg.system:last-of-type");
    if (last && /(Working on|Thinking)/.test(last.textContent || "")) last.remove();
    addMessage("assistant", `Error: ${e?.message || e}`);
  } finally {
    setBusy(false);
  }
}

function exportLast() {
  if (!lastMarkdown.trim()) {
    addMessage("system", "Nothing to export yet — run a mode first.");
    return;
  }
  const blob = new Blob([lastMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mindsparkle-${activeMode}-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function bindUi() {
  els.enterBtn.addEventListener("click", () => {
    enterWorkspace();
    if (!els.chat.childElementCount) {
      addMessage(
        "assistant",
        "Welcome in. Upload PDF, DOCX, TXT, MD, or CSV from the side panel — then run a mode or ask me anything about the document.",
      );
    }
  });
  els.showEntrance.addEventListener("click", () => showEntrance());

  els.railToggle.addEventListener("click", () => setSidebarOpen(els.sidebar.hidden));
  els.sidebarClose.addEventListener("click", () => setSidebarOpen(false));

  els.clearDoc.addEventListener("click", () => {
    els.docInput.value = "";
    updateDocMeta({ name: "", type: "", chars: 0 });
    if (anna?.storage?.set) {
      anna.storage.set({ key: STORAGE_DOC_KEY, value: "" }).catch(() => {});
      anna.storage.set({ key: STORAGE_DOC_META_KEY, value: null }).catch(() => {});
    }
  });
  els.exportBtn.addEventListener("click", exportLast);

  els.fileInput.addEventListener("change", () => loadFile(els.fileInput.files?.[0]));
  ["dragenter", "dragover"].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  });
  els.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  els.docInput.addEventListener("input", () => {
    updateDocMeta({
      name: docMeta.name || "Pasted text",
      type: docMeta.type || "text",
      chars: els.docInput.value.length,
    });
  });
  els.docInput.addEventListener("change", () => {
    if (anna?.storage?.set) {
      anna.storage.set({ key: STORAGE_DOC_KEY, value: els.docInput.value.slice(0, 200000) }).catch(() => {});
    }
  });

  els.runMode.addEventListener("click", () => runLearning());
  els.sendBtn.addEventListener("click", () => {
    const prompt = els.promptInput.value.trim();
    els.promptInput.value = "";
    runLearning({ userPrompt: prompt, fromChat: true });
  });
  els.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.sendBtn.click();
    }
  });
}

async function init() {
  buildModeUi();
  bindUi();
  setMode("summarize", { persist: false });
  updateDocMeta({ name: "", type: "", chars: 0 });

  let entered = false;
  try {
    entered = localStorage.getItem(STORAGE_ENTERED_KEY) === "1";
  } catch {
    entered = false;
  }

  try {
    anna = await AnnaAppRuntime.connect();
    setConn(true);
    await anna.window.set_title({ title: "MindSparkle" });
    try {
      const savedEntered = await anna.storage.get({ key: STORAGE_ENTERED_KEY });
      if (savedEntered?.value) entered = true;
      const savedDoc = await anna.storage.get({ key: STORAGE_DOC_KEY });
      if (typeof savedDoc?.value === "string" && savedDoc.value) {
        els.docInput.value = savedDoc.value;
        updateDocMeta({ name: "Saved document", type: "text", chars: savedDoc.value.length });
      }
      const savedMeta = await anna.storage.get({ key: STORAGE_DOC_META_KEY });
      if (savedMeta?.value && typeof savedMeta.value === "object") updateDocMeta(savedMeta.value);
      const savedMode = await anna.storage.get({ key: STORAGE_MODE_KEY });
      if (typeof savedMode?.value === "string" && MODES.some((m) => m.id === savedMode.value)) {
        setMode(savedMode.value, { persist: false });
      }
    } catch {
      /* ignore */
    }
  } catch (e) {
    setConn(false);
    console.warn("[mindsparkle] standalone preview:", e?.message || e);
  }

  if (entered) {
    enterWorkspace({ persist: false });
    addMessage(
      "assistant",
      "Welcome back. Upload any document type, pick a mode, or ask a question in chat.",
    );
  } else {
    showEntrance();
  }
}

init();
