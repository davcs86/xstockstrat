# Context Log: fix-fundamentals-roe-unit

> Distilled 2026-11-15 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Header = live state (update in place). Below it: compressed `## Superseded Sessions`, then the append-only `## Session` log.

## Decisions

Operator decisions (binding; wording as recorded, verbatim quotes kept):

- Operator (2026-11-15, product-spec review): Root cause is not traced; recon must trace which provider or merge path produced roe ~3.66 for LYFT on staging before any fix is designed.
- Operator (2026-11-15, design gate): restate the acceptance values (@AC-1, @AC-3, @AC-5), the product-spec 'low single-digit' claim, the defect-report premise and the feature title from the real LYFT SEC companyfacts fixture, even if corrected ROE lands near 0.8.
- Operator (2026-11-15, design gate): apply the period-selection fix uniformly to net income, revenue and EPS (not net_income only), with a post-deploy audit of the rows that change.
- Operator (2026-11-15, design gate, round 3): keep the slug fix-fundamentals-roe-unit (branch and directory stay); only the title and prose are restated.
- Operator (2026-11-15, design gate, round 4), verbatim on the audit's production read path: 'There are no production instances. Staging is enough.' The post-deploy re-derive and audit cover the staging databases only (homelab staging and DigitalOcean staging); no production lane.
- Operator (2026-11-15, design gate, round 5), verbatim 'Ok, agreed.' — the freeze of marketdata.fundamentals.history.enabled on both staging environments during the re-derive is consented.
- Operator (2026-11-15, design gate, round 5), verbatim 'I plan to do psql over ssh if possible.' — the operator runs the homelab read queries personally over ssh on the DB host through the postgres socket; fallback superadmin from the operator's MacBook. No homelab-edge change.
- Operator (2026-11-15), verbatim 'Override the rounds cap for 340': the full-mode cap of 5 debate rounds is lifted for this feature.
- Operator (2026-11-15, design gate, round 6), verbatim 'I approve 340, including the acceptance scenario.' — in answer to two questions asked together: (1) approve the round-6 design; (2) sign off the change to acceptance scenario @AC-2: keep the Finnhub and FMP rows as unit-level guards, drop the EDGAR row (EDGAR is covered by the LYFT fixture scenarios), and retitle the scenario outline. Both are approved; the @AC-2 CHANGE is covered by this operator decision.
- Operator (2026-11-15, after impl-spec review; full question/answer text in the verbatim session "operator answers after impl-spec review (orchestrator)" below): O-16 blast radius — "Acknowledged"; `@AC-5` third `Given` — "Alright"; "max_connections are now love." — "I confirm it" (read as "now live": homelab DB host `max_connections` = 70, PgBouncer pool 10 per database, homelab-edge PR #79; not verified against the live host); recorded risks — "I acknowledge the risks".
- Operator instruction relayed at round 6, verbatim "Use MCP tools if possible in 341 and 343": names features 341 and 343, so it does not bind this feature's bulk export (D-34).

Design (approved; authoritative text is `design.md`, register is `debate.md`: State approved, D-1..D-37, R-1..R-22, O-1..O-38, P-1..P-3):

- Fix the EDGAR inputs, not the unit: collect-then-select in `FetchHistorical` on a balance-sheet-native anchor, uniform flow keying, `DerivationVersion` 1 → 2, then a two-lane staging repair and audit (homelab staging first, DO staging after) behind a freeze on `marketdata.fundamentals.history.enabled`. Rejected: a percent-to-fraction rescale (R-1) and 21 other locked alternatives (R-2 to R-22, in design.md).
- Root cause (D-11): stored LYFT roe 3.6634 = genuine TTM net income 2,809,866,000 over a first-seen equity 767,016,000 dated 2024-12-31; the Q3-2026 quarter-end equity is 2,980,873,000. Restated literals (D-12): `@AC-1` / `@AC-5` roe 0.942632 (Q3-2026), `@AC-3` roe 0.868791 (FY2025). They come from an uncommitted live SEC fetch; the fixture must reproduce them and the expected values are not adjusted to fit.
- C-16 sign-offs: CHANGE to this feature's `@AC-1`, `@AC-3`, `@AC-5` (restatement decision) and `@AC-2` (round-6 gate decision). PRESERVE: `@AC-4` here, `@AC-1` and `@AC-9 @feature-211`, `@AC-1 @feature-223`, `@AC-3 @feature-222`, `@AC-3` and `@AC-4 @feature-216`.
- Design depth was escalated from the triage `quick` to full at product-spec review (proto touched, overlap findings, root cause untraced). Constitution rules touched: C-01, C-09, C-11, C-13, C-14, C-15, C-16, C-18, P-01 to P-06, F-04, F-06, MARKETDATA-11, MARKETDATA-13. Floor breaches: none.
- Register housekeeping applied at approval (status cells only, no row reworded): O-18 closed on the round-6 sign-off; D-20 and D-23 marked `superseded by D-30` / `D-31`; P-1 and P-2 marked `user reopened`, not `user declined`. The run instruction said to mark pending petitions `user declined`, but the register shows the operator did reopen both targets (O-5 at round 4, D-20 at round 6) and the round-6 mediator note asked for `user reopened` — a recorded deviation from the run instruction.
- D-35's register row writes the absolute-value bars as `/` (a `|` would break the table). The exact rule is `|equity - (assets - liabilities)| > 1% of |assets|` (round-6 state block).
- Relayed operator answers that were never mapped to a question for this feature, and so are NOT sign-offs (P-04): the ten unlabeled answers of round 4 (among them "Agreed", "I confirm it", "Keep it", "use the mcp to read the values", "choose the one with less friction"); round 5 "1. Approved", "2. Confirmed", "3. Sign-off the change, amend it"; second round-5 pass "1. Agreed", "4. Confirmed", "6. Sounds good" ("5. Yes, fix the primitives. Use the switch component from Shadcn." is about UI primitives, not this feature). The verbatim text of the "operator steer round 6" behind D-30, D-31 and D-35 never reached the writer. Every decision this feature relies on is covered by the labelled decisions above.

Implementation spec (`/sdd-spec`, 10 steps, tree `feature/fix-fundamentals-roe-unit@90d0a2424`; reviewed with 0 failures, 11 warnings, spec edited in place at commit `78a4d4736`):

- Step order: the key list and strip (Steps 2+3) land before the selection fix and version bump (Steps 4+5). The design numbers them the other way; the content is unchanged. Reason: the bump is what makes stored rows re-derive, so the strip must exist first. Open threads below that came from the design session cite design.md step numbers and are labelled so.
- Atomic units (`**Lands with**`): Steps 2+3, 4+5 and 7+8. The `DerivationVersion` bump (`edgar_client.go:524`) turns `TestDerivationVersion_GoldenDriftGuard_feature223` red until the golden gains a version-2 entry; the re-derive SQL (`marketdata_repo.go:795-797`) has its text and eight arguments pinned by the pgxmock test. The Go signature does not change, so the three service fakes need no edit.
- Step 1 is the docs restatement (acceptance scenarios, product-spec premise, `feature.md` summary, defect report); the four files are restated together by `/sdd-execute` because the defect report is outside the feature directory. The exact Gherkin is in Step 1. The `@AC-5` third `Given` ("the post-deploy fundamentals backfill has re-derived the stored LYFT periods") is spec wording; the operator confirmed it ("Alright").
- Step 6 (vendor unit guards for `@AC-2`, absent/negative guards for `@AC-4`) is `TDD: N/A`: the behavior is already correct, so the tests cannot go red. A one-off local mutation check is required instead (accepted trade-off against C-08 / P-06).
- Step 4 decided two points the design leaves open (flagged for review): a bucket with debt instants but none of the three balance-sheet tags has no anchor, so its debt keys are absent; with no anchor, a flow is selected per unit at the metric's latest `end` across its units.
- The post-deploy repair and audit (design.md § Step 5, items 2 to 7) is not an execute step; the spec carries it as § Post-Deploy Procedure and points at design.md for the queries. The pre-merge part (dry run, freeze, pre-export) is Step 10, run with the operator.
- Names chosen by the spec, not the design: audit reports `audit-lane-a.md` / `audit-lane-b.md` in this directory; the exported key list `DerivationOwnedExtraKeys` (the design fixes its contents and home, `internal/source`).
- Both staging environments deploy on a push to `main-dev` (`.github/workflows/deploy-dev.yml` calls `deploy-homelab.yml`), so the pre-exports must be taken before the integration PR merges.
- `DerivationVersion` 2 is free: `merge-order.md` names it only for the launched pair 222/223 (`:82`). `internal/edgar/testdata/` does not exist yet; the LYFT fixture creates it. `internal/repository` and `internal/service` are outside the CI coverage measurement; `internal/edgar`, `internal/source`, `internal/finnhub`, `internal/fmp` are measured.
- The ingest concurrency-cap steer belongs to a peer feature; the repair stays sequential (one chunk polled to terminal before the next) and does not rely on it.
- Nothing has been executed in any session so far: no code edit, no SQL, no config change.

## Open Threads

Closed by the operator answers (see the verbatim session below): O-16, the `@AC-5` third `Given`, the meaning of "max_connections are now love.". The operator acknowledged the risk list (343 freeze collision, in-place rewrite, unrun audit SQL, `data.sec.gov` egress, unrepaired homelab `xstockstrat_production`); the items stay listed where an action remains.

- [ ] Restatements decided but not written: `acceptance.feature` (`@AC-1`, `@AC-2`, `@AC-3`, `@AC-5`), the product-spec "low single-digit" claim, the defect-report premise, the feature title and the `feature.md` summary — Step 1, before any code step.
- [ ] Step 4 selection rules (no-anchor debt keys absent; no-anchor flow per unit at its latest `end`) need the design owner's confirmation — Steps 4+5 confirmation.
- [ ] The LYFT fixture needs a live fetch from `data.sec.gov`; blocked egress blocks the step (the file is not hand-written) — Step 5.
- [ ] The pinned values 0.942632 and 0.868791 must be reproduced by the fixture; expected values are not adjusted to fit — Step 5.
- [ ] Existing edgar tests were read against the new rule and are expected to stay green; that is a reading, not a run — Step 5.
- [ ] The version-2 golden hash may equal the version-1 hash, because the AXP fixture has no comparative instants — Step 5.
- [ ] Step 6 mutation proof is hand-run; the executor must record the mutation result in context.md — Step 6.
- [ ] `buf breaking` against `feature/fix-fundamentals-roe-unit` needs that branch as a local ref in the main checkout; the command now uses `GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir)` but `buf breaking` itself was never run — Step 7.
- [ ] C-14: no `xstockstrat-ui` or `xstockstrat-agent` step and no follow-up feature is named; the surfaces are checked only post-deploy through the LYFT canary `query_fundamentals`. Decide whether a follow-up is needed — `/sdd-execute` checkpoint.
- [ ] `max_connections` = 70 / PgBouncer pool 10 was confirmed by the operator but not verified against the live host; budget the Step 10 `psql` sessions against it (F-06) — Step 10 item 1.
- [ ] The freeze blocks all staging fundamentals backfills in both environments and can collide with peer feature 343 testing (risk acknowledged) — Step 10 item 2.
- [ ] O-38: the design's SQL has never been run, and the proposer never saw the mediator's corrections (server-side `COPY`, `LEFT JOIN` in Q-ttm, `-v syms` inside the ssh command, the SOPS password on the fallback) — Step 10 item 3, the read-only dry run on lane A, before the freeze.
- [ ] If v2 reaches a lane before its pre-export, that lane's audit cannot be rebuilt; both stagings deploy on the `main-dev` push, so the pre-exports come before the integration PR merges — Step 10.
- [ ] Step 10 verification is a grep on context.md; it proves the entries exist, not that the freeze or export state is correct. The operator confirms the state — Step 10.
- [ ] LYFT, AXP and AAPL may not all be stored in each lane — Post-Deploy Procedure (design.md § Step 5 item 1).
- [ ] Another admin backfill can rewrite rows while a lane is enabled; the subset check only detects it (accepted) — Post-Deploy Procedure (design.md § Step 5 item 4).
- [ ] The TTM sample can false-fail or skip (PIT cutoff, FY-fact-keyed Q4, anchor-miss nil quarters) — Post-Deploy Procedure (design.md § Step 5 item 6).
- [ ] Thresholds (5% nil'd, 1% identity, 0.1% TTM, 20-symbol sample) are proposals the operator may tune — Post-Deploy Procedure.
- [ ] Uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer; PIT backtests and screens drift — record in the lane audit reports.
- [ ] P/B and P/E stay stale on anchor-miss rows — the findings entry (design.md § Step 4).
- [ ] File-level rebase overlap with 317 (`internal/service/marketdata_service.go`), 320 (`internal/fmp/fmp_client.go`, `internal/finnhub/finnhub_client.go`) and 322 (`packages/proto/marketdata/v1/marketdata.proto`, comment-only) — integration.
- Accepted, no action: lane A roles are superusers, so `default_transaction_read_only` is a guard, not a barrier; rewrites are in place, so rollback is another version bump plus a full re-backfill; a corrected LYFT ROE of 0.94 still looks implausible to a trader; the homelab `xstockstrat_production` database is not repaired (operator ruling).

## Files Modified

- `docs/roadmap/features/340-fix-fundamentals-roe-unit/{feature.md,product-spec.md,acceptance.feature,context.md}` — created by `/sdd-triage` (regression scenario; not yet restated).
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/{recon.md,debate.md,design.md}` — written by `/sdd-design` (6 rounds).
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/implementation-spec.md` — written by `/sdd-spec` (10 steps); edited in place by the advisory impl-spec review (commit `78a4d4736`).
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/status.md` — draft → spec-ready → design-approved → implementation-ready.
- No service code, proto, SQL or config has been changed yet.

---

## Superseded Sessions

### 2026-11-15 — /sdd-triage

- Defect report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md` (operator report from homelab staging with screenshots; read-only recon the same day): Fundamentals ROE value implausible against sibling metrics. SEV-3, Track C, affected service `xstockstrat-marketdata`, branch `feature/fix-fundamentals-roe-unit`.
- Recommended design depth was `quick` (SEV-3, single service); superseded by `full` at product-spec review.

### 2026-11-15 — sdd-review product-spec

- Approved, draft → spec-ready, with warnings: `@AC-1` / `@AC-5` Givens name no provider and Open Question 1 was "Decided" only as "recon must trace it" (C-15); FR-2 testable only through `@AC-1`; `@AC-1` / `@AC-5` partly redundant, kept as regression scenarios; FR-5: the version bump / `BackfillFundamentals` covers only EDGAR-derived historical rows, the current-snapshot `marketdata.fundamentals` row is overwritten on re-fetch (both paths named in product-spec § Fix Scope). A stale working-tree product-spec had unchecked gate boxes; the branch copy is authoritative.
- Overlap (WARN, file-level rebase risk only; no config-key, proto field-number or migration collision): `marketdata_service.go` vs 317 (`:338`), `fmp_client.go` vs 320 (`:260`), `finnhub_client.go` vs 320 (`:126`), `marketdata.proto` comment-only on `roe = 8` / `roe = 13` vs 322 (near `:333`). The overlap pass called the cited `fmp_client.go:481` drifted; checked on the branch — `:474` is the struct field, `:481` is the `f.ROE = r.ReturnOnEquityTTM` pass-through, so the spec anchor stands.
- Operator decision recorded here (root cause must be traced first) is in the header.

### 2026-11-15 — sdd-batch design gate (round 2)

- Halted at the approval gate (policy: halt); register D-1..D-10, R-1..R-9, O-1..O-16; adversary verdict NEEDS WORK, mediator agreed; no Floor breach. Blocking then: O-1 (`Then 0.0366` came from the disproved percent hypothesis; operator must restate `@AC-1/3/5`, the "low single-digit" claim, the defect premise and the title), O-2 (LYFT fixture not cut), O-4 (uniform vs `net_income`-only flow scope), O-11 (universe-wide `overwrite=true` backfill not runnable: explicit symbol list, 50-symbol cap, 365-day default lookback). All later closed; history in `debate.md`.
- Uncovered `@AC` CHANGE at this gate: `@AC-1`, `@AC-2`, `@AC-3`, `@AC-5`.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 3)

- Halted at the gate; register D-1..D-17, R-1..R-14, O-1..O-23, P-1. The mediator fetched LYFT `companyfacts` (CIK0001759509) from sec.gov and confirmed the root cause (D-11) and the restated literals (D-12, operator ruling on O-1); the fixture lands in the RED step, not at the gate (D-17). Closed: O-1, O-2, O-4, O-6, O-7, O-10 to O-14.
- Blocking then: O-17 — the uniform-scope ruling came with a changed-rows audit, but `RederiveHistoricalFundamentals` overwrites in place, so a pre-backfill export keyed on (`symbol`, `fiscal_period`, `period_type`) is required; the mediator wrote it into Step 5 before the proposer answered. P-1 (reopen O-5: the `roe x equity ~= TTM NI` check uses an operand never stored or served) was pending the user. O-23: stored `period_end` may be the `dei` cover-page date (read from code, not checked against rows).
- The steer to raise the ingest concurrency cap was ruled out of this feature (peer feature); Step 5 stays sequential.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 4)

