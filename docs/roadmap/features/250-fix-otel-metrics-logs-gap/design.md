# Design: fix-otel-metrics-logs-gap

**Created**: 2026-10-21
**Rounds**: 3 (full; termination: approved, auto-approved under operator standing authorization 2026-10-21)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-21 (operator decisions, context.md
sessions 2026-10-20 and 2026-10-21)
**Grounded in**: recon.md

---

## Chosen Approach

Narrow to traces, per the binding operator decision (context.md 2026-10-20 review entries). No runtime, proto,
config, migration or collector-pipeline change (recon.md:36, recon.md:65, recon.md:86-90). ACs are read from
`origin/feature/fix-otel-metrics-logs-gap`; the local main-dev `acceptance.feature` is stale.

**Consumer surface (C-14).** Internal-only. The consumers are operator-facing Grafana assets in
`packages/otel/` and the setup/pattern docs (recon.md:64). No UI segment or agent tool changes.

### 1. Alerts: remove every rule, rewrite none

- Basis: all three rules query unproduced series: `rpc_server_duration_milliseconds_*` and the Loki selector
  `{service_name="analysis"}` (recon.md:17-19). No span-metrics path exists in the repo (recon.md:94-97), so the
  default is removal (recon.md:97, recon.md:124).
- `packages/otel/alerts/alert-rules.yaml` keeps `apiVersion: 1` and contains:
  - `deleteRules` for `xstk-error-rate-high`, `xstk-p99-latency-high`, `xstk-analysis-no-scoring`;
  - `deleteMuteTimes` for `outside-us-market-hours`;
  - a 2-line constraint comment with no Part 1 token, e.g. "no rule may target a metric or log datasource until
    a produced path is recorded".
  - The key names are verified at execute (see Open Risks). If they fail, fall back to `groups: []`.
- Delete `packages/otel/alerts/mute-timings.yaml`. Its only consumer is `xstk-analysis-no-scoring`
  (recon.md:21, recon.md:61; C-10).
- Rewrite `packages/otel/alerts/README.md` (recon.md:33) to say:
  - no rules are provisioned, and why (226 OD-3 + 250);
  - the manual Grafana Cloud delete steps, with the removed UIDs in a fenced list (§5);
  - the follow-up `/sdd-story` dir, cited by path (§6).
- Coverage loss is made explicit, as recon.md:102-105 requires. Error-rate, p99 and scoring-stall stay undetected
  until the follow-up lands. For every removed rule, the named follow-up is `trace-derived-alerting` (§6).

### 2. Dashboards: rewrite one as Tempo-only, delete the rest

- Basis: 9 PromQL panel exprs, 9 LogQL exprs and 1 PromQL variable, all on unproduced series (recon.md:22-31).
  No Tempo/TraceQL query exists in `packages/otel/` yet (recon.md:98).
- Rewrite `packages/otel/dashboards/service-health.json` in place and keep uid `xstk-service-health`
  (recon.md:26), so a re-import overwrites it.
  - Datasources: a single DS_TEMPO `__input` plus a datasource var. Remove the DS_PROMETHEUS/DS_LOKI inputs
    (recon.md:31), the `$service` variable (recon.md:26) and the Loki panel.
  - Three TraceQL table panels using intrinsics + `resource.service.name`:
    - (a) `{ kind = server && status = error }`;
    - (b) `{ kind = server && duration > 2s && name !~ ".*/(Watch|Stream|Export)[A-Za-z]*" }`, titled
      "slow server spans (>2s)" and never "P99". The exclusion matches the server-streaming RPCs exactly;
    - (c) `{ resource.service.name = "analysis" && kind = server && name =~ ".*/(RunBacktest|ScoreStrategy)" }`,
      titled "analysis scoring RPC activity". It is not a stall signal: both RPCs are client-invoked.
- Delete `signal-pipeline-throughput.json`, `infrastructure.json` and `trading-service.json` (recon.md:27-29,
  recon.md:130).
- Rewrite `packages/otel/dashboards/README.md` down to the single Tempo dashboard (recon.md:33):
  - the deleted UIDs go in a fenced list (§5);
  - keep the attribute bullet `:40-42`: `service.name`, `deployment.environment`, `platform`, and no
    `trading_mode` (recon.md:69, C-16). Reword it from the "service_name label" phrasing to Tempo
    resource-attribute wording.
