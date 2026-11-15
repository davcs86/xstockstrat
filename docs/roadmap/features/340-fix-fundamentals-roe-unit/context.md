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
