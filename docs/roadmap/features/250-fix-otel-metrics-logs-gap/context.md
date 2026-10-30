# Context Log: fix-otel-metrics-logs-gap

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md` (Issues
  disabled). Source: `docs/context-constitution-findings.md` § Documentation that lies row 2;
  `packages/otel/docs/context-constitution-findings.md` § Open questions; `packages/otel/docs/context-constitution.md` OTEL-2.
- Severity: SEV-2. Impact type: silent-telemetry-loss. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services (from report): all 12 runtimes; packages/otel.
- Root cause hypothesis: feature 226 settled traces-only; alerts/dashboards/setup docs predate it and were never
  reconciled.
- Confirmation evidence (report, confidence high): repo-wide `rg` for meter/logger providers and metric exporters
  under `services/` → no matches; UI `src/telemetry.ts:31-32` passes empty `metricReaders`/`logRecordProcessors`;
  `alert-rules.yaml:44-45`, `:88` query `rpc_server_duration_milliseconds_*`; Grafana query for that metric → no series.
  Triage grep: 10 dashboard references to the same series across `packages/otel/dashboards/*.json`.
- **Prior decision to honour:** feature 226 (`docs/roadmap/features/226-fix-otel-trace-export/`, launched) recorded
  Operator Decision 3 — "Scope: traces only — metrics/logs pipelines are out of scope (new capability →
  `/sdd-story`)" (`product-spec.md:64`); its design kept the empty UI arrays deliberately so sdk-node 0.218 does not
  auto-start env-default metrics/logs pipelines (`design.md:22`) and kept the collector `:4317` receiver for the
  metrics/logs pipelines + telemetrygen (`design.md:24`, `:38`).
- **Two possible fixes (operator fork, decide at design):**
  - (a) Narrow the alert rules, dashboards and docs to traces (or document a Grafana-side span-metrics path that
    produces the RPC series from traces). Consistent with 226's decision; a bug fix — stays in this Track C feature.
  - (b) Add OTLP metric (RPC server histogram) and log export to the runtimes. New capability across 12 runtimes;
    reverses 226 Operator Decision 3 and needs `/sdd-story` per C-11 (operator sign-off recorded in a feature's
    `context.md`). If chosen, this feature should close as superseded by that story or narrow to the docs interim.
- acceptance.feature is written neutral between (a) and (b): the invariant is "no alert or dashboard depends on a
  series that nothing produces" plus docs-match-reality.
- Recommended design depth: full → `/sdd-design fix-otel-metrics-logs-gap` (rationale: SEV-2; affected services ≥ 2
  (12 runtimes + packages/otel); the (a)/(b) fork is a scope decision touching a prior operator decision).
- Development branch: feature/fix-otel-metrics-logs-gap

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 Floor breaches).
- Warnings (5) and the spec edits made this session:
  - C-10: FR-4 / AC-3 listed 4 of the doc instances → FR-4 now enumerates every grep hit outside `docs/roadmap/`
    and `docs/reports/` (`grafana-cloud.md:191-208`, `docs/setup/CLAUDE.md:10`, `launch-pdfs/product-features.md:192`,
    `dashboards/README.md:4,7-12,43-45`, `otel-collector-config.yaml:9`, `packages/otel/CLAUDE.md:4`, OTEL-1 `:16`,
    findings rows `docs/context-constitution-findings.md:18` + `packages/otel/docs/context-constitution-findings.md:13`);
    AC-3 Given widened to the FR-4 list plus any other doc under `docs/` or `packages/otel/` outside roadmap/reports.
  - Produced-set ambiguity: AC-1 "documented" span-metrics path → "verified to return series for the stack" (matches
    the FR preamble); FR preamble + AC-1 now state today's set holds no metric name and no log stream (traces only).
    `/sdd-design` names the exact span-metrics names if it adopts a verified path.
  - Affected Services vs Fix Scope: collector config kept, scoped to the `:9` header comment (FR-4); pipelines
    `:79-87` retained on purpose (226 `design.md:24`, `:38`); Fix Scope box annotated.
  - Operator coverage: Expected now states removal leaves error-rate, p99 and scoring-stall undetected; `/sdd-design`
    must record, per removed alert, its trace-based replacement or a named follow-up `/sdd-story` (trace-based
    alerting, or fix (b)). Open for design.
  - P-04/P-05 traceability: operator decision recorded below; feature.md Reviewers + Next Action reconciled to the
    narrowed scope.
- Notes (3): criteria summary (no blockers); code claims verified; spec hygiene → template line removed, Acceptance
  Criteria pointer now names the verification (mechanical produced-set check defined at `/sdd-spec` + Grafana import
  with no query on an unproduced series) and the Teardown trigger for touched CLAUDE.md/constitution/findings files.
- Overlap findings: WARN — `docs/patterns/observability.md` possibly also edited by 084-droplet-compose-deploy
  (`product-spec.md:156`, deferred to its design); rebase-only, no merge-order row. 084 also edits the
  `docker-compose.yml` otel-collector and `.do/` specs; no clash (this feature changes no config/deploy). No config-key,
  proto-field or migration collision. Coverage gap: remote branches feature/fix-etf-flag-fill,
  feature/fix-sandbox-memory-cap, feature/agent-grpc-migration, feature/agent-log-query have no feature dir; not scanned.
- Operator decisions (binding, recorded 2026-10-20), verbatim:
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Narrow to traces (bug fix, consistent with feature 226's traces-only decision): remove or rewrite alerts/dashboard panels that depend on metric/log series nothing produces (span-metrics from traces only if the Grafana stack is shown to generate them), and correct docs/setup/grafana-cloud.md, docs/patterns/observability.md and packages/otel docs. Adding metric/log export is out of scope.
- Supersedes the triage entry's "operator fork, decide at design": fix (a) chosen; fix (b) out of scope.
- Next: `/sdd-design fix-otel-metrics-logs-gap` (full).

## Session 2026-10-20 — sdd-review product-spec (re-review)

- Product spec re-approved. Status: spec-ready (unchanged; the `draft` → `spec-ready` transition was recorded by the
  prior review session). Criteria: PASS WITH WARNINGS (0 fails, 0 Floor breaches).
- Warnings (5) and resolution:
  - C-15: FR-4 list incomplete → FR-4 restated as a rule over every doc under `docs/`/`packages/otel/` (excl.
    roadmap/reports) naming signals, series or datasources, with known instances widened: `grafana-cloud.md:108`,
    `:226`, `:236-241`, `:258-261`, `:313-319`; `packages/otel/alerts/README.md:25-26`; `dashboards/README.md:16-26`,
    `:43-49`. AC-3 Given adds `alerts/README.md`; When/Then cover datasources. `packages/otel/CLAUDE.md:4` and
    `docs/setup/CLAUDE.md:10` were already listed.
  - Produced-set span-metrics clause → AC-1 admits span-metric names only with recorded evidence (design.md) that the
    path returns those series for the stack.
  - Test mechanism unstated → left open by design: the mechanical produced-set check (static lint of alert/dashboard
    queries against the produced set) is fixed at `/sdd-spec` and paired as a test step (C-08 / C-15).
  - Template residue "(Update after investigation ...)" → already absent on the branch (removed in the prior review
    session); no edit.
  - C-11 / P-04 sign-off → the branch `context.md` records the operator decision (prior session entry); the reviewer
    read the main working-tree copy. Re-recorded below.
- Notes (2): Affected Services lists non-registry paths only (consistent with no runtime change); C-14 consumer surface
  "None" justified.
- Overlap findings: PASS, no collisions.
- Operator decisions (binding, recorded 2026-10-20), verbatim:
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Narrow to traces (bug fix, consistent with feature 226's traces-only decision): remove or rewrite alerts/dashboard panels that depend on metric/log series nothing produces (span-metrics from traces only if the Grafana stack is shown to generate them), and correct docs/setup/grafana-cloud.md, docs/patterns/observability.md and packages/otel docs. Adding metric/log export is out of scope.
- Next: `/sdd-design fix-otel-metrics-logs-gap` (full).

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/otel + docs only, no `xstockstrat-*` runtime; key reuse
  patterns: 226 findings-row NARROW convention `recon.md:62`, Tempo check + TraceQL example as doc template
  `recon.md:60`).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: narrow to traces — alert rules removed via `deleteRules` /
  `deleteMuteTimes` (fallback `groups: []`), `mute-timings.yaml` deleted, `service-health.json` rewritten
  Tempo-only (uid kept), other dashboards deleted, FR-4 docs reworded to the sanctioned literal
  `Metrics and logs are not exported (feature 226).`, plus guard `scripts/check-otel-produced-signals.sh`
  (Parts 1-3 + removed-assets fence) with fixture-backed `.test.sh` in a dedicated `otel-signals` CI job, and a
  `trace-derived-alerting` `/sdd-story` (`idea`) landed on main-dev first. Rejected: fix (b) metric/log export
  (operator decision), span-metrics/TraceQL-metrics rewrite (unproven, `recon.md:94-100`), follow-up as a
  defect report, generic-token scan over all of `docs/`, line-number-pinned findings assertions.
- Round history: r1 blocked on C-15 (no red per AC) + AC-3 scope; r2 blocked on C-10 (dangling deleted-asset refs)
  + C-11 (follow-up filed as defect); r3 adversary verdict SOUND, non-blocking items folded into design.md §§3-7.
- Prior progress (user question "What happened to the prior progress?"): nothing lost — r1/r2/r3 syntheses were
  carried forward round to round from the session scratchpad; this entry and design.md make them durable.
- Constitution rules touched: C-10, C-11, C-13, C-14, C-15/P-06, C-16, C-18, P-02, F-04/P-03, F-11, PLAT-3,
  OTEL-1/OTEL-2, Teardown. Floor breaches: none.
- Business rules (C-16): PRESERVE `@AC-3 @feature-171`, `@AC-1/@AC-2 @feature-171`, `@AC-1/@AC-2/@AC-3/@AC-4
  @feature-226`; EXTEND `@AC-1..3 @feature-250` (operator decision "Narrow to traces"). No CHANGE.
- Approval: auto-approved under operator standing authorization (rounds 3 >= 2, no F-* breach, no blocking
  objection, no uncovered CHANGE). Operator decisions (binding, re-recorded 2026-10-21), verbatim:
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Narrow to traces (bug fix, consistent with feature 226's traces-only decision): remove or rewrite alerts/dashboard panels that depend on metric/log series nothing produces (span-metrics from traces only if the Grafana stack is shown to generate them), and correct docs/setup/grafana-cloud.md, docs/patterns/observability.md and packages/otel docs. Adding metric/log export is out of scope.
- Open Threads (from design.md Open Risks; target step set at /sdd-spec):
  - Guard heuristics (P3-count/P3-file) are vocabulary-bound; fixture red cases guard against relaxation —
    guard step.
  - Tempo `service-health.json` has no in-repo precedent and span-name regexes `.*/Method` are unverified —
    dashboard step, dev-import gate (fallback: delete JSON, keep README, retire OTEL-1).
  - No paging for error-rate / latency / analysis scoring until `trace-derived-alerting` lands — follow-up step
    (first in order; land on main-dev before 250 cites it).
  - Grafana Cloud keeps already-imported rules, mute timing and dashboards until deleted by hand;
    `deleteRules`/`deleteMuteTimes` key names unverified (Context7 + throwaway `grafana/grafana`) — alerts step.
  - `/sdd-archiver` will prune the defect report; basename exemption and findings assertions must not depend on
    the file existing — guard/test step.
  - `.feature` files stay outside the guard glob (250 ACs promoted to `platform.feature` contain "Loki") — guard
    step.
  - Read ACs from `origin/feature/fix-otel-metrics-logs-gap`; local main-dev `acceptance.feature` is stale —
    /sdd-spec.
  - Rebase-only overlap with 084 on `docs/patterns/observability.md` — docs step / integration.
- Status: spec-ready → design-approved.
- Next: `/sdd-spec fix-otel-metrics-logs-gap`.

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status: design-approved → implementation-ready.
- Order follows design.md §8. Step 1 lands the follow-up `/sdd-story trace-derived-alerting` (`idea`) on main-dev,
  then main-dev is merged into the 250 branch. Steps 2-8 make the asset/doc/constitution edits (config/docs, TDD
  N/A, each self-checked with the guard regexes). Step 9 is Teardown. Steps 10-11 are the red-before-green pair
  (`.test.sh` + fixtures, then the guard). Step 12 adds the `otel-signals` CI job last, because `ci.yml:3-4` runs
  CI on every PR, step PRs included.
- Key codebase findings:
  - The pre-fix reference commit for the verbatim fixtures is `06faaeb5` (branch head at spec time).
  - The Grafana provisioning keys `deleteRules` (`- orgId` / `uid`) and `deleteMuteTimes` (`- orgId` / `name`)
    were confirmed with Context7 (`/websites/grafana_grafana`, file-provisioning docs). A live
    `grafana/grafana` check stays optional (Step 2); the `groups: []` fallback is kept.
  - The Tempo panel `targets` JSON keys are **Not found** in the repo. They are proven only at the Step 4
    dev-import gate. If the dev stack is unreachable, the step blocks for the operator (P-03).
  - The `(Watch|Stream|Export)[A-Za-z]*` exclusion matches every server-streaming RPC (8 proto lines, Step 4
    evidence) and no unary RPC.
  - Case rule refinement (design is silent): `service_name[[:space:]]*=`, `DS_*`, `rpc_server_duration` and
    `P99` match case-sensitively, so `docs/setup/grafana-cloud.md:116` `SERVICE_NAME=<service>` stays green.
    Step 10 adds that green case.
  - 253 is now taken on main-dev (`253-fix-edgar-companyfacts-decode`), so the design's "253 today" is stale.
    The follow-up NNN is max+1 at creation (≥ 254). Steps 3, 6 and 8 cite the resolved dir.
  - The shell-lint job (`ci.yml:609-629`) already lints `scripts/*.sh`. The new scripts get shellcheck/shfmt
    for free, and the test is NOT appended to `:629`.
  - `docs/launch-pdfs/product-features.pdf` has no in-repo generator. It is not regenerated; note it in the PR body.
- Prior progress (user question "What happened to the prior progress?"): nothing was lost. Triage, both product-spec
  reviews, recon and the 3-round design are on `origin/feature/fix-otel-metrics-logs-gap` (head `06faaeb5`). This
  session added the implementation spec on top of them.
- Next: `/sdd-review fix-otel-metrics-logs-gap impl-spec`, then `/sdd-execute fix-otel-metrics-logs-gap`.

## Session 2026-10-21 — sdd-review impl-spec (advisory)

- Result: criteria FAIL (1 fail, 1 Floor breach F-03, 14 warnings); overlap WARN (4 soft file overlaps). Advisory;
  lifecycle unchanged (`implementation-ready`). Every claim re-verified before editing implementation-spec.md.
- Addressed (implementation-spec.md edits):
  - F-03 Floor (old Step 1 Instruction 2 opened a main-dev PR from inside the spec): the follow-up story is now
    **Prerequisite P-1**, outside `/sdd-execute`, with its own docs-only PR (F-02). Step 1 is a verification-only
    marker (no Files; it records `<NNN>` here and blocks for the operator if P-1 has not landed). BRANCH SYNC
    (`.claude/skills/sdd-execute/templates/branch-sync.md:35`) brings the dir onto the 250 branch. Total steps stay
    12; no renumbering.
  - Step 1 Files placeholder: P-1 lists the five `/sdd-story` files under a stated `<NNN>` rule. Re-verified
    `253-fix-edgar-companyfacts-decode` is the highest prefix on `origin/main-dev`, so `<NNN>` ≥ 254.
  - Step 10: the N/A coverage line is added. RED now has two runs: guard absent, plus a never-staged `exit 0` stub
    that makes every red case fail on its own. `case_fail()` collects failures, so each case runs; `fail()` in
    `check-migration-contract.test.sh:8-11` exits at the first failure.
  - Step 7: the collector comment-only check is replaced by
    `git diff -U0 … | grep -E '^[-+]' | grep -v -E '^(---|\+\+\+) ' | grep -v -E '^[-+][[:space:]]*(#|$)'`,
    tested against sample diffs. The old regex matched indented comment edits. The fix still catches `- otlp` list
    items, which the reviewer's suggested regex would have missed.
  - Runtime git: the fixtures, including root findings `:18`, are extracted once and committed. The `.test.sh`
    never calls `git`, and a grep check is added. The Step 12 `fetch-depth: 0` hedge is removed (squash-merge makes
    `06faaeb5` unreachable on main-dev).
  - Step 11: every tag is reported per line. Step 10 adds multi-tag cases. Corrected the reviewer's example:
    `grafana-cloud.md:258` carries `P99` plus the xstk UIDs; `mute-timings.yaml` is on `:259`.
  - Dashboard-fallback wording is added to Step 6 item 2 (`grafana-cloud.md:5`) and Step 7 item 2
    (`docs/setup/CLAUDE.md:10`).
  - Step 9: a refresh hit outside Files is escalated through the gap protocol plus a Deviation Log entry, never
    staged (F-08). Each Files path gets a recorded `Teardown` line, and the Verification checks for it.
  - `docs/launch-pdfs/product-features.md:198` (dashboards that no longer exist): in scope, added to Step 7, with
    deletion on the fallback. `:312` is out of scope: it is a historical description of what feature 033 delivered.
  - `docs/patterns/ci-overview.md`: one `otel-signals` row added to Step 12. The other omitted jobs are not
    backfilled.
  - Scope vs product-spec (C-11/P-03): `product-spec.md:113-114` names only the collector `:9` comment. Step 7 also
    edits the `:35`/`:49` comments and the `scripts/setup-env.sh:213` string, under FR-4 "any other doc" and
    design.md §3 (`design.md:81`, `:83`). These are comment/string edits only: still no pipeline, receiver or env
    change. Recorded in Step 7 Codebase Evidence. product-spec.md is not edited.
  - Step 8: the wording rule is restated as Instruction 7, with a grep check for removed-asset names.
  - Overlap (226): a Step Dependencies line records 226's prior edits to the collector header and the docs
    (226 `context.md:150`, `implementation-spec.md:570`) and the preserved attribute bullet (226 `design.md:76`).
    084 was already recorded as rebase-only.
- Open Threads (not addressed, carried to the `/sdd-execute` checkpoint):
  - [ ] Step 7 still touches 6 files (reviewer: consider splitting, >5). Not split: a split would renumber
    Steps 8-12 and every cross-reference to them, for comment/one-line edits that share one verification loop.
    Operator call.
  - [ ] C-18: guard heuristics (P3-count number words, P3-file resolution, the 3-separator fence grammar, ~20
    cases) are vocabulary-bound. The reviewer requires no change; this is the first place to trim if the guard grows.
  - [ ] P-1 has to be run by the operator (its own `/sdd-story` session and main-dev PR) before `/sdd-execute`
    Step 1 can pass.
- Notes: B2b trading-domain is N/A (only incidental words). C-14 consumer surface is none. No outbound gRPC.
- Overlap findings: `084-droplet-compose-deploy` on `docs/patterns/observability.md` (rebase-only);
  `226-fix-otel-trace-export` (launched) on the collector header, `observability.md`, `grafana-cloud.md`,
  `packages/otel/CLAUDE.md:4`, the otel constitution, root findings `:17`/`:18` and the dashboards README attribute
  bullet (rebase-only; the bullet is preserved by Step 5). No config-key, proto-field or migration collision.

## Session 2026-10-23 — P-0 amendment (feature 274 prerequisite)

- Applied before any step started: F-09 re-check passed (`status.md` = `implementation-ready`; all 13
  `implementation-spec.md` steps `**Status**: pending`).
- Branch synced with `origin/main-dev` (it carried no unique content; conflicts in `ci.yml`/`CLAUDE.md` took
  main-dev, ledger files kept both sides).
- **P-1 retired**: no `trace-derived-alerting` `/sdd-story`. Follow-up is feature
  `274-otel-metrics-logs-export`. Every citation literal and the Step 10/11 4-site regex now use
  `docs/roadmap/features/274-otel-metrics-logs-export/`. Step 1 kept (number unchanged, so no renumbering) as a
  verification marker that the 274 dir is on the branch.
- **Guard Part 2 annotated** "implement now; retire in 274 PR-B" in `design.md` and `implementation-spec.md`
  Step 11. 250 still implements it.
- **C-16 CHANGE sign-off mirrored** from 274 `context.md` (R1 gate, 2026-10-21, operator): approves 274
  retiring 250's guard Part 2 ("docs list only exported signals"). Verbatim operator answer there: "Amend 250
  before it runs".
- `design.md` §6 carries a dated amendment block; its original text is unchanged below it.
- `merge-order.md` row for 250 → 274 updated on the same branch (250 → 274 PR-B hard on file overlap; PR-A follows
  250 by operator order).
- Open Threads: `/sdd-review fix-otel-metrics-logs-gap impl-spec` re-run required (recorded below once run).
- `/sdd-review impl-spec` re-run (spec-reviewer, 2026-10-23): FAIL on one blocker, fixed in the same P-0 change. The
  literal `274-otel-metrics-logs-export` contains `metrics-logs`, which the guard's generic Part 2 token
  `metrics.{0,12}logs` matches, so the cites required by Steps 3/6/8 would fail the guard's own green case. Fix: the
  guard strips the case-exact 274 path alongside the sanctioned literal (Step 11 item 4); Step 3/6/7 verification
  greps `sed`-strip it first; Step 10 gains a follow-up-path case (exact green; recased and trailing-prose red).
  Warnings fixed: stale `## Prerequisite` heading renamed; design.md `:38` and §8 step 1 annotated; 274's number is
  immutable so Step 10's dir-exists dependency is durable. Re-run of the review after the fix is the gate to push.
- Second re-review (same day): the OTEL-2 retired marker in `packages/otel/docs/context-constitution.md` (Step 8
  item 2) was specced to cite the defect basename, whose `metrics-logs` trips the generic token outside the two
  exempt findings files. Pre-existing in 250's spec, not caused by P-0. Fixed: marker cites feature 250 only. Step 3
  item 4 gains a wording caution for the cite line.
- Third re-review (spec-reviewer, 2026-10-23): PASS, 0 blockers, 0 warnings. Non-blocking notes carried to
  `/sdd-execute`: Step 3 and Step 8 verification lack the sed-stripped generic-token grep (Step 11 is the backstop).
  P-0 is complete: 250 may now execute; 274 `/sdd-spec` follows 250's merge.

## Session 2026-10-30 — sdd-execute (sequential)

- Branch layout (operator-approved): all commits on session branch `ccr-4f43fb65-lagupv` (= `origin/main-dev` at
  start), one commit per step, one integration PR into `main-dev`. Logged as Deviation 1. The 250 artifacts on
  `origin/feature/fix-otel-metrics-logs-gap` were byte-identical to main-dev, so nothing was lost.
- Read-only re-validation of all 12 steps' Codebase Evidence: LINE-DRIFT ONLY, no content mismatch, no re-spec.
  Drift: `ci.yml` cites in Steps 7/11/12 are re-anchored by job/symbol name at execution (filter block, `context-map`
  job now with two `run:` steps, `ci-gate` needs/echo list, `shell-lint`, `markdown-lint`). Step 8: root findings
  `:18` resolution cell already reads "Narrowed to traces by feature 250 ... filed as feature 274" (changed by 274
  after `06faaeb5`); the step still applies on top of it.
- Operator context: the observability review of 2026-10-30 found the staging stack exports traces only; operator
  chose to keep 274 as approved (SDK RPC histogram + log bridge) and not pursue Grafana-side span-metrics.
- Tooling setup (steps 1-12): docs/config/test/script/CI steps only. git ✓, bash ✓, grep ✓, python3 ✓. Nothing installed.

### Step 1 — Verify the 274 follow-up dir is on the 250 branch [done]
- `docs/roadmap/features/274-otel-metrics-logs-export` is on `origin/main-dev` and in this tree; `status.md` present
  (`design-approved`). Verification-only; no source files changed.
- Files modified: none (spec/feature/status/context bookkeeping only)
- Deviations: Deviation 1 (branch layout)

### Step 2 — Replace every alert rule with deleteRules/deleteMuteTimes; delete mute-timings.yaml [done]
- `alert-rules.yaml` rewritten to a 2-line constraint comment + `apiVersion: 1` + `deleteRules` (the three xstk UIDs)
  + `deleteMuteTimes` (`outside-us-market-hours`), no `groups`. `mute-timings.yaml` removed (orphaned, C-10).
- Live-boot check skipped (spec marks it optional): the `deleteRules`/`deleteMuteTimes` key names rest on the
  Context7 Grafana file-provisioning docs evidence recorded at spec time, which is **not a live-boot proof**
  (fails.md:682-684). The `groups: []` fallback is kept if a real Grafana import rejects them.
- Files modified: `packages/otel/alerts/alert-rules.yaml`, `packages/otel/alerts/mute-timings.yaml` (deleted)
- Deviations: none

### Step 3 — Rewrite packages/otel/alerts/README.md [done]
- README now states `alert-rules.yaml` provisions no rules, carries the sanctioned literal on its own line, cites
  `docs/roadmap/features/274-otel-metrics-logs-export/`, lists removed assets only inside the
  `otel-guard:removed-assets` fence, and keeps `## Notification routing` byte-identical.
- Files modified: `packages/otel/alerts/README.md`
- Deviations: none

### Step 4 — Rewrite service-health.json as Tempo-only; delete the other three dashboards [done]
- `service-health.json` rewritten (uid `xstk-service-health` kept): one `DS_TEMPO` input/var and three TraceQL table
  panels (server error spans; slow server spans (>2s); analysis scoring RPC activity). `signal-pipeline-throughput.json`,
  `infrastructure.json`, `trading-service.json` removed.
- **Dev-import gate PASSED** against the staging/dev Grafana Cloud stack (operator approved the live write):
  - Import via Grafana MCP `update_dashboard`: success, version 1, uid `xstk-service-health`; read-back via
    `get_dashboard_by_uid` shows 3 panels + the `DS_TEMPO` datasource var intact.
  - Each panel's exact TraceQL ran against Tempo (`search_tempo_traces`, 24h) with no parse error. (a) returned rows
    (`marketdata GetBars`, `identity RefreshToken`, `xstockstrat-ui POST /insights/api/[...connect]/route`);
    (b) returned rows (`marketdata GetBars` 2-15s, `ledger LedgerService/QueryEvents` 2.5-30s, agent
    `subscriptions/listen`), and the `Watch|Stream|Export` exclusion held (no WatchConfig rows); (c) parsed and was
    empty (no `run_backtest` in 24h; the gate only requires (a) or (b) to return rows).
  - Not proven: rendering in the Grafana UI (no browser session). The Tempo target keys (`queryType: traceql`,
    `tableType: spans`, `limit`) were accepted by the save; the stored dashboard was upgraded to schemaVersion 42 by
    Grafana, the repo file stays at 39.
  - Span-name forms seen: gRPC names are `xstockstrat.<svc>.v1.<Svc>/<Method>` (Go) or `grpc.xstockstrat...` (Node),
    so `.*/Method` matches. The analysis server-side RunBacktest span name was not observed (no calls).
- **Open Item (kept as specced, operator decision)**: panel (b) also matches the agent's long-lived MCP span
  `subscriptions/listen` (150-295s), since the exclusion only covers gRPC Watch/Stream/Export names. Noted in the
  panel description; revisit in feature 274's dashboard restoration.
- Side effect for the operator: the dashboard now exists in the xstockstrat Grafana Cloud stack (created by the gate).
- Files modified: `packages/otel/dashboards/service-health.json`, and deleted `signal-pipeline-throughput.json`,
  `infrastructure.json`, `trading-service.json`
- Deviations: none

### Step 5 — Rewrite packages/otel/dashboards/README.md [done]
- README describes the single Tempo dashboard (`DS_TEMPO` input, three TraceQL panels), carries the sanctioned
  literal on its own line, keeps the attribute bullet (`service.name`, `deployment.environment`, `platform`) in
  Tempo resource-attribute wording with no `trading_mode` (`@AC-3 @feature-171` preserved), and fences the deleted
  dashboard UIDs/files for manual deletion. Notes that panel (b) still shows non-gRPC long-lived spans.
- Files modified: `packages/otel/dashboards/README.md`
- Deviations: none

### Step 6 — Correct docs/setup/grafana-cloud.md [done]
- Traces-only wording (scoped by `OTEL_ENABLED=true`), sanctioned literal on its own line, signal list reduced to
  Traces, Loki/Prometheus verification and the derived-fields troubleshooting removed, Step 6 now describes the single
  Tempo dashboard (`DS_TEMPO`), Step 7 states no rules are provisioned and cites
  `docs/roadmap/features/274-otel-metrics-logs-export/`, both cleanup lists are fenced, TraceQL example is
  `{ name =~ ".*/PlaceOrder" }`, Step 8 uses `resource.service.name` in Tempo.
- Observation (out of scope, not edited): Step 4b still says the app specs ship `OTEL_ENABLED: "false"`; `.do/app.dev.yaml`
  is `"true"` and only `.do/app.yaml` is `"false"`. It is an env-config statement, not a signal claim (FR-4).
- Files modified: `docs/setup/grafana-cloud.md`
- Deviations: none

### Step 7 — Correct the remaining FR-4 one-liners [done]
- `docs/patterns/observability.md:3`, `docs/setup/CLAUDE.md:10`, `docs/launch-pdfs/product-features.md:192,198`,
  `packages/otel/CLAUDE.md:4,7-8`, collector comments `:9`/`:35`/`:49` (comments only; `git diff -U0 06faaeb5` shows
  no non-comment change), and `scripts/setup-env.sh:213` (string only) now state traces-only. The sanctioned literal
  is on its own line in `observability.md`, `product-features.md` and the collector header. `product-features.pdf` is
  a rendered copy with no in-repo generator and is NOT regenerated (note for the PR body).
- Tooling: shellcheck/shfmt unavailable -> `uvx` PyPI equivalents (Deviation 2).
- Files modified: `docs/patterns/observability.md`, `docs/setup/CLAUDE.md`, `docs/launch-pdfs/product-features.md`,
  `packages/otel/CLAUDE.md`, `packages/otel/otel-collector-config.yaml`, `scripts/setup-env.sh`
- Deviations: Deviation 2 (lint tooling fallback)

### Step 8 — Re-ground OTEL-1, retire OTEL-2, NARROW the findings rows [done]
- `packages/otel/docs/context-constitution.md`: OTEL-1 re-grounded on `resource.service.name` with panel (c) as
  evidence; OTEL-2 replaced by a retired marker citing feature 250 only (no `rpc_server_duration`, no defect
  basename); pointer row repointed to the two READMEs; intro line reworded.
- `packages/otel/docs/context-constitution-findings.md`: "Latent bug?" row NARROWED by content (basename + 274 path),
  Resolved row carries the basename, and the defect-report table row moved to `## Resolved` per that file's lifecycle
  rule. Root `docs/context-constitution-findings.md` row `:18` marked **NARROWED (feature 250)** with the basename and the
  274 path (274's session had already begun narrowing it).
- Files modified: `packages/otel/docs/context-constitution.md`, `packages/otel/docs/context-constitution-findings.md`,
  `docs/context-constitution-findings.md`
- Deviations: none

### Step 9 — Teardown: context-constitution refresh over the touched context files [done]
- Teardown: `/context-forge:context-constitution refresh` is **plugin unavailable** in this session (the skill list carries
  `context-forge:context-scrubber` only), so the equivalent was done by hand: every file below was re-read against the
  post-Step-8 tree (`alert-rules.yaml`, `service-health.json`, both READMEs, `grafana-cloud.md`, the collector config).
  This must also be stated in the PR body (plugin unavailable + the reconciliations below).
- packages/otel/CLAUDE.md: none needed (pointer block and description were corrected in Step 7 and match the tree)
- docs/setup/CLAUDE.md: none needed (`grafana-cloud.md` row corrected in Step 7; the row matches the rewritten doc)
- packages/otel/docs/context-constitution.md: reconciled (refresh stamp added; collector line hints re-stamped +1 after the
  Step 7 comment edit: `otlphttp/grafana` ~L49-63, no-collector note ~L18-19)
- packages/otel/docs/context-constitution-findings.md: reconciled (refresh stamp added; collector hints re-stamped +1:
  headers comment ~L14-16, exporter header line ~L56, `memory_limiter` ~L37-46)
- docs/context-constitution-findings.md: none needed (row narrowed in Step 8; no other row concerns the touched assets)
- Not touched, by design: root `docs/context-constitution.md` and other modules' constitutions (no drift found
  against the files edited here). `.agents/context-forge.json` `scrubberExtraTargets` (`README.md`,
  `docs/patterns/ui-ux-governance.md`) untouched.
