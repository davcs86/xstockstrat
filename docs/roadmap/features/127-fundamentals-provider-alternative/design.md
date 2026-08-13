# Design: fundamentals-provider-alternative

**Created**: 2026-08-13
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-08-13
**Grounded in**: recon.md

---

## Chosen Approach

**Provider: Finnhub.** Verified this session against each candidate's live, current API docs
(product-spec FR-1/AC-1 — full citations recorded in `context.md` § sdd-design session):
Twelve Data's free/Basic tier explicitly excludes all fundamentals — its `/statistics` endpoint
(P/E, P/B, ROE, D/E, dividend yield, beta) requires the paid Pro/Venture plan, and the free
`/quote` endpoint carries no valuation fields at all — so it fails FR-2's "full coverage of the
required fields on the free tier" bar outright, independent of its 800/day call budget. Finnhub's
free tier (`/stock/metric`) is confirmed free-accessible and returns P/E, P/B, 52w-high/low, EPS,
ROE, D/E, beta, and market cap in one response, at ~60 calls/minute with no daily cap and no
FMP-style small-symbol-universe restriction — a materially different bottleneck shape than FMP's
250/day + per-symbol-throttled `ratios-ttm`/`profile` (the product-spec Problem Statement).

**New client**: `internal/finnhub/finnhub_client.go`, mirroring `internal/fmp/fmp_client.go:21-250`
symbol-for-symbol (`recon.md` § Patterns to REUSE) — `ClientConfig{BaseURL, APIKey, HTTPClient}`,
`NewClient`, `GetFundamentals` delegating to `GetFundamentalsMulti`, a `getJSON` HTTP-plumbing
helper (API key never logged, never in error strings — mirrors `fmp_client.go:121-148`), and
per-endpoint fetchers against `/stock/metric`, `/quote`, `/stock/profile2` feeding response-struct
`apply()`/`toFundamentals()` mappers into the **unchanged** `source.Fundamentals` struct
(`internal/source/source.go:34-51`). Implements `source.FundamentalsSource`
(`source.go:57-60`); **never** registered in `source.Registry` (`source.go:64-91`) — same
non-registration invariant FMP follows (`cmd/server/main.go:104-112`).

**Provider selection stays switchable, not a full replacement (revised from the proposer's initial
"full replacement" — see Rejected Alternatives).** Add `marketdata.fundamentals.provider` (string,
default `finnhub` once implemented) alongside the existing `internal/fmp/` client; `main.go`'s
`newFundamentalsSource` dispatches on this key instead of hardcoding FMP. FMP is **not** deleted in
this feature — removal is an explicitly named fast-follow step, gated on product-spec AC-3's live
smoke test confirming (a) Finnhub's `/stock/metric` genuinely returns a dividend-yield field (an
open gap — not independently confirmed against a rendered live doc page this session, see Open
Risks) and (b) the endpoints' actual per-symbol-vs-batch call shape (also unconfirmed this
session). Reason this is safer than committing to replacement now: an unconfirmed required-field
gap (FR-1's dividend-yield field) is exactly the kind of finding FR-6 already reserves as grounds
to keep both providers, and Finnhub's fundamentals config keys are additive alongside FMP's
existing `marketdata.fmp.*` keys — no schema conflict, no wasted work if the smoke test forces a
provider swap-back.

**Quota guard**: FMP's guard is daily-cap-shaped (`CountFundamentalsFetchedToday`,
`marketdata_service.go:888-899,936-946`) — Finnhub's real limit is per-minute, not per-day
(`recon.md` § Patterns to REUSE, known-trap callout), so the guard needs a shape change for
Finnhub's path: a new sibling repo method `CountFundamentalsFetchedSince(ctx, since time.Time)`
(reuses the existing `fetched_at` column — `recon.md` confirms no schema gap), called with
`since = now - rateWindow`. At-cap behavior (stale-serve if cached, else `ResourceExhausted`) and
the 80%-of-cap WARNING dedup (`maybeAlertQuota`/`emitWarning`, `marketdata_service.go:974-1002`)
keep their branch structure, but the WARNING dedup key moves from a UTC-date string to a
window-bucket (`floor(now/rateWindow)`) so it re-fires appropriately on a 60s-resetting limit
instead of firing once and going silent for the rest of the day. The **exact** numeric cap
(`requests_per_minute` / `symbols_per_minute`) is **deliberately not fixed here** — it depends on
whether Finnhub's fundamentals endpoints batch across symbols (unconfirmed this session; the
proposer's own "~20" derivation assumed a 3-calls-per-symbol, no-batching shape that needs
re-verification). `/sdd-spec` must re-confirm this against Finnhub's live docs (or a smoke test)
before the seed migration is written, and the config key name must make the unit explicit
(`marketdata.finnhub.symbols_per_minute`, not a raw-call-count name) so a future reader doesn't
assume it caps HTTP calls 1:1.

