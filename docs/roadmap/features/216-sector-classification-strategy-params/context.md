# Context: sector-classification-strategy-params

**Feature**: `docs/roadmap/features/216-sector-classification-strategy-params/feature.md`
**Product Spec**: `docs/roadmap/features/216-sector-classification-strategy-params/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/216-sector-classification-strategy-params/implementation-spec.md`

---

## Session 2026-09-27 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.

### Locked design decisions (user davcs86, pre-story conversation)

1. **Provider = FMP** (GICS-flavored sector). Chosen over EDGAR/Fama-French and Finnhub for smallest
   integration surface (FMP already wired). User additionally mandated: **centralize** all FMP access
   in `xstockstrat-marketdata` behind a **rate-limited token-bucket gateway** so the FMP rate limit is
   always honored under concurrency; ceiling config-tunable for the paid **starter tier** the user is
   considering.
2. **Storage = Type-2 SCD** cache in marketdata (`symbol_classification`). Rationale: the caching
   decision and the point-in-time decision are the *same* decision — a Type-1 overwrite cache silently
   destroys the reclassification history a PIT backtest needs and cannot be reconstructed. Type-2 costs
   marginally more now and accrues PIT history as a side effect. Never call FMP on the read path;
   scheduled refresh diffs and versions-on-change only. Cold local copy is also the fault-tolerance
   win (FMP outage → stale, never unavailable).
3. **Granularity = sector only** (~11 GICS). Modeled as a closed proto enum with
   `SECTOR_UNSPECIFIED = 0`. Unknown sector → mandatory default parameter bucket; engine never fails.
4. **Point-in-time = FULL PIT in v1.** analysis joins sector as-of each evaluated bar; no current-day
   sector for historical bars. Known constraint: Type-2 history accrues forward from go-live; pre-go-live
   bars resolve via the default bucket (external PIT seeding deferred).
5. **Per-sector params stored in the strategy definition** (per-strategy user data → strategy DB via
   `manage_strategy`/proto), NOT the config service. A declared subset of formula params is
   sector-overridable with a mandatory default fallback.

### Prior-context findings (why this feature exists)

- Alpaca `/v2/assets` returns only symbol/exchange/class — no sector. `ListAssets` maps only
  symbol/exchange/asset_class into `common.v1.Asset`.
- `common.v1.Asset` and the `Fundamentals` message carry no sector field. `portfolio.proto` comments
  "marketdata exposes no sector".
- FMP (`internal/fmp/`) and Finnhub (`internal/finnhub/`) clients exist but extract no sector field
  today.

### Known traps surfaced from the Ledger (design/spec must address)

- `fails.md:1852-1868` — look-ahead RED test on ragged calendars passes while a real mid-series
  look-ahead ships. → AC-7 tests a mid-series reclassification, not endpoints.
- `fails.md:81-82, 309-310, 1151` — new proto enum/field hard-couples to shared consumers in the same
  PR: UI exhaustive `Record<Enum,…>` maps + agent descriptor-parity projection tests.
- `fails.md:1038-1043, 1097, 1123` — FMP wiring scattered; `grep -rn` all FMP sites before
  centralizing or the gateway becomes a parallel path.
- `fails.md:1566-1568` (features 076/147) — FMP key is an encrypted config secret via `GetSecret`;
  never re-introduce `FMP_API_KEY` env var.
- `fails.md:726-728` — proto field is `Bar.time`, not `Bar.timestamp`; use real `Bar` fixtures, not
  `MagicMock`.

### Open forks (see product-spec Open Questions)

- One feature vs. split into classification-store + per-sector-params (B depends on A's FR-5).
- UI strategy-editor authoring surface existence (C-14).
- Strategy-storage owning service (for FR-6 migration).

## Session 2026-09-27 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS (spec-reviewer) + overlap CLEAN (feature-overlap). No blockers, no Floor breaches.
- Warnings (all deferred to design/spec, none blocking):
  - Migration mechanics detail (C-07) — firmed at /sdd-spec; SCD migration is next-free `007` in marketdata/migrations.
  - Open-Questions checkbox structure — resolved: known-traps moved under a non-checkbox "Design Guidance / Known Traps" heading; storage-owner marked deferred-to-recon.
  - Config reuse (C-18) — reconcile new `marketdata.fmp.rate_limit_rps` (per-second) with existing `marketdata.fmp.daily_request_cap` (per-day) at design so the FMP gateway has one coherent throttle.
- Overlap findings: none. Confirmed next-free slots — StrategyDefinition per-sector map field = 15; marketdata SCD migration = 007. Soft shared-surface overlap with feature 215 (analysis.proto, agent manage_strategy/run_backtest, UI /insights) is rebase-only, not a resource clash.
- Naming note: `marketdata.<source>.rate_limit_rps` pattern already used by `marketdata.backfill.*` and `marketdata.edgar.*` — the new FMP key fits the established convention.