- Halted at the gate; register D-1..D-24, R-1..R-17, O-1..O-30, P-1. Steps 1 to 4 agreed by both sides. The mediator rewrote Step 5 as three lanes (homelab staging, DO staging, DO production) with per-lane pre-export, canary (LYFT, AXP, AAPL), ≤50-symbol chunks and audit; the proposer had not accepted it. DO staging and production are separate databases on one cluster (`.do/app.yaml:696-697`, `.do/app.dev.yaml:698-699`) and no marketdata table has an environment column (R-15). O-5 was reopened by the operator steer and closed the same round (TTM NI as a computation from `query_fundamentals` rows: 2,755,053,000 + 14,250,000 + 50,294,000 − 9,731,000 = 2,809,866,000).
- Blocking then: O-25 (production lane had no read path; only the two staging MCPs are reachable; the operator's "use the mcp to read the values" and "choose the one with less friction" pointed different ways, so the mediator did not choose), O-24, O-26. O-25 was later dissolved by 'There are no production instances. Staging is enough.'
- Ten operator answers were relayed unlabeled; none of "Agreed", "I confirm it" or "Keep it" was treated as a sign-off for O-16 or O-18. Risk carried: the version bump cannot be vetoed by the audit, so the canary chunk is the only veto before the universe is rewritten.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 5)

