/**
 * MindSparkle UI — auth + welcome + clean workspace + local file extract
 */
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { extractLocalFile } from "./extract.js";

const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__.mindsparkle) ||
  "tool-dev-mindsparkle";

const KEYS = {
  user: "mindsparkle:user",
  users: "mindsparkle:users",
  doc: "mindsparkle:document",
  meta: "mindsparkle:document_meta",
  mode: "mindsparkle:mode",
  theme: "mindsparkle:theme",
  history: "mindsparkle:history",
  welcomeSession: "mindsparkle:welcome_done_session",
};

const MODES = [
  { id: "summarize", short: "1", title: "Summarize", blurb: "Clear overview + key points" },
  { id: "quiz", short: "2", title: "Quiz", blurb: "Interactive practice questions" },
  { id: "presentation", short: "3", title: "Presentation", blurb: "Slide-ready outline" },
  { id: "guide", short: "4", title: "Guide", blurb: "Step-by-step learning path" },
  { id: "study", short: "5", title: "Study", blurb: "Flashcards + revision pack" },
];

const $ = (s) => document.querySelector(s);
const els = {
  authScreen: $("#auth-screen"),
  tabLogin: $("#tab-login"),
  tabSignup: $("#tab-signup"),
  loginForm: $("#login-form"),
  signupForm: $("#signup-form"),
  authError: $("#auth-error"),
  entrance: $("#entrance"),
  enterBtn: $("#enter-btn"),
  welcomeUser: $("#welcome-user"),
  workspace: $("#workspace"),
  menuBtn: $("#menu-btn"),
  drawer: $("#drawer"),
  drawerClose: $("#drawer-close"),
  modeList: $("#mode-list"),
  modeTitle: $("#mode-title"),
  connPill: $("#conn-pill"),
  themeToggle: $("#theme-toggle"),
  cmdExport: $("#cmd-export"),
  logoutBtn: $("#logout-btn"),
  chat: $("#chat"),
  hub: $("#hub"),
  hubGrid: $("#hub-grid"),
  docInput: $("#doc-input"),
  docMeta: $("#doc-meta"),
  dropzone: $("#dropzone"),
  fileInput: $("#file-input"),
  clearDoc: $("#clear-doc"),
  runMode: $("#run-mode"),
  historyList: $("#history-list"),
  clearHistory: $("#clear-history"),
  promptInput: $("#prompt-input"),
  sendBtn: $("#send-btn"),
  hint: $("#hint"),
  layout: $(".layout"),
};

let anna = null;
let busy = false;
let activeMode = "summarize";
let lastMarkdown = "";
let lastResult = null;
let currentUser = null;
let history = [];
let docMeta = { name: "", type: "", chars: 0 };

function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function showAuthError(msg) {
  els.authError.hidden = !msg;
  els.authError.textContent = msg || "";
}

function setScreen(name) {
  els.authScreen.hidden = name !== "auth";
  els.entrance.hidden = name !== "welcome";
  els.workspace.hidden = name !== "workspace";
}

function setConn(online, label) {
  els.connPill.textContent = label || (online ? "Anna connected" : "Local mode");
  els.connPill.classList.toggle("online", online);
  els.connPill.classList.toggle("offline", !online);
}

function setBusy(on) {
  busy = on;
  els.sendBtn.disabled = on;
  els.runMode.disabled = on;
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  els.themeToggle.textContent = next === "dark" ? "Light" : "Dark";
  lsSet(KEYS.theme, next);
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
      if (!inList) html.push("<ul>");
      inList = true;
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
  if (els.hub) els.hub.hidden = true;
}
function showHub() {
  if (!els.hub) return;
  els.hub.hidden = false;
  els.chat.appendChild(els.hub);
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
}

function addSkeleton() {
  hideHub();
  const sk = document.createElement("div");
  sk.className = "skeleton";
  sk.innerHTML = "<i></i><i></i><i></i>";
  els.chat.appendChild(sk);
  els.chat.scrollTop = els.chat.scrollHeight;
  return sk;
}

function currentMode() {
  return MODES.find((m) => m.id === activeMode) || MODES[0];
}

function setMode(id) {
  activeMode = id;
  const mode = currentMode();
  els.modeTitle.textContent = mode.title;
  els.hint.textContent = `${mode.title}: ${mode.blurb}. Files extract in-browser (no huge upload frames).`;
  els.modeList.querySelectorAll(".mode-card").forEach((b) => b.classList.toggle("active", b.dataset.mode === id));
  lsSet(KEYS.mode, id);
}

