# Context: fix-offline-account-ui-gaps  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A follow-up bug fix to feature 157 (offline accounts) that shipped fixes on THREE surfaces,
not the one recon predicted. What looked like a UI-only defect (a broker order ticket + broker-style
balance fields shown for manually-tracked offline accounts) turned out to require authoritative
trading-layer guards, because a UI gate cannot guarantee the "offline orders are recorded NEW, never
CANCELED" invariant (FR-2). Final shape: a UI dedicated Record-order control + `!isOffline` field
gating; a trading `PlaceOrder` authoritative-routing guard + `CancelOrder` offline reject; a portfolio
combined-view offline enumeration closing the C-10(b) parity gap.

**Why (irrecoverable rationale)**: The adversary refused the UI-only closure and a dedicated code-trace
found that `CancelOrder` sets `ORDER_STATUS_CANCELED` UNCONDITIONALLY (`trading.go:1079`) while
`PlaceOrder` routes offline solely on the in-memory pool tag (`:388`), never re-reading persisted
`broker_type`. Two independent code-reachable causes for the staging CANCELED (A: a stray
`CancelOrder` on a NEW-offline order; B: pool/DB divergence misrouting to a broker). The operator chose
to harden BOTH guards so FR-2 holds regardless of which fired — deliberately unblocking without ever
obtaining the authoritative order row (no MCP order-query tool existed).

**Rejected alternatives** (all were in the now-deleted design.md):
- Reuse the full broker `OrderForm` in "record" mode — lost: trailing-stop validation runs BEFORE the
  offline branch (`trading.go:359-367` vs `:388`), so an offline Trailing-Stop submit InvalidArguments
  and never persists NEW.
- UI-gate-only, no trading guard — lost: cannot guarantee FR-2 given the unconditional cancel + the
  pool-tag routing.
- Route `PlaceOrder` on the pool tag only (status quo) — lost: a pool/DB `broker_type` divergence
  misroutes offline → broker.
- FR-4 assert-only / offline absent from the combined view — lost: the operator wanted offline VISIBLE
  with meaningful-only fields; the absence was itself the C-10(b) parity defect.

**Scars & gotchas**:
- `broker_type` is IMMUTABLE post-create (only the `CreateBrokerAccount` INSERT writes it; no UPDATE
  anywhere), so a pool-vs-DB divergence is NOT reachable via any RPC — only an out-of-band DB edit or a
  pre-boot registration state. The guard was still added as defense.
- Go tests must use `recover()` to assert against the concrete un-fakeable `*repository.TradingRepo`/
  `*PortfolioRepo` `UpsertOrder` panic — these repos cannot be doubled.
- The Playwright mock's `placeOrder` returns a hardcoded FILLED (`mock-backend.ts:202-208`) — the
  NEW-not-CANCELED guarantee is provably untestable in e2e and REQUIRES the Go tests.
- `next dev` first-hit route compilation is flaky-then-green; CI prebuilt + `--retries=2` is stable.

**Permanent deviations**:
- design said the `CancelOrder` guard keys on "persisted `broker_type` OFFLINE and/or empty
  `broker_order_id`" → shipped keyed on `order.BrokerType == OFFLINE` ONLY → because empty
  `broker_order_id` would false-reject a legitimate broker order in the window before its
  `broker_order_id` is set.
- design said portfolio parity via a repository-double `ListPortfolios` test → shipped a pure-helper
  `TestOfflineIDsToAppend` unit test → because `*PortfolioRepo` is concrete/un-fakeable and the TDD
  gate forbids a DB test; e2e (`@AC-3`/`@AC-4`) covers the integration.
- design/spec targeted `PortfolioPanel.tsx`'s combined branch → shipped ALSO gating
  `src/app/trader/portfolio/page.tsx` → because `AccountContext` auto-selects the first active account,
  so `PortfolioPanel`'s combined branch is rarely reached; the real "Book" combined surface is the page
  file. (Both this and the immutable-`broker_type` finding recorded at insights.md 2026-08-26.)

**Cross-feature signal**: Tooling gap for trading bug triage — the available MCP tools (staging agent
tools; DO databases = cluster-mgmt only) expose NO raw order-row query and no trading/order tool, so an
authoritative staging order row cannot be pulled by the agent. This forced code-trace + defensive
both-guards and left the actual incident root cause unconfirmed. Recurs for any future trading-side
data-correctness triage. Also the direct downstream of 157's C-14 consumer-surface sweep missing a
surface (the recurring enum/consumer-sweep-missed-a-surface pattern).

**Deferred follow-ons**: A zero-activity offline account (no `offline_account_realized` row AND no
positions) is not yet known to xstockstrat-portfolio — no account-creation signal reaches portfolio,
so it won't surface in the combined view. Out of scope; `@AC-4` covers only accounts with positions. If
the operator later supplies the staging order row, confirm which hypothesis (A vs B) fired and that the
shipped guard covers it.

**Ledger entries written**: insights.md (2, both design — purpose-named cross-mount gating prop;
verify-the-live-render-path-of-a-named-surface), fails.md (0). The "status transition guarded by
reading the adjacent broker-call precondition, not the local state write" fail was already recorded at
fails.md:1687 (DUP, reinforces C-10(b)/P-03 — not re-added).
**Runtime-invariant recommendations (→ /context-constitution)**: candidate UI-* — `PortfolioPanel.tsx`'s
combined/all-accounts branch is rarely reached because `AccountContext` auto-selects the first active
account; the authoritative combined ("Book") surface is
`services/xstockstrat-ui/src/app/trader/portfolio/page.tsx`. (The three new backend behaviors are
already in trading/portfolio CLAUDE.md per Step 8, recoverable.)
**Scenario promotion (C-16)**: all 4 `@AC-*` were already promoted at launch to
`services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature` — nothing new to write
(idempotent). A minor wording drift on AC-1/AC-3 was flagged for human curation, not resolved here
(promotion does not rewrite an already-promoted scenario).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
