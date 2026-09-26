/**
 * MindSparkle Anna UI — upgrades 1–7
 * 1 hub · 2 cockpit · 3 rich outputs · 4 motion · 5 command bar · 6 theme · 7 history
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
const STORAGE_THEME_KEY = "mindsparkle:theme";
const STORAGE_HISTORY_KEY = "mindsparkle:history";

const MODES = [
  { id: "summarize", short: "SU", title: "Summarize", blurb: "Executive overview + key points." },
  { id: "quiz", short: "QZ", title: "Quiz", blurb: "Interactive practice questions." },
  { id: "presentation", short: "PR", title: "Presentation", blurb: "Slide deck outline." },
  { id: "guide", short: "GD", title: "Guide", blurb: "Step-by-step learning path." },
  { id: "study", short: "ST", title: "Study", blurb: "Flashcards + revision pack." },
];

const MODE_PROMPTS = {
  summarize:
    "Create a professional study summary with overview, 5-8 key points, and section coverage. Markdown.",
  quiz:
    "Create 5 multiple-choice questions. Options A-D, then Answer + short explanation. Markdown.",
  presentation:
    "Create a presentation outline with 6 slides. Each slide: title + 2-4 bullets. Markdown.",
  guide:
    "Create a step-by-step learning guide. Each step: title, explanation, action. Markdown.",
  study:
    "Create a study pack: key concepts (term — note), memory tips, revision checklist. Markdown.",
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
  hub: $("#hub"),
  hubGrid: $("#hub-grid"),
  hubUpload: $("#hub-upload"),
  docInput: $("#doc-input"),
  dropzone: $("#dropzone"),
  fileInput: $("#file-input"),
  clearDoc: $("#clear-doc"),
  rerunBtn: $("#rerun-btn"),
  cockpitTitle: $("#cockpit-title"),
  cockpitType: $("#cockpit-type"),
  cockpitChars: $("#cockpit-chars"),
  cockpitWords: $("#cockpit-words"),
  cockpitMode: $("#cockpit-mode"),
  historyList: $("#history-list"),
  clearHistory: $("#clear-history"),
  promptInput: $("#prompt-input"),
  sendBtn: $("#send-btn"),
  runMode: $("#run-mode"),
  hint: $("#hint"),
  cmdUpload: $("#cmd-upload"),
  cmdMode: $("#cmd-mode"),
  cmdExport: $("#cmd-export"),
  cmdNew: $("#cmd-new"),
  themeToggle: $("#theme-toggle"),
};

let anna = null;
let busy = false;
let activeMode = "summarize";
let lastMarkdown = "";
let lastResult = null;
let docMeta = { name: "", type: "", chars: 0 };
let history = [];
let hubVisible = true;
let quizState = { correct: 0, answered: 0 };

function setConn(online, label) {
  els.connPill.textContent = label || (online ? "Anna connected" : "Standalone");
  els.connPill.classList.toggle("online", online);
  els.connPill.classList.toggle("offline", !online);
}

function setBusy(on) {
  busy = on;
  els.sendBtn.disabled = on;
  els.runMode.disabled = on;
  els.rerunBtn.disabled = on;
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

function hideHub() {
  hubVisible = false;
  if (els.hub) els.hub.hidden = true;
}

function showHub() {
  hubVisible = true;
  if (els.hub) {
    els.hub.hidden = false;
    els.chat.appendChild(els.hub);
  }
}

function addMessage(role, content, { markdown = false, engine = "", node = null } = {}) {
  hideHub();
  const article = document.createElement("article");
  article.className = `msg ${role}${markdown ? " markdown" : ""}`;
  if (role !== "system") {
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = role === "user" ? "You" : "MindSparkle";
    article.appendChild(lab);
  }
  if (node) article.appendChild(node);
  else {
    const body = document.createElement("div");
    if (markdown) body.innerHTML = renderMarkdownLite(content);
    else body.textContent = content;
    article.appendChild(body);
  }
  if (engine) {
    const tag = document.createElement("span");
    tag.className = "engine-tag";
    tag.textContent = engine;
    article.appendChild(tag);
  }
  els.chat.appendChild(article);
  els.chat.scrollTop = els.chat.scrollHeight;
  return article;
}

function addSkeleton() {
  hideHub();
  const sk = document.createElement("div");
  sk.className = "skeleton";
  sk.innerHTML = "<i></i><i></i><i></i><i></i>";
  els.chat.appendChild(sk);
  els.chat.scrollTop = els.chat.scrollHeight;
  return sk;
}

function currentMode() {
  return MODES.find((m) => m.id === activeMode) || MODES[0];
}

function setMode(modeId, { persist = true } = {}) {
  activeMode = modeId;
  const mode = currentMode();
  els.modeTitle.textContent = mode.title;
  els.modePill.textContent = mode.title;
  els.cockpitMode.textContent = mode.short;
  els.hint.textContent = `${mode.title}: ${mode.blurb} · Shortcuts: 1–5 modes · U upload · ⌘/Ctrl+Enter send`;
  els.modeList.querySelectorAll(".mode-card").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === modeId);
  });
  els.railIcons.querySelectorAll(".rail-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === modeId);
  });
  if (persist && anna) anna.storage.set({ key: STORAGE_MODE_KEY, value: modeId }).catch(() => {});
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
    if (anna?.storage?.set) anna.storage.set({ key: STORAGE_ENTERED_KEY, value: true }).catch(() => {});
  }
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  els.themeToggle.textContent = next === "dark" ? "Light" : "Dark";
  try {
    localStorage.setItem(STORAGE_THEME_KEY, next);
  } catch {
    /* ignore */
  }
  if (anna?.storage?.set) anna.storage.set({ key: STORAGE_THEME_KEY, value: next }).catch(() => {});
}