function setDrawer(open) {
  els.layout.classList.toggle("drawer-closed", !open);
}

function updateDocMeta(meta = {}) {
  docMeta = { ...docMeta, ...meta };
  const chars = docMeta.chars || (els.docInput.value || "").length;
  els.docMeta.textContent = chars
    ? `${docMeta.name || "Pasted"} · ${(docMeta.type || "text").toUpperCase()} · ${chars.toLocaleString()} chars`
    : "No file";
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!history.length) {
    els.historyList.innerHTML = `<p class="muted">No outputs yet</p>`;
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
      btn.onclick = () => {
        const real = history[history.length - 1 - idx];
        lastMarkdown = real.markdown || "";
        lastResult = real.result || null;
        if (real.result) addRichResult(real.result);
        else addMessage("assistant", real.markdown || "", { markdown: true, engine: "history" });
      };
      els.historyList.appendChild(btn);
    });
}

function pushHistory(entry) {
  history = [...history, entry].slice(-12);
  lsSet(KEYS.history, history);
  renderHistory();
}

function buildModeUi() {
  els.modeList.innerHTML = "";
  els.hubGrid.innerHTML = "";
  MODES.forEach((mode) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "mode-card";
    card.dataset.mode = mode.id;
    card.innerHTML = `<strong>${mode.title}</strong><span>${mode.blurb}</span>`;
    card.onclick = () => setMode(mode.id);
    els.modeList.appendChild(card);

    const hub = document.createElement("button");
    hub.type = "button";
    hub.className = "hub-card";
    hub.innerHTML = `<strong>${mode.title}</strong><span>${mode.blurb}</span>`;
    hub.onclick = () => {
      setMode(mode.id);
      if (!getDoc()) {
        setDrawer(true);
        addMessage("system", `Mode: ${mode.title}. Upload a document to run it.`);
        showHub();
      } else runLearning();
    };
    els.hubGrid.appendChild(hub);
  });
}

function getDoc() {
  return (els.docInput.value || "").trim();
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) {
    addMessage("assistant", "File is larger than 40MB. Please use a smaller document.");
    return;
  }
  setBusy(true);
  const sk = addSkeleton();
  try {
    // Always extract in-browser — avoids stdio 16MB frame limit
    const { text, engine, ext } = await extractLocalFile(file);
    if (!text) throw new Error("No extractable text found in this file.");
    // Keep workspace text bounded for later tool/LLM calls
    const clipped = text.slice(0, 180000);
    els.docInput.value = clipped;
    updateDocMeta({ name: file.name, type: ext || "file", chars: clipped.length });
    lsSet(KEYS.doc, clipped);
    lsSet(KEYS.meta, { name: file.name, type: ext, chars: clipped.length });
    sk.remove();
    addMessage(
      "system",
      `Loaded “${file.name}” (${clipped.length.toLocaleString()} chars) via ${engine}${
        text.length > clipped.length ? " · truncated for speed" : ""
      }`,
    );
  } catch (e) {
    sk.remove();
    addMessage("assistant", `Could not read file: ${e?.message || e}`);
  } finally {
    setBusy(false);
    els.fileInput.value = "";
  }
}

