# Recon: fix-portfolio-max-drawdown-unenforced

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio (+ xstockstrat-notify, Path A only — reused, not modified)

---

## Objective

End the silent read-then-discard of `portfolio.risk.max_drawdown_pct` in `checkRiskLimits`. The design
gate picks Path A (enforce a drawdown **alert** on breach) or Path B (document the key as not-yet-implemented).
**Recon materially changes the cost calculus**: every Path A dependency the product-spec worried about
(historical equity state, notify wiring, an alert event type) **already exists** — Path A is a modest,
self-contained fix, not a new feature.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Defect site: `checkRiskLimits` — `internal/service/portfolio_service.go:721`; reads
    `GetFloat("portfolio.risk.max_drawdown_pct", 0.10)` (`:722`), discards it `_ = maxDrawdownPct` (`:750`).
    Called from the order-fill consumer `:305` (`s.checkRiskLimits(ctx, fill.UserID, mode)`).
  - **Enforcement template (concentration)** — `:742-748`: on breach calls `s.emitRiskAlert(ctx, msg)`.
    The risk path is **alert-based, not halt-based** (it does not stop trading; it emits an alert +
    ledger event). Path A drawdown = the same shape.
  - `emitRiskAlert` — `:753-767`: emits a ledger event (`emitEvent(ctx, "portfolio.risk.drawdown_breach", …)`)
    **and** `s.notify.EmitAlert(… Severity WARNING, Category "risk" …)`. Reusable verbatim.
  - Equity history: **`portfolio.snapshots` hypertable already persists equity over time** —
    `migrations/001_portfolio_hypertable.up.sql:23` (`equity NUMERIC`, `snapshot_time`); live writer
    `StartSnapshotWriter`/`InsertSnapshot` (`:671`, `:706`). Existing read is single-point only
    (`GetSnapshot` `ORDER BY snapshot_time DESC LIMIT 1`, `internal/repository/portfolio_repo.go:200`).
    **No `MAX(equity)` / peak query exists** — Path A adds one repo read (no new migration; series is present).
  - notify client already wired (`grpc.NewClient(cfg.NotifyEndpoint …)`, `NOTIFY_ENDPOINT` already set).
  - Migrations tip: `015_watchlist_default_strategy` → next free **016** (likely NOT needed for Path A).
- **`xstockstrat-notify`** (reused, Path A only): `EmitAlert` RPC (`packages/proto/notify/v1/notify.proto:14`);
  `category` is a **free string** (no enum change); `AlertSeverity` WARNING already used. No proto change.

## Patterns to REUSE

- Drawdown breach handling → reuse `emitRiskAlert` (`portfolio_service.go:753`) verbatim — same ledger
  event + WARNING/"risk" alert the concentration check already uses.
- Equity series → reuse the existing `portfolio.snapshots` hypertable; add one peak-equity repo read
  next to `GetSnapshot` (`portfolio_repo.go:200`), no new table/migration.
- Test home → `internal/service/portfolio_risk_test.go` (exists; covers only pure helpers today).

## Existing Business Rules (preserve / extend)

- **No `@AC-*` in `services/xstockstrat-portfolio/acceptance/*.feature` guards risk limits / drawdown /
  concentration / halts / risk alerts** — net-new guarantee territory; a C-16 *gap*, not a conflict.
  Both paths must land their own `@AC-*` (Path A: the drawdown alert; Path B: the documented-unenforced key).
- **PRESERVE (Path A only)** `@AC-7` "severity gate" (`notify/acceptance/notify-external-fanout.feature`)
  — the drawdown alert must be WARNING+ to clear `notify.fanout.min_severity` / `notify.push.min_severity`.
  `emitRiskAlert` already emits WARNING → honored by construction.
- **PRESERVE (Path A only)** `@AC-5` "dedup within window" + `@AC-4` "best-effort fanout never delays the
  primary emit" (`notify-external-fanout.feature`, `pwa-notifications.feature`) — a per-snapshot re-alert
  on a persistently-breached account is deduped **by notify**; Path A must NOT bypass dedup/severity to
  "guarantee" delivery (doing so = a CHANGE needing sign-off). Reusing `emitRiskAlert` honors this.

## Dependencies

- Proto/RPC: none (reuses `EmitAlert`; `category` free string). Migration: none expected (snapshots exist;
  next free 016 if one is somehow needed). Config keys: none new (`max_drawdown_pct` already exists).
- Inter-service edges (Path A): portfolio → notify `EmitAlert` (already wired), portfolio → ledger (already wired).
- Consumer surface (C-14): Path A — the drawdown alert reaches the user via notify (StreamAlerts / Web Push)
  and any `/trader` risk display; Path B — internal/docs-only.

## Risks / Not-found

- **Shared event-type quirk**: concentration AND drawdown both emit `portfolio.risk.drawdown_breach`
  (`:754`) — the name is already a misnomer for concentration. Path A reusing it keeps the diff minimal
  and finally makes the name accurate for a real drawdown; renaming/splitting is out of scope (flag only).
- `checkRiskLimits`/`emitRiskAlert` have **no existing test**; the `service/` package is **coverage-excluded**
  (`.github/workflows/ci.yml:244`), so a new test doesn't move the number — but C-08 still wants the paired test.
- The documented `portfolio.risk.drawdown_breach` ledger event is currently only emitted by the concentration
  path (drawdown is discarded) — the "emitted" doc is aspirational for drawdown until Path A lands.
- Path B differs from its `daily_loss_limit` template: `daily_loss_limit` is **never read**, whereas
  `max_drawdown_pct` **is read then discarded** — Path B must also remove/annotate the `_ = maxDrawdownPct` read.

## Recommended Scope

- **Path A (recommended — recon shows it is cheap)**: add a peak-equity repo read; in `checkRiskLimits`,
  compute drawdown = (peak − current)/peak, compare to `maxDrawdownPct`, and on breach call the existing
  `emitRiskAlert` (WARNING, honoring notify's gates); add a `checkRiskLimits` unit test (RED-before-green);
  update the portfolio `CLAUDE.md` row from "Read but not yet enforced" → enforced; add a portfolio `@AC-*`.
- **Path B (fallback)**: mark `max_drawdown_pct` "Documented, not yet implemented" (mirror
  `daily_loss_limit`), remove/annotate the `_ = maxDrawdownPct` read, add a doc-contract `@AC-*`.
- The Path A/B choice is the gate decision (C-14 consumer surface + scope differ by path).
