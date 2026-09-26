# Design: edgar-fundamentals-enrichment

**Created**: 2026-09-26
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-09-26
**Grounded in**: recon.md

---

## Chosen Approach

Make SEC EDGAR the single, PIT-faithful fundamentals source for **both** backtest and live/snapshot
evaluation. All code changes are marketdata-side (recon:16,20) plus one config seed migration and one
UI registry edit; **`xstockstrat-analysis` and `xstockstrat-indicators` need no code change** — analysis
passes marketdata's field values through verbatim (recon:38) and the formula bands are tunable params
(recon:41). Consumer surfaces (C-14): the enriched metrics + reporting currency + `source` reach the
user through `/insights/data-explorer` (`useDataExplorer.ts:39` `FUNDAMENTAL_METRICS`) and the agent
`query_fundamentals` tool (no tool-contract change — values flow through).

**1. Currency capture + unit-aware aggregator (FR-1).** Reshape the EDGAR aggregator
`periodAgg.vals map[string]float64` (edgar_client.go:186), which today discards the XBRL unit key
(:222) and keeps a first-seen value over a nondeterministic Go-map range (:262-263), into a **unit-keyed**
`map[metric]map[unit]float64`. Row `currency` (replacing the hardcoded `"USD"` at :317) = the unit code
covering the most **monetary** facts for the period, **excluding compound per-share units** (`USD/shares`
for EPS) from the count, with a lexical tiebreak. Currency is **pinned to the earliest-filing unit set**
(extending the existing earliest-`filed_date` idempotency pin at :251-254) so a re-backfill can't flip a
stored period's currency; a genuine later-amendment restatement is a documented accepted residual
(manual purge + re-backfill).

**2. Financial-debt D/E (FR-2).** Expand the instant-tag allow-list (edgar_client.go:164-170) with debt
concepts — US-GAAP `LongTermDebtNoncurrent`/`LongTermDebtCurrent`/`DebtCurrent`/`ShortTermBorrowings`
(sum), fallback `DebtLongtermAndShorttermCombinedAmount` then `LongTermDebt`; IFRS/20-F
`ifrs-full:LongtermBorrowings`/`ShorttermBorrowings`/`CurrentPortionOfLongtermBorrowings` (sum), fallback
`ifrs-full:Borrowings`. Compute `debt_to_equity = total_debt/equity` (financial-debt convention),
replacing the `liabilities/equity` line at edgar_client.go:341-346; store `total_debt` in `extra_metrics`.
Exact tag set/fallback order is verified by a **direct SEC companyfacts fetch** at /sdd-spec (BABA 20-F +
AXP financial-sector + one plain US filer), never a deployed `grpcurl` smoke (fails.md 2026-08-13).

**3. Currency-consistent P/B and P/E at the filing boundary (FR-3), option-b.** Extend `priceJoin`
(marketdata_service.go:1630-1668) so `PBRatio = USD market_cap / USD-unit stockholders_equity`
(`stockholders_equity_usd` stashed in `extra_metrics` when the filing dual-reports a USD convenience
translation), else `pb_ratio → missing_metrics` (nil, renders "—", never fabricated). Same rule fixes the
currency-blind `PERatio = close/ttmEPS` at :1664-1667 (USD close / USD-unit EPS, else native EPS when
row currency == USD, else missing). Ratios are dimensionless; `market_cap`/`price` are always the trading
currency (USD); the `currency` column labels only the native absolute facts.