function buildQuizNode(questions = []) {
  let correct = 0;
  let answered = 0;
  const wrap = document.createElement("div");
  wrap.className = "rich";
  wrap.innerHTML = `<h3 class="rich-title">Interactive Quiz</h3>`;
  const score = document.createElement("div");
  score.className = "muted";
  score.textContent = "Tap an answer to score";
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
      btn.onclick = () => {
        if (box.dataset.done) return;
        box.dataset.done = "1";
        answered += 1;
        const ok = oi === Number(q.answer_index || 0);
        if (ok) correct += 1;
        btn.classList.add(ok ? "correct" : "wrong");
        [...opts.children].forEach((c, idx) => {
          if (idx === Number(q.answer_index || 0)) c.classList.add("correct");
          c.disabled = true;
        });
        score.textContent = `Score: ${correct}/${answered}`;
      };
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
  wrap.className = "rich";
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
  meta.className = "pill";
  const next = document.createElement("button");
  next.className = "ghost compact";
  next.type = "button";
  next.textContent = "Next →";
  nav.append(prev, meta, next);
  const card = document.createElement("div");
  card.className = "slide-card";
  const paint = () => {
    const s = slides[i] || { title: "Empty", bullets: [] };
    meta.textContent = `${i + 1}/${slides.length || 1}`;
    card.innerHTML = `<h4>${escapeHtml(s.title || "")}</h4><ul>${(s.bullets || [])
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
  wrap.className = "rich";
  wrap.innerHTML = `<h3 class="rich-title">Learning Guide</h3>`;
  steps.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "timeline-step";
    row.innerHTML = `<div class="step-num">${s.step || idx + 1}</div>
      <div><strong>${escapeHtml(s.title || "")}</strong>
      <p class="muted">${escapeHtml(s.detail || "")}</p>
      <p><strong>${escapeHtml(s.action || "")}</strong></p></div>`;
    wrap.appendChild(row);
  });
  return wrap;
}

function buildStudyNode(concepts = []) {
  const wrap = document.createElement("div");
  wrap.className = "rich";
  wrap.innerHTML = `<h3 class="rich-title">Study Flashcards</h3><p class="muted">Tap to flip</p>`;
  const grid = document.createElement("div");
  grid.className = "flash-grid";
  concepts.forEach((c) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "flash";
    card.innerHTML = `<div class="term">${escapeHtml(c.term || "Concept")}</div>
      <div class="note">${escapeHtml(c.note || "")}</div>
      <div class="hint-flip">Reveal</div>`;
    card.onclick = () => card.classList.toggle("open");
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
  return wrap;
}

function addRichResult(result) {
  const mode = result.mode || activeMode;
  let node = null;
  if (mode === "quiz" && result.questions?.length) node = buildQuizNode(result.questions);
  else if (mode === "presentation" && result.slides?.length) node = buildSlidesNode(result.slides);
  else if (mode === "guide" && result.steps?.length) node = buildGuideNode(result.steps);
  else if (mode === "study" && result.concepts?.length) node = buildStudyNode(result.concepts);

  if (node) addMessage("assistant", "", { node, engine: result.engine || "" });
  else addMessage("assistant", result.markdown || "No output.", { markdown: true, engine: result.engine || "" });
}

async function callTool(method, args) {
  if (!anna?.tools?.invoke) throw new Error("Tools unavailable");
  const result = await anna.tools.invoke({ tool_id: TOOL_ID, method, args });
  const data = result?.data?.data || result?.data || result?.result?.data || result?.result || result;
  if (data?.success === false) throw new Error(data.error || "Tool failed");
  return data?.data || data;
}

function localFallback(mode, documentText, userPrompt) {
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
    }));
    return { mode, questions, markdown: "Quiz", engine: "local" };
  }
  if (mode === "presentation") {
    const slides = [
      { title: "Overview", bullets: [userPrompt || "Walkthrough", "Key themes"] },
      ...sentences.slice(0, 4).map((s, i) => ({ title: `Section ${i + 1}`, bullets: [s.slice(0, 120)] })),
    ];
    return { mode, slides, markdown: "Presentation", engine: "local" };
  }
  if (mode === "guide") {
    const steps = sentences.slice(0, 5).map((s, i) => ({
      step: i + 1,
      title: `Step ${i + 1}`,
      detail: s.slice(0, 220),
      action: "Explain in your own words",
    }));
    return { mode, steps, markdown: "Guide", engine: "local" };
  }
  if (mode === "study") {
    const concepts = sentences.slice(0, 6).map((s, i) => ({ term: `Concept ${i + 1}`, note: s.slice(0, 160) }));
    return { mode, concepts, markdown: "Study", engine: "local" };
  }
  const points = (() => {
    // Prefer diverse sentences across the doc, not only the first ones
    const all = documentText
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 40);
    if (all.length <= 8) return all;
    const step = Math.max(1, Math.floor(all.length / 8));
    const picked = [];
    for (let i = 0; i < all.length && picked.length < 8; i += step) picked.push(all[i]);
    return picked;
  })();
  return {
    mode: "summarize",
    title: "Document Summary",
    markdown: [
      "## Summary",
      "",
      points.slice(0, 2).join(" ") || documentText.slice(0, 280),
      "",
      "### Key points",
      ...points.map((p, i) => `${i + 1}. ${p}`),
      "",
      "### How to go deeper",
      "- Switch to **Quiz** to test yourself",
      "- Switch to **Guide** for a study path",
    ].join("\n"),
    engine: "local-summary",
  };
}

function detectModeIntent(text = "") {
  const t = String(text).toLowerCase();
  if (/\b(summar(y|ize|ise)|ملخص|اختصر)\b/.test(t)) return "summarize";
  if (/\b(quiz|questions?|اختبار|أسئلة|اسئله)\b/.test(t)) return "quiz";
  if (/\b(presentation|slides?|عرض|سلايد)\b/.test(t)) return "presentation";
  if (/\b(guide|roadmap|خطة|دليل)\b/.test(t)) return "guide";
  if (/\b(study|flashcards?|مذاكرة|مذاكره)\b/.test(t)) return "study";
  return null;
}

function isModeCommand(text = "") {
  const t = String(text).trim().toLowerCase();
  if (!t) return false;
  if (detectModeIntent(t)) return true;
  // short commands like "do it", "run", "go" while a mode is selected
  if (/^(run|go|start|do it|ok|نعم|يلا|شغل)$/i.test(t)) return true;
  return false;
}

async function runLearning({ userPrompt = "", fromChat = false } = {}) {
  const doc = getDoc();
  if (!doc) {
    setDrawer(true);
    addMessage("system", "Upload or paste a document first.");
    showHub();
    return;
  }

  // If user types "summarize it" in chat, treat as mode run — NOT weak ask/retrieval
  const intentMode = fromChat ? detectModeIntent(userPrompt) : null;
  if (intentMode) setMode(intentMode);
  const mode = currentMode();
  const asking = fromChat && Boolean(userPrompt.trim()) && !isModeCommand(userPrompt);

  addMessage("user", asking ? userPrompt : `Run ${mode.title}${userPrompt && !intentMode ? `: ${userPrompt}` : ""}`);
  setBusy(true);
  const sk = addSkeleton();
  try {
    let result = null;
    const clipped = doc.slice(0, 14000); // keep tool/LLM payloads small

    // Prefer structured mode tools for summarize/quiz/... (better than ask retrieval)
    if (!asking && anna?.tools?.invoke) {
      try {
        result = await callTool("run_mode", {
          mode: mode.id,
          document_text: clipped,
          user_prompt: intentMode ? "" : userPrompt || "",
        });
      } catch (e) {
        console.warn("run_mode failed", e);
      }
    }

    if (asking && anna?.llm?.complete) {
      try {
        const reply = await anna.llm.complete({
          messages: [
            { role: "system", content: { type: "text", text: "You are MindSparkle, a precise study coach. Answer clearly in markdown." } },
            {
              role: "user",
              content: {
                type: "text",
                text: `Answer using ONLY this document.\n\nQuestion: ${userPrompt}\n\nDOCUMENT:\n${clipped}`,
              },
            },
          ],
          maxTokens: 1200,
        });
        const text = reply?.content?.text || reply?.text || "";
        if (text) result = { mode: "ask", markdown: text, engine: "anna.llm.complete" };
      } catch (e) {
        console.warn("llm.complete failed", e);
      }
    }

    if (!result && asking && anna?.tools?.invoke) {
      try {
        result = await callTool("ask_document", {
          document_text: clipped,
          question: userPrompt,
        });
      } catch (e) {
        console.warn("ask_document failed", e);
      }
    }

    if (!result) {
      result = asking
        ? await callToolSafeAsk(clipped, userPrompt)
        : localFallback(mode.id, clipped, userPrompt);
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

async function callToolSafeAsk(doc, question) {
  try {
    if (anna?.tools?.invoke) {
      return await callTool("ask_document", { document_text: doc, question });
    }
  } catch {
    /* fall through */
  }
  // stronger local ask than single-sentence dump
  const sentences = doc
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  const qWords = new Set((question.toLowerCase().match(/[a-z]{4,}/g) || []));
  const ranked = sentences
    .map((s) => ({ s, score: [...qWords].reduce((n, w) => n + (s.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.s);
  const evidence = ranked.length ? ranked : sentences.slice(0, 5);
  return {
    mode: "ask",
    markdown: [
      "## Answer",
      "",
      `**Question:** ${question}`,
      "",
      "### Key evidence",
      ...evidence.map((e, i) => `${i + 1}. ${e}`),
      "",
      "### Short synthesis",
      evidence.slice(0, 2).join(" "),
    ].join("\n"),
    engine: "local-retrieval",
  };
}

function exportLast() {
  if (!lastMarkdown.trim()) {
    addMessage("system", "Nothing to export yet.");
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

function goWelcome() {
  const name = currentUser?.name || currentUser?.email || "there";
  els.welcomeUser.textContent = `Hi ${name} — your AI study workspace is ready.`;
  setScreen("welcome");
}

function enterWorkspace() {
  try {
    sessionStorage.setItem(KEYS.welcomeSession, "1");
  } catch {
    /* ignore */
  }
  setScreen("workspace");
  setDrawer(true);
  showHub();
}

function logout() {
  currentUser = null;
  lsSet(KEYS.user, null);
  try {
    sessionStorage.removeItem(KEYS.welcomeSession);
  } catch {
    /* ignore */
  }
  setScreen("auth");
}

function bindAuth() {
  els.tabLogin.onclick = () => {
    els.tabLogin.classList.add("active");
    els.tabSignup.classList.remove("active");
    els.loginForm.hidden = false;
    els.signupForm.hidden = true;
    showAuthError("");
  };
  els.tabSignup.onclick = () => {
    els.tabSignup.classList.add("active");
    els.tabLogin.classList.remove("active");
    els.signupForm.hidden = false;
    els.loginForm.hidden = true;
    showAuthError("");
  };

  els.signupForm.onsubmit = (e) => {
    e.preventDefault();
    const name = $("#signup-name").value.trim();
    const email = $("#signup-email").value.trim().toLowerCase();
    const password = $("#signup-password").value;
    const users = lsGet(KEYS.users, {}) || {};
    if (users[email]) {
      showAuthError("Account already exists. Use Login.");
      return;
    }
    users[email] = { name, email, password };
    lsSet(KEYS.users, users);
    currentUser = { name, email };
    lsSet(KEYS.user, currentUser);
    showAuthError("");
    goWelcome();
  };

  els.loginForm.onsubmit = (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim().toLowerCase();
    const password = $("#login-password").value;
    const users = lsGet(KEYS.users, {}) || {};
    const found = users[email];
    if (!found || found.password !== password) {
      showAuthError("Invalid email or password.");
      return;
    }
    currentUser = { name: found.name, email: found.email };
    lsSet(KEYS.user, currentUser);
    showAuthError("");
    goWelcome();
  };
}

function bindUi() {
  els.enterBtn.onclick = () => enterWorkspace();
  els.menuBtn.onclick = () => setDrawer(els.layout.classList.contains("drawer-closed"));
  els.drawerClose.onclick = () => setDrawer(false);
  els.themeToggle.onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  };
  els.cmdExport.onclick = exportLast;
  els.logoutBtn.onclick = logout;
  els.clearDoc.onclick = () => {
    els.docInput.value = "";
    updateDocMeta({ name: "", type: "", chars: 0 });
    lsSet(KEYS.doc, "");
  };
  els.clearHistory.onclick = () => {
    history = [];
    lsSet(KEYS.history, []);
    renderHistory();
  };
  els.fileInput.onchange = () => loadFile(els.fileInput.files?.[0]);
  els.dropzone.addEventListener("click", (e) => {
    if (e.target !== els.fileInput) els.fileInput.click();
  });
  ["dragenter", "dragover"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    }),
  );
  els.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
  els.docInput.oninput = () => updateDocMeta({ name: docMeta.name || "Pasted", type: docMeta.type || "text", chars: els.docInput.value.length });
  els.runMode.onclick = () => runLearning();
  els.sendBtn.onclick = () => {
    const prompt = els.promptInput.value.trim();
    els.promptInput.value = "";
    runLearning({ userPrompt: prompt, fromChat: true });
  };
  els.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.sendBtn.click();
    }
  });
}

async function init() {
  buildModeUi();
  bindAuth();
  bindUi();
  applyTheme(lsGet(KEYS.theme, "light"));
  setMode(lsGet(KEYS.mode, "summarize") || "summarize");
  history = lsGet(KEYS.history, []) || [];
  renderHistory();
  const savedDoc = lsGet(KEYS.doc, "");
  if (typeof savedDoc === "string" && savedDoc) {
    els.docInput.value = savedDoc;
    updateDocMeta(lsGet(KEYS.meta, { name: "Saved document", type: "text", chars: savedDoc.length }));
  } else updateDocMeta({});

  try {
    anna = await AnnaAppRuntime.connect();
    setConn(true);
    await anna.window.set_title({ title: "MindSparkle" });
  } catch {
    setConn(false);
  }

  currentUser = lsGet(KEYS.user, null);
  let welcomeDone = false;
  try {
    welcomeDone = sessionStorage.getItem(KEYS.welcomeSession) === "1";
  } catch {
    welcomeDone = false;
  }

  if (!currentUser) setScreen("auth");
  else if (!welcomeDone) goWelcome();
  else enterWorkspace();
}

init();
