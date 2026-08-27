# Context Log: fix-insights-offline-ticket

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-27 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-08-27-insights-signal-ticket-offline-account-flake-defect.md` (GitHub Issues disabled → --from-report path).
- Severity: SEV-3. Config-only: no. Impact: flaky-e2e-test / possible-ui-misrender.
- Routed to SDD path (Track C).
- Created: status.md (draft), feature.md (Type=bug), product-spec.md, acceptance.feature (regression @AC-1), context.md.
- Affected services (from report): xstockstrat-ui (insights Signal-detail order ticket; feature 159/083/155).
- Root cause hypothesis: correct direct wiring (SignalOrderTicket allowOfflineRecord={false}); suspect the mobile SectionRenderer `form` mount omits the prop, and/or an AccountContext auto-select hydration race. Under investigation.
- **Not caused by feature 161** — reproduces on origin/main-dev fixtures; the offline-accounts spec reads no config. Surfaced while driving feature 161 PR #1032 to green.
- Recommended design depth: **quick** → `/sdd-design fix-insights-offline-ticket quick` (rationale: SEV-3 single service, no proto/migration/config, but root cause not yet pinned — one adversarial round).
- Development branch: feature/fix-insights-offline-ticket.

## Session 2026-08-27 (fix — claude)

- **Root cause pinned.** `/insights/market/[symbol]` is a redirect-only stub → `/trader/positions/[symbol]`
  (feature 125). The unified page re-created the Signal-detail order ticket inline at
  `src/app/trader/positions/[symbol]/page.tsx:335` mounting `OrderForm` **without**
  `allowOfflineRecord={false}` — the prop the original `SignalOrderTicket.tsx:22` carried.
  `OrderForm` defaults `allowOfflineRecord=true` (`OrderForm.tsx:55`) and gates
  `isRecordMode = allowOfflineRecord && selectedAccount?.brokerType === OFFLINE` (`:60`). With an
  offline-only account auto-selected by `AccountContext`, the auto-select re-render flips the heading
  from "Place Order" → "Record Offline Order" (`OrderForm.tsx:159`); racing the assertion is the flake.
- **Not a double-mount.** This page uses `SymbolPanelGroup` (single mount of the ticket node), not the
  mobile `SectionRenderer`. Defect hypothesis #1 (mobile `form` section omitting the prop) does not
  apply here; hypothesis #2 (auto-select re-render race) is the real cause. The prop fix makes
  `isRecordMode` structurally false, so no render timing can surface the record control.
- **Fix (1 line + rationale comment).** `page.tsx:335` → `allowOfflineRecord={false}`. Restores the
  documented broker-execution intent; the offline "Record order" affordance stays on `/trader` +
  `/trader/orders` (feature 159 @AC-1, `offline-accounts.spec.ts:196`, unchanged).
- **Design depth.** Ran Phase 0 recon inline (grounded, path:line-cited above) rather than the full
  `/sdd-design quick` subagent debate — a single-line prop restoration with the root cause already
  pinned by path:line evidence and one regression scenario. No proto/DB/config surface. Recorded here
  per Track C.
- Files: `src/app/trader/positions/[symbol]/page.tsx`; SDD artifacts (status.md, feature.md,
  implementation-spec.md, this log). Branch: `claude/fix-162-gp2epi`.