**Mandatory scope correction** (the adversary's load-bearing finding): renaming the provider is
**not** just adding a new client — every literal `"marketdata.fmp.*"` config-key string and every
"FMP"/"fmp" string in `xstockstrat-marketdata` must be touched in the same feature or fundamentals
silently stays disabled / actively misleads readers:
- Config-key literals to generalize (read live per-call today, all in
  `marketdata_service.go:866,888,927,936,966`) — these become provider-dispatched reads (via the
  new `marketdata.fundamentals.provider` selector), not a blind rename, since FMP stays reachable.
- `fundamentalsEnabled()`'s error text `"fmp fundamentals source disabled"` (`:967`) — must become
  provider-agnostic or provider-specific per the active selection.
- `emitWarning`'s alert title `"marketdata FMP quota warning"` and body `"FMP daily request usage
  at..."` (`:986,995`) — must name the actual active provider, not hardcode FMP.
- Comments at `:960-964,972-973,989` and `cmd/server/main.go:175-178` naming FMP specifically.
- The 3 proto doc-comments (`packages/proto/marketdata/v1/marketdata.proto:160,174,178` —
  `"FMP-backed"`, `source // "fmp"`, `"FMP's open-ended metric set"`) — text-only edit, no
  field/message/RPC shape change, still goes through `buf lint`/`buf breaking`/`buf-gen.sh`.

**Consumer surface (C-14)**: unchanged from product-spec — internal/platform-only. The
`GetFundamentals`/`GetFundamentalsMulti` RPC contracts do not change shape; `xstockstrat-analysis`
(screener, fundamentals-signal producer) continues to read only through them (product-spec FR-7).
No UI or Agent-tool surface is touched by this design.

**Config keys** (`xstockstrat-config` migration `015_marketdata_finnhub.up/down.sql` — reuses the
exact seed pattern of `migrations/007_marketdata_fmp.up.sql:1-64`, dev+production rows,
`ON CONFLICT DO NOTHING`; re-verify `015` is still the next-free number immediately before
`/sdd-spec` writes it, per the 2026-08-06 migration-collision ledger trap):
`marketdata.finnhub.enabled` (bool, default `false`), `.base_url` (string), `.cache_ttl_hours`
(int, default `24`), `.symbols_per_minute` (int — value TBD at `/sdd-spec`, see Quota guard above),
`.rate_window_seconds` (int, default `60`), and `marketdata.fundamentals.provider` (string,
default `finnhub`). No `marketdata.finnhub.metrics` tiering key — Finnhub has no core/extended
split like FMP's `ratios-ttm`/`profile` throttling. API credential: `FINNHUB_API_KEY` env var,
never a config key (`recon.md` § Patterns to REUSE — feature 076 / migration 009 precedent).

## Rejected Alternatives

- **Full replacement of FMP in this feature** (the proposer's initial framing) — rejected because
  the dividend-yield field (a required FR-1 field) and the per-symbol-vs-batch call shape are both
  unconfirmed against Finnhub's live docs this session; deleting `internal/fmp/` and dropping
  `marketdata.fmp.*` config rows before AC-3's live smoke test closes those gaps risks shipping a
  provider that can't actually satisfy FR-1/FR-2, with no fallback and an unfixable-in-place
  migration (F-01) already applied. Switchable-with-a-named-fast-follow-removal captures the same
  end state at negligible extra cost (one selector config key) with a real rollback path.
- **Baking a specific `requests_per_minute≈20` default into the seed migration now** — rejected
  because it's a derived number entirely dependent on an unverified assumption (3 calls/symbol,
  no batching); wrong in either direction (too conservative throttles the very throughput gain
  this feature exists to deliver; too loose risks live 429s), and F-01 means a wrong migrated
  default can only be corrected by a *new* migration, not edited in place. Deferred to `/sdd-spec`,
  which is explicitly permitted fresh discovery to fill in a verified number before the migration
  is written.
- **Reusing the existing UTC-day counter unchanged, just resized down for Finnhub's per-minute
  limit** — considered (raised by the adversary as a lower-churn alternative to the rolling-window
  redesign: zero interface/method changes, all 8 existing quota-guard tests keep passing
  unmodified) but rejected because a day-bucketed counter cannot actually protect against a
  per-minute ceiling during a burst — a 200-symbol screening pass could 429 well under a
  conservative daily total. It only partially solves the throughput problem this feature exists to
  fix, so the rolling-window shape is kept despite its larger surface.
- **Twelve Data as the provider** — rejected outright at the proposer stage: its free/Basic tier
  excludes fundamentals data categorically (confirmed via `twelvedata.com/docs#statistics` — the
  ratios endpoint requires Pro/Venture), so it cannot meet FR-2 regardless of its generous 800/day
  call budget. No further debate needed on this option.

## Open Risks

- [ ] **Dividend-yield field existence on Finnhub's `/stock/metric` free-tier response is
  unconfirmed** — Finnhub's own docs.finnhub.io is a JS SPA that did not render for this session's
  research tooling; secondary sources (robotwealth.com, IBKR Campus, apicostcalc.com) confirmed
  PE/PB/52w-high-low/EPS/ROE/D-to-E/beta/market-cap but not dividend yield specifically. Must be
  closed by product-spec AC-3's live smoke test **before** the FMP-removal fast-follow step is
  scheduled — to be addressed in the `/sdd-spec` step that implements the smoke test.
- [ ] **Per-symbol-vs-batch call shape for `/stock/metric`/`/quote`/`/stock/profile2` is
  unconfirmed** — the quota-guard's exact numeric cap and the client's `GetFundamentalsMulti`
  batching strategy both depend on this. Must be verified against Finnhub's live docs (or the same
  smoke test) at `/sdd-spec` time, before the client is written and before `015_marketdata_finnhub`
  is finalized with a real `symbols_per_minute` value.
