QA & Checks for MindSparkle

This document lists automated and manual checks to validate the app functionality.

1) Static checks (quick)
- Run: `node scripts/qa/static_checks.js`
- Verifies presence of RevenueCat keys, product IDs in source, Presentation AI URL, Canva key, and `expo-dev-client` presence.

2) Runtime RevenueCat validation (in-app)
- In the app console or a debug screen, call:
  - `import { validateRevenueCatConfiguration } from './src/services/revenueCat';`
  - `const result = await validateRevenueCatConfiguration(); console.log(result);`
- The validator returns `{ ok: boolean, details: string[] }` with actionable messages.

3) Study Guide / Interview tests
- Reproduce: Open a document with >500 chars, generate Study Guide and Interview.
- If empty results appear, check app logs (metro or device) for `Study guide:`, `Interview:` logs added in `src/services/apiService.ts`.
- If empty, retry after reducing document size or re-uploading; server-side AI proxy may be rate-limited.

4) Presentation checks
- Generate a preview first, then full presentation.
- If images are required, set `expo.extra.CANVA_API_KEY` or env `CANVA_API_KEY` and retry.

5) Audio listen (fixed)
- Open Document → Actions → Listen; the audio player will fetch full document content from local storage when the navigation `content` is too short.

6) Supabase migration
- `supabase/migrations/20260108000005_audit_reset_subscriptions.sql` prepared. Run in Supabase SQL editor.

7) End-to-end QA plan
- Prepare a small test document (~2000-5000 chars) with images.
- Run: Summarize, Study Guide, Interview, Presentation (with images), Listen, Purchase (sandbox/dev client).
- Collect logs and mark pass/fail per feature.

If you want, I can (A) run the static checks now, or (B) implement a debug screen in-app that runs runtime validators and shows results. Tell me which to do next.