- Execute gate: import into the `OTEL_ENABLED=true` dev stack (recon.md:37).
  - **Fallback** if the gate fails: delete `service-health.json`, KEEP `dashboards/README.md` with its attribute
    bullet, and retire OTEL-1.

### 3. Docs

- One sanctioned literal, on one line, exactly: `Metrics and logs are not exported (feature 226).`. Signal
  claims are scoped by `OTEL_ENABLED=true`, never by environment name, because prod sets `"false"`
  (recon.md:37, recon.md:107-109; fails.md:1562).
- `docs/setup/grafana-cloud.md` (FR-4 line set, recon.md:40-50):
  - drop the Loki/Mimir verify steps, the ad-hoc Loki query and the Loki derived fields (recon.md:44,
    recon.md:48, recon.md:50);
  - fix `:3`, `:21-24`, `:108`, the dashboard table and the alert table (recon.md:41-49);
  - the Step 6/7 cleanup uses fenced lists (§5);
  - keep the Tempo check and the TraceQL example as the template (recon.md:51, recon.md:60). Rewrite the
    example's span name as `{ name =~ ".*/PlaceOrder" }`, checked at the dev import.
- Also fix:
  - `docs/patterns/observability.md:3`, `docs/setup/CLAUDE.md:10` and
    `docs/launch-pdfs/product-features.md:192` (recon.md:52-54);
  - `packages/otel/CLAUDE.md:4`, dropping the metric-name contract (recon.md:33, recon.md:78).
- Collector comments `otel-collector-config.yaml:9`, `:35` and `:49` are reworded to the sanctioned literal.
  Comments only: the metrics and logs pipelines stay (recon.md:32, recon.md:74, recon.md:136).
- Out-of-AC-scope line with the same defect, fixed in one line: `scripts/setup-env.sh:213` becomes "(traces)".
  `docker-compose.yml:50` stays as is, because the collector really has 3 pipelines.
- Constitution (`packages/otel/docs/context-constitution.md`, recon.md:34, recon.md:106):
  - OTEL-1 is re-grounded on `resource.service.name`, with a new Why and new evidence (panel (c)). It is retired
    on the dashboard fallback.
  - OTEL-2 is retired.
  - Repoint the `:29` mute-timings reference.
- Findings, using the NARROW convention (recon.md:35, recon.md:55, recon.md:62):
  - root `docs/context-constitution-findings.md:18` and otel findings `:13` and `:17` are narrowed by content,
    each citing the defect basename `otel-metrics-logs-never-exported-defect`;
  - otel findings `:28` is removed or moved to Resolved, as that file's own lifecycle rule at `:23` requires.
- **Wording rule (binding on every prose edit in this feature):** a removed count is never stated in prose (for
  example "the three alert rules"). The fenced list carries the names. Every non-otel file reference is
  path-qualified.

### 4. Guard: `scripts/check-otel-produced-signals.sh [ROOT]`

This is the mechanical produced-set check that recon.md:101 and recon.md:141-142 call for. It has no prior home
in the repo.

- Portability: bash 3.2, `grep -E` only, and `shopt -s nullglob` (or `[ -e ]` guards) on every glob. Each hit
  prints `AC-n <tag> path:line: text` to stderr, and the script exits 1.
- **Part 1 (AC-1/AC-2):** `prometheus|mimir|loki|promql|logql|rpc_server_duration|service_name[[:space:]]*=` over
  `alerts/*.yaml` and `dashboards/*.json`.
- **Part 2 (AC-3):**
  - SCOPE = `*.md`/`*.yaml`/`*.yml` under `docs/` and `packages/otel/`, minus `docs/roadmap/`, `docs/reports/`
    and the Part 1 files.
  - GEN_SCOPE = (the 9 AC-3 Given files ∪ `packages/otel/**`) ∩ SCOPE.
  - SPECIFIC tokens over all of SCOPE:
    `loki|mimir|prometheus|promql|logql|DS_LOKI|DS_PROMETHEUS|rpc_server_duration|all three signal|service_name[[:space:]]*=`.
  - GENERIC tokens over GEN_SCOPE only (fails.md:2165):
    `metrics.{0,12}logs|logs.{0,12}metrics|(traces|spans)[^.]{0,15}metrics|\*\*(metrics|logs)\*\*|log error|error logs`
    and case-sensitive `P99`.
