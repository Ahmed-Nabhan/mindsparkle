/**
 * MindSparkle — Anna App UI
 * Chat-first learning workspace with side-rail modes.
 */
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const DEV_FALLBACK_TOOL_ID = "tool-dev-mindsparkle";
const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__.mindsparkle) ||
  DEV_FALLBACK_TOOL_ID;

const STORAGE_DOC_KEY = "mindsparkle:document";
const STORAGE_MODE_KEY = "mindsparkle:mode";

const MODES = [
  {
    id: "summarize",
    short: "SU",
    title: "Summarize",
    blurb: "Clear overview and key points from your document.",
  },
  {
    id: "quiz",
    short: "QZ",
    title: "Quiz",
    blurb: "Practice questions to test what you understood.",
  },
  {
    id: "presentation",
    short: "PR",
    title: "Presentation",
    blurb: "Slide-ready outline built from the same source.",
  },
  {
    id: "guide",
    short: "GD",
    title: "Guide",
    blurb: "Step-by-step path through the material.",
  },
  {
    id: "study",
    short: "ST",
    title: "Study",
    blurb: "Concept notes and a revision checklist.",
  },
];

const MODE_PROMPTS = {
  summarize:
    "Summarize the document clearly with an overview, key points, and section coverage. Use markdown.",
  quiz:
    "Create a practice quiz (5 multiple-choice questions) from the document. Show options A-D and mark the correct answer after each question. Use markdown.",
  presentation:
    "Create a presentation outline with 5-7 slides. Each slide needs a title and 2-4 bullets. Use markdown.",
  guide:
    "Create a step-by-step learning guide through the document. Each step needs a title, explanation, and action. Use markdown.",
  study:
    "Create a study pack with key concepts and a short revision checklist. Use markdown.",
};

const $ = (sel) => document.querySelector(sel);

const els = {
  app: $(".app"),
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
  fileInput: $("#file-input"),
  clearDoc: $("#clear-doc"),
  promptInput: $("#prompt-input"),
  sendBtn: $("#send-btn"),
  runMode: $("#run-mode"),
  hint: $("#hint"),
};

let anna = null;
let busy = false;
let activeMode = "summarize";

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

function formatInline(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/_(.+?)_/g, "<em>$1</em>");
}