function updateCockpit() {
  const chars = docMeta.chars || (els.docInput.value || "").length;
  const words = (els.docInput.value || "").trim() ? (els.docInput.value.trim().match(/\S+/g) || []).length : 0;
  els.cockpitTitle.textContent = docMeta.name || (chars ? "Pasted text" : "No document");
  els.cockpitType.textContent = (docMeta.type || (chars ? "text" : "—")).toUpperCase();
  els.cockpitChars.textContent = chars.toLocaleString();
  els.cockpitWords.textContent = words.toLocaleString();
  els.cockpitMode.textContent = currentMode().short;
}

function updateDocMeta(meta) {
  docMeta = { ...docMeta, ...meta };
  updateCockpit();
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!history.length) {
    els.historyList.innerHTML = `<p class="history-empty">No outputs yet</p>`;
    return;
  }
  history
    .slice()
    .reverse()
    .forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-item";
      btn.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.mode)} · ${new Date(item.at).toLocaleTimeString()}</span>`;
      btn.addEventListener("click", () => {
        const real = history[history.length - 1 - idx];
        lastMarkdown = real.markdown || "";
        lastResult = real.result || null;
        if (real.result) addRichResult(real.result, { fromHistory: true });
        else addMessage("assistant", real.markdown || "", { markdown: true, engine: "history" });
      });
      els.historyList.appendChild(btn);
    });
}

function pushHistory(entry) {
  history.push(entry);
  history = history.slice(-12);
  renderHistory();
  try {
    localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* ignore */
  }
  if (anna?.storage?.set) anna.storage.set({ key: STORAGE_HISTORY_KEY, value: history }).catch(() => {});
}

function buildModeUi() {
  els.railIcons.innerHTML = "";
  els.modeList.innerHTML = "";
  els.hubGrid.innerHTML = "";
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

    const hubCard = document.createElement("button");
    hubCard.type = "button";
    hubCard.className = "hub-card";
    hubCard.innerHTML = `<strong>${mode.title}</strong><span>${mode.blurb}</span>`;
    hubCard.addEventListener("click", () => {
      setMode(mode.id);
      if (!getDocumentText()) {
        setSidebarOpen(true);
        addMessage("system", `Mode set to ${mode.title}. Upload a document to run it.`);
      } else {
        runLearning();
      }
    });
    els.hubGrid.appendChild(hubCard);
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
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function callTool(method, args) {
  if (!anna?.tools?.invoke) throw new Error("Tools unavailable");
  const result = await anna.tools.invoke({ tool_id: TOOL_ID, method, args });
  const data =
    result?.data?.data || result?.data || result?.result?.data || result?.result || result;
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
  return { text: data.text || "", engine: data.engine || "executa-extract" };
}

async function loadFile(file) {
  if (!file) return;
  const ext = extOf(file.name);
  setBusy(true);
  const sk = addSkeleton();
  try {
    let text = "";
    let engine = "browser-text";
    if (TEXT_EXTS.has(ext) || (file.type || "").startsWith("text/")) {
      text = await file.text();
    } else if (BINARY_EXTS.has(ext) || file.type === "application/pdf") {
      if (!anna?.tools?.invoke) throw new Error("PDF/DOCX needs Anna connection.");
      const extracted = await extractWithTool(file);
      text = extracted.text;
      engine = extracted.engine;
    } else if (anna?.tools?.invoke) {
      const extracted = await extractWithTool(file);
      text = extracted.text;
      engine = extracted.engine;
    } else text = await file.text();

    if (!String(text).trim()) throw new Error("No extractable text found.");
    els.docInput.value = text;
    updateDocMeta({ name: file.name, type: ext || "file", chars: text.length });
    if (anna?.storage?.set) {
      await anna.storage.set({ key: STORAGE_DOC_KEY, value: text.slice(0, 200000) });
      await anna.storage.set({
        key: STORAGE_DOC_META_KEY,
        value: { name: file.name, type: ext, chars: text.length },
      });
    }
    sk.remove();
    addMessage("system", `Loaded “${file.name}” (${text.length.toLocaleString()} chars) · ${engine}`);
  } catch (e) {
    sk.remove();
    addMessage("assistant", `Could not read file: ${e?.message || e}`);
  } finally {
    setBusy(false);
    els.fileInput.value = "";
  }
}

function buildQuizNode(questions = []) {
  quizState = { correct: 0, answered: 0 };
  const wrap = document.createElement("div");
  wrap.className = "rich";
  wrap.innerHTML = `<h3 class="rich-title">Interactive Quiz</h3>`;
  const score = document.createElement("div");
  score.className = "quiz-score";
  score.textContent = "Answer to score yourself";
  wrap.appendChild(score);

  questions.forEach((q, qi) => {
    const box = document.createElement("div");
    box.className = "quiz-q";
    box.innerHTML = `<p>Q${q.id || qi + 1}. ${escapeHtml(q.question || "")}</p>`;
    const opts = document.createElement("div");
    opts.className = "quiz-opts";
    (q.options || []).forEach((opt, oi) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.textContent = `${String.fromCharCode(65 + oi)}) ${opt}`;
      btn.addEventListener("click", () => {
        if (box.dataset.done) return;
        box.dataset.done = "1";
        quizState.answered += 1;
        const ok = oi === Number(q.answer_index || 0);
        if (ok) quizState.correct += 1;
        btn.classList.add(ok ? "correct" : "wrong");
        [...opts.children].forEach((child, idx) => {
          if (idx === Number(q.answer_index || 0)) child.classList.add("correct");
          child.disabled = true;
        });
        score.textContent = `Score: ${quizState.correct}/${quizState.answered}`;
      });
      opts.appendChild(btn);
    });
    box.appendChild(opts);
    wrap.appendChild(box);
  });
  return wrap;
}

function buildSlidesNode(slides = []) {
  let i = 0;
  const wrap = document.createElement("div");
  wrap.className = "rich slides";
  const title = document.createElement("h3");
  title.className = "rich-title";
  title.textContent = "Presentation";
  const nav = document.createElement("div");
  nav.className = "slide-nav";
  const prev = document.createElement("button");
  prev.className = "ghost compact";
  prev.type = "button";
  prev.textContent = "← Prev";
  const meta = document.createElement("span");
  meta.className = "pill soft";
  const next = document.createElement("button");
  next.className = "ghost compact";
  next.type = "button";
  next.textContent = "Next →";
  nav.append(prev, meta, next);
  const card = document.createElement("div");
  card.className = "slide-card";

  const paint = () => {
    const s = slides[i] || { title: "Empty", bullets: [] };
    meta.textContent = `${i + 1} / ${slides.length || 1}`;
    card.innerHTML = `<h4>${escapeHtml(s.title || `Slide ${i + 1}`)}</h4><ul>${(s.bullets || [])
      .map((b) => `<li>${escapeHtml(b)}</li>`)
      .join("")}</ul>`;
  };
  prev.onclick = () => {
    i = (i - 1 + slides.length) % Math.max(slides.length, 1);
    paint();
  };
  next.onclick = () => {
    i = (i + 1) % Math.max(slides.length, 1);
    paint();
  };
  paint();
  wrap.append(title, nav, card);
  return wrap;
}

function buildGuideNode(steps = []) {
  const wrap = document.createElement("div");
  wrap.className = "rich timeline";
  wrap.innerHTML = `<h3 class="rich-title">Learning Guide</h3>`;
  steps.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "timeline-step";
    row.innerHTML = `
      <div class="step-num">${s.step || idx + 1}</div>
      <div>
        <h4>${escapeHtml(s.title || `Step ${idx + 1}`)}</h4>
        <p>${escapeHtml(s.detail || "")}</p>
        <div class="action">${escapeHtml(s.action || "")}</div>
      </div>`;
    wrap.appendChild(row);
  });
  return wrap;
}

function buildStudyNode(concepts = []) {
  const wrap = document.createElement("div");
  wrap.className = "rich";
  wrap.innerHTML = `<h3 class="rich-title">Study Flashcards</h3><p class="hint">Click a card to flip</p>`;
  const grid = document.createElement("div");
  grid.className = "flash-grid";
  concepts.forEach((c) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "flash";
    card.innerHTML = `<div class="term">${escapeHtml(c.term || "Concept")}</div>
      <div class="note">${escapeHtml(c.note || "")}</div>
      <div class="hint-flip">Tap to reveal</div>`;
    card.addEventListener("click", () => card.classList.toggle("open"));
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
  return wrap;
}

function addRichResult(result, { fromHistory = false } = {}) {
  const mode = result.mode || activeMode;
  let node = null;
  if (mode === "quiz" && Array.isArray(result.questions) && result.questions.length) {
    node = buildQuizNode(result.questions);
  } else if (mode === "presentation" && Array.isArray(result.slides) && result.slides.length) {
    node = buildSlidesNode(result.slides);
  } else if (mode === "guide" && Array.isArray(result.steps) && result.steps.length) {
    node = buildGuideNode(result.steps);
  } else if (mode === "study" && Array.isArray(result.concepts) && result.concepts.length) {
    node = buildStudyNode(result.concepts);
  }

  if (node) {
    addMessage("assistant", "", { node, engine: result.engine || "" });
    // also keep markdown exportable
    if (!fromHistory && result.markdown) {
      /* markdown already stored in lastMarkdown by caller */
    }
  } else {
    addMessage("assistant", result.markdown || "No output.", {
      markdown: true,
      engine: result.engine || "",
    });
  }
}

async function invokeToolMode(mode, documentText, userPrompt) {
  return callTool("run_mode", {
    mode,
    document_text: documentText,
    user_prompt: userPrompt || "",
    question_count: 5,
    slide_count: 6,
  });
}

async function invokeAskTool(documentText, question) {
  return callTool("ask_document", { document_text: documentText, question });
}

async function invokeLlm(modeOrAsk, documentText, userPrompt, { ask = false } = {}) {
  const instruction = ask
    ? "Answer using only the document. Be precise. Markdown."
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
          text: "You are MindSparkle, an elite study coach. Clear, structured, practical.",
        },
      },
      { role: "user", content: { type: "text", text: userBit } },
    ],
    maxTokens: 2000,
  });
  const text = reply?.content?.text || reply?.message?.content?.text || reply?.text || "";
  if (!text) throw new Error("Empty LLM response");
  return {
    mode: ask ? "ask" : modeOrAsk,
    title: ask ? "Answer" : currentMode().title,
    markdown: text,
    engine: "anna.llm.complete",
  };
}

function localFallback(mode, documentText, userPrompt) {
  // Use tool logic offline by mimicking structured shapes for rich UI
  const sentences = documentText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  if (mode === "quiz") {
    const questions = (sentences.length ? sentences : [documentText]).slice(0, 5).map((s, i) => ({
      id: i + 1,
      question: `Which statement best matches idea ${i + 1}?`,
      options: [s.slice(0, 120), "Unrelated claim", "Opposite claim", "Not in the document"],
      answer_index: 0,
      explanation: s.slice(0, 180),
    }));
    return {
      mode,
      questions,
      markdown: questions.map((q) => `Q${q.id}. ${q.question}`).join("\n"),
      engine: "standalone-local",
    };
  }
  if (mode === "presentation") {
    const slides = [
      { title: "Overview", bullets: [userPrompt || "Document walkthrough", "Key themes", "Outcomes"] },
      ...sentences.slice(0, 4).map((s, i) => ({ title: `Section ${i + 1}`, bullets: [s.slice(0, 120)] })),
      { title: "Takeaways", bullets: ["Review", "Quiz weak spots", "Ask follow-ups"] },
    ];
    return { mode, slides, markdown: slides.map((s) => s.title).join("\n"), engine: "standalone-local" };
  }
  if (mode === "guide") {
    const steps = sentences.slice(0, 5).map((s, i) => ({
      step: i + 1,
      title: `Step ${i + 1}`,
      detail: s.slice(0, 220),
      action: "Explain this in your own words.",
    }));
    return { mode, steps, markdown: steps.map((s) => s.title).join("\n"), engine: "standalone-local" };
  }
  if (mode === "study") {
    const concepts = sentences.slice(0, 6).map((s, i) => ({
      term: `Concept ${i + 1}`,
      note: s.slice(0, 160),
    }));
    return { mode, concepts, markdown: concepts.map((c) => c.term).join("\n"), engine: "standalone-local" };
  }
  const points = sentences.slice(0, 6);
  const markdown = [
    "## Summary",
    "",
    points.slice(0, 2).join(" ") || documentText.slice(0, 280),
    "",
    "### Key points",
    ...points.map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");
  return { mode: "summarize", markdown, engine: "standalone-local" };
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
  const sk = addSkeleton();
  try {
    let result = null;
    if (anna?.llm?.complete && asking) {
      try {
        result = await invokeLlm(mode.id, doc, userPrompt, { ask: true });
      } catch (e) {
        console.warn(e);
      }
    }
    if (!result && anna?.llm?.complete && !asking) {
      try {
        // Prefer structured local/tool for rich widgets; LLM for summarize/ask mainly
        if (mode.id === "summarize") result = await invokeLlm(mode.id, doc, userPrompt, { ask: false });
      } catch (e) {
        console.warn(e);
      }
    }
    if (!result && anna?.tools?.invoke) {
      result = asking ? await invokeAskTool(doc, userPrompt) : await invokeToolMode(mode.id, doc, userPrompt);
    }
    if (!result) {
      result = asking
        ? {
            mode: "ask",
            markdown: `### Answer\nBased on your document:\n\n${doc.slice(0, 420)}…`,
            engine: "standalone-local",
          }
        : localFallback(mode.id, doc, userPrompt);
    }

    sk.remove();
    lastResult = result;
    lastMarkdown = result.markdown || "";
    addRichResult(result);
    pushHistory({
      at: Date.now(),
      mode: result.mode || mode.id,
      title: result.title || mode.title,
      markdown: lastMarkdown,
      result,
    });
  } catch (e) {
    sk.remove();
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

function newSession() {
  els.chat.querySelectorAll(".msg, .skeleton").forEach((n) => n.remove());
  showHub();
  lastMarkdown = "";
  lastResult = null;
  addMessage("system", "New session ready. Pick a mode or upload a document.");
  // keep hub visible: remove the system? keep both — hideHub was called; restore hub
  showHub();
}

function bindUi() {
  els.enterBtn.addEventListener("click", () => {
    enterWorkspace();
    showHub();
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
  els.rerunBtn.addEventListener("click", () => runLearning());
  els.clearHistory.addEventListener("click", () => {
    history = [];
    renderHistory();
    try {
      localStorage.removeItem(STORAGE_HISTORY_KEY);
    } catch {
      /* ignore */
    }
  });

  els.fileInput.addEventListener("change", () => loadFile(els.fileInput.files?.[0]));
  els.hubUpload.addEventListener("click", () => {
    setSidebarOpen(true);
    els.fileInput.click();
  });
  els.cmdUpload.addEventListener("click", () => {
    setSidebarOpen(true);
    els.fileInput.click();
  });
  els.cmdMode.addEventListener("click", () => setSidebarOpen(true));
  els.cmdExport.addEventListener("click", exportLast);
  els.cmdNew.addEventListener("click", newSession);
  els.themeToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  });

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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      if (e.key === "Enter" && e.shiftKey) return;
      e.preventDefault();
      els.sendBtn.click();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (els.workspace.hidden) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key >= "1" && e.key <= "5") {
      const mode = MODES[Number(e.key) - 1];
      if (mode) setMode(mode.id);
    }
    if (e.key.toLowerCase() === "u") {
      e.preventDefault();
      els.fileInput.click();
    }
  });
}