- **Part 3 (asset existence, C-10):**
  - Existence set, from value lines only:
    - `alert-rules.yaml`: `^[[:space:]]*- uid:` and `^[[:space:]]*name:` lines inside non-`delete*` top-level
      sections. An awk filter tracks the top-level key `k`; lines where `k` is empty, such as comments before
      the first key, are excluded;
    - top-level `"uid":` values in `dashboards/*.json`;
    - `find packages/otel -type f` paths.
    - A comment can never make a deleted UID count as existing.
  - P3-name, over SCOPE: `xstk-[a-z0-9]+(-[a-z0-9]+)*|outside-us-market-hours` must be in the existence set.
  - P3-file, over GEN_SCOPE: path-form and bare `*.json`/`*.yaml` tokens. Resolve each token in this order:
    1. strip a leading `packages/otel/`;
    2. try `$ROOT/<tok>`;
    3. try `$ROOT/packages/otel/<tok>`;
    4. bare names go through `find`.
  - P3-count, over GEN_SCOPE: a number word or digit, optional `V1`, then `dashboards?` or `alert rules?`. It is
    compared with the real counts: dashboards = number of JSON files (1, or 0 on the fallback); rules = number of
    `- uid:` value lines in non-delete sections (0).
- **Fence:** `<!-- otel-guard:removed-assets -->` … `<!-- /otel-guard:removed-assets -->`. Used in
  `alerts/README.md`, `dashboards/README.md` and `grafana-cloud.md` Step 6/7.
  - Fenced lines are exempt from Part 3 only. Part 2 still scans them.
  - Every non-blank fenced line must match
    ``^- `(xstk-[a-z0-9-]+|outside-us-market-hours|[a-z0-9-]+\.(json|yaml))`( — | - |: )(alert rule|mute timing|dashboard|file)$``.
  - These fail as P3-fence: prose inside a fence, a fenced token that still exists, and an unclosed or nested
    fence.
- **Allowlist:**
  - a case-exact, quoted-literal strip of the sanctioned sentence: `${line//"$s"/}`;
  - a whole-line exemption only in the two findings files, keyed on the defect basename alone;
  - `${arr[@]+"${arr[@]}"}` guards for `set -u` on bash < 4.4.
  - When `/sdd-archiver` later prunes the report, the exemption still works: it matches the basename string,
    never the link target.
- `.feature` files stay outside the guard glob. The 250 ACs promoted into `platform.feature` contain "Loki".

### 5. Red-before-green: `scripts/check-otel-produced-signals.test.sh`

- Shape: `scripts/check-migration-contract.test.sh:1-29` (mktemp, trap, `fail()`, an `.err` file grepped for the
  named file).
- Setup: `mktemp -d`, then `cp -R` of `packages/otel`, `docs/setup`, `docs/patterns`, `docs/launch-pdfs`, `.do`
  and the two findings files.
- Fixtures (C-13 single-consumer, no inventory entry), in `scripts/testdata/otel-produced-signals/`:
  `alert-rules.prefix.yaml`, `service-health.prefix.json`, and `fr4.prefix.tsv` with columns
  `cite-id, tag, relpath, verbatim line`.
- Cases:
  - green on the fixed tree;
  - AC-1 red and AC-2 red, built from the verbatim pre-fix fixtures;
  - one red per `fr4.prefix.tsv` cite (14 Part 2/Part 3 rows + 8 FR-4 signal rows). A cite that does not trip fails the
    test;
  - root findings `:18` as a real red/green pair: the original row without the basename trips Part 2
    (`rpc_server_duration_milliseconds`, `service_name=`), and the NARROWed row carrying the basename is green;
  - otel findings rows are asserted by content only (grep the file for the basename), never by line number
    (fails.md:1293-1301);
  - strip case: a recased copy of the sanctioned literal still trips;
  - fence cases:
    - a fenced UID passes, and the same line unfenced fails;
    - prose inside a fence fails;
    - an unclosed fence fails;
    - a fenced, still-existing `service-health.json` fails;
    - one case uses an ASCII separator;
  - a comment-only `# removed xstk-error-rate-high` line in `alert-rules.yaml` must NOT satisfy existence;
  - a removal-prose line ("Delete the three alert rules below") trips P3-count, which proves the wording rule is
    enforced;
  - fallback tree with no dashboard JSON: count 0; green when `xstk-service-health` is fenced, red when it is not;
  - C-16: `dashboards/README.md` lists `service.name`, `deployment.environment` and `platform`, and has no
    `trading_mode`;
  - follow-up citation: extract `docs/roadmap/features/[0-9]{3}-trace-derived-alerting/` from each of the 4
    citing files, and assert all 4 are identical and the dir exists on the real tree.
