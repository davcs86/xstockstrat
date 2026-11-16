# Design: fix-fundamentals-roe-unit

**Created**: 2026-11-15
**Rounds**: 6 (full; termination: approved)
**Approved by**: user @ 2026-11-15 (design gate after round 6, verbatim: "I approve 340, including the acceptance scenario.")
**Grounded in**: recon.md
**Debate register**: debate.md

The full-mode cap of 5 rounds was lifted for this feature by the operator ("Override the rounds cap
for 340", context.md 2026-11-15). No Floor breach was raised in any round.

---

## Chosen Approach

Paths are under `services/xstockstrat-marketdata` unless stated. Line numbers are those of the recon
tree (`recon.md:5`) and of the debate register; `/sdd-spec` re-greps each one (C-01).

### What is being fixed

The defect is not a unit error. The value `roe 3.6634` for LYFT is produced by the EDGAR quarterly
TTM derivation and served through the EDGAR snapshot; no vendor and no merge path is involved
(`recon.md:18-38`). The ratio is already a fraction and its inputs are wrong (D-1).

- `FetchHistorical` buckets facts by the filing's `fy`/`fp` and keeps the first-seen value per
  (metric, unit), so an instant tag can resolve to a comparative column (`recon.md:59-67`, `:81`).
- Traced on the real filing (D-11, SEC companyfacts CIK0001759509): a genuine TTM net income of
  2,809,866,000 (n=4, with a derived Q4-2025 of 2,755,053,000) is divided by a first-seen equity of
  767,016,000 dated 2024-12-31. The Q3-2026 quarter-end equity is 2,980,873,000.
  2,809,866,000 / 767,016,000 = 3.6634, the staging value.
- Corrected values, pinned from the filing (D-12): Q3-2026 `roe` **0.942632**
  (2,809,866,000 / 2,980,873,000); FY2025 `roe` **0.868791** (2,844,008,000 / 3,273,523,000).

**Consumer surfaces (C-14).** The change is inside marketdata. It reaches the `/trader` symbol-page
Fundamentals card, the agent `query_fundamentals` tool and analysis screening and scoring through
the served `roe`, with no consumer code change (`recon.md:12-14`, `:123`).

### Step 1 — own-period selection in `FetchHistorical`

- Replace the first-seen write in `FetchHistorical` (`internal/edgar/edgar_client.go:290`,
  `:357-364`; `recon.md:81`) with collect-then-select inside the function. Candidates are keyed by
  (metric, unit, `end`), earliest-filed winning per key, reusing the feature-222 `niFact` rule
  (`recon.md:99`). No new public type (D-7).
- **Anchor (D-6, D-14).** The maximum `end` across all units of the bucket's `StockholdersEquity`,
  `Assets` and `Liabilities` candidates (`instantTags`, `recon.md:82`), excluding `dei` and
  share-count tags. Per-unit selection happens at that one date. Equality match, no tolerance.
- **Instants** (equity, assets, liabilities, debt tags): keep only `end == anchor`. When nothing
  matches, the value is absent; there is no fallback to first-seen (D-3, D-4). Nil stays nil end to
  end (`recon.md:102`, MARKETDATA-11).
- **Flows (D-13, operator ruling: uniform scope).** `net_income`, `revenue`, `eps` and `eps_basic`
  keep `end == anchor` when the bucket has an anchor, else absent. Per-metric latest `end` applies
  only when the bucket has no anchor.
- **Revenue order (D-15, D-18).** Filter on `end == anchor`, then `Revenues` over
  `RevenueFromContractWithCustomerExcludingAssessedTax`, then earliest-filed.
- **Unchanged.** `shares` selection (D-9), `periodEnd` (D-31), `buildPeriod`,
  `annualizeQuarterlyROE` and `trailingNetIncome` (`recon.md:83-84`).
- **Stored rows (D-2).** Bump `DerivationVersion` 1 to 2 (`edgar_client.go:524`, `recon.md:85`) and
  update `derivationGolden` in `internal/edgar/derivation_version_test.go`. Stored rows are then
  upgraded through `RederiveHistoricalFundamentals` and the cached snapshot is dropped through
  `DeleteEdgarSnapshot` (`recon.md:100-101`, MARKETDATA-13). No SQL migration. Check
  `docs/roadmap/features/merge-order.md` for a competing bump before reserving version 2
  (`recon.md:143`).

### Step 2 — one derivation-owned key list

- `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:786`, merge at
  `:795-797`; `recon.md:88`) strips the derivation-owned `extra_metrics` keys before the merge:
  `revenue`, `net_income`, `assets`, `liabilities`, `stockholders_equity`,
  `stockholders_equity_usd`, `total_debt`. Price-join keys survive (D-8).
