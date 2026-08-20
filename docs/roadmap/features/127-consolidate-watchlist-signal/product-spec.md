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

As a user of the MCP agent, when I (or any caller) invoke `ingest_signal` with
`direction="watchlist"` for a symbol, I want that symbol automatically added to my portfolio
watchlist, so that tagging a signal "watchlist" has a real, visible effect instead of being stored
as an inert label.

> **Premise note (corrected 2026-08-19):** the trigger is **any** caller that explicitly ingests a
> `direction="watchlist"` signal (an interactive agent session, or a future automated flow). The
> earlier draft cited the `form4-enhanced-ingest` skill as the driver, but that skill scores
> `direction="watchlist"` transactions at conviction 0.30 (below the 0.6 ingest threshold) and routes
> them to `skipped_signals` — it **never** calls `ingest_signal` for them
> (`.claude/skills/form4-enhanced-ingest/SKILL.md`). So form4 is **not** a producer of this feature's
> trigger; do not scope or test the feature around it.

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

- `xstockstrat-agent` — `ingest_signal` tool gains the auto-add side effect (and the caller's own
  identity via `_caller_user_id(ctx, ...)`, resolved from the authenticated tool call's verified
  claims — the same mechanism `emit_alert`/`manage_formula` already use); `app/client.py` gains a
  portfolio gRPC call (new `PORTFOLIO_ENDPOINT`-backed client method, mirroring the existing
  ingest/notify client methods, forwarding `x-user-id`).
  - **Deploy parity (C-1):** the agent gains the env var `PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052`,
    which is **absent from the agent block today**. It must be added to the `xstockstrat-agent` block in
    **all three** of `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`, plus the agent's
    `CLAUDE.md` Environment Variables list. The value is the fixed, well-known internal endpoint —
    identical across every environment (no per-target divergence).
- `xstockstrat-portfolio` — consumes `AddWatchlistSymbols`/`CreateWatchlist` (both RPCs already
  exist, feature 058) from a new caller (the agent); **no proto or schema change**. Ownership is
  derived server-side from the propagated `x-user-id` (never the request body), so the agent forwards
  the caller's own `x-user-id`; a call with no verified user id is hard-rejected by portfolio
  (`INVALID_ARGUMENT`), so the agent skips the auto-add best-effort in that case (see Open Questions).

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

- [x] **No new config keys.** The reserved watchlist name is a **module constant** in the agent, not a
  config key: no requirement needs a per-env-renamable name, and renaming a live value would orphan
  every existing reserved watchlist (they'd stop matching → a duplicate is created). This is the
  minimum-scope, footgun-free choice (a config key was considered and rejected at design time — see
  design.md § Rejected Alternatives).

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

- [x] **Whose watchlist? — RESOLVED (2026-08-19, user intent + recon):** a special, system-managed,
  **per-user** watchlist owned by the **calling user**. The agent derives the caller's own id via
  `_caller_user_id(ctx, "ingest_signal")` (adding the MCP-injected `ctx` param, non-breaking — same as
  `emit_alert`/`manage_formula`) and forwards it as `x-user-id`; ownership is header-derived
  server-side (`portfolio.proto:193-194`). **Fallback:** `_caller_user_id` raises only on the
  unauthenticated stdio-local transport (every authenticated Streamable-HTTP tool call carries verified
  claims — `app/main.py` `_authorized`), so the auto-add is skipped best-effort with a `log.warning`
  in that case (the signal is still ingested). No system/owner-less watchlist concept is introduced
  (none exists; not needed — the list is user-owned, so no C-10(c) ownership sentinel is required).
- [x] **Which watchlist? — RESOLVED:** a fixed, auto-created, well-known **reserved-named** watchlist
  (a module constant, not a caller-supplied `watchlist_id` — no tool-contract change). The agent
  resolves it by name via `ListWatchlists`, `CreateWatchlist`s it if absent, then `AddWatchlistSymbols`.
  The exact reserved name + the behavior when a user already has a same-named list (`UNIQUE(user_id,
  name)` merge) is a design detail decided in design.md § Chosen Approach (see the reserved-name note).
- [ ] **UI distinction (C-14 override) — DEFERRAL, needs explicit sign-off in design.md/context.md:**
  whether the `/insights/watchlists` view visually distinguishes an agent/signal-sourced entry from a
  manually-added one is an **enhancement**, not part of this feature's consumer surface (the existing
  page already renders the added symbol, so C-14 "name and reach the surface" is satisfied). Per C-14
  it is resolved as **either** a named follow-up feature **or** explicitly left unscoped — recorded at
  the design gate; it is no longer a vague "if yes."
- [x] **Idempotency — RESOLVED (recon):** `AddWatchlistSymbols` is natively idempotent —
  `INSERT ... ON CONFLICT (watchlist_id, symbol) DO NOTHING` (`watchlist_repo.go:266-275`), so a
  repeated non-deduplicated signal on the same symbol is a silent no-op (no error, no duplicate). No
  extra guard needed.
