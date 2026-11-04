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
  - Steps 5/6: prod-up `wait`/`report` (and assign) have no `id:` today, and Step 6 does not say to add one. Step 5's asserts and the `steps.*` references need them (C-01). [ ] unaddressed
  - Steps 7/8: the prod-down summary step needs an explicit `id:` for the order assert (C-01). [ ] unaddressed
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