- The key list is held once, exported from `internal/source`, and used by both `buildPeriod` and the
  strip. Both packages already import `internal/source`, so there is no new dependency edge (R-8).

### Step 3 — RED tests first (P-06)

- Fixture: `internal/edgar/testdata/lyft_companyfacts.json`, trimmed by tag only, committed in this
  RED step (D-17, D-21, C-13). It must reproduce `roe` 0.942632 (Q3-2026) and 0.868791 (FY2025).
- Synthetic cases (D-22): `Revenues` present only at the prior-year date with the other revenue tag
  at the anchor; a later-dated `Liabilities` instant that shifts the anchor and nils equity, ROE
  and D/E. Carried from earlier rounds: a 10-Q with several equity instants, an anchor-miss case
  giving nil ROE and D/E, a flow whose only fact is a prior-year comparative.
- pgxmock: update the re-derive expectation and add a stale-key strip test (`recon.md:105`).
- Existing tests are rechecked, not assumed green. `derivationGolden` changes by design. Follow the
  comparative-column test pattern in `internal/edgar/ttm_roe_test.go` (`recon.md:103`).

### Step 4 — additive guards, proto comment, docs

- Vendor unit guards (D-5): table tests for Finnhub `scale100` and FMP pass-through
  (`recon.md:92`, `:104`). These are the `@AC-2` rows that remain.
- Comment-only unit lines on `roe` at `packages/proto/marketdata/v1/marketdata.proto:233` and `:283`
  (`recon.md:94`, `:128`), then `./scripts/buf-gen.sh` in the same PR (C-09). No field, number or
  type change.
- Update `services/xstockstrat-marketdata/docs/fundamentals.md`. Log the residuals in
  `services/xstockstrat-marketdata/docs/context-constitution-findings.md`: `shares` first-seen
  selection (D-9), the cover-page `period_end`, and stale `pe_ratio` / `pb_ratio` on anchor-miss
  rows (D-31, R-9).

### Spec restatement (operator rulings, D-12)

`/sdd-spec` restates these from the filing before any code step. The slug, branch and directory stay.

- `@AC-1` and `@AC-5`: `roe` 0.942632. `@AC-3`: FY2025 `roe` 0.868791.
- `@AC-2`: keep the Finnhub and FMP rows as unit-level guards, drop the EDGAR row, retitle the
  scenario outline. EDGAR is covered by the LYFT fixture scenarios.
- The product-spec "low single-digit" claim, the defect-report premise and the feature title.

### Step 5 — post-deploy repair and audit (two staging lanes, no production lane)