- markdownlint-cli2 (npx, repo `.markdownlint.yaml`) on `packages/otel/CLAUDE.md` and `docs/setup/CLAUDE.md`: 0 issues.
- Files modified: `packages/otel/docs/context-constitution.md`, `packages/otel/docs/context-constitution-findings.md`
- Deviations: none

### Step 10 — scripts/check-otel-produced-signals.test.sh with verbatim pre-fix fixtures (RED) [done]
- Fixtures (committed once, extracted from `06faaeb5`; the test never calls `git`): `alert-rules.prefix.yaml`,
  `service-health.prefix.json`, and `fr4.prefix.tsv` (39 rows: pre-fix lines for the Step 3/5/6/7/8 cites, each asserted at
  authoring time to match the token regex of its tag). Test cases: green fixed tree; AC-1 red; AC-2 red; one AC-3 red per
  TSV row; multi-tag lines; strip (exact green / recased red); follow-up path (exact green / recased and trailing-prose
  red); fence (pass / unfenced / prose / unclosed / still-existing file / ASCII separator); comment-only existence;
  removal-prose count; dashboard-fallback tree (fenced green / unfenced red); C-16 attribute set; four-way follow-up
  citation + dir exists; defect-report independence; `.feature` exclusion.
- **RED (i)** guard absent: `ASSERT FAIL: scripts/check-otel-produced-signals.sh missing`, rc=1.
- **RED (ii)** throwaway stub guard (`exit 0`, never staged, deleted): `cases=66 failed=53` = AC-1 red 1, AC-2 red 1, AC-3
  per-cite 39, other red cases 12; none of the green/static cases fail.
