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
