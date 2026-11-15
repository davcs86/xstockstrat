# Debate Register: fix-fundamentals-roe-unit

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 5 | 5 | 0 | 10 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 5 | 4 | 4 | 6 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Fix the EDGAR input, not the unit: the ROE on the traced EDGAR quarterly TTM path is already a fraction, so no percent rescale is applied. | Recon trace table; edgar_client.go:491, :560; 28,070,000 appears in no row. Proposer and adversary agree. | settled |
| D-2 | 1 | Repair stored rows by bumping `DerivationVersion` 1 to 2 with the golden-hash update, re-deriving through `RederiveHistoricalFundamentals`; no SQL migration. | edgar_client.go:521-524; marketdata_repo.go:786, :797; marketdata_service.go:2398-2407. Adversary: 'the right tool'. | settled |
| D-3 | 1 | When no balance-sheet instant matches the anchor, the value is absent (nil ROE and D/E); there is no fallback to first-seen. | edgar_client.go:479-481, :559; marketdata_service.go:2202; FR-4 / MARKETDATA-11. Not disputed by the adversary. | settled |
| D-4 | 1 | Debt tags use the same date rule as equity so D/E's numerator and denominator share one balance-sheet date. | edgar_client.go:575-593; fails.md 2026-11-04 'a ratio shares its basis with its siblings'. Not disputed. | settled |
| D-5 | 1 | Vendor unit guards (Finnhub scale100, FMP pass-through) and the proto `roe` fraction comment are additive only. | finnhub_client.go:260; fmp_client.go:481; marketdata.proto:233, :283. Not disputed. | settled |
| D-6 | 2 | The instant anchor is balance-sheet-native: the maximum `end` among the bucket's `StockholdersEquity`, `Assets` and `Liabilities` candidates, excluding `dei` and share-count tags, matched by equality with no tolerance. | edgar_client.go:195-198, :340-364. Proposed by the adversary in round 1; accepted by the proposer in round 2, who withdrew `statementEnd`. | settled |
| D-7 | 2 | Candidates are collected then selected inside `FetchHistorical`, keyed by (metric, unit, `end`) with earliest-filed winning per key; no new public type. | edgar_client.go:346-349, :387-401, :425, :435. Proposer r2; adversary raised no objection to the store itself. | settled |
| D-8 | 2 | `RederiveHistoricalFundamentals` strips the derivation-owned `extra_metrics` keys (`revenue`, `net_income`, `assets`, `liabilities`, `stockholders_equity`, `stockholders_equity_usd`, `total_debt`) before the merge; price-join keys survive. | marketdata_repo.go:794-797; edgar_client.go:589, :596, :603. Proposer r2; the adversary disputed only where the key list lives. | settled |
| D-9 | 2 | `shares` selection is left unchanged in this feature and logged as a named residual in services/xstockstrat-marketdata/docs/context-constitution-findings.md. | edgar_client.go:199-200, :305-306. Proposer r2 Step 4; not disputed. | settled |
| D-10 | 2 | The coverage audit is a post-deploy count of rows whose `roe` or `debt_to_equity` went from a value to nil, with a stated operator-escalation threshold; committed fixtures are limited to LYFT, AXP and AAPL. | Adversary r2: eight filers cannot represent the universe. Mediator adoption; the proposer has not yet answered. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Percent-to-fraction unit rescale of ROE. | Disproved by the trace: the EDGAR ratio is already a fraction and 28,070,000 appears in no row. | locked |
| R-2 | 1 | Flow-based `statementEnd` anchor (latest end among classified flow facts). | Zero anchor for instant-only buckets; turns edgar_client_test.go:301, :373, :388 red and breaks on 52/53-week offsets. | locked |
| R-3 | 1 | Fallback to first-seen when no instant matches the anchor. | Quietly reintroduces the defect; nil is handled end to end. | locked |
| R-4 | 1 | `equity ~= assets - liabilities` sanity guard as the fix. | Hides the symptom, false-positive-prone, does not repair stored inputs. Allowed only as a test and post-deploy assertion. | locked |
| R-5 | 1 | SQL migration or `overwrite=true` as the ROE repair mechanism. | The DerivationVersion gate already re-derives and preserves feature-216 @AC-3/@AC-4. | locked |
| R-6 | 2 | Per-metric latest-`end` flow selection with no tie to the instant anchor, applied to buckets that have an anchor. | A bucket missing its current-period fact silently takes the prior-year comparative, pairing last year's numerator with this year's equity (fails.md 2026-11-04 shared basis). | locked |
| R-7 | 2 | Pre-bump coverage audit run over about eight committed filer fixtures. | Eight filers say nothing about the universe and add more test data than the RED test needs. | locked |
| R-8 | 2 | A duplicated derivation-owned key list beside the strip SQL with a comment cross-reference to `buildPeriod`. | `internal/source` is already imported by both packages (edgar_client.go:21, marketdata_repo.go:18), so one exported list is available with no new dependency edge (C-18). | locked |
| R-9 | 2 | Changing `mergePrice` to clear P/B (value to nil) on an anchor miss. | It would be a feature-216 business-rule CHANGE; the stale P/B is recorded as a residual instead. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | This feature's @AC-1, @AC-3 and @AC-5 bind values from the disproved percent hypothesis; restating them needs operator sign-off and concrete numbers pinned from the LYFT fixture before /sdd-spec (P-03). | yes | open |
| O-2 | 1 | The trace is incomplete: the raw companyfacts filing was not fetched, so the date of 767,016,000, the existence of a quarter-end equity instant, and the genuineness of the ~2.81B TTM net income are unverified. | yes | open |
| O-3 | 1 | The flow-based `statementEnd` anchor nulls balance-sheet values in instant-only buckets and regresses feature-211/223 tests; the proposer must accept the balance-sheet-native anchor or answer concretely. | yes | closed @ round 2 (The proposer accepted the balance-sheet-native anchor and withdrew the flow-based `statementEnd`.) |
| O-4 | 1 | The annual ROE numerator stays first-seen (edgar_client.go:558-560); extending own-period keying to flows changes EPS and revenue and needs an explicit operator scope call plus a specified flow selection rule. | yes | open |
| O-5 | 1 | On an anchor miss the re-derive nulls ROE and D/E but stale `extra_metrics` equity keys and P/B survive (marketdata_repo.go:794-797; marketdata_service.go:2418); needs a coverage audit, a key strip or stated residual, and a post-deploy check that does not read the bare equity key. | yes | closed @ round 2 (Exact key-strip SQL given for the re-derive, the P/B residual on anchor-miss rows stated, and the post-deploy checks assert `roe x equity ~= TTM NI` and `equity ~= assets - liabilities` rather than the bare equity key; the coverage audit moves post-deploy.) |
| O-6 | 1 | FR-5 repair is scoped to LYFT while the defect affects every EDGAR filer; needs a universe re-backfill step, a `fundamentals.history.enabled` check in staging, and recorded PIT backtest drift. | no | open |
| O-7 | 1 | P/B and market cap need one universe-wide `overwrite=true` pass; design.md must state why @AC-4 @feature-216 still holds. | no | open |
| O-8 | 1 | `shares` has the same first-seen defect plus map-iteration nondeterminism (edgar_client.go:199-200, :305-306); must be a named residual logged to docs/context-constitution-findings.md. | no | closed @ round 2 (`shares` is left unchanged and logged as a named residual in the marketdata context-constitution findings.) |
| O-9 | 1 | The instant candidate store must not duplicate `niFact`; collect-then-select in the loop with no new public type (C-18). | no | closed @ round 2 (Collect-then-select is inlined in `FetchHistorical` reusing the `niFact` earliest-filed rule, with no new public type.) |
| O-10 | 1 | The repeated `net_income` 2,567,000 on three 2026 quarters is unexplained and should be confirmed or ruled out from the fixture. | no | open |
| O-11 | 2 | Step 5's universe-wide `overwrite=true` backfill cannot run as written: `BackfillFundamentalsRequest` needs an explicit symbol list (marketdata.proto:309-314), `trigger_backfill` caps at 50 symbols with a 365-day default lookback (agent tools.py:1546-1571), and out-of-range periods are never re-derived (edgar_client.go:371-376). Step 5 must name the symbol source, the chunking and an explicit `start` covering the oldest stored `period_end`. | yes | open |
| O-12 | 2 | Flow selection must be tied to the instant anchor (`end == anchor` when an anchor exists, latest-end otherwise); the proposer must accept this or show a filer whose flow end and balance-sheet date differ. | no | open |
| O-13 | 2 | The anchor across currencies is unspecified; it should be the max `end` across all units of the three tags with per-unit selection at that date (feature-211 @AC-1, edgar_client.go:259). | no | open |
| O-14 | 2 | Revenue nondeterminism survives the new store: two tags map to `revenue` (edgar_client.go:189-190) and a same-filing tie is broken by map iteration order; add a fixed tag precedence or log it with the `shares` residual. | no | open |
| O-15 | 2 | The 'stays green unmodified' test list is asserted, not rechecked: `derivationGolden` changes by design (AXP Q2-2026 `net_income`, ttm_roe_test.go:28) and edgar_client_test.go:293 must be confirmed to sit at the anchor date or surfaced as a C-16 finding. | no | open |
| O-16 | 2 | D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'; the operator should accept this explicitly. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
