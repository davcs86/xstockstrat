# Context: fix-app-specs-omit  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: Bug fix (SEV-2, Track C) for the DO App Platform deploy pipeline. Both `.do/app.yaml` and `.do/app.dev.yaml` now carry `vpc: id: YOUR_VPC_ID`, filled by a required, UUID-validated `--vpc-id` in `scripts/do-render-app-spec.py` from a doctl lookup in the new `scripts/do-db-cluster.sh lookup|trust|untrust`. `prod-up.yml` appends the new app as a cluster trusted source (plus one gated redeploy) and `prod-down.yml` deletes the app, then removes that one rule best-effort. Before the fix, `prod-up` run 41783551259 created the app but its PRE_DEPLOY `db-migrator` timed out on `:25060` (no VPC, not a trusted source), and every staging `deploy.yml` update risked detaching staging because DO treats a spec without `vpc` as a detach. Shipped 2026-11-04 via promotion PR #1422 (commit 0ef77aa1); the operator's live verification (run prod-up, confirm `db-migrator` connects, run prod-down) and a DO token database read+update scope check were open at archive time.

**Why (irrecoverable rationale)**:
- Routed to Track C by **operator override** of T-4 (which would pick Track A hotfix): prod is torn down by design so nothing live was degraded, the same gap threatened staging's `main-dev` deploy path, and verification could dispatch `prod-up` from `main-dev` (context.md@d5cdb712:9-15).
- Operator decisions fixed the main forks (context.md@d5cdb712:18-21; product-spec.md@d5cdb712:39-44): VPC ID from a doctl lookup (SOPS key only as a fallback, never built); keep the public DB host (no `DATABASE_URL` change); prod-up/prod-down own the app's trusted-source rule.
- Root cause was a **two-part gap**: no `vpc:` block, and `doctl apps create` does not auto-add trusted sources the way the console does when you attach an existing cluster (the prod app was absent from the firewall list) (context.md@d5cdb712:22-25). Removing `vpc` from a spec on update detaches the app (DO docs).
- doctl `databases list --format` columns omit the private network UUID; only `-o json` carries `private_network_uuid` (context.md@d5cdb712:26-27), hence jq on JSON output. `firewalls remove --uuid` is required; firewalls list JSON is `{uuid, cluster_uuid, type, value, created_at}` (context.md@d5cdb712:58).
- Operator confirmed proceeding although the Track C product spec skipped `/sdd-review` (status stayed `draft`) (context.md@d5cdb712:47).
- VPC and cluster IDs are deliberately not config keys (F-07): they are deploy-pipeline values from the DO API, not service config; the cluster name comes from the spec (design.md@d5cdb712:218).
- prod-up's wait loop deliberately **warns and exits 0** on its 60x15 s timeout, unlike deploy.yml's exit 1: prod-up is attended and Report must still print the URL (design.md@d5cdb712:82, 194).

**Rejected alternatives**:
- Literal VPC UUID in both specs — drifts if the cluster is recreated, and decision 1 asked for a lookup (design.md@d5cdb712:185).
- SOPS `digitalocean.VPC_ID` key — YAGNI since doctl returns `private_network_uuid`; it is the follow-up if a lookup ever comes back empty (design.md@d5cdb712:186).
- Private DB hostname — out of scope per decision 2 (design.md@d5cdb712:187).
- Composite action for the lookup — would break `group_produp`'s exact `uses:` pin and is less stub-testable than a script (design.md@d5cdb712:188).
- Renderer calling doctl itself — couples the hermetic `env -i` renderer tests to the DO API, and prod-down needs only `cluster_id` and never renders (design.md@d5cdb712:189).
- Untrust before delete in prod-down — if delete then failed a live app is left with no DB access; delete first, and the rule is still findable by app ID afterwards (design.md@d5cdb712:190).
- Hard-fail untrust — a red teardown invites a re-run, which finds "already down" and cannot clean up; instead best-effort untrust plus a step-summary naming the stale rule UUID (design.md@d5cdb712:191).
- Manual remediation for the PRE_DEPLOY race — a re-run of prod-up skips everything ("already running"), so one automatic gated redeploy instead (design.md@d5cdb712:192).
- Trust in deploy.yml on every deploy — self-healing but gives every staging/prod deploy firewall write rights; rejected on blast radius (design.md@d5cdb712:193).
- Shared wait-loop script for deploy.yml and prod-up — differing timeout semantics (exit 1 vs warn) would change one workflow's behaviour (design.md@d5cdb712:194).