There is no production lane (D-25, R-18; operator: "There are no production instances. Staging is
enough.").

| Lane | Database | SQL read path (read-only session) | MCP (config flips, backfill, served values) |
|---|---|---|---|
| A, homelab staging, first | `xstockstrat-staging` (homelab-edge `docs/runbooks/db-host.md:13`) | The operator, personally: `ssh david_admin@db.ts.natanddavehouse.com`, then `sudo -u postgres psql` on the socket (`db-host.md:21`, `:36`). Fallback: `superadmin` from `macbook-pro` (`db-host.md:20`, `:28-32`). The `admin` role is not used: it has no allowed hosts (`db-host.md:19`). | `xstockstrat_homelab_staging` |
| B, DO staging, only after lane A ends with no escalation | `xstockstrat-staging` (`.do/app.dev.yaml:698-699`) | `docs/runbooks/operator-db-access.md:36-49` (`doctl`, then `psql` on `:25060`) | `xstockstrat_staging` |

Bulk reads are SQL; the MCP keeps the config flips, the backfill trigger and status, and the
served-value checks on the controls (D-34). No homelab-edge change is made (D-33).

**None of the SQL below has been executed against a real database (O-38).** The Step 0 dry run is
its first execution.

**Command templates.** The query file goes on stdin. Output stays on the operator's machine and is
never committed (R-16).

Lane A:

```bash
ssh david_admin@db.ts.natanddavehouse.com "sudo -u postgres env PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -v syms=LYFT,AXP,AAPL -d xstockstrat-staging -f -" < Q.sql > out.csv
```

Lane A fallback, with the password read from SOPS as the runbook requires (`db-host.md:29-31`, `:40`):

```bash
PGOPTIONS='-c default_transaction_read_only=on' PGPASSWORD="$(sops decrypt --extract '["db_role_superadmin_password"]' secrets/edge.sops.yaml)" psql "host=db.ts.natanddavehouse.com user=superadmin dbname=xstockstrat-staging sslmode=require" -X -v ON_ERROR_STOP=1 -v syms=LYFT,AXP,AAPL -f Q.sql > out.csv
```

Lane B: the same `psql` flags against the `doctl` URI with `dbname=xstockstrat-staging`.

**Queries** (table `marketdata.fundamentals_history`; labels are `Qn-YYYY` and `FYYYYY`,
`migrations/005_fundamentals_history.up.sql:9`, `edgar_client.go:539`).

Q-pre:

```sql
SELECT symbol, count(*) AS n, min(period_end) AS min_end, max(derivation_version) AS max_v
FROM marketdata.fundamentals_history GROUP BY symbol ORDER BY symbol;
```

Q-export, full table (pre-export and post-export). It is server-side `COPY ... TO STDOUT`, not
`\copy` (R-20):

```sql
COPY (SELECT symbol, fiscal_period, period_type, period_end, filed_date, source, derivation_version,
        eps, roe, debt_to_equity, pe_ratio, pb_ratio,
        extra_metrics->>'net_income' AS net_income, extra_metrics->>'revenue' AS revenue,
        extra_metrics->>'stockholders_equity' AS equity, extra_metrics->>'assets' AS assets,
        extra_metrics->>'liabilities' AS liabilities, extra_metrics::text AS extra_metrics
      FROM marketdata.fundamentals_history ORDER BY 1,2,3) TO STDOUT WITH (FORMAT csv, HEADER);
```

Q-export, per chunk: the same statement with
`WHERE symbol = ANY(string_to_array(:'syms', ','))` before `ORDER BY`.

Q-ttm (closing check, by fiscal label):

```sql
WITH h AS (SELECT symbol, period_type, roe, (extra_metrics->>'net_income')::numeric ni, (extra_metrics->>'stockholders_equity')::numeric eq,
    CASE WHEN fiscal_period LIKE 'FY%' THEN substr(fiscal_period,3)::int ELSE split_part(fiscal_period,'-',2)::int END fy,
    CASE WHEN fiscal_period LIKE 'FY%' THEN 4 ELSE substr(fiscal_period,2,1)::int END q
  FROM marketdata.fundamentals_history WHERE symbol = ANY(string_to_array(:'syms', ','))),
qtr AS (SELECT symbol, fy, q, ni FROM h WHERE period_type='quarterly' AND q BETWEEN 1 AND 3
  UNION ALL
  SELECT f.symbol, f.fy, 4, f.ni - sum(x.ni) FROM h f JOIN h x ON x.symbol=f.symbol AND x.fy=f.fy AND x.period_type='quarterly' AND x.q BETWEEN 1 AND 3
  WHERE f.period_type='annual' GROUP BY f.symbol, f.fy, f.ni HAVING count(x.ni)=3),
latest AS (SELECT DISTINCT ON (symbol) symbol, fy, q, roe, eq FROM h WHERE period_type='quarterly' ORDER BY symbol, fy DESC, q DESC),
win AS (SELECT l.symbol, l.roe, l.eq, count(t.ni) n, count(t.symbol) FILTER (WHERE t.ni IS NULL) nil_q, sum(t.ni) s
  FROM latest l LEFT JOIN qtr t ON t.symbol=l.symbol AND t.fy*4+t.q BETWEEN l.fy*4+l.q-3 AND l.fy*4+l.q GROUP BY 1,2,3)
SELECT symbol, n, nil_q, roe*eq AS implied, s*4/NULLIF(n,0) AS ttm,
  CASE WHEN n=0 OR nil_q>0 OR roe IS NULL OR eq IS NULL OR s=0 THEN 'skipped' WHEN abs(roe*eq - s*4/n) <= 0.001*abs(s*4/n) THEN 'pass' ELSE 'fail' END AS verdict
FROM win;
```

Q-v1 (finish):

```sql
SELECT symbol, fiscal_period, period_type, period_end
FROM marketdata.fundamentals_history WHERE derivation_version < 2 ORDER BY 1,2,3;
```

**Sequence**

0. **Dry run, then freeze, before the v2 merge into `main-dev` (D-32).**
   - Dry run: the operator runs Q-pre, both Q-export forms and Q-ttm once on lane A. All read-only.
   - Record in context.md the value `marketdata.fundamentals.history.enabled` holds in each staging
     environment (`get_config`).
   - Set it to `false` on both staging MCPs (`set_config`, `services/xstockstrat-agent/app/tools.py:1885`;
     confirm with `get_config`, `:1821`). Operator consent: "Ok, agreed."
   - Why this key: `BackfillFundamentals` returns `FailedPrecondition` on it
     (`internal/service/marketdata_service.go:2269-2270`) before the re-derive (`:2398-2407`). The
     table's only writers (`marketdata_repo.go:728`, `:773`, `:795`) are reached from that one RPC,
     and no scheduled trigger was found.
   - Log every flip in context.md with time, lane and reason.
1. **Pre-export, frozen, before v2 reaches either lane (D-19, D-29).** Q-pre and full Q-export per
   lane. Completeness gate: the export's row count per symbol equals Q-pre's `n`; otherwise the
   lane stops.
2. **Lane start.** The key is `false` by design. The named operator action is `set_config ... = true`
   on that lane's MCP only, logged. If the key is found `true` before that flip, the freeze was
   breached: stop, re-run Q-pre, and diff any `max_v = 2` symbol against the pre-export.
3. **Canary: LYFT, AXP, AAPL (D-26).**
   - `trigger_backfill(symbols, data_kind="fundamentals", start=min(period_end), overwrite=true)`
     (`tools.py:1546`), polled with `get_backfill_status` (`:1631`) (D-16).
   - Served-value checks through `query_fundamentals` (`tools.py:463`): LYFT Q3-2026 `roe`
     0.942632, FY2025 `roe` 0.868791, AXP D/E about 1.73.
   - Then per-chunk Q-export, the identity check and Q-ttm. Any failure stops the lane.
4. **Ramp and chunks (D-36).** Chunk 2 is 10 symbols; later chunks are at most 50. After each chunk:
   - per-chunk Q-export, diff against the pre-export, rules (a) to (d) evaluated before the next
     chunk starts;
   - re-run Q-pre and assert that the symbols with `max_v = 2` are a subset of the symbols already
     processed. A symbol outside that set means another caller ran a backfill while the lane was
     enabled; the lane stops.
5. **Audit rules (D-27, D-35).**
   - Rule (a): `net_income`, `revenue`, `eps`, `roe` and `debt_to_equity` going from a value to nil,
     at 5% of previously non-nil rows.
   - Rule (b): a row fails the identity when `|equity − (assets − liabilities)| > 0.01 × |assets|`.
     Rows with nil `assets`, `liabilities` or equity are left out of numerator and denominator on
     each side. The rule trips only when the post failure share is greater than the pre share, per
     chunk and cumulatively. A fall or no change is reported only. It is a hard assertion only on
     the controls (R-4, R-19).
   - Rule (c): report-only against the canary's observed revenue deltas.
   - The stale-ratio count (`eps` nil'd with `pe_ratio` unchanged; `roe` or `debt_to_equity` nil'd
     with `pb_ratio` unchanged) sizes the residual and is not a gate.
6. **Closing TTM check (D-28, D-30).**
   - Q-ttm on the three controls plus a seeded sample of 20 per lane, seed in the report.
   - Quarters are the last four fiscal quarters by `fiscal_period` label ending at the latest
     quarterly label; Q4 = FY − Q1..Q3; scale 4/n when n < 4. No new served key (R-13).
   - A failing control is hard. A failing or skipped sample row is listed with its quarters and goes
     to the operator; the sample is advisory.
   - Known false-fail sources, stated in the report: the code's PIT cutoff (`edgar_client.go:419`,
     `:483`) and its Q4 derivation keyed on the FY fact's own `start` / `end` instead of the label
     year (`:439-451`).
