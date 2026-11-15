# Context Log: fix-fundamentals-roe-unit

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md`: Fundamentals ROE value implausible against sibling metrics
- Source: operator report from staging (homelab) on 2026-11-15, with screenshots; root causes from read-only recon the same day
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): `xstockstrat-marketdata`
- Root cause hypothesis: see product-spec.md § Root Cause Hypothesis
- Recommended design depth: quick → `/sdd-design fix-fundamentals-roe-unit quick` (rationale: SEV-3, single service, root cause under investigation)
- Development branch: feature/fix-fundamentals-roe-unit

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - Criterion 8 (C-15): the `Given` of `@AC-1` and `@AC-5` names no provider (deferred on purpose, Open Question 1). The `Then` values (0.0366) and inputs (28070000 / 767000000) are concrete. Design must pin the traced provider and its native input unit into both Givens, or the scenarios stay unverifiable.
  - Criterion 9: Open Question 1 is marked Decided, but the decision is "not traced; recon must trace it" — still unanswered in substance. Recon must resolve it before FR-2 can be called testable.
  - Criterion 2: FR-2 depends on the untraced root cause and is testable only through `@AC-1`.
  - Criterion 8: `@AC-1` and `@AC-5` are partly redundant (both check LYFT 0.0366); AC-5 adds the stored-value (FR-5) angle. Kept — both are regression scenarios.
  - FR-5 / Fix Scope: the `DerivationVersion` bump / `BackfillFundamentals` covers only EDGAR-derived historical rows; the current-snapshot `marketdata.fundamentals` row is overwritten on re-fetch. Resolved in product-spec.md § Fix Scope (both paths named); design confirms which applies to the traced path.
  - Process note: a stale working-tree copy of product-spec.md had unchecked `- [ ]` gate boxes; the branch copy has none and is the authoritative one.
- Overlap findings (WARN — file-level only, rebase risk; no config-key, proto field-number or migration collision):
  - `internal/service/marketdata_service.go` — vs `317-fix-marketdata-miss-path-noise` (spec-ready, `:338`). Disjoint functions.
  - `internal/fmp/fmp_client.go` — vs `320-fix-vendor-key-in-url` (spec-ready, `:260`). Disjoint lines. The overlap pass reported the cited `:481` as drifted; checked on the branch — `:474` is the struct field, `:481` is the `f.ROE = r.ReturnOnEquityTTM` pass-through, so the spec anchor stands.
  - `internal/finnhub/finnhub_client.go` — vs `320-fix-vendor-key-in-url` (spec-ready, `:126`). Disjoint lines.
  - `packages/proto/marketdata/v1/marketdata.proto` — comment-only edits to `roe = 8` / `roe = 13` vs `322-fix-retired-surface-proto-cleanup` (spec-ready, near `:333`). No field-number or message overlap.
- Recommended design depth: full (escalate signals: proto touched, overlap findings, root cause untraced) — supersedes the triage `quick` recommendation.

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Root cause is not traced; recon must trace which provider or merge path produced roe ~3.66 for LYFT on staging before any fix is designed.

## Session 2026-11-15 — sdd-batch design gate (round 2)

`/sdd-design fix-fundamentals-roe-unit` full debate halted at the approval gate after round 2 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-10, R-1..R-9, O-1..O-16).

### Open Threads

- **Approach (not approvable yet):** fix the EDGAR inputs, not the unit (D-1), and repair stored rows through the `DerivationVersion` 1 → 2 bump (D-2). Step 0 cuts a LYFT `companyfacts` fixture and finishes the trace before any code. `FetchHistorical` moves from first-seen to collect-then-select (D-7) on a balance-sheet-native anchor: the max `end` among `StockholdersEquity` / `Assets` / `Liabilities`, equality match, no fallback (D-3, D-6). Flows keep `end == anchor` when an anchor exists, else per-metric latest `end` (mediator adoption, O-12). The re-derive strips derivation-owned `extra_metrics` keys (D-8) from one list exported by `internal/source`. Vendor guards and the proto `roe` comment are additive (D-5). `shares` stays a logged residual (D-9). The coverage audit is a post-deploy nil-delta count (D-10).
- **Strongest open objection — O-1 (blocking, operator):** `@AC-1`, `@AC-3` and `@AC-5` bind `Then 0.0366` from the disproved percent hypothesis. The corrected LYFT ROE is expected near 0.8, so the operator must restate the three scenarios from the fixture, plus the product-spec "low single-digit" claim, the defect-report premise and the "roe-unit" title, with sign-off here before `/sdd-spec` (P-03, C-15).
- **Other blocking objections:**
  - O-2 — the LYFT fixture is not cut, so the operator's "trace first" decision is still only a prediction.
  - O-4 — uniform flow scope moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer; the operator has not chosen between uniform and `net_income`-only.
  - O-11 — Step 5's universe-wide `overwrite=true` backfill cannot run as written: the RPC needs an explicit symbol list, `trigger_backfill` caps at 50 symbols with a 365-day default lookback, and out-of-range periods are never re-derived. Step 5 must name the symbol source, the chunking and an explicit `start`.
- **Non-blocking, still open:** O-6, O-7, O-10, O-12 to O-16 (see `debate.md`). O-16 also needs the operator: D/E and P/B change for every EDGAR filer.
- **Floor status:** no Floor breach. Adversary verdict NEEDS WORK; the mediator agrees.
- **Uncovered `@AC` changes (no operator decision covers them):** CHANGE to this feature's `@AC-1`, `@AC-2`, `@AC-3` and `@AC-5`. PRESERVE: `@AC-4` here, `@AC-1` and `@AC-9 @feature-211`, `@AC-1 @feature-223`, `@AC-3 @feature-222`, `@AC-3` and `@AC-4 @feature-216`.
- **Needed from the operator to resume:** restated acceptance values (O-1), the flow-scope call (O-4), acceptance of the D/E and P/B blast radius (O-16). The fixture (O-2) and a runnable Step 5 (O-11) are for the proposer in round 3.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis: fix the EDGAR inputs, not the unit (D-1), repair stored rows through the version bump (D-2). Not approvable yet: three items need the operator and one needs evidence. All paths are under `services/xstockstrat-marketdata` unless stated. I spot-checked four cites this step (noted inline); the rest are carried from the proposal and the adversary.\n\n**Step 0 (gate, before any code): cut the fixture and finish the trace.**\n- Commit LYFT `companyfacts`, trimmed to the `flowTags`/`instantTags` tags, under `internal/edgar/testdata/` (C-13). Keep AXP and AAPL as the only other fixtures; no eight-filer harness.\n- Record in `design.md`: the `end` of 767,016,000; the Q3-2026 quarter-end equity instant; the quarters and `n` that `trailingNetIncome` (`internal/edgar/edgar_client.go:411`) sums, and whether a derived Q4 (`:439-452`) is included; the source of 2,567,000.\n- Working hypothesis (unverified): first-seen picks the earliest-dated fact, so 767,016,000 is an old roll-forward opening balance.\n- Redesign triggers: quarter-end equity is itself about 767M, or the TTM sum is wrong.\n- Expected outcome, not a tail risk: the ~2.81B TTM numerator is probably genuine, so corrected ROE lands near 0.8, not 0.0366. The acceptance values must be restated from the fixture (operator).\n\n**Step 1: own-period selection in `FetchHistorical` (`internal/edgar/edgar_client.go:290`).**\n- Replace the first-seen write (`:357-364`) with collect-then-select inside the function; no new public type.\n- Candidates are keyed by (metric, unit, `end`), earliest-filed per key (the `niFact` rule, `:425`).\n- Instant anchor: the maximum `end` among the bucket's `StockholdersEquity`, `Assets` and `Liabilities` candidates, computed across all units; per-unit selection then happens at that one date. `dei` and share-count tags are excluded.\n- Instants (equity, assets, liabilities, debt tags): keep only `end == anchor`. No fallback, no tolerance (D-3, D-4).\n- Flows (`net_income`, `revenue`, `eps`, `eps_basic`), adopting the adversary's rule over the proposer's: when the bucket has an anchor, keep only flows with `end == anchor`, else absent; use per-metric latest `end` only when the bucket has no anchor. This anchors flows on instants, the reverse of locked R-2.\n- Flow scope is uniform across the four metrics, pending the operator's call (it moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer).\n- Revenue tie-break: add a fixed tag precedence between the two revenue tags (`:189-190`), or log it with the `shares` residual. The proposer must pick one.\n- Unchanged: `shares` (`:199-200`), `periodEnd` (`:350-352`), `buildPeriod` (`:526`), `annualizeQuarterlyROE` (`:475-493`), `trailingNetIncome`.\n- Bump `DerivationVersion` to 2 (`:524`) and update `derivationGolden` in `internal/edgar/derivation_version_test.go`. Check `docs/roadmap/features/merge-order.md` for a competing bump first.\n\n**Step 2: strip derivation-owned keys in the re-derive.**\n- In `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:795-797`, verified: currently `extra_metrics || $7::jsonb`), subtract `revenue`, `net_income`, `assets`, `liabilities`, `stockholders_equity`, `stockholders_equity_usd`, `total_debt` before the merge. Price-join keys still survive.\n- Hold the key list once, exported from `internal/source`, used by both the `buildPeriod` spill (`edgar_client.go:589`, `:596`, `:603`) and the strip SQL. Verified: both packages already import `internal/source` (`edgar_client.go:21`, `marketdata_repo.go:18`), so the proposer's accepted duplication is unnecessary.\n- `DeleteEdgarSnapshot` (`:807`) and the gate (`internal/service/marketdata_service.go:2398`) are unchanged.\n\n**Step 3: tests (RED first).**\n- LYFT fixture: Q3-2026 equity equals the quarter-end instant and `roe` equals TTM NI over it, both pinned as literals from Step 0.\n- Synthetic 10-Q with three equity instants; synthetic 10-K with three annual `NetIncomeLoss` columns; an anchor-miss case giving nil ROE and D/E; a flow whose only fact is a prior-year comparative, giving an absent flow.\n- pgxmock: update `internal/repository/marketdata_repo_test.go:573-584` and add a stale-key strip test.\n- The \"stays green unmodified\" list must be rechecked, not assumed. `derivationGolden` changes by design (AXP Q2-2026 `extra_metrics.net_income` moves from 1100e6 to 2885e6, `ttm_roe_test.go:28`). Confirm `edgar_client_test.go:293` (`stockholders_equity == 1060886e6`) sits at the anchor date, or surface it as a C-16 finding.\n\n**Step 4: additive guards and docs (D-5).**\n- Table tests for Finnhub `scale100` (`internal/finnhub/finnhub_client.go:260`) and FMP pass-through (`internal/fmp/fmp_client.go:481`).\n- Comment-only on `roe` at `packages/proto/marketdata/v1/marketdata.proto:233` and `:283`, then `./scripts/buf-gen.sh`.\n- Update `docs/fundamentals.md`; log the `shares` residual in `services/xstockstrat-marketdata/docs/context-constitution-findings.md`.\n\n**Step 5: post-deploy on staging. Not runnable as the proposer wrote it.**\n- `BackfillFundamentalsRequest` takes an explicit symbol list (`marketdata.proto:309-314`, verified) and `trigger_backfill` caps a call at 50 symbols (`services/xstockstrat-agent/app/tools.py:1558`, `:1570`, verified). `FetchHistorical` drops periods outside the range (`edgar_client.go:371-376`, verified).\n- Step 5 must therefore state: how the stored universe is enumerated; 50-symbol chunking; and an explicit `start` at least as old as the oldest stored `period_end`.\n- Confirm `fundamentals.history.enabled` is on. Run with `overwrite=true` so P/B refreshes in the same pass (`marketdata_service.go:2398`, `:2415`, `:2561`).\n- Verify on LYFT and two control filers: `roe x equity ~= TTM NI` and `equity ~= assets - liabilities`. Neither reads the bare equity key.\n- Coverage audit moves here: count rows whose `roe` or `debt_to_equity` went from a value to nil after the re-derive, with a stated threshold for operator escalation.\n- Record in `design.md`: PIT drift (`@AC-9 @feature-211`), why `@AC-4 @feature-216` holds, and the stale-P/B residual on anchor-miss rows.",
    "open_objections": [
      {
        "text": "[O-1; P-03, C-15; operator] @AC-1, @AC-3 and @AC-5 bind `Then 0.0366` from the disproved percent hypothesis. The round-2 equity arithmetic (767M to ~3.27B inside one fiscal year, about the size of the ~2.81B TTM numerator) makes a corrected ROE near 0.8 the expected outcome. The operator must restate the three scenarios with literals from the fixture, plus the product-spec 'low single-digit' claim, the defect-report premise and the 'roe-unit' title, with sign-off in context.md before /sdd-spec.",
        "blocking": true
      },
      {
        "text": "[O-2; operator decision 'trace first'] The LYFT companyfacts fixture is still not cut. The proposal offers a falsifiable prediction and redesign triggers, but the date of 767,016,000, the quarter-end equity instant and the TTM composition remain unverified. The operator decision requires the trace before the fix is designed, so the fixture must land before approval.",
        "blocking": true
      },
      {
        "text": "[O-4; operator] The flow rule is now specified, but applying it uniformly changes stored EPS and revenue, and through them TTM EPS and P/E, for every EDGAR filer. The proposer picked uniform scope with `net_income`-only as runner-up; the operator has not made the call.",
        "blocking": true
      },
      {
        "text": "[O-6, O-7; fails.md 2026-11-10 reachability, 2026-11-04 fix-stored-edgar-periods] Step 5's 'one universe-wide `BackfillFundamentals overwrite=true`' cannot run as written: the RPC needs an explicit symbol list, the agent tool caps at 50 symbols and defaults to a 365-day lookback, and out-of-range periods are never re-derived. Step 5 must name the symbol source, the chunking and an explicit `start` covering the oldest stored `period_end`.",
        "blocking": true
      },
      {
        "text": "[fails.md 2026-11-04 'ratio shares its basis'] The proposer's 'latest `end` per flow metric' is not tied to the instant anchor, so a bucket missing its current-period fact silently takes the prior-year comparative. The synthesis adopts `end == anchor` when an anchor exists, latest-end otherwise; the proposer must accept it or show a filer whose flow end and balance-sheet date differ.",
        "blocking": false
      },
      {
        "text": "The anchor across currencies is unspecified. The synthesis sets it as the max `end` across all units of the three tags with per-unit selection at that date (feature-211 @AC-1, `voteCurrency` edgar_client.go:259); the proposer must confirm.",
        "blocking": false
      },
      {
        "text": "Revenue nondeterminism survives: two tags map to `revenue` (edgar_client.go:189-190) and a same-filing tie is broken by map iteration order (:305-306). Add a fixed tag precedence or add it to the `shares` residual entry; pick one explicitly.",
        "blocking": false
      },
      {
        "text": "[C-18] The derivation-owned key list should be one exported list in `internal/source`, which both `internal/edgar` and `internal/repository` already import, not a duplicated constant with a comment cross-reference.",
        "blocking": false
      },
      {
        "text": "[C-16 hygiene] The 'stays green unmodified' list is asserted, not rechecked. `derivationGolden` changes by design (AXP Q2-2026 `net_income` 1100e6 to 2885e6); the proposer must name which feature-211/223 assertions were rechecked and confirm edgar_client_test.go:293 sits at the anchor date.",
        "blocking": false
      },
      {
        "text": "The pre-bump coverage audit over about eight committed filers cannot speak for the universe and adds unneeded fixtures. Move it to a post-deploy count of rows whose `roe`/`debt_to_equity` went value-to-nil, with a stated escalation threshold. The audit then cannot veto the bump; rollback is another version bump plus re-backfill.",
        "blocking": false
      },
      {
        "text": "[O-10] The repeated `net_income` 2,567,000 is probably a roll-forward 3-month NetIncomeLoss column (Q1-2025) taken first-seen in three buckets. Still to be confirmed from the fixture and recorded in design.md.",
        "blocking": false
      },
      {
        "text": "[scope, operator] D/E and P/B change for every EDGAR filer because they share the corrected equity, beyond the spec's 'other metrics out of scope'. The operator should accept this explicitly alongside the acceptance restatement.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 (feature 340)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1 @feature-223",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-222",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Unit rescale of ROE (R-1): the EDGAR ratio is already a fraction.",
      "Flow-based `statementEnd` anchor for instants (R-2): withdrawn by the proposer this round.",
      "Fallback to first-seen on an anchor miss (R-3): reintroduces the defect.",
      "`equity ~= assets - liabilities` guard as the fix (R-4): kept only as a test and post-deploy assertion.",
      "SQL migration or `overwrite=true` as the ROE repair (R-5): the version gate already re-derives. The Step 5 overwrite is for P/B only.",
      "Per-metric latest-`end` flow rule with no tie to the instant anchor (proposer r2): can pair a year-old comparative numerator with current equity; lost to `end == anchor` on the fails.md shared-basis rule.",
      "Restricting the flow rule to `net_income` only: smaller blast radius, but leaves the same comparative trap in EPS and revenue and adds a metric special-case in one code path. Stays available to the operator as the runner-up.",
      "Pre-bump coverage audit over about eight committed filer fixtures: a zero-miss result on eight filers says nothing about the universe and is more test data than the RED test needs; lost to a post-deploy nil-delta count.",
      "Duplicated key-list constant beside the strip SQL with a comment cross-reference: `internal/source` is already shared by both packages, so one exported list costs no new dependency edge.",
      "Changing `mergePrice` to go value-to-nil so P/B clears on an anchor miss: would be a feature-216 CHANGE; lost to a stated residual sized by the post-deploy audit.",
      "A days tolerance on the anchor match: unnecessary once the anchor is balance-sheet-native.",
      "LYFT-only re-backfill: leaves every other EDGAR filer's stored values wrong."
    ],
    "open_risks": [
      "The corrected LYFT ROE is expected to land near 0.8 and will still look implausible to a trader while being correct; the defect's premise then needs restating rather than satisfying.",
      "The fixture may show quarter-end equity near 767M or a wrong TTM sum, either of which forces a redesign.",
      "The earliest-dated first-seen hypothesis rests on SEC companyfacts arrays being ordered by `end` ascending, which is unverified.",
      "`end == anchor` for flows yields more nils on unusual taggers, and would be wrong for any filer whose flow end and balance-sheet date differ; only the fixtures test this.",
      "A filer tagging a later-dated subsequent-event instant under equity, assets or liabilities would shift the anchor and null the real period's values.",
      "Uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer; PIT backtests and screens drift for every symbol.",
      "P/B stays stale on anchor-miss rows because the price-join never goes value-to-nil.",
      "Stripping `assets`, `liabilities`, `revenue` and the other derived keys removes them from `extra_metrics` on a miss; readers beyond marketdata_service.go:2561 and the agent passthrough were not checked.",
      "The universe repair depends on a symbol enumeration that no existing tool provides, and on `fundamentals.history.enabled` being on in staging.",
      "The nil-delta audit runs after the bump, so it cannot veto it; rollback is another version bump plus a full re-backfill.",
      "`DerivationVersion` 2 may collide with another in-flight bump.",
      "`shares` map-iteration nondeterminism remains, so re-derived market cap and P/B can differ between runs."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "MARKETDATA-11"
    ],
    "rationale": "The design has converged in substance but cannot be approved this round. The adversary's verdict is NEEDS WORK with no Floor breach, and I agree.\n\n**What settled.** The proposer accepted the balance-sheet-native anchor and withdrew `statementEnd`, kept the candidate store inline, gave exact key-strip SQL, and named `shares` as a logged residual. That closes O-3, O-5, O-8 and O-9. The approach honors D-1 to D-5 and reintroduces none of R-1 to R-5; the `overwrite=true` in Step 5 is for P/B, not ROE, so it is not R-5.\n\n**What I changed from the proposal.**\n- Flow selection: I adopted the adversary's `end == anchor` rule, with latest-end only for buckets with no anchor. The proposer's rule can still pair a prior-year numerator with current equity, which is the shared-basis failure already in fails.md.\n- Key list: one exported list in `internal/source`. I checked that both packages already import it, so the proposer's \"not possible without a new export\" claim does not hold.\n- Coverage audit: moved to a post-deploy nil-delta count.\n\n**Why it stays blocked.**\n- O-1 and O-4 need the operator: the acceptance values cannot hold, and uniform flow scope moves EPS and P/E platform-wide.\n- O-2 needs the fixture: the operator's \"trace first\" decision is still only a prediction.\n- Step 5 cannot run as written. I verified the explicit symbol list in the proto, the 50-symbol cap in the agent tool and the range filter in `FetchHistorical`. I raised this as a new blocking objection rather than editing O-6 and O-7, which stay open.\n\nNo reopen was petitioned and the operator steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The instant anchor is balance-sheet-native: the maximum `end` among the bucket's `StockholdersEquity`, `Assets` and `Liabilities` candidates, excluding `dei` and share-count tags, matched by equality with no tolerance.",
          "evidence": "edgar_client.go:195-198, :340-364. Proposed by the adversary in round 1; accepted by the proposer in round 2, who withdrew `statementEnd`."
        },
        {
          "text": "Candidates are collected then selected inside `FetchHistorical`, keyed by (metric, unit, `end`) with earliest-filed winning per key; no new public type.",
          "evidence": "edgar_client.go:346-349, :387-401, :425, :435. Proposer r2; adversary raised no objection to the store itself."
        },
        {
          "text": "`RederiveHistoricalFundamentals` strips the derivation-owned `extra_metrics` keys (`revenue`, `net_income`, `assets`, `liabilities`, `stockholders_equity`, `stockholders_equity_usd`, `total_debt`) before the merge; price-join keys survive.",
          "evidence": "marketdata_repo.go:794-797; edgar_client.go:589, :596, :603. Proposer r2; the adversary disputed only where the key list lives."
        },
        {
          "text": "`shares` selection is left unchanged in this feature and logged as a named residual in services/xstockstrat-marketdata/docs/context-constitution-findings.md.",
          "evidence": "edgar_client.go:199-200, :305-306. Proposer r2 Step 4; not disputed."
        },
        {
          "text": "The coverage audit is a post-deploy count of rows whose `roe` or `debt_to_equity` went from a value to nil, with a stated operator-escalation threshold; committed fixtures are limited to LYFT, AXP and AAPL.",
          "evidence": "Adversary r2: eight filers cannot represent the universe. Mediator adoption; the proposer has not yet answered."
        }
      ],
      "new_rejected": [
        {
          "text": "Per-metric latest-`end` flow selection with no tie to the instant anchor, applied to buckets that have an anchor.",
          "why": "A bucket missing its current-period fact silently takes the prior-year comparative, pairing last year's numerator with this year's equity (fails.md 2026-11-04 shared basis)."
        },
        {
          "text": "Pre-bump coverage audit run over about eight committed filer fixtures.",
          "why": "Eight filers say nothing about the universe and add more test data than the RED test needs."
        },
        {
          "text": "A duplicated derivation-owned key list beside the strip SQL with a comment cross-reference to `buildPeriod`.",
          "why": "`internal/source` is already imported by both packages (edgar_client.go:21, marketdata_repo.go:18), so one exported list is available with no new dependency edge (C-18)."
        },
        {
          "text": "Changing `mergePrice` to clear P/B (value to nil) on an anchor miss.",
          "why": "It would be a feature-216 business-rule CHANGE; the stale P/B is recorded as a residual instead."
        }
      ],
      "new_objections": [
        {
          "text": "Step 5's universe-wide `overwrite=true` backfill cannot run as written: `BackfillFundamentalsRequest` needs an explicit symbol list (marketdata.proto:309-314), `trigger_backfill` caps at 50 symbols with a 365-day default lookback (agent tools.py:1546-1571), and out-of-range periods are never re-derived (edgar_client.go:371-376). Step 5 must name the symbol source, the chunking and an explicit `start` covering the oldest stored `period_end`.",
          "blocking": true
        },
        {
          "text": "Flow selection must be tied to the instant anchor (`end == anchor` when an anchor exists, latest-end otherwise); the proposer must accept this or show a filer whose flow end and balance-sheet date differ.",
          "blocking": false
        },
        {
          "text": "The anchor across currencies is unspecified; it should be the max `end` across all units of the three tags with per-unit selection at that date (feature-211 @AC-1, edgar_client.go:259).",
          "blocking": false
        },
        {
          "text": "Revenue nondeterminism survives the new store: two tags map to `revenue` (edgar_client.go:189-190) and a same-filing tie is broken by map iteration order; add a fixed tag precedence or log it with the `shares` residual.",
          "blocking": false
        },
        {
          "text": "The 'stays green unmodified' test list is asserted, not rechecked: `derivationGolden` changes by design (AXP Q2-2026 `net_income`, ttm_roe_test.go:28) and edgar_client_test.go:293 must be confirmed to sit at the anchor date or surfaced as a C-16 finding.",
          "blocking": false
        },
        {
          "text": "D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'; the operator should accept this explicitly.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "The proposer accepted the balance-sheet-native anchor and withdrew the flow-based `statementEnd`."
        },
        {
          "id": "O-5",
          "how": "Exact key-strip SQL given for the re-derive, the P/B residual on anchor-miss rows stated, and the post-deploy checks assert `roe x equity ~= TTM NI` and `equity ~= assets - liabilities` rather than the bare equity key; the coverage audit moves post-deploy."
        },
        {
          "id": "O-8",
          "how": "`shares` is left unchanged and logged as a named residual in the marketdata context-constitution findings."
        },
        {
          "id": "O-9",
          "how": "Collect-then-select is inlined in `FetchHistorical` reusing the `niFact` earliest-filed rule, with no new public type."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 3)

`/sdd-design fix-fundamentals-roe-unit` full debate halted at the approval gate after round 3 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-17, R-1..R-14, O-1..O-23, P-1).

### Open Threads

- **Approach (one blocker left):** the trace is done and the root cause is confirmed (D-11). The mediator fetched LYFT `companyfacts` (CIK0001759509) from sec.gov: the stored 3.6634 is a genuine TTM net income of 2,809,866,000 over a first-seen equity of 767,016,000 dated 2024-12-31, where the Q3-2026 quarter-end equity is 2,980,873,000. The fix is unchanged in shape: `FetchHistorical` moves from first-seen to collect-then-select (D-7) on the balance-sheet anchor (D-6, D-14), instants and flows keep only `end == anchor` (D-3, D-4, D-13), revenue takes `Revenues` first (D-15), the re-derive strips derivation-owned keys (D-8), and `DerivationVersion` goes 1 → 2 (D-2). The LYFT fixture is committed in the Step-3 RED step, not at the gate (D-17). Staging repair is a chunked `overwrite=true` re-backfill of the stored universe (D-16).
- **Restated acceptance literals (D-12, operator ruling on O-1):** `@AC-1` and `@AC-5` roe 0.942632 (Q3-2026); `@AC-3` roe 0.868791 (FY2025). The product-spec "low single-digit" claim, the defect-report premise and the title are restated to match; the slug is the operator's call. These literals come from a live fetch that is not committed, so the Step-3 fixture must reproduce them.
- **Strongest open objection — O-17 (blocking):** the operator's uniform-scope ruling came with a post-deploy audit of rows whose net income, revenue or EPS change. The proposal audits only `roe` / `debt_to_equity` going value-to-nil, and `RederiveHistoricalFundamentals` overwrites in place, so the old values are gone after the first chunk. The proposer must add a pre-backfill read-only CSV export keyed on (`symbol`, `fiscal_period`, `period_type`) and a per-metric changed / nil'd / largest-delta report with escalation thresholds. The mediator wrote the export into Step 5, but the proposer has not answered.
- **Non-blocking, still open:** O-15 (list each feature-211/223 assertion with its anchor date), O-16 (operator: D/E and P/B change for every EDGAR filer), O-18 (operator: `@AC-2` restatement), O-19 (`pe_ratio` stale residual), O-20 (revenue order of operations), O-21 (later-dated `Liabilities` test), O-22 (production re-backfill step), O-23 (stored `period_end` may be the `dei` cover-page date; read from code, not checked against stored rows).
- **Closed this round:** O-1, O-2, O-4, O-6, O-7, O-10 to O-14.
- **Reopen petition P-1 (pending user):** the adversary asks to reopen O-5 because the check `roe x equity ~= TTM NI` uses an operand that is never stored or served. Only the operator reopens, so O-5 stays closed; Step 5 already states TTM NI as a computation from `query_fundamentals` historical rows.
- **Floor status:** no Floor breach.
- **Uncovered `@AC` changes (no operator decision covers them):** CHANGE to this feature's `@AC-2`. Covered CHANGE: `@AC-1`, `@AC-3`, `@AC-5`. PRESERVE: `@AC-4` here, `@AC-1` and `@AC-9 @feature-211`, `@AC-1 @feature-223`, `@AC-3 @feature-222`, `@AC-3` and `@AC-4 @feature-216`.
- **Needed from the operator to resume:** confirm the `@AC-2` handling (O-18), accept the D/E and P/B blast radius (O-16), rule on P-1, and decide the slug. O-17 is for the proposer in round 4.
- **Not in this feature:** the steer to raise the ingest concurrency cap belongs to a peer feature. Step 5 stays sequential, one chunk polled to terminal before the next, and does not rely on it.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. The O-2 blocker is lifted: sec.gov was reachable from this mediator step, so I fetched LYFT companyfacts and finished the trace. One blocking item remains (the changed-rows audit). All code paths are under `services/xstockstrat-marketdata` unless stated.\n\n**Trace result (from `https://data.sec.gov/api/xbrl/companyfacts/CIK0001759509.json`, fetched 2026-11-15, latest filing 10-Q filed 2026-11-06).** Raw copy: `/tmp/claude-0/-home-user-xstockstrat/b9beef3a-b1fd-574d-9163-a4110f27ee7a/scratchpad/sec/lyft.json` (scratch only, may be cleared; re-fetch by CIK). Nothing is committed.\n- **Root cause confirmed.** In the fy2026/Q3 bucket the first `StockholdersEquity` fact is 767,016,000 with `end` 2024-12-31, the opening balance of the prior-year roll-forward. First-seen (`internal/edgar/edgar_client.go:357-364`) takes it.\n- **The stored 3.66 reproduces exactly.** `trailingNetIncome` sums four quarters, n=4: derived Q4-2025 2,755,053,000 (FY2025 2,844,008,000 minus 2,567,000, 40,314,000 and 46,074,000), plus 14,250,000, 50,294,000 and -9,731,000. Total 2,809,866,000. Divided by 767,016,000 that is 3.6634.\n- **The TTM numerator is genuine.** FY2025 net income is 2,844,008,000 (diluted EPS 6.81) and equity rose from 573,035,000 (2025-09-30) to 3,273,523,000 (2025-12-31).\n- **A quarter-end instant exists.** Equity at 2026-09-30 is 2,980,873,000, exactly assets 9,280,523,000 minus liabilities 6,299,650,000. Neither redesign trigger tripped.\n- **O-10 answered.** 2,567,000 is Q1-2025 net income (2025-01-01 to 2025-03-31), a comparative column first-seen in the three 2026 quarterly buckets.\n- **Adversary's prediction confirmed.** 388,668,000 is the 2022-12-31 equity, the start of the FY2025 10-K roll-forward.\n- **Restated acceptance literals (O-1, operator ruling).**\n\n| Scenario | Period | Inputs | Corrected roe |\n|---|---|---|---|\n| @AC-1, @AC-5 | Q3-2026 | TTM NI 2,809,866,000 / equity 2,980,873,000 | 0.942632 |\n| @AC-3 | FY2025 | NI 2,844,008,000 / equity 3,273,523,000 | 0.868791 |\n\nThe product-spec 'low single-digit' claim, the defect-report premise, the 28,070,000 / 767,000,000 Givens and the title are restated to match. The slug is the operator's call.\n\n**Step 1: own-period selection in `FetchHistorical` (`edgar_client.go:290`).**\n- Replace first-seen (`:357-364`) with collect-then-select, keyed by (metric, unit, `end`), earliest-filed per key (D-7).\n- Anchor: max `end` across all units of the `StockholdersEquity`, `Assets` and `Liabilities` candidates (D-6); each unit selects at that date, so `voteCurrency` (`:259`) is unaffected.\n- Instants (equity, assets, liabilities, debt tags): keep only `end == anchor` (D-3, D-4).\n- Flows (`net_income`, `revenue`, `eps`, `eps_basic`), uniform per the operator: `end == anchor` when the bucket has an anchor, else absent; per-metric latest `end` only when there is no anchor.\n- Revenue order of operations: filter on `end == anchor`, then tag precedence (`Revenues` over `RevenueFromContractWithCustomerExcludingAssessedTax`, `:189-190`), then earliest-filed. LYFT shows this matters: the two tags differ (FY2025 6,316,261,000 against 5,895,475,000) and the 2026 filings carry only `Revenues`.\n- Unchanged: `shares` (D-9), `periodEnd` (`:350-352`), `buildPeriod`, `annualizeQuarterlyROE`, `trailingNetIncome`, the range filter (`:371-377`).\n- Bump `DerivationVersion` to 2 (`:524`) and update `derivationGolden`.\n\n**Step 2: strip derivation-owned keys in the re-derive (D-8).** One exported list in `internal/source`, used by the `buildPeriod` spill and by `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:795-797`).\n\n**Step 3: tests (RED first).**\n- Commit the LYFT fixture here, not at the design gate: `internal/edgar/testdata/lyft_companyfacts.json`, trimmed by tag only (all units and all entries of the mapped `flowTags`/`instantTags`, including `dei` `EntityCommonStockSharesOutstanding`). Trimming by date or filing breaks `trailingNetIncome`.\n- LYFT assertions: Q3-2026 equity 2,980,873,000 and roe 0.942632; FY2025 roe 0.868791.\n- Synthetic cases: three equity instants in a 10-Q; three annual `NetIncomeLoss` columns in a 10-K; anchor miss giving nil ROE and D/E; a flow present only at the prior-year date; `Revenues` present only at the prior-year date with the other tag at the anchor; a later-dated `Liabilities` instant shifting the anchor.\n- pgxmock: update `internal/repository/marketdata_repo_test.go:573-584` and add a strip test.\n- design.md must list each `edgar_client_test.go` and `ttm_roe_test.go` assertion touching an instant or flow, with its anchor date (O-15 still open).\n\n**Step 4: additive work (D-5).** Finnhub and FMP table tests; comment-only `roe` unit lines at `packages/proto/marketdata/v1/marketdata.proto:233`, `:283` plus `./scripts/buf-gen.sh`; `docs/fundamentals.md`; `shares` residual logged in the marketdata findings file.\n\n**Step 5: post-deploy on staging.**\n1. Confirm `marketdata.fundamentals.history.enabled = true` via `get_config`.\n2. Symbol source: `SELECT DISTINCT symbol FROM marketdata.fundamentals_history ORDER BY symbol;` through `docs/runbooks/operator-db-access.md`.\n3. Start: `SELECT min(period_end) FROM marketdata.fundamentals_history;`, passed as an explicit `start`.\n4. **Before the first chunk (not yet in the proposal, see blocking objection):** export a read-only CSV keyed on (`symbol`, `fiscal_period`, `period_type`) with `eps`, `roe`, `debt_to_equity`, `pe_ratio`, `pb_ratio` and the `extra_metrics` revenue, net_income, equity, assets and liabilities keys.\n5. Chunks of at most 50 symbols (`services/xstockstrat-agent/app/tools.py:1558`, `:1570`), one `trigger_backfill(symbols, data_kind=\"fundamentals\", start, overwrite=true)` each, polled to terminal before the next. This does not depend on any raised ingest concurrency cap.\n6. Verify: no rows below `derivation_version` 2; LYFT, AXP and AAPL pass `equity ~= assets - liabilities` and `roe x equity ~= TTM NI`, where TTM NI is computed from `query_fundamentals` historical rows (Q1 to Q3 `net_income` plus Q4 as FY minus Q1 to Q3, inside the 350-day window). For LYFT that is 2,809,866,000.\n7. Audit: per metric (net income, revenue, EPS, ROE, D/E) report rows changed, rows gone to nil and the largest relative delta, diffed against the step-4 CSV. D-10's nil threshold (proposed 5%) escalates to the operator.\n8. Record PIT drift (@AC-9 @feature-211), the stale P/B and P/E residual on anchor-miss rows, and why @AC-4 @feature-216 holds (overwrite touches only the price-join columns, `marketdata_repo.go:769-773`).",
    "open_objections": [
      {
        "text": "[operator decision 2026-11-15, P-03] The operator required a post-deploy audit of the rows whose net income, revenue or EPS change. The proposal audits only `roe`/`debt_to_equity` going value-to-nil, and `RederiveHistoricalFundamentals` overwrites in place (marketdata_repo.go:795-797), so the pre-backfill values are lost after the first chunk. The proposer must add the pre-backfill read-only CSV export keyed on the triple PK and a per-metric changed / nil'd / largest-delta report with escalation thresholds.",
        "blocking": true
      },
      {
        "text": "[C-15, operator] @AC-2 also binds `Then 0.0366` per provider path. The operator ruling names only @AC-1, @AC-3 and @AC-5. Keep the Finnhub and FMP rows on synthetic percent inputs and restate or drop any EDGAR row; the operator must confirm.",
        "blocking": false
      },
      {
        "text": "[C-16 @AC-4 @feature-216, fails.md shared basis] Changing EPS changes P/E through `accumulateTTM` (marketdata_service.go:2364, :2511), and `mergePrice` never goes value-to-nil (:2418). Name `pe_ratio` in the stale residual and in the @AC-4 rationale, and add `eps` going to nil to the nil-delta count.",
        "blocking": false
      },
      {
        "text": "Revenue precedence order is unstated in the proposal: it must be filter on `end == anchor`, then tag precedence, then earliest-filed, with a synthetic test where `Revenues` exists only at the prior-year date. LYFT's two revenue tags differ by about 7%, so the order changes stored values.",
        "blocking": false
      },
      {
        "text": "[C-13, P-06] Fixture handling: trim by tag only (all units, all entries, including `dei` shares), and commit it in the Step-3 RED step rather than at the design gate.",
        "blocking": false
      },
      {
        "text": "A later-dated instant under equity, assets or liabilities shifts the anchor (D-6). Add a synthetic 10-Q with a later `Liabilities` instant so the resulting nil is pinned by a test.",
        "blocking": false
      },
      {
        "text": "[FR-5 reach] Step 5 covers staging only. Production v1 rows keep the wrong `roe` until re-backfilled. Add a production step with the same symbol source, start and chunking, one chunk at a time.",
        "blocking": false
      },
      {
        "text": "[O-15] design.md must list each feature-211/223 assertion in `edgar_client_test.go` and `ttm_roe_test.go` that touches an instant or a flow, with its anchor date. The proposer rechecked only `:293`.",
        "blocking": false
      },
      {
        "text": "[O-16, operator] D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'. Not yet explicitly accepted.",
        "blocking": false
      },
      {
        "text": "[new, from the trace] `periodEnd` (edgar_client.go:350-352) takes the max `end` over all mapped tags including `dei` `EntityCommonStockSharesOutstanding`, whose LYFT Q3-2026 fact ends 2026-10-30 and FY2025 fact ends 2026-02-05. The stored `period_end` may therefore be the cover-page date, not the quarter end. Read from code, not checked against stored rows. The proposer should confirm and log it with the `shares` residual; the test literals and the TTM-window check must use the stored value.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4 (feature 340)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-1 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1 @feature-223",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-222",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Unit rescale of ROE (R-1): the EDGAR ratio is already a fraction; the trace reproduces 3.6634 from fraction inputs.",
      "Flow-based `statementEnd` anchor (R-2), first-seen fallback (R-3), balance-identity guard as the fix (R-4), SQL migration or overwrite as the ROE repair (R-5): all remain locked.",
      "Per-metric latest-`end` flows untied to the anchor (R-6): not reintroduced; latest-end applies only to buckets with no anchor.",
      "Restricting the flow fix to `net_income` only: the operator ruled uniform scope across net income, revenue and EPS.",
      "Logging revenue tag ties as a residual instead of a fixed precedence: uniform scope already rewrites revenue, and LYFT's two tags differ by about 7%, so determinism is worth one comparison.",
      "Sorting each unit's instant slice by `end` descending so first-seen becomes latest (adversary r3): smaller diff, but it silently takes a subsequent-event instant, leaves flows on the old basis and contradicts D-6/D-7.",
      "Serving TTM net income as a new `extra_metrics.ttm_net_income` key (adversary r3): a new served key is scope creep (C-18); the check is stated as a computation from historical rows instead.",
      "Pinning an estimated ROE ('about 0.8' or 'about 0.86') as the acceptance value: the fixture gives 0.942632 for Q3-2026 and 0.868791 for FY2025.",
      "Committing the fixture at the design gate: it belongs to the Step-3 RED step.",
      "LYFT-only or staging-only re-backfill as the whole repair: every EDGAR filer and production rows carry the same defect."
    ],
    "open_risks": [
      "A corrected LYFT ROE of 0.94 still looks implausible to a trader while being correct; it comes from a one-off 2.84B FY2025 net income.",
      "The pinned literals were computed in this step from a live fetch that is not committed; the Step-3 fixture must reproduce them or the literals are re-derived.",
      "`end == anchor` for flows yields nils for any filer whose flow end and balance-sheet date differ; only LYFT, AXP and AAPL are tested.",
      "A later-dated instant under one of the three anchor tags nulls the real period's values until the audit catches it.",
      "Uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer; PIT backtests and screens drift.",
      "P/B and P/E stay stale on anchor-miss rows because the price-join never goes value-to-nil.",
      "The stored `period_end` may be the dei cover-page date rather than the quarter end; unverified against stored rows.",
      "The changed-rows audit needs a pre-backfill export that must run before the first chunk; if skipped, the old values cannot be recovered.",
      "The audit runs after the version bump and cannot veto it; rollback is another bump plus a full re-backfill.",
      "Production rows stay wrong until a production re-backfill is run.",
      "The staging DB-access path and `fundamentals.history.enabled` state were not verified.",
      "`shares` map-iteration nondeterminism remains (D-9)."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-01",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "F-06",
      "MARKETDATA-11"
    ],
    "rationale": "The design is close to approvable. One blocking objection remains and it is small.\n\n**The trace is done.** The proposer declared O-2 a blocker because its tools had no network. sec.gov was reachable from this step, so I fetched LYFT companyfacts and ran the numbers against the code I read at `edgar_client.go:296-380` and `:405-495`. The stored 3.6634 reproduces exactly as TTM net income 2,809,866,000 over the 2024-12-31 equity 767,016,000. The working hypothesis held, neither redesign trigger tripped, and the adversary's roll-forward prediction was confirmed. I committed nothing; the fixture commit stays in the Step-3 RED step.\n\n**What this closes.** O-2 and O-10 by the trace. O-1 by the operator ruling plus literals from the real filing (0.942632 and 0.868791, not the estimated 0.8). O-4 by the operator's uniform-scope ruling. O-6, O-7 and O-11 by the Step 5 procedure, which the adversary accepted. O-12, O-13 and O-14 by the proposer's acceptance.\n\n**Why it is still blocked.** The operator's ruling on O-4 came with a post-deploy audit of changed rows. The proposal audits only value-to-nil on two ratios and names no pre-backfill artifact, although the re-derive overwrites in place. I put the adversary's CSV export into Step 5 but left the objection open, because the proposer has not answered it.\n\n**Other calls.**\n- I adopted the adversary's revenue ordering and its extra synthetic tests. The LYFT data shows the two revenue tags differ, so ordering is not cosmetic.\n- @AC-2 is marked as an uncovered CHANGE: the ruling names only @AC-1, @AC-3 and @AC-5.\n- The adversary's REOPEN O-5 petition carries new evidence (the check's operand is never stored). Only the operator reopens, so O-5 stays closed; the narrow remedy is already written into Step 5 as a computation.\n- I found one new item while tracing: `period_end` may take the dei cover-page date. Raised as non-blocking.\n- The user's steer to raise the ingest concurrency cap belongs to a peer feature; Step 5 stays sequential and does not rely on it.\n\nThe approach honors D-1 to D-10 and reintroduces none of R-1 to R-9. The operator steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Root cause traced on the real filing: the EDGAR quarterly path pairs a genuine TTM net income (2,809,866,000, n=4, including a derived Q4-2025 of 2,755,053,000) with a first-seen equity of 767,016,000 dated 2024-12-31; the Q3-2026 quarter-end equity is 2,980,873,000.",
          "evidence": "SEC companyfacts CIK0001759509 fetched 2026-11-15; edgar_client.go:357-364, :411-470, :475-493. 2,809,866,000 / 767,016,000 = 3.6634 matches staging."
        },
        {
          "text": "Acceptance literals are restated from the LYFT filing: @AC-1 and @AC-5 roe 0.942632 (2,809,866,000 / 2,980,873,000); @AC-3 FY2025 roe 0.868791 (2,844,008,000 / 3,273,523,000). The product-spec claim, defect-report premise and title are restated to match.",
          "evidence": "Operator ruling 2026-11-15 (design gate, O-1); SEC companyfacts CIK0001759509."
        },
        {
          "text": "Flow selection is uniform across `net_income`, `revenue`, `eps` and `eps_basic`: keep `end == anchor` when the bucket has an anchor, else absent; per-metric latest `end` only when the bucket has no anchor.",
          "evidence": "Operator ruling 2026-11-15 (O-4 uniform scope); proposer r3 accepted O-12; edgar_client.go:187-193."
        },
        {
          "text": "The anchor is the max `end` across all units of the three balance-sheet tags, with per-unit selection at that date.",
          "evidence": "Proposer r3 accepted O-13; edgar_client.go:259-276."
        },
        {
          "text": "Revenue uses a fixed tag precedence: `Revenues` over `RevenueFromContractWithCustomerExcludingAssessedTax` at the same (unit, `end`).",
          "evidence": "Proposer r3; edgar_client.go:189-190, :305-306. LYFT FY2025: 6,316,261,000 against 5,895,475,000."
        },
        {
          "text": "The staging re-backfill enumerates symbols with `SELECT DISTINCT symbol FROM marketdata.fundamentals_history`, passes `start = min(period_end)`, and sends chunks of at most 50 symbols with `overwrite=true`, each polled to terminal before the next, after confirming `fundamentals.history.enabled`.",
          "evidence": "Operator steer O-6/O-7; marketdata.proto:309-314; agent tools.py:1558, :1565-1570; edgar_client.go:371-376. Adversary r3: answered."
        },
        {
          "text": "The LYFT fixture is trimmed by tag only and committed in the Step-3 RED step, not at the design gate.",
          "evidence": "Adversary r3 (C-13, P-06); `trailingNetIncome` needs all NetIncomeLoss facts (edgar_client.go:433-453)."
        }
      ],
      "new_rejected": [
        {
          "text": "Restricting the period-selection fix to `net_income` only.",
          "why": "The operator ruled uniform scope across net income, revenue and EPS."
        },
        {
          "text": "Logging revenue tag ties as a residual instead of adding a fixed precedence.",
          "why": "Uniform scope already rewrites revenue and the two tags carry different values, so nondeterminism would change stored revenue between runs."
        },
        {
          "text": "Sorting each unit's instant slice by `end` descending so first-seen becomes latest.",
          "why": "It silently takes a subsequent-event instant, leaves flows on the old basis and contradicts D-6 and D-7."
        },
        {
          "text": "Serving TTM net income as a new `extra_metrics` key to make the post-deploy check observable.",
          "why": "A new served key is scope creep (C-18); the check is stated as a computation from historical rows."
        },
        {
          "text": "Pinning an estimated ROE (about 0.8 or 0.86) as an acceptance value.",
          "why": "The real filing gives 0.942632 and 0.868791; estimates repeat the placeholder-figure failure in fails.md 2026-11-04."
        }
      ],
      "new_objections": [
        {
          "text": "The operator-required post-deploy audit of changed net income, revenue and EPS rows is missing: add a pre-backfill read-only CSV export keyed on (`symbol`, `fiscal_period`, `period_type`) and a per-metric changed / nil'd / largest-delta report with escalation thresholds (marketdata_repo.go:795-797 overwrites in place).",
          "blocking": true
        },
        {
          "text": "@AC-2 binds `Then 0.0366` per provider path and is not named in the operator's restatement ruling; keep vendor rows synthetic, restate or drop any EDGAR row, and get operator confirmation.",
          "blocking": false
        },
        {
          "text": "P/E goes stale like P/B when EPS loses its anchor (marketdata_service.go:2364, :2418, :2511); name `pe_ratio` in the residual and the @AC-4 @feature-216 rationale and count `eps` going to nil.",
          "blocking": false
        },
        {
          "text": "Revenue precedence must run after the `end == anchor` filter and before earliest-filed, with a synthetic test where `Revenues` exists only at the prior-year date.",
          "blocking": false
        },
        {
          "text": "Add a synthetic 10-Q with a later-dated `Liabilities` instant so the anchor-shift nil is pinned by a test.",
          "blocking": false
        },
        {
          "text": "Step 5 covers staging only; add a production re-backfill step with the same symbol source, start and chunking, one chunk at a time.",
          "blocking": false
        },
        {
          "text": "`periodEnd` (edgar_client.go:350-352) includes `dei` share-count facts, so the stored `period_end` may be the cover-page date (LYFT Q3-2026: 2026-10-30); confirm against stored rows and log with the `shares` residual.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Operator ruled the restatement; literals pinned from the real LYFT filing: 0.942632 for @AC-1/@AC-5 and 0.868791 for @AC-3."
        },
        {
          "id": "O-2",
          "how": "Trace completed by the mediator from live SEC companyfacts: 767,016,000 is the 2024-12-31 equity, the 2026-09-30 instant is 2,980,873,000, and the TTM sum 2,809,866,000 (n=4) is genuine."
        },
        {
          "id": "O-4",
          "how": "Operator ruled uniform flow scope; the flow rule is specified. The required changed-rows audit is tracked as a new objection."
        },
        {
          "id": "O-6",
          "how": "Step 5 now re-backfills the stored universe, checks `fundamentals.history.enabled` and records PIT drift; production reach is tracked as a new objection."
        },
        {
          "id": "O-7",
          "how": "Step 5 runs `overwrite=true` across the universe and states why @AC-4 @feature-216 holds (overwrite touches only price-join columns)."
        },
        {
          "id": "O-10",
          "how": "Confirmed from the filing: 2,567,000 is Q1-2025 net income, a comparative column first-seen in the three 2026 quarterly buckets."
        },
        {
          "id": "O-11",
          "how": "Step 5 names the symbol source (DISTINCT query), 50-symbol chunking and an explicit `start` at `min(period_end)`."
        },
        {
          "id": "O-12",
          "how": "The proposer accepted `end == anchor` for flows with latest-end only when no anchor exists."
        },
        {
          "id": "O-13",
          "how": "The proposer accepted the cross-unit anchor with per-unit selection."
        },
        {
          "id": "O-14",
          "how": "The proposer chose a fixed `Revenues`-first tag precedence; the ordering detail is tracked as a new objection."
        }
      ],
      "reopen_petitions": [
        {
          "target": "O-5",
          "evidence": "Adversary r3: the closing check `roe x equity ~= TTM NI` uses an operand that is never stored or served; `annualizeQuarterlyROE` keeps only the ratio (edgar_client.go:491-492) and `extra_metrics` holds only single-period `net_income` (:596). Remedy asked: state TTM NI as a computation from `query_fundamentals` historical rows.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 4)

`/sdd-design fix-fundamentals-roe-unit` full debate halted at the approval gate after round 4 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-24, R-1..R-17, O-1..O-30, P-1).

### Open Threads

- **Approach (code settled, post-deploy procedure not):** Steps 1 to 4 are agreed by both sides. `FetchHistorical` moves from first-seen to collect-then-select (D-7) on the balance-sheet anchor (D-6, D-14); instants and flows keep only `end == anchor` (D-3, D-4, D-13); revenue runs anchor filter, then `Revenues`-first precedence, then earliest-filed (D-15, D-18); the re-derive strips derivation-owned keys from one exported list in `internal/source` (D-8); `DerivationVersion` goes 1 → 2 (D-2). The LYFT fixture lands in the Step-3 RED step at `services/xstockstrat-marketdata/internal/edgar/testdata/lyft_companyfacts.json` (D-17, D-21) with two more synthetic tests (D-22). `periodEnd` is unchanged; the cover-page `period_end` and stale `pe_ratio` / `pb_ratio` on anchor-miss rows are logged as residuals with `shares` (D-23).
- **Step 5 as the mediator rewrote it (the proposer has not accepted it yet):** three lanes, each with its own export, backfill and audit: homelab staging, DO staging (`xstockstrat-staging`), DO production (`xstockstrat-production`). Per lane: preconditions (config flag, DISTINCT symbol list, `min(period_end)`, per-symbol `count(*)`); a pre-export through `query_fundamentals` historical JSON mode (D-19, D-24) with a completeness gate before any chunk; a canary chunk of LYFT, AXP and AAPL; then chunks of at most 50 symbols, each audited before the next; the closing TTM check on the three controls plus a stated sample (D-20). Raw exports stay out of git; only the audit report is committed (R-16).
- **Strongest open objection — O-25 (blocking, needs the operator):** the production lane has no read path. Only the `xstockstrat_staging` and `xstockstrat_homelab_staging` MCPs are reachable. The choice is a production MCP connector as a named precondition, or a read-only SQL `\copy` through `docs/runbooks/operator-db-access.md` for production only. The operator's "use the mcp to read the values" points one way and "choose the one with less friction" may point the other, so the mediator did not choose.
- **Other blocking objections (for the proposer in round 5):** O-24 (drop the "one run covers both" conditional and list the three lanes; DO staging and production are separate databases on one cluster, `.do/app.yaml:696-697` and `.do/app.dev.yaml:698-699`, and no marketdata table has an environment column, R-15) and O-26 (the escalation rules cannot pause anything when the audit runs after all chunks; accept the per-chunk audit with the control-symbol canary or give another real veto point).
- **Non-blocking, still open:** O-27 (audit rule calibration: rule (b) as a pre-versus-post failure rate, rule (c) report-only or canary-calibrated, rule (a) without `pe_ratio` / `pb_ratio`, R-17), O-28 (TTM check scales by 4/n, skips nil quarters, runs on controls plus a sample), O-29 (completeness gate backed by per-symbol `count(*)`; new-filing rows reported separately from "filled"), O-30 (raw exports out of git), O-16 (operator: D/E and P/B change for every EDGAR filer), O-18 (operator: `@AC-2` keeps the Finnhub and FMP rows as synthetic unit guards, drops the EDGAR row, retitled "every vendor path serves ROE as a fraction").
- **Closed this round:** O-15, O-17, O-19 to O-23. O-5 was reopened by the operator steer and closed again in the same round: the closing check states TTM NI as a computation from `query_fundamentals` historical rows (LYFT Q3-2026: 2,755,053,000 + 14,250,000 + 50,294,000 − 9,731,000 = 2,809,866,000). Its refinements are tracked as O-28.
- **Operator answers not yet mapped:** the ten answers relayed with this run are unlabeled. Which answer reopened O-5 (P-1), which confirms `@AC-2` (O-18), which accepts the D/E and P/B blast radius (O-16), and how "use the mcp" and "less friction" resolve O-25 are not recorded. None of "Agreed", "I confirm it" or "Keep it" is treated as a sign-off for O-16 or O-18. P-1's verdict cell in `debate.md` still reads `pending user`.
- **Floor status:** no Floor breach.
- **Uncovered `@AC` changes (no operator decision covers them):** CHANGE to this feature's `@AC-2`. Covered CHANGE: `@AC-1`, `@AC-3`, `@AC-5`. PRESERVE: `@AC-4` here, `@AC-1` and `@AC-9 @feature-211`, `@AC-1 @feature-223`, `@AC-3 @feature-222`, `@AC-3` and `@AC-4 @feature-216`.
- **Needed from the operator to resume:** pick the production read path (O-25), confirm the `@AC-2` handling (O-18), accept the D/E and P/B blast radius (O-16), and label which earlier answer covers each. O-24 and O-26 are for the proposer.
- **Main risks carried:** the version bump cannot be vetoed by the audit, so the canary chunk is the only veto before the universe is rewritten; a skipped or incomplete pre-export makes the changed-rows audit unrecoverable for that lane; LYFT, AXP and AAPL may not all be stored in every lane; production rows stay wrong until a read path is chosen.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round-4 synthesis. Steps 1 to 4 are agreed by both sides and follow the register. Step 5 is corrected below: three of the adversary's objections to it are blocking and stay open because the proposer has not yet answered them. Paths are under `services/xstockstrat-marketdata` unless stated.\n\nI checked the adversary's key facts in the repo:\n- **Databases:** `.do/app.yaml:696-697` is cluster `xstockstrat`, db `xstockstrat-production`; `.do/app.dev.yaml:698-699` is the same cluster, db `xstockstrat-staging`.\n- **No environment column:** no marketdata migration mentions `environment`.\n- **Price-join merge:** `internal/service/marketdata_service.go:2418` says it is \"NEVER value→nil\".\n- **Short-history ROE:** `internal/edgar/edgar_client.go:491` computes `sum * 4 / float64(n) / eq`.\n\n**Step 1: own-period selection in `FetchHistorical` (`internal/edgar/edgar_client.go:290`).**\n- Replace first-seen (`:357-364`) with collect-then-select keyed by (metric, unit, `end`), earliest-filed per key (D-7).\n- Anchor: max `end` across all units of `StockholdersEquity`, `Assets` and `Liabilities` (D-6, D-14).\n- Instants and debt tags: keep only `end == anchor` (D-3, D-4).\n- Flows (`net_income`, `revenue`, `eps`, `eps_basic`): `end == anchor` when the bucket has an anchor, else absent; per-metric latest `end` only when there is no anchor (D-13).\n- Revenue order: (1) filter on `end == anchor`, (2) `Revenues` over `RevenueFromContractWithCustomerExcludingAssessedTax` (`:189-190`, D-15), (3) earliest-filed.\n- Unchanged: `shares` (D-9), `periodEnd` (`:350-352`), `buildPeriod`, `annualizeQuarterlyROE`, `trailingNetIncome`, the range filter (`:371-377`).\n- Bump `DerivationVersion` 1 to 2 (`:524`) and update `derivationGolden` (D-2).\n\n**Step 2 (D-8).** One exported derivation-owned key list in `internal/source`, used by the `buildPeriod` spill and by the strip in `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:795-797`).\n\n**Step 3: tests, RED first (D-17).**\n- Fixture: `internal/edgar/testdata/lyft_companyfacts.json`, trimmed by tag only, committed in this step.\n- Pinned literals (D-12):\n  - Q3-2026: equity 2,980,873,000; roe **0.942632** (2,809,866,000 / 2,980,873,000).\n  - FY2025: roe **0.868791** (2,844,008,000 / 3,273,523,000).\n- Synthetic cases:\n  - three equity instants in one 10-Q;\n  - three annual `NetIncomeLoss` columns in one 10-K;\n  - an anchor miss gives nil ROE and nil D/E;\n  - a flow present only at the prior-year date gives nil;\n  - `Revenues` only at the prior-year date with the other tag at the anchor selects the anchor value;\n  - a later-dated `Liabilities` instant moves the anchor, so equity, ROE and D/E are nil.\n- pgxmock: update `internal/repository/marketdata_repo_test.go:573-584` and add a strip test.\n- Existing tests (proposer's recheck):\n  - `cannedCompanyFacts` tests (`edgar_client_test.go:91`, `:125`, `:204`) have no balance-sheet tag and stay green.\n  - `axpFacts` Q2-2026 `net_income` moves from 1,100e6 to 2,885e6, so `derivationGolden` changes by design; ROE 0.353 is unchanged.\n  - `dualCurrencyCF` `:280` and `:293` sit on the anchor date and stay green.\n  - design.md lists the remaining feature-211/223 assertions with their anchor dates; any test whose flow `end` differs from its anchor is a C-16 finding.\n\n**Step 4: additive (D-5).**\n- Finnhub and FMP table tests.\n- Comment-only `roe` unit lines at `packages/proto/marketdata/v1/marketdata.proto:233`, `:283`, plus `./scripts/buf-gen.sh`.\n- `docs/fundamentals.md`.\n- Residuals in the marketdata findings file: `shares`, the `period_end` cover-page date, and stale `pb_ratio` / `pe_ratio` on anchor-miss rows.\n\n**Step 5: post-deploy, once per lane.**\n\nThere are three independent databases, so three lanes, run in this order. Each lane gets its own export, backfill and audit; none covers another.\n\n| Lane | Database | Read path |\n|---|---|---|\n| 1. Homelab staging (the traced environment) | homelab DB | `xstockstrat_homelab_staging` MCP |\n| 2. DO staging | `xstockstrat-staging` | `xstockstrat_staging` MCP |\n| 3. DO production | `xstockstrat-production` | none reachable yet (open blocking objection) |\n\nPer lane:\n1. **Preconditions.**\n   - `get_config` shows `marketdata.fundamentals.history.enabled = true`.\n   - Read-only SQL through `docs/runbooks/operator-db-access.md` gives the D-16 `SELECT DISTINCT symbol` list, `min(period_end)`, and a per-symbol `count(*)`.\n2. **Pre-export, before any chunk.**\n   - For each symbol, call `query_fundamentals(symbol, mode=\"historical\")` in JSON mode and walk `page_token` (limit 50, `services/xstockstrat-agent/app/tools.py:469-510`).\n   - JSON, not CSV: `_historical_to_csv` (`tools.py:373`) drops `extra_metrics`.\n   - Flatten to rows keyed on (`symbol`, `fiscal_period`, `period_type`).\n   - Columns: `period_end`, `filed_date`, `eps`, `roe`, `debt_to_equity`, `pe_ratio`, `pb_ratio`, and the `extra_metrics` keys `revenue`, `net_income`, `stockholders_equity`, `assets`, `liabilities`, `total_debt`.\n   - An empty cell means the metric is in `missing_metrics`.\n   - **Completeness gate:** every symbol in the DISTINCT list is present with a row count equal to its `count(*)`. No chunk runs until this passes.\n   - The raw exports stay out of git (operator storage). Only the audit report is committed to the feature directory.\n3. **Canary chunk.** Chunk 1 is LYFT, AXP and AAPL only: `trigger_backfill(symbols, data_kind=\"fundamentals\", start, overwrite=true)`, polled to terminal. Then re-export those symbols and run the control checks:\n   - LYFT Q3-2026 roe 0.942632 and FY2025 roe 0.868791;\n   - `equity ≈ assets − liabilities` on the three controls;\n   - the closing TTM check (item 6).\n   Any failure stops the lane before any other symbol is rewritten.\n4. **Remaining chunks, audited one at a time.** At most 50 symbols each (D-16). After each chunk reaches terminal, re-export its symbols, diff against the pre-export, and check the escalation rules before starting the next chunk.\n5. **Audit report.** Per metric (`net_income`, `revenue`, `eps`, `roe`, `debt_to_equity`, `pe_ratio`, `pb_ratio`):\n   - rows changed (relative delta > 1e-6);\n   - rows nil'd, and rows filled;\n   - rows that appear only after the backfill (new filings), counted separately from \"filled\";\n   - the 10 largest relative deltas, with keys.\n   Escalation rules, which pause before the next chunk:\n   - (a) Nil'd rows exceed 5% of the previously non-nil rows for `net_income`, `revenue`, `eps`, `roe` or `debt_to_equity`. `pe_ratio` and `pb_ratio` are excluded because they can never go to nil.\n   - (b) The share of rows failing `|equity − (assets − liabilities)| ≤ 1% × |assets|` does not fall from pre to post. It is a hard assertion only on the three controls (R-4).\n   - (c) Annual revenue churn per symbol is report-only; its threshold is set from the canary's observed deltas.\n   - (d) Any control check fails.\n   Stale-ratio count: rows where `eps` went to nil and `pe_ratio` is unchanged, and rows where `roe` or `debt_to_equity` went to nil and `pb_ratio` is unchanged. This number sizes the residual.\n6. **Closing check (O-5 remedy), on the three controls plus a stated random sample.**\n   - TTM NI is computed from the post-backfill `query_fundamentals` historical rows.\n   - It is the sum of the latest n ≤ 4 quarterly `net_income` values inside the 350-day window, ordered by stored `period_end`.\n   - A missing Q4 is FY minus Q1 to Q3. The sum is scaled by 4/n when n < 4 (`edgar_client.go:491`).\n   - Assert `|roe × equity − TTM NI| ≤ 0.1% × |TTM NI|`.\n   - Skip, do not fail, a row where any needed quarter's stored `net_income` is nil.\n   - LYFT Q3-2026: 2,755,053,000 + 14,250,000 + 50,294,000 − 9,731,000 = 2,809,866,000.\n7. **Finish.**\n   - SQL confirms no row is below `derivation_version` 2 (the column is not on the wire).\n   - Record PIT drift (@AC-9 @feature-211) and the stale-ratio count.\n   - Record why @AC-4 @feature-216 holds: `UpdateHistoricalPriceJoin` sets only the price-join columns (`marketdata_repo.go:772-776`), and `pe_ratio` is recomputed from the new EPS wherever EPS survives.\n\n**Spec restatement.**\n- @AC-1, @AC-3, @AC-5, the product-spec claim, the defect-report premise and the title are restated from the fixture (D-12). The slug stays.\n- @AC-2 proposal: keep the Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row, and retitle to \"every vendor path serves ROE as a fraction\". This still needs operator confirmation.",
    "open_objections": [
      {
        "text": "[P-03/C-11] Step 5's production step assumed one shared table. Production and DO staging are separate databases on one cluster (.do/app.yaml:696-697 `xstockstrat-production`; .do/app.dev.yaml:698-699 `xstockstrat-staging`), and homelab staging has its own DB. The proposer must drop the 'one run covers both' conditional and list three lanes (homelab staging, DO staging, DO production), each with its own pre-export, backfill, post-export and audit.",
        "blocking": true
      },
      {
        "text": "[P-03, fails.md 2026-11-10] The production lane has no read path: only the `xstockstrat_staging` and `xstockstrat_homelab_staging` MCPs are reachable. The operator must choose between a production MCP connector as a named precondition and a read-only SQL `\\copy` through docs/runbooks/operator-db-access.md for production only. The user's 'use the mcp to read the values' and 'choose the one with less friction' answers are unlabeled and must be mapped in context.md, not picked silently.",
        "blocking": true
      },
      {
        "text": "[C-11] The escalation rules cannot pause anything as the proposer sequenced them: the post-export and audit run after every chunk has already rewritten its rows in place (marketdata_repo.go:795-797). The proposer must accept a per-chunk audit with a first canary chunk of LYFT, AXP and AAPL, or give another real veto point.",
        "blocking": true
      },
      {
        "text": "[C-11, R-4] Audit rule calibration. Rule (b) as written trips on every filer with noncontrolling or mezzanine equity; make it a pre-versus-post failure-rate comparison, hard only on the three controls. Rule (c)'s 50% annual-revenue threshold is uncalibrated; make it report-only or set it from the canary. Rule (a) must drop `pe_ratio` and `pb_ratio`, which never go to nil (marketdata_service.go:2418), and instead count rows where `eps`, `roe` or `debt_to_equity` went to nil while the ratio stayed unchanged.",
        "blocking": false
      },
      {
        "text": "[C-11] The closing TTM check has two false-fail paths and is too broad: it must scale by 4/n when n < 4 (edgar_client.go:491), skip rows where a needed quarter's stored `net_income` is nil, and run on the three controls plus a stated sample rather than the whole universe.",
        "blocking": false
      },
      {
        "text": "[C-11] The export completeness check must be a gate in the pre-export step, backed by a per-symbol `count(*)` SQL beside the DISTINCT query. Rows that appear only after the backfill (new filings, marketdata_service.go:2373-2388) must be reported separately from 'filled'.",
        "blocking": false
      },
      {
        "text": "[C-18/C-13] The raw pre and post exports must stay out of git; commit only the audit report (counts, top deltas, threshold outcomes).",
        "blocking": false
      },
      {
        "text": "[O-18, operator] @AC-2: the proposer keeps the Finnhub and FMP rows as synthetic unit guards, drops the EDGAR row and retitles the outline. The operator has not confirmed this; the unlabeled 'Agreed' and 'I confirm it' answers must be mapped in context.md first.",
        "blocking": false
      },
      {
        "text": "[O-16, operator] D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'. Not yet explicitly accepted; the audit report will put numbers on it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4 (feature 340)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-1 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1 @feature-223",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-222",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-14 remain locked and none is reintroduced.",
      "One DO-lane run covering both DO staging and production: they are separate databases on one cluster, so each needs its own run.",
      "Running the audit once after all chunks as the escalation gate: by then every row is rewritten in place, so nothing can be paused.",
      "MCP CSV mode for the export: `_historical_to_csv` drops `extra_metrics` and cannot tell nil from zero.",
      "Committing the raw pre and post exports to the feature directory: a universe-wide dump is neither a fixture nor a test; only the audit report is committed.",
      "Running the TTM closing check by hand across the whole universe: it re-implements `trailingNetIncome` in an operator procedure; the controls plus a sample are enough alongside the per-metric rules.",
      "Counting `pe_ratio` and `pb_ratio` in the nil'd-rows threshold: the price-join never goes value to nil, so the count would always be zero.",
      "SQL `\\copy` export for every lane (the proposer's runner-up): not rejected outright; it is the candidate for the production lane, pending the operator's answer."
    ],
    "open_risks": [
      "The version bump cannot be vetoed by the audit; the canary chunk is the only veto before the universe is rewritten, and rollback is another bump plus a full re-backfill.",
      "If the pre-export is skipped or incomplete, the operator-required changed-rows audit cannot be rebuilt for that lane.",
      "LYFT, AXP and AAPL may not all be stored in every lane's universe; the canary needs a per-lane check and a stated substitute.",
      "The production lane cannot be audited until a read path is chosen; production rows stay wrong until then.",
      "The MCP export is one to three paged calls per symbol per lane, twice; a timeout or early pagination stop is caught only by the completeness gate.",
      "`GetHistoricalFundamentals` with no `as_of` is assumed to return every stored period; the T+1 filter (marketdata_repo.go:814) was not checked for the default case.",
      "The escalation thresholds (5% nil'd, 1% balance identity, 0.1% TTM tolerance) are proposals the operator may tune.",
      "`end == anchor` for flows yields nils for any filer whose flow end and balance-sheet date differ; only three filers are tested.",
      "Uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer, so PIT backtests and screens drift.",
      "P/B and P/E stay stale on anchor-miss rows; the audit only sizes this residual.",
      "The stored `period_end` may be the cover-page date; the pre-export confirms it but the code is left unchanged.",
      "A corrected LYFT ROE of 0.94 is right but still looks implausible to a trader.",
      "The pinned literals come from a live fetch that is not committed; the Step-3 fixture must reproduce them.",
      "The operator's ten answers are unlabeled; the mapping of the reopen, the @AC-2 confirmation and the MCP-versus-SQL choice to specific answers is not recorded yet."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-01",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "F-06",
      "MARKETDATA-11"
    ],
    "rationale": "The code design (Steps 1 to 4) is settled; the post-deploy procedure is not. Three blocking objections remain, all on Step 5, and one of them needs an operator answer.\n\n**What the proposal closed.**\n- **O-17:** it adds the pre-backfill export keyed on the triple PK and the per-metric report, as the steer required. I closed it and tracked the sequencing defect separately.\n- **O-5:** reopened by the steer and closed again. TTM NI is now a computation from historical rows, with the LYFT arithmetic shown.\n- **O-15, O-19 to O-23:** each got a concrete answer (recheck with anchor dates, `pe_ratio` in the residual, revenue order, the `Liabilities` test, a production step, `period_end` logged).\n\n**Why it is still blocked.** I verified the adversary's facts in the repo before adopting them.\n- **Three lanes.** DO staging and production are separate databases on one cluster. The proposer's \"one run covers both\" conditional would let an operator skip a lane.\n- **Production read path.** No production MCP is reachable. The user's \"use the mcp\" answer points one way and \"less friction\" may point the other, so I did not choose.\n- **No real pause.** The audit ran after all chunks. I wrote the per-chunk audit and a control-symbol canary into Step 5, but the proposer has not accepted them.\n\n**Other calls.**\n- I adopted the adversary's fixes to rules (a), (b) and (c), the 4/n scaling, the completeness gate and keeping raw exports out of git. They are in the approach, but stay open as non-blocking until the proposer answers.\n- @AC-2 stays an uncovered CHANGE and O-16 stays open. None of the unlabeled answers (\"Agreed\", \"I confirm it\", \"Keep it\") is treated as a sign-off for either.\n- I recorded O-5 as reopened because the steer says so explicitly. The orchestrator should record which user answer that maps to in context.md.\n\nThe approach honors D-1 to D-17 and reintroduces none of R-1 to R-14.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Revenue selection runs in a fixed order: filter on `end == anchor`, then `Revenues`-first tag precedence, then earliest-filed.",
          "evidence": "Proposer r4 Step 1; adversary r4: consistent with D-13 and D-15; edgar_client.go:189-190."
        },
        {
          "text": "The changed-rows audit consists of a read-only pre-backfill export keyed on (`symbol`, `fiscal_period`, `period_type`), taken before any chunk runs, and a per-metric report of rows changed, nil'd, filled and the largest deltas.",
          "evidence": "Operator steer round 4; proposer r4 Step 5; marketdata_repo.go:795-797 overwrites in place."
        },
        {
          "text": "The closing check states TTM net income as a computation from `query_fundamentals` historical rows (latest quarters in the 350-day window, Q4 as FY minus Q1 to Q3); no new served key.",
          "evidence": "Operator steer round 4 reopening O-5; R-13; edgar_client.go:411, :491-492. LYFT: 2,809,866,000."
        },
        {
          "text": "The LYFT fixture path is `services/xstockstrat-marketdata/internal/edgar/testdata/lyft_companyfacts.json`.",
          "evidence": "Operator steer round 4; proposer r4 Step 3; D-17."
        },
        {
          "text": "Step 3 adds two synthetic tests: `Revenues` only at the prior-year date with the other revenue tag at the anchor, and a later-dated `Liabilities` instant that shifts the anchor and nils equity, ROE and D/E.",
          "evidence": "Proposer r4 Step 3 (O-20, O-21); adversary r4 raised no objection."
        },
        {
          "text": "`periodEnd` stays unchanged; the cover-page `period_end` and the stale `pe_ratio` / `pb_ratio` on anchor-miss rows are logged as residuals with `shares`, and checks use the stored `period_end`.",
          "evidence": "Proposer r4 (O-19, O-23); edgar_client.go:350-352; marketdata_service.go:2418. Adversary r4 disputed only how the stale rows are counted."
        },
        {
          "text": "The pre and post exports read through the MCP use `query_fundamentals` historical JSON mode, not CSV mode.",
          "evidence": "services/xstockstrat-agent/app/tools.py:373 (`_historical_to_csv` drops `extra_metrics`); marketdata.proto:288, :291. Not disputed."
        }
      ],
      "new_rejected": [
        {
          "text": "A single DO-lane re-backfill and audit covering both DO staging and production.",
          "why": "They are separate databases on one cluster (.do/app.yaml:696-697, .do/app.dev.yaml:698-699) and no marketdata table has an environment column."
        },
        {
          "text": "Committing the raw pre and post exports to the feature directory.",
          "why": "A universe-wide dump is neither a fixture nor a test (C-13, C-18); only the audit report is committed."
        },
        {
          "text": "Counting `pe_ratio` and `pb_ratio` in the nil'd-rows escalation threshold.",
          "why": "The price-join merge never goes value to nil (marketdata_service.go:2418), so the count is always zero and gives false comfort."
        }
      ],
      "new_objections": [
        {
          "text": "Step 5 must list three lanes (homelab staging, DO staging, DO production), each with its own pre-export, backfill, post-export and audit; DO staging and production are separate databases (.do/app.yaml:696-697, .do/app.dev.yaml:698-699).",
          "blocking": true
        },
        {
          "text": "The production lane has no reachable read path (only the two staging MCPs exist); the operator must choose a production MCP connector as a precondition or a read-only SQL `\\copy` for production only, with the unlabeled user answers mapped in context.md.",
          "blocking": true
        },
        {
          "text": "The escalation rules cannot pause the backfill when the audit runs after all chunks; audit per chunk and make chunk 1 a canary of LYFT, AXP and AAPL.",
          "blocking": true
        },
        {
          "text": "Audit rule calibration: rule (b) must be a pre-versus-post failure-rate comparison (hard only on the controls), rule (c) report-only or canary-calibrated, and rule (a) must replace `pe_ratio` / `pb_ratio` with a count of rows whose `eps`, `roe` or `debt_to_equity` went to nil while the ratio stayed unchanged.",
          "blocking": false
        },
        {
          "text": "The closing TTM check must scale by 4/n when n < 4 (edgar_client.go:491), skip rows with a nil stored quarter, and run on the three controls plus a stated sample only.",
          "blocking": false
        },
        {
          "text": "Export completeness must be a gate before chunk 1, backed by a per-symbol `count(*)` SQL; rows that appear only after the backfill are reported separately from 'filled'.",
          "blocking": false
        },
        {
          "text": "Raw pre and post exports must stay out of git; commit only the audit report.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-5",
          "how": "Reopened by the operator steer and answered: the closing check states TTM NI as a computation from `query_fundamentals` historical rows, with the LYFT arithmetic (2,809,866,000). Refinements to the check are tracked as a new objection."
        },
        {
          "id": "O-15",
          "how": "The proposer rechecked the `cannedCompanyFacts`, `axpFacts` and `dualCurrencyCF` tests with anchor dates, explained the expected `derivationGolden` change, and committed design.md to list the remaining assertions with a C-16 rule."
        },
        {
          "id": "O-17",
          "how": "Step 5 adds the pre-backfill export keyed on the triple PK and a per-metric changed / nil'd / filled / top-delta report with escalation rules; the sequencing and calibration defects are tracked as new objections."
        },
        {
          "id": "O-19",
          "how": "`pe_ratio` is named in the stale residual and the @AC-4 @feature-216 rationale, and `eps` is in the nil count; how the stale rows are measured is tracked as a new objection."
        },
        {
          "id": "O-20",
          "how": "Revenue order is fixed as anchor filter, then tag precedence, then earliest-filed, with a synthetic test."
        },
        {
          "id": "O-21",
          "how": "A synthetic 10-Q with a later-dated `Liabilities` instant is added to Step 3."
        },
        {
          "id": "O-22",
          "how": "The proposer added a production repeat of Step 5; its lane structure and read path are tracked as new blocking objections."
        },
        {
          "id": "O-23",
          "how": "`periodEnd` stays unchanged and is logged with the `shares` residual; checks use the stored `period_end`, which the pre-export confirms."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "O-5"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 5)

`/sdd-design fix-fundamentals-roe-unit` full debate halted at the approval gate after round 5 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-29, R-1..R-19, O-1..O-37, P-1..P-2).

