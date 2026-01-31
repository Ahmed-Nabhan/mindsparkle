# MindSparkle Deep Review (Jan 30, 2026)

## Key Findings

### Strengths
- Clear service-layer intent and strong inline docs across core services (good for onboarding and maintenance).
- Solid offline-first approach with SQLite truncation safeguards to keep navigation responsive.
- Robust auth handling with secure storage adapter for Supabase sessions.

### Risks / Gaps
1) Multiple “single entry points” for document flow
- Legacy documentService (declares “SINGLE ENTRY POINT”).
- documentIntelligenceService orchestration + event bus.
- New simplified documentServiceV2/useDocumentV2 flow.
- This duplication increases defects, makes QA harder, and causes inconsistent behavior between screens.

2) Real-time subscriptions are duplicated
- UploadScreen creates its own Supabase channel while DocumentContext also maintains global channels.
- Likely multiple channels per session → bandwidth + battery cost.

3) Aggressive concurrency in client batching
- MAX_CONCURRENT = 50 in apiService can overwhelm mobile devices and trigger backend rate limits.

4) Authorization header confusion
- apiService sets Authorization to anon key at creation, then overwrites with JWT in interceptor.
- Creates subtle auth inconsistencies and makes audits harder.

5) Potential data loss on version bump
- On app version change, local documents are deleted without user confirmation.

6) Hardcoded service endpoints in config
- OPENAI_PROXY_URL and other backend URLs default to specific endpoints, brittle for staging/prod separation.

7) Logging persistence always enabled
- Logging persists warn/error to audit_logs by default; without redaction/sampling, sensitive metadata could leak.

## Enhancements (Prioritized)

### P0 — Security & Data Safety
1) Remove anon-key Authorization header; use it only for apikey. Authorization should be user JWT only.
2) Replace “version bump = delete all documents” with a migration strategy (prompt user or migrate).
3) Add log redaction + sampling to avoid leaking sensitive metadata.

### P1 — Architecture & Maintainability
4) Consolidate document pipelines: pick one and deprecate the rest.
5) Centralize realtime subscriptions (keep one channel manager).
6) Split documentIntelligenceService into smaller modules for testability.

### P2 — Performance & UX
7) Adaptive concurrency (e.g., 6–10 on mobile, higher on Wi‑Fi).
8) Environment safety checks at startup (fail fast with friendly UI).
9) Improve error handling clarity (actionable messages).