**Scars & gotchas**:
- The firewall race is mitigated, not eliminated: the rule can only be appended after `apps create` starts the first deployment; `db-migrator` builds from source (`scripts/Dockerfile.migrate`, minutes), so the rule normally lands first, and one gated redeploy on ERROR covers the rest (recon.md@d5cdb712:81; design.md@d5cdb712:202).
- doctl `firewalls append/remove` re-read and rewrite the whole rule list: a concurrent `scripts/db-connect.sh` session or console edit can be lost. An empty rules list means "open to all", so `trust` warns and does not append, and `untrust` refuses to remove the last rule (design.md@d5cdb712:52-62, 203).
- The renderer's leftover-placeholder guard must never echo rendered text: it reports pre-substitution `YOUR_*` names, else only a count ("values withheld"); the leak test uses sentinel `YOUR_PROD_LEAKED` and checks only `^::error::` lines plus stderr, since `::add-mask::` legitimately carries the sentinel (design.md@d5cdb712:34-35, 170).
- Extracted workflow `run:` blocks must contain no `${{` (values only via step `env:`); the tests assert this for db/wait/report/trust/untrust, so extracted scripts execute identically under `env -i … bash -e` with stub doctl/sleep (design.md@d5cdb712:161-162, 176-180).
- Under the default `bash -e`, a failing `create-deployment` exits with doctl's own rc (3), so the test expects 3 not "1"; `get-deployment app1 <id> --format Phase` is matched as a prefix because argv carries trailing flags (D2; implementation-spec.md@d5cdb712:772-777).
- Tests that select steps by `id` need the service step to add the ids: prod-up's `assign`/`wait`/`report` and prod-down's `summary` had none and the spec did not say so; the impl-spec review flagged it (context.md@d5cdb712:68-69, 133, 173).
- REVMAP in `scripts/sops-secrets.test.sh` allows only `value: YOUR_(DEV|PROD)_X` lines to differ and takes the VPC as a 6th argv slot; the uppercase-UUID case uses a literal rather than `${x^^}` for bash 3.2 (context.md@d5cdb712:85, 97; design.md@d5cdb712:171).
- This host lacked mikefarah yq, sops, shellcheck and shfmt (suite fails at `need`); installed yq 4.44.3, sops 3.13.3, shellcheck 0.10.0, shfmt 3.10.0 before the baseline. Local shellcheck 0.10.0 prints an SC2015 info on untouched `scripts/homelab-render.test.sh:126,170`; CI uses the apt build (context.md@d5cdb712:80, 201).
- The merge of main-dev into PR #1411 (feature 288, fix-deploy-wait-loop, #1409) conflicted in deploy.yml, `sops-secrets.test.sh` and `platform.feature`; both sides were kept: `group_deploy` has 287's order asserts then 288's wait-loop stub run, and platform.feature lists 288's AC-1/AC-2 before 287's AC-1..AC-4. No semantic clash: 288 changes deploy.yml's wait loop (ends on SUPERSEDED); prod-up follows the newest deployment on SUPERSEDED (context.md@d5cdb712:224-228).
- prod-up against an EXISTING app now always runs lookup + trust, so a token-scope or DO API failure fails a run that used to be a silent no-op (behaviour change on the already-running path) (design.md@d5cdb712:207).
- The widened leftover-placeholder guard fails a render (value withheld) if any secret value contains `YOUR_`; judged negligible and accepted because it fails closed (design.md@d5cdb712:210).
- The staging `vpc:` canary matters because the app region is `nyc` but the cluster is `nyc1`; if App Platform rejects `vpc:` on update every deploy fails closed until reverted. Staging's VPC state was unknown at design time (`apps-get-info` showed no `vpc`); the first staging deploy after merge attaches it and triggers a normal redeploy (design.md@d5cdb712:204; recon.md@d5cdb712:83).
- godo `private_network_uuid` is `omitempty`: an absent key reads as `null` in jq and must fail the UUID check, which is why `dbnet` has empty/absent-VPC stub cases (implementation-spec.md@d5cdb712:42-43).
- Post-execute scope additions (operator-requested after code-completed, beyond the design's `db` -> `xstockstrat` rename): the skill's cluster name `xstockstrat-db` -> `xstockstrat` (4 places) and PG `--version 15` -> `18` (skill P2; `docs/setup/digitalocean.md:29,129,141,152`) (context.md@d5cdb712:231-239).
- Doc/skill drift surfaced only because this feature touched them: `docs/setup/digitalocean.md` and `digitalocean-setup/SKILL.md` called the app component `db` / `${db.DATABASE_URL}` (specs bind `xstockstrat` / `${xstockstrat.DATABASE_URL}`), said doctl cannot attach a DB (`SKILL.md:557-567`), created cluster `xstockstrat-db` (specs: `cluster_name: xstockstrat`), and created PG `--version 15` (specs: `databases[].version: "18"`, live cluster reports "18"). The new lookup fails closed on a name mismatch, so the skill's own cluster would not have resolved (recon.md@d5cdb712:84-86; context.md@d5cdb712:61, 194, 232-239).

**Permanent deviations**:
- spec (impl-spec Step 9) said the manual render sites do an inline `vpc_id=$(doctl databases list -o json | jq …)` then `doctl databases firewalls append` -> shipped: docs and skill call `scripts/do-db-cluster.sh lookup`/`trust` -> because one validated implementation (exactly-one cluster by the spec's `cluster_name`, UUID checks, idempotent trust with the empty-list guard) beats a second copy (DRY, C-18); cost is operators need mikefarah `yq` locally (`brew install yq jq`) (D3; implementation-spec.md@d5cdb712:690-693,779-782).
- spec said Step 6 adds only `id: trust` -> shipped also adds `id: assign`, `id: wait`, `id: report` -> Step 5's order/wiring asserts select by id (D1; approved in the operator's up-front plan) (implementation-spec.md@d5cdb712:767-770).
- spec said Step 6 Files = `prod-up.yml` only -> shipped also edits two test-precision lines in `sops-secrets.test.sh` (rc 3 and prefix match) -> approved by the operator at an F-08 blocker, Option A (D2; implementation-spec.md@d5cdb712:772-777).

**Cross-feature signal**:
- Directly applies the lesson of inter-service-mtls (fails.md 2026-10-07, "YOUR_* placeholder added to a spec without editing every render site"): the placeholder, renderer arg and both render sites (`deploy.yml`, `prod-up.yml`; the only two callers of `do-render-app-spec.py`) landed in one atomic step, verified by running the renderer. Recon also applied fails.md 2026-08-13 (deploy dispersion: grep every render call site; only `deploy.yml:79` and `prod-up.yml:66` invoke `do-render-app-spec.py`) (recon.md@d5cdb712:87-88). No new ledger entry (DUP).
- Extends feature 286 (sops-secrets-migration): its `sops-secrets.test.sh` harness (stub doctl extraction, REVMAP, `rnd`) gained `dbnet`/`proddown` groups and prod-up lifecycle stubs; @feature-286 `@AC-16` (no placeholder remains) now covers `YOUR_VPC_ID`, and `@AC-8` carries a new precondition that the DO token can read databases.
- Collided with feature 288 (fix-deploy-wait-loop) in deploy.yml/test/platform.feature; merged cleanly (see Scars). `ci.yml` `sops` path filter also overlaps 281-signal-watchlist-expiry-pruning in disjoint regions (textual-merge risk only).

**Deferred follow-ons**:
- Operator pre-merge check: `DIGITALOCEAN_ACCESS_TOKEN` has database read (deploy.yml lookup) and read+update (prod-up/prod-down firewalls); a custom-scoped token fails closed on every deploy. Status unconfirmed at archive time.
- Operator live verification: run prod-up, confirm `db-migrator` connects, run prod-down. The first staging deploy after merge is the `vpc:` canary (if DO rejects `vpc:` on update, deploys fail closed until reverted).
- If a lookup ever returns an empty VPC, build the SOPS `digitalocean.VPC_ID` fallback (not built, design.md@d5cdb712:186).
- An existing prod app picks up `vpc:` only on its next deploy-prod (render stays gated in prod-up) (design.md@d5cdb712:206).
- Unconfirmed: whether VPC attachment plus the public host changes the network path; the trusted-source rule is what definitely gates public-host traffic (recon.md@d5cdb712:82; design.md@d5cdb712:205).
- If DO removes the app's rule itself on app delete, `untrust` can 404 and print a false stale-rule summary (job outcome unaffected) (design.md@d5cdb712:209).
- Unaddressed cosmetic review warnings: approximate cited line ranges in Step 2 (`cluster_name` at `.do/app.yaml:692`, `.do/app.dev.yaml:694`); Step 9 is a large prose step. No coverage gate applies to `scripts/` (context.md@d5cdb712:68-72).
- Defect report `docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md) is still sidecar status `triaged` (ref `feature:287-fix-app-specs-omit`); not pruned by this archive.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-04 entries.

**Runtime-invariant recommendations (→ /context-constitution)**:
- DEPLOY-pipeline candidate: `doctl apps create` does not add the app to the DB cluster's trusted sources (console attach does); every create path must call `scripts/do-db-cluster.sh trust`, and removing `vpc:` from a spec on `apps update` detaches the app, so both `.do/app*.yaml` must keep `vpc.id: YOUR_VPC_ID` filled by `--vpc-id` at every render site.
- `doctl databases firewalls append/remove` is a whole-list read-modify-write; never run concurrently with `scripts/db-connect.sh` sessions; an empty rules list means open-to-all and must not be "trusted into" restriction.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at d5cdb712.
