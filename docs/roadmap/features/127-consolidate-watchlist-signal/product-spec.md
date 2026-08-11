# Product Spec: consolidate-watchlist-signal

**Created**: 2026-08-11

---

## Problem Statement

`ingest_signal` (an `xstockstrat-agent` MCP tool) accepts `direction="watchlist"` as one of four
allowed values (`buy`/`sell`/`hold`/`watchlist`, `packages/proto/ingest/v1/ingest.proto:109`). Today
that value is persisted verbatim in `xstockstrat-ingest`'s `ingest.newsletter_signals.direction`
column and is treated as **non-actionable** by `xstockstrat-analysis`'s scoring
(`services/xstockstrat-analysis/app/services/scoring.py:32-36`) — it drives no scoring math and is
never joined with, or written into, the platform's actual watchlist mechanism
(`xstockstrat-portfolio`'s `Watchlist`/`CreateWatchlist`/`AddWatchlistSymbols` RPCs, feature 058).
The two concepts share the English word "watchlist" and nothing else. A signal ingested with
`direction="watchlist"` is effectively write-only data today: queryable via `QuerySignals`, but
never surfaced to a user's actual watchlist.

## User Story

As a user of the MCP agent (or an automated ingestion flow, e.g. the `form4-enhanced-ingest`
skill), when I call `ingest_signal` with `direction="watchlist"` for a symbol, I want that symbol
automatically added to a portfolio watchlist, so that tagging a signal "watchlist" has a real,
visible effect instead of being stored as an inert label.

## Functional Requirements

FR-1. When `ingest_signal` is called with `direction="watchlist"` and the ingest succeeds
(`IngestSignalResponse.deduplicated == false`), the agent automatically adds `symbol` to a portfolio
watchlist via `xstockstrat-portfolio`'s `AddWatchlistSymbols` RPC, as an unbound
`WatchlistBinding` (`strategy_id=""`) — mirroring the existing auto-alert side effect already in
`ingest_signal` (`services/xstockstrat-agent/app/tools.py:294-330`).

FR-2. If no target watchlist yet exists (see Open Questions — resolution owned by `/sdd-design`),
the tool creates one via `CreateWatchlist` before adding the symbol.

FR-3. The watchlist auto-add is **best-effort and non-blocking**: a failure (e.g.
`xstockstrat-portfolio` unavailable, `PERMISSION_DENIED`) must be logged but must **not** fail the
already-committed `ingest_signal` call — matching the existing auto-alert contract
(`app/tools.py:294-330`, `try/except` around the side effect).

FR-4. A `deduplicated=true` response (the submission matched an existing signal within the dedup
window) must **not** re-trigger the watchlist auto-add, mirroring the existing suppression of the
auto-alert on dedup (`app/tools.py:309-313`).

FR-5. `ingest_signal`'s docstring and `docs/runbooks/mcp-tools.md` must document the new side effect
in the same place the existing auto-alert side effect is documented, keeping the two tool-doc
surfaces in parity (ledger `fails.md` 2026-08-02 — `mcp-tools-alignment-triage` — a hand-maintained
tool doc that drifts from the code is a repeat failure mode on this exact tool).

FR-6. `direction` values other than `"watchlist"` (`buy`/`sell`/`hold`) are unaffected — no change
to their ingest, scoring, or alerting behavior.

## Out of Scope

- No proto changes to `ExternalSignal`/`IngestSignalRequest`/`IngestSignalResponse` — the auto-add
  is agent-tool-layer orchestration against the existing `AddWatchlistSymbols`/`CreateWatchlist`
  RPCs (feature 058), not a new ingest-side field.
- No change to `xstockstrat-analysis`'s treatment of `direction="watchlist"` as non-actionable for
  scoring — this feature only wires the *storage* side, not backtesting/scoring semantics.
- No new `xstockstrat-ui` page or control — the existing `/insights/watchlists` page (feature 058)
  already renders whatever `ListWatchlists` returns, so an auto-added symbol appears there
  automatically. Whether the UI should visually distinguish agent-added symbols from manually-added
  ones is explicitly deferred (see Open Questions).
- No retroactive backfill of existing `direction="watchlist"` rows already in
  `ingest.newsletter_signals` into a portfolio watchlist.

## Affected Services

- `xstockstrat-agent` — `ingest_signal` tool gains the auto-add side effect; `app/client.py` gains a
  portfolio gRPC call (new `PORTFOLIO_ENDPOINT`-backed client method, mirroring the existing
  ingest/notify client methods).
- `xstockstrat-portfolio` — consumes `AddWatchlistSymbols`/`CreateWatchlist` (both RPCs already
  exist, feature 058) from a new caller (the agent); no proto or schema change expected, but the
  service owner should confirm no per-caller assumption in the handler breaks under a machine
  caller (see Open Questions on identity).

## Consumer Surface(s)

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `ingest_signal` (changed side-effect/behavior —
  same tool name, params, and return shape; the new auto-add is a documented side effect, not a
  contract change, per FR-5)
- [ ] **UI** — none planned this feature (existing `/insights/watchlists` page already renders the
  result; see Out of Scope)
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required (reuses `portfolio.v1.AddWatchlistSymbols` / `CreateWatchlist`,
  both already defined — `packages/proto/portfolio/v1/portfolio.proto:20-26,195-247`)

## Config Key Changes

- [ ] No new config keys
- OR: **TBD at design time** — a config key may be needed for the target watchlist's name (e.g.
  `agent.signal.watchlist_name`, default `"Signals"`) if the design resolves Open Question 2 toward
  a fixed named watchlist rather than a caller-supplied `watchlist_id`. Left open pending
  `/sdd-design`.

