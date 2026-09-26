# Context Log: fix-reconciliation-false-halt

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-25 (sdd-triage, manual)

- Bug reported via defect report `docs/reports/2026-09-25-reconciliation-false-halt-defect.md`
  (GitHub Issues disabled on this repo — `--from-report` path).
- Severity: SEV-2. Routed to SDD path (Track C).
- The `/sdd-*` skills are not registered as invocable in this cloud session, so Track C was executed
  manually against `.claude/plugins/sdd-suite/skills/sdd-triage/reference/track-c-sdd.md` (the
  bug-triage runbook sanctions manual execution when the skill is unavailable).
- Feature number: **206** = `max(existing NNN=205) + 1` per root CLAUDE.md numbering rule (the
  track-c script's count-based formula returned 212 due to gap/duplicate prefixes — the max+1 rule is
  authoritative).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (5 regression scenarios),
  context.md.
- Affected services: xstockstrat-trading, xstockstrat-portfolio.
- Root cause hypothesis: position-side reconciliation trusts `ListPositions` as authoritative "what
  the platform placed" with no `trading.orders` DB-grounding (unlike the hardened order side);
  compounded by `processPositionSync` deleting order-fill rows on an empty broker snapshot.
- Recommended design depth: **quick** — `/sdd-design fix-reconciliation-false-halt quick`. Rationale:
  the track-c C-0 heuristic scores ≥2 services as `full`, but the design is already tightly scoped and
  user-approved (defense-in-depth across the two services, no proto/migration/config), so a single
  adversarial round is proportionate. No proto, no DB migration, no config key changes.
- **Branch deviation (recorded, P-04):** the harness pins development to
  `claude/flow-investigation-4blorq` (branched from and PR'd into `main-dev`); the SDD-canonical
  `feature/<slug>` branch model and `/sdd-execute` per-step branches are therefore not used. The
  code changes land directly on `claude/flow-investigation-4blorq` per explicit user direction
  ("Track C on the assigned branch").
- User decision (AskUserQuestion): fix scope = **defense-in-depth across both services**; process
  track = **Track C on the assigned branch**.
- SDD Track C artifacts committed as `ff43313` and pushed to `claude/flow-investigation-4blorq`.

## Session 2026-09-25 (sdd-design quick, manual)

- Wrote recon.md (grounded dossier) + design.md (defense-in-depth: trading `trading.orders`
  grounding of the position-side check + portfolio empty-snapshot delete guard).
- One adversarial round via the `design-buddy:adversary` agent (the debate step `/sdd-design quick`
  runs internally). Verdict: **NEEDS WORK**, no Floor breach. Findings + resolutions:
  - **HIGH (fixed in design)**: naive `SUM(filled_qty)` double-counts because `trading.orders` PK is
    `(order_id, created_at)` and `UpsertOrder` mints a fresh `created_at` on nil `o.CreatedAt`
    (`trading_repo.go:47-50`), so a logical order can have >1 row. Query changed to
    `DISTINCT ON (order_id) … ORDER BY order_id, created_at DESC` before summing (mirrors `GetOrder`).
  - MEDIUM (documented): stalled-`pollFills` residual; corporate-action splits (pre-existing).
  - LOW (documented/waived): indefinite ghost on dashboard-only close (corrected in Open Risk 1);
    net-zero foreign masking; epsilon justification. Change-2 right-sizing waived (user-approved
    defense-in-depth + defect Expected demands the projection not be transiently zeroed).
  - Ledger: no `account.positions.*` payload change → `fails.md:2056-2064` not re-triggered;
    feature-056 dual-source P&L path untouched. Confirmed by adversary.
- Interface choice upheld: separate `positionQtyLookup` seam (ISP), not widening `brokerOrderIDLookup`.
- Status: draft → design-approved.

## Session 2026-09-25 (sdd-spec + execute, manual, on claude/flow-investigation-4blorq)

- Wrote implementation-spec.md (6 steps). Implemented all steps on the harness-pinned branch (no
  `/sdd-execute` per-step branches — the `/sdd-*` skills are not invocable in this session).
- **Step 1** `TradingRepo.NetFilledQtyBySymbol` (`trading_repo.go`) — `DISTINCT ON (order_id)` dedup +
  signed SUM (adversary HIGH fix). **Step 2** `positionQtyLookup` seam + `reconcilePositionLookup`
  field wired `= repo` in `NewTradingService`. **Step 3** `reconcileTick` position side DB-grounded
  (`qtyApproxEqual`, fail-safe on lookup error). **Step 4** portfolio `shouldReconcileSyncDeletions`
  guard in `processPositionSync` (empty broker snapshot no longer purges).
- **Step 5 tests** (all green): trading reconcile — `ExplainedByPlatformOrders_NoHalt` (@AC-1),
  `PositionNetLookupError_SkipsHalt` (@AC-3), existing `CaughtViaPositionSide` still halts (@AC-2);
  trading repo pgxmock — `NetFilledQtyBySymbol_SumsSignedAndDedups` + empty-input short-circuit;
  portfolio — `TestShouldReconcileSyncDeletions` table (@AC-4/@AC-5 + no-regression).
- **Step 6 validate**: `GOWORK=off go build/vet/test ./...` green for both services.
- **Context teardown (manual, plugin unavailable):** the `/context-forge:context-constitution refresh`
  command is not registered in this cloud session (only `/context-forge:context-scrubber` is), so the
  teardown was done by hand per the root CLAUDE.md rule: re-read every touched context file against the
  code and reconciled the grounded drift — updated **PORTFOLIO-10** (empty-snapshot wipe now gated by
  `shouldReconcileSyncDeletions`), `xstockstrat-trading/CLAUDE.md` (position side now DB-grounded), and
  `xstockstrat-portfolio/CLAUDE.md` (empty-snapshot delete guard). No trading context-constitution
  invariant described the position-side comparison, so none needed changing; the line-36 async-emit
  gotcha is unaffected (the new lookup uses the poller ctx, consistent with it).
- Status: in-progress → code-completed. Next: PR `claude/flow-investigation-4blorq` → `main-dev`.

## Session 2026-09-25 (CI: feature status automation)

- Promotion PR #1181 merged to main
- Feature promoted and committed: eee580622c92a27a5e6dc22e6919075924b01b84
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-25