### Open Threads

- **Not approvable yet:** three blocking objections remain, all on Step 5 (O-31, O-32, O-33). Two of them need an operator answer. Steps 1 to 4 (the code change, tests and additive docs) are settled and unchanged from round 4 (D-1 to D-24).
- **Operator answers relayed with this run, verbatim and unlabeled:** "1. Approved", "2. Confirmed", "3. Sign-off the change, amend it", "4. There are no production instances. Staging is enough." Only answer 4 is identifiable; it is recorded as D-25 / R-18. Answers 1 to 3 arrived without the questions they answer, so none is recorded as a sign-off (P-04). "Sign-off the change, amend it" most likely answers the `@AC-2` question (O-18), but the orchestrator holds the question list and must record the mapping here.
- **Approach, Step 5 as rewritten this round:** two independent staging lanes and no production lane (D-25). Lane A is homelab staging (the traced environment, MCP `xstockstrat_homelab_staging`), run first. Lane B is DO staging (`xstockstrat-staging`, MCP `xstockstrat_staging`), run only after lane A ends with no escalation. Each lane has its own pre-export, backfill, post-export and committed audit report (D-29). Per lane: a completeness-gated pre-export taken before the v2 build arrives; a canary chunk of LYFT, AXP and AAPL with absolute hard checks (D-26); a 10-symbol ramp chunk, then chunks of at most 50, each re-exported and audited before the next starts; escalation rules (a) to (d) (D-27); the closing TTM check on the controls plus a seeded 20-symbol sample (D-28). The homelab `xstockstrat_production` database is not touched.
- **Strongest open objection — O-32 (blocking, needs the operator):** the per-chunk veto covers only the operator's own chunks. Once v2 is deployed, any `BackfillFundamentals` call, including `overwrite=false`, re-derives stale rows (`marketdata_service.go:2398-2407`), and the strat-lab backtest skill tells agents to run fundamentals backfills. A `main-dev` merge also puts v2 on DO staging while lane A is still running. The mediator wrote a freeze into Step 5: set `marketdata.fundamentals.history.enabled = false` in both staging environments before the merge, and back to `true` in a lane only for that lane's run, with every flip recorded here. This is a staging config change that blocks other staging fundamentals backfills for the duration (it can collide with peer feature 343), so it needs the operator's consent. The proposer has not accepted it yet.
- **Other blocking objections:**
  - O-31 (operator and proposer): lane A's SQL steps cited `docs/runbooks/operator-db-access.md`, which covers only the DigitalOcean cluster. The homelab database is reached per homelab-edge `docs/runbooks/db-host.md` § Manual access. The operator must state which role lane A uses, because the read-only `admin` role has no allowed hosts (db-host.md:19).
  - O-33 (proposer): rule (b) as written pauses every clean chunk. It must trip only when the post share of rows failing the balance identity is greater than the pre share, leave out rows with nil `assets`, `liabilities` or equity on both sides, and stay hard only on the controls. The corrected wording is in the approach; the earlier wording is locked as R-19.
