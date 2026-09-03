# xstockstrat-analysis — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not
governance. The config zero-trap fix and the internal admin-scope-injection security question are
recorded at the root (they are cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| The service `CLAUDE.md` "P&L pattern consumer" section describes the seal writing "the enriched payload's `realized_pnl`" and lists only the migration-016 tables | It omits the `fees_total` column (migration `021`), the **net-of-fees** contract (ANALYSIS-9), and the new **`GetAttribution`** RPC (absent from both the RPC narrative and any ledger-event/RPC table) — an agent trusting CLAUDE.md would not know net≠gross exists | `services/xstockstrat-analysis/CLAUDE.md` P&L section vs `app/handlers/servicer.py:2905`, `migrations/021_pnl_positions_fees_total.up.sql` | Add `GetAttribution` + the `fees_total`/net contract (ANALYSIS-9) to CLAUDE.md |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`ConfigWatcher` carries indicators identity**: module docstring "Config watcher for xstockstrat-**indicators**" and `client_id=f"indicators-{id(self)}"` | analysis registers with the config service under an "indicators-…" client id (copy-paste from the indicators template) | `app/config/watcher.py:2` (docstring), `:61` (`client_id`) |
| **`ScreenerEngine.screen()` has no per-symbol error isolation** (surfaced 2026-08-26, feature 160 archive): the loop calls `_eval_symbol` with no surrounding `try/except`, and `_eval_symbol` catches only `grpc.RpcError` at each RPC site — so any *non-*`RpcError` (arithmetic, `float()`, `scoring.compute_signal_score`) in one symbol propagates unwrapped and fails the whole `ScreenSymbols` RPC as gRPC UNKNOWN. Feature 160 fixed the specific `bar.time` typo that triggered it but did not add the isolation. Fix: wrap the per-symbol call so one symbol's failure degrades that row (e.g. to INSUFFICIENT_DATA / skipped) instead of killing the scan. | One bad symbol takes down the entire screen instead of degrading a single row. | `app/services/screener.py:119-129` |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The fundamentals background loop injects `x-access-scope=4` (admin bit) into its own outbound metadata; the admin check is `int(x-access-scope) & 0x04`. Is a background loop self-granting the admin bit the intended trust model? (Cross-cutting with the MCP agent's hardcoded `x-access-scope=7`; tracked in the root findings log.) `app/engine/fundsignal_loop.py:461-462` (`meta.append(("x-access-scope","4"))`), admin check `servicer.py:425-437` (`_is_admin`, `int(x-access-scope) & 0x04`) — status: **open**
- **Gross vs. net P&L basis split across the two `realized_pnl` consumers** (2026-09-02): `QueryPnLPatterns` buckets on GROSS `pnl_pattern_samples.realized_pnl` (`app/engine/pnl_pattern_consumer.py:283,331`) while `GetAttribution` uses NET (`servicer.py:2942-2943`). Likely intentional (feature 042 vs 029, different subsystems) but nowhere stated — an agent unifying "P&L" reporting would assume one basis. Is pattern-sample P&L deliberately gross while attribution is net? — status: **open**
- ⚠ **security (forward-pointer, feature 133)** — Strategy ownership (feature 133) resolves the owner from the inbound `x-user-id` header, which raised the question of a *synthetic* outbound `x-user-id` = a stored strategy owner on the live loop's owner-scoped `ListWatchlists`/`ListPositions` calls — a second un-JWT-verified origination point for that header (the admin-bit self-injection above, extended to *identity* impersonation). **Feature 133 does NOT introduce that call site**: it is identity-only (live-loop *state* is owner-keyed, but the owner-scoped firing **universe** union — the piece that needs the synthetic header — is deferred to feature 132's `resolve_universe`, see 133 `implementation-spec.md` D-1). So the impersonation finding **belongs to feature 132**, not this one; recorded here only so a future reader knows why 133's `x-user-id` propagation did not add a new synthetic-header vector. — status: **deferred to feature 132**

> Note: the "all-None custom formula on staging" bug (PR #769/#773) is **resolved** by feature 067 —
> `evaluator.py:308-318` now uses `MessageToDict` (recursive `ListValue` decode; import `:23`). Not an open defect.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
