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
