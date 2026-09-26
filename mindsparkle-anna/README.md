# MindSparkle (Anna App) — Phase 1+

Chat-first AI study companion for the Anna Marketplace — rebuilt to be stronger than the original MindSparkle stack.

## What’s new
- **Welcome entrance** before the workspace
- **Professional chat + side-rail UI**
- **Multi-format upload:** PDF, DOCX, TXT, MD, CSV (+ paste)
- Modes: Summarize · Quiz · Presentation · Guide · Study
- **Ask-the-document chat** follow-ups
- **Export last result** as Markdown
- Prefers Anna `llm.complete` when available; local Executa fallback otherwise

## Run locally

```bash
npm install
# once on your machine:
# curl -LsSf https://astral.sh/uv/install.sh | sh
npx anna-app doctor
npx anna-app validate
npx anna-app dev --no-llm
```

Open `http://localhost:5180/`.

## Tests

```bash
npm run test:plugin
```

## Publish
See `../anna-phase1/ANNA_MARKETPLACE_UPLOAD_STEPS.txt`.