**4. PIT dividend yield via Alpaca corporate-actions (FR-4).** Extend the Alpaca client
(internal/alpaca/client.go:42-44, which today uses dividends only as a bar-adjustment mode) with a
cash-dividend corporate-actions fetch; credentials via the existing **`GetSecret`** path
(`marketdata.alpaca.api_key`/`api_secret`, `x-internal-caller: marketdata`), never an env var (PRESERVE
`@AC-6/@AC-7 @feature-147`; missing credential warns, service still starts). New migration `006`
(`marketdata.dividend_actions`, `(symbol, ex_date)` PK, plain table). Compute
`dividend_yield = Σ(USD cash where ex/pay ≤ filed_date AND ≥ filed_date−365d) / USD price-at-filing`
(USD/USD-consistent for a US ADR — Alpaca reports the ADR's actual USD distribution). Emit `0` **only**
when the feed responded with no payments; emit `missing` when the feed is absent/unentitled — never
conflate them (`@AC-22`).

**5. EDGAR-canonical snapshot + FR-8 disable-safety (FR-5/FR-8).** Add a **live-read** dispatch axis
`marketdata.fundamentals.snapshot_source` (`edgar|vendor`) at the top of **both**
`GetFundamentals` (single, :1268→resolveFundamentals :1347) and `GetFundamentalsMulti` (:1284), sharing
one EDGAR snapshot builder (parity test, C-10(b)). The EDGAR snapshot = latest `fundamentals_history`
period (via the existing `GetHistoricalFundamentals`+`filterAsOf` read, recon:60) + a **live** price from
the batched, singleflight-coalesced `GetLatestQuotes` (feature 178), **write-through cached** into the
existing `marketdata.fundamentals` table (UpsertFundamentals :1327) with a new
`marketdata.edgar.cache_ttl_hours` TTL — so steady-state cost stays one indexed read/symbol (F-06;
avoids the feature-141 OOM from N history scans + N `CloseAt` reads). Cache invalidation is
**source-aware via a provider→axis mapping** (`edgar⇒edgar`; `fmp`/`finnhub`⇒`vendor`; `edgar+fmp`⇒`edgar`),
NOT string inequality, and the builder sets `Source="edgar"` as a **tested invariant** guarding the
`UpsertFundamentals` empty-source `→'fmp'` default (marketdata_repo.go:494). The two vendor-keyed
guards — `fundamentalsEnabled()` (:1382, whose `false` default is the FR-8 fallthrough trap) and
`fundamentalsQuota()` (:1397 FMP shape) — **dispatch on `snapshot_source`**: `edgar` ⇒ gate on
`marketdata.edgar.enabled` and bypass the vendor quota. `marketdata.edgar.enabled` reads with an explicit
`true` default (feature-100 `GetBool` zero-value trap); `=false` ⇒ `FailedPrecondition` + WARN (deliberate
all-off kill switch). The non-SEC-filer fallback fires when **no EDGAR snapshot is producible**
(zero `fundamentals_history` periods — covers CIK-miss AND no-backfilled-history — OR the latest period
carries none of the core metrics) and routes to the explicit fallback vendor **only while enabled**; a
CIK-known-but-zero-history miss WARNs even when the vendor fallback is taken (don't mask a backfill gap as
non-SEC). `newFundamentalsSource` (main.go:195) `default:→fmp` becomes an explicit switch (unknown provider
→ boot-fatal); an unknown `snapshot_source` fails loud. **Deploy/rollout** (both axes boot-frozen except
the live-read `snapshot_source`): (1) deploy `snapshot_source=vendor` (no change); (2) backfill the active
universe (screener/opportunity/watchlist/positions, feat 060/083/168) via
`marketdata.fundamentals.history.enabled=true` + `TriggerBackfill(FUNDAMENTALS)`; (3) **verify coverage**
(narrow direct check — every active-universe symbol is producible; the miss-list must contain only genuine
non-SEC CIK-misses); (4) **live-flip** `snapshot_source=edgar` per env staging→prod (instantly reversible,
no restart); (5) disable `finnhub`/`fmp .enabled` **last**. Source-aware read self-heals stale vendor cache
rows in one call (no purge migration; one-time purge is the recorded fallback if the `source` column proves
unreliable).

**6. Config seed migration (FR-5).** config migration `~030` (verify next-free at spec): seed
`snapshot_source=vendor`, `marketdata.edgar.enabled=true`, `marketdata.edgar.cache_ttl_hours`,
`marketdata.dividends.enabled`, `marketdata.dividends.backfill_lookback_years` (fetch-range bound only —
the T12M window is fixed); the vendor `.enabled` flip to `false` is rollout step 5, not the migration.

**7. Data-explorer exposure (FR-6).** Add `debt_to_equity`, `pb_ratio`, `dividend_yield` to the single
`FUNDAMENTAL_METRICS` registry (useDataExplorer.ts:39); render `currency` as a row-level "Reporting
currency" provenance column + `source`; add a per-metric currency-basis marker so USD `market_cap`/`price`
carry an explicit USD hint inside a non-USD row (C-17).

**8. New marketdata acceptance coverage (C-16 blind spot).** Author currency-capture, PIT-metric,
no-look-ahead, and disable-safety scenarios (recon:77,95); real `marketdata_pb2.Bar` fixtures, never
`MagicMock` (fails.md 2026-08-06); Go fixtures in `internal/testdata/` per C-13 once a 2nd consumer appears.

## Rejected Alternatives

- **Overload `marketdata.fundamentals.provider` with an `edgar` value** — rejected: `provider` couples three
  concerns (client construction, config namespace, quota shape) EDGAR has none of, forcing an
  `if provider==edgar` special-case at every read site and leaving the fallback vendor as an accidental
  `default→fmp` (the feature-129 fallthrough trap). Dedicated `snapshot_source` axis chosen instead.
- **P/B option (a): absent-on-any-currency-mismatch** — rejected in favor of option (b) (prefer a USD-unit
  equity fact, else absent): (b) delivers a real P/B for ADRs that dual-report a USD convenience translation,
  satisfying `@AC-4` literally; (a) is the fallback when no USD-unit fact exists.
- **P/B option (c): add a historical FX feed** — rejected: a second new data-source integration, materially
  beyond the agreed scope; option (b) needs no FX.
- **PIT-only fix, leave the snapshot on the vendor ("(Y)")** — rejected: cannot satisfy `@AC-9`. With two
  sources, the ROE convention stays split (EDGAR ending-equity ~52% for BABA vs vendor TTM ~7%), re-opening
  the ~0.35-vs-0.70 composite divergence; and it does not deliver the operator's vendor-retirement goal.
- **Keyless always-on EDGAR gate** — rejected: no config-rollout lever, un-disable-able source; a real
  `marketdata.edgar.enabled` kill switch chosen.
- **Live per-call `GetHistoricalFundamentals`+`CloseAt` with no cache** — rejected: N history scans + N
  `ohlcv` `CloseAt` reads per screener-universe call re-opens the feature-141 "out of shared memory" (F-06);
  write-through cache chosen.
- **One-time cutover cache purge** — not chosen as primary (source-aware self-heal preserves instant
  reversibility) but **recorded as the sanctioned fallback** if /sdd-spec finds the `source` column
  unreliable.
- **Boot-bound `snapshot_source` (rolling-restart cutover)** — rejected: live-read gives instant, reversible
  cutover with no dark window; the EDGAR builder constructs no client, so live-reading is safe.
- **FR-4 dividends from EDGAR/FMP** — rejected: EDGAR rarely carries clean per-share cash-dividend facts and
  FMP is being disabled; Alpaca (already the OHLCV vendor) is the right source.

## Open Risks

- [ ] **XBRL tag/USD-fact coverage (blocks @AC-2/3/4/9 wording).** Financial-debt tags and USD-unit
  equity/EPS facts for BABA (20-F/IFRS) are unverified. /sdd-spec runs a direct SEC companyfacts fetch
  (BABA + AXP + one plain US filer) FIRST; if a metric's facts are absent it lands in `missing_metrics`
  and the affected `@AC` wording is corrected with operator sign-off (C-15/P-03). — Step: /sdd-spec verification.
- [ ] **Alpaca corporate-actions entitlement (gates FR-4 only).** The corporate-actions history endpoint is
  currently unused; the `iex`/basic plan may not serve it. /sdd-spec verifies via a narrow direct-API check;
  if unentitled, FR-4/`@AC-5` is explicitly descoped with operator sign-off (never a silent `@AC-5` pass while
  dividend renders "—"). FR-1/2/3/5/6/8 proceed regardless; symmetric-missing dividend preserves `@AC-9`. — Step: /sdd-spec FR-4 gate.
- [ ] **`source` column reliability for cache self-heal.** If `marketdata.fundamentals` stores `source`
  inconsistently (vendor wrote NULL/empty → `'fmp'`), the mapping-based invalidation is undermined; verify
  against the schema + UpsertFundamentals/toProtoFundamentals; fallback = one-time cutover purge. — Step: /sdd-spec + migration 006.
- [ ] **Active-universe enumeration for the coverage gate.** No single RPC lists the fundamentals-consuming
  union (screener/opportunity/watchlist/positions); name the concrete query at /sdd-spec (narrow direct
  check, not `grpcurl`). — Step: rollout runbook.
- [ ] **Snapshot `as_of` semantics (@AC-12).** "latest filing + live price-join" mixes a filing date with a
  live-price timestamp; confirm the "Last refreshed" contract at /sdd-spec. — Step: /sdd-spec FR-6.
- [ ] **Cross-currency consumer audit.** Enumerate every consumer of an absolute field (fundsignal scorer,
  screener feature-060, market-cap/revenue filters) and prove none compares native-currency absolutes
  cross-symbol. — Step: /sdd-spec.

## Constitution Rules Touched

- `C-04` — honored: no new enum needed; `snapshot_source` is a config string with fail-loud on unknown (proto unchanged).
- `C-05` — honored: new keys follow `<service>.<category>.<key>` (`marketdata.fundamentals.snapshot_source`, `marketdata.edgar.*`, `marketdata.dividends.*`); declared in marketdata `CLAUDE.md`; seeded via migration.
- `C-07` — honored: marketdata migration `006`, config `~030` (verify next-free), `.up.sql`+`.down.sql`, run via `scripts/db-migrate.sh`.
- `C-08`/`P-06` — honored: every service step pairs a red-before-green test; @AC coverage per C-15.
- `C-10(b)` — honored: `snapshot_source` dispatch applied to BOTH `GetFundamentals` and `GetFundamentalsMulti` with a parity test; the value is not exposed inconsistently across read paths.
- `C-13` — honored: Go fixtures in `internal/testdata/` on second consumer; real `Bar` fixtures.
- `C-14` — honored: `/insights/data-explorer` + agent `query_fundamentals` named; FMP/Finnhub code deletion deferred to a named follow-up.
- `C-15` — honored: no silent `@AC` pass; any metric-absence correction (incl. FR-4 descope) is explicit with operator sign-off.
- `C-17` — honored: data-explorer uses tokens/existing primitives; USD unit hint on market_cap/price in a non-USD row.
- `C-18` — honored: the (Y) PIT-only split was analyzed and rejected on merit (ROE parity), not dogma; write-through cache reuses the existing chokepoint (DRY); no speculative abstraction.
- `F-01` — honored: new migrations only; the vendor-disable is a live config write, not a migration edit.
- `F-04` — honored: every path:line cited from recon/discovery; unknowns are Open Risks, not guesses.
- `F-06` — honored: write-through cache keeps steady-state at one indexed read/symbol; no new/raised pool.
- `F-07` — honored: all reads config-driven (the hardcoded USD literal is the bug being removed); fail-loud on unknown config values.

## Business Rules Touched (C-16)

- PRESERVE `@AC-3 @feature-204` snapshot render, `@AC-4/15/20 @feature-204` historical query/chart/pagination (`services/xstockstrat-ui/acceptance/backfilled-data-queryable.feature`) — not regressed: additive columns; serving source change is behind the cache chokepoint.
- PRESERVE `@AC-22 @feature-204` missing_metrics → "—"/gap, never fabricated — not regressed: new metrics absent land in `missing_metrics`; dividend emits 0 only on a responded-empty feed.
- EXTEND `@AC-17 @feature-204` fundamentals CSV — currency/source/D-E/P-B/div-yield columns added.
- PRESERVE `@AC-6 @feature-205` GetFundamentalsMulti prefill null-not-NaN; `@AC-3/@AC-7 @feature-205` fundamental-inputs round-trip + formula-component parity (`platform.feature`, indicators/ui suites) — not regressed: passthrough unchanged.
- PRESERVE `@AC-14 @feature-095` live-quote no look-ahead, `@AC-11 @feature-095` unavailable-quote omit-not-fabricate, `@AC-1..3 @feature-151` backtest no-look-ahead (analysis/ui suites) — not regressed: PIT price-join at filing boundary + T12M dividend window preserve the T+1 boundary; live snapshot's live price feeds only the un-gated live surface.
- PRESERVE `@AC-1 @feature-168` blend fundamentals-universe intersection; `@AC-6/@AC-9 @feature-154` fundsignal cap FMP-gated — not regressed: intersection rule intact; disabling FMP keeps the cap non-applicable (consistent).
- PRESERVE `@AC-6/@AC-7 @feature-147` Alpaca credential via GetSecret + warn-not-crash — not regressed: the new dividend feed reuses that exact path.
- CHANGE (no promoted guard) snapshot source repointed at EDGAR — alters the feature-198 "provider never takes edgar / EDGAR is a separate PIT lane" doc contract; **signed off by user @ 2026-09-26** (context.md AskUserQuestion decision 1); new marketdata acceptance coverage authored to close the blind spot.
- CHANGE (no promoted guard) "stop hardcoding USD" currency semantics — **signed off by user @ 2026-09-26** (context.md); absolute fields never cross-currency aggregated by consumers (audit at /sdd-spec).
- CONTINGENT `@AC-2/@AC-3/@AC-4/@AC-9` (this feature's own scenarios) — may require wording correction if the /sdd-spec SEC fetch shows the required XBRL facts are absent; correction carries operator sign-off (C-15).
