# Context Log: fix-app-specs-omit

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md`: App specs omit
  DB VPC attachment and trusted source.
- Severity: SEV-2. Environment: production.
- Routed to Track C by **operator override** of T-4, which would pick Track A. The operator's rationale:
  - production is torn down by design, so nothing live is degraded;
  - the gap also threatens staging's `main-dev` deploy path;
  - verification can dispatch `prod-up` from `main-dev`.
- Created feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), and context.md.
- Affected: deploy pipeline (specs, renderer, deploy/prod-up/prod-down workflows, DO docs and skill).
- Operator decisions, recorded verbatim in intent:
  - VPC ID comes from a doctl lookup, with SOPS only as a fallback.
  - Keep the public DB host.
  - prod-up and prod-down manage the trusted-source rule for the app.
- Facts gathered:
  - DO docs: the app-spec `vpc: {id: <uuid>}` field exists, and removing it detaches the app.
  - The console auto-adds trusted sources when you attach an existing cluster. `doctl apps create`
    evidently does not: the prod app was absent from the firewall list.
  - The `doctl databases list --format` columns do not include the private network UUID. The JSON
    output (`-o json`) carries the API's `private_network_uuid`.
- Recommended design depth: quick, `/sdd-design fix-app-specs-omit quick` (rationale: SEV-2, multi-file
  deploy pipeline, operator decisions already settle the main forks).
- Development branch: feature/fix-app-specs-omit

## Session 2026-11-04 (sdd-design)

- **Phase 0 Recon.** Wrote recon.md.
  - Scope: deploy pipeline only.
  - Reuse: the `db-connect.sh` firewall verbs, the `deploy.yml` exactly-one-by-name pattern, the renderer literal-placeholder fill, and stub-doctl run extraction in `sops-secrets.test.sh`.
- **Phase 1 Grilling.** 5 rounds. It was invoked `quick`, and the operator chose "Run another round" at each gate up to the cap.
- **Chosen approach.**
  - `vpc: {id: YOUR_VPC_ID}` in both specs, filled by a required, UUID-validated `--vpc-id`.
  - A new `scripts/do-db-cluster.sh lookup|trust|untrust`.
  - deploy.yml: lookup only.
  - prod-up: lookup, then idempotent trust, then one gated redeploy.
  - prod-down: delete, then best-effort untrust that never empties the list, with a step-summary remediation on failure.
  - The four manual render sites and the P6 render site in the docs/skill are updated or pointed at the workflows.
- **Rejected:** a literal UUID, the SOPS key (YAGNI), a composite action, doctl calls inside the renderer, untrust before delete, manual race remediation, trust in deploy.yml.
- **Constitution rules touched:** F-02/03/04/05, C-15/16/18, P-01/02/06. No Floor breaches.
- **Operator confirmed** proceeding although the Track C product spec skipped /sdd-review (status was `draft`).
- **Status:** draft → design-approved.
- **Open threads:**
  - Operator pre-merge check: DO token has database read+update scope.
  - The first staging deploy after merge is the `vpc:` canary.
  - Operator verification: run prod-up, confirm `db-migrator` connects, then run prod-down.

## Session 2026-11-04 (sdd-spec)

- Generated implementation-spec.md with 10 steps: test/service pairs 1–2 (`do-db-cluster.sh` + `dbnet`), 3–4 (atomic VPC placeholder: specs + renderer + deploy.yml/prod-up.yml render wiring), 5–6 (prod-up check/trust/wait/report), 7–8 (prod-down + `proddown`), 9 docs + context teardown, 10 full-suite gate. Status → implementation-ready.
- Key codebase findings:
  - Upstream doctl/godo verified: `databases list -o json` → godo `Database` (`id`, `name`, `private_network_uuid` omitempty); `firewalls list -o json` → `{uuid, cluster_uuid, type, value, created_at}`; `firewalls remove --uuid` is required; `apps create-deployment` exists; phases include SUPERSEDED; app spec `vpc: {id}`.
  - `prod-down.yml:24` uses unpinned `action-doctl@v2` and has no checkout; Step 8 pins both (`CHECKOUT_PIN`/`DOCTL_PIN`, `sops-secrets.test.sh:682-683`).
  - `shell-lint` already covers `scripts/*.sh` (`ci.yml:664-668`); only the `sops` filter (`ci.yml:86-96`) needs `scripts/do-db-cluster.sh` and `prod-down.yml`.
  - Extra doc drift: `docs/setup/digitalocean.md:594` and `SKILL.md:232,566,568` still say `db` / `${db.DATABASE_URL}`; both specs bind `${xstockstrat.DATABASE_URL}`.
  - This host lacks mikefarah yq, sops, shellcheck and shfmt (the suite fails at `need`); the executor must install them before Step 1's RED run. CI is authoritative.

## Session 2026-11-04 (sdd-review impl-spec, advisory)

- Result: 0 failures, 7 warnings. Advisory; did not block.
- Unresolved ✗ / ⚠ carried into execution:
  - Steps 5/6: prod-up `wait`/`report` (and assign) have no `id:` today, and Step 6 does not say to add one. Step 5's asserts and the `steps.*` references need them (C-01). [x] resolved in Step 6 (D1)
  - Steps 7/8: the prod-down summary step needs an explicit `id:` for the order assert (C-01). [x] resolved in Step 8 (`id: summary`)
  - Step 2: the cited spec line ranges are approximate. `cluster_name` is at `.do/app.yaml:692` and `.do/app.dev.yaml:694`. Cosmetic. [ ] unaddressed
  - Step 1: no coverage threshold is stated. `scripts/` has no CI coverage gate, so N/A (C-08). [ ] unaddressed
  - Step 9: large prose step. Consider splitting it. Advisory. [ ] unaddressed
- Overlap findings:
  - `.github/workflows/ci.yml` overlaps with 281-signal-watchlist-expiry-pruning in disjoint regions (the `sops` filter at 86-96 vs ci-gate at 899-937). Textual-merge risk only; no merge-order row required.
  - No migration, proto or config-key collisions.

## Session 2026-11-04 (sdd-execute sequential)

- Mode entry and the feature plan were confirmed by the operator. There was no re-spec. main-dev was merged in (one unrelated docs change); ledger-guard reported clean.
- Tooling installed on this host: mikefarah yq v4.44.3, sops 3.13.3 (sha256 verified), shellcheck 0.10.0, shfmt 3.10.0. The baseline suite was green (10 groups).

### Step 1 — test: `dbnet` group [done]
- Added `group_dbnet` (stub doctl, `dbx` runner, `no_doctl_write`), `FIXTURE_VPC`, and the `DB_*` UUID fixtures, and registered `dbnet`.
- RED: `ASSERT FAIL: dbnet: lookup 1 cluster exited 127 (bash: …/scripts/do-db-cluster.sh: No such file or directory)`.
- The uppercase-id case uses a literal rather than `${x^^}`, for bash 3.2 compatibility.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 2 — service: `scripts/do-db-cluster.sh` + CI filter [done]
- Created the `lookup|trust|untrust` script, implemented per the design. `untrust` validates every rule UUID before the first remove.
- Added `scripts/do-db-cluster.sh` to the CI `sops` path filter.
- GREEN: `dbnet: ok`. shellcheck and shfmt are clean.
- Files modified: `scripts/do-db-cluster.sh` (new), `.github/workflows/ci.yml`
- Deviations: none

### Step 3 — test: render VPC cases + deploy/prod-up wiring [done]
- `rnd` now passes `--vpc-id "${RND_VPC-$FIXTURE_VPC}"`. REVMAP takes a 6th argv value (the VPC).
- New render cases:
  - AC-1: `yq '.vpc.id'` on both rendered specs.
  - Case 7, AC-2: empty, non-UUID, uppercase, block deleted and block doubled. Each asserts rc 1, `YOUR_VPC_ID` in stderr and in `::error::`, no `--out`, and no `::add-mask::`.
  - Case 8: leak count-only.
- New `db_wiring` helper, plus order asserts in `group_deploy` (db < render < update) and `group_produp` (check < db < setup-sops < render).
- RED:
  - `render`: `do-render-app-spec.py: error: unrecognized arguments: --vpc-id d7afff57-…`
  - `deploy`: `ASSERT FAIL: deploy: db / render / update step missing`
  - `produp`: `ASSERT FAIL: produp: no db step`
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 4 — service: atomic VPC placeholder [done]
- **Specs**: both now carry `vpc: id: YOUR_VPC_ID` after `region: nyc`.
- **Renderer**:
  - new required `--vpc-id`;
  - before `resolve`, it checks for a lowercase UUID and for `YOUR_VPC_ID` occurring exactly once;
  - literal fill;
  - the leftover guard reports pre-substitution names, otherwise only a count ("values withheld").
- **Workflows**: `deploy.yml` and `prod-up.yml` each have a hard-failing `db` lookup step, and render takes `VPC_ID` as env plus `--vpc-id "$VPC_ID"`. The prod-up `db` step is ungated.
- **GREEN**:
  - full default suite: 11 groups ok;
  - ruff check and format clean;
  - `grep -c YOUR_VPC_ID` is 1 in each spec;
  - other spec readers still pass: agent `test_deployment_env_vars.py` (3 passed) and `check-otel-produced-signals.test.sh` (57 cases, 0 failed).
- Files modified: `.do/app.yaml`, `.do/app.dev.yaml`, `scripts/do-render-app-spec.py`, `.github/workflows/deploy.yml`, `.github/workflows/prod-up.yml`
- Deviations: none

### Step 5 — test: prod-up check / trust / wait / report [done]
- Added `step_idx`, `wait_stub` (a stateful doctl plus a no-op `sleep`), `wrun` (`env -i … bash -e`) and `produp_lifecycle`. Coverage:
  - full step order;
  - trust/wait/report env wiring, the `if` gate, no `${{` in runs, and no `shell:`;
  - check with 0/1/2 apps;
  - 11 wait cases, plus follow-the-redeploy, follow-newest-after-SUPERSEDED, and a 60-poll timeout that warns with rc 0.
- RED: `ASSERT FAIL: produp: step order broken at .value.id == "assign"`.
- Selecting by step `id` needs `id: assign`, `id: wait` and `id: report`, which Step 6 adds; this is the impl-spec review's warning.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: Step 6 adds `id: assign`, which no step named (see Deviation Log D1).

### Step 6 — service: prod-up check / trust / wait / report [done]
- **check**: fails when more than 1 app exists, and prints the A9 message.
- **trust**: new step after assign. Its `APP_ID` is created || existing.
- **wait**:
  - gated on created || appended, with env `APP_ID`, `CREATED` and `APPENDED`;
  - tolerates 4 empty polls;
  - on ERROR, redeploys once when gated, pinning the new deployment;
  - on SUPERSEDED, follows the newest deployment;
  - a timeout warns and exits 0 (one constraint comment records this).
- **report**: same gate as wait, with env `APP_ID` (A1).
- **Header**: 2 lines added.
- GREEN: `produp: ok`, `render: ok`, `dbnet: ok`. YAML parses.
- Files modified: `.github/workflows/prod-up.yml`, `scripts/sops-secrets.test.sh` (D2)
- Deviations: D1 (step ids), D2 (test precision). Both are in the Deviation Log; D2 was approved at the F-08 blocker.

### Step 7 — test: `proddown` group [done]
- Added `group_proddown` and registered it. It checks:
  - pins and permissions, and the confirm gate;
  - step order (find < delete < db < untrust < summary), and that no step's `run` contains `${{`;
  - the delete, db and untrust `if`/env/continue-on-error settings, and the summary `if`;
  - the forbidden-verbs regex;
  - the "cluster data untouched" wording;
  - a stub-run of `find` with 0/1/2 apps;
  - a stub-run of the summary with the lookup succeeding and failing (it never prints an empty cluster id).
- RED: `ASSERT FAIL: proddown: action pins`.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 8 — service: prod-down delete → best-effort untrust + CI filter [done]
- Rewrote the `down` job:
  - `permissions: contents: read`, pinned checkout and doctl (replacing the unpinned `@v2`);
  - find (fails above 1 app) → delete (hard) → db lookup (best-effort) → untrust (best-effort) → summary (only when the delete succeeded and the untrust did not; "cluster lookup failed" branch);
  - header and echo text: "cluster data untouched".
- Added `prod-down.yml` to the CI `sops` filter.
- GREEN: `proddown: ok`, `dbnet: ok`. YAML parses.
- Files modified: `.github/workflows/prod-down.yml`, `.github/workflows/ci.yml`
- Deviations: none. The summary step carries `id: summary`, as Step 7 required (impl-spec review warning, Steps 7/8).

### Step 9 — docs + context teardown [done]
- **`docs/setup/digitalocean.md`**:
  - Steps 5 and 6: lookup via `do-db-cluster.sh`, `-e "s|YOUR_VPC_ID|$VPC_ID|g"`, create with `--format ID --no-header`, then `trust`.
  - Step 8: explains `vpc:` and trusted sources, plus the read-modify-write caveat. The raw `doctl apps update --spec` is replaced by a pointer to the workflows.
  - `db` → `xstockstrat` (console fallback and the Step 5 table).
  - Troubleshooting heading `${xstockstrat.DATABASE_URL}`.
  - Token row: database read/update scope.
- **`digitalocean-setup` SKILL.md**:
  - P0b/P7 component name.
  - P4/P5: lookup, VPC fill and `trust`.
  - P6: the Python render-and-update is replaced by a pointer to the SOPS runbook and the workflows.
  - P7: attach is spec-based, with the console kept only as a fallback.
- **`infra-cost-reduction.md`**: lifecycle rows, data safety ("cluster data untouched"), the validation caveat (VPC, trusted source, `db-migrator`), the existing-app `vpc:` caveat, and the token-scope caveat.
- **Context teardown**: the `/context-forge:context-constitution` skill is **not available** in this session (only `context-forge:context-scrubber` is listed). I reconciled by hand instead.
  - I re-read every context or doc file that describes the changed behaviour (grep for do-render-app-spec, prod-up, prod-down, sops-secrets.test, trusted source and vpc across root `CLAUDE.md`, `docs/context-constitution*.md`, `docs/patterns/{ci-overview,database}.md`, `docs/runbooks/sops-secrets.md`, `README.md` and `.github`).
  - Drift found and fixed: `docs/patterns/ci-overview.md:23` (D4).
  - Checked and still accurate: `docs/context-constitution.md:83` (OTEL prefix) and `docs/runbooks/sops-secrets.md:10,13,136`.
  - No `CLAUDE.md` or constitution file was touched.
- **Verification greps**: `YOUR_VPC_ID` is filled at every manual site (11 hits). The checks for `name: db`, `${db.`, "cannot attach" and raw `apps update --spec .do/` return no output. `trusted` appears 6 times in the runbook.
- **Out-of-scope finding, not changed**: `.claude/skills/digitalocean-setup/SKILL.md` P2 creates a cluster named `xstockstrat-db`, but the specs bind `cluster_name: xstockstrat`. This drift predates the feature, and the new lookup fails closed with a clear message if they differ. It is recorded as a follow-up in the PR.
- Files modified: `docs/setup/digitalocean.md`, `.claude/skills/digitalocean-setup/SKILL.md`, `docs/runbooks/infra-cost-reduction.md`, `docs/patterns/ci-overview.md` (D4)
- Deviations: D3, D4

### Step 10 — test: full-suite regression gate [done]
- `bash scripts/sops-secrets.test.sh` printed 12 `: ok` lines (action resolve build render deploy produp homelab bootstrap ac24 cleanup dbnet proddown).
- ruff check and format are clean on both Python scripts.
- shellcheck and shfmt are clean on every touched file. Pre-existing: an SC2015 info note in untouched `scripts/homelab-render.test.sh:126,170` under local shellcheck 0.10.0. CI uses the apt build.
- jscpd on this feature's files: 0 clones. Its default `services/ packages/` baseline is pre-existing and advisory.
- `node scripts/check-config-wiring.mjs --final`: rc 0. The only output is unrelated `REPORTED` lines.
- Merge-order: no entry for 287.
- C-16: promoted AC-1..AC-4 into `docs/sdd/business-rules/platform.feature` with `@feature-287` (operator confirmed).
- Status: in-progress → code-completed.

## Session 2026-11-04 — sdd-execute (summary)
**Steps this session**: 1–10
**Progress**: 10 done / 10 total
**Stopped at**: all complete; integration PR next
**Accountability**:
- Out-of-scope changes: none. D2 (test precision) was approved at an F-08 blocker; D4 was sanctioned by Step 9 Instruction 4.
- Open items:
  - Operator pre-merge check of the DO token's database read+update scope.
  - Operator live verification: run prod-up, confirm `db-migrator` connects, run prod-down.
  - Follow-up: the digitalocean-setup skill's P2 cluster name `xstockstrat-db` vs the spec's `cluster_name: xstockstrat`.
- Unaddressed review warnings, cosmetic only:
  - approximate line ranges in Step 2;
  - no coverage threshold, which is N/A for `scripts/`;
  - Step 9 size.

## Session 2026-11-04 (PR #1411: merge main-dev)
- The PR was `dirty` because feature 288 (fix-deploy-wait-loop, #1409) landed on main-dev. It touched `deploy.yml` (deploy concurrency, wait loop ends on SUPERSEDED), `scripts/sops-secrets.test.sh` and `platform.feature`.
- Merged main-dev and kept both sides:
  - `group_deploy` now has 287's db/render/update order asserts followed by 288's wait-loop stub run.
  - `platform.feature` lists 288's AC-1/AC-2 before 287's AC-1..AC-4.
- No semantic clash. 288 changes deploy.yml's wait loop only. prod-up keeps 287's design: on SUPERSEDED it follows the newest deployment, with one gated redeploy.
- Full suite after the merge: 12/12 groups ok. shellcheck and shfmt clean.

## Session 2026-11-04 (operator request: skill cluster name)
- At the operator's request, fixed the follow-up flagged in Step 9: `.claude/skills/digitalocean-setup/SKILL.md` used the cluster name `xstockstrat-db` in four places (P2 checklist line, P2 `doctl databases create`, P2 console path, final summary). All four now say `xstockstrat`, matching the specs' `cluster_name: xstockstrat` and `docs/setup/digitalocean.md` Step 3. The `lookup` the skill's P4/P5 call now resolves on a cluster the skill created.
- Unrelated `xstockstrat-db` hits were left alone: the local compose container, the `xstockstrat-db-migrator` image, and the setup guide's temp-file name.
- Also noticed, not changed (operator scoped this to the name): the skill's P2 and the setup guide's Step 3 both create PG `--version 15`, while both specs declare `databases[].version: "18"`.

## Session 2026-11-04 (operator request: PG version)
- At the operator's request, aligned the PostgreSQL version with the specs' `databases[].version: "18"` and the live cluster, which `db-cluster-get` reports as `"version":"18"`:
  - `.claude/skills/digitalocean-setup/SKILL.md` P2: `doctl databases create … --version 18`.
  - `docs/setup/digitalocean.md`: the overview table (`:29`), the Step 3 prose (`:129`), the summary (`:141`) and `--version 18` (`:152`).