- Lint: shellcheck + shfmt via `uvx` PyPI wheels (Deviation 2 applies); `grep` confirms no runtime `git` in the test and
  the only script referencing `otel-produced-signals` is the test (C-13: single-consumer fixtures, no inventory entry).
- Test-authoring correction: a first draft asserted `platform.feature` already mentions Loki; it does not until the
  @AC scenarios are promoted at integration, so the redundant precondition was removed (the `.feature` exclusion case
  appends its own Loki line).
- Files modified: `scripts/check-otel-produced-signals.test.sh`, `scripts/testdata/otel-produced-signals/{alert-rules.prefix.yaml,service-health.prefix.json,fr4.prefix.tsv}`
- Deviations: none (lint tooling per Deviation 2)

### Step 11 — scripts/check-otel-produced-signals.sh, the produced-set guard (GREEN) [done]
- Guard implements design.md §4: Part 1 (alerts/dashboards), Part 2 (SPECIFIC over SCOPE, GENERIC over GEN_SCOPE, case-exact
  strip of the sanctioned literal and the 274 path, findings-row exemption keyed on the defect basename), Part 3 (value-line
  existence set, P3-name/file/count, removed-assets fence grammar with nested/unclosed/still-existing checks). Parts 1-2
  use `grep -E`; Part 3 uses one awk pass per file; existence sets are newline-delimited strings checked with `case` (no
  per-token spawns). bash 3.2 compatible constructs only. Runs in about 1.3s on the real tree.
- **GREEN**: `bash scripts/check-otel-produced-signals.sh` rc=0 on the real tree; `bash scripts/check-otel-produced-signals.test.sh`
  `cases=66 failed=0` (about 50s, dominated by per-case tree copies); shellcheck + shfmt clean (uvx wheels, Deviation 2);
  `bash -n` ok. `/bin/bash` 3.2 (macOS) not available here: bash 3.2 compatibility is by construction, not run.
- Deviation 3: the guard's first real-tree run caught a wording slip of mine in Step 9's stamp; fixed (operator decision).
- Files modified: `scripts/check-otel-produced-signals.sh` (and, per Deviation 3,
  `packages/otel/docs/context-constitution-findings.md`)
- Deviations: Deviation 3