function addMessage(role, content, { markdown = false } = {}) {
  const node = document.createElement("article");
  node.className = `msg ${role}${markdown ? " markdown" : ""}`;
  const label =
    role === "user" ? "You" : role === "assistant" ? "MindSparkle" : "System";
  if (role !== "system") {
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = label;
    node.appendChild(lab);
  }
  if (markdown) {
    const body = document.createElement("div");
    body.innerHTML = renderMarkdownLite(content);
    node.appendChild(body);
  } else {
    const body = document.createElement("div");
    body.textContent = content;
    node.appendChild(body);
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
  els.hint.textContent = `Mode: ${mode.title}. ${mode.blurb}`;
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

async function invokeTool(mode, documentText, userPrompt) {
  const result = await anna.tools.invoke({
    tool_id: TOOL_ID,
    method: "run_mode",
    args: {
      mode,
      document_text: documentText,
      user_prompt: userPrompt || "",
      question_count: 5,
      slide_count: 6,
    },
  });
  // Dispatcher shapes vary; normalize common envelopes.
  const data =
    result?.data?.data ||
    result?.data ||
    result?.result?.data ||
    result?.result ||
    result;
  if (data?.success === false) throw new Error(data.error || "Tool failed");
  if (data?.markdown) return data;
  if (data?.data?.markdown) return data.data;
  throw new Error("Unexpected tool response");
}

async function invokeLlm(mode, documentText, userPrompt) {
  const modeInstruction = MODE_PROMPTS[mode] || MODE_PROMPTS.summarize;
  const extra = userPrompt ? `\n\nUser request: ${userPrompt}` : "";
  const clipped = documentText.slice(0, 24000);
  const reply = await anna.llm.complete({
    messages: [
      {
        role: "system",
        content: {
          type: "text",
          text: "You are MindSparkle, an expert study coach. Be clear, structured, and practical.",
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text: `${modeInstruction}${extra}\n\nDOCUMENT:\n${clipped}`,
        },
      },
    ],
    maxTokens: 1800,
  });
  const text =
    reply?.content?.text ||
    reply?.message?.content?.text ||
    reply?.text ||
    "";
  if (!text) throw new Error("Empty LLM response");
  return {
    mode,
    title: currentMode().title,
    markdown: text,
    engine: "anna.llm.complete",
  };
}

async function localFallback(mode, documentText, userPrompt) {
  // Mirrors plugin heuristics so standalone preview still demos the UX.
  const sentences = documentText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  if (mode === "summarize") {
    const points = sentences.slice(0, 5);
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
  return invokeToolLocalish(mode, documentText, userPrompt, sentences);
}

function invokeToolLocalish(mode, documentText, userPrompt, sentences) {
  if (mode === "quiz") {
    const qs = (sentences.length ? sentences : [documentText]).slice(0, 5);
    const md = ["## Quiz", ""];
    qs.forEach((s, i) => {
      md.push(`**Q${i + 1}. What best matches this idea?**`);
      md.push(`- A) ${s.slice(0, 120)}`);
      md.push("- B) Unrelated claim");
      md.push("- C) Opposite claim");
      md.push("- D) Not in the document");
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
    addMessage("system", "Add a document in the side panel first.");
    return;
  }

  const mode = currentMode();
  if (fromChat && userPrompt) {
    addMessage("user", userPrompt);
  } else {
    addMessage("user", `Run ${mode.title}${userPrompt ? `: ${userPrompt}` : ""}`);
  }

  setBusy(true);
  addMessage("system", `Working on ${mode.title}…`);
  try {
    let result = null;
    if (anna?.llm?.complete) {
      try {
        result = await invokeLlm(mode.id, doc, userPrompt);
      } catch (e) {
        console.warn("[mindsparkle] llm.complete failed, trying tool", e);
      }
    }
    if (!result && anna?.tools?.invoke) {
      result = await invokeTool(mode.id, doc, userPrompt);
    }
    if (!result) {
      result = await localFallback(mode.id, doc, userPrompt);
    }
    // remove last system spinner-ish message
    const last = els.chat.querySelector(".msg.system:last-of-type");
    if (last && /Working on/.test(last.textContent || "")) last.remove();
    addMessage("assistant", result.markdown || "No output.", { markdown: true });
    if (anna?.storage?.set) {
      await anna.storage.set({
        key: `mindsparkle:last:${mode.id}`,
        value: { at: Date.now(), engine: result.engine || "unknown" },
      });
    }
  } catch (e) {
    const last = els.chat.querySelector(".msg.system:last-of-type");
    if (last && /Working on/.test(last.textContent || "")) last.remove();
    addMessage("assistant", `Error: ${e?.message || e}`);
  } finally {
    setBusy(false);
  }
}

function bindUi() {
  els.railToggle.addEventListener("click", () => {
    setSidebarOpen(els.sidebar.hidden);
  });
  els.sidebarClose.addEventListener("click", () => setSidebarOpen(false));
  els.clearDoc.addEventListener("click", () => {
    els.docInput.value = "";
    if (anna?.storage?.set) anna.storage.set({ key: STORAGE_DOC_KEY, value: "" }).catch(() => {});
  });
  els.fileInput.addEventListener("change", async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    els.docInput.value = text;
    if (anna?.storage?.set) {
      anna.storage.set({ key: STORAGE_DOC_KEY, value: text.slice(0, 200000) }).catch(() => {});
    }
    addMessage("system", `Loaded “${file.name}” (${Math.round(text.length / 100) / 10}k chars).`);
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
  setSidebarOpen(true);
  addMessage(
    "assistant",
    "Welcome to MindSparkle. Open a mode from the side rail, paste or upload a document, then run Summarize, Quiz, Presentation, Guide, or Study.",
  );

  try {
    anna = await AnnaAppRuntime.connect();
    setConn(true);
    await anna.window.set_title({ title: "MindSparkle" });
    try {
      const savedDoc = await anna.storage.get({ key: STORAGE_DOC_KEY });
      if (typeof savedDoc?.value === "string" && savedDoc.value) els.docInput.value = savedDoc.value;
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
}

init();
