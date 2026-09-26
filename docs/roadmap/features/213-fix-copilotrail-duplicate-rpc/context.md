# Context Log: fix-copilotrail-duplicate-rpc

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-26 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md`
  (GitHub Issues are disabled on this repo — `--from-report` path). Surfaced during the feature 187
  QA back-fill as the reason @AC-7 could not be covered.
- Severity: SEV-3. Config-only: no. Impact type: redundant-backend-rpc.
- Routed to SDD path (Track C).
- Created: status.md (`draft`), feature.md (Type=bug), product-spec.md, acceptance.feature
  (regression scenario @AC-1: single page-1 ListOpportunities RPC), context.md.
- Affected services (from report): `xstockstrat-ui` — `src/components/copilot/CopilotRail.tsx`,
  the shared `src/hooks/useOpportunities.ts`, parity with `src/app/insights/opportunities/page.tsx`.
  Extra read fan-out lands on `xstockstrat-analysis` but no analysis-side change anticipated.
- Root cause: CopilotRail `useOpportunities(0)` defaults `sort=UNSPECIFIED` (0); the page passes
  `sortEnum` defaulting to `CONVICTION` (1). The feature-190 5-tuple query key
  (`['opportunities', minConviction, sources, actionFilter, sort]`) therefore differs on the trailing
  `sort`, so React Query keeps two cache entries and fires two RPCs. One-line fix: align CopilotRail's
  sort with the page default.
- Numbering: assigned **213** (max existing NNN 212 + 1; 212 is the just-imported
  `212-sysadmin-db-write-role`). Not the count-based formula in the Track C reference, which is unsafe
  in this repo (duplicate NNNs + gaps) — used the authoritative max+1 rule (root CLAUDE.md).
- Recommended design depth: **skip** → `/sdd-spec fix-copilotrail-duplicate-rpc` (SEV-3, single
  service, no proto/migration/config, clear one-line root cause).
- Follow-on: once this fix lands, add the deferred feature-187 @AC-7 strict single-RPC guard to
  `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts`.
- Development branch: feature/fix-copilotrail-duplicate-rpc
