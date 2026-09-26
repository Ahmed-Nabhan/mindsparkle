# MindSparkle (Anna App) — Phase 1+

Chat-first AI study companion for the Anna Marketplace — rebuilt to be stronger than the original MindSparkle stack.

## What’s new
- **Welcome entrance** before the workspace
- **Professional chat + side-rail UI**
- **Multi-format upload:** PDF, DOCX, TXT, MD, CSV (+ paste)
- Modes: Summarize · Quiz · Presentation · Guide · Study
- **Ask-the-document chat** follow-ups
- **Export last result** as Markdown
- Prefers Anna `llm.complete` for tutor-quality answers; Executa can also use host `llm.sample`
- Quiz / Presentation / Guide / Study return **structured interactive UI** (not flat text) when AI responds
- Local extractive fallback only if LLM is unavailable (clearly labeled)

## Run locally (with real AI — recommended)

```bash
npm install
# once on your machine:
# curl -LsSf https://astral.sh/uv/install.sh | sh
npx anna-app doctor
npx anna-app validate
npx anna-app login --host https://anna.partners   # required for LLM
npx anna-app whoami                               # confirm login worked
npx anna-app dev                                  # do NOT pass --no-llm
```

Open `http://localhost:5180/`. Results should show an **Anna AI** tag.

**Phone preview:** use Chrome Device Toolbar on the Mac (`Cmd+Option+I` → phone icon → iPhone).  
`anna-app dev` has no `--host` flag — that flag is only for `login`.

Offline-only (weak extractive output — for UI work only):

```bash
npx anna-app dev --no-llm
```

## Tests

```bash
npm run test:plugin
```

## Publish
See `../anna-phase1/ANNA_MARKETPLACE_UPLOAD_STEPS.txt`.
