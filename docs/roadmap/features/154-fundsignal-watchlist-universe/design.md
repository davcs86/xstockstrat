# Design: fundsignal-watchlist-universe (feature 154)

**Status:** design-approved (operator gate passed 2026-08-24 after a **4-round** full-mode debate).
**Mode:** full. Rounds: R1 (authz mechanism), R2 (Go internal-caller port + metadata/tests), R3 (truncation fairness / grant shape / DISTINCT perf), R4 (operator directive: FMP-gated truncation).

---

## Chosen Approach

Two coordinated changes on the existing analysis→portfolio read edge, no proto breaking change, no
migration, no new config key.

### 1. Portfolio — additive cross-user enumeration RPC (internal-caller gated)
- **Proto** (`packages/proto/portfolio/v1/portfolio.proto`, after :29): additive
  `rpc ListAllWatchlistSymbols(ListAllWatchlistSymbolsRequest) returns (ListAllWatchlistSymbolsResponse)`;
  empty request message; response `repeated string symbols = 1`. Additive → `buf breaking` clean.
- **Repo**: `WatchlistStore.ListAllSymbols(ctx) → SELECT DISTINCT symbol FROM portfolio.watchlist_symbols ORDER BY symbol`
  (no join, no migration; DISTINCT collapses `(symbol,strategy)` bindings to bare symbols).