- Trade-off (C-18): about 60 permanent lines of verbatim pre-fix text, kept as the regression proof in case the
  denylist is ever narrowed.

### 6. Follow-up story (C-11)

- Created with `/sdd-story` at status `idea`, slug `trace-derived-alerting`. NNN = max+1 at creation time (253
  today; 251 and 252 exist).
- Land it on main-dev FIRST, as its own docs-only PR, so the number is reserved before 250 cites it
  (feature-workflow.md:98-112).
- Its contents:
  - the removed rule UIDs and `outside-us-market-hours`;
  - the RunBacktest/ScoreStrategy client-invoked caveat (`analysis.proto:13-14`): the stall definition must be
    re-derived, not restored as written;
  - candidates to verify first: TraceQL-metrics alerting, Grafana span-metrics, and fix (b) with operator
    sign-off;
  - the note that the guard's Part 1 and P3-count must be relaxed when rules return.
- Cited by path from 4 places: `alerts/README.md`, `grafana-cloud.md` Step 7, and the NARROW content of the root
  and otel findings.

### 7. CI: a dedicated `otel-signals` job

- The job runs both the guard and the `.test.sh`.
- Paths filter: `packages/otel/**`, `docs/**`, `.do/**`, `scripts/check-otel-produced-signals*.sh` and
  `scripts/testdata/otel-produced-signals/**`.
- Shape it like `ci.yml:707-718` and add it to the `ci-gate` needs and echo list (`ci.yml:770-806`).
- Do NOT append the `.test.sh` to `ci.yml:629`, because the shell-lint job skips docs-only PRs. shellcheck/shfmt
  still cover both scripts through the `scripts/*.sh` glob.

### 8. Order

1. Land the follow-up `/sdd-story` dir on main-dev.
2. Asset, doc and constitution edits.
3. Teardown: `/context-constitution refresh` (root CLAUDE.md § Teardown; fails.md:670).
4. The guard and `.test.sh` run last, as the final verification, so a Teardown rewording cannot leave CI red.

## Rejected Alternatives

- Fix (b), adding metric/log export to the runtimes — out of scope by operator decision; it reverses 226 OD-3
  (recon.md:11).
- Rewriting the alerts onto TraceQL-metrics or Grafana span-metrics — no repo evidence that the stack generates
  them (recon.md:94-100; fails.md:711-713). Deferred to the follow-up `/sdd-story`.
- Filing the follow-up as a `docs/reports/` defect — a missing capability is not a bug (defect-filing.md:115).
- Creating the follow-up `/sdd-story` on the 250 branch — its number is not reserved on main-dev, so a parallel
  `/sdd-story` can collide.
- Folding the guard into the context-map job — it would make that job multi-purpose (C-18).
- Appending the `.test.sh` to the shell-lint job at `ci.yml:629` — that job skips docs-only PRs, and two homes
  duplicate the run.
- A bare `groups: []` alert-rules.yaml — leaves rules already provisioned from file running. Kept only as the
  fallback.
- Deleting every dashboard and the `alerts/` dir — loses the trace view and puts the `@AC-3 @feature-171` README
  at risk. Kept only as the JSON fallback, with the README preserved.
- A removed-asset denylist instead of a generic Part 3 existence check — about 40 fewer lines, but it misses future
  dangling references to assets removed without a record.
- A one-time P3-count proof in context.md with no permanent guard — no regression protection.
- Exempting the line above an opening fence from P3-count — opens a new hole for hidden prose. The wording rule
  replaces it.
- The P3-file lead-character skip (r3 original) — fails open on non-canonical relative paths. Replaced by
  full-token resolution.
