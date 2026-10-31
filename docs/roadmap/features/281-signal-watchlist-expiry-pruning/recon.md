# Recon: signal-watchlist-expiry-pruning

**Created**: 2026-10-31
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, xstockstrat-ingest, xstockstrat-agent, xstockstrat-analysis (operator scope "both"), xstockstrat-ui (consumer surface, C-14)

---

## Premise Verdict (FR-1 / AC-1)

| Claim | Verdict | Evidence |
|---|---|---|
| Expired signal-sourced entries are never removed from the portfolio signal watchlist | **CONFIRMED** | No expiry/TTL/prune/sweep/ticker code touches watchlists: portfolio grep of `expir\|ttl\|prune\|sweep\|valid_until\|stale\|ticker\|NewTicker` found nothing relevant; the only watchlist deletes are caller-driven — `DeleteWatchlist` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:2142` → `internal/repository/watchlist_repo.go:268`), `RemoveWatchlistSymbols` (`portfolio_service.go:2195` → `watchlist_repo.go:312`), replace-all `UpdateWatchlist` (`watchlist_repo.go:210`). Portfolio goroutines are only ledger-stream consumers + a one-shot hydrate (`cmd/server/main.go:72-77`). Agent has no removal/expiry/background code (`app/` grep: none; only `lifespan` at `app/main.py:229-233`). Ingest has no code that touches watchlists at all. |
| It is *structurally unprunable today* | **CONFIRMED — stronger than the report** | A SIGNAL entry stores only `(watchlist_id, symbol, strategy_id, source, added_at)` (`services/xstockstrat-portfolio/migrations/007_watchlists.up.sql:16-21`, `008:7-8`, `011:31-32`). **No `signal_id` / `valid_until` / `expires_at` column or proto field exists** (`packages/proto/portfolio/v1/portfolio.proto:243-249`). The agent's add call carries neither `valid_until` nor `signal_id` even though `valid_until` is in scope (`services/xstockstrat-agent/app/tools.py:642` vs `:686-696`; `app/client.py:319-327`). `added_at` is never read by Go code. |
| Expired signals persist on **analysis opportunities** (operator "both") | **NOT CONFIRMED — refuted** | `ListOpportunities` excludes expired rows by default: `valid_clause = "" if include_expired else "AND o.valid_until > now()"` (`services/xstockstrat-analysis/app/repositories/opportunities.py:226`; handler `app/handlers/servicer.py:4668`). Only a stale-while-revalidate fallback serves expired rows when **all** of a user's rows are expired (`servicer.py:4707-4718`) and kicks a recompute. Rows are physically replaced wholesale per user by `replace_for_user` (`opportunities.py:82`) on recompute / daily refresh (`servicer.py:5917`). → no behavior gap to fix there; physical-row retention is a separate, unrequested concern. |
| Expired signals persist in **ingest** | **By design — out of scope** | `valid_until` is a nullable passive column (`services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:13-16`); readers filter by `active_window` (`app/handlers/servicer.py:1210-1228`); no deletion/retention exists (`app/` grep: none). Consumers that care (analysis `_drain_active_signals`, `servicer.py:6232`) filter at query time. |

**Net:** the reported defect is real and confined to the **portfolio signal watchlist**. The design cannot be a simple "delete where expired" because the entry has no link to its signal(s) (see Risks).

## Objective

Automatically remove `source=SIGNAL` entries from a user's system-managed signal watchlist once every signal backing that `(user, symbol)` has expired, while never touching `MANUAL` entries, the list itself, or the signal rows. Without this the list (and the fundamentals producer's universe, which reads it via `ListAllWatchlistSymbols`) accumulates stale symbols.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Watchlist SQL + tx: `internal/repository/watchlist_repo.go` (all writes in one `pool.Begin` tx: `:40,195,281,301,326,364`; idempotent `ON CONFLICT DO NOTHING` at `:497-499`; first writer wins on `source`).
  - Service: `internal/service/portfolio_service.go` — `EnsureSignalWatchlist` `:1939-1949` (empty request, `x-user-id` only; `watchlist_repo.go:68-71`), delete-guard `:2153-2154`, `normalizeBindings` `:1807-1826` (keeps `Source` at `:1822`), `applyDefaultStrategy` `:1847-1857`, `ListAllWatchlistSymbols` `:1954` (gated via `internal/service/authz.go:26`, SQL `watchlist_repo.go:423` unfiltered).
  - Entry point: `cmd/server/main.go:55` (config watcher), `:72-77` (goroutines — where a loop would be started).
  - Last migration: `017_offline_realized_lifetime_fees` → next `018`.
  - Config-read pattern: `internal/config/config.go:100,112,126,140` (`Watcher.GetString/GetInt/GetFloat`, live per call, no change-callback); existing keys `portfolio.watchlist.max_per_user`, `portfolio.watchlist.max_symbols_per_list` (`portfolio_service.go:1869,1873`).
  - Outbound clients: ledger, marketdata, notify only (`portfolio_service.go:130,138,146`); `Config` has no `IngestEndpoint` (`config.go:20-29`). Client interceptor injects headers only when ctx carries `PropagationData` (`internal/middleware/propagation.go:27,39-48`) — a background goroutine sends none unless it sets metadata explicitly.
- **`xstockstrat-ingest`** (Python)
  - `IngestSignal` `app/handlers/servicer.py:958`, `_ingest_external_signal` `:984-1169`, `QuerySignals` `:1172-1293` (predicate `valid_from <= $end AND (valid_until IS NULL OR valid_until >= $start)`, both inclusive; filter applied only when `active_window.start.seconds > 0`; default limit 100, offset page_token, `total_count` = page length `:1292`).
  - Per-owner scoping + `system` identity: `_resolve_owner` `:353-367`; `_SYSTEM_GRANTS` `:91-95` (only `analysis-system-read` may `QuerySignals` as system, SAN `xstockstrat-analysis`).
  - Dedup: `servicer.py:1057-1103`; claims keyed `(user_id, source, symbol, direction)`; a later `valid_until` inserts a **new** row, `deduplicated=false`.
  - Last migration `014_contract_signal_ownership` → next `015`; pool via PgBouncer (`app/main.py:55-62`) — no session advisory locks / LISTEN.
  - Index: `(valid_from, valid_until)` + `(user_id, ingested_at DESC)`; **no `(user_id, symbol, valid_until)` index** (`001:25-27`, `013:85-86`).
  - Outbound clients: marketdata, ledger, notify only (`servicer.py:317-319`).
- **`xstockstrat-agent`** (Python MCP)
  - `ingest_signal` `app/tools.py:604`; auto-add block `:686-696` (gated `direction=="watchlist" and not deduplicated`, bare `except Exception` → WARN, best-effort); `ensure_signal_watchlist` `app/client.py:297-312`; `add_watchlist_symbol` `:315-330`.
  - Watchlist tools: `list_watchlists` `tools.py:2004`, `get_watchlist` `:2020`, `manage_watchlist` `:2040`, `manage_watchlist_symbols` `:2124`.
  - Stateless; no background task; `instance_count>1` must stay safe (agent `CLAUDE.md`). Per-call short-lived mTLS channels (`client.py:305`); `PORTFOLIO_ENDPOINT` `client.py:28`, compose `docker-compose.yml:565`.
- **`xstockstrat-analysis`** (Python) — read-only for this feature
  - `ListOpportunities` `app/handlers/servicer.py:4558`; opportunities repo `app/repositories/opportunities.py`; Universe = signals ∪ positions ∪ watchlist bindings (`servicer.py:5236`), `_drain_watchlist_bindings` ignores `source` (`:5904-5908`); fundsignal universe `ListAllWatchlistSymbols` carries no source (`app/engine/fundsignal_loop.py:359`; `portfolio.proto:354-357`).
  - Last migration `027_contract_owner_dimension`; no change expected.
- **`xstockstrat-ui`** (Next.js)
  - `/insights/watchlists`: `src/app/insights/watchlists/page.tsx:146-175,189`; `WatchlistDetail.tsx:46,222-223` (`systemManaged` hides delete); `SignalSourceBadge` `WatchlistReadiness.tsx:41-48` (uses `Badge variant="info"`, `badge.tsx:26` raw `bg-blue-500/20 text-blue-400`).
  - Refresh: `useWatchlists` has no `refetchInterval`; global `staleTime 5_000` (`src/lib/queryClient.ts:22`) → pruned entries appear on refocus/remount/mutation, not on a timer (`src/hooks/useWatchlists.ts:25-35`).
  - Nav: `PLATFORM_SUBNAV` already registers both pages (`PlatformHeader.tsx:76,82`) → C-10(a) satisfied, no new route.

## Patterns to REUSE

- Idempotent, tx-wrapped, owner-scoped removal → reuse `RemoveSymbols` (`watchlist_repo.go:312`, `DELETE … WHERE watchlist_id=$1 AND symbol = ANY($2)`, naturally idempotent, no error if the row is gone).
- Cross-user internal-caller gate → reuse `authz.go:26` / `x-internal-caller` pattern used by `ListAllWatchlistSymbols` (`portfolio_service.go:1954`); precedent for header-less background callers: trading pollers use `metadata.AppendToOutgoingContext` (portfolio `CLAUDE.md`).
- Durable periodic loop → reuse analysis's `DurableSchedule` / `run_opportunity_refresh_forever` (`servicer.py:5917`) and ingest's `asyncio.create_task(run_mcp_client_loop(...))` (`app/main.py:127`); Go analog: the `go` consumers in `portfolio/cmd/server/main.go:72-77`.
- Config conventions → `<service>.<category>.<key>`, stored `0` honoured, not reverted to default (`fix-python-config-zero-trap` ingest `@AC-2`; `app/config/watcher.py:209-210`).
- Best-effort side effect after a committed write → reuse the agent's `tools.py:686-696` try/except pattern.
- System identity for background reads → ingest `analysis-system-read` grant (`servicer.py:91-95`) is the only `QuerySignals`-as-system path.
- "Now" capture → take `now` **after** the awaits (fails.md 2026-08-16 signal-time-decay; `servicer.py:5254-5256`); prefer DB `NOW()` for the cutoff.
- UI tests → extend `e2e/helpers/watchlistMock.ts` (`MockBinding`) + `INVENTORY.md` row 43; `e2e/insights/watchlists.spec.ts:328-370`; no expired-row fixture exists (all `validUntil` are 2030).

## Existing Business Rules (preserve / extend)

(from `scenario-recon`; no CHANGE found; no existing scenario asserts expired entries persist)
- **EXTEND** `@AC-1` "A watchlist-direction signal adds the symbol to the caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`, `@feature-127`) — expiry removal is the inverse lifecycle step.
- **PRESERVE** `@AC-2` "Non-watchlist directions cause no watchlist mutation" (`platform.feature`, `@feature-127`) — buy/sell ingests neither trigger nor perform cleanup.
- **PRESERVE** `@AC-3` "A deduplicated ingest does not re-trigger the auto-add" (`platform.feature`, `@feature-127`) — a deduplicated re-ingest must not re-add a removed entry.
- **PRESERVE** `@AC-7` "A system-managed watchlist cannot be deleted via API or UI" (`platform.feature`, `@feature-127`) — remove entries, never the list (even when empty); manual add/remove/rename stay enabled. *Soft spot:* locking/hiding manual remove on SIGNAL rows would be a CHANGE needing sign-off.
- **PRESERVE** `@AC-6` "EnsureSignalWatchlist is idempotent…" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — emptied list still found by flag; exactly one per user.
- **PRESERVE** `@AC-2` (feature 167) "Rebind preserves the entry's per-binding source" (`…/watchlist-single-strategy-update.feature`) — a rebound SIGNAL entry stays SIGNAL, hence stays prunable.
- **PRESERVE** `@AC-1` / `@AC-2` (feature 154) "distinct cross-user union" + "enumeration RPC rejects a non-privileged caller" (`…/fundsignal-watchlist-universe.feature`) — a new cross-user sweep must not weaken that gate.
- **PRESERVE** `@AC-4`/`@AC-5` (feature 170) all-or-nothing + owner-scoped bulk ops (`…/watchlist-bulk-default-strategy.feature`) — only if removal reuses a bulk path.
- **PRESERVE** `@AC-4` (agent, feature 127) "portfolio failure never fails the committed ingest" (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`) — any agent hook stays best-effort.
- **EXTEND** `@AC-5` (agent, feature 127) docstring + `docs/runbooks/mcp-tools.md` document the watchlist side effect — update both if agent behavior/docs change.
- **PRESERVE** `@AC-6`/`@AC-7`/`@AC-8` (agent, feature 148) system-list delete refused; `manage_watchlist_symbols` add = MANUAL; remove works (`…/mcp-watchlist-tools.feature`) — cleanup keys on `source=SIGNAL` only.
- **PRESERVE** `@AC-8` (UI, feature 127) provenance badge on SIGNAL only (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — mixed SIGNAL/MANUAL on one list stays supported.
- **PRESERVE** `@AC-9` (ingest, feature 224) signals belong to the source owner, dedup per owner (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — signal rows are not deleted/hidden.
- **PRESERVE** `@AC-4` (ingest, feature 166) dedup per (source, symbol, direction); **PRESERVE** `@AC-2` (ingest, feature 173) stored `dedup_window_hours=0` honoured — any new key follows the same rule.
- **PRESERVE** analysis `@AC-8`/`@AC-9` (feature 190) expiry sort; `@AC-8`/`@AC-10` (feature 260) fundsignal `valid_until` anchoring is load-bearing for ingest dedup — do not change how it is computed/persisted. Opportunities are untouched under the refuted-premise verdict above.
- No existing ingest suite covers signal expiry / `valid_until` retention (blind spot: several suites scanned by tag/title only).

## Dependencies

- Proto/RPC: `packages/proto/portfolio/v1/portfolio.proto` — `WatchlistBinding` fields `symbol=1, strategy_id=2?, source=3` (`:243-249`), `Watchlist.system_managed=9`, `EnsureSignalWatchlistRequest {}` (`:347`), `ListAllWatchlistSymbolsResponse.symbols=1` (`:354-357`); `ExternalSignal.valid_until=6`, `user_id=11` and `QuerySignalsRequest.active_window=4, owner_user_id=7` (`ingest.proto:123-154`). Whether a new field/RPC is needed is a design fork (below). Existing field numbers must be re-verified free at /sdd-spec.
- Migration: portfolio next `018`; ingest next `015`; analysis none expected.
- Config keys: none exist for expiry/retention (`ingest.signals.dedup_window_hours` is the only `ingest.signals.*`; no `portfolio.watchlist.*` expiry key). New keys would be `portfolio.watchlist.*` (or ingest) + a seed migration in `xstockstrat-config`.
- Inter-service edges: today **none** between portfolio↔ingest in either direction. Dependency graph (root `CLAUDE.md`) lists no such edge → adding one is a Platform Lead gate. Existing edges that could carry the work: agent→ingest, agent→portfolio, analysis→ingest (`analysis-system-read`), analysis→portfolio (`ListWatchlists`, `ListAllWatchlistSymbols`).
- New env vars: any new `INGEST_ENDPOINT` on portfolio would be absent from portfolio's `Config` (`config.go:20-29`) and must be added to `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml` (agent's `PORTFOLIO_ENDPOINT` row is confirmed only in compose `:565`; which of the 4 `.do` entries is the agent's was not mapped).

## Risks / Not-found

- **R1 — No entry↔signal link (the central fork).** Pruning needs "is any signal for (user, symbol) still live?". Portfolio does not know; ingest knows but cannot reach portfolio. Candidate shapes (design must choose): (a) stamp `valid_until` onto the entry at add time (new column + proto field + the add call carrying it) and prune in portfolio by timestamp; (b) a periodic sweeper in a service that already has both clients (analysis) querying ingest as `system` and calling a portfolio removal RPC; (c) lazy prune on read; (d) new portfolio→ingest edge. Each has different proto/DB/Platform-Lead gates.
- **R2 — Multiple signals per (user, symbol).** Dedup inserts a new row on changed `valid_until`/conviction (`servicer.py:1057-1084`); the claims table holds only the latest submission, so "max live `valid_until`" cannot come from claims — must fold over `newsletter_signals` rows; no `(user_id, symbol, valid_until)` index exists. A re-ingest with a later `valid_until` must **extend** an entry's life, but the agent add path is skipped when `deduplicated=true`, and the add itself is first-writer-wins (`ON CONFLICT DO NOTHING`), so a stamped `valid_until` would never be refreshed unless the design adds an upsert/extend.
- **R3 — Which signals count.** An entry exists because of a `direction="watchlist"` signal; a later `buy`/`sell` signal on the same symbol is live but did not create the entry. FR-2/FR-3 say "every signal for that (user, symbol)" — direction filter unspecified. **Open product decision.**
- **R4 — Open-ended signals** (`valid_until` NULL/absent/`seconds<=0`: `servicer.py:1019-1022`) → never expire (AC-4). Past `valid_until` at add time: the agent adds anyway today (`tools.py:686-696` never reads it) → entry born already expired; prune must not flap (remove then re-add).
- **R5 — Entries not created by the agent path.** Only the agent tool adds SIGNAL rows (`client.py:319-327`); ingest never calls portfolio for `direction="watchlist"` (e.g. via `mcp_client` source ingest at `app/engine/mcp_client_loop.py`) so such signals never create entries — out of scope here, but means the signal↔entry relation is incomplete by construction.
- **R6 — Source integrity.** `normalizeBindings` lets any caller set `source=SIGNAL` on any list (`portfolio_service.go:1822`); `RemoveWatchlistSymbols` and replace-all `UpdateWatchlist` have no source/system guard; the agent's `manage_watchlist` symbols-replace re-stamps SIGNAL rows as MANUAL (`tools.py:2073-2074`, `client.py:343-364`) — a user edit can silently convert a SIGNAL entry to MANUAL, making it immune to pruning. Whether to protect that is a design question; behavior of `_watchlist_bindings_pb`/`update_watchlist` (`client.py:431`) on `source` was **not verified**.
- **R7 — Cross-user sweep authz.** A sweeper touching all users' system lists is a cross-user write; the only precedent gate is `ListAllWatchlistSymbols` (`@AC-2 feature-154`). Background goroutines send no `x-user-id`/`x-internal-caller` unless set explicitly (`propagation.go:39-48`). C-03 header propagation + Recorded-exception pattern (feature 224 `system` identity + SAN) applies.
- **R8 — Multi-instance safety.** Portfolio/agent may run >1 instance; pruning is idempotent (`DELETE` is naturally safe) but a loop on N instances multiplies load. No advisory locks via PgBouncer (portfolio is pooled `:25061`; session locks unusable). Ledger-stream consumers are the existing precedent for background work in portfolio.
- **R9 — Racy cap check.** `AddWatchlistSymbols` cap check is read-then-write outside the tx (`portfolio_service.go:2171-2184`); pruning frees slots under `portfolio.watchlist.max_per_user` / `max_symbols_per_list`.
- **R10 — Surface staleness.** UI refetches only on refocus/remount/mutation (5s `staleTime`, no interval): a server prune is visible late; a user viewing the list may then act on a removed row → `RemoveWatchlistSymbols` on an absent symbol must stay a no-op (it is).
- **R11 — UI badge colors.** `SignalSourceBadge`'s `info` variant uses raw `bg-blue-500/20 text-blue-400` (`badge.tsx:26`) — C-17 deviation backlog; do not extend it if the UI is touched.
- **Ledger traps applied (`fails.md`):** 2026-08-26 `consolidate-watchlist-signal` — verify the producer path reaches the code (done: R5) and extend every `normalizeBindings`-style normalizer if a field is added to `WatchlistBinding` (`normalizeBindings :1807`, `requestBindings :1830`, `applyDefaultStrategy :1847`, `bindingsByWatchlist`/`scanWatchlist` selects only `symbol, strategy_id, source`); symbol-key normalization at construction, never per read site (symbols uppercased/trimmed at `normalizeBindings`; ingest stores symbol as supplied — a case mismatch between ingest rows and watchlist keys would silently no-op a prune); 2026-08-16 `signal-time-decay` — capture `now` after awaits.
- **Not found:** any expiry/TTL/prune/sweep/retention config key in portfolio, ingest or analysis; any portfolio→ingest client or `INGEST_ENDPOINT`; any aggregate/max-`valid_until` or "live at T" RPC in ingest (only `QuerySignals`); any e2e fixture with an expired `validUntil`; any test of past/absent `valid_until` on the agent auto-add; mapping of the agent's `PORTFOLIO_ENDPOINT` row in `.do/app*.yaml`; whether the ingest `QuerySignals` symbol filter is case-normalized (not checked).
- **Blind spots:** per-service `docs/` constitutions (`services/*/docs/context-constitution.md`) and `docs/context-constitution.md` were not read by discovery (ingest's line 24 on `QuerySignals` producer semantics specifically skipped); `scenario-recon` scanned several suites by tag/title only.

## Recommended Scope

Advisory only — final shape depends on the R1 fork resolved in Phase 1:
1. **Decide link + trigger (design):** how a SIGNAL entry learns/expires from its signal(s), and which service runs the prune (R1/R3/R7/R8).
2. **portfolio:** idempotent SIGNAL-only removal path (+ migration `018` and proto field iff an expiry stamp is chosen; update every normalizer on the binding write path), owner/internal-caller gating, config keys, tests per `acceptance.feature`.
3. **agent:** pass the validity through the auto-add (and extend-on-renewal if chosen); update `ingest_signal` docstring + `docs/runbooks/mcp-tools.md` (EXTEND `@AC-5`); tool count unchanged unless a tool is added.
4. **ingest / analysis:** only if option (b)/(d) is chosen (index `015` / system-read grant / loop); otherwise untouched.
5. **ui:** likely no code change (list simply shrinks); decide whether a "removed because expired" cue is wanted; any new fixture goes through `e2e/fixtures/INVENTORY.md` (C-12).
6. **docs/CLAUDE.md:** service `CLAUDE.md` config-key tables, `docs/patterns/config-governance.md` registered-keys log, root dependency graph if a new edge is added.