- Halted at the gate; register D-1..D-29, R-1..R-19, O-1..O-37, P-1..P-2. Relayed verbatim and unlabeled: "1. Approved", "2. Confirmed", "3. Sign-off the change, amend it", "4. There are no production instances. Staging is enough." Only answer 4 was identifiable (D-25 / R-18: two staging lanes, no production lane; homelab `xstockstrat_production` untouched); 1 to 3 were not recorded as sign-offs (P-04).
- Blocking then: O-32 — once v2 is deployed any `BackfillFundamentals` call, including `overwrite=false`, re-derives stale rows (`marketdata_service.go:2398-2407`), the strat-lab backtest skill tells agents to run fundamentals backfills, and a `main-dev` merge puts v2 on DO staging while lane A runs; the mediator's remedy is the freeze (`marketdata.fundamentals.history.enabled = false` in both stagings before the merge, `true` per lane only for its run, every flip recorded here), which can collide with 343. O-31 — lane A's SQL cited `operator-db-access.md`, which covers only the DO cluster; homelab is reached per homelab-edge `docs/runbooks/db-host.md` § Manual access, and the read-only `admin` role has no allowed hosts (db-host.md:19). O-33 — rule (b) as written paused every clean chunk; earlier wording locked as R-19.
- P-2 (new) targeted D-20: choose the TTM quarters by `fiscal_period` label instead of the stored `period_end` window (also amends D-23). Not checked at this gate: how and when homelab staging receives the v2 build (answered later by `/sdd-spec`).

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 5, second pass)

- Second `/sdd-batch` pass at the same gate; no debate round ran, register unchanged (Rounds run = 5). Relayed verbatim and unlabeled, spanning the four features of the batch: "1. Agreed", "2. Ok, agreed.", "3. I plan to do psql over ssh if possible.", "4. Confirmed", "5. Yes, fix the primitives. Use the switch component from Shadcn.", "6. Sounds good". None recorded as a sign-off at this gate (P-04); answer 5 does not belong to this feature; 1, 2, 4 and 6 could not be told apart.
- Answer 3 was read as O-31: lane A's SQL runs through `ssh` to the DB host and then `sudo -u postgres psql` — the `postgres` socket, a superuser session, not the read-only `admin` role — so Step 5 must say how the session is kept read-only (later D-33).

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 6)

- Round 6 ran on the verbatim sign-off "Override the rounds cap for 340" (Commandment override) and halted at the gate; register D-1..D-37, R-1..R-22, O-1..O-38, P-1..P-3. O-31 to O-37 closed; no blocking objection left. Step 5 changes: bulk reads are SQL in both lanes (D-34: Q-pre, exports as server-side `COPY ... TO STDOUT`, Q-ttm, Q-v1) while the MCP keeps config flips, backfill trigger/status and served-value checks; every session sets `default_transaction_read_only=on` (D-33); freeze-breach check per chunk (D-32); TTM check by `fiscal_period` label (D-30, D-31); 10-symbol ramp (D-36); finish gate where every unexplained v1 row escalates (D-37). The paste-ready queries are in the state block below.
- Provenance: the mapping of "2. Ok, agreed." to the freeze consent (O-32, D-32) and "3. I plan to do psql over ssh if possible." to lane A's read path (O-31, D-33) reached the writer inside the orchestrator's round-6 state, not as a labelled operator message; the verbatim "operator steer round 6" behind D-30, D-31 and D-35 did not reach the writer; answers 1, 4 and 6 stayed unmapped.
- "Use MCP tools if possible in 341 and 343" does not bind this feature (D-34). Nothing was executed: no SQL, no config change.