- Building the existence set from every regex match in the alerts/dashboards files — comments can fake
  existence. Replaced by value-line-only extraction.
- Pinning findings-row assertions by line number, or keeping otel findings `:28` forever — conflicts with that
  file's `:23` lifecycle rule, and line pins drift (fails.md:1293-1301).
- Generic English tokens across all of `docs/` — they over-match (fails.md:2165). Narrowed to GEN_SCOPE.
- A whole-line exemption keyed on "feature 250" — too broad and fragile under Teardown. Keyed on the defect
  basename instead.
- A PromQL/LogQL-parsing guard — YAGNI while the produced set is empty (recon.md:96).
- Scoping doc claims by environment name — drifts with `.do` (recon.md:107-109; fails.md:1562). Scoped by
  `OTEL_ENABLED=true` instead.

## Open Risks

- [ ] The guard is about 120 to 150 lines of bash, and P3-count/P3-file are heuristics tied to today's
      vocabulary. A reworded count ("a pair of dashboards") or an asset outside `alerts/` or `dashboards/` slips
      through. Mitigation: the fixture-backed red cases make any relaxation visible in review. — to be
      addressed at the guard step (/sdd-spec).
- [ ] The Tempo `service-health.json` (TraceQL table panels) has no in-repo precedent (recon.md:98). It is proven
      only at the dev-import gate, and the fallback is taken on failure. — dashboard step, dev-import gate.
- [ ] The span-name regexes (`.*/Method`) are unverified until the dev import, so empty panels could be misread
      as no activity. — dashboard step, dev-import gate.
- [ ] No paging for error-rate, latency or analysis scoring until the follow-up lands (recon.md:102-105).
      Acceptable only because that dir is reserved on main-dev and cited. — follow-up step (first in order).
- [ ] Rules, the mute timing and dashboards already imported into Grafana Cloud persist until an operator deletes
      them by hand. The `deleteRules`/`deleteMuteTimes` key names are unverified until execute: check Context7
      and a throwaway `grafana/grafana` container, and fall back to `groups: []` on failure. — alerts step.
- [ ] `/sdd-archiver` will later prune the defect report. The basename exemption and the findings content
      assertions must not depend on the report file existing. — guard/test step.
- [ ] The 250 ACs promoted into `platform.feature` contain "Loki", so `.feature` files must stay outside the guard
      glob. — guard step; launch promotion.
- [ ] The local main-dev `acceptance.feature` is stale. Read the ACs from `origin/feature/fix-otel-metrics-logs-gap`.
      — /sdd-spec.
- [ ] Rebase-only overlap with feature 084 on `docs/patterns/observability.md` (recon.md:111). — docs step,
      rebase at integration.
- [ ] Before this session the debate existed only in the session-scoped scratchpad. It is now made durable by
      this design.md and the context.md entry. — closed at COMPLETION.

## Constitution Rules Touched

- `C-11` — honored by: a full-mode design per the operator decision (3 rounds). The follow-up capability goes
  through `/sdd-story` at `idea`, landed on main-dev first so its number is reserved. This resolves r2 blocking
  objection 2.
- `C-10` — honored by: orphan cleanup (`mute-timings.yaml` deleted, recon.md:61). Part 3 asset existence, built
  from value lines only, plus the fence keeps every reference to a removed asset either resolvable or explicitly
  listed for manual deletion. This resolves r2 blocking objection 1.
- `C-15` / `P-06` — honored by: verbatim pre-fix fixtures, with red cases per AC, per cite, per Part 3 tag and per
  fence rule, a red/green pair for root findings `:18`, and a green run.
- `C-16` — honored by: `@AC-3 @feature-171` is preserved by the README assertions and by the README surviving the
  fallback (recon.md:69). The `@feature-226` ACs are untouched, because the collector edits are comment-only
  (recon.md:72-75).
- `C-18` — honored by: a dedicated `otel-signals` job with its own path filter (including `.do/**`) and ci-gate
  wiring. The fixture and guard-size trade-offs are recorded here.
