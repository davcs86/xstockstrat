# Context Log: fix-trading-order-state-audit

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-trading-order-state-audit-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-04, D-62.
- Severity: SEV-2 (group severity; D-62 alone was rated one tier lower by the surveyor). Impact type:
  order-state-loss-unlogged. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-trading (fix site); xstockstrat-ledger receives a reused event type, no change.
- Root cause hypothesis: error/terminal-path writes treated as best-effort with results discarded; the four-way
  intent-lookup switch copied the discarded reclaim into three RPCs.
- Re-verification on main-dev @ a053b0e: both D-ids reproduce. Line drift: none — D-04 still `trading.go:688`,
  `:703`, `:1367`, `:1550`; D-62 still `:603`, `:1301`, `:1498`; sweeper contrast `order_intent.go:144-157`;
  switch copies at `classifyIntentLookup` calls `:586`, `:789`, `:1285`, `:1482`. Note the existing inline comment
  at `:602` ("Best-effort — the caller need not distinguish…") justifies the response shape, not the missing log/event.
- **Overlaps:** `trading.go` is touched by in-flight 241-fix-config-audit-author-spoof, 242-fix-push-untargeted-broadcast
  (alert sites `:1938-1944`, `:2751-2757`) and 249-fix-ibkr-request-signing (broker instantiation, credential
  validation), all `implementation-ready`, plus launched 240-offline-account-full-pnl. None edits the seven call
  sites here, but expect textual merge conflicts in `trading.go`; check `merge-order.md` before the integration PR.
  Related, not included: debt-radar NC-C (`CancelOrder` fail-open). Sibling batch feature 256-fix-offline-book-consistency
  (created concurrently, D-47/D-48/D-49/D-63) edits `ConfirmOrder` in `trading.go` (`:863-954` region) — no shared lines,
  but sequence the two `trading.go` branches via `merge-order.md`.
- Recommended design depth: quick → `/sdd-design fix-trading-order-state-audit quick` (rationale: SEV-2, single
  service, no proto/migration/config). Design forks: log-only vs surfacing the write failure; extract the intent
  switch now vs three-site fix.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-trading-order-state-audit

---

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches); overlap verdict: WARN (file-level only).
- Warnings:
  - C-15 (criterion 8): FR-5 bound reactive_cancel/reactive_replace but only AC-4 asserted the emit. **Resolved:** added `@AC-8` (CancelOrder, trigger `reactive_cancel`) and `@AC-9` (ReplaceOrder, trigger `reactive_replace`); FR-5 now traces to AC-4/AC-8/AC-9.
  - Criterion 9: both Open Questions are ticked but only deferred, not decided. Open for `/sdd-design`, which must close them (C-11).
  - FR-1/AC-1 log status `ORDER_STATUS_NEW` (pre-call) on the uncertain-outcome path although the broker state is unknown. Open: design to confirm the intended audit value. FR-4/AC-6 status was unspecified. **Resolved:** FR-4 now names the order's existing status, which `ReplaceOrder` does not change (verified at `trading.go:1535-1550`, where only qty/prices/TIF/intent state are mutated before the write).
  - AC-1/AC-2 assert "the order id" with no concrete value. Accepted: the id is generated server-side.
  - Criterion 4: ledger listed as "no change expected". Spot-checked: no event-type whitelist or `reclaimed_unknown` reference under `services/xstockstrat-ledger/src`. Design recon should confirm.
  - Code-checkable claims verified at the seven call sites and the sweeper emit (`order_intent.go:144-157`, payload `trigger`/`order_id`/`intent_id`/`was_pending_since` confirmed this session). Switch lines `:586/:789/:1285/:1482` not re-verified by the reviewer.
- Overlap findings (all file-level, rebase-only, no config-key/proto/migration collision):
  - `trading.go` vs 241-fix-config-audit-author-spoof (implementation-ready), escalateSystemic SetConfig `:2168-2176`.
  - `trading.go` vs 242-fix-push-untargeted-broadcast (implementation-ready), EmitAlert sites `:1938-1944`, `:2751-2757`.
  - `trading.go` (+ `internal/broker/ibkr.go`) vs 249-fix-ibkr-request-signing (implementation-ready), `:87-92`, `:3084-3097`.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-04, D-62.
  - Operator confirmed 2026-10-21: not a duplicate of demoted trading-state-machine-invariants (that was property-based lifecycle testing; this is discarded UpsertOrder / ReclaimOrphanIntent results).
  - Open Questions (log-only vs surfacing; extract the intent-lookup switch) are deferred to /sdd-design per C-11.
- Next: `/sdd-design fix-trading-order-state-audit`.