async function init() {
  buildModeUi();
  bindUi();
  setMode("summarize", { persist: false });
  updateDocMeta({ name: "", type: "", chars: 0 });

  let theme = "light";
  let entered = false;
  try {
    theme = localStorage.getItem(STORAGE_THEME_KEY) || "light";
    entered = localStorage.getItem(STORAGE_ENTERED_KEY) === "1";
    const rawHist = localStorage.getItem(STORAGE_HISTORY_KEY);
    if (rawHist) history = JSON.parse(rawHist) || [];
  } catch {
    /* ignore */
  }
  applyTheme(theme);
  renderHistory();

  try {
    anna = await AnnaAppRuntime.connect();
    setConn(true);
    await anna.window.set_title({ title: "MindSparkle" });
    try {
      const savedTheme = await anna.storage.get({ key: STORAGE_THEME_KEY });
      if (savedTheme?.value) applyTheme(savedTheme.value);
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
      const savedHist = await anna.storage.get({ key: STORAGE_HISTORY_KEY });
      if (Array.isArray(savedHist?.value)) {
        history = savedHist.value;
        renderHistory();
      }
    } catch {
      /* ignore */
    }
  } catch (e) {
    setConn(false);
    console.warn("[mindsparkle] standalone:", e?.message || e);
  }

  if (entered) {
    enterWorkspace({ persist: false });
    showHub();
  } else showEntrance();
}

init();
