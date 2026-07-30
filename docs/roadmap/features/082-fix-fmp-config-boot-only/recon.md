# Recon: fix-fmp-config-boot-only

**Created**: 2026-07-30
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata

---

## Objective

`xstockstrat-marketdata` reads `marketdata.fmp.enabled` exactly once at process boot to decide
whether to construct the FMP fundamentals client at all; a live flip via `set_config` afterward is
invisible to the running process, so `GetFundamentals`/`GetFundamentalsMulti`/`screen_symbols`
silently stay disabled until a restart. Fix it so the flag behaves like every other
config-driven flag on the platform — live, no restart — without regressing the existing
cache/TTL/quota-guard behavior.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point / boot-only gate: `services/xstockstrat-marketdata/cmd/server/main.go:111`
    (`if cfgWatcher.GetBool("marketdata.fmp.enabled", false) { ... }`), client built at `:112-119`
    (`fmp.NewClient(fmp.ClientConfig{...})`), passed into the service constructor at `:123`.
  - `cfgWatcher` construction: `cmd/server/main.go:52` (`config.NewWatcher(cfg.ConfigEndpoint,
    "marketdata")`), type `*config.Watcher` (`internal/config/config.go:58`).
  - Handler/servicer: `internal/service/marketdata_service.go` —
    `fundamentalsEnabled()` `:957-964`, callers `GetFundamentals` `:844-856` (calls it `:848`),
    `GetFundamentalsMulti` `:860-920` (calls it `:861`).
  - Constructor: `NewMarketDataService(registry, repo, cfgWatcher, ledgerEndpoint,
    notifyEndpoint, fundamentals source.FundamentalsSource) (*MarketDataService, error)` —
    `marketdata_service.go:76-83`. `s.fundamentals` field (`source.FundamentalsSource`) —
    `:50`, set once at `:101`, never reassigned elsewhere (confirmed by full-file grep).
    `s.fundCfg` field (`fundamentalsConfig` interface: `GetBool`/`GetInt`/`GetString`) —
    `:61-65`, set to the same `*config.Watcher` at `:102`.
  - Last migration: `003_canonicalize_ohlcv_timeframe.up.sql`
    (`services/xstockstrat-marketdata/migrations/`) — no new migration needed (config-only fix).
  - Config-read pattern (the correct, already-live half): `fundamentalsEnabled()` calls
    `s.fundCfg.GetBool("marketdata.fmp.enabled", false)` fresh on every RPC —
    `marketdata_service.go:960`. The bug is that `s.fundamentals` (the client), not the flag read,
    is frozen at construction time.
  - FMP client: `NewClient(cfg ClientConfig) *Client` — `internal/fmp/fmp_client.go:41-58`;
    `ClientConfig{BaseURL, APIKey, Metrics, HTTPClient}` — `:21-30`; `Client{baseURL, apiKey,
    extended, http}` — `:33-38`.

## Patterns to REUSE

- **Live config read, not push/callback** → reuse the exact pattern already at
  `marketdata_service.go:960` (`s.fundCfg.GetBool(...)` on every call) — this is how every other
  live-toggle flag on this service already works (no watcher-side `Subscribe`/`OnChange` API exists
  to reuse instead — confirmed absent, see Risks).
- **Poll-every-cycle precedent for a related loop** → the warm-quote/bar-ingest pollers
  (`marketdata.stream.warm_interval_ms`, `marketdata.stream.bar_ingest_interval_ms` —
  `services/xstockstrat-marketdata/CLAUDE.md:59-60`) re-read their config fresh every loop
  iteration rather than once at boot — same shape this fix needs to extend to the FMP client.
- **Test-double pattern** → `fakeCfg` (implements `fundamentalsConfig`) —
  `marketdata_service_test.go:229-246`, `enabledCfg()` helper `:260-265`; `fakeFundSource`/
  `fakeFundRepo` doubles `:168-226`; `newFundSvc(cfg, repo, src, notify)` bare-struct constructor
  `:267-269`. Reuse all of these for the new live-toggle test rather than inventing a new harness.
