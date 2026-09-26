# MindSparkle (Anna App) — Phase 1

Chat-first AI study companion for the Anna Marketplace.

## Phase 1 modes
- **Summarize**
- **Quiz**
- **Presentation**
- **Guide**
- **Study**

## UX
- Opens on a clean chat canvas
- Left dots / rail expands into a sidebar of modes + document paste/upload

## Stack
- `bundle/` — Anna App UI (iframe SPA)
- `executas/mindsparkle/` — learning tools (`run_mode`)
- Prefers `anna.llm.complete` when available, otherwise falls back to the local Executa heuristics

## Develop locally

```bash
npm install
npx anna-app doctor
npx anna-app validate
npx anna-app dev
```

Open the printed dashboard URL (usually `http://localhost:5180`).

## Publish later
See `../anna-phase1/ANNA_MARKETPLACE_UPLOAD_STEPS.txt`.