- **Authz** — portfolio's first gate, new `internal/service/authz.go`:
  - `const HeaderInternalCaller = "x-internal-caller"` (matches config's header).
  - Hardcoded allow-list `[]internalCallerGrant{{callerID:"analysis-fundsignal", rpc:"ListAllWatchlistSymbols"}}`
    (the `{callerID, rpc}` shape mirrors config's least-privilege precedent — deliberately **not** bare-callerID).
  - `hasInternalCallerAuthority(ctx, rpc)` reads the header via **`metadata.FromIncomingContext(ctx)`**
    (NOT `connect.Request.Header()` — the grpc adapter's `connect.NewRequest(req)` fabricates empty
    headers). **Fail-closed**: absent md / absent header / >1 value not matching / unlisted callerID /
    wrong rpc → `PermissionDenied`. The gate **ignores** the admin `x-access-scope` bit (a caller with
    only the admin bit is correctly denied — AC-2).

### 2. Analysis — `_resolve_universe` rewrite + FMP-gated truncation
- **`_resolve_universe`** (`fundsignal_loop.py:203-218` rewrite): `explicit` unchanged; `watchlists` =
  the RPC union; `both` = RPC union ∪ explicit CSV. Wrap the RPC in `try/except → log.warning`,
  degrading to an empty union (or explicit CSV for `both`) on any portfolio error — never crashing the
  cycle. **Metadata: append, don't replace** — `meta = list(metadata) + [("x-internal-caller","analysis-fundsignal")]`.
  One impl serves both paths: the loop path (`metadata=()`) yields internal-caller-only; the manual
  `RunFundamentalsScan` path preserves the caller's `x-trace-id`/`x-user-id` (trace continuity, R2 C-03).
- **FMP-gated truncation** (the operator directive): compute a **boot-frozen** `fmp_active` once and
  branch **only the `max_symbols` truncation** at `run_once:108`:
  - `fmp_active == True` → apply the cap with a **stateless rotating offset** (R3) so no user is
    permanently starved; keep the `daily_call_budget`/`_paced_fetch` deferral as-is.
  - `fmp_active == False` → **no `max_symbols` truncation**; the whole union enters `to_process`. The
    existing paced budget + deferred-resume covers it — for realistic unions that is one cycle
    (200 chunk-calls ≈ 10k symbol-slots); a giant union spills to the next cycle **visibly**
    (`budget_deferred` + WARN + resume), nothing permanently dropped. ("take all symbols" = full
    coverage, R4-approved — NOT `budget=len`, which would delete the deferral/WARN/resume and let
    Finnhub's rate limiter silently drop the tail under a false `completed`.)
  - **No-silent-caps WARN** at the cap site: when `len(union) > max_symbols` (FMP path), `log.warning`
    the dropped count computed from the **full union pre-cap**.
- **Learning `fmp_active`** — a **second, boot-frozen** `ConfigWatcher(namespace="marketdata")`:
  - `main.py`: construct `md_cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="marketdata")`,
    `await md_cfg_watcher.wait_for_snapshot(...)` alongside the existing analysis watcher (:42-43), pass
    it into `FundamentalsSignalLoop` (:142) as a new param.
  - `fmp_active = (md_cfg.get_str("marketdata.fundamentals.provider", "") == "fmp")`. **Empty/unknown →
    `False`-for-provider but the conservative capped path** is selected by treating unknown as
    budget-constrained (`fmp_active or provider_unknown`), so no provider **literal** is baked in (R3
    drift-guard) yet the safe direction (bounded rotating run, never unbounded burst) holds. Boot-frozen
    read mirrors marketdata's own freeze (R4) — an operator switching provider restarts analysis too,
    already mandatory for marketdata, so no new burden and no divergence window.

---

## Acceptance impact
- AC-1..AC-5, AC-7 unchanged; AC-6 (cap applies) is now **conditioned on FMP-active**.
- **New AC-8**: `both` + portfolio outage → resolved universe == explicit CSV; cycle completes; warning logged.
- **New AC-9**: non-FMP active provider → whole cross-user union processed (no `max_symbols` truncation);
  no permanent drop; `budget_deferred`+resume only for a union exceeding one cycle's paced budget.
- Go authz tests (each traced to AC-1/AC-2): authorized `analysis-fundsignal` passes; absent metadata /
  absent header / unlisted callerID / admin-bit-only → denied. New ctx builder injects `x-internal-caller`
  into **incoming** metadata (existing `ctxWithUser` only sets `x-user-id`).

## Rejected alternatives
- **Admin `x-access-scope` bit gate** (R1) — reproduces the feature-092-removed self-asserted-admin
  pattern and contradicts PR #994 (admin ≠ another user's per-user data). Operator chose `x-internal-caller`.
- **Read `x-internal-caller` via `PropagationData`** (R2) — the client interceptor re-forwards those
  keys outbound (`propagation.go:39-49`); an inbound-only authz assertion must be read directly from
  ctx metadata to avoid outbound leak.
- **Mirror `analysis.fundsignal.*` FMP-active config key** (R4 Option B) — duplicates marketdata's
  provider state into the analysis namespace → drift (fails 2026-08-13) + C-05 sign-off. Rejected for
  the cross-namespace subscription.
- **New marketdata provider/active RPC** (R4 Option C) — not minimal; a proto+RPC for a boolean read.
- **`budget = len(to_process)` for non-FMP** (R4) — deletes deferral/WARN/resume; Finnhub's
  20-symbols/min limit silently drops the tail under a false `completed`. Rejected for FMP-gating only
  the `max_symbols` cap and keeping the deferral machinery.
- **Bare-callerID grant** (R3) — diverges from config's `{callerID, resource}` least-privilege
  precedent; would authorize `analysis-fundsignal` for any future gated portfolio RPC. Kept `{callerID, rpc}`.
- **Server-side `limit` param / `symbol` index** (R3) — overbuild; union is naturally bounded, seq-scan
  is sub-ms, and the fairness bias lives in analysis's truncation, not the wire.
- **Live provider read** (R4) — diverges from marketdata's boot-freeze; chose boot-frozen read.

## Constitution rules touched / governance
- **C-14** consumer surface: internal/platform-only (producer output already reaches users via feature-062 surfaces).
- **PLAT-4/P-01 novel coupling**: analysis gains a **live `WatchConfig` subscription to another
  service's namespace** (`marketdata`) — unprecedented (no service subscribes cross-namespace today;
  the agent reads foreign namespaces via one-shot `GetConfig`, not a stream). **Record** as a
  config-governance note + the new `PORTFOLIO-*` invariant below; do not slip it in silently.
- **New `PORTFOLIO-*` invariant** (`services/xstockstrat-portfolio/docs/context-constitution.md`):
  `ListAllWatchlistSymbols` is the platform's first cross-user enumeration of per-user watchlist data;
  gated by the `x-internal-caller` allow-list (grant `analysis-fundsignal`), **not** the admin
  `x-access-scope` bit (PR #994).
- **C-15/P-06**: every fail-closed authz branch and both provider branches get a RED-first test.

## Open risks carried to /sdd-spec
- Exact gate return type (Connect `CodePermissionDenied` at service layer vs `status.Error(codes.PermissionDenied)`
  at the grpc adapter) — confirm against `portfolio_handler.go` at spec time (mechanism unaffected).
- Duplicate `x-internal-caller` values if the `xstockstrat-ui` edge strip-list doesn't yet strip this
  new header — the gate matches "any value == grant" / rejects >1 mismatched; name it in the impl step.

## C-11 ledger touch
Design-phase insight recorded to `docs/roadmap/ledger/insights.md` (2026-08-24) — the boot-frozen
cross-namespace config read as the correct way for a consumer to mirror a producer's frozen provider
selection without state duplication.