- [ ] **Partial-symbol-fetch quota drain**: if 2 of 3 per-symbol endpoint calls succeed but the
  third fails (so no cache row is upserted), the local `CountFundamentalsFetchedSince` counter
  never recorded those calls, but real Finnhub quota was still consumed. Accepted as an open risk,
  not blocking this design — to be addressed (or explicitly re-accepted) at `/sdd-spec` or in a
  follow-up if it proves material after launch.
- [ ] **`015` migration-number reservation** — re-verify `services/xstockstrat-config/migrations/`
  still tops out at `014` immediately before `/sdd-spec` writes `015_marketdata_finnhub`, per the
  2026-08-06 `fundamentals-signal-producer` ledger entry on concurrent-feature migration collisions.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited) — honored by: every claim above cites `recon.md`
  `path:line` or the session's live-docs research (recorded in `context.md`); the two genuinely
  unverified facts (dividend yield, call shape) are recorded as **Open Risks** with a mandated
  closing step (`/sdd-spec`'s live-docs re-verification + AC-3 smoke test), not silently assumed
  into the shipped design.
- `C-05` (config key naming) — honored by: all new keys follow `marketdata.finnhub.*` /
  `marketdata.fundamentals.provider`, matching `<service>.<category>.<key>`.
- `C-10(b)` (every read path stays consistent) — honored by: the `GetFundamentals`/
  `GetFundamentalsMulti` RPC handlers remain the single read path regardless of which provider is
  active; no second path bypasses the provider-dispatch/cache/quota-guard logic.
- `C-14` (name the consumer surface) — honored by: product-spec's "None — internal/platform-only"
  stands; no UI/Agent surface is introduced or changed by this design.
- `F-01` (never edit an applied migration) — honored by: the numeric `symbols_per_minute` default
  is explicitly deferred out of this design and into `/sdd-spec`'s pre-migration verification step,
  precisely to avoid writing a wrong default into a migration that can't be edited afterward.
- `F-04` (never invent a path/symbol) — honored by: `internal/finnhub/` does not exist yet and is
  named as new work, not invented as already-present; every reused symbol (`source.Fundamentals`,
  `source.FundamentalsSource`, `CountFundamentalsFetchedToday`, etc.) is cited to its real
  `recon.md`-verified location.
- `F-11` (Floor rejection halts) — N/A this round: the adversary found no Floor breach.