```sdd-batch-design-state
{
  "round": 6,
  "synth": {
    "approach": "Round-6 synthesis. Steps 1 to 4 are unchanged (D-1 to D-19, D-21, D-22, D-24). Only Step 5 and the D-20 / D-23 check key change. Paths are under `services/xstockstrat-marketdata` unless stated.\n\n**Steps 1 to 4 (settled, unchanged).**\n- Step 1: collect-then-select in `FetchHistorical` (`internal/edgar/edgar_client.go:290`, replacing first-seen at `:357-364`); balance-sheet anchor; uniform flow keying; `Revenues`-first precedence; `DerivationVersion` 1 to 2 (`:524`) with the `derivationGolden` update.\n- Step 2: one exported derivation-owned key list in `internal/source`, used by `buildPeriod` and the strip in `RederiveHistoricalFundamentals` (`internal/repository/marketdata_repo.go:795-797`).\n- Step 3: RED tests from `internal/edgar/testdata/lyft_companyfacts.json` (roe 0.942632 and 0.868791) plus the synthetic cases.\n- Step 4: vendor unit guards, comment-only proto lines (`packages/proto/marketdata/v1/marketdata.proto:233`, `:283`), residuals in the marketdata findings file.\n\n**Step 5: post-deploy repair and audit, two staging lanes, no production lane (D-25, R-18).**\n\n| Lane | Database | SQL read path (read-only session) | MCP (config flips, backfill, served values) |\n|---|---|---|---|\n| A, homelab staging, first | `xstockstrat-staging` (`/home/user/homelab-edge/docs/runbooks/db-host.md:13`) | The operator, personally: `ssh david_admin@db.ts.natanddavehouse.com`, then `sudo -u postgres psql` on the socket (`db-host.md:21`, `:36`). Fallback: `superadmin` from `macbook-pro` (`db-host.md:20`, `:28-32`). The `admin` role is not used (no allowed hosts, `db-host.md:19`). | `xstockstrat_homelab_staging` |\n| B, DO staging, only after lane A ends with no escalation | `xstockstrat-staging` (`.do/app.dev.yaml:698-699`) | `docs/runbooks/operator-db-access.md:36-49` (`doctl`, then `psql` on `:25060`) | `xstockstrat_staging` |\n\n**Command templates.** The query file goes on stdin; output stays on the operator's machine, never git (R-16).\n- Lane A: `ssh david_admin@db.ts.natanddavehouse.com \"sudo -u postgres env PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -v syms=LYFT,AXP,AAPL -d xstockstrat-staging -f -\" < Q.sql > out.csv`\n  - `-v syms=...` sits inside the remote command string (the proposal left it out).\n- Lane A fallback, password read from SOPS as the runbook requires (`db-host.md:29-31`, `:40`):\n  `PGOPTIONS='-c default_transaction_read_only=on' PGPASSWORD=\"$(sops decrypt --extract '[\"db_role_superadmin_password\"]' secrets/edge.sops.yaml)\" psql \"host=db.ts.natanddavehouse.com user=superadmin dbname=xstockstrat-staging sslmode=require\" -X -v ON_ERROR_STOP=1 -v syms=... -f Q.sql > out.csv`\n- Lane B: the same `psql` flags against the `doctl` URI with `dbname=xstockstrat-staging`.\n\n**Paste-ready queries** (table `marketdata.fundamentals_history`; labels are `Qn-YYYY` and `FYYYYY`, `migrations/005_fundamentals_history.up.sql:9`, `edgar_client.go:539`).\n- **Q-pre:** `SELECT symbol, count(*) AS n, min(period_end) AS min_end, max(derivation_version) AS max_v FROM marketdata.fundamentals_history GROUP BY symbol ORDER BY symbol;`\n- **Q-export, full table (pre-export and post-export):**\n  `COPY (SELECT symbol, fiscal_period, period_type, period_end, filed_date, source, derivation_version, eps, roe, debt_to_equity, pe_ratio, pb_ratio, extra_metrics->>'net_income' AS net_income, extra_metrics->>'revenue' AS revenue, extra_metrics->>'stockholders_equity' AS equity, extra_metrics->>'assets' AS assets, extra_metrics->>'liabilities' AS liabilities, extra_metrics::text AS extra_metrics FROM marketdata.fundamentals_history ORDER BY 1,2,3) TO STDOUT WITH (FORMAT csv, HEADER);`\n- **Q-export, per chunk:** the same statement with `WHERE symbol = ANY(string_to_array(:'syms', ','))` before `ORDER BY`.\n  - It is server-side `COPY ... TO STDOUT`, not `\\copy`. psql does not substitute variables inside `\\copy`, so the proposal's form would send the literal `:'syms'` and fail. `COPY ... TO STDOUT` is plain SQL, needs no superuser and runs in a read-only session.\n- **Q-ttm (closing check, by fiscal label):** the proposal's query with one correction: `win` uses `LEFT JOIN qtr`, and the verdict is `'skipped'` when `n = 0`, so a sampled symbol never drops out of the output.\n  ```sql\n  WITH h AS (SELECT symbol, period_type, roe, (extra_metrics->>'net_income')::numeric ni, (extra_metrics->>'stockholders_equity')::numeric eq,\n      CASE WHEN fiscal_period LIKE 'FY%' THEN substr(fiscal_period,3)::int ELSE split_part(fiscal_period,'-',2)::int END fy,\n      CASE WHEN fiscal_period LIKE 'FY%' THEN 4 ELSE substr(fiscal_period,2,1)::int END q\n    FROM marketdata.fundamentals_history WHERE symbol = ANY(string_to_array(:'syms', ','))),\n  qtr AS (SELECT symbol, fy, q, ni FROM h WHERE period_type='quarterly' AND q BETWEEN 1 AND 3\n    UNION ALL\n    SELECT f.symbol, f.fy, 4, f.ni - sum(x.ni) FROM h f JOIN h x ON x.symbol=f.symbol AND x.fy=f.fy AND x.period_type='quarterly' AND x.q BETWEEN 1 AND 3\n    WHERE f.period_type='annual' GROUP BY f.symbol, f.fy, f.ni HAVING count(x.ni)=3),\n  latest AS (SELECT DISTINCT ON (symbol) symbol, fy, q, roe, eq FROM h WHERE period_type='quarterly' ORDER BY symbol, fy DESC, q DESC),\n  win AS (SELECT l.symbol, l.roe, l.eq, count(t.ni) n, count(t.symbol) FILTER (WHERE t.ni IS NULL) nil_q, sum(t.ni) s\n    FROM latest l LEFT JOIN qtr t ON t.symbol=l.symbol AND t.fy*4+t.q BETWEEN l.fy*4+l.q-3 AND l.fy*4+l.q GROUP BY 1,2,3)\n  SELECT symbol, n, nil_q, roe*eq AS implied, s*4/NULLIF(n,0) AS ttm,\n    CASE WHEN n=0 OR nil_q>0 OR roe IS NULL OR eq IS NULL OR s=0 THEN 'skipped' WHEN abs(roe*eq - s*4/n) <= 0.001*abs(s*4/n) THEN 'pass' ELSE 'fail' END AS verdict\n  FROM win;\n  ```\n- **Q-v1 (finish):** `SELECT symbol, fiscal_period, period_type, period_end FROM marketdata.fundamentals_history WHERE derivation_version < 2 ORDER BY 1,2,3;`\n\n**Sequence**\n\n0. **Dry run, then freeze (before the v2 merge into `main-dev`).**\n   - Dry run: the operator runs Q-pre, both Q-export forms and Q-ttm once on lane A. All are read-only. None of these queries has been executed yet, by either side or by me.\n   - Record in context.md the value `marketdata.fundamentals.history.enabled` holds in each staging environment (`get_config`).\n   - Set it to `false` on both staging MCPs (`set_config`, `services/xstockstrat-agent/app/tools.py:1885`; confirm with `get_config`, `:1821`). Operator consent: \"Ok, agreed.\"\n   - Why this key: `BackfillFundamentals` returns `FailedPrecondition` on it (`internal/service/marketdata_service.go:2269-2270`) before the re-derive (`:2398-2407`). The adversary traced the table's only writers (`marketdata_repo.go:728`, `:773`, `:795`) to that one RPC, with no scheduled trigger found, so the freeze holds the table still.\n   - Log every flip in context.md with time, lane and reason.\n1. **Pre-export, frozen, before v2 reaches either lane.** Q-pre and full Q-export per lane. Completeness gate: the export's row count per symbol equals Q-pre's `n` (D-29); otherwise the lane stops.\n2. **Lane start.** The key is `false` by design. The named operator action is `set_config ... = true` on that lane's MCP only, logged. If the key is found `true` before that flip, the freeze was breached: stop, re-run Q-pre, and diff any `max_v = 2` symbol against the pre-export.\n3. **Canary (D-26): LYFT, AXP, AAPL.**\n   - `trigger_backfill(symbols, data_kind=\"fundamentals\", start=min(period_end), overwrite=true)` (`tools.py:1546`), polled with `get_backfill_status` (`:1631`).\n   - Served-value checks through the MCP `query_fundamentals` (`:463`): LYFT Q3-2026 roe 0.942632, FY2025 roe 0.868791, AXP D/E about 1.73.\n   - Then per-chunk Q-export, the identity check and Q-ttm. Any failure stops the lane.\n4. **Ramp and chunks.** Chunk 2 is 10 symbols; later chunks are at most 50 (D-16). After each chunk:\n   - per-chunk Q-export, diff against the pre-export, rules (a) to (d) before the next chunk starts;\n   - re-run Q-pre and assert that the symbols with `max_v = 2` are a subset of the symbols already processed. A symbol outside that set means another caller ran a backfill while the lane was enabled; the lane stops.\n5. **Rule (b) (operator steer).** A row fails the identity when `|equity − (assets − liabilities)| > 0.01 × |assets|`. Rows with nil `assets`, `liabilities` or equity are left out of numerator and denominator on each side. The rule trips only when the post failure share is greater than the pre share, per chunk and cumulatively. A fall or no change is reported only. Hard assertion only on the controls (R-4). Rules (a), (c), (d) and the stale-ratio count are unchanged (D-27).\n6. **Closing TTM check (D-20 reopened by the operator, D-23 amended).**\n   - Q-ttm on the three controls plus a seeded sample of 20 per lane, seed in the report (D-28).\n   - Quarters are the last four fiscal quarters by `fiscal_period` label ending at the latest quarterly label; Q4 = FY − Q1..Q3; scale 4/n when n < 4.\n   - A failing control is hard. A failing or skipped sample row is listed with its quarters and goes to the operator; the sample is advisory.\n   - Known false-fail sources, stated in the report: the code's PIT cutoff (`edgar_client.go:419`, `:483`) and its Q4 derivation keyed on the FY fact's own `start` / `end` instead of the label year (`:439-451`).\n7. **Finish (per lane).**\n   - Re-run `failed_symbols` once. Group Q-v1 output by cause: (1) symbol still failing; (2) period dated before `start`; (3) symbol succeeded, period in range, row still below v2.\n   - Every group-3 row is listed and escalated, with no threshold. A non-empty group 2 is treated as a lane-run error, because `start = min(period_end)` makes it empty by construction (`edgar_client.go:372-374`).\n   - Record PIT drift, the stale-ratio count and why @AC-4 @feature-216 holds (`marketdata_repo.go:772`).\n   - Set the key back to `false`. Once the operator accepts the lane's audit report, restore the value recorded at Step 0 and log it. That is the freeze's end state.\n   - Commit one audit report per lane.\n\n**Why SQL for bulk reads.** Both lanes already need SQL for Q-pre and Q-v1. One `COPY` is a single consistent read that carries `extra_metrics` and `derivation_version`, and it removes the 50-row paging (`tools.py:476`). The MCP keeps config flips, the backfill trigger and the served-value checks. D-24 covers MCP-mode exports only, and none remain for bulk reads.\n\n**Spec restatement (unchanged).** @AC-1, @AC-3, @AC-5, the product-spec claim, the defect-report premise and the title are restated from the filing (D-12); the slug stays. @AC-2 proposal: keep the Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row, retitle the outline.",
    "open_objections": [
      {
        "text": "[O-18, operator, P-04] @AC-2 binds `Then 0.0366` per provider path and is not named in any recorded operator ruling. The proposal (keep the Finnhub and FMP rows as synthetic unit guards, drop the EDGAR row, retitle) needs the orchestrator to map the operator's relayed answer in context.md before /sdd-spec.",
        "blocking": false
      },
      {
        "text": "[O-16, operator, P-04] D/E and P/B change for every EDGAR filer through the corrected equity, beyond the spec's 'other metrics out of scope'. The operator's acceptance must be recorded in context.md before /sdd-spec; the per-lane audit reports will put numbers on it.",
        "blocking": false
      },
      {
        "text": "[P-03] None of the paste-ready queries (Q-pre, both Q-export forms, Q-ttm, Q-v1) has been executed against a real database. The proposer has also not seen the mediator's corrections (server-side `COPY`, `LEFT JOIN` in Q-ttm, `-v syms` inside the ssh command, the SOPS password on the fallback). The Step 0 read-only dry run on lane A must pass before the freeze, and design.md must carry the corrected text.",
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
      "R-1 to R-19 remain locked and none is reintroduced.",
      "psql `\\copy` with a `:'syms'` variable for the per-chunk export: psql does not substitute variables inside `\\copy`, so the statement fails; server-side `COPY ... TO STDOUT` is used.",
      "Paging `query_fundamentals` through the MCP for the universe-wide pre and post exports: SQL is already needed in both lanes, and the MCP read is paged at 50 rows and does not expose `derivation_version` (C-18).",
      "A 5% threshold on v1 rows with no outside cause at the finish: those are the unexplained rows, and letting them through contradicts FR-5; every such row escalates.",
      "Keeping the TTM check windowed on the stored `period_end` (the old D-20 rule): sound, and it mirrors the code's anchor, but the operator steered the reopen to `fiscal_period` labels.",
      "Re-freezing a lane 'until the operator says otherwise': no end state or owner; the pre-freeze value is recorded and restored once the operator accepts the lane report.",
      "Running Q-pre and Q-export in one REPEATABLE READ transaction (adversary's option): not adopted; both results would share one stdout stream, and the freeze plus the breach checks already keep the table still between the two reads.",
      "Using the read-only `admin` role for lane A: it has no allowed tailnet hosts (homelab-edge db-host.md:19), and the operator chose the `postgres` socket over ssh."
    ],
    "open_risks": [
      "The SQL has not been run. The Step 0 dry run is the first execution; a syntax or label-format surprise there delays the freeze.",
      "Both lane A roles are superusers, so `default_transaction_read_only` is a guard against mistakes, not a hard barrier.",
      "The freeze blocks every staging fundamentals backfill in both environments from before the merge until each lane's report is accepted; this can collide with peer feature 343 (backtest-inline-backfill) testing.",
      "While a lane is enabled, another admin backfill can still rewrite rows; the per-chunk subset check detects it after the fact, it does not prevent it.",
      "If v2 reaches a lane before its pre-export is taken, that lane's changed-rows audit cannot be rebuilt. How homelab staging receives the v2 build was not checked; both pre-exports are taken before the `main-dev` merge to cover it.",
      "The TTM sample can false-fail or skip where label selection differs from the code (PIT cutoff, FY-fact-keyed Q4, anchor-miss nil quarters). If the skipped share is large, the check proves little beyond the three controls.",
      "Rewrites are in place; rollback is another version bump plus a full re-backfill. After the canary, one 10-symbol or one 50-symbol chunk per lane can be rewritten before a rule trips.",
      "LYFT, AXP and AAPL may not all be stored in each lane; absolute checks still run, but their rows have no pre-export baseline.",
      "The thresholds (5% nil'd, 1% identity, 0.1% TTM, 20-symbol sample) are proposals the operator may tune.",
      "Uniform flow keying moves stored EPS, revenue, TTM EPS and P/E for every EDGAR filer, so PIT backtests and screens drift; `end == anchor` yields nils where a filer's flow end and balance-sheet date differ.",
      "P/B and P/E stay stale on anchor-miss rows; the audit only sizes this residual.",
      "A corrected LYFT ROE of 0.94 is right but still looks implausible to a trader.",
      "The pinned literals come from a live fetch that is not committed; the Step-3 fixture must reproduce them.",
      "The homelab `xstockstrat_production` database exists and is not repaired, per the operator ruling.",
      "The @AC-2 and O-16 sign-offs are not yet recorded in context.md."
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
      "P-05",
      "P-06",
      "F-04",
      "F-06",
      "MARKETDATA-11"
    ],
    "rationale": "No blocking objection remains. The three round-5 blockers are closed by the operator's rulings and the proposal, and the adversary's one new blocker is a mechanical query defect that I corrected in the approach. The design can go to the gate once the operator's @AC-2 and O-16 answers are recorded in context.md.\n\n**Round-5 blockers.**\n- **O-31 (lane A read path):** the operator named the role (`postgres` socket over ssh, `superadmin` fallback). I confirmed the path and the database name in homelab-edge `docs/runbooks/db-host.md:13`, `:19-21`, `:28-36`. Lane B keeps the DO runbook.\n- **O-32 (freeze):** consented (\"Ok, agreed.\"). I confirmed the gate at `marketdata_service.go:2269-2270`. The adversary traced every writer of the table to that one RPC.\n- **O-33 (rule (b)):** adopted as the steer directs.\n\n**Adversary corrections I adopted.**\n- **`\\copy` with a variable fails.** psql does not interpolate variables inside `\\copy`. I did not run it; this rests on psql's documented behaviour. The per-chunk export is now server-side `COPY ... TO STDOUT`, and `-v syms` is inside the ssh command.\n- **Q-ttm** uses `LEFT JOIN` so a symbol with no quarters reports as skipped. I also changed the nil-quarter count to `count(t.symbol)` so an unmatched row is not counted as a nil quarter, and added `s=0` to the skip to avoid a divide-by-zero.\n- **Finish:** every unexplained v1 row escalates, with no 5% threshold.\n- **Freeze:** a per-chunk breach check, and a recorded end state.\n- **Fallback command:** the password comes from SOPS, as the runbook requires.\n\n**D-20 reopen.** The operator steered it, so the label rule is adopted and D-23's check clause is amended. The petition's stated cause was wrong, and I checked it: `trailingNetIncome` is called with `a.periodEnd` (`edgar_client.go:483`) and windows on it (`:454-458`), and that is the value stored as `period_end` (`:350-352`). The new decision records the true reason (labels avoid date arithmetic on cover-page dates) and the two real code-versus-check differences.\n\n**Left open, all non-blocking.**\n- O-16 and O-18 need the operator's answers mapped in context.md. @AC-2 stays an uncovered CHANGE until then.\n- The queries are unexecuted and the proposer has not seen my corrections; the Step 0 dry run covers this.\n\n**Other notes.**\n- The user's \"Use MCP tools if possible\" names features 341 and 343, so it does not bind this feature's bulk export.\n- Petition P-1 should be marked \"user reopened\" (answered by D-20 in round 4), and P-2 \"user reopened\" this round.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-20: the closing TTM check picks the last four fiscal quarters by `fiscal_period` label ending at the latest quarterly label, with Q4 = FY minus Q1 to Q3 and no new served key. The sample is advisory and only the controls are hard. The report names the two known false-fail sources: the code's PIT cutoff and its Q4 derivation keyed on the FY fact's own dates.",
          "evidence": "Operator steer round 6 reopening D-20 (petition P-2). Corrected reason: `trailingNetIncome` windows on `a.periodEnd` (edgar_client.go:483, :454-458), which is the stored `period_end` (:350-352), so labels are chosen to avoid date arithmetic on cover-page dates, not for a different anchor. False-fail sources: edgar_client.go:419, :439-451. Labels: migrations/005_fundamentals_history.up.sql:9; edgar_client.go:539."
        },
        {
          "text": "Supersedes D-23: `periodEnd` stays unchanged; the cover-page `period_end` and the stale `pe_ratio` / `pb_ratio` on anchor-miss rows are logged as residuals with `shares`; checks key quarters by `fiscal_period`, not the stored `period_end`.",
          "evidence": "Operator steer round 6 ('amending D-23 accordingly'); edgar_client.go:350-352; marketdata_service.go:2418."
        },
        {
          "text": "Fundamentals backfills are frozen with `marketdata.fundamentals.history.enabled=false` in both staging environments before the v2 merge. The key is turned on per lane only for its audited run, with every flip logged in context.md. After each chunk, Q-pre is re-run and the symbols at `derivation_version` 2 must be a subset of those already processed. The pre-freeze value is recorded and restored once the operator accepts the lane report.",
          "evidence": "Operator ruling 2026-11-15, verbatim 'Ok, agreed.'; marketdata_service.go:2269-2270, :2398-2407; writers at marketdata_repo.go:728, :773, :795 reached only from `BackfillFundamentals`. Proposer r6 Step 5 items 0 and 2; adversary r6 (breach check, end state)."
        },
        {
          "text": "Lane A's SQL is run by the operator over ssh on the DB host through the `postgres` socket, with `superadmin` from the operator's MacBook as the fallback (password read from SOPS) and no homelab-edge change. Lane B uses `docs/runbooks/operator-db-access.md`. Every session sets `default_transaction_read_only=on`.",
          "evidence": "Operator ruling 2026-11-15, verbatim 'I plan to do psql over ssh if possible.'; homelab-edge docs/runbooks/db-host.md:13, :19-21, :28-36, :40; docs/runbooks/operator-db-access.md:36-49. Proposer r6; adversary r6 (password source)."
        },
        {
          "text": "Bulk reads (Q-pre, the pre, post and per-chunk exports, Q-ttm, Q-v1) are SQL; the exports use server-side `COPY ... TO STDOUT` with the chunk filter passed as the psql variable `syms`. The MCP is kept for config flips, the backfill trigger and status, and the served-value checks on the controls.",
          "evidence": "Proposer r6 (O-37); adversary r6: psql does not interpolate variables inside `\\copy`, and SQL is the right call for bulk reads. services/xstockstrat-agent/app/tools.py:463, :476, :1546, :1631, :1885. D-24 governs MCP-mode exports only."
        },
        {
          "text": "Rule (b): a row fails when `|equity - (assets - liabilities)| > 1% of |assets|`. Rows with nil `assets`, `liabilities` or equity are excluded from both sides. The rule trips only when the post failure share is greater than the pre share, per chunk and cumulatively, and is a hard assertion only on the controls.",
          "evidence": "Operator steer round 6 (rule (b) fix); proposer r6 Step 5 item 5; adversary r6: R-19 and R-4 honoured."
        },
        {
          "text": "Chunk 2 of each lane is a 10-symbol ramp; later chunks are at most 50 symbols.",
          "evidence": "Proposer r6 Step 5 item 4 (O-36); adversary r6 raised no objection."
        },
        {
          "text": "Finish gate per lane: re-run failed symbols once, then group rows below `derivation_version` 2 by cause. Every row with no outside cause is listed and escalated with no threshold. A row dated before `start` is a lane-run error, since `start = min(period_end)` leaves none.",
          "evidence": "Proposer r6 Step 5 item 7 (O-35); adversary r6 (FR-5; edgar_client.go:372-374); migrations/008_fundamentals_history_derivation_version.up.sql:5."
        }
      ],
      "new_rejected": [
        {
          "text": "psql `\\copy` carrying a psql variable (`:'syms'`) for the per-chunk export.",
          "why": "psql performs no variable interpolation inside `\\copy`, so the statement fails with a syntax error and breaks the canary and the per-chunk veto."
        },
        {
          "text": "Paging `query_fundamentals` through the MCP for the universe-wide pre and post exports.",
          "why": "SQL is already required in both lanes; the MCP read is paged at 50 rows, risks short reads and does not expose `derivation_version` (C-18)."
        },
        {
          "text": "A percentage threshold (5% of the lane's rows) before escalating v1 rows that have no outside cause.",
          "why": "Those are the unexplained rows; a threshold lets a wrong stored `roe` stay served, against FR-5."
        }
      ],
      "new_objections": [
        {
          "text": "[P-03] The paste-ready queries have not been executed, and the proposer has not confirmed the mediator's corrections (server-side `COPY`, `LEFT JOIN` in Q-ttm, `-v syms` inside the ssh command, the SOPS password on the fallback). A read-only dry run on lane A must pass before the freeze, and design.md must carry the corrected text.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-31",
          "how": "The read path is named per lane: lane A is the operator's ssh session on the DB host through the `postgres` socket, with `superadmin` as the fallback (operator ruling); lane B keeps the DO runbook. Paste-ready queries are given."
        },
        {
          "id": "O-32",
          "how": "The freeze on `marketdata.fundamentals.history.enabled` is adopted with the operator's consent ('Ok, agreed.'), with logged flips, a per-chunk breach check and a recorded end state."
        },
        {
          "id": "O-33",
          "how": "Rule (b) is adopted as worded: it trips only on a rise in the failure share, excludes nil rows from both sides and is hard only on the controls."
        },
        {
          "id": "O-34",
          "how": "The lane-start action is named (`set_config` to true on that lane's MCP only, logged), with handling for a breached freeze."
        },
        {
          "id": "O-35",
          "how": "The finish gate re-runs failed symbols once and groups remaining v1 rows by cause; every unexplained row escalates with no threshold."
        },
        {
          "id": "O-36",
          "how": "Chunk 2 is a 10-symbol ramp."
        },
        {
          "id": "O-37",
          "how": "Bulk exports moved to SQL `COPY`; the MCP is kept for config flips, the backfill and the served-value checks."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-20",
          "evidence": "Proposer r6, restating P-2 under the operator steer: the stored `period_end` (edgar_client.go:350-352) can be a cover-page date. The adversary showed the stated cause is wrong: `trailingNetIncome` windows on `a.periodEnd` (:483, :454-458), the same stored value. The reopen stands on the operator's steer; the amendment is recorded with the corrected reason.",
          "is_new": false
        }
      ],
      "reopened": [
        "D-20",
        "D-23"
      ]
    }
  },
  "floor_breaches": []
}
```

### 2026-11-15 — sdd-design

- Phase 0 wrote recon.md (reuse: the feature-222 own-period `niFact` keying; the `DerivationVersion` bump with `RederiveHistoricalFundamentals` and `DeleteEdgarSnapshot`). Phase 1: 6 rounds, full. Status spec-ready → design-approved. The eight binding operator decisions, the chosen approach, the C-16 sign-offs and the register housekeeping (incl. the `user reopened` deviation) are in the header.
- The relayed approval message also read "max_connections are now love."; nothing was changed on it (later explained by the operator, see header).

### 2026-11-15 — sdd-spec

- Generated implementation-spec.md with 10 steps on `feature/fix-fundamentals-roe-unit@90d0a2424` (every `path:line` re-read on it); status → implementation-ready. Decisions and pinned codebase facts are in the header: first-seen write at `internal/edgar/edgar_client.go:357-364`, `periodAgg` built at one site (`:343`) with no test constructing it; golden test `derivation_version_test.go:16-18`, `:53`; pgxmock pin `marketdata_repo_test.go:573-576`; service fakes `marketdata_service_test.go:3241`, `:3245`, `:3252`.
- The restatements were not written in this session because the run could edit only the feature directory and the defect report is outside it.

---

## Session 2026-11-15 — sdd-review impl-spec (advisory)

- Result: 0 failures, 11 warnings (advisory — did not block). Floor breaches: none. Lifecycle unchanged (`implementation-ready`).
- Overlap findings: none (no migration, config key, proto field number or env var; no shared file with an implementation-ready or in-progress feature).
- Operator message relayed with this run, verbatim: "I approve 340, including the acceptance scenario. max_connections are now love." The first sentence is the round-6 gate sign-off already recorded. The second is still unexplained; nothing was changed on it.
- Nothing was executed this session: no code, SQL or config change. `implementation-spec.md` was edited in place (commit `78a4d4736`).

### Addressed in implementation-spec.md

- [x] Steps 3, 5 and 6: the coverage command read `GOWORK=off COVERPKGS=$(…) && go test …`, which leaves `GOWORK` unexported, so neither `go list` nor `go test` saw it. Now `export GOWORK=off && COVERPKGS=$(…) && go test …`.
- [x] Step 7: the `<repo-root>` placeholder is replaced by `GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir)`. Checked in this worktree: it prints the main checkout's `.git`. The `buf` line now runs in a subshell so the following `git diff` path still resolves from the repo root. `buf breaking` itself was not run.
- [x] Step 1: added the indent rule for `acceptance.feature` (tags and `Scenario` lines at two spaces, steps at four, table rows at six), which the `^  @AC-` count depends on.
- [x] Step 1: the new third `Given` of `@AC-5` is no longer written by default. The executor asks the operator at the Step 1 confirmation and writes the line only on an explicit yes (C-15, C-11).
- [x] Step 8: added a note that the three `packages/proto/gen/` entries are directories because the generated file list cannot be named up front (B2 advisory).
- [x] Step 10: the merge gate sentence now also names the two operator answers of item 1 (O-16, `max_connections`).

### Unresolved ⚠ carried into execution

- Step 1: operator confirmation of the `@AC-5` third `Given` ("the post-deploy fundamentals backfill has re-derived the stored LYFT periods"). The round-6 sign-off predates it (C-15, C-11) — [ ] unaddressed
- Step 10: O-16, the operator's acceptance of the D/E and P/B blast radius, is not recorded. The integration PR must not open for merge without it — [ ] unaddressed
- Step 10: "max_connections are now love." is unexplained. If a `max_connections` value changed, re-check the `psql` sessions against the connection budget (F-06) before they run — [ ] unaddressed
- Step 4: two selection rules decided by the spec need the design owner's confirmation: debt instants in a bucket with no balance-sheet anchor are absent; a flow with no anchor is selected per unit at its latest `end` — [ ] unaddressed
- Step 5: the LYFT fixture needs a live fetch from `data.sec.gov`; blocked egress blocks the step (schedule risk; the file is not hand-written) — [ ] unaddressed
- Step 6: `TDD: N/A`, so the guards cannot show red before green (C-08, P-06). The mutation proof is hand-run and recorded only in context.md. Accepted trade-off; the executor must record the mutation result — [ ] unaddressed
- C-14: no `xstockstrat-ui` or `xstockstrat-agent` step and no follow-up feature is named. The surfaces are checked only post-deploy through the LYFT canary `query_fundamentals`. No follow-up was invented here — [ ] unaddressed
- Step 10: Verification is a grep on context.md; it proves the entries exist, not that the freeze or export state is correct. Accepted for an operator gate; the operator confirms the state — [ ] unaddressed

### Open Threads

- `@AC-5` third `Given`: ask the operator — target: Step 1 confirmation.
- O-16 blast-radius acceptance and the meaning of "max_connections are now love." — target: Step 10 item 1, before the freeze and before the integration PR opens for merge.
- Step 4 selection rules (no-anchor debt, no-anchor flow) — target: design owner, at the Steps 4+5 confirmation.
- `data.sec.gov` egress for the LYFT fixture — target: Step 5.
- C-14 consumer surfaces have no follow-up feature; decide whether one is needed — target: `/sdd-execute` checkpoint.

---

## Session 2026-11-15 — operator answers after impl-spec review (orchestrator)

Each asked directly as a numbered question and answered verbatim by the operator (2026-11-15):

- **O-16 (blast radius) — "Acknowledged".** Question: the fix changes stored EPS, revenue, trailing
  EPS and P/E for every EDGAR filer, and debt-to-equity and P/B shift with it; the integration PR
  must not open for merge without recorded acceptance — accept? The acceptance is recorded; the
  Step 10 gate on O-16 is met.
- **@AC-5 third Given — "Alright".** Question: confirm the added precondition "the post-deploy
  fundamentals backfill has re-derived the stored LYFT periods". Confirmed (Step 1).
- **@AC-2 CHANGE — "I approve 340, including the acceptance scenario."** (design gate, round 6): keep
  the Finnhub and FMP rows as unit guards, drop the EDGAR row, retitle the outline.
- **"max_connections are now love." — "I confirm it"**, in answer to: read as "now live", i.e. the
  homelab DB host runs `max_connections` = 70 with a PgBouncer pool of 10 per database
  (homelab-edge PR #79 applied). Step 10's psql sessions are budgeted against 70. Not verified by
  the orchestrator against the live host.
- **Recorded risks — "I acknowledge the risks".** The list put to the operator: the freeze can
  collide with 343 testing; rows are rewritten in place with no cheap rollback; the audit SQL is
  unrun until the Step 0 dry run; the LYFT fixture step needs `data.sec.gov` egress; the homelab
  `xstockstrat_production` database is not repaired.

## Session 2026-11-15 — /sdd-distill
- Distilled 12 sessions → header + Superseded Sessions; kept 2 verbatim.
- context.md 1829 → 442 lines. Original prose preserved in git history.
- **Operator sanction (2026-11-15), deviation from the skill's preserve-every-`sdd-batch-*`-block rule:** asked
  "How should I write them?" with the option "Keep only the last state block", the operator chose it. The 5
  superseded per-round `sdd-batch-design-state` block(s) are dropped; the last one is kept byte-for-byte (the only one
  any workflow reads, `.claude/workflows/sdd-batch.js:191`). Other `sdd-batch-*` blocks are untouched.
- The loss check was a self-check by the planning agent (no separate `context-distiller` verifier was available).

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation (the operator-approved record, binding, verbatim):

```json
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","dev":"3f96d071959081735ce2da665ba1c7f9c2601cb6","specHash":"79f2c0fc984b52e1eb157b563cdb987951befee8","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10],"mismatches":[{"n":1,"detail":"Minor line drift. The spec cites feature.md:36 for the '## Summary' sentence that contains 'suspected percent-vs-fraction unit error'. On the merged tree, line 35 is '## Summary', line 36 is blank and the sentence is at docs/roadmap/features/340-fix-fundamentals-roe-unit/feature.md:37. The content and the edit are unaffected. All other Step 1 anchors match: the acceptance.feature 0.0366 and 28070000/767000000 lines at 10/12, 18/24/25, 29/31 and 48/50, recon.md:136, the product-spec 'low single-digit' (:15) and 'Not traced' (:27) lines, FR-1 :43-45, OQ1 :76-79, Out of Scope :100-101, the defect report title and its ## Expected / ## Root cause hypothesis / ## Confidence sections, and debate D-11/D-12. All Files paths exist."},{"n":4,"detail":"Minor line drift. The spec cites 'earliest-filed wins per quarter end in trailingNetIncome (:425)'. The comparison `if cur, ok := quarters[f.end]; !ok || f.filed.Before(cur.filed)` is at services/xstockstrat-marketdata/internal/edgar/edgar_client.go:423-424, and :425 is the closing brace. The per-fiscal-year rule at :435 matches. Every other Step 4 anchor matches: FetchHistorical :290, periodKey :286/:340, the first-seen write :357-364, periodAgg :220-227 (vals comment :226, a single construction site at :343), flowTags :187-193, instantTags :195-210, niFact :387, toNIFact :393, valIn :230, valAny :241, voteCurrency :259, annualizeQuarterlyROE :475/:479, buildPeriod :526, const DerivationVersion = 1 at :524, service re-derive :2398-2407 and snapshot drop :2353-2361."}]}
```

- Merged main-dev `9f88562296464b43465d0376b40cefafe93f0743` cleanly. The merge-train resolver had nothing to resolve and ledger-guard reported clean.
- Re-spec commits (`respec(fix-fundamentals-roe-unit)` in `git log --first-parent origin/main-dev..HEAD`):
  - `5264c90ccbd40cb4eaec12d49e2de259f4238e60`: Step 1 evidence `feature.md:36` → `:37`; Step 4 evidence
    `trailingNetIncome` `:425` → `:423-424`. Line drift only, no instruction change.
- Tooling detection: go1.27.0 is present. golangci-lint 2.5.0 (built with go1.25.1) is present but not at the v2.14.0
  pin, so the Go steps install it with the pinned `GOTOOLCHAIN=go1.27.0 go install`. buf is absent on the host;
  Docker 29.9.2 is present for the codegen image (steps 7-8).
- status.md → `in-progress`; 10 steps pending.

```sdd-batch-setup
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","date":"2026-11-15"}
```