- **Existing acceptance-shape template** → `TestGetFundamentals_DisabledFailedPrecondition`
  (`:326-339`) already asserts a disabled flag makes zero FMP calls (`src.calls`) — the new
  live-toggle test should follow the same call-count-assertion shape (flip flag, assert a call
  attempt where before there was none; flip back, assert no further calls).
- **Client is cheap to construct** → `fmp.NewClient` builds a stateless struct (no rate limiter, no
  cache, no persistent connection beyond a plain `*http.Client`, nil `HTTPClient` defaults to a
  fresh 30s-timeout client — `fmp_client.go:33-45`) — safe to (re)build lazily on a live flip
  without a perf concern.

## Dependencies

- Proto/RPC: none — no message/field changes.
- Migration: none — config-only fix, no schema change.
- Config keys: `marketdata.fmp.enabled` (existing key, no shape/name change — fixes how it's read).
- Inter-service edges: none new — `xstockstrat-analysis` remains a consumer of
  `GetFundamentals`/`GetFundamentalsMulti` via gRPC, unchanged by this fix.
- New env vars / ports: none.

## Risks / Not-found

- **Not found**: any `Subscribe`/`OnChange`/`Watch`-callback method on `*config.Watcher` or any
  other push-based config-reaction mechanism anywhere in this service — confirmed absent by full
  grep. `Watcher` (`internal/config/config.go:58-68`) only exposes poll-style getters
  (`GetString`/`GetInt`/`GetFloat`/`GetBool`, `:100-153`) over a mutex-guarded snapshot map updated
  by a background stream loop (`:180-197`); nothing observes a snapshot write except the next
  poller. **This settles the central design question the product-spec's context.md flagged**
  ("poll the watcher on every call vs. register a callback that rebuilds the client") — no callback
  mechanism exists to register with, so the only reuse-consistent option is poll-on-every-call,
  matching the pattern already used by `fundamentalsEnabled()` itself.
- **Not found**: any existing test exercising `main.go`'s FMP client-construction/wiring block —
  only `looksLikePlaceholderCred` is tested there (`main_test.go`). That block isn't extracted into
  a testable function today, which is relevant if the design moves construction out of `main.go`.
- `TestGetFundamentals_NilSourceFailedPrecondition` (`marketdata_service_test.go:379-385`) currently
  **pins today's buggy behavior** (nil `s.fundamentals` forever → `FailedPrecondition`) as the
  expected outcome — this test will need to change shape once the fix makes `fundamentals`
  reconstructible/lazily-resolved, or it will contradict the new behavior.
- `fails.md` 2026-07-29 (081) / 2026-07-27 (072) trap — "a demonstration is not a producer
  contract": confirmed the config watcher's *actual* interface via direct grep of
  `internal/config/config.go` rather than assuming a push mechanism exists because one "should."
- `fails.md` 2026-07-26 (071) trap — "a guard that cannot fail is not a guard": if the fix keeps
  `s.fundamentals` as a fixed field but only changes when it's read, the acceptance test must prove
  the *disabled → enabled* transition actually fires an FMP call on the very next request, not just
  that the code compiles.

## Recommended Scope

Advisory only — not binding:

1. **Service step** (`xstockstrat-marketdata`): move the FMP-client existence check out of
   `main.go`'s one-shot boot gate and into a live-checked path — either (a) always construct the
   `fmp.Client` at boot (it's cheap/stateless per Patterns to REUSE) and gate its *use* purely on
   the existing live `fundamentalsEnabled()` flag read, removing the `s.fundamentals == nil` half
   of the condition's dependency on boot-time config; or (b) lazily construct the client on first
   need inside `fundamentalsEnabled()`/`resolveFundamentals` when the flag is live-true and no
   client yet exists. Either shape keeps the reused live-poll pattern; the grilling debate should
   pick between them.
2. **Test step** (paired, same service): extend `marketdata_service_test.go` using the existing
   `fakeCfg`/`fakeFundSource` doubles — new test proves start-disabled → flip live via a mutable
   fake config → next call attempts an FMP fetch (no restart in the test), then flip back →
   short-circuits again. Update/replace `TestGetFundamentals_NilSourceFailedPrecondition` to match
   the new contract instead of pinning the old one.
3. No proto, migration, or env-var steps needed.
