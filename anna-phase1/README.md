# MindSparkle × Anna — Phase 1 Pack

Files in this folder:

| File | Purpose |
|------|---------|
| `PHASE1_PLAN.txt` | UX + frontend/backend plan for Phase 1 |
| `MindSparkle_Anna_Product_Description.pdf` | Product description PDF |
| `MindSparkle_Anna_Presentation.html` | Pitch presentation (open in browser, use arrows) |
| `ANNA_MARKETPLACE_UPLOAD_STEPS.txt` | Step-by-step Anna Marketplace upload guide |

## Phase 1 scope

- Chat-first open experience
- Side dots → sidebar modes: **Summarize, Quiz, Presentation, Guide, Study**
- Anna-native backend (LLM + storage + Executa tools)
- No rebuild of old Supabase/Cloud Run stack in Phase 1

## Implementation

Live Anna App project: [`../mindsparkle-anna/`](../mindsparkle-anna/)

```bash
cd mindsparkle-anna
npm install
npx anna-app validate
npx anna-app dev --no-llm
```