## Database Changes

- [ ] No schema changes (reuses feature 058's existing `xstockstrat-portfolio` watchlist tables)

## Feature Workflow Notes

Branch to create: `feature/consolidate-watchlist-signal` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — no proto change; a possible
  new config key is additive and non-breaking

## Acceptance Criteria

1. Calling `ingest_signal(direction="watchlist", ...)` for a symbol not already in the target
   watchlist results in that symbol appearing in the target portfolio watchlist's `bindings` (or
   deprecated `symbols` mirror) after the call returns.
2. Calling `ingest_signal(direction="buy"|"sell"|"hold", ...)` produces **no** watchlist mutation.
3. A `deduplicated=true` ingest response produces **no** watchlist mutation (matches the existing
   auto-alert suppression behavior for the same condition).
4. `xstockstrat-portfolio` being unreachable or rejecting the write does not cause `ingest_signal`
   to raise or return an error — the signal is still ingested and `signal_id` is still returned.
5. `docs/runbooks/mcp-tools.md`'s `ingest_signal` entry documents the new side effect, in parity
   with the tool's docstring.

## Open Questions

- [ ] **Whose watchlist?** `xstockstrat-portfolio`'s `Watchlist` is strictly **user-owned** —
  ownership is taken from the propagated `x-user-id` header server-side, "intentionally absent from
  all request messages" (`packages/proto/portfolio/v1/portfolio.proto:193-194`). `ingest_signal`
  today derives **no** caller identity (unlike `manage_formula`'s `_caller_user_id`,
  `services/xstockstrat-agent/app/tools.py:107-122,677`) — it is called by automated/batch flows
  (e.g. the `form4-enhanced-ingest` skill) as much as by an interactive session, and there's no
  guarantee a "watchlist" signal has an obvious single human owner. `/sdd-design` must resolve: (a)
  derive `_caller_user_id(ctx, "ingest_signal")` and add per-caller like `manage_formula`'s author
  pattern, accepting that a fully-automated/service caller with no verified user claims would then
  need a defined fallback (reject? broadcast-style system owner, mirroring `emit_alert`'s
  `target_user_id=""`?); or (b) introduce a system/service-owned watchlist concept that doesn't
  exist today. This is the central architectural fork for this feature — do not guess at
  `/sdd-spec` time.
- [ ] **Which watchlist, if the caller has several?** Resolve to a fixed, auto-created,
  well-known-named watchlist (e.g. `"Signals"`, config-key-driven default name) vs. requiring an
  explicit new `watchlist_id` parameter on `ingest_signal` (a tool contract change, which raises the
  MCP tool-contract-stability bar per the `xstockstrat-agent` reviewer focus).
- [ ] Should the UI visually distinguish an agent/signal-sourced watchlist entry from a manually
  added one (e.g. surfacing `source`/`headline` from the originating signal)? Deferred to a named
  follow-up if yes — not scoped into this feature (C-14 override, needs explicit sign-off if
  deferred rather than left unscoped).
- [ ] Idempotency: `AddWatchlistSymbols` semantics for a symbol/binding already present in the
  target watchlist (no-op vs error) should be confirmed against the existing feature 058 handler
  before assuming append-only-safe repeated calls (e.g. from a non-deduplicated but repeat signal on
  the same symbol).