7. **Finish, per lane (D-37).**
   - Re-run `failed_symbols` once. Group Q-v1 output by cause: (1) symbol still failing; (2) period
     dated before `start`; (3) symbol succeeded, period in range, row still below v2.
   - Every group-3 row is listed and escalated, with no threshold (R-22). A non-empty group 2 is a
     lane-run error, because `start = min(period_end)` makes it empty by construction
     (`edgar_client.go:372-374`).
   - Record PIT drift, the stale-ratio count and why `@AC-4 @feature-216` holds
     (`marketdata_repo.go:772`; `recon.md:112`).
   - Set the key back to `false`. Once the operator accepts the lane's audit report, restore the
     value recorded at Step 0 and log it. That is the freeze's end state.
   - Commit one audit report per lane. Raw exports are not committed (R-16).

## Rejected Alternatives

- `R-1` Percent-to-fraction unit rescale of ROE — rejected because the trace disproves it: the EDGAR ratio is already a fraction and 28,070,000 appears in no row.
- `R-2` Flow-based `statementEnd` anchor (latest end among classified flow facts) — rejected because it gives a zero anchor for instant-only buckets, turns existing tests red and breaks on 52/53-week offsets.
- `R-3` Fallback to first-seen when no instant matches the anchor — rejected because it quietly reintroduces the defect; nil is handled end to end.
- `R-4` `equity ~= assets - liabilities` sanity guard as the fix — rejected because it hides the symptom, is false-positive-prone and does not repair stored inputs; allowed only as a test and post-deploy assertion.
- `R-5` SQL migration or `overwrite=true` as the ROE repair mechanism — rejected because the `DerivationVersion` gate already re-derives and preserves feature-216 `@AC-3` / `@AC-4`.
- `R-6` Per-metric latest-`end` flow selection with no tie to the instant anchor, in buckets that have an anchor — rejected because a bucket missing its current-period fact silently takes the prior-year comparative.
- `R-7` Pre-bump coverage audit over about eight committed filer fixtures — rejected because eight filers say nothing about the universe and add more test data than the RED test needs.
- `R-8` A duplicated derivation-owned key list beside the strip SQL with a comment cross-reference — rejected because `internal/source` is already imported by both packages, so one exported list needs no new dependency edge (C-18).
- `R-9` Changing `mergePrice` to clear P/B on an anchor miss — rejected because it would be a feature-216 business-rule CHANGE; the stale P/B is recorded as a residual.
- `R-10` Restricting the period-selection fix to `net_income` only — rejected because the operator ruled uniform scope across net income, revenue and EPS.
- `R-11` Logging revenue tag ties as a residual instead of a fixed precedence — rejected because the two tags carry different values, so stored revenue would change between runs.
- `R-12` Sorting each unit's instant slice by `end` descending so first-seen becomes latest — rejected because it silently takes a subsequent-event instant, leaves flows on the old basis and contradicts D-6 and D-7.
- `R-13` Serving TTM net income as a new `extra_metrics` key — rejected because a new served key is scope creep (C-18); the check is a computation from stored rows.
- `R-14` Pinning an estimated ROE (about 0.8 or 0.86) as an acceptance value — rejected because the real filing gives 0.942632 and 0.868791; estimates repeat the placeholder-figure failure in fails.md 2026-11-04.
- `R-15` A single DO-lane re-backfill and audit covering both DO staging and production — rejected because they are separate databases on one cluster and no marketdata table has an environment column.
- `R-16` Committing the raw pre and post exports to the feature directory — rejected because a universe-wide dump is neither a fixture nor a test (C-13, C-18); only the audit report is committed.
- `R-17` Counting `pe_ratio` and `pb_ratio` in the nil'd-rows escalation threshold — rejected because the price-join merge never goes value to nil, so the count is always zero and gives false comfort.
- `R-18` A production lane or production read path in the Step 5 repair and audit — rejected because the operator ruled there are no production instances and staging is enough.
- `R-19` Rule (b) as a pause whenever the failing share does not fall from pre to post — rejected because it pauses every clean chunk and every chunk with structural failures; only a rise may trip it.
- `R-20` psql `\copy` carrying a psql variable (`:'syms'`) for the per-chunk export — rejected because psql does not interpolate variables inside `\copy`, so the statement fails.
- `R-21` Paging `query_fundamentals` through the MCP for the universe-wide pre and post exports — rejected because SQL is already required in both lanes, and the MCP read is paged at 50 rows and does not expose `derivation_version` (C-18).
- `R-22` A percentage threshold (5% of the lane's rows) before escalating v1 rows with no outside cause — rejected because those are the unexplained rows; a threshold lets a wrong stored `roe` stay served, against FR-5.

## Open Risks

- [ ] The SQL has never been run (O-38, open). A syntax or label-format surprise delays the freeze — to be addressed at the Step 5 item 0 dry run on lane A, before the freeze.
- [ ] O-16 (open): D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's "other metrics out of scope". The operator approved the design that carries this, but no separate acceptance of the blast radius is recorded — to be confirmed with the operator at `/sdd-spec`; the per-lane audit reports put numbers on it.
- [ ] The acceptance, product-spec, defect-report and title restatements are decided but not yet written — to be addressed at `/sdd-spec` (first step, before any code).
- [ ] Both lane A roles are superusers, so `default_transaction_read_only` guards against mistakes and is not a hard barrier — accepted; Step 5 lane A.
- [ ] The freeze blocks every staging fundamentals backfill in both environments from before the merge until each lane's report is accepted, and can collide with peer feature 343 (`backtest-inline-backfill`) testing — to be coordinated at Step 5 item 0.
- [ ] While a lane is enabled, another admin backfill can still rewrite rows; the per-chunk subset check detects it after the fact — accepted; Step 5 item 4.
- [ ] If v2 reaches a lane before its pre-export is taken, that lane's changed-rows audit cannot be rebuilt. How homelab staging receives the v2 build was not checked — covered by taking both pre-exports before the `main-dev` merge; to be confirmed at `/sdd-spec`.
- [ ] The TTM sample can false-fail or skip where label selection differs from the code (PIT cutoff, FY-fact-keyed Q4, anchor-miss nil quarters). A large skipped share proves little beyond the three controls — to be reported at Step 5 item 6.
- [ ] Rewrites are in place; rollback is another version bump plus a full re-backfill. After the canary, one 10-symbol or one 50-symbol chunk per lane can be rewritten before a rule trips — accepted; Step 5.
- [ ] LYFT, AXP and AAPL may not all be stored in each lane; their absolute checks still run, with no pre-export baseline — to be checked at Step 5 item 1.
- [ ] The thresholds (5% nil'd, 1% identity, 0.1% TTM, 20-symbol sample) are proposals the operator may tune — Step 5.
- [ ] Uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer, so PIT backtests and screens drift; `end == anchor` yields nils where a filer's flow end and balance-sheet date differ — to be sized by the Step 5 audit reports.
- [ ] P/B and P/E stay stale on anchor-miss rows; the audit only sizes this residual — logged in the marketdata findings file at Step 4.
- [ ] A corrected LYFT ROE of 0.94 is right but still looks implausible to a trader — accepted (operator ruling to restate from the filing).
- [ ] The pinned literals come from a live SEC fetch that is not committed; the Step 3 fixture must reproduce them — Step 3.
- [ ] The homelab `xstockstrat_production` database exists and is not repaired, per the operator ruling — accepted.
- [ ] `DerivationVersion` is shared; another in-flight feature bumping it must be coordinated so one re-backfill covers both — check `merge-order.md` at `/sdd-spec`.
- [ ] File-level rebase overlap with 317, 320 and 322 (`recon.md:144`) — at integration.

## Constitution Rules Touched

- `C-01` — honored by: every claim cites `recon.md` or a register row with `path:line`; `/sdd-spec` re-greps each line.
- `C-09` — honored by: the proto edit is comment-only, with `buf lint`, `buf breaking` and `./scripts/buf-gen.sh` in the same PR.
- `C-11` — honored by: the bug went through triage (Track C), product-spec review, recon and a full debate before any code.
- `C-13` — honored by: one LYFT fixture in the service's testdata home, trimmed by tag, beside the existing AXP and AAPL data; raw exports stay out of git.
- `C-14` — honored by: the consumer surfaces are named above; no consumer code change is needed.
- `C-15` — honored by: `@AC-1`, `@AC-3`, `@AC-5` are restated from the filing and `@AC-2` keeps two vendor rows, each mapped to a RED test in Step 3 or Step 4.
- `C-16` — honored by: the Business Rules section below; every CHANGE has an operator decision.
- `C-18` — honored by: no new public type, no new served key, one exported key list, SQL for bulk reads in place of a paging client.
- `P-01` — honored by: the orchestrating skill is the only writer of the feature files and the register.
- `P-02` — honored by: proposer and adversary saw only the mediated state each round.
- `P-03` — honored by: the percent hypothesis was surfaced and restated instead of fitted; unexecuted SQL (O-38) and the unrecorded O-16 acceptance are listed as open, not assumed.
- `P-04` — honored by: operator approval at the gate after round 6, recorded in feature.md and context.md.
- `P-05` — honored by: each gate session, operator ruling and config flip is written to context.md as it happens.
- `P-06` — honored by: Step 3 commits the fixture and failing tests before the Step 1 and Step 2 code.
- `F-04` — honored: no path or symbol is invented; the unchecked items are named in Open Risks.
- `F-06` — honored: no pool is added or raised. The audit uses one short-lived operator `psql` session at a time, per lane.
- `MARKETDATA-11` — honored by: an anchor miss yields nil ROE and D/E, zeroed only at the proto edge.
- `MARKETDATA-13` — honored by: stored rows are reached only through the `DerivationVersion` bump and re-backfill.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "LYFT's served ROE agrees with its own net income and equity" (feature 340, `acceptance.feature`) — `Then` restated from 0.0366 to 0.942632 on the EDGAR quarterly path; signed off by user @ 2026-11-15 (context.md, operator decision "restate the acceptance values (@AC-1, @AC-3, @AC-5) ... from the real LYFT SEC companyfacts fixture").
- CHANGE `@AC-2` "every provider path serves ROE as a fraction" (feature 340) — keep the Finnhub and FMP rows as unit-level guards, drop the EDGAR row, retitle the outline; signed off by user @ 2026-11-15 (context.md, design gate round 6, "I approve 340, including the acceptance scenario.").
- CHANGE `@AC-3` "historical fundamentals serve ROE as a fraction" (feature 340) — FY2025 `roe` restated to 0.868791; signed off by user @ 2026-11-15 (context.md, same restatement decision as `@AC-1`).
- CHANGE `@AC-5` "a wrong ROE stored before the fix is no longer served" (feature 340) — `Then` restated to 0.942632; signed off by user @ 2026-11-15 (context.md, same restatement decision as `@AC-1`).
- PRESERVE `@AC-4` "an absent or negative ROE is preserved" (feature 340) — not regressed by: nil stays nil and the sign is untouched.
- PRESERVE `@AC-1 @feature-211` and `@AC-9 @feature-211` (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — not regressed by: per-unit selection at one cross-unit anchor date; PIT and snapshot read the same re-derived row. PIT drift is recorded in the audit report.
- PRESERVE `@AC-1 @feature-223` "Stored AXP periods carry financial-debt D/E after re-derivation" (`fix-stored-edgar-periods.feature`) — not regressed by: debt and equity share the anchor date; AXP D/E about 1.73 is a canary check.
- PRESERVE `@AC-3 @feature-222` "Annual periods are unchanged" (`fix-edgar-quarterly-roe.feature`) — not regressed by: annual `roe` is still annual net income over equity; only which instant is the period-end equity changes.
- PRESERVE `@AC-3 @feature-216` and `@AC-4 @feature-216` (`fix-historical-fundamentals-price-join.feature`) — not regressed by: `roe` is repaired through the version-bump re-derive; `overwrite=true` touches only price-join columns.