- `C-13` — honored by: single-consumer fixtures, so no inventory entry (test-data-inventory.md:70-77).
- `C-14` — honored by: internal-only, with no consumer-surface change (recon.md:64).
- `PLAT-3` — unchanged: traces only, over OTLP/HTTP (recon.md:65). Doc claims are scoped by `OTEL_ENABLED`.
- `OTEL-1` / `OTEL-2` — OTEL-1 is re-grounded on `resource.service.name`, and retired on the dashboard fallback.
  OTEL-2 is retired (recon.md:106). Findings rows are NARROWed by content, and otel findings `:28` is moved or
  removed per its `:23` lifecycle rule.
- Teardown (root CLAUDE.md, fails.md:670) — the context-constitution refresh runs before the guard, which is the
  final verification.
- `P-02` — honored by: only the orchestrator's synthesis carried between rounds.
- `F-04` / `P-03` — honored by: unproven paths (span-metrics, TraceQL-metrics alerting) stay Not found
  (recon.md:94-100) and are deferred, never assumed.
- `F-11` — honored: no Floor breach was raised in any round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-3 @feature-171` "The dashboards README documents the emitted attribute set, without trading_mode"
  (`docs/sdd/business-rules/platform.feature:144-149`) — not regressed by: the README rewrite keeps
  `service.name`, `deployment.environment` and `platform` with no `trading_mode`, the `.test.sh` asserts it, and
  the README survives the dashboard fallback (recon.md:69).
- PRESERVE `@AC-1 @feature-171` and `@AC-2 @feature-171` (`platform.feature`) — not regressed by: no runtime is
  touched, and no rewritten asset or doc selects on `trading_mode` or describes init as blocking (recon.md:70-71).
- PRESERVE `@AC-1 @feature-226` (`platform.feature:385`) — not regressed by: traces-only OTLP/HTTP export stays as
  the premise, and the collector pipelines stay (recon.md:72).
- PRESERVE `@AC-3 @feature-226` (`platform.feature:399`) — not regressed by: no doc routes the export failure to
  Loki (recon.md:73).
- PRESERVE `@AC-4 @feature-226` (`platform.feature:406`) — not regressed by: collector edits are comment-only, and
  compose endpoints are unchanged (recon.md:74).
- PRESERVE `@AC-2 @feature-226` (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`) — not
  regressed by: the UI is untouched, and no doc claims the UI emits metrics or logs (recon.md:75).
- EXTEND `@AC-1 @feature-250` (new: alert rules query only produced series) — new case: Part 1 over
  `alerts/*.yaml`. Sanctioned by the operator decision "Narrow to traces" (context.md 2026-10-20; re-recorded
  2026-10-21).
- EXTEND `@AC-2 @feature-250` (new: dashboards query only produced series) — new case: Part 1 over
  `dashboards/*.json`. Same operator decision.
- EXTEND `@AC-3 @feature-250` (new: docs list only exported signals) — new case: Parts 2/3 over SCOPE/GEN_SCOPE.
  Same operator decision.
- No CHANGE verdicts (recon.md:77), so no CHANGE needs an operator-decision reference.

## Rounds

- **r1** — proposed remove-all alerts, one Tempo dashboard and a signal-token guard. Blocking objections:
  - no red case per AC (C-15/P-06);
  - the AC-3 guard scope and denylist were too narrow.
- **r2** — added verbatim pre-fix fixtures, widened the AC-3 scope, `deleteRules`, a dedicated CI job and
  basename-keyed exemptions. Blocking objections:
  - C-10: the guard was blind to dangling references to deleted assets;
  - C-11: the follow-up was filed as a defect instead of a `/sdd-story`.
- **r3** — added Part 3 asset existence with the fence grammar, and the follow-up as a `/sdd-story` `idea` dir with
  4 checked citations. The adversary verdict was SOUND, with no Floor breach and only non-blocking objections.
  All of those objections are folded into §§3-7 above:
  - value-line existence set;
  - the removal-prose wording rule;
  - nullglob and a fallback test;
  - the GEN_SCOPE intersection;
  - the follow-up landed on main-dev first;
  - full-token resolution;
  - ASCII fence separators;
  - content-keyed findings assertions, including the root `:18` red/green pair.
- **Termination:** auto-approved 2026-10-21 under the operator's standing authorization: rounds = 3 ≥ 2, no
  unresolved F-* breach, no blocking objection, and no uncovered CHANGE.