- **Non-blocking, still open:** O-34 (operator action when the history flag is already false, folded into the freeze), O-35 (no hard "zero rows below `derivation_version` 2" finish gate; list remaining v1 rows by cause), O-36 (canary misses filers with no `Liabilities` tag or material non-controlling interest; the mediator adopted the 10-symbol ramp), O-37 (C-18: why not a read-only SQL `\copy` export per lane), O-16 (operator: D/E and P/B change for every EDGAR filer), O-18 (operator: `@AC-2` keeps the Finnhub and FMP rows as synthetic unit guards, drops the EDGAR row, retitled "every vendor path serves ROE as a fraction").
- **Closed this round:** O-24 to O-30. O-24 and O-25 closed on the operator's production ruling; O-26 to O-30 on the proposer's answers, with the leftover defects carried as O-32, O-33 and P-2.
- **Reopen petitions:** P-2 (new, `pending user`) targets D-20: the adversary wants the TTM check's quarters chosen by `fiscal_period` label instead of the stored `period_end` window, which also amends D-23. Not adopted this round. P-1 (O-5) was reopened by the operator and answered by D-20 in round 4; its verdict cell in `debate.md` still reads `pending user` and the orchestrator should set it to `user reopened`.
- **Floor status:** no Floor breach.
- **Uncovered `@AC` changes (no operator decision covers them):** CHANGE to this feature's `@AC-2`, pending the mapping of relayed answers 1 to 3. Covered CHANGE: `@AC-1`, `@AC-3`, `@AC-5`. PRESERVE: `@AC-4` here, `@AC-1` and `@AC-9 @feature-211`, `@AC-1 @feature-223`, `@AC-3 @feature-222`, `@AC-3` and `@AC-4 @feature-216`.
- **Needed from the operator to resume:** consent to the staging freeze (O-32); the lane A database role and read path (O-31); a ruling on P-2; and a label for each of relayed answers 1 to 3 so O-16 and O-18 can close. O-33 is for the proposer.
- **Main risks carried:** if v2 reaches a lane before its pre-export is taken and the freeze is off, that lane's changed-rows audit cannot be rebuilt; how and when homelab staging receives the v2 build was not checked; rewrites are in place, so rollback is another version bump plus a full re-backfill; the thresholds (5% nil'd, 1% identity, 0.1% TTM, 20-symbol sample) are proposals the operator may tune.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round-5 synthesis. Steps 1 to 4 are unchanged and agreed by both sides (D-1 to D-24). Step 5 is rewritten for two staging lanes and corrected with three adversary fixes that I checked in the repo. Paths are under `services/xstockstrat-marketdata` unless stated.\n\n**Step 1: own-period selection in `FetchHistorical` (`internal/edgar/edgar_client.go:290`).**\n- Replace first-seen (`:357-364`) with collect-then-select keyed by (metric, unit, `end`), earliest-filed per key (D-7).\n- Anchor: max `end` across all units of `StockholdersEquity`, `Assets`, `Liabilities` (D-6, D-14).\n- Instants and debt tags keep only `end == anchor` (D-3, D-4).\n- Flows (`net_income`, `revenue`, `eps`, `eps_basic`): `end == anchor` when the bucket has an anchor, else absent; per-metric latest `end` only with no anchor (D-13).\n- Revenue order: anchor filter, then `Revenues`-first (`:189-190`), then earliest-filed (D-15, D-18).\n- Unchanged: `shares`, `periodEnd` (`:350-352`), `buildPeriod`, `annualizeQuarterlyROE`, `trailingNetIncome`, the range filter (`:371-377`).\n- Bump `DerivationVersion` 1 to 2 (`:524`) and update `derivationGolden` (D-2).\n\n**Step 2 (D-8).** One exported derivation-owned key list in `internal/source`, used by the `buildPeriod` spill and the strip in `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:795-797`).\n\n**Step 3: tests, RED first (D-17, D-21, D-22).**\n- Fixture `internal/edgar/testdata/lyft_companyfacts.json`, trimmed by tag only.\n- Literals (D-12): Q3-2026 roe 0.942632 (2,809,866,000 / 2,980,873,000); FY2025 roe 0.868791 (2,844,008,000 / 3,273,523,000).\n- Synthetic cases: three equity instants in one 10-Q; three annual `NetIncomeLoss` columns in one 10-K; anchor miss gives nil ROE and D/E; a flow only at the prior-year date gives nil; `Revenues` only at the prior-year date; a later-dated `Liabilities` instant.\n- pgxmock: update `internal/repository/marketdata_repo_test.go:573-584` and add a strip test.\n- design.md lists the feature-211/223 assertions with anchor dates; a test whose flow `end` differs from its anchor is a C-16 finding.\n\n**Step 4: additive (D-5, D-9, D-23).** Finnhub and FMP table tests; comment-only `roe` lines at `packages/proto/marketdata/v1/marketdata.proto:233`, `:283` plus `./scripts/buf-gen.sh`; `docs/fundamentals.md`; residuals (`shares`, cover-page `period_end`, stale `pb_ratio` / `pe_ratio`) in the marketdata findings file.\n\n**Step 5: post-deploy repair and audit. Two staging lanes, no production lane (operator ruling).**\n\n| Lane | Database | MCP (served values, backfill, config) | SQL read path |\n|---|---|---|---|\n| A. Homelab staging (traced environment), first | the homelab DB-host database owned by role `xstockstrat_staging` | `xstockstrat_homelab_staging` | homelab-edge `docs/runbooks/db-host.md` § Manual access (tailnet `psql` to `db.ts.natanddavehouse.com`, or `ssh` then `sudo -u postgres psql`), read-only session |\n| B. DO staging, only after lane A ends with no escalation | `xstockstrat-staging` (`.do/app.dev.yaml:698-699`) | `xstockstrat_staging` | `docs/runbooks/operator-db-access.md` (`doctl`, `:25060`) |\n\nEach lane has its own pre-export, backfill, post-export and audit report; neither counts for the other (R-15). The audit report notes that the homelab `xstockstrat_production` database (db-host.md:18) was not touched, per the operator ruling.\n\n0. **Freeze, before the v2 merge (both lanes).**\n   - Set `marketdata.fundamentals.history.enabled = false` in both staging environments (`set_config`).\n   - Reason: on v2 any `BackfillFundamentals` call re-derives stale rows before the `overwrite` gate (`internal/service/marketdata_service.go:2398-2407`), and the strat-lab skill tells agents to run fundamentals backfills. The key gates only the backfill (`:2269-2270`); the historical read is not gated (marketdata CLAUDE.md:79).\n   - Set it back to `true` in a lane only for that lane's operator run. Record every flip in context.md.\n   - This is a staging config change and needs the operator's consent (open blocking objection).\n1. **Preconditions (per lane).** Read-only SQL on that lane's path: `SELECT DISTINCT symbol`, `min(period_end)` and per-symbol `count(*)` from `marketdata.fundamentals_history` (D-16).\n2. **Pre-export, while frozen and before v2 reaches the lane.**\n   - `query_fundamentals(symbol, mode=\"historical\")` in JSON mode, walking `page_token` (`services/xstockstrat-agent/app/tools.py:463`, D-24).\n   - Rows keyed on (`symbol`, `fiscal_period`, `period_type`) with the D-19 columns.\n   - Completeness gate: every DISTINCT symbol present with row count equal to its `count(*)`; otherwise the lane stops.\n   - Raw exports go to operator storage, never git (R-16).\n3. **Unfreeze the lane, then the canary chunk: LYFT, AXP, AAPL.**\n   - `trigger_backfill(symbols, data_kind=\"fundamentals\", start=min(period_end), overwrite=true)` (`tools.py:1546`), polled with `get_backfill_status` (`:1631`) to terminal.\n   - Hard checks: LYFT Q3-2026 roe 0.942632 and FY2025 roe 0.868791; AXP D/E about 1.73 (@AC-1 @feature-223); `|equity − (assets − liabilities)| ≤ 1% × |assets|` on all three; the TTM check (item 6).\n   - A control absent from the lane's DISTINCT list is still backfilled; its rows are reported as \"appear only after backfill\".\n   - Any failure stops the lane with no other symbol rewritten.\n4. **Ramp, then remaining chunks.**\n   - Chunk 2 is 10 symbols (mediator adoption of the adversary's ramp; the canary does not cover a filer with no `Liabilities` tag or with material non-controlling interest). Later chunks are at most 50 (D-16).\n   - After each chunk reaches terminal: re-export that chunk, diff against the pre-export, evaluate the rules. If a rule trips, the next chunk does not start.\n5. **Escalation rules, per chunk and cumulative.**\n   - (a) Nil'd rows exceed 5% of previously non-nil rows for `net_income`, `revenue`, `eps`, `roe` or `debt_to_equity` (`pe_ratio` / `pb_ratio` excluded, R-17).\n   - (b) Corrected: trips only when the post share of rows failing the balance identity is **greater than** the pre share. A fall or no change is reported, not a trip. Rows with nil `assets`, `liabilities` or equity are left out of both numerator and denominator. Hard assertion only on the controls (R-4).\n   - (c) Annual revenue churn is report-only against the canary reference.\n   - (d) Any control check fails.\n   - Stale-ratio count (sizing, not a gate): `eps` nil'd with `pe_ratio` unchanged; `roe` or `debt_to_equity` nil'd with `pb_ratio` unchanged.\n   - Rows that appear only after the backfill (`marketdata_service.go:2373-2388`) are counted apart from \"filled\".\n6. **Closing TTM check (D-20).** Controls plus a seeded random sample of 20 symbols per lane, seed in the report.\n   - Latest n ≤ 4 quarterly `net_income` in the 350-day window by stored `period_end` (D-20, D-23); Q4 = FY − Q1..Q3; scale by 4/n when n < 4 (`internal/edgar/edgar_client.go:491`).\n   - Assert `|roe × equity − TTM NI| ≤ 0.1% × |TTM NI|`; a row with a nil needed quarter is skipped and counted.\n   - The adversary wants quarters chosen by `fiscal_period` label instead; that changes D-20 / D-23 and is filed as a reopen petition, not adopted.\n7. **Finish (per lane).**\n   - Re-run `failed_symbols` once. Then SQL lists rows with `derivation_version < 2` grouped by cause (failed symbol, period no longer emitted, period before `start`); only rows with no explained cause escalate. A hard zero is not required.\n   - Re-freeze or leave enabled as the operator states; record it.\n   - Record PIT drift (@AC-9 @feature-211), the stale-ratio count, and why @AC-4 @feature-216 holds (`UpdateHistoricalPriceJoin` sets only price-join columns, `marketdata_repo.go:772`).\n   - Commit one audit report per lane to the feature directory.\n\n**Spec restatement.** @AC-1, @AC-3, @AC-5, the product-spec claim, the defect-report premise and the title are restated from the filing (D-12); the slug stays. @AC-2 proposal: keep Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row, retitle to \"every vendor path serves ROE as a fraction\".",
    "open_objections": [
      {
        "text": "[C-01/P-03] Lane A's SQL steps (DISTINCT list, `min(period_end)`, per-symbol `count(*)`, the v1-row list) cited `docs/runbooks/operator-db-access.md`, which is DigitalOcean-only (`doctl`, `:25060`). The homelab staging DB is reached per homelab-edge `docs/runbooks/db-host.md` § Manual access. The proposer must name the read path per lane. The operator must also state which role lane A uses: the read-only `admin` role has an empty `db_admin_tailnet_hosts` (db-host.md:19), so today only `superadmin` from `macbook-pro` or the `postgres` socket over ssh works.",
        "blocking": true
      },
      {
        "text": "[P-03] The per-chunk veto covers only the operator's own chunks. On v2 any `BackfillFundamentals` call, including `overwrite=false`, re-derives stale rows (marketdata_service.go:2398-2407), and the strat-lab backtest skill tells agents to trigger fundamentals backfills. A `main-dev` merge also puts v2 on DO staging while lane A is still running. The proposer must accept the freeze (`marketdata.fundamentals.history.enabled=false` in both staging environments before the merge, `true` per lane only for its run, flips recorded in context.md) or give another real veto. The operator must consent to the freeze, since it blocks other staging fundamentals backfills for the duration.",
        "blocking": true
      },
      {
        "text": "[C-11] Rule (b) as the proposer wrote it ('share failing the identity does not fall') pauses every clean chunk (0% to 0%) and every chunk with structural failures (k% to k%). It must trip only when the post share is greater than the pre share, with rows that have nil `assets`, `liabilities` or equity excluded from both sides, and stay hard only on the controls.",
        "blocking": true
      },
      {
        "text": "[P-03] No action is stated when `marketdata.fundamentals.history.enabled` is false at the precondition check; a staging backfill already failed on it (docs/roadmap/features/343-backtest-inline-backfill/product-spec.md:76). Fold the flip into the freeze sequence as a named operator config action.",
        "blocking": false
      },
      {
        "text": "The finish gate '`count(*) WHERE derivation_version < 2` is 0' cannot be a hard check: failed symbols, periods the v2 builder no longer emits and periods before `start` all stay at v1. Re-run failed symbols once, list remaining v1 rows by cause, escalate only unexplained rows.",
        "blocking": false
      },
      {
        "text": "The canary does not cover a filer with no total `Liabilities` tag or one with material non-controlling interest; both drive the anchor (D-6) and the identity check. Add one such filer to the canary or make chunk 2 a 10-symbol ramp. (AAPL already covers 52/53-week filers, so the proposer's stated risk was wrong on that point.)",
        "blocking": false
      },
      {
        "text": "[C-18] Step 5 already needs SQL in both lanes, so paging `query_fundamentals` at 50 rows per page (services/xstockstrat-agent/app/tools.py:476) across the universe twice per lane is a second, lossy read path. D-24 picks JSON over CSV for MCP exports; it does not mandate the MCP. The proposer must answer why a read-only SQL `\\copy` export (with the MCP kept for the canary and TTM sample) is not simpler.",
        "blocking": false
      },
      {
        "text": "[O-18, operator] @AC-2: keep the Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row and retitle the outline. The relayed answers 1 to 3 ('Approved', 'Confirmed', 'Sign-off the change, amend it') carry no labels in what reached me; the orchestrator must map them in context.md before this counts as signed off (P-04).",
        "blocking": false
      },
      {
        "text": "[O-16, operator] D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'. It needs the same recorded mapping of the relayed answers; the per-lane audit reports will put numbers on it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4 (feature 340)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-1 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1 @feature-223",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-222",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-17 remain locked and none is reintroduced.",
      "A production lane or production read path in Step 5: the operator ruled there are no production instances and staging is enough.",
      "Routing lane A's SQL through `docs/runbooks/operator-db-access.md`: that runbook covers only the DigitalOcean cluster; the homelab DB has its own path in homelab-edge `docs/runbooks/db-host.md`.",
      "Rule (b) as 'pause unless the failure share falls': it pauses every clean chunk and every chunk whose failures are structural.",
      "Relying on operator discipline to keep other callers off the rows between deploy and the canary verdict: any fundamentals backfill on v2 re-derives stale rows; the existing `fundamentals.history.enabled` key is the freeze switch.",
      "A hard 'zero rows below derivation_version 2' finish gate: failed symbols, dropped periods and periods before `start` legitimately stay at v1.",
      "Choosing the TTM check's quarters by `fiscal_period` label (adversary): it changes settled D-20 / D-23, so it is filed as a reopen petition and not adopted this round.",
      "Read-only SQL `\\copy` as the export for both lanes (adversary): not rejected and not locked; the MCP JSON export stays in the approach until the proposer answers the C-18 objection."
    ],
    "open_risks": [
      "The freeze blocks every staging fundamentals backfill in both environments from before the merge until each lane's run, which can collide with peer feature 343 (backtest-inline-backfill) testing.",
      "If v2 reaches a lane before its pre-export is taken and the freeze is not on, that lane's changed-rows audit cannot be rebuilt.",
      "How and when homelab staging receives the v2 build was not checked; the pre-export timing for lane A depends on it.",
      "Rewrites are in place; rollback is another version bump plus a full re-backfill. After the canary, up to one 10-symbol ramp chunk or one 50-symbol chunk per lane can be rewritten before a rule trips.",
      "The TTM check windows on the stored `period_end`, which can be a cover-page date; a quarter at the 350-day boundary may be included or dropped differently from `trailingNetIncome`, giving false fails at the 0.1% tolerance (petition pending).",
      "LYFT, AXP and AAPL may not all be stored in each lane; absolute checks still run, but their rows have no pre-export baseline.",
      "The MCP export is paged at 50 rows per call across the universe, twice per lane; only the completeness gate catches a short read. `GetHistoricalFundamentals` with no `as_of` is assumed to return every stored period.",
      "The thresholds (5% nil'd, 1% identity, 0.1% TTM, 20-symbol sample) are proposals the operator may tune.",
      "`end == anchor` for flows yields nils for any filer whose flow end and balance-sheet date differ; uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer, so PIT backtests and screens drift.",
      "P/B and P/E stay stale on anchor-miss rows; the audit only sizes this residual.",
      "A corrected LYFT ROE of 0.94 is right but still looks implausible to a trader.",
      "The pinned literals come from a live fetch that is not committed; the Step-3 fixture must reproduce them.",
      "The homelab `xstockstrat_production` database exists and is not repaired; any later backfill there re-derives through the version guard.",
      "Relayed answers 1 to 3 are unlabeled here, so the @AC-2 and O-16 sign-offs are not recorded yet."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-01",
      "P-02",
      "P-03",
      "P-04",
      "P-06",
      "F-04",
      "F-06",
      "MARKETDATA-11"
    ],
    "rationale": "The design is not approvable yet: three blocking objections remain on Step 5, all raised by the adversary this round, and two of them need an operator answer. Steps 1 to 4 are settled.\n\n**What this round closed.**\n- **O-24, O-25:** the operator ruling removes the production lane. The proposal lists the two staging lanes, each with its own export, backfill and audit.\n- **O-26:** the proposer accepted the canary of LYFT, AXP and AAPL and the per-chunk audit, as the steer directed.\n- **O-27 to O-30:** each got a concrete answer. The remaining defects (rule (b) direction, TTM window date) are tracked as new items.\n\n**Why it is still blocked.** I checked each adversary fact before adopting it.\n- **Lane A SQL path.** `docs/runbooks/operator-db-access.md` covers only `doctl` and `:25060`. The homelab database is reached through homelab-edge `docs/runbooks/db-host.md`, and its read-only `admin` role has no allowed hosts, so the operator must name the role.\n- **Veto reach.** `marketdata_service.go:2398-2407` re-derives stale rows before the `overwrite` gate, so any caller can rewrite rows outside the canary. The key `fundamentals.history.enabled` gates only the backfill (`:2269-2270`), which makes it a usable freeze switch. I wrote the freeze into Step 5, but it changes staging config and needs the operator's consent.\n- **Rule (b).** As written it pauses every clean chunk. The corrected wording is in the approach; the proposer has not yet accepted it.\n\n**Register calls.**\n- The adversary's TTM fix (select quarters by `fiscal_period` label) conflicts with D-20 and D-23, so I kept the stored-`period_end` window and filed a reopen petition instead.\n- The SQL export alternative does not conflict with D-24, but I did not switch to it; it stays an open non-blocking objection for the proposer.\n- Petition P-1 (O-5) was already reopened by the operator and answered by D-20 in round 4; the orchestrator should set its verdict to \"user reopened\".\n- The steer reopens no ID this round.\n\n**Sign-offs.** Only relayed answer 4 is identifiable (the production ruling). Answers 1 to 3 have no labels in what reached me, so @AC-2 stays an uncovered CHANGE and O-16 and O-18 stay open. \"Sign-off the change, amend it\" most likely answers the @AC-2 question, but the orchestrator holds the question list and must record the mapping in context.md.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Step 5 has no production lane and no production read path. It runs two independent staging lanes, homelab staging first and DO staging only after lane A ends with no escalation, each with its own pre-export, backfill, post-export and audit report.",
          "evidence": "Operator ruling 2026-11-15, verbatim: 'There are no production instances. Staging is enough.' Proposer r5 Step 5; .do/app.dev.yaml:698-699; R-15."
        },
        {
          "text": "Chunk 1 of each lane is a canary of LYFT, AXP and AAPL with absolute hard checks (LYFT roe 0.942632 and 0.868791, AXP D/E about 1.73, the balance identity, the TTM check). Every later chunk is re-exported and audited, and the escalation rules are evaluated before the next chunk starts.",
          "evidence": "Operator steer round 5; proposer r5 Step 5 items 3 to 5; adversary r5 disputed only other callers' reach, not the canary."
        },
        {
          "text": "Rule (a) covers `net_income`, `revenue`, `eps`, `roe` and `debt_to_equity` at 5% of previously non-nil rows. Rule (c) is report-only against the canary's observed revenue deltas. The stale-ratio count (`eps` nil'd with `pe_ratio` unchanged; `roe` or `debt_to_equity` nil'd with `pb_ratio` unchanged) sizes the residual and is not a gate.",
          "evidence": "Proposer r5 Step 5 item 5 (O-27); adversary r5: rule (a) honours R-17, no objection to (c) or the stale count."
        },
        {
          "text": "The closing TTM check runs on the three controls plus a seeded random sample of 20 symbols per lane, scales the sum by 4/n when n < 4, and skips and counts a row whose needed quarter has a nil stored `net_income`.",
          "evidence": "Proposer r5 Step 5 item 6 (O-28); edgar_client.go:491. Adversary r5 disputed only the window's date key."
        },
        {
          "text": "The pre-export is taken before the v2 build reaches the lane and must pass a completeness gate: every DISTINCT symbol present with a row count equal to its per-symbol `count(*)`. Rows that appear only after the backfill are reported apart from 'filled'. One audit report per lane is committed.",
          "evidence": "Proposer r5 Step 5 items 2, 5 and 7 (O-29, O-30); marketdata_repo.go:796-797 overwrites in place; marketdata_service.go:2373-2388."
        }
      ],
      "new_rejected": [
        {
          "text": "A production lane or production read path (DO production or the homelab `xstockstrat_production` database) in the Step 5 repair and audit.",
          "why": "The operator ruled there are no production instances and staging is enough."
        },
        {
          "text": "Rule (b) as a pause whenever the share of rows failing the balance identity does not fall from pre to post.",
          "why": "It pauses every clean chunk (0% to 0%) and every chunk with structural failures; only a rise in the failure share may trip it."
        }
      ],
      "new_objections": [
        {
          "text": "Lane A's SQL steps cite `docs/runbooks/operator-db-access.md`, which is DigitalOcean-only; name the read path per lane (homelab-edge `docs/runbooks/db-host.md` for lane A) and have the operator state the role, since the read-only `admin` role has no allowed hosts (db-host.md:19).",
          "blocking": true
        },
        {
          "text": "The per-chunk veto does not stop other callers: on v2 any `BackfillFundamentals` call re-derives stale rows (marketdata_service.go:2398-2407). Freeze with `marketdata.fundamentals.history.enabled=false` in both staging environments before the merge, enable per lane for its run, record the flips; the operator must consent to the freeze.",
          "blocking": true
        },
        {
          "text": "Rule (b) must trip only when the post failure share is greater than the pre share, exclude rows with nil `assets`, `liabilities` or equity from both sides, and stay hard only on the controls.",
          "blocking": true
        },
        {
          "text": "State the operator action when `marketdata.fundamentals.history.enabled` is false at the precondition check, folded into the freeze sequence.",
          "blocking": false
        },
        {
          "text": "The finish gate cannot require zero rows below `derivation_version` 2; re-run failed symbols once, list the remaining v1 rows by cause and escalate only unexplained rows.",
          "blocking": false
        },
        {
          "text": "The canary misses filers with no total `Liabilities` tag or with material non-controlling interest; add one to the canary or make chunk 2 a 10-symbol ramp.",
          "blocking": false
        },
        {
          "text": "[C-18] Answer why a read-only SQL `\\copy` export per lane, with the MCP kept for the canary and TTM sample, is not simpler than paging `query_fundamentals` across the universe twice per lane; D-24 does not mandate the MCP.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-24",
          "how": "Step 5 lists the staging lanes (homelab staging, DO staging), each with its own pre-export, backfill, post-export and audit; the third lane is removed by the operator ruling."
        },
        {
          "id": "O-25",
          "how": "Closed by the operator ruling: there is no production lane, so no production read path is needed."
        },
        {
          "id": "O-26",
          "how": "The proposer adopted a per-chunk audit with a LYFT, AXP and AAPL canary and rules evaluated before the next chunk; rewrites by other callers are tracked as a new blocking objection."
        },
        {
          "id": "O-27",
          "how": "Rule (a) drops `pe_ratio` / `pb_ratio` and adds the stale-ratio count, rule (b) became a pre-versus-post rate comparison hard only on the controls, rule (c) is report-only; rule (b)'s trip direction is tracked as a new blocking objection."
        },
        {
          "id": "O-28",
          "how": "The TTM check scales by 4/n, skips nil quarters and runs on the controls plus a seeded 20-symbol sample; the window's date key is carried as a reopen petition on D-20."
        },
        {
          "id": "O-29",
          "how": "The completeness gate with per-symbol `count(*)` sits before chunk 1, and rows that appear only after the backfill are reported apart from 'filled'."
        },
        {
          "id": "O-30",
          "how": "Raw exports go to operator storage and only the per-lane audit reports are committed."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-20",
          "evidence": "Adversary r5: the check windows on the stored `period_end`, which D-23 records as a cover-page date, while `trailingNetIncome` windows on the facts' own end dates (edgar_client.go:411-470). Cover-date lag differs between 10-Q and 10-K, so the 350-day boundary can include or drop a different quarter than the code did and fail at the 0.1% tolerance. Remedy asked: choose the last four fiscal quarters by `fiscal_period` label, Q4 = FY minus Q1 to Q3. This also amends D-23's 'checks use the stored `period_end`'.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 5)

Second `/sdd-batch` pass at the same gate. No debate round ran, so the register is unchanged: `debate.md` has no new rows (D-1..D-29, R-1..R-19, O-1..O-37, P-1..P-2; Rounds run = 5, State in-debate). `design.md` is not written and `status.md` is unchanged (`spec-ready`). The round-5 entry above still holds in full; this entry adds only the operator answers relayed with this pass.

### Open Threads

- **Operator answers relayed with this pass, verbatim and unlabeled:** "1. Agreed", "2. Ok, agreed.", "3. I plan to do psql over ssh if possible.", "4. Confirmed", "5. Yes, fix the primitives. Use the switch component from Shadcn.", "6. Sounds good". They answer a question list that spans the four features in this batch and did not reach this writer, so none is recorded as a sign-off here (P-04). The orchestrator must map each answer to its question and record the mapping in this file.
  - Answer 3 most likely answers O-31 (lane A's read path and role). If so, lane A's SQL runs through `ssh` to the DB host and then `sudo -u postgres psql` (homelab-edge `docs/runbooks/db-host.md` § Manual access). That is the `postgres` socket, a superuser session, not the read-only `admin` role; the proposer must still write the per-lane read path into Step 5 and say how the session is kept read-only.
  - Answer 5 concerns UI primitives and does not belong to this feature.
  - Answers 1, 2, 4 and 6 cannot be told apart. Until they are mapped, the freeze consent (O-32), the P-2 ruling, O-16 and O-18 stay open.
- **Approach (unchanged):** Steps 1 to 4 are settled (D-1 to D-24). Step 5 is two independent staging lanes with no production lane (D-25): homelab staging first, DO staging only after lane A ends with no escalation. Per lane: freeze, completeness-gated pre-export, LYFT / AXP / AAPL canary, 10-symbol ramp, chunks of at most 50 audited one at a time, closing TTM check, one committed audit report (D-26 to D-29).
- **Strongest open objection — O-32 (blocking, needs the operator):** on v2 any `BackfillFundamentals` call re-derives stale rows (`marketdata_service.go:2398-2407`), so the per-chunk veto does not cover other callers. The mediator's remedy is a freeze: `marketdata.fundamentals.history.enabled = false` in both staging environments before the merge, `true` per lane only for its run. It blocks other staging fundamentals backfills (peer feature 343) and needs the operator's consent; the proposer has not accepted it yet.
- **Other blocking objections:** O-31 (lane A read path and role; see answer 3) and O-33 (rule (b) must trip only when the post failure share is greater than the pre share; for the proposer).
- **Non-blocking, still open:** O-16, O-18, O-34, O-35, O-36, O-37. Petition P-2 on D-20 is `pending user`.
- **Floor status:** no Floor breach.
- **Uncovered `@AC` changes:** CHANGE to this feature's `@AC-2` (keep the Finnhub and FMP rows, drop the EDGAR row, retitle), still without a recorded operator decision. Covered CHANGE: `@AC-1`, `@AC-3`, `@AC-5`. All other listed scenarios are PRESERVE.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round-5 synthesis. Steps 1 to 4 are unchanged and agreed by both sides (D-1 to D-24). Step 5 is rewritten for two staging lanes and corrected with three adversary fixes that I checked in the repo. Paths are under `services/xstockstrat-marketdata` unless stated.\n\n**Step 1: own-period selection in `FetchHistorical` (`internal/edgar/edgar_client.go:290`).**\n- Replace first-seen (`:357-364`) with collect-then-select keyed by (metric, unit, `end`), earliest-filed per key (D-7).\n- Anchor: max `end` across all units of `StockholdersEquity`, `Assets`, `Liabilities` (D-6, D-14).\n- Instants and debt tags keep only `end == anchor` (D-3, D-4).\n- Flows (`net_income`, `revenue`, `eps`, `eps_basic`): `end == anchor` when the bucket has an anchor, else absent; per-metric latest `end` only with no anchor (D-13).\n- Revenue order: anchor filter, then `Revenues`-first (`:189-190`), then earliest-filed (D-15, D-18).\n- Unchanged: `shares`, `periodEnd` (`:350-352`), `buildPeriod`, `annualizeQuarterlyROE`, `trailingNetIncome`, the range filter (`:371-377`).\n- Bump `DerivationVersion` 1 to 2 (`:524`) and update `derivationGolden` (D-2).\n\n**Step 2 (D-8).** One exported derivation-owned key list in `internal/source`, used by the `buildPeriod` spill and the strip in `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:795-797`).\n\n**Step 3: tests, RED first (D-17, D-21, D-22).**\n- Fixture `internal/edgar/testdata/lyft_companyfacts.json`, trimmed by tag only.\n- Literals (D-12): Q3-2026 roe 0.942632 (2,809,866,000 / 2,980,873,000); FY2025 roe 0.868791 (2,844,008,000 / 3,273,523,000).\n- Synthetic cases: three equity instants in one 10-Q; three annual `NetIncomeLoss` columns in one 10-K; anchor miss gives nil ROE and D/E; a flow only at the prior-year date gives nil; `Revenues` only at the prior-year date; a later-dated `Liabilities` instant.\n- pgxmock: update `internal/repository/marketdata_repo_test.go:573-584` and add a strip test.\n- design.md lists the feature-211/223 assertions with anchor dates; a test whose flow `end` differs from its anchor is a C-16 finding.\n\n**Step 4: additive (D-5, D-9, D-23).** Finnhub and FMP table tests; comment-only `roe` lines at `packages/proto/marketdata/v1/marketdata.proto:233`, `:283` plus `./scripts/buf-gen.sh`; `docs/fundamentals.md`; residuals (`shares`, cover-page `period_end`, stale `pb_ratio` / `pe_ratio`) in the marketdata findings file.\n\n**Step 5: post-deploy repair and audit. Two staging lanes, no production lane (operator ruling).**\n\n| Lane | Database | MCP (served values, backfill, config) | SQL read path |\n|---|---|---|---|\n| A. Homelab staging (traced environment), first | the homelab DB-host database owned by role `xstockstrat_staging` | `xstockstrat_homelab_staging` | homelab-edge `docs/runbooks/db-host.md` § Manual access (tailnet `psql` to `db.ts.natanddavehouse.com`, or `ssh` then `sudo -u postgres psql`), read-only session |\n| B. DO staging, only after lane A ends with no escalation | `xstockstrat-staging` (`.do/app.dev.yaml:698-699`) | `xstockstrat_staging` | `docs/runbooks/operator-db-access.md` (`doctl`, `:25060`) |\n\nEach lane has its own pre-export, backfill, post-export and audit report; neither counts for the other (R-15). The audit report notes that the homelab `xstockstrat_production` database (db-host.md:18) was not touched, per the operator ruling.\n\n0. **Freeze, before the v2 merge (both lanes).**\n   - Set `marketdata.fundamentals.history.enabled = false` in both staging environments (`set_config`).\n   - Reason: on v2 any `BackfillFundamentals` call re-derives stale rows before the `overwrite` gate (`internal/service/marketdata_service.go:2398-2407`), and the strat-lab skill tells agents to run fundamentals backfills. The key gates only the backfill (`:2269-2270`); the historical read is not gated (marketdata CLAUDE.md:79).\n   - Set it back to `true` in a lane only for that lane's operator run. Record every flip in context.md.\n   - This is a staging config change and needs the operator's consent (open blocking objection).\n1. **Preconditions (per lane).** Read-only SQL on that lane's path: `SELECT DISTINCT symbol`, `min(period_end)` and per-symbol `count(*)` from `marketdata.fundamentals_history` (D-16).\n2. **Pre-export, while frozen and before v2 reaches the lane.**\n   - `query_fundamentals(symbol, mode=\"historical\")` in JSON mode, walking `page_token` (`services/xstockstrat-agent/app/tools.py:463`, D-24).\n   - Rows keyed on (`symbol`, `fiscal_period`, `period_type`) with the D-19 columns.\n   - Completeness gate: every DISTINCT symbol present with row count equal to its `count(*)`; otherwise the lane stops.\n   - Raw exports go to operator storage, never git (R-16).\n3. **Unfreeze the lane, then the canary chunk: LYFT, AXP, AAPL.**\n   - `trigger_backfill(symbols, data_kind=\"fundamentals\", start=min(period_end), overwrite=true)` (`tools.py:1546`), polled with `get_backfill_status` (`:1631`) to terminal.\n   - Hard checks: LYFT Q3-2026 roe 0.942632 and FY2025 roe 0.868791; AXP D/E about 1.73 (@AC-1 @feature-223); `|equity − (assets − liabilities)| ≤ 1% × |assets|` on all three; the TTM check (item 6).\n   - A control absent from the lane's DISTINCT list is still backfilled; its rows are reported as \"appear only after backfill\".\n   - Any failure stops the lane with no other symbol rewritten.\n4. **Ramp, then remaining chunks.**\n   - Chunk 2 is 10 symbols (mediator adoption of the adversary's ramp; the canary does not cover a filer with no `Liabilities` tag or with material non-controlling interest). Later chunks are at most 50 (D-16).\n   - After each chunk reaches terminal: re-export that chunk, diff against the pre-export, evaluate the rules. If a rule trips, the next chunk does not start.\n5. **Escalation rules, per chunk and cumulative.**\n   - (a) Nil'd rows exceed 5% of previously non-nil rows for `net_income`, `revenue`, `eps`, `roe` or `debt_to_equity` (`pe_ratio` / `pb_ratio` excluded, R-17).\n   - (b) Corrected: trips only when the post share of rows failing the balance identity is **greater than** the pre share. A fall or no change is reported, not a trip. Rows with nil `assets`, `liabilities` or equity are left out of both numerator and denominator. Hard assertion only on the controls (R-4).\n   - (c) Annual revenue churn is report-only against the canary reference.\n   - (d) Any control check fails.\n   - Stale-ratio count (sizing, not a gate): `eps` nil'd with `pe_ratio` unchanged; `roe` or `debt_to_equity` nil'd with `pb_ratio` unchanged.\n   - Rows that appear only after the backfill (`marketdata_service.go:2373-2388`) are counted apart from \"filled\".\n6. **Closing TTM check (D-20).** Controls plus a seeded random sample of 20 symbols per lane, seed in the report.\n   - Latest n ≤ 4 quarterly `net_income` in the 350-day window by stored `period_end` (D-20, D-23); Q4 = FY − Q1..Q3; scale by 4/n when n < 4 (`internal/edgar/edgar_client.go:491`).\n   - Assert `|roe × equity − TTM NI| ≤ 0.1% × |TTM NI|`; a row with a nil needed quarter is skipped and counted.\n   - The adversary wants quarters chosen by `fiscal_period` label instead; that changes D-20 / D-23 and is filed as a reopen petition, not adopted.\n7. **Finish (per lane).**\n   - Re-run `failed_symbols` once. Then SQL lists rows with `derivation_version < 2` grouped by cause (failed symbol, period no longer emitted, period before `start`); only rows with no explained cause escalate. A hard zero is not required.\n   - Re-freeze or leave enabled as the operator states; record it.\n   - Record PIT drift (@AC-9 @feature-211), the stale-ratio count, and why @AC-4 @feature-216 holds (`UpdateHistoricalPriceJoin` sets only price-join columns, `marketdata_repo.go:772`).\n   - Commit one audit report per lane to the feature directory.\n\n**Spec restatement.** @AC-1, @AC-3, @AC-5, the product-spec claim, the defect-report premise and the title are restated from the filing (D-12); the slug stays. @AC-2 proposal: keep Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row, retitle to \"every vendor path serves ROE as a fraction\".",
    "open_objections": [
      {
        "text": "[C-01/P-03] Lane A's SQL steps (DISTINCT list, `min(period_end)`, per-symbol `count(*)`, the v1-row list) cited `docs/runbooks/operator-db-access.md`, which is DigitalOcean-only (`doctl`, `:25060`). The homelab staging DB is reached per homelab-edge `docs/runbooks/db-host.md` § Manual access. The proposer must name the read path per lane. The operator must also state which role lane A uses: the read-only `admin` role has an empty `db_admin_tailnet_hosts` (db-host.md:19), so today only `superadmin` from `macbook-pro` or the `postgres` socket over ssh works.",
        "blocking": true
      },
      {
        "text": "[P-03] The per-chunk veto covers only the operator's own chunks. On v2 any `BackfillFundamentals` call, including `overwrite=false`, re-derives stale rows (marketdata_service.go:2398-2407), and the strat-lab backtest skill tells agents to trigger fundamentals backfills. A `main-dev` merge also puts v2 on DO staging while lane A is still running. The proposer must accept the freeze (`marketdata.fundamentals.history.enabled=false` in both staging environments before the merge, `true` per lane only for its run, flips recorded in context.md) or give another real veto. The operator must consent to the freeze, since it blocks other staging fundamentals backfills for the duration.",
        "blocking": true
      },
      {
        "text": "[C-11] Rule (b) as the proposer wrote it ('share failing the identity does not fall') pauses every clean chunk (0% to 0%) and every chunk with structural failures (k% to k%). It must trip only when the post share is greater than the pre share, with rows that have nil `assets`, `liabilities` or equity excluded from both sides, and stay hard only on the controls.",
        "blocking": true
      },
      {
        "text": "[P-03] No action is stated when `marketdata.fundamentals.history.enabled` is false at the precondition check; a staging backfill already failed on it (docs/roadmap/features/343-backtest-inline-backfill/product-spec.md:76). Fold the flip into the freeze sequence as a named operator config action.",
        "blocking": false
      },
      {
        "text": "The finish gate '`count(*) WHERE derivation_version < 2` is 0' cannot be a hard check: failed symbols, periods the v2 builder no longer emits and periods before `start` all stay at v1. Re-run failed symbols once, list remaining v1 rows by cause, escalate only unexplained rows.",
        "blocking": false
      },
      {
        "text": "The canary does not cover a filer with no total `Liabilities` tag or one with material non-controlling interest; both drive the anchor (D-6) and the identity check. Add one such filer to the canary or make chunk 2 a 10-symbol ramp. (AAPL already covers 52/53-week filers, so the proposer's stated risk was wrong on that point.)",
        "blocking": false
      },
      {
        "text": "[C-18] Step 5 already needs SQL in both lanes, so paging `query_fundamentals` at 50 rows per page (services/xstockstrat-agent/app/tools.py:476) across the universe twice per lane is a second, lossy read path. D-24 picks JSON over CSV for MCP exports; it does not mandate the MCP. The proposer must answer why a read-only SQL `\\copy` export (with the MCP kept for the canary and TTM sample) is not simpler.",
        "blocking": false
      },
      {
        "text": "[O-18, operator] @AC-2: keep the Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row and retitle the outline. The relayed answers 1 to 3 ('Approved', 'Confirmed', 'Sign-off the change, amend it') carry no labels in what reached me; the orchestrator must map them in context.md before this counts as signed off (P-04).",
        "blocking": false
      },
      {
        "text": "[O-16, operator] D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'. It needs the same recorded mapping of the relayed answers; the per-lane audit reports will put numbers on it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4 (feature 340)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5 (feature 340)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-1 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9 @feature-211",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1 @feature-223",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-222",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 @feature-216",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-17 remain locked and none is reintroduced.",
      "A production lane or production read path in Step 5: the operator ruled there are no production instances and staging is enough.",
      "Routing lane A's SQL through `docs/runbooks/operator-db-access.md`: that runbook covers only the DigitalOcean cluster; the homelab DB has its own path in homelab-edge `docs/runbooks/db-host.md`.",
      "Rule (b) as 'pause unless the failure share falls': it pauses every clean chunk and every chunk whose failures are structural.",
      "Relying on operator discipline to keep other callers off the rows between deploy and the canary verdict: any fundamentals backfill on v2 re-derives stale rows; the existing `fundamentals.history.enabled` key is the freeze switch.",
      "A hard 'zero rows below derivation_version 2' finish gate: failed symbols, dropped periods and periods before `start` legitimately stay at v1.",
      "Choosing the TTM check's quarters by `fiscal_period` label (adversary): it changes settled D-20 / D-23, so it is filed as a reopen petition and not adopted this round.",
      "Read-only SQL `\\copy` as the export for both lanes (adversary): not rejected and not locked; the MCP JSON export stays in the approach until the proposer answers the C-18 objection."
    ],
    "open_risks": [
      "The freeze blocks every staging fundamentals backfill in both environments from before the merge until each lane's run, which can collide with peer feature 343 (backtest-inline-backfill) testing.",
      "If v2 reaches a lane before its pre-export is taken and the freeze is not on, that lane's changed-rows audit cannot be rebuilt.",
      "How and when homelab staging receives the v2 build was not checked; the pre-export timing for lane A depends on it.",
      "Rewrites are in place; rollback is another version bump plus a full re-backfill. After the canary, up to one 10-symbol ramp chunk or one 50-symbol chunk per lane can be rewritten before a rule trips.",
      "The TTM check windows on the stored `period_end`, which can be a cover-page date; a quarter at the 350-day boundary may be included or dropped differently from `trailingNetIncome`, giving false fails at the 0.1% tolerance (petition pending).",
      "LYFT, AXP and AAPL may not all be stored in each lane; absolute checks still run, but their rows have no pre-export baseline.",
      "The MCP export is paged at 50 rows per call across the universe, twice per lane; only the completeness gate catches a short read. `GetHistoricalFundamentals` with no `as_of` is assumed to return every stored period.",
      "The thresholds (5% nil'd, 1% identity, 0.1% TTM, 20-symbol sample) are proposals the operator may tune.",
      "`end == anchor` for flows yields nils for any filer whose flow end and balance-sheet date differ; uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer, so PIT backtests and screens drift.",
      "P/B and P/E stay stale on anchor-miss rows; the audit only sizes this residual.",
      "A corrected LYFT ROE of 0.94 is right but still looks implausible to a trader.",
      "The pinned literals come from a live fetch that is not committed; the Step-3 fixture must reproduce them.",
      "The homelab `xstockstrat_production` database exists and is not repaired; any later backfill there re-derives through the version guard.",
      "Relayed answers 1 to 3 are unlabeled here, so the @AC-2 and O-16 sign-offs are not recorded yet."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-01",
      "P-02",
      "P-03",
      "P-04",
      "P-06",
      "F-04",
      "F-06",
      "MARKETDATA-11"
    ],
    "rationale": "The design is not approvable yet: three blocking objections remain on Step 5, all raised by the adversary this round, and two of them need an operator answer. Steps 1 to 4 are settled.\n\n**What this round closed.**\n- **O-24, O-25:** the operator ruling removes the production lane. The proposal lists the two staging lanes, each with its own export, backfill and audit.\n- **O-26:** the proposer accepted the canary of LYFT, AXP and AAPL and the per-chunk audit, as the steer directed.\n- **O-27 to O-30:** each got a concrete answer. The remaining defects (rule (b) direction, TTM window date) are tracked as new items.\n\n**Why it is still blocked.** I checked each adversary fact before adopting it.\n- **Lane A SQL path.** `docs/runbooks/operator-db-access.md` covers only `doctl` and `:25060`. The homelab database is reached through homelab-edge `docs/runbooks/db-host.md`, and its read-only `admin` role has no allowed hosts, so the operator must name the role.\n- **Veto reach.** `marketdata_service.go:2398-2407` re-derives stale rows before the `overwrite` gate, so any caller can rewrite rows outside the canary. The key `fundamentals.history.enabled` gates only the backfill (`:2269-2270`), which makes it a usable freeze switch. I wrote the freeze into Step 5, but it changes staging config and needs the operator's consent.\n- **Rule (b).** As written it pauses every clean chunk. The corrected wording is in the approach; the proposer has not yet accepted it.\n\n**Register calls.**\n- The adversary's TTM fix (select quarters by `fiscal_period` label) conflicts with D-20 and D-23, so I kept the stored-`period_end` window and filed a reopen petition instead.\n- The SQL export alternative does not conflict with D-24, but I did not switch to it; it stays an open non-blocking objection for the proposer.\n- Petition P-1 (O-5) was already reopened by the operator and answered by D-20 in round 4; the orchestrator should set its verdict to \"user reopened\".\n- The steer reopens no ID this round.\n\n**Sign-offs.** Only relayed answer 4 is identifiable (the production ruling). Answers 1 to 3 have no labels in what reached me, so @AC-2 stays an uncovered CHANGE and O-16 and O-18 stay open. \"Sign-off the change, amend it\" most likely answers the @AC-2 question, but the orchestrator holds the question list and must record the mapping in context.md.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Step 5 has no production lane and no production read path. It runs two independent staging lanes, homelab staging first and DO staging only after lane A ends with no escalation, each with its own pre-export, backfill, post-export and audit report.",
          "evidence": "Operator ruling 2026-11-15, verbatim: 'There are no production instances. Staging is enough.' Proposer r5 Step 5; .do/app.dev.yaml:698-699; R-15."
        },
        {
          "text": "Chunk 1 of each lane is a canary of LYFT, AXP and AAPL with absolute hard checks (LYFT roe 0.942632 and 0.868791, AXP D/E about 1.73, the balance identity, the TTM check). Every later chunk is re-exported and audited, and the escalation rules are evaluated before the next chunk starts.",
          "evidence": "Operator steer round 5; proposer r5 Step 5 items 3 to 5; adversary r5 disputed only other callers' reach, not the canary."
        },
        {
          "text": "Rule (a) covers `net_income`, `revenue`, `eps`, `roe` and `debt_to_equity` at 5% of previously non-nil rows. Rule (c) is report-only against the canary's observed revenue deltas. The stale-ratio count (`eps` nil'd with `pe_ratio` unchanged; `roe` or `debt_to_equity` nil'd with `pb_ratio` unchanged) sizes the residual and is not a gate.",
          "evidence": "Proposer r5 Step 5 item 5 (O-27); adversary r5: rule (a) honours R-17, no objection to (c) or the stale count."
        },
        {
          "text": "The closing TTM check runs on the three controls plus a seeded random sample of 20 symbols per lane, scales the sum by 4/n when n < 4, and skips and counts a row whose needed quarter has a nil stored `net_income`.",
          "evidence": "Proposer r5 Step 5 item 6 (O-28); edgar_client.go:491. Adversary r5 disputed only the window's date key."
        },
        {
          "text": "The pre-export is taken before the v2 build reaches the lane and must pass a completeness gate: every DISTINCT symbol present with a row count equal to its per-symbol `count(*)`. Rows that appear only after the backfill are reported apart from 'filled'. One audit report per lane is committed.",
          "evidence": "Proposer r5 Step 5 items 2, 5 and 7 (O-29, O-30); marketdata_repo.go:796-797 overwrites in place; marketdata_service.go:2373-2388."
        }
      ],
      "new_rejected": [
        {
          "text": "A production lane or production read path (DO production or the homelab `xstockstrat_production` database) in the Step 5 repair and audit.",
          "why": "The operator ruled there are no production instances and staging is enough."
        },
        {
          "text": "Rule (b) as a pause whenever the share of rows failing the balance identity does not fall from pre to post.",
          "why": "It pauses every clean chunk (0% to 0%) and every chunk with structural failures; only a rise in the failure share may trip it."
        }
      ],
      "new_objections": [
        {
          "text": "Lane A's SQL steps cite `docs/runbooks/operator-db-access.md`, which is DigitalOcean-only; name the read path per lane (homelab-edge `docs/runbooks/db-host.md` for lane A) and have the operator state the role, since the read-only `admin` role has no allowed hosts (db-host.md:19).",
          "blocking": true
        },
        {
          "text": "The per-chunk veto does not stop other callers: on v2 any `BackfillFundamentals` call re-derives stale rows (marketdata_service.go:2398-2407). Freeze with `marketdata.fundamentals.history.enabled=false` in both staging environments before the merge, enable per lane for its run, record the flips; the operator must consent to the freeze.",
          "blocking": true
        },
        {
          "text": "Rule (b) must trip only when the post failure share is greater than the pre share, exclude rows with nil `assets`, `liabilities` or equity from both sides, and stay hard only on the controls.",
          "blocking": true
        },
        {
          "text": "State the operator action when `marketdata.fundamentals.history.enabled` is false at the precondition check, folded into the freeze sequence.",
          "blocking": false
        },
        {
          "text": "The finish gate cannot require zero rows below `derivation_version` 2; re-run failed symbols once, list the remaining v1 rows by cause and escalate only unexplained rows.",
          "blocking": false
        },
        {
          "text": "The canary misses filers with no total `Liabilities` tag or with material non-controlling interest; add one to the canary or make chunk 2 a 10-symbol ramp.",
          "blocking": false
        },
        {
          "text": "[C-18] Answer why a read-only SQL `\\copy` export per lane, with the MCP kept for the canary and TTM sample, is not simpler than paging `query_fundamentals` across the universe twice per lane; D-24 does not mandate the MCP.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-24",
          "how": "Step 5 lists the staging lanes (homelab staging, DO staging), each with its own pre-export, backfill, post-export and audit; the third lane is removed by the operator ruling."
        },
        {
          "id": "O-25",
          "how": "Closed by the operator ruling: there is no production lane, so no production read path is needed."
        },
        {
          "id": "O-26",
          "how": "The proposer adopted a per-chunk audit with a LYFT, AXP and AAPL canary and rules evaluated before the next chunk; rewrites by other callers are tracked as a new blocking objection."
        },
        {
          "id": "O-27",
          "how": "Rule (a) drops `pe_ratio` / `pb_ratio` and adds the stale-ratio count, rule (b) became a pre-versus-post rate comparison hard only on the controls, rule (c) is report-only; rule (b)'s trip direction is tracked as a new blocking objection."
        },
        {
          "id": "O-28",
          "how": "The TTM check scales by 4/n, skips nil quarters and runs on the controls plus a seeded 20-symbol sample; the window's date key is carried as a reopen petition on D-20."
        },
        {
          "id": "O-29",
          "how": "The completeness gate with per-symbol `count(*)` sits before chunk 1, and rows that appear only after the backfill are reported apart from 'filled'."
        },
        {
          "id": "O-30",
          "how": "Raw exports go to operator storage and only the per-lane audit reports are committed."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-20",
          "evidence": "Adversary r5: the check windows on the stored `period_end`, which D-23 records as a cover-page date, while `trailingNetIncome` windows on the facts' own end dates (edgar_client.go:411-470). Cover-date lag differs between 10-Q and 10-K, so the 350-day boundary can include or drop a different quarter than the code did and fail at the 0.1% tolerance. Remedy asked: choose the last four fiscal quarters by `fiscal_period` label, Q4 = FY minus Q1 to Q3. This also amends D-23's 'checks use the stored `period_end`'.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
