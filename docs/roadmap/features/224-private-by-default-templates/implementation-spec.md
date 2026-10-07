# Implementation Spec: private-by-default-templates

**Status**: `pending`
**Created**: 2026-10-07
**Feature**: `docs/roadmap/features/224-private-by-default-templates/feature.md`
**Total Steps**: 41
**Feature Branch**: `feature/private-by-default-templates`

---

## Execution Summary

This spec implements **release N** of the approved design (`design.md` §12): expand-only schema, RPCs
that honor the owner header but still tolerate headerless calls, and all identity threading. The
fail-closed cutover, bypass removal, NOT NULL and contract drops belong to the named follow-up
"224 enforce + contract" (Step 41 creates it). The order is the design's build order, with one
deliberate change: each service's migration lands **before** the code that reads its new columns
(C-07 deploy order). So analysis `026` (Step 6) precedes analysis threading (Step 7), which writes
`backtest_runs.user_id`. Identity threading in analysis (Steps 7–12) lands before indicators stops
trusting the header-only bypass (Step 14). The bypass then becomes SAN-bound, and the analysis
interceptor is removed (Step 16). Ingest ownership (Steps 18–20) precedes config per-user secrets
(Steps 21–22) and the poller (Steps 23–24), per design amendment 7. The blend-guard helper (Step 25)
precedes the strategy-template saga that calls it (Step 31). Consumer surfaces (agent Step 34, UI
Steps 36–39) come last, then docs teardown (Step 40) and the follow-up feature (Step 41).

**Consumer surfaces (C-14):** both named surfaces are reached. **Agent:** Step 34. **UI:** Steps 36–39,
covering `/insights/formulas`, `/insights/templates`, `/insights/signal-sources`, `/config-ui/templates`
and the `/config-ui/sources` admin read-only view.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 | 15 |
| AC-2 | 15 |
| AC-3 | 15 |
| AC-4 | 15 |
| AC-5 | 12, 17 |
| AC-6 | 8, 15 |
| AC-7 | 20 |
| AC-8 | 20 |
| AC-9 | 20 |
| AC-10 | 20 |
| AC-11 | 8, 20 |
| AC-12 | 8, 20 |
| AC-13 | 28, 30, 32 |
| AC-14 | 28 |
| AC-15 | 28, 33 |
| AC-16 | 28 |
| AC-17 | 28 |
| AC-18 | 32 |
| AC-19 | 32 |
| AC-20 | 32 |
| AC-21 | 10 |
| AC-22 | 15, 33 |
| AC-23 | 15, 26 |
| AC-24 | 39 |
| AC-25 | 35 |
| AC-26 | 8, 20 |
| AC-27 | 33 |
| AC-28 | 10, 15, 20 |
| AC-29 | 8, 20 |
| AC-30 | 12 |
| AC-31 | 28 |
| AC-32 | 35 |
| AC-33 | 20 |
| AC-34 | 32 |
| AC-35 | 22, 24 |
| AC-36 | 8, 20 |
| AC-37 | 8 |

### Spec-level elaborations (not decided in design.md — confirm at `/sdd-review impl-spec`)

These are mechanical consequences of approved requirements. None reopens a design decision. Each is
recorded in `context.md` § Open Threads.

1. **FR-13 owner selectors.** FR-13 requires "List RPCs honour an owner selector only for ADMIN", but
   `design.md` §12 names no selector fields. This spec reuses `ListFormulasRequest.author_filter` and
   adds `owner_user_id` to `ListSignalSourcesRequest` (2), `QuerySignalsRequest` (7),
   `GetStrategyRequest` (2) and `ListStrategyDefinitionsRequest` (4).
2. **Saga commit of hidden copies.** `design.md` §6 creates pending-hidden formula copies but does not
   say how they become visible after commit. This spec adds an internal indicators
   `ResolveTemplateIntent(intent_id, commit)`, which un-hides on commit and hard-deletes on abort. Intent
   states are `PENDING → COMMITTED → FINALIZED` or `PENDING → ABORTING → ABORTED`. The reconcile sweep
   retries the non-terminal states.
3. **Template RPC set.** Per `design.md` §5 each service exposes three RPCs: `ListTemplates`,
   `ManageTemplate` and `InstantiateTemplate`. The product spec's `GetTemplate` is omitted (YAGNI:
   `ListTemplates` serves every read).
4. **ListStrategies origin.** `ListStrategies` returns `StrategyScore`, so FR-8 parity adds
   `StrategyScore.origin` (field 8).
5. **Headerless `ManageSignalSource` in N** (`design.md` is silent). It keeps today's admin gate.
   - REGISTER of a slug held by anyone → `ALREADY_EXISTS` (today's code).
   - REGISTER of a new slug → `FAILED_PRECONDITION` ("x-user-id required"). Only `analysis-fundsignal`
     may write as `system` (FR-6), so a headerless call never creates a source.
   - UPDATE/REACTIVATE/DEACTIVATE resolve the unique holder: 0 → `NOT_FOUND`, >1 →
     `FAILED_PRECONDITION`.
6. **Saga sweep timing.** No new config keys (product spec). The sweep interval and stale-intent age
   are named invariant constants with a stated rationale, following the operator's round-5 "fixed
   invariant caps" ruling.
7. **Attribution read filter.** `GetAttribution` drops any source slug outside the caller's visible
   own + system set. Pre-feature `order_snapshots.signals` were captured unscoped, so without this
   filter AC-12 fails on legacy rows.

## Step Dependencies

- Steps 3–41 require Steps 1–2: every later step consumes the generated stubs.
- Step 4 [test] covers Step 3 [service].
- Steps 14, 19 and 21 require Step 5: the SAN spike must pass before any code depends on
  `peer_identities()` or `getAuthContext()` (design Open Risk). If Step 5 fails, block those steps and
  use the design's fallback (cert parsing from `auth_context()`), recorded in the Deviation Log.
- Step 7 requires Step 6: `_persist_backtest_run` writes `backtest_runs.user_id`, and retention is
  owner-scoped.
- Step 8 [test] covers Step 7 [service]. AC-37 assertions check the **pre-flight decision**, not an
  indicators denial: indicators still trusts the bypass until Step 14 (design Open Risk).
- Step 9 requires Step 6 (new columns and tables). Step 10 [test] covers Step 9 [service].
- Step 11 requires Step 7, which supplies the per-owner evaluator. Step 12 [test] covers Step 11.
- Step 14 requires Steps 5 and 13. Step 15 [test] covers Step 14.
- Step 16 requires Steps 7, 11 and 14. Owner threading must land before the analysis interceptor is
  removed, never after (recon Risk 1). Step 17 [test] covers Step 16.
- Step 19 requires Steps 5 and 18. Step 20 [test] covers Step 19.
- Step 18 has an **execute-time operator gate**. The operator supplies the prod count of
  `source_type='mcp_client'` rows before the step's files are written; see the step for the branches.
- Step 21 requires Step 5. Step 22 [test] covers Step 21.
- Step 23 requires Steps 19 and 21 (design amendment 7: config per-user secrets before the poller).
  Step 24 [test] covers Step 23.
- Step 25 precedes Step 31 (design amendment 8). Step 26 [test] covers Step 25.
- Step 27 requires Steps 13 and 14. Step 28 [test] covers Step 27.
- Step 29 requires Steps 18 and 19. Step 30 [test] covers Step 29.
- Step 31 requires Steps 6, 25 and 27 (it calls indicators `InstantiateTemplate` and
  `ResolveTemplateIntent`). Step 32 [test] covers Step 31.
- Step 33 requires Steps 3, 6, 13 and 18: the assertions run inside Step 3's `migration-rerun` job.
- Step 34 requires Steps 27, 29 and 31. Step 35 [test] covers Step 34.
- Steps 36–38 require Steps 14, 19, 27, 29 and 31. Step 38 also requires Step 37: it enables
  `mcp_client` templates on the `/insights/templates` page that Step 37 creates (no Step 37 → 38
  forward dependency). Step 39 [test] covers Steps 36–38.
- Step 40 runs after all code steps (teardown).
- Step 41 must land before the integration PR (design Open Risk: the follow-up and its merge-order
  row).
- **Merge order:** rebase on feature 217 (`code-completed`; `StrategyDefinition` field 15 is already on
  trunk) before the integration PR (`merge-order.md` row 72).
- **Pre-merge operator check:** confirm the prod value of `analysis.fundsignal.scoring_formula_id` is
  the `SYSTEM_AUTHOR` formula `d1ff5e6b-6d9c-589d-b95e-defd862c702b` (design Open Risk). AC-37 darkens
  fundsignal otherwise.

---

### Step 1 — proto: template types, ownership fields, deprecations, template RPCs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify
- `packages/proto/indicators/v1/indicators.proto` — modify
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/config/v1/config.proto` — modify

**Reviewers**:
- Proto Reviewer: field-number uniqueness per message; no breaking change without a deprecation
  comment; `buf lint`/`buf breaking` pass.
- `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-config` owners:
  each service's contract.
- Security: per-user secret scope on `GetSecretRequest`.

**Codebase Evidence**:
- `common.proto` messages and enums: `PageRequest:10`, `TimeRange:42`, `Environment:60`, `Sector:96`.
  No `Template*` type exists (grep `Template` in `packages/proto` → none).
- `indicators.proto`:
  - `FormulaDefinition` ends at `fundamental_inputs = 14` (`:172`); `is_public = 8` (`:162`).
  - `RegisterFormulaRequest`: `is_public = 4` (`:192`), `author = 6` (`:194`), max field 10.
  - `ListFormulasRequest`: `include_public = 2` (`:211`).
  - `UpdateFormulaRequest`: `is_public = 6` (`:227`), max 11.
  - Deprecation precedent: `string user_id = 2 [deprecated = true]; // DEPRECATED: …` (`:223`).
- `ingest.proto`:
  - `ExternalSignal` max field 10 (`:127`).
  - `SignalSource` max 12 (`:171`).
  - `QuerySignalsRequest` max 5 (`:144`).
  - `ListSignalSourcesRequest { bool include_inactive = 1; }` (`:182-184`).
- `analysis.proto`:
  - `StrategyDefinition` ends at `sector_param_overrides = 15` (`:372`, feature 217 already on trunk).
  - `StrategyScore` max 7 (`:241`).
  - `GetStrategyRequest { strategy_id = 1 }` (`:415-417`).
  - `ListStrategyDefinitionsRequest` max 3 (`:419-423`).
  - service RPC list `:12-56`.
- `config.proto`:
  - `GetSecretRequest` max field 3 (`:110-114`).
  - `SetConfigRequest.user_id = 9` carries the comment "Secret keys (is_secret) are global-scope only
    (feature 147)" (`:132-133`).

**TDD**: N/A (proto — non-code-bearing)

**Covers**: —

**Instructions**:
1. **`common.proto`.** Add:
   - `enum TemplateKind { TEMPLATE_KIND_UNSPECIFIED = 0; TEMPLATE_KIND_STRATEGY = 1; TEMPLATE_KIND_FORMULA = 2; TEMPLATE_KIND_SIGNAL_SOURCE = 3; }`
   - `enum TemplateOperation { TEMPLATE_OPERATION_UNSPECIFIED = 0; TEMPLATE_OPERATION_CREATE = 1; TEMPLATE_OPERATION_UPDATE = 2; TEMPLATE_OPERATION_RETIRE = 3; }`
   - `message TemplateMeta { string template_id = 1; TemplateKind kind = 2; string name = 3; string description = 4; int32 version = 5; bool retired = 6; google.protobuf.Timestamp created_at = 7; google.protobuf.Timestamp updated_at = 8; }`
   - `message TemplateOrigin { string template_id = 1; int32 template_version = 2; int32 latest_version = 3; bool update_available = 4; }`

   Import `google/protobuf/timestamp.proto` if `common.proto` does not already import it.
2. **`indicators.proto`.**
   - Deprecate, never delete: `FormulaDefinition.is_public` (8), `RegisterFormulaRequest.is_public` (4),
     `RegisterFormulaRequest.author` (6), `ListFormulasRequest.include_public` (2) and
     `UpdateFormulaRequest.is_public` (6). Use `[deprecated = true]` and a `// DEPRECATED:` comment
     (ignored, private-by-default; author comes from `x-user-id`).
   - Re-document `ListFormulasRequest.author_filter` as "owner selector honoured only for an ADMIN
     caller; ignored otherwise".
   - Add `xstockstrat.common.v1.TemplateOrigin origin = 15;` to `FormulaDefinition`.
   - Add the RPCs `ListTemplates`, `ManageTemplate`, `InstantiateTemplate` and `ResolveTemplateIntent`
     with these messages:
     - `FormulaTemplate { common.v1.TemplateMeta meta = 1; RegisterFormulaRequest payload = 2; }`.
       Doc-comment `payload`: the deprecated `is_public` (4) and `author` (6) inside it are ignored on
       instantiate (the instance is private and its author is the instantiating caller's `x-user-id`).
     - `ListTemplatesRequest {}`
     - `ListTemplatesResponse { repeated FormulaTemplate templates = 1; }`
     - `ManageTemplateRequest { common.v1.TemplateOperation operation = 1; FormulaTemplate template = 2; }`
     - `ManageTemplate` returns `FormulaTemplate`.
     - `InstantiateTemplateRequest { string template_id = 1; repeated string template_ids = 2; string intent_id = 3; }`.
       Fields 2–3 are saga-only: internal, SAN-bound `xstockstrat-analysis`.
     - `InstantiateTemplateResponse { FormulaDefinition formula = 1; map<string, string> formula_ids_by_template = 2; }`
     - `ResolveTemplateIntentRequest { string intent_id = 1; bool commit = 2; }`
     - `ResolveTemplateIntentResponse { int32 affected = 1; }`
3. **`ingest.proto`.**
   - Add `string user_id = 11;` to `ExternalSignal` (server-stamped, ignored on write).
   - Add `string user_id = 13;` and `xstockstrat.common.v1.TemplateOrigin origin = 14;` to
     `SignalSource`. `user_id == "system"` is the read-only flag.
   - Add `enum SignalScope { SIGNAL_SCOPE_UNSPECIFIED = 0; SIGNAL_SCOPE_OWN = 1; SIGNAL_SCOPE_SYSTEM = 2; }`.
     UNSPECIFIED means own + system.
   - Add `SignalScope scope = 6;` and `string owner_user_id = 7;` (admin-only) to `QuerySignalsRequest`.
   - Add `string owner_user_id = 2;` (admin-only) to `ListSignalSourcesRequest`.
   - Add the RPCs `ListTemplates`, `ManageTemplate` and `InstantiateTemplate`:
     - `SourceTemplate { common.v1.TemplateMeta meta = 1; SignalSource payload = 2; }`
     - `ListTemplatesRequest {}` / `ListTemplatesResponse { repeated SourceTemplate templates = 1; }`
     - `ManageTemplateRequest { common.v1.TemplateOperation operation = 1; SourceTemplate template = 2; }`
       returns `SourceTemplate`.
     - `InstantiateTemplateRequest { string template_id = 1; string slug = 2; string credentials_ref = 3; }`
       returns `SignalSource`.
4. **`analysis.proto`.**
   - Add `xstockstrat.common.v1.TemplateOrigin origin = 16;` to `StrategyDefinition`.
   - Add `xstockstrat.common.v1.TemplateOrigin origin = 8;` to `StrategyScore`.
   - Add `string owner_user_id = 2;` (admin-only) to `GetStrategyRequest`.
   - Add `string owner_user_id = 4;` (admin-only) to `ListStrategyDefinitionsRequest`, with the doc
     comment "(admin-only) owner selector; ignored for a non-admin caller".
   - Add the RPCs `ListTemplates`, `ManageTemplate` and `InstantiateTemplate`:
     - `StrategyTemplate { common.v1.TemplateMeta meta = 1; StrategyDefinition payload = 2; }`.
       In the payload, each component's `formula_id` holds a formula **template** id (FR-9).
     - `ListTemplatesRequest {}` / `ListTemplatesResponse { repeated StrategyTemplate templates = 1; }`
     - `ManageTemplateRequest { common.v1.TemplateOperation operation = 1; StrategyTemplate template = 2; }`
       returns `StrategyTemplate`.
     - `InstantiateTemplateRequest { string template_id = 1; string strategy_id = 2; }` returns
       `StrategyDefinition`.
5. **`config.proto`.**
   - Add `string user_id = 4;` to `GetSecretRequest`, with the comment "exact scope: empty = global row
     only".
   - Rewrite the `SetConfigRequest.user_id` comment (`:132-133`): "Secret keys may be per-user (feature
     224 operator override of feature 147); redaction holds on every edge."

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/private-by-default-templates"
```

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (generated)

  A generated-code directory as the Files entry is the accepted convention for a proto-gen step: the
  exact file set is whatever `./scripts/buf-gen.sh` emits, and CI `proto-freshness` checks it.

**Reviewers**: Inherited from Step 1.

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: run `./scripts/buf-gen.sh` after any `.proto` change. CI
  `proto-freshness` enforces this (`.github/workflows/ci.yml:128`).

**TDD**: N/A (generated code)

**Covers**: —

**Instructions**: Run `./scripts/buf-gen.sh` and commit the regenerated `packages/proto/gen/` tree.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head
# Re-running produces no further diff:
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen
```

---

### Step 3 — service: migration tooling (`-- requires-env` render, contract gate, rerun CI)

**Status**: `done`
**Service**: `scripts/` + `.github/workflows/`
**Files**:
- `scripts/render-migrations.sh` — create
- `scripts/check-migration-contract.sh` — create
- `scripts/migration-rerun.sh` — create
- `scripts/db-migrate.sh` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**:
- DBA: run-order compliance with `scripts/db-migrate.sh`; up+down pair.
- Platform Lead: cross-service tooling.

**Codebase Evidence**:
- `scripts/db-migrate.sh:66-71`: the dirty-state recovery forces version 0 and re-runs from 001. This
  is why up-files must be idempotent (design §1).
- `scripts/db-migrate.sh:72-89` holds the analysis-only `envsubst '$SEED_USER_ID'` branch for
  `013_strategies_user_id.up.sql`. It stays: editing applied 013 would breach F-01.
- `SEED_USER_ID` is already wired at all three run sites:
  - `docker-compose.yml:103` (`${SEED_USER_ID:-80880990-…}`)
  - `.do/app.yaml:678` and `.do/app.dev.yaml:680`
  - `.env.example:27` and `scripts/setup-env.sh:152`
- CI job list `.github/workflows/ci.yml`:
  - `changes:14`, with the `scripts` filter (`scripts/**`) at `:67-68`
  - the workflow runs on both `pull_request` and `push` (`:3-5`); `github.base_ref` is empty on
    `push`, so a base-ref job must be PR-only (precedent: `proto-lint`'s
    `github.event_name = "pull_request"` branch at `:112`)
  - `shell-lint:594-611`, which runs `shellcheck scripts/*.sh` and `shfmt -d -i 2`
  - `ci-gate:692-731`, whose `needs:` list must include the new jobs
- No migration CI job exists (grep `migration` in `ci.yml` → none).
- Structural shell-test precedent: `scripts/gen-dev-certs.test.sh:1-12`.

**TDD**: `red-green required` (Step 4's tests fail before these scripts exist)

**Covers**: —

**Instructions**:
1. **Create `scripts/render-migrations.sh <src_dir> <dst_dir>`** (bash 3.2-compatible,
   `#!/usr/bin/env bash`).
   - Copy every `*.sql` from `src_dir` into `dst_dir`.
   - For each `*.up.sql` whose first 5 lines contain `-- requires-env: <VAR>[,<VAR>…]`, require every
     named var to be non-empty (exit 1 naming the var and file).
   - Render with `envsubst` using the single-variable allowlist form (`'$VAR'`), never bare envsubst.
     This is the same safety the 013 branch documents at `db-migrate.sh:72-87`.
2. **Wire it into `scripts/db-migrate.sh`'s `up` case** after the existing analysis-013 branch.
   - `scratch="$(mktemp -d)"; scripts/render-migrations.sh "$dir" "$scratch"; dir="$scratch"`.
   - When the 013 branch already produced a scratch dir, render from it instead.
   - Keep the existing 013 branch byte-identical.
3. **Create `scripts/check-migration-contract.sh <base_ref>`.**
   - For every migration `*.up.sql` added in `git diff --name-only --diff-filter=A <base_ref>...HEAD`
     whose header contains `-- contract-of: <path>`, assert `<path>` exists on `origin/main`
     (`git cat-file -e origin/main:<path>`) and is **not** in this PR's added-file set.
   - Exit 1 with the offending pair otherwise.
4. **Create `scripts/migration-rerun.sh`** (CI-only, takes `DATABASE_URL` and `SEED_USER_ID`).
   1. Run `scripts/db-migrate.sh up`.
   2. Force every service to version 0 and run `db-migrate.sh up` again (the dirty-recovery replay).
   3. Run each `scripts/migration-assertions/*.sql` with `psql -v ON_ERROR_STOP=1` (the directory is
      populated by Step 33; skip when empty).
   4. Assert `SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%_n1_owner_fill%'` is unchanged
      between the two passes.
5. **`.github/workflows/ci.yml`.**
   - Add a `migrations` paths filter: `services/*/migrations/**`, `scripts/db-migrate.sh`,
     `scripts/render-migrations.sh`, `scripts/migration-rerun.sh`, `scripts/migration-assertions/**`.
   - Add a `migration-rerun` job, gated on `migrations` or `ci`. It uses a
     `timescale/timescaledb:latest-pg16` service container, builds `scripts/Dockerfile.migrate` (for
     `migrate` + `psql` + `envsubst`), and runs `scripts/migration-rerun.sh` with a fixed CI
     `SEED_USER_ID`.
   - Add a `migration-contract-gate` job: `if: github.event_name == 'pull_request'` (plus the
     `migrations` filter), `fetch-depth: 0`, runs `scripts/check-migration-contract.sh
     origin/${{ github.base_ref }}`. It never runs on `push`, where `github.base_ref` is empty.
   - Add both jobs to `ci-gate.needs` and its echo list. `ci-gate` must treat a `skipped`
     `migration-contract-gate` (every `push` run) as passing, the same as other path-skipped jobs.

**Verification**:
```bash
shellcheck scripts/render-migrations.sh scripts/check-migration-contract.sh scripts/migration-rerun.sh scripts/db-migrate.sh
shfmt -d -i 2 scripts/render-migrations.sh scripts/check-migration-contract.sh scripts/migration-rerun.sh scripts/db-migrate.sh
grep -n "migration-rerun\|migration-contract-gate" .github/workflows/ci.yml
grep -n -A3 "migration-contract-gate:" .github/workflows/ci.yml | grep "pull_request"   # PR-only
```

---

### Step 4 — test: migration tooling structural tests

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/render-migrations.test.sh` — create
- `scripts/check-migration-contract.test.sh` — create
- `.github/workflows/ci.yml` — modify (run both tests in `shell-lint`)

**Reviewers**:
- DBA: run-order compliance.
- Platform Lead.

**Codebase Evidence**: `scripts/gen-dev-certs.test.sh:5-12`, structural assertions with a `fail()`
helper and `set -uo pipefail`.

**TDD**: `red-green required`

**Covers**: — (tooling; enables the AC-15/AC-22/AC-27 assertions of Step 33)

**Instructions**:
1. **`render-migrations.test.sh`.** Using a `mktemp -d` fixture dir, assert:
   - (a) a file with `-- requires-env: SEED_USER_ID` and `SEED_USER_ID` unset exits non-zero;
   - (b) with it set, `${SEED_USER_ID}` is rendered while a `$$ … $$` block and a `$1` placeholder are
     untouched;
   - (c) a file with no header is copied byte-identical;
   - (d) every `.down.sql` is copied.
2. **`check-migration-contract.test.sh`.** In a throwaway `git init` repo with a fake `origin/main`
   ref, assert:
   - (a) a `-- contract-of:` file whose expand file is on `origin/main` passes;
   - (b) one whose expand file is added in the same diff fails;
   - (c) one naming a missing file fails.
3. Add `bash scripts/render-migrations.test.sh && bash scripts/check-migration-contract.test.sh` as a
   step in the `shell-lint` job.

**Verification**:
```bash
bash scripts/render-migrations.test.sh && bash scripts/check-migration-contract.test.sh
shellcheck scripts/render-migrations.test.sh scripts/check-migration-contract.test.sh
```

Coverage: N/A — no coverage tool for shell; the behavior gate is `render-migrations.test.sh` and
`check-migration-contract.test.sh` (run in the `shell-lint` job).

---

### Step 5 — test: peer-SAN spike (grpc.aio `peer_identities()` and grpc-js `getAuthContext()`)

**Status**: `done`
**Service**: `xstockstrat-ingest` + `xstockstrat-config`
**Files**:
- `services/xstockstrat-ingest/tests/test_peer_identity_spike.py` — create
- `services/xstockstrat-config/src/__tests__/peerSanSpike.test.ts` — create

**Reviewers**:
- `xstockstrat-ingest` owner.
- `xstockstrat-config` owner.
- Security: SAN-bound internal-caller identity.

**Codebase Evidence**:
- Ingest mTLS harness `tests/test_mtls.py`:
  - `_leaf(tmp, name, ca, cakey)` writes `subjectAltName=DNS:{name}` (`:27-29`);
  - module `pki` fixture `:64-112`;
  - in-process `_serve(pki, monkeypatch)` with a generic echo handler capturing
    `context.invocation_metadata()` (`:122-140`);
  - `_call(...)` dials with `mtls.target_override(target)` (`:143-157`).
- grpcio is pinned `>=1.80.0` (`services/xstockstrat-indicators/pyproject.toml:6`; design: all three
  Python services pin 1.80.0).
- Config grpc-js harness: `src/__tests__/mtls.test.ts:35-57` (`mintLeaf` with SAN, `mintPki`); run by
  `node --test` over compiled JS (`package.json:13`).
- `@grpc/grpc-js` is `^1.14.5` (`package.json:21`).

**TDD**: N/A (spike: proves a third-party API's behaviour on the real mTLS harness and gates
Steps 14/19/21; there is no in-repo implementation to drive red)

**Covers**: — (infrastructure gate for AC-33/AC-35; no `@AC` asserts library behaviour)

**Instructions**:
1. **Ingest spike.**
   - Mint an extra leaf with `_leaf(tmp, "xstockstrat-analysis", ca, cakey)`.
   - Start a server whose handler captures `context.peer_identity_key()` and
     `list(context.peer_identities() or [])`.
   - Call it with the analysis leaf. Assert the key is `"x509_subject_alternative_name"` and that
     `b"xstockstrat-analysis"` is in the identities (exact element, not substring).
   - Call with the `xstockstrat-client` leaf and assert `b"xstockstrat-analysis"` is absent.
2. **Config spike.**
   - In the `mtls.test.ts` style, mint a `xstockstrat-ingest` client leaf.
   - In the server handler, read `call.getAuthContext()` and assert its `sslPeerCertificate`'s
     `subjectaltname` parses (comma list, `DNS:` prefix) to contain exactly `xstockstrat-ingest`.
3. If either spike fails, stop. Record the failure in the Deviation Log and switch Steps 14/19/21 to
   the design fallback (cert parsing from `auth_context()`) before continuing.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
```

Coverage: the ingest spike runs inside the full ingest suite at the service's `--cov-fail-under=40`
threshold (the CI `python-test` value); config runs `test:coverage` (`c8 --lines 40`).

---

### Step 6 — migration: analysis `026_owner_dimension_templates`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql` — create
- `services/xstockstrat-analysis/migrations/026_owner_dimension_templates.down.sql` — create

**Reviewers**:
- DBA: NNN numbering, up+down pair, index correctness, run-order.
- `xstockstrat-analysis` owner: backtest reproducibility, scoring determinism.

**Codebase Evidence**:
- Last file is `025_opportunity_symbol_score.{up,down}.sql`. No remote branch carries an analysis
  migration above 025: `git ls-tree` across `origin/{feature,claude,main-dev,ccr}*` returned max
  `025` (2026-10-07).
- `strategy_scores` PK `strategy_id` (`005_*.up.sql:2`). The provenance columns `n_symbols`,
  `total_trading_days`, `provisional` were added at `007_*.up.sql` (end).
- `backtest_run_symbols` PK `(backtest_id, symbol)`, eligibility index `idx_brs_eligibility`
  (`007_*.up.sql:8-29`).
- `backtest_details` PK `backtest_id` FK → `backtest_runs`; index
  `idx_backtest_details_strategy_completed` (`008_*.up.sql:7-16`).
- `backtest_runs.user_id` nullable, backfilled only by a strategy_id join (`015_*.up.sql`).
- `strategies` PK `(user_id, strategy_id)`. The seed guard pattern
  `seed TEXT := '${SEED_USER_ID}'` / `LIKE '%$' || '{%'` is at `013_strategies_user_id.up.sql:11-27`.
- The 013 guard is conditional (`IF missing > 0`); design §1 requires an **unconditional** one here.

**TDD**: N/A (migration)

**Covers**: —

**Instructions**: `026_owner_dimension_templates.up.sql` must be idempotent on both the expanded and
the contracted schema (`IF NOT EXISTS`, and `to_regclass(...) IS NOT NULL` guards around every
read of a table the follow-up may drop).

1. Line 1: `-- requires-env: SEED_USER_ID`.
2. Add an **unconditional** guard: a `DO $$` block that `RAISE EXCEPTION`s when
   `'${SEED_USER_ID}'` is empty or still matches `'%$' || '{%'`.
3. **D-1 backfill.** `UPDATE analysis.backtest_runs r SET user_id = <unique owner> WHERE user_id IS
   NULL`. The unique owner is
   `(SELECT min(s.user_id) FROM analysis.strategies s WHERE s.strategy_id = r.strategy_id HAVING count(DISTINCT s.user_id) = 1)`.
   Then `UPDATE … SET user_id = '${SEED_USER_ID}' WHERE user_id IS NULL`. Leave the column nullable
   (NOT NULL is deferred to the follow-up).
4. **Evidence and detail owners.**
   - `ALTER TABLE analysis.backtest_run_symbols ADD COLUMN IF NOT EXISTS user_id TEXT;`, backfilled from
     `backtest_runs` by `backtest_id`.
   - The same for `analysis.backtest_details`.
   - `CREATE INDEX IF NOT EXISTS idx_brs_owner_eligibility ON analysis.backtest_run_symbols (user_id, strategy_id, definition_fingerprint, symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC);`
   - `CREATE INDEX IF NOT EXISTS idx_backtest_details_owner_strategy_completed ON analysis.backtest_details (user_id, strategy_id, completed_at DESC);`
5. **`strategy_scores_v2`.**
   - Columns are the same as `strategy_scores` plus `user_id TEXT NOT NULL`, with
     `PRIMARY KEY (user_id, strategy_id)`.
   - Seed with explicit column lists on **both** sides (never `sc.*`, which breaks if either table
     gains a column):
     `INSERT INTO analysis.strategy_scores_v2 (user_id, strategy_id, overall_score, rating, component_scores, n_symbols, total_trading_days, provisional, created_at, updated_at) SELECT s.user_id, sc.strategy_id, sc.overall_score, sc.rating, sc.component_scores, sc.n_symbols, sc.total_trading_days, sc.provisional, sc.created_at, sc.updated_at FROM analysis.strategy_scores sc JOIN analysis.strategies s USING (strategy_id) WHERE sc.strategy_id IN (SELECT strategy_id FROM analysis.strategies GROUP BY strategy_id HAVING count(*) = 1) ON CONFLICT DO NOTHING`.
     The column set is `005_strategy_scores.up.sql:1-8` plus `007_backtest_run_symbols.up.sql:37-40`.
   - Guard the seed with `to_regclass('analysis.strategy_scores') IS NOT NULL`.
   - Ambiguous ids are recomputed at boot (Step 9).
6. **Strategy origin.** `ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS origin_template_id TEXT, ADD COLUMN IF NOT EXISTS origin_template_version INTEGER;`
7. **`analysis.strategy_templates`.**
   - Columns: `template_id TEXT PK`, `name TEXT NOT NULL`, `description TEXT NOT NULL DEFAULT ''`,
     `payload JSONB NOT NULL`, `version INTEGER NOT NULL DEFAULT 1`, `retired_at TIMESTAMPTZ`,
     `created_by TEXT NOT NULL`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
   - **No seed rows** (AC-15).
8. **`analysis.template_intents`.**
   - Columns: `intent_id UUID PK`, `user_id TEXT NOT NULL`, `template_id TEXT NOT NULL`,
     `template_version INTEGER NOT NULL`, `strategy_id TEXT NOT NULL`, `state TEXT NOT NULL` with
     `CHECK (state IN ('PENDING','COMMITTED','FINALIZED','ABORTING','ABORTED'))`,
     `formula_ids JSONB NOT NULL DEFAULT '{}'`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
   - Index `(state, updated_at)`.

`026_owner_dimension_templates.down.sql`:
- Drop `template_intents`, `strategy_templates` and `strategy_scores_v2`.
- Drop the two new indexes, the strategy origin columns, and `user_id` from `backtest_details` and
  `backtest_run_symbols`.
- Do **not** null out `backtest_runs.user_id`; the backfill is additive and harmless to N-1.

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/026_*.up.sql services/xstockstrat-analysis/migrations/026_*.down.sql
head -1 services/xstockstrat-analysis/migrations/026_*.up.sql   # -- requires-env: SEED_USER_ID
# Read both files: every CREATE/ADD in .up has an inverse DROP in .down; every read of a droppable table is to_regclass-guarded.
```

---

### Step 7 — service: analysis identity threading and fundsignal `system` identity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism,
no look-ahead bias.

**Codebase Evidence**:
- **Live-loop evaluator.**
  - Built with empty metadata: `main.py:148` `StrategyEvaluator(servicer._indicators, ())`.
  - Stored at `live_loop.py:275`, used at `:565` (`_replay_state`) and `:660,:665` (`_eval_pair`).
  - The evaluator holds `self._meta = propagation_meta` (`evaluator.py:199-213`).
- **Headerless ingest calls in the live loop.**
  - `live_loop.py:157` `ingest.QuerySignals(...)` with no metadata, in `resolve_fundamentals_universe`
    (`:137-179`).
  - `live_loop.py:457` `_drain_signals` (`:444-472`), no metadata.
  - Called once per cycle at `:352` and per owner via `entry_backfill.py:96`.
- **Owner availability.** The owner is available per row at `live_loop.py:365`
  (`owner = definition.user_id`) and `entry_backfill.py:102`.
- **pnl consumer.**
  - The composer methods take `meta=()`: `ohlcv_and_closes:67`, `indicators:89` (ComputeIndicator
    `:96-101`), `signals:107` (QuerySignals `:109-111`).
  - `_compose(symbol, strategy_id)` at `:357` is called only at `:200`, where the owner is `user_id`
    (`:188`).
- **Fundsignal.**
  - `run_once(..., metadata=())` at `:159`; `_score(fetched, metadata)` at `:202`;
    `_ensure_source_registered(source_slug, metadata)` at `:209`; `_emit_signal(..., metadata)` at
    `:232`.
  - Admin-bit injection at `:446-448`.
  - `_source_registered` is a bool (`:83`, `:444`), while the slug is re-read per cycle (`:161`).
  - `_score_via_formula` falls back to `_builtin_score` per symbol (`:417-419`).
  - `_emit_warning(msg)` is hardcoded `ALERT_SEVERITY_WARNING` (`:547-553`).
  - Portfolio grant precedent: `meta = list(metadata) + [("x-internal-caller", "analysis-fundsignal")]`
    (`:289`).
  - `score_fundamentals` → `ExecuteFormula(..., metadata=metadata)` (`fundamentals_scoring.py:52-58`).
- **Manual path.** `RunFundamentalsScan` forwards the caller's trio as `metadata` (`servicer.py:3059-3084`).
- **Inbound identity.** `_caller_user_id(context)` returns the raw `x-user-id` header
  (`servicer.py:530-539`).
- **Already-headered RPC paths (verify only).**
  - `_drain_active_signals` `:5262-5286` and `_drain_source_weights` `:5288-5300` take
    `propagation_meta`.
  - `_resolve_source_names` `:3535`.
  - `GetStrategyAnalytics` QuerySignals `:5386-5391`.
  - `screener.py:320,342,293,359` (all `metadata=propagation_meta`).
  - Readiness materializer `meta = [("x-user-id", owner)]` (`servicer.py:5062`); opportunity refresh
    `:5013`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Per-owner evaluator (`evaluator.py`).** Add
   `def for_owner(self, owner: str) -> "StrategyEvaluator"`. It returns
   `StrategyEvaluator(self._indicators, [("x-user-id", owner)] if owner else (), self._component_sem)`,
   plus any constructor flags added in Step 11. The evaluator is stateless per call (recon), so a clone
   per pair is safe.
2. **`live_loop.py`.**
   - In `_eval_pair` and `_replay_state`, replace `self._evaluator` with
     `self._evaluator.for_owner(definition.user_id)`.
   - Split `_drain_signals` into `_drain_signals_with(meta, scope)` with the same pagination body.
     `_drain_system_signals()` passes `meta=[("x-user-id","system"),("x-internal-caller","analysis-system-read")]`
     and `scope=SIGNAL_SCOPE_SYSTEM`. `_drain_owner_signals(owner)` passes
     `meta=[("x-user-id", owner)]` and `scope=SIGNAL_SCOPE_OWN`.
   - In the cycle (`:352`), drain system signals once per cycle and own signals per owner, memoized
     like `held_cache`. Pass `own ∪ system` to `resolve_universe`.
   - In `resolve_fundamentals_universe` (`:157`), send `scope=SIGNAL_SCOPE_SYSTEM` with the same system
     read metadata.
3. **`entry_backfill.py:96`.** Mirror the per-owner own-signal memo plus the single system drain.
4. **`pnl_pattern_consumer.py`.** `_compose(symbol, strategy_id, owner)` builds
   `meta = [("x-user-id", owner)] if owner else ()` and passes it to all three composer calls. Update
   the caller at `:200` to pass `user_id`.
5. **`fundsignal_loop.py`.**
   - At the top of `run_once`, build `sys_meta`: the trace header only (`[(k, v) for k, v in metadata if k == "x-trace-id"]`)
     plus `("x-user-id", "system")` and `("x-internal-caller", "analysis-fundsignal")`. Use `sys_meta`
     for `_score`, `_ensure_source_registered` and `_emit_signal`. Keep `metadata` for `_paced_fetch`
     (marketdata) and `_resolve_universe` (portfolio).
   - Delete the admin-bit injection (`:446-448`).
   - Replace `_source_registered: bool` with `_registered_slug: str | None`; it is re-registered when
     the configured slug changes.
   - **Pre-flight (AC-37).** When `analysis.fundsignal.scoring_formula_id` is non-empty, before
     `_paced_fetch`, call `GetFormula(formula_id, metadata=sys_meta)`. On any error, or
     `author != "system"`, `log.error`, call `_emit_warning(msg, severity=ALERT_SEVERITY_ERROR)`, and
     `_finish(run_id, status="failed", symbols_done=0, calls_spent=0, deferred=0)`. Return without
     ingesting.
   - An empty id keeps `_builtin_score`.
   - Delete the per-symbol `_builtin_score` fallback in `_score_via_formula` (`:417-419`): a formula
     failure skips that symbol. This is the deliberate C-18 removal (design §3).
   - `_emit_warning(msg, severity=ALERT_SEVERITY_WARNING)` gains the severity parameter.
   - A `ManageSignalSource` REGISTER `FAILED_PRECONDITION` (a user holds the slug, AC-36), or an
     `IngestSignal` `NOT_FOUND` while acting as `system`, aborts the cycle. It emits an ERROR alert
     naming the slug and finishes `status="failed"`.
6. **`servicer.py`.**
   - `_caller_user_id` returns `""` when the header equals `"system"`, so an inbound `system` owns
     nothing (design "reserved `system` identity"). Leave the already-headered paths unchanged.
   - **Deliberate, documented divergence from design §2.** Design §2 says an un-granted
     `x-user-id: system` gets `PERMISSION_DENIED` in analysis too. Analysis has no inbound
     `x-internal-caller` grant to check, so here it resolves to owner `""` instead: it owns nothing, so
     reads return empty, and writes get `PERMISSION_DENIED` from the existing `if not caller_user_id`
     guard (e.g. `ManageStrategy`, `servicer.py:2675-2677`). The same note is in `design.md` §2.
   - **Attribution filter (elaboration 7).** In `GetAttribution`, restrict
     `surviving = [s for s in trade_count if not source_filter or s == source_filter]` (`:3606-3607`)
     to slugs present in `_resolve_source_names(propagation_meta)` (`:3535-3547`), the caller-visible
     own + system set.
7. **`main.py`.** Keep `StrategyEvaluator(servicer._indicators, ())` as the template; the live loop
   now calls `for_owner`. The `InternalCallerInterceptor` stays until Step 16.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "for_owner\|SIGNAL_SCOPE_SYSTEM\|SIGNAL_SCOPE_OWN" app/engine/live_loop.py app/engine/entry_backfill.py
grep -n "analysis-fundsignal\|x-access-scope" app/engine/fundsignal_loop.py   # no x-access-scope injection remains
```

---

### Step 8 — test: analysis threading, fundsignal identity, runtime header guard

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (add shared `ctx_with(headers)` and
  `RecordingStub` helpers)
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — create
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` — modify
- `services/xstockstrat-analysis/tests/test_get_attribution.py` — modify

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**:
- `tests/conftest.py:11` holds only `_setup_gen_path`. A `_ctx` helper is duplicated inline in
  `test_analysis_servicer.py:3942` and `test_get_attribution.py:55`, so a third consumer forces
  centralization (C-13).
- Existing suites: `tests/test_fundsignal_loop.py`, `tests/test_live_loop.py`,
  `tests/test_pnl_pattern_consumer.py`, `tests/test_entry_backfill.py`.
- Ledger fails.md 2026-10-06 private-by-default-templates: enforce the header with a **runtime
  client-interceptor test**, not an AST `metadata=` check.

**TDD**: `red-green required`

**Covers**: AC-6, AC-11, AC-12, AC-26, AC-29, AC-36, AC-37

**Instructions**:
1. **`conftest.py`.**
   - Add `ctx_with(headers: list[tuple[str, str]])`, which returns a MagicMock context whose
     `invocation_metadata` returns `headers` and whose `abort` raises.
   - Add `RecordingStub`, a fake stub whose every attribute is an `AsyncMock` recording `(method,
     request, metadata)`.
2. **`test_owner_header_guard.py` (the CI guard).**
   - Drive every enumerated path with `RecordingStub` ingest and indicators stubs:
     - live-loop cycle (system drain and owner drain);
     - `resolve_fundamentals_universe`;
     - `entry_backfill.run_once`;
     - pnl `_handle_order_event`;
     - fundsignal `run_once` (loop path and `RunFundamentalsScan`);
     - `ListOpportunities`, `GetAttribution`, `GetStrategyAnalytics`, `ScreenSymbols`;
     - readiness materializer;
     - write-time `_fetch_formula_outputs` / `_deleted_formula_warnings`;
     - backtest `_declared_formula_warmup` / `_formula_fundamentals`.
   - Assert that **every** recorded ingest and indicators call carries exactly one non-empty
     `x-user-id`.
3. **Fundsignal.**
   - **AC-6:** `IngestSignal`, `ManageSignalSource` and `ExecuteFormula` carry
     `x-user-id: system` + `x-internal-caller: analysis-fundsignal` and no `x-access-scope`, on both
     the loop and the manual path. The trace header is kept.
   - **AC-37:** with `scoring_formula_id="f-alice-score"` and a GetFormula returning
     `author="alice"`, assert:
     - zero `IngestSignal` calls;
     - zero `fundsignal_emitted` INSERTs;
     - one `EmitAlert` with `ALERT_SEVERITY_ERROR`;
     - status `failed`;
     - `_builtin_score` not invoked.
   - **AC-37 (manual path):** the same non-system `scoring_formula_id`, driven through
     `RunFundamentalsScan` (`servicer.py:3059`, which forwards the caller's trio into `run_once`) with an
     admin caller. Assert the same outcome: zero `IngestSignal` calls, one `ALERT_SEVERITY_ERROR`
     `EmitAlert`, a `failed` run, and the pre-flight `GetFormula` sent with `x-user-id: system` (not the
     admin caller's id).
   - **AC-36 (analysis half):** REGISTER raises `FAILED_PRECONDITION` → no emit, and an ERROR alert
     whose body contains `macro-feed`.
4. **Live loop.**
   - **AC-11:** bob's own drain returns no TSLA and the system drain returns none → no TSLA pair.
   - **AC-26:** the system drain returns MSFT → it joins bob's `signal_eligible` universe.
5. **AC-12 / AC-29 (analysis half).**
   - `GetAttribution` and `ScreenSymbols` forward bob's header (assert recorded metadata).
   - In `tests/test_get_attribution.py`: `GetAttribution(source_id="alice-feed")` as bob → 0 attributed
     when `alice-feed` is not in bob's visible source set, even if a legacy `order_snapshots.signals`
     row carries it.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
grep -n "from .conftest\|ctx_with\|RecordingStub" tests/test_owner_header_guard.py   # C-13 centralized
```

---

### Step 9 — service: analysis owner dimension, `GetBacktest` ownership, strategy admin read

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategy_scores.py` — modify (target `strategy_scores_v2`)
- `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_details.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_runs.py` — modify
- `services/xstockstrat-analysis/app/admin_audit.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, backtest reproducibility.

**Codebase Evidence**:
- **Scores repo.** `StrategyScoresRepository.upsert` targets `analysis.strategy_scores ON CONFLICT
  (strategy_id)` (`strategy_scores.py:32-65`); `delete` (`:67-77`) and `get_by_id` use the bare id.
- **Evidence and detail repos.**
  - `BacktestRunSymbolsRepository._COLUMNS` (`backtest_run_symbols.py:24-37`), `insert_many`
    (`:42-60`), and `fetch_eligible WHERE strategy_id = $1 AND definition_fingerprint = $2`
    (`:62-79`).
  - `backtest_details.py:24-59`: `insert` with retention `DELETE … WHERE strategy_id = $1` at `:48-52`.
- **Runs repo.** `backtest_runs.py:25-78` `insert(..., user_id=None)` and `list_by_strategy` with a
  bare `WHERE strategy_id = $1` (`:80-84`).
- **In-memory maps.**
  - `self._backtests` and `self._strategies` (`servicer.py:420-421`); `_recompute_locks` (`:508`).
  - `_lock_for(strategy_id)` (`:2352-2358`).
  - `_recompute_headline(user_id, strategy_id)` (`:2411-2427`, locks on the bare id);
    `_fetch_and_aggregate` → `fetch_eligible(strategy_id, fingerprint)` (`:2398-2409`).
  - The score write `self._strategies[score.strategy_id] = score` + upsert (`:2335-2350`).
  - `hydrate_scores` (`:2558-2569`).
  - `ListStrategies` filters bare keys against owned ids (`:2571-2581`).
  - `GetStrategyReport` reads `self._strategies`/`self._backtests` by bare id (`:2583-2610`).
  - `self._backtests[request.strategy_id] = result` (`:1076`).
- **Persist paths.** `_persist_backtest_run` never passes `user_id` (`:2448-2496`).
  `_persist_backtest_detail` (`:2498-2520`) and `_persist_symbol_cells` (`:2522-2556`) carry no owner.
- **Run reads.** `ListBacktests` → `list_by_strategy(request.strategy_id)` (`:2638`). `GetBacktest` has
  no ownership check (`:2644-2669`). `GetStrategyAnalytics` → `list_by_strategy` (`:5374`).
- **Strategy reads.**
  - `GetStrategy` is owner-only via `get_by_owner_and_id` (`:2875-2904`).
  - `ListStrategyDefinitions` (`:2906`).
  - `_has_admin_scope` (`:514`); analysis already holds `self._ledger` (`:407`).
- **Precedents.** Dual-stream audit: identity `ledgerAudit.ts:44-56` (`streamKey: user:${targetUserId}`).
  `AppendEventRequest.user_id = 9` (`ledger.proto`).
- `main.py:132` `await servicer.hydrate_scores()`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repos.**
   - Scores repo targets `analysis.strategy_scores_v2` with `user_id` first on every method
     (`ON CONFLICT (user_id, strategy_id)`).
   - `insert_many` adds `user_id` to `_COLUMNS`. `fetch_eligible(user_id, strategy_id, fingerprint)`
     adds `AND user_id = $3`.
   - `backtest_details.insert(..., user_id)` writes `user_id`, and its retention `DELETE` adds
     `AND user_id = $N`. `get(backtest_id)` returns `(result_pb, user_id)`.
   - `backtest_runs.list_by_strategy(user_id, strategy_id, limit)` adds `AND user_id = $N`.
2. **Re-key in-memory state** to `(user_id, strategy_id)`: `_strategies`, `_backtests` (strategy-keyed
   entry; the backtest-id-keyed entry is unchanged), `_recompute_locks` and `_lock_for`. Thread
   `user_id` through `_recompute_headline_locked`, `_fetch_and_aggregate` and the score write.
   - `ScoreStrategy` (`:2246`) uses the caller's id.
   - `hydrate_scores` loads v2 rows keyed `(user_id, strategy_id)`.
   - `ListStrategies` filters on the owner key.
   - `GetStrategyReport` reads by owner key.
3. **Boot recompute of ambiguous ids.** After `hydrate_scores`, select `(user_id, strategy_id)` pairs
   in `analysis.strategies` that have no v2 row. Recompute at most `_BOOT_RECOMPUTE_MAX_PAIRS = 50` per
   pass, with a comment giving the rationale (operator round-5 invariant cap; bounds boot latency
   against the pooled DB). Call it from `main.py` after `hydrate_scores`, best-effort.
4. **Persist with owner.** `RunBacktest` passes the caller's owner into `_persist_backtest_run(...,
   user_id=)`, `_persist_backtest_detail` and `_persist_symbol_cells`.
5. **Run reads.**
   - `GetBacktest`: a row whose `user_id` ≠ caller → `PERMISSION_DENIED`, the same code as
     `ListBacktests` (AC-21). Admin foreign reads follow item 6.
   - `ListBacktests` and `GetStrategyAnalytics` call the owner-scoped `list_by_strategy`.
6. **FR-13 admin read.**
   - Create `app/admin_audit.py` with `async def audit_admin_read(ledger_stub, admin_id, object_kind,
     ids_by_owner: dict[str, list[str]], trace_meta)`.
   - It appends one `audit.admin_read` event on stream `user:<admin>` carrying all foreign ids, plus one
     per distinct foreign owner on `user:<owner>`. Use `AppendEventRequest.user_id`, concurrency bounded
     by `_AUDIT_APPEND_CONCURRENCY = 4`, and a per-page K ceiling `_AUDIT_MAX_OWNERS_PER_PAGE` equal to
     the max page size. Rationale comments follow the operator round-5 ruling.
   - It raises on any append failure.
   - Every ledger `AppendEvent` it sends forwards the inbound `x-user-id`/`x-access-scope`/`x-trace-id`
     trio as gRPC metadata (C-03). `audit_admin_read` itself filters `trace_meta` (the inbound
     metadata) to those three names, the same filter as `_validate_definition_proto`'s
     `propagation_meta` (`servicer.py:605-611`).
   - `GetStrategy`/`ListStrategyDefinitions`: when `owner_user_id` is non-empty, differs from the
     caller, and the caller is admin, read that owner's rows and call `audit_admin_read`. An audit
     failure → `UNAVAILABLE`. A non-admin's `owner_user_id` is ignored.
   - Admin mutation paths are unchanged (already owner-only).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "strategy_scores_v2\|user_id = \$" app/repositories/strategy_scores.py app/repositories/backtest_run_symbols.py app/repositories/backtest_details.py app/repositories/backtest_runs.py
grep -n "x-user-id\|x-access-scope\|x-trace-id" app/admin_audit.py   # trio forwarded (C-03)
```

---

### Step 10 — test: owner-keyed analysis state and strategy admin read

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_owner_dimension.py` — create
- `services/xstockstrat-analysis/tests/test_strategy_scores_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_backtest_run_symbols_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_backtest_details_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_backtest_runs_repo.py` — modify

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**: The repo test files exist (listed at `tests/`). `ctx_with` comes from Step 8's
`conftest.py`.

**TDD**: `red-green required`

**Covers**: AC-21, AC-28

**Instructions**:
1. **AC-21.** alice and bob both own `mean_reversion`; complete a backtest for alice. Assert:
   - bob's `ListStrategies` score is unchanged;
   - bob's `ListBacktests("mean_reversion")` is empty;
   - bob's `GetBacktest(alice_backtest_id)` → `PERMISSION_DENIED`;
   - the retention DELETE SQL includes the owner predicate (mock-call assertion);
   - `fetch_eligible` SQL includes `user_id`.
2. **AC-28 (strategy half).** An admin `GetStrategy(owner_user_id="alice")` returns alice's
   definition, and `ledger.AppendEvent` is called twice (streams `user:admin` and `user:alice`). An
   audit failure → `UNAVAILABLE`. A non-admin `owner_user_id` is ignored.
3. Boot recompute: ambiguous pairs beyond 50 are deferred to the next pass.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
grep -n "ctx_with\|conftest" tests/test_owner_dimension.py
```

---

### Step 11 — service: evaluator unreadable-formula seam and write/read warnings

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility (unreadable formula →
FORMULA_ERROR, excluded from evidence).

**Codebase Evidence**:
- **Evaluator ExecuteFormula sites.** `_compute_component` `:455-462` and
  `_fundamentals_formula_series` `:528-535`. Neither catches `grpc.RpcError`, so a `NOT_FOUND`
  propagates.
- `FormulaExecutionError(formula_id, error)` (`evaluator.py:101-111`).
- **Backtest catch.** `except FormulaExecutionError` stamps `NO_TRADE_REASON_FORMULA_ERROR` and
  `continue`s, so no evidence cell (`servicer.py:934-947`). Backtest evaluator site: `:1788`.
- **Other evaluator surfaces.** `EvaluateReadiness :3124`, `GetWatchlistReadiness :3427`,
  `GetIndicatorSeries :3666`, opportunity retry `:4075`, ListOpportunities compute `:4647`, readiness
  materializer `:5083`, live loop (Step 7).
- **@feature-185.** A `grpc.RpcError` from indicators marks the candidate `"unavailable"`
  (`servicer.py:4862-4870`, `:4205-4219`).
- **Warnings.**
  - `_fetch_formula_outputs` swallows `AioRpcError` (`:541-563`).
  - `_deleted_formula_warnings` swallows the fetch failure (`:565-589`).
  - `GetStrategy` appends deleted warnings (`:2895-2903`).
  - `_deleted_formula_warning` helper (`:225`).
  - REGISTER returns `_row_to_strategy_definition(row)` (`:2690-2728`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`StrategyEvaluator.__init__`** gains `raise_unreadable: bool = False` (carried by `for_owner`)
   and `self.unreadable_formulas: set[str]`.
2. **Both ExecuteFormula sites.** Catch `grpc.aio.AioRpcError` with code `NOT_FOUND`.
   - If `raise_unreadable`: `raise FormulaExecutionError(comp.formula_id, "not readable by owner")`.
   - Otherwise add the id to `unreadable_formulas` and return `{"value": [None] * n}` (component
     skipped).
   - Never let it reach the `"unavailable"` classification.
3. **`RunBacktest`.** Construct its evaluator (`:1788`) with `raise_unreadable=True`. The existing
   FORMULA_ERROR path then excludes the symbol from `backtest_run_symbols` (ANALYSIS-2/3 invariants).
4. **Other surfaces** (the six above, plus the live loop): after evaluation, `log.warning("formula %s
   not readable by owner", fid)` for each id in `unreadable_formulas`. Do not add `"unavailable"`.
5. **`_deleted_formula_warnings` → `_formula_status_warnings`.** Rename it to cover both cases: a
   `NOT_FOUND` fetch appends `f"formula {formula_id} not readable by owner"`; a `deleted` flag keeps
   today's text. Use it in `GetStrategy` and append its warnings to the REGISTER/UPDATE response
   definitions (AC-30).
   - Order: compute these warnings **before** `_validate_definition_proto` rejects an unknown dotted
     series (design Open Risk, `_formula_outputs` swallow).
   - `_refuse_deleted_bindings` keeps refusing only `deleted` formulas, not unreadable ones (which
     only warn).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "raise_unreadable\|unreadable_formulas\|not readable by owner" app/services/evaluator.py app/handlers/servicer.py
```

---

### Step 12 — test: unreadable formula skipped, warned, and excluded from backtest evidence

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — create

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**: Step 11 citations. `ctx_with`/`RecordingStub` come from `tests/conftest.py`
(Step 8).

**TDD**: `red-green required`

**Covers**: AC-5, AC-30

**Instructions**:
1. **AC-5.** bob's strategy `s-1` references alice's `f-zscore`; the indicators stub raises
   `NOT_FOUND`. Assert:
   - the live-loop evaluation records ExecuteFormula with `x-user-id: bob`;
   - the component series is all-None;
   - no `"unavailable"` provenance;
   - `GetStrategy` as bob has warning `formula f-zscore not readable by owner`.
2. **AC-30.** `ManageStrategy REGISTER` referencing `f-zscore` returns `warnings` containing that text.
3. **ANALYSIS-2/3 / @feature-065.** `RunBacktest` for that strategy yields
   `NO_TRADE_REASON_FORMULA_ERROR` for the symbol, and `backtest_run_symbols.insert_many` is not
   called with that symbol.
4. **@feature-185.** `ListOpportunities` with the NOT_FOUND stub produces no `"unavailable"` row.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 13 — migration: indicators `007_private_formulas_templates`

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/007_private_formulas_templates.up.sql` — create
- `services/xstockstrat-indicators/migrations/007_private_formulas_templates.down.sql` — create

**Reviewers**:
- DBA: NNN numbering, up+down pair, index correctness.
- `xstockstrat-indicators` owner.

**Codebase Evidence**:
- Last migration is `006_add_formula_fundamental_inputs.{up,down}.sql`; no remote branch exceeds 006
  (2026-10-07 `git ls-tree` scan).
- `001_formulas.up.sql:16` `CREATE INDEX ON indicators.formulas (is_public) WHERE is_public = TRUE;`
  is unnamed, so Postgres auto-names it `formulas_is_public_idx`.
- `formula_id UUID PRIMARY KEY` (`001:4`).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**: `007_private_formulas_templates.up.sql`, idempotent:
1. `UPDATE indicators.formulas SET is_public = FALSE WHERE is_public;`. The column is retained but
   unread (AC-22: author and source unchanged; no row deleted).
2. Drop the public partial index by catalog lookup (no literal-name assumption): a `DO $$` block that
   `EXECUTE`s `DROP INDEX IF EXISTS indicators.<indexname>` for each row of
   `pg_indexes WHERE schemaname='indicators' AND tablename='formulas' AND indexdef LIKE '%(is_public)%'`.
3. `ALTER TABLE indicators.formulas ADD COLUMN IF NOT EXISTS origin_template_id TEXT, ADD COLUMN IF NOT EXISTS origin_template_version INTEGER, ADD COLUMN IF NOT EXISTS pending_intent_id UUID;`
4. `CREATE INDEX IF NOT EXISTS idx_formulas_pending_intent ON indicators.formulas (pending_intent_id) WHERE pending_intent_id IS NOT NULL;`
5. `CREATE TABLE IF NOT EXISTS indicators.formula_templates` with the same column set as Step 6's
   `strategy_templates`. **No seed rows** (AC-15).

`007_private_formulas_templates.down.sql`:
- Drop `formula_templates`, `idx_formulas_pending_intent` and the three columns.
- Recreate `CREATE INDEX IF NOT EXISTS formulas_is_public_idx ON indicators.formulas (is_public) WHERE is_public = TRUE;`.
- `is_public` values are not restored (lossy by design; private is the safe direction).

**Verification**:
```bash
ls services/xstockstrat-indicators/migrations/007_*.up.sql services/xstockstrat-indicators/migrations/007_*.down.sql
# Read both: each ADD/CREATE in .up has an inverse in .down; no DELETE of formula rows.
```

---

### Step 14 — service: indicators owner-only visibility, header identity, admin read/audit, SAN-bound bypass

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/peer_identity.py` — create
- `services/xstockstrat-indicators/app/admin_audit.py` — create
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify
- `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py` — modify
- `services/xstockstrat-indicators/app/main.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, no side-effects from execution;
plus owner-only read/execute.

**Codebase Evidence**:
- **Servicer authz.**
  - `_INTERNAL_FORMULA_READERS = frozenset({"analysis"})` (`servicer.py:23`).
  - `_FORMULA_MASKABLE_PATHS` includes `"is_public"` (`:27-38`).
  - `_has_admin_scope` (`:67-78`).
  - `_caller_user_id`: header, else body (`:80-86`).
  - `_can_read_formula(context, author, is_public)`: is_public / SYSTEM / internal header / owner
    (`:88-98`).
- **Formula RPCs.**
  - `ExecuteFormula` authz → `NOT_FOUND` (`:129-144`).
  - `RegisterFormula`: body `author` wins (`:286-299`); `is_public=request.is_public` (`:319,:336`).
  - `GetFormula` caches before authz (`:345-359`).
  - `ListFormulas` (`:361-386`).
  - `UpdateFormula`: SYSTEM guard `:398-403`, admin override `:404-409`, `eff_is_public` `:438`.
  - `DeleteFormula`: SYSTEM guard `:503-508`, admin override `:509-514`.
  - `_row_to_formula` maps `is_public` (`:538`).
- **Repo.** `formulas_repository.list(author_filter, include_public, …, author_public_only)` with the
  WHERE at `:155-158`; `get_by_id` (`:138-143`).
- **Seed.** `fundamentals_value_quality.py:28` `IS_PUBLIC = True`, used at
  `app/services/seed_formulas.py:40`.
- **Per-service helper copies.** `app/peer_identity.py` and `app/admin_audit.py` are created as
  per-service copies in indicators (here), ingest (Step 19) and analysis (`admin_audit.py`, Step 9). The
  services are separate deployables and no shared Python package exists (`packages/` holds only
  `otel` and `proto`). This mirrors the existing per-service `app/mtls.py` and `app/telemetry.py` copies
  in agent, analysis, indicators and ingest. The resulting jscpd duplication is accepted (recorded in
  `design.md` Rejected Alternatives).
  `SYSTEM_AUTHOR = "system"` (`app/formulas/__init__.py:5`).
- **Main.** `main.py:41-63` has no ledger channel. `LEDGER_ENDPOINT` is already in
  `docker-compose.yml:311` and `.do/app.yaml`/`.do/app.dev.yaml:214`. Channel pattern: ingest
  `main.py:85-89` (`grpc.aio.secure_channel(LEDGER_ENDPOINT, mtls.channel_credentials(),
  options=mtls.target_override("xstockstrat-ledger"))`). Indicators has `app/mtls.py:28-49`.
- **Header propagation (C-03).** The new ledger call forwards `x-user-id`/`x-access-scope`/`x-trace-id`
  from inbound metadata, mirroring ingest `_propagation_meta` (`ingest servicer.py:221-226`).
- Step 5 spike: `peer_identity_key()`/`peer_identities()`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`app/peer_identity.py`.**
   - `def peer_san_matches(context, expected: str) -> bool` returns
     `context.peer_identity_key() == "x509_subject_alternative_name" and expected.encode() in list(context.peer_identities())`
     (exact element).
   - It returns `False` on any exception, a `None` key, or a non-iterable (mock) result (fail closed).
2. **Identity helpers in `servicer.py`.**
   - `_internal_grant(context, caller_id)`: the `x-internal-caller` header equals `caller_id` **and**
     `peer_san_matches(context, "xstockstrat-analysis")`.
   - `_reader(context)`: the `x-user-id` header. If it is `"system"` without
     `_internal_grant(context, "analysis-fundsignal")`, the caller is rejected (`PERMISSION_DENIED`)
     at the top of `GetFormula`, `ExecuteFormula`, `ListFormulas`, `RegisterFormula`, `UpdateFormula`
     and `DeleteFormula` (AC-33 parity).
3. **`_can_read_formula(context, author)`.** True for `author == SYSTEM_AUTHOR`, a reader equal to the
   author, or `_internal_grant(context, "analysis")`. The last is the N-only SAN-bound bypass; removing
   it is the follow-up's job. Drop the `is_public` argument at every call site.
4. **Pending-hidden rows** (`pending_intent_id IS NOT NULL`) are `NOT_FOUND` on Get/Execute, excluded
   from List, and **never cached**. Fill the cache only after authz succeeds and only for non-pending
   rows (recon Risk 16).
5. **`ExecuteFormula` branch order** (design §2):
   1. missing → `NOT_FOUND`;
   2. readable → run;
   3. caller is ADMIN → `PERMISSION_DENIED`;
   4. otherwise `NOT_FOUND` (AC-28).
6. **`GetFormula`.** A readable formula is returned. A foreign formula with an ADMIN caller is
   returned after `audit_admin_read` (2 events; failure → `UNAVAILABLE`). Anything else →
   `NOT_FOUND`.
7. **`ListFormulas`.** Repo `list_visible(reader, page_size, page_offset)` returns
   `WHERE deleted_at IS NULL AND pending_intent_id IS NULL AND (author = $1 OR author = 'system')`.
   `author_filter`/`include_public` are ignored unless the caller is ADMIN with
   `author_filter != reader`; then list that author's rows and audit (1 + K events). Delete the
   `author_public_only` path.
8. **`RegisterFormula`.** `author` = `x-user-id` header only. Empty → `INVALID_ARGUMENT`; the body
   author is ignored (FR-2/AC-4). Persist `is_public=False`.
9. **`UpdateFormula`/`DeleteFormula`.**
   - Delete the `_has_admin_scope` override (`:405`, `:510`). Keep the SYSTEM guard and the body
     `user_id` fallback (N only).
   - Remove `"is_public"` from `_FORMULA_MASKABLE_PATHS` (a masked `is_public` path then errors as
     unknown). On a full replace, persist `is_public=False`.
10. **`_row_to_formula`.** Always emit `is_public=False`.
11. **`fundamentals_value_quality.py:28`.** Set `IS_PUBLIC = False`; `SYSTEM_AUTHOR` alone grants
    readability.
12. **`app/admin_audit.py`.** Same contract as analysis Step 9 item 6 (source_service
    `xstockstrat-indicators`; same named caps).
13. **`main.py`.** Create the ledger channel (as in ingest `main.py:85-89`) with
    `LEDGER_ENDPOINT = os.environ.get("LEDGER_ENDPOINT", "xstockstrat-ledger:50057")`, and pass
    `ledger_channel` into `IndicatorsServicer`. No deploy-file change: `LEDGER_ENDPOINT` is already
    wired (confirmed above).

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
grep -n "_has_admin_scope(context)" app/handlers/servicer.py   # only in read paths, not Update/Delete overrides
grep -n "x-user-id\|x-access-scope\|x-trace-id" app/admin_audit.py   # trio forwarded (C-03)
```

---

### Step 15 — test: indicators visibility, identity, admin read, system rules

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/conftest.py` — modify (add shared `ctx_with(metadata, peer_sans=())`)
- `services/xstockstrat-indicators/tests/test_formula_read_authz.py` — modify
- `services/xstockstrat-indicators/tests/test_private_formulas.py` — create

**Reviewers**: `xstockstrat-indicators` owner.

**Codebase Evidence**:
- `_ctx(metadata)` is duplicated in `tests/test_formula_read_authz.py:23-27` and
  `tests/test_formulas.py:215`, so a third consumer forces centralization into `tests/conftest.py`
  (C-13).
- `test_formula_read_authz.py` asserts the old public / internal-caller semantics (`:38-101`); those
  cases are rewritten.

**TDD**: `red-green required`

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-6, AC-22, AC-23, AC-28

**Instructions**:
1. **`conftest.py`.** `ctx_with(metadata, peer_sans=())`: `peer_identity_key()` returns
   `"x509_subject_alternative_name"` when `peer_sans` is non-empty, `peer_identities()` returns the
   encoded list, and `abort` raises.
2. **Rewrite `test_formula_read_authz.py`.**
   - A formerly-public formula is invisible to another user (AC-1/AC-22).
   - The `x-internal-caller: analysis` header **without** the SAN is not trusted.
   - With SAN `xstockstrat-analysis` it is trusted (N-only bypass).
3. **`test_private_formulas.py`:**
   - **AC-2:** bob listing with `author_filter="alice"`, `include_public=True` gets exactly `f-b1` + the
     system id (repo SQL asserted).
   - **AC-3:** `is_public=True` on register is stored `False`, and bob gets `NOT_FOUND`.
   - **AC-4:** body `author="system"` with header bob → author `bob`.
   - **AC-6 (indicators half):** `ExecuteFormula` on the system formula with `x-user-id: system`,
     `x-internal-caller: analysis-fundsignal` and SAN `xstockstrat-analysis` succeeds. The same call
     without the SAN → `PERMISSION_DENIED`.
   - **AC-23:** admin `UpdateFormula` on the system formula → `PERMISSION_DENIED`.
   - **AC-28:** admin `GetFormula` on alice's formula returns it, and `AppendEvent` is called twice
     (`user:admin`, `user:alice`). Admin `UpdateFormula`/`DeleteFormula`/`ExecuteFormula` →
     `PERMISSION_DENIED`. An audit failure → `UNAVAILABLE`.
   - A pending-intent row is `NOT_FOUND` and never cached.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .
grep -n "ctx_with" tests/test_private_formulas.py tests/test_formula_read_authz.py
```

---

### Step 16 — service: remove the analysis `InternalCallerInterceptor`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/main.py` — modify
- `services/xstockstrat-analysis/app/internal_caller.py` — delete
- `services/xstockstrat-analysis/tests/test_internal_caller.py` — delete

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**:
- `main.py:22` `from app.internal_caller import InternalCallerInterceptor`.
- `main.py:73-78` `indicators_channel=grpc.aio.secure_channel(..., interceptors=[InternalCallerInterceptor()])`.
- `app/internal_caller.py:1-16` appends `x-internal-caller: analysis`.
- `tests/test_internal_caller.py` exists.

**TDD**: `red-green required` (Step 17 asserts the header is absent)

**Covers**: —

**Instructions**: Remove the import and the `interceptors=[...]` argument from the indicators channel.
Delete `app/internal_caller.py` and its test. Owner threading (Steps 7/11) supplies `x-user-id` on
every indicators call. A strategy whose formula the owner cannot read now fails visibly (FR-3).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -rn "internal_caller\|InternalCallerInterceptor" app tests   # → no matches
```

---

### Step 17 — test: analysis sends no `x-internal-caller` to indicators

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**: Step 8's guard records every indicators stub call's metadata.

**TDD**: `red-green required`

**Covers**: AC-5

**Instructions**:
1. Assert that every recorded indicators call carries no `x-internal-caller` header, and carries the
   strategy owner's `x-user-id` (AC-5: `x-user-id bob`, no `x-internal-caller`). Two caller ids are
   exempt, and only on their own paths:
   - `analysis-fundsignal` on the fundsignal `system` calls (Step 7);
   - `analysis-template-saga` on the strategy-template saga calls `InstantiateTemplate` (saga form) and
     `ResolveTemplateIntent` (Steps 27/31).

   Any other `x-internal-caller` value, or either id on any other indicators call, fails the test.
2. Assert that `app.main` imports no interceptor (`inspect.getsource` contains no `interceptors=`).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 18 — migration: ingest `013_signal_ownership_templates`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql` — create
- `services/xstockstrat-ingest/migrations/013_signal_ownership_templates.down.sql` — create

**Reviewers**:
- DBA: hypertable partitioning strategy, index correctness, PK swap, lossy-down refusal.
- `xstockstrat-ingest` owner: idempotent ingestion, newsletter source schema stability.

**Codebase Evidence**:
- Last migration is `012_backfill_data_kind.{up,down}.sql`; no remote branch exceeds 012
  (2026-10-07 scan).
- `newsletter_signals` is a hypertable on `ingested_at`, 7-day chunks, `PK (id, ingested_at)`, with
  indexes on `(symbol, ingested_at DESC)`, `(source, ingested_at DESC)` and
  `(valid_from, valid_until)`. It has no compression policy (`001_newsletter_signals.up.sql:8-27`).
- `signal_sources` has `slug TEXT PRIMARY KEY` (`002_*.up.sql:5-15`), so the constraint name is
  `signal_sources_pkey`.
- The source_type CHECK includes `'derived'` and `'mcp_client'` (`011_*.up.sql:9-16`).
- `signal_dedup_keys PK (source, symbol, direction)` plus a `claimed_at` index (`009_*.up.sql:10-20`).
- Staging (design-time verification, context.md round 2): exactly one `derived` source
  (`fundamentals`) and **no `mcp_client` sources**.
- Prod `mcp_client` count is unverified (design Open Risk).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:

**Execute-time operator gate.** Before writing the files, `/sdd-execute` asks the operator for prod's
`SELECT count(*) FROM ingest.signal_sources WHERE source_type='mcp_client'` and records the answer in
`context.md`.
- Count **0**: omit every `credential_scope` item below (C-18, YAGNI).
- Count **> 0**: include them.

`013_signal_ownership_templates.up.sql`, idempotent on both schemas:
1. Line 1: `-- requires-env: SEED_USER_ID`. Add the unconditional unrendered-seed guard, as in
   Step 6 item 2.
2. **`signal_sources` ownership.** A one-shot `DO $$` branch runs only when
   `information_schema.columns` shows `signal_sources.user_id` absent:
   1. `ADD COLUMN user_id TEXT`.
   2. `UPDATE … SET user_id = 'system' WHERE source_type = 'derived'` (D-4), then
      `SET user_id = '<seed>' WHERE user_id IS NULL`.
   3. `SET NOT NULL`.
   4. `DROP CONSTRAINT signal_sources_pkey; ADD PRIMARY KEY (user_id, slug)`.
   5. Create the N-1 owner-fill trigger: function `ingest.n1_owner_fill_signals()` and trigger
      `newsletter_signals_n1_owner_fill` (BEFORE INSERT on `ingest.newsletter_signals`). When
      `NEW.user_id IS NULL`, it sets the unique `user_id` holding `NEW.source` in `signal_sources`.
      With 0 or >1 holders it `RAISE EXCEPTION` (N-1 fails closed, never files into the seed user).
   - Triggers are created **only** in this branch, never re-created on replay after the contract
     drops them (design §1).
3. **`newsletter_signals` ownership.** A one-shot branch runs when the column is absent:
   1. `ADD COLUMN user_id TEXT NOT NULL DEFAULT '<seed>'` (fast default; no chunk rewrite).
   2. `UPDATE ingest.newsletter_signals SET user_id = 'system' WHERE source IN (SELECT slug FROM ingest.signal_sources WHERE user_id = 'system')`.
   3. `ALTER COLUMN user_id DROP DEFAULT`.
   4. `RAISE NOTICE` the row count (design: record the prod row count).
   - Then `CREATE INDEX IF NOT EXISTS idx_newsletter_signals_owner_ingested ON ingest.newsletter_signals (user_id, ingested_at DESC);`.
4. **`ingest.signal_dedup_claims`.**
   - Columns: `user_id`, `source`, `symbol`, `direction`, `conviction NUMERIC(4,3)`,
     `valid_until TIMESTAMPTZ`, `signal_id BIGINT NOT NULL`,
     `claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, with `PRIMARY KEY (user_id, source, symbol, direction)`
     and a `claimed_at` index.
   - Seed it, guarded by `to_regclass('ingest.signal_dedup_keys') IS NOT NULL`:
     `INSERT INTO ingest.signal_dedup_claims (user_id, source, symbol, direction, conviction, valid_until, signal_id, claimed_at) SELECT n.user_id, k.source, k.symbol, k.direction, k.conviction, k.valid_until, k.signal_id, k.claimed_at FROM ingest.signal_dedup_keys k JOIN ingest.newsletter_signals n ON n.id = k.signal_id ON CONFLICT DO NOTHING` (explicit column lists on both sides; source columns from `009_*.up.sql:10-17`).
   - `signal_dedup_keys` itself stays for N-1.
5. **Origin columns.** `ALTER TABLE ingest.signal_sources ADD COLUMN IF NOT EXISTS origin_template_id TEXT, ADD COLUMN IF NOT EXISTS origin_template_version INTEGER;`
6. **`ingest.source_templates`** has the same columns as Step 6's `strategy_templates`. **No seed
   rows.**
7. *(Only if the gate count > 0)* `credential_scope TEXT NULL CHECK (credential_scope IN ('LEGACY_GLOBAL'))`.
   - Set it to `'LEGACY_GLOBAL'` for existing `mcp_client` rows.
   - A BEFORE UPDATE trigger, created in the one-shot branch, nulls it whenever `config_json` or
     `credentials_ref` changes.

`013_signal_ownership_templates.down.sql`, which refuses a lossy rollback:
1. A `DO $$` block `RAISE EXCEPTION`s if any `slug` has more than one owner in `signal_sources`, or
   any `(source, symbol, direction)` has more than one owner in `signal_dedup_claims`.
2. Otherwise drop, in order:
   - the trigger(s) and function(s);
   - `source_templates` and `signal_dedup_claims`;
   - the owner index;
   - the origin and `credential_scope` columns;
   - the `signal_sources` PK swap back to `(slug)`;
   - `user_id` from `signal_sources` and `newsletter_signals`.

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/013_*.up.sql services/xstockstrat-ingest/migrations/013_*.down.sql
head -1 services/xstockstrat-ingest/migrations/013_*.up.sql   # -- requires-env: SEED_USER_ID
# Read both: triggers only inside the one-shot branch; .down refuses on multi-owner collisions before any DROP.
```

---

### Step 19 — service: ingest owner-scoped sources/signals, `SignalScope`, reserved slugs, system grants, admin read

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/peer_identity.py` — create
- `services/xstockstrat-ingest/app/admin_audit.py` — create
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion
(per-owner dedup), newsletter source schema stability.

**Codebase Evidence**:
- **Servicer helpers.** `_has_admin_scope` (`servicer.py:204-218`), `_propagation_meta`
  (`:220-226`).
- **`IngestSignal`** (`:778-798`) → `_ingest_external_signal(signal, propagation_meta)`
  (`:800-974`):
  - slug check `SELECT slug … WHERE slug = $1 AND active` → `_SignalValidationError` → abort
    `INVALID_ARGUMENT` (`:819-826`, `:792-793`);
  - transaction at `:845`;
  - `newsletter_signals` INSERT (`:847-864`);
  - dedup claim `INSERT INTO ingest.signal_dedup_keys … ON CONFLICT (source, symbol, direction)`
    (`:866-893`);
  - sentinel rollback `_DuplicateSignal` (`:838-901`);
  - `mark_source_error`/`mark_source_fed`/`touch_source_last_seen` keyed by slug (`:917,:925,:961`).
- **`QuerySignals`** has no owner filter (`:976-1079`).
- **`ListSignalSources`** → `list_all_sources` (unscoped) (`:1081-1121`).
- **`ManageSignalSource`.**
  - Admin-only (`:1140-1142`).
  - REGISTER `get_source(slug)` → `ALREADY_EXISTS` (`:1161-1166`).
  - `insert_source` (`:1185-1195`).
  - UPDATE/REACTIVATE/DEACTIVATE are slug-keyed (`:1151-1160`, `:1197-1290`).
- **Repo.** Every query is `WHERE slug = $1`: `get_active_source:34`, `list_all_sources:43-57`,
  `mark_source_fed:60`, `mark_source_error:71`, `touch_source_last_seen:80`, `get_source:89`,
  `insert_source:95`, `update_source:132`, `reactivate_source:169`, `deactivate_source:178`.
- **Inbound grants.** Ingest never reads an inbound `x-internal-caller` (recon). The precedent for an
  `x-internal-caller` allow-list is portfolio `internal/service/authz.go:15-38`.
- **Ledger emit precedent.** `_emit_backfill_event` (`:283-298`). Ingest already holds
  `self._ledger` (`:194`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`app/peer_identity.py`.** Same contract as indicators Step 14 item 1.
2. **`app/admin_audit.py`.** Same contract as analysis Step 9 item 6 (source_service
   `xstockstrat-ingest`).
3. **Grants.**
   - `_SYSTEM_GRANTS = {"analysis-fundsignal": {"ManageSignalSource", "IngestSignal"}, "analysis-system-read": {"QuerySignals", "ListSignalSources"}}`,
     each SAN-bound to `xstockstrat-analysis`.
   - `_resolve_owner(context, rpc)` returns:
     - `x-user-id` when present and ≠ `"system"`;
     - `"system"` iff the header is `"system"` **and** the `x-internal-caller` grant covers `rpc`
       **and** the SAN matches; otherwise `PERMISSION_DENIED` (AC-33);
     - `None` when headerless.
4. **Repo: owner-key every slug query** (`user_id` param added):
   - `get_source(user_id, slug)`, `insert_source(..., user_id)`, `update_source(user_id, slug, …)`,
     `reactivate_source`/`deactivate_source(user_id, slug)`;
   - `mark_source_fed`/`mark_source_error`/`touch_source_last_seen(user_id, slug)`;
   - `list_sources(owner, scope, include_inactive)` with WHERE
     `user_id = $1 OR user_id = 'system'` (UNSPECIFIED), `user_id = $1` (OWN), or
     `user_id = 'system'` (SYSTEM);
   - `slug_holders(slug) -> list[str]`, used by headerless resolution;
   - `list_all_sources` stays only for headerless N tolerance and the poller (Step 23). Add `user_id`
     to its fixed `cols` SELECT list (`signal_sources.py:44-48`), plus `credential_scope` when the
     Step 18 gate shipped that column. Step 23's `poll_one_source` reads `src["user_id"]` and
     `src.get("credential_scope")` from these rows, and headerless `ListSignalSources` uses them to
     populate `SignalSource.user_id`.
   - `get_active_source` (`signal_sources.py:34-40`) has no caller in `app/` (grep: only
     `tests/test_signal_sources.py:10,180-207` references it). Delete it and those tests (Step 20)
     rather than owner-keying dead code.
5. **`IngestSignal`.**
   - Headered: resolve the source as `(owner, slug)` → absent → `NOT_FOUND` (AC-10; was
     `INVALID_ARGUMENT`, recorded deliberately per design E).
   - Headerless (N only): `slug_holders` → 0 → `INVALID_ARGUMENT` (today's code), >1 →
     `FAILED_PRECONDITION`, 1 → that owner.
   - Stamp `user_id` on the `newsletter_signals` INSERT.
   - Move the dedup claim to `ingest.signal_dedup_claims ON CONFLICT (user_id, source, symbol, direction)`,
     including the dedup-hit SELECT. Keep the `_DuplicateSignal` sentinel ordering (ledger 2026-08-07
     ingest-signal-dedup).
   - Add `user_id` to the `signal:` ledger payload.
6. **`QuerySignals`.**
   - Headered: WHERE `user_id` per `request.scope`: UNSPECIFIED = own + system; OWN; SYSTEM.
   - ADMIN with `owner_user_id` ≠ caller → that owner's rows, with audit.
   - Headerless (N only): today's unscoped behaviour.
   - Populate `ExternalSignal.user_id`.
7. **`ListSignalSources`.** Headered → own + system. Admin `owner_user_id` → that owner's rows with
   audit. Headerless → today's. Populate `SignalSource.user_id`.
8. **`ManageSignalSource`.**
   - Delete the admin gate (`:1140-1142`) for headered callers; any owner manages their own sources.
   - Headerless keeps the admin gate plus elaboration 5 (Execution Summary).
   - REGISTER takes `pg_advisory_xact_lock(hashtext(slug))` inside one transaction, then:
     - a non-system owner and a slug held by `system` → `ALREADY_EXISTS` (AC-36);
     - `system` (granted) and a slug held by any user → `FAILED_PRECONDITION` (AC-36);
     - an existing `(owner, slug)` → `ALREADY_EXISTS`.
   - UPDATE/REACTIVATE/DEACTIVATE of a `system`-owned source by any non-system caller →
     `PERMISSION_DENIED` (AC-26, C-10(c)); otherwise the owner's row or `NOT_FOUND`.
   - Admins have **no** mutation reach over another user's sources (FR-13).

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
grep -n "signal_dedup_claims\|pg_advisory_xact_lock\|_SYSTEM_GRANTS" app/handlers/servicer.py
# Every slug predicate, including multi-line SQL ("… WHERE slug = $1" split across string literals):
grep -rnE 'slug\s*=\s*\$[0-9]' app/repositories/ app/handlers/servicer.py
#   → read each hit; each must also carry a `user_id = $N` predicate in the same statement
#     (slug_holders is the one deliberate exception: it returns every holder).
grep -rn "get_active_source" app tests   # → none (deleted)
grep -n "x-user-id\|x-access-scope\|x-trace-id" app/admin_audit.py   # trio forwarded (C-03)
```

---

### Step 20 — test: ingest ownership, scopes, reserved slugs, system grants, admin read

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/conftest.py` — modify (extend the existing `_ctx` builder; no
  new near-duplicate helper)
- `services/xstockstrat-ingest/tests/test_signal_ownership.py` — create
- `services/xstockstrat-ingest/tests/test_signal_sources.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner.

**Codebase Evidence**:
- `tests/conftest.py:15-31` `_ctx(access_scope)` is the C-13 home.
- `tests/_helpers.py` exists (async-context-manager mock precedent, ledger 2026-08-07).

**TDD**: `red-green required`

**Covers**: AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-26, AC-28, AC-29, AC-33, AC-36

**Instructions**:
1. **`conftest.py` — extend `_ctx`, do not add a sibling.** Today `_ctx(access_scope="4")` hard-codes
   `x-user-id: u1` (`tests/conftest.py:15-31`). Extend it in place, keeping every existing call site
   valid:
   - `_ctx(access_scope="4", user_id="u1", peer_sans=(), internal_caller="")`;
   - `user_id=""` omits the `x-user-id` header (the headerless-N cases);
   - `internal_caller` adds `x-internal-caller` when non-empty (needed for the AC-33 grant cases);
   - `peer_identity_key()` returns `"x509_subject_alternative_name"` when `peer_sans` is non-empty
     (else `None`), and `peer_identities()` returns the encoded `peer_sans` list.
2. **Ingest tests:**
   - **Poller row shape:** `list_all_sources` SELECTs `user_id` (and `credential_scope` when Step 18
     shipped it). Assert on the SQL text and on the returned dict keys. Headerless `ListSignalSources`
     populates `SignalSource.user_id` from those rows.
   - **Dead code:** remove the `get_active_source` tests (`tests/test_signal_sources.py:10,180-207`)
     along with the function (Step 19).
   - **AC-7:** a non-admin bob registers `my-newsletter` → `user_id=bob`; alice's list excludes it.
   - **AC-8:** alice and bob both register `motley-fool`.
   - **AC-9:** both ingest NVDA BUY → two rows, and bob's `QuerySignals(symbol=NVDA)` → 1 (SQL owner
     predicate plus the dedup-claims conflict target asserted).
   - **AC-10:** bob ingests into `alice-feed` → `NOT_FOUND`, no INSERT.
   - **AC-11 (ingest half):** `scope=OWN` excludes other owners.
   - **AC-26:** a system source and its signals appear in bob's list/query flagged `user_id=system`;
     bob's UPDATE → `PERMISSION_DENIED`.
   - **AC-28 (ingest half):** an admin `owner_user_id` read returns alice's rows and emits 2 audit
     events; a non-admin selector is ignored.
   - **AC-29 (ingest half):** bob's `QuerySignals` never returns `alice-feed` rows.
   - **AC-33:** `x-user-id: system` without the grant → `PERMISSION_DENIED`, no INSERT; with the grant
     but the wrong SAN → `PERMISSION_DENIED`.
   - **AC-36:** bob REGISTER `fundamentals` (system-held) → `ALREADY_EXISTS`; system REGISTER
     `macro-feed` (bob-held) → `FAILED_PRECONDITION`.
   - **AC-12 (ingest half):** bob's `QuerySignals(source="alice-feed")` returns 0 rows when bob owns
     no `alice-feed`.
   - **Headerless N:** 0 holders → `INVALID_ARGUMENT`, >1 → `FAILED_PRECONDITION`.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
grep -n "_ctx" tests/test_signal_ownership.py
grep -n "def ctx_with" tests/conftest.py   # → none (the existing _ctx was extended instead)
```

---

### Step 21 — service: config per-user secrets and SAN-bound ingest `GetSecret` grant

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**:
- `xstockstrat-config` owner: global/per-user scoping, secret encryption + redaction, WatchConfig
  stream stability.
- Security: secrets encrypted at rest, redacted at every read edge, decryptable only via `GetSecret`
  for allow-listed callers.

**Codebase Evidence**:
- **Allow-list.** `SECRET_CALLER_ALLOWLIST` with ingest `keyPrefixes: ['mcp_credential.']`
  (`authz.ts:112-123`). `hasSecretCallerAuthority(md, namespace, key)` reads only the header
  (`authz.ts:129-142`).
- **`getSecret`.** Calls `hasSecretCallerAuthority(call.metadata, …)` (`configServiceImpl.ts:316-321`).
  Its query is `… AND user_id IS NULL LIMIT 1` (`:325-328`). It returns `found:false` on a NULL or
  empty ciphertext and `INTERNAL` on a decrypt failure (`:330-347`).
- **`setConfig`.**
  - Per-user write is owner-only (`:351-384`).
  - Row-authoritative `is_secret` (`:424-462`).
  - The per-user secret rejection is at `:464-468` (`secret keys are global-scope only`).
- **Redaction choke point.** `buildConfigValue` redacts `is_secret` rows (`:560-566`). It is used by
  the snapshot (`:170,:194`) and the per-user overlay (`resolveOverlayValues :211-224`); the overlay
  comment "Secrets are global-only" is at `:209`. `listKeys` redacts `currentValue` (`:530-536`).
- **Unique index.** `(namespace, key, environment, COALESCE(user_id,''))`
  (`migrations/017_*.up.sql:99-104`), so no schema change is needed.
- **grpc-js** `^1.14.5`; `getAuthContext()` is proven by Step 5.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`authz.ts`.**
   - `SecretCallerGrant` gains an optional `peerSan?: string`; the ingest grant sets
     `peerSan: 'xstockstrat-ingest'`.
   - `hasSecretCallerAuthority(call, namespace, key)` takes the call. A grant with `peerSan` also
     requires the SAN parsed from `call.getAuthContext()?.sslPeerCertificate?.subjectaltname`
     (comma list, `DNS:` prefix, exact match). Fail closed on absence.
   - The marketdata grant has no `peerSan`, so it is unchanged.
2. **`getSecret`.** Pass `call`. Resolve with **exact scope**: `request.user_id` empty →
   `user_id IS NULL`, else `user_id = $4`. There is no fallback to global (design §8), so marketdata is
   unaffected.
3. **`setConfig`.** Delete the per-user secret rejection (`:464-468`). A per-user secret write follows
   the existing owner-only per-user gate and the encrypt-at-rest path. Update the overlay comment
   (`:209`) and the `getSecret` doc comment: per-user secrets are redacted by the same
   `buildConfigValue` choke point.
4. Redaction needs no new code (`buildConfigValue` already covers overlay rows). Step 22 proves it per
   user.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && npx tsc --noEmit
grep -n "peerSan\|getAuthContext" src/grpc/authz.ts
grep -n "global-scope only" src/grpc/configServiceImpl.ts   # → no matches
```

---

### Step 22 — test: config per-user secret resolution and per-user redaction

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts` — create
- `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts` — modify

**Reviewers**:
- `xstockstrat-config` owner.
- Security.

**Codebase Evidence**:
- `secretCallerAuthz.test.ts:22-55` uses `node:test` `describe/it`.
- No existing config test asserts the per-user secret rejection at `configServiceImpl.ts:464-466` (re-spec 2026-10-07: grep for `global-scope`/`per-user secret`/`not supported` across `src/__tests__` finds none), so the acceptance case is written new in `perUserSecrets.test.ts` rather than inverted.
- Coverage: `pnpm run test:coverage` (`c8 --lines 40`, `package.json:13`).

**TDD**: `red-green required`

**Covers**: AC-35

**Instructions**:
1. **Per-user resolution.** alice and bob each `SetConfig(user_id=self, is_secret=true,
   create_key=true)` the key `mcp_credential.<uuid-a>` / `<uuid-b>` with `tok-a` / `tok-b`. Assert:
   - `GetSecret(user_id=alice)` → `tok-a`; `GetSecret(user_id=bob)` → `tok-b`;
   - `GetSecret(user_id="")` → `found:false` (exact scope).
2. **Redaction.** `GetConfig`/`ListKeys`/`WatchConfig` for alice, bob, and an admin never contain
   `tok-a`/`tok-b` (each value is `[redacted]`).
3. **SAN binding.** The ingest grant without the SAN (`getAuthContext` returns another SAN or
   undefined) → `PERMISSION_DENIED`. Marketdata's exact-key grant is unchanged.
4. Bob writing alice's per-user secret → `PERMISSION_DENIED` (existing owner-only gate).
5. **Write accepted (new; RED today).** `SetConfig(user_id=alice, is_secret=true, create_key=true)` succeeds and stores ciphertext in `value_encrypted` with `value_data = '[redacted]'` — today it is rejected by `configServiceImpl.ts:464-466`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
grep -rn "__tests__/fixtures" src/__tests__/perUserSecrets.test.ts || echo "single-consumer inline literals (C-13 compliant)"
```

---

### Step 23 — service: ingest `mcp_client` poller resolves the owner's secret and ingests as the owner

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify
- `services/xstockstrat-ingest/app/config/watcher.py` — modify
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion.

**Codebase Evidence**:
- **Poller.**
  - `run_one_cycle` lists every source globally via `list_all_sources(servicer._db,
    include_inactive=False)` (`mcp_client_loop.py:127-152`).
  - `poll_one_source` resolves `cfg_watcher.resolve_secret(key)` (`:96-118`) and calls
    `servicer._ingest_external_signal(_build_external_signal(slug, item))` with no owner (`:124`).
- **Secret resolution.** `resolve_secret(key)` sends `GetSecretRequest(namespace, key, environment)`
  with `x-internal-caller: ingest` (`watcher.py:146-161`).
- **Ingest entry.** `_ingest_external_signal(signal, propagation_meta=None)` (`servicer.py:800`).
- `list_all_sources` selects a fixed column list (`signal_sources.py:44-48`) that today lacks
  `user_id`/`credential_scope`; Step 19 adds them, so the `src["user_id"]` /
  `src.get("credential_scope")` reads below depend on Step 19.
- If Step 18 shipped `credential_scope`, a `LEGACY_GLOBAL` row resolves the existing global key (FR-14
  "existing global mcp credentials keep resolving for the seed owner's migrated sources").

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `resolve_secret(key, user_id: str = "")` sets `GetSecretRequest.user_id = user_id`.
2. **`poll_one_source`.**
   - `owner = src["user_id"]`.
   - Resolve with `user_id = owner`, **except** `src.get("credential_scope") == "LEGACY_GLOBAL"`, which
     resolves with `user_id=""` (only if Step 18 added the column).
   - Treat `''` plaintext as missing (`found and bearer` else mark `"bearer not configured"`).
   - Call `servicer._ingest_external_signal(sig, owner=owner)`.
3. `_ingest_external_signal(signal, propagation_meta=None, owner: str | None = None)`. An explicit
   `owner` wins over header resolution, so the poller's identity is never the owner (OQ-6).
4. `run_one_cycle` keeps iterating every active `mcp_client` source (the poller is platform-internal).
   Every write is owner-scoped through items 2–3, and every `mark_source_*` uses `(owner, slug)`.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
grep -n "owner=" app/engine/mcp_client_loop.py
```

---

### Step 24 — test: per-owner `mcp_client` credentials

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner.

**Codebase Evidence**: `tests/test_mcp_client_loop.py` drives `run_one_cycle` (`mcp_client_loop.py:127`
docstring: "extracted so tests can drive a single cycle deterministically").

**TDD**: `red-green required`

**Covers**: AC-35

**Instructions**: alice and bob each own `acme-mcp`, with refs to `tok-a`/`tok-b` resolved by a fake
`resolve_secret(key, user_id)`. Assert:
- the fake MCP client receives `Bearer tok-a` for alice's source and `Bearer tok-b` for bob's;
- the ingested rows carry `user_id` alice / bob respectively;
- a `''` bearer marks `bearer not configured`.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 25 — service: analysis blend-guard helper, single blend-id accessor, REGISTER guard

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**:
- **Five raw reads of `analysis.engine.fundamentals_blend_strategy_id`:** `servicer.py:2833-2836`
  (DEACTIVATE guard), `:2961-2964` (SetStrategyLive guard), `:4424-4426` (opportunities),
  `live_loop.py:336-338`, `entry_backfill.py:86-88`.
- `_has_admin_scope` (`servicer.py:514`).
- The REGISTER branch has no blend guard (`:2690-2728`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module-level `def blend_strategy_id(cfg) -> str` (one accessor, default
   `"fundamentals_macd_blend"`) and replace all five reads with it (C-18 DRY).
2. Add `async def _require_admin_for_blend_id(self, context, strategy_id) -> bool` beside
   `_has_admin_scope`. When `strategy_id == blend_strategy_id(self._cfg)` and the caller is not admin,
   it aborts `FAILED_PRECONDITION` ("the fundamentals blend strategy id is reserved for admins") and
   returns True.
3. REGISTER calls it after `definition.user_id = caller_user_id` and before the duplicate check.
   DEACTIVATE/set-non-live guards keep their current behaviour (AC-23 "refused as before").

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -rn "fundamentals_blend_strategy_id\"" app --include=*.py   # → only inside blend_strategy_id()
```

---

### Step 26 — test: blend guard parity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_blend_guard.py` — create

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**: Step 25 citations; `ctx_with` from `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: AC-23

**Instructions**:
1. **AC-23 (analysis half):** bob DEACTIVATE `fundamentals_macd_blend` → `FAILED_PRECONDITION`, as
   before.
2. **@feature-186 EXTEND:**
   - a non-admin REGISTER of the configured blend id → `FAILED_PRECONDITION`;
   - an admin REGISTER succeeds;
   - a reconfigured blend id moves the guard.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 27 — service: indicators formula templates, saga copy, intent resolution, origin on reads

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formula_templates_repository.py` — create
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — no side-effects from formula execution; template
payload validation.

**Codebase Evidence**:
- The formulas repo has no transactions; every method uses the pool directly
  (`formulas_repository.py:48-49`).
- Atomic multi-row precedent: `async with pool.acquire() as conn, conn.transaction():` (ingest
  `servicer.py:845`).
- `create(...)` INSERT (`formulas_repository.py:51-85`).
- Register-time validators (`servicer.py:301-309`): `params_validation.validate_definitions`,
  `validate_outputs`, `validate_fundamental_inputs`.
- `_has_admin_scope` (`:67-78`).
- `_internal_grant`/`peer_san_matches` (Step 14).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`FormulaTemplatesRepository`.** It wraps `indicators.formula_templates` with:
   - `list_active()`, `get(id)`, `create(meta, payload_json, created_by)`;
   - `update(id, payload_json)`, which bumps `version = version + 1` and `updated_at` in **one** UPDATE;
   - `retire(id)`, which sets `retired_at = NOW()`;
   - `latest_versions(ids) -> dict`, one batched query.
2. **`ListTemplates`** → active templates (any authenticated caller).
3. **`ManageTemplate`.**
   - The ADMIN bit is required, else `PERMISSION_DENIED` (AC-13).
   - CREATE/UPDATE validate the `RegisterFormulaRequest` payload with the same validators as
     `RegisterFormula`.
   - RETIRE never touches instances (AC-31).
4. **`InstantiateTemplate`.**
   - **User path** (`template_id` only): owner = header (must be non-empty and not `system`). The
     template must be non-retired (retired or missing → `NOT_FOUND`). Create a private formula from the
     payload with `author=owner`, `is_public=False`, `origin_template_id`/`origin_template_version`.
   - **Saga path** (`template_ids` + `intent_id`): requires
     `_internal_grant(context, "analysis-template-saga")` (Step 14 helper: the `x-internal-caller`
     header equals `analysis-template-saga` **and** the peer SAN is `xstockstrat-analysis`) and a
     non-empty, non-`system` owner header. Without the grant → `PERMISSION_DENIED`.
     - This is a **dedicated** caller id. It is **not** the N-only `analysis` formula-reader bypass id
       (Step 14 item 3), which the follow-up "224 enforce + contract" deletes; the saga must keep
       working after that deletion.
     - Resolve every id in `template_ids` first. If any referenced formula template is retired or
       missing, fail the whole call with `NOT_FOUND` (naming the id) before any INSERT: no partial
       copy is ever written.
     - Insert every copy in **one transaction** with `pending_intent_id=intent_id`. Never cache them.
       Any failure rolls back everything and returns the error. Return `formula_ids_by_template`.
5. **`ResolveTemplateIntent(intent_id, commit)`.** Same `analysis-template-saga` grant as the saga
   path, else `PERMISSION_DENIED`. `commit=True` → `UPDATE
   … SET pending_intent_id = NULL WHERE pending_intent_id = $1 AND author = <owner>`. `commit=False` →
   hard `DELETE … WHERE pending_intent_id = $1 AND author = <owner>`. Evict any cache entries for those
   ids. Idempotent (`affected` may be 0).
6. **Origin on reads (FR-8/AC-17).** `GetFormula` and `ListFormulas` populate `origin` from the
   origin columns:
   - `latest_version` comes from one batched `latest_versions` lookup per response;
   - `update_available = latest_version > template_version`, and false for a retired or missing
     template.

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
grep -n "conn.transaction()\|pending_intent_id" app/services/formulas_repository.py
grep -n "analysis-template-saga" app/handlers/servicer.py   # saga + ResolveTemplateIntent grant
```

---

### Step 28 — test: formula templates, instantiation, update-available, retire

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formula_templates.py` — create

**Reviewers**: `xstockstrat-indicators` owner.

**Codebase Evidence**: Step 27 citations; `ctx_with` from Step 15's `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: AC-13, AC-14, AC-15, AC-16, AC-17, AC-31

**Instructions**:
- **AC-13:** a non-admin `ManageTemplate CREATE` → `PERMISSION_DENIED`.
- **AC-14:** an admin update moves version 1 → 2 and `ListTemplates` as bob shows 2.
- **AC-15:** an empty repo → 0 templates.
- **AC-16:** bob's instance has `author=bob` and origin `tpl-zscore`/2; alice `GetFormula` →
  `NOT_FOUND`.
- **AC-17:** an update to v3 leaves the instance source unchanged and the read shows `latest_version=3`,
  `update_available=true`.
- **AC-31:** a retired template is absent from the list; the instance still reads with its origin, and
  `update_available=false`.
- **Saga:** pending copies are invisible to List/Get. A partial failure in a batch rolls back every
  INSERT (mock-transaction assertion, ledger 2026-08-07). `ResolveTemplateIntent` commit un-hides and
  abort deletes. A caller without the SAN → `PERMISSION_DENIED`, and so is a caller presenting the
  N-only `analysis` bypass id instead of `analysis-template-saga`. A batch naming one retired or
  missing formula template → `NOT_FOUND` with zero INSERTs.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .
```

---

### Step 29 — service: ingest source templates and origin on `ListSignalSources`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/source_templates.py` — create
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — newsletter source schema stability.

**Codebase Evidence**:
- REGISTER validation: `_validate_source_write(source_type, config_json, credentials_ref)`
  (`servicer.py:1123-1134`) plus the reliability-weight range check (`:1176-1184`).
- `validate_config_json(source_type, config_json)` is defined at `signal_sources.py:186`, imported into
  the servicer at `servicer.py:35`, and called by `_validate_source_write` at `servicer.py:1129`.
- `SignalSource` has no `credentials_ref` field: "credentials_ref is intentionally absent"
  (`ingest.proto:152-153`).
- Step 19 REGISTER path (advisory lock, reserved slugs).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. A `source_templates` repo mirroring Step 27 item 1.
2. **`ListTemplates`/`ManageTemplate`.** Admin-gated writes. The payload is a `SignalSource` validated
   via `validate_config_json`. A payload never carries credentials; the proto has no such field
   (preserves `@feature-166 @AC-2/@AC-3`).
3. **`InstantiateTemplate(template_id, slug, credentials_ref)`.**
   - The owner is the header.
   - The slug is the request slug, else the template payload's slug.
   - Run the Step 19 REGISTER path: reserved slug → `ALREADY_EXISTS`; existing own slug →
     `ALREADY_EXISTS`; `_validate_source_write` with the supplied `credentials_ref`.
   - Stamp the origin columns.
4. `ListSignalSources` populates `origin` with a batched `latest_versions` lookup.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```

---

### Step 30 — test: source templates

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_source_templates.py` — create

**Reviewers**: `xstockstrat-ingest` owner.

**Codebase Evidence**: Step 29 citations; `ctx_with` from Step 20's `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: AC-13

**Instructions**:
- **AC-13 (source kind):** a non-admin `ManageTemplate` → `PERMISSION_DENIED`.
- Instantiating creates a source owned by the caller with origin.
- Instantiating with a system-held slug → `ALREADY_EXISTS`.
- `mcp_client` instantiation without `credentials_ref` → `INVALID_ARGUMENT`.
- `ListSignalSources` reports `update_available` after a template update.
- Neither the template payload nor any response contains a credential.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 31 — service: analysis strategy templates, `InstantiateTemplate` saga, reconcile sweep, origin on reads

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategy_templates.py` — create
- `services/xstockstrat-analysis/app/repositories/template_intents.py` — create
- `services/xstockstrat-analysis/app/repositories/strategies.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism; atomic deep copy.

**Codebase Evidence**:
- **Strategies repo.** `StrategiesRepository.create(user_id, strategy_id, display_name,
  definition_json)` (`strategies.py:41-54`). Transaction precedent: `update_locked` (`:93-136`,
  `conn.transaction()` at `:112`). `get_by_owner_and_id` (`:66-75`).
- **REGISTER path.** `_validate_definition_proto` (`servicer.py:605`); REGISTER flow and
  `asyncpg.UniqueViolationError` backstop (`:2690-2728`).
- **DurableSchedule.** `DurableSchedule(db_pool, job_name, mode, *, user_id="", anchor_hour=None)`
  (`app/engine/durable_schedule.py:32-40`). Usage precedent `servicer.py:5213-5226`
  (`schedule.seed()`, jitter, tick loop). The background `create_task` precedent is in `main.py:207-213`.
- `_row_to_strategy_definition` (`servicer.py:6177`); `_row_to_score` (`:6141`).
- Indicators saga RPCs: Step 27. Blend helper: Step 25.
- Header propagation (C-03): see Instructions item 5 for the exact outbound metadata on both saga
  paths. The SAN identity is analysis's mTLS leaf (`main.py:73-78`).
- **Write-time validation today.** `_validate_definition_proto` (`servicer.py:605-637`) resolves each
  component's `formula_id` with indicators `GetFormula`: `_fetch_formula_outputs` (`:541-564`, named
  outputs), `_formula_fundamentals` (`:1610`, fundamentals inputs → the `source_symbol` XOR check at
  `:615-632`) and `_refuse_deleted_bindings` (`:591-603`). It then calls the pure
  `_validate_definition(definition, formula_outputs)` (`app/services/evaluator.py:734`). A formula
  **template** id is not a formula id, so `GetFormula` would `NOT_FOUND` it and every dotted output
  (e.g. `z.upper`) would be rejected.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repos.** `strategy_templates` mirrors Step 27 item 1. `template_intents` provides
   `create(intent)` and `cas(intent_id, from_state, to_state, conn=None) -> bool` (`UPDATE … WHERE
   state = $from`), plus `stale(states, older_than)`.
2. **`ListTemplates`/`ManageTemplate`.**
   - Admin-gated writes.
   - CREATE/UPDATE validate the `StrategyDefinition` payload with a dedicated
     `_validate_template_definition(definition, context)`. It must **not** reuse
     `_validate_definition_proto`'s `GetFormula` resolution (evidence above):
     1. Call indicators `ListTemplates` once and index the active `FormulaTemplate`s by
        `meta.template_id`. A component `formula_id` with no active formula template →
        `INVALID_ARGUMENT`.
     2. Build `formula_outputs[template_id] = {"value"} ∪ {o.name for o in payload.outputs}` from the
        template's `RegisterFormulaRequest` payload.
     3. Build the fundamentals map from `payload.fundamental_inputs`, and apply the same
        `source_symbol` XOR rejection as `_validate_definition_proto` (`:615-632`).
     4. Call `_validate_definition(definition, formula_outputs)`, so named outputs such as `z.upper`
        validate exactly as they do for a concrete formula.

     Factor the XOR check into a shared helper used by both validators rather than copying it (C-18).
     The ListTemplates call carries the admin caller's trio (C-03).
3. **`InstantiateTemplate(template_id, strategy_id)`.**
   1. The owner is the header (non-empty, not `system`). The template must be active, else
      `NOT_FOUND` (a retired template starts no intent).
   2. Final id: if the caller supplied `strategy_id` and owns it → `ALREADY_EXISTS` **before any
      write** (AC-34). Otherwise use the template payload id, suffixed `_2`, `_3`, … at the first free
      suffix (AC-20).
   3. `await self._require_admin_for_blend_id(context, final_id)` (Step 25) on the **final** id.
   4. Insert the intent `PENDING`.
   5. Call indicators `InstantiateTemplate(template_ids=<distinct component formula template ids>,
      intent_id)` with the item-5 request-path metadata. A retired or missing formula template fails
      the whole indicators call with `NOT_FOUND` and no copies (Step 27). On error, CAS `PENDING→ABORTING`, call `ResolveTemplateIntent(commit=False)`, CAS
      `→ABORTED`, and return the error (AC-19).
   6. Repoint the components' `formula_id` to the returned copies. Set `active=False`,
      `live_enabled=False` and `user_id=owner`.
   7. In **one** strategies transaction: CAS `PENDING→COMMITTED` (owner-checked: `WHERE user_id =
      owner`) and insert the strategy with its origin columns. If the CAS fails, the reconcile sweep
      aborted it → abort the copies and return `ABORTED`.
   8. After commit, call `ResolveTemplateIntent(commit=True)` and CAS `COMMITTED→FINALIZED`. A failure
      here is left for the sweep (the strategy is inactive, and its components show "not readable"
      until finalized).
4. **Reconcile sweep.** `run_template_intent_sweep_forever()` uses
   `DurableSchedule(self._db_pool, "template_intent_sweep", "interval")`, started in `main.py` next to
   the other loops. It handles:
   - `PENDING` older than `_INTENT_STALE_SECONDS` → `ABORTING` → abort the copies → `ABORTED`;
   - `ABORTING` → retry the abort;
   - `COMMITTED` → retry the commit → `FINALIZED`.

   `_INTENT_STALE_SECONDS = 900` and `_INTENT_SWEEP_SECONDS = 300` are named constants with a rationale
   comment (elaboration 6; the operator extended the round-5 fixed-constant ruling to both on
   2026-10-07).
5. **Outbound metadata for the indicators saga calls** (`InstantiateTemplate` saga form and
   `ResolveTemplateIntent`). The caller id is the dedicated `analysis-template-saga` (Step 27), never
   the N-only `analysis` bypass id.
   - **Request path** (inside `InstantiateTemplate`): the caller's trio — `x-user-id: <owner>`,
     the inbound `x-access-scope`, the inbound `x-trace-id` — plus
     `x-internal-caller: analysis-template-saga`.
   - **Reconcile sweep path** (item 4; no inbound request): `x-user-id: <intent.user_id>` +
     `x-internal-caller: analysis-template-saga` + a fresh `x-trace-id` (new UUID per sweep action).
     No `x-access-scope` is sent.
6. **Origin on reads.** `_row_to_strategy_definition` maps the origin columns into
   `StrategyDefinition.origin`. `GetStrategy`, `ListStrategyDefinitions` and `ListStrategies` (via
   `StrategyScore.origin`) fill `latest_version`/`update_available` with one batched template lookup
   per response.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "_require_admin_for_blend_id\|cas(\|ResolveTemplateIntent" app/handlers/servicer.py
grep -rn "analysis-template-saga" app   # request path + sweep path metadata
grep -n "_validate_template_definition" app/handlers/servicer.py
```

---

### Step 32 — test: strategy template deep copy, atomicity, id collisions

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_templates.py` — create

**Reviewers**: `xstockstrat-analysis` owner.

**Codebase Evidence**: Step 31 citations; `RecordingStub`/`ctx_with` from `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: AC-13, AC-18, AC-19, AC-20, AC-34

**Instructions**:
- **AC-13 (strategy kind):** a non-admin `ManageTemplate` → `PERMISSION_DENIED`.
- **AC-18:** two formula template refs produce 2 private copies. The strategy is inactive and not
  live, its components point at the copies, and the intent is `FINALIZED`.
- **AC-19:** the indicators saga call fails. Assert the intent is `ABORTED`,
  `ResolveTemplateIntent(commit=False)` was called, and no strategy was created.
- **AC-20:** an existing `mean_reversion` gives `mean_reversion_2`; the existing row is untouched.
- **AC-34:** a caller `strategy_id` collision → `ALREADY_EXISTS` before any indicators call.
- **Blend:** a template whose final id equals the configured blend id → `FAILED_PRECONDITION` for a
  non-admin.
- **Sweep:** stale `PENDING` → `ABORTED`; `COMMITTED` → `FINALIZED`.
- **Saga metadata (`RecordingStub` indicators stub):**
  - request path: every `InstantiateTemplate` (saga form) and `ResolveTemplateIntent` call carries
    exactly one `x-user-id` equal to the caller, the caller's `x-access-scope`/`x-trace-id`, and
    `x-internal-caller: analysis-template-saga`;
  - sweep path: each `ResolveTemplateIntent` call carries `x-user-id` equal to the intent's
    `user_id` (seed two intents owned by alice and bob; assert per call), a non-empty `x-trace-id`,
    and `x-internal-caller: analysis-template-saga`;
  - no saga call carries `x-internal-caller: analysis`.
- **Template validation:** an admin `ManageTemplate CREATE` whose component references a formula
  template with declared output `upper` and a signal `z.upper` succeeds; an undeclared `z.lower` →
  `INVALID_ARGUMENT`; a component id with no active formula template → `INVALID_ARGUMENT`; a
  fundamentals-input formula template plus `source_symbol` → `INVALID_ARGUMENT`. No `GetFormula` call
  is recorded.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 33 — test: migration data assertions (run by CI `migration-rerun`)

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/migration-assertions/indicators-007.sql` — create
- `scripts/migration-assertions/ingest-013.sql` — create
- `scripts/migration-assertions/analysis-026.sql` — create
- `scripts/migration-assertions/fixtures-pre-224.sql` — create
- `scripts/migration-rerun.sh` — modify

**Reviewers**:
- DBA: run-order compliance, backfill correctness.
- `xstockstrat-ingest`, `xstockstrat-indicators`, `xstockstrat-analysis` owners.

**Codebase Evidence**:
- Step 3's `scripts/migration-rerun.sh` runs `scripts/migration-assertions/*.sql` with `psql -v
  ON_ERROR_STOP=1` after the replay.
- Migrations: Steps 6/13/18.

**TDD**: N/A (DB-backed assertions run only in the CI `migration-rerun` job; never bring up a DB in
`/sdd-execute`)

**Covers**: AC-15, AC-22, AC-27

**Instructions**:
1. **Restructure the rerun.** `scripts/db-migrate.sh` supports only `up | version | force`
   (`db-migrate.sh:64-112`; the `*)` fallback at `:108-111` rejects anything else), so it has no
   partial-version target. `migration-rerun.sh` (Step 3 file) therefore drives `migrate` directly for
   the partial pass:
   1. Enable the TimescaleDB extension and pre-create each schema, as `db-migrate.sh` does.
   2. For each service, render its migrations dir into a scratch dir with
      `scripts/render-migrations.sh <dir> <scratch>` (Step 3). For analysis, apply the existing
      analysis-013 `envsubst '$SEED_USER_ID'` render to the scratch copy as well, exactly as the
      `db-migrate.sh` `up` branch does (`:72-89`); the partial pass must not skip it.
   3. Use the per-service URL with `x-migrations-table=<schema>_schema_migrations` (same rule as
      `service_db_url`, `db-migrate.sh:34-46`). Run
      `migrate -path <scratch> -database <url> goto 6` (indicators), `goto 12` (ingest) and
      `goto 25` (analysis); every other service runs `migrate … up`.
   4. Load `fixtures-pre-224.sql`:
      - 8 `is_public=true` formulas by `user-a@example.test`, `user-b` and `system`;
      - 3 sources, including one `derived` `fundamentals`;
      - 120 signals spread across those sources;
      - matching `signal_dedup_keys`.
   5. Apply the rest with `scripts/db-migrate.sh up` (which renders the `-- requires-env` files), then
      continue with Step 3's replay (force 0 → `up`) and run the assertions. List
      `scripts/migration-rerun.sh` in this step's commit; it is the Step 3 file being extended.
2. **`indicators-007.sql`:** all 8 rows exist with unchanged `source`/`author`, `is_public` is false
   everywhere, no `is_public` index, and `formula_templates` is empty (AC-15/AC-22). Each assertion is
   a `DO $$ … RAISE EXCEPTION` on failure.
3. **`ingest-013.sql`:** every source and signal has `user_id` equal to the CI `SEED_USER_ID`, except
   the `fundamentals` source and its signals, which are `system` (AC-27). `source_templates` is empty.
   The `signal_dedup_claims` owners match their signals.
4. **`analysis-026.sql`:** `strategy_templates` is empty and `backtest_runs.user_id` has no NULLs.

**Verification**:
```bash
ls scripts/migration-assertions/*.sql
shellcheck scripts/migration-rerun.sh && shfmt -d -i 2 scripts/migration-rerun.sh
grep -n "goto 6\|goto 12\|goto 25\|render-migrations.sh" scripts/migration-rerun.sh
# Real execution: CI job `migration-rerun` (Step 3).
```

Coverage: N/A — no coverage tool for SQL or shell; the behavior gate is the CI `migration-rerun` job
running these `DO $$ … RAISE EXCEPTION` assertions.

---

### Step 34 — service: agent tools (drop public args, owner-scoped sources, template tools, tool count 45, docs parity)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify (tool-count surface)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (instruction 4's expected tool-name set; re-spec 2026-10-07)
- `services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature` — modify (C-16 CHANGE of
  `@feature-214 @AC-1` tool count)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `mcp-tools.md` parity;
tool-count statements in sync across all six inventory surfaces; no secret values in tool output.

**Codebase Evidence**:
- **Formula tools (`tools.py`).**
  - `manage_formula(..., is_public: bool | None = None, …)` (`:1004-1106`; `is_public` at `:1010,
    :1019, :1042, :1079, :1092`).
  - `get_formula` (`:1108`).
  - `list_formulas(author_filter="", include_public=True)` (`:1121-1130`).
- **Signal-source tool.**
  - `manage_signal_source` (`:1145-1241`) writes a **global** secret
    `mcp_credential.{slug}` (`:1217`) with `credentials_ref = f"ingest.{secret_key}"` (`:1229`).
  - It forwards `access_scope` (`:1213`).
- **Tool count.** "Forty-three tools" (`tools.py:4`), "the tool count stays forty-three" (`:52`).
- **Client (`client.py`).**
  - `manage_formula` sends `is_public`/`author` (`:1099-1100, :1117`).
  - `list_formulas(author_filter, include_public)` (`:1141-1157`).
  - `set_config(..., user_id="", is_secret=False)` (`:2006-2018`).
  - `_metadata(...)` binds the caller trio via `CallerPropagationMiddleware` (`tools.py:202`;
    `client.py:41-59`; AGENT-4 dedup form).
- **The other five count surfaces.**
  - `services/xstockstrat-agent/CLAUDE.md:43,49`.
  - `docs/runbooks/mcp-tools.md:3,10,45`, plus its per-tool sections (`manage_formula` `:565-592`,
    `list_formulas` `:635-644`).
  - `tests/test_tools_endpoint.py:15-` (the name set).
  - `services/xstockstrat-ui/src/lib/copilot.ts:19-21` (`COPILOT_MCP_TOOL_COUNT = 43`).
- **Durable suite.** `services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature:14`
  `And the advertised tool count is 43` (`@AC-1 @FR-1 @feature-214`, `:9-14`).
- **Stale per-user-secret and admin-gate text.**
  - Agent `CLAUDE.md:76` (`set_config` row: "per-user override; secrets are global-only") and
    `:161-162` ("Secret writes are **global-scope only** (a per-user secret write is rejected
    `INVALID_ARGUMENT` …)").
  - Agent `CLAUDE.md:97-109` § Management-tool authorization: "Two management **write** tools still hit
    a backend **admin** gate — `manage_signal_source` and `trigger_backfill`" and the ingest
    `ManageSignalSource`/`TriggerBackfill` ADMIN-bit sentence (`:104-105`).
  - `docs/runbooks/mcp-tools.md:669-671` (`manage_signal_source` "**Admin-scoped write** … a non-admin is
    rejected `PERMISSION_DENIED` by the ingest `ManageSignalSource` gate"), `:694` (`bearer_token` row:
    the global `ingest.mcp_credential.<slug>` key) and `:996` (`set_config` `user_id` row: "Secret keys
    are **global-only** — a per-user secret write is rejected `INVALID_ARGUMENT`").
- **strat-lab skill.** `plugins/strat-lab/skills/backtest/SKILL.md:122` references `manage_formula`.
  Root `CLAUDE.md` requires a same-PR skill update for `manage_strategy`-family changes.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Public arguments.** Remove `is_public` from `manage_formula` and its client builder (send nothing).
   Remove `include_public` from `list_formulas`, keeping `author_filter` documented as "admin-only owner
   selector". Drop `isPublic` from `get_formula` output.
2. **`manage_signal_source`.**
   - Remove admin wording. The caller manages their own sources.
   - For an `mcp_client` register, generate `secret_key = f"mcp_credential.{uuid.uuid4()}"` (an opaque
     key, design §8) and call `client.set_config(..., user_id=_caller_user_id(ctx,
     "manage_signal_source"), is_secret=True, create_key=True)`. Set
     `credentials_ref = f"ingest.{secret_key}"`.
   - Output still never includes `credentials_ref`/`bearer_token`. Add `user_id` and `origin` to the
     projection (`@feature-161 @AC-9` parity).
3. **New tools.**
   - `list_templates(kind: str)` (`"formula" | "strategy" | "signal_source"`) routes to the owning
     service's `ListTemplates`.
   - `instantiate_template(kind, template_id, strategy_id="", slug="", bearer_token="")`. For a
     `signal_source` kind with a bearer, run the same per-user secret-first flow and pass
     `credentials_ref`.
   - Both go through `client.*` with `_metadata()`, which carries the trio.
4. **Tool count 43 → 45 on all six surfaces.**
   - `tools.py:4,52` (add the two inventory lines).
   - Agent `CLAUDE.md:43,49`, plus a tool-table row each.
   - `mcp-tools.md:3,10,45`, plus new per-tool sections. Remove every `is_public`/`include_public`
     mention.
   - `test_tools_endpoint.py` name set.
   - `copilot.ts` → `COPILOT_MCP_TOOL_COUNT = 45` with a `→ 45 feature 224` comment.
   - `remove-agent-postgres-mcp.feature:14` → `And the advertised tool count is 45`. This is an
     operator-approved C-16 CHANGE of `@feature-214 @AC-1` (signed off 2026-10-07, `context.md`;
     `design.md` § Business Rules Touched). The `db_*` absence assertion (`:13`) is unchanged.
5. **Stale secret/admin text.**
   - Agent `CLAUDE.md:76` and `:161-162`: secrets may be per-user (feature 224 operator override of
     feature 147); redaction holds on every edge.
   - Agent `CLAUDE.md` § Management-tool authorization (`:97-109`): only `trigger_backfill` still hits
     the ingest admin gate. `manage_signal_source` is owner-gated (any caller manages their own sources;
     `system` sources are read-only).
   - `mcp-tools.md:669-671`: `manage_signal_source` is an owner-scoped write. `:694`: the bearer is
     written to an opaque per-user key `ingest.mcp_credential.<uuid>`. `:996`: per-user secret writes
     are accepted.
6. **`SKILL.md`.** Add `list_templates`/`instantiate_template` usage (start from a strategy template,
   then `run_backtest`). State that formulas are private to their author. Mention neither `is_public`
   nor `include_public`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -rn "is_public\|include_public" app docs 2>/dev/null; grep -n "is_public\|include_public" ../../docs/runbooks/mcp-tools.md ../../plugins/strat-lab/skills/backtest/SKILL.md   # → none
grep -n "forty-five\|45" app/tools.py CLAUDE.md ../../docs/runbooks/mcp-tools.md ../xstockstrat-ui/src/lib/copilot.ts
grep -n "tool count is 45" acceptance/remove-agent-postgres-mcp.feature
grep -n "global-only\|global-scope only\|mcp_credential.<slug>" CLAUDE.md ../../docs/runbooks/mcp-tools.md   # → none
grep -n "manage_signal_source\` and" CLAUDE.md   # → none (no longer listed as admin-gated)
```

---

### Step 35 — test: agent tool catalog and docs parity

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify
- `services/xstockstrat-agent/tests/test_template_tools.py` — create
- `services/xstockstrat-agent/tests/test_signal_source_builder.py` — modify

**Reviewers**: `xstockstrat-agent` owner.

**Codebase Evidence**:
- `test_tools_endpoint.py:15-40` asserts the exact `names` set from `GET /api/tools`.
- Header-count precedent: fails.md 2026-10-05 agent duplicate header (assert the header **count**
  under a bound caller).

**TDD**: `red-green required`

**Covers**: AC-25, AC-32

**Instructions**:
1. **AC-25.** The name set includes `list_templates` and `instantiate_template` (45 total).
   `manage_formula`'s input schema has no `is_public`; `list_formulas`'s has no `include_public`.
2. **AC-32.** Read `../../docs/runbooks/mcp-tools.md` and `../../plugins/strat-lab/skills/backtest/SKILL.md`.
   Assert that both contain both new tool names and neither contains `is_public`/`include_public`.
3. **Template tools.** Under a bound caller, the outbound metadata carries exactly one `x-user-id`.
   `instantiate_template(kind="signal_source", bearer_token=…)` calls `set_config` with
   `user_id=<caller>`, `is_secret=True` and a `mcp_credential.<uuid>` key. The returned dict has no
   bearer.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 36 — service: UI removes public formula controls; formula BFF follows header identity

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/formulas/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/formulas/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useFormulas.ts` — modify
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety.

**Codebase Evidence**:
- **Formulas list page** (`formulas/page.tsx`): `useFormulas({ includePublic: true, … })` `:31`;
  visibility filter `:41-42`; Public/Private column + Badge `:74-78`; "Public only" select item `:131`.
- **Formula detail and editor.** `formulas/[id]/page.tsx:63` `initialIsPublic={formula.isPublic}`.
  `FormulaWorkspace.tsx` `initialIsPublic`/`isPublic` state, badge, save payload and checkbox
  (`:71,:83,:110,:127,:256,:304,:366-370`).
- **Hook.** `useFormulas.ts` `includePublic` default true `:29`; `isPublic` in register/update
  `:51,:63,:84,:96`.
- **Wizard.** `StrategyWizard.tsx:112` and `ComponentEditor.tsx:63`
  `useFormulas({ includePublic: true, pageSize: 50 })`.
- **BFF.** `insightsBff.ts:156-163` `registerFormula` overrides `author` from claims (dead after FR-2);
  `forward` precedent at `:165`.
- C-17: use tokens and the existing `Badge` variants; `DataTable` is already used.

**TDD**: N/A (frontend; covered by Step 39 e2e)

**Covers**: —

**Instructions**:
1. Remove the visibility filter state, the select and the Public/Private column from
   `formulas/page.tsx`. The list is the caller's own formulas plus system formulas, with a read-only
   "System" `Badge` when `author === 'system'`. When `origin` is present, show an "Update available"
   `Badge` if `origin.updateAvailable`.
2. Remove `initialIsPublic`/`isPublic` (prop, state, badge, checkbox, payload) from
   `FormulaWorkspace.tsx` and `[id]/page.tsx`.
3. In `useFormulas.ts`, drop the `includePublic`/`isPublic` params and payload fields.
4. In `StrategyWizard.tsx`/`ComponentEditor.tsx`, call `useFormulas({ pageSize: 50 })`.
5. Replace `registerFormula` in `insightsBff.ts` with
   `forward((req, opts) => indicatorsClient.registerFormula(req, opts))`; the backend takes the author
   from `x-user-id`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && npx tsc --noEmit
grep -rn "isPublic\|includePublic" src --include=*.ts --include=*.tsx | grep -v "\.test\."   # → none
```

---

### Step 37 — service: UI template catalog, "use template", wizard start-from-template, admin authoring, nav

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/templates/page.tsx` — create
- `services/xstockstrat-ui/src/app/config-ui/templates/page.tsx` — create
- `services/xstockstrat-ui/src/hooks/useTemplates.ts` — create
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify (update-available badge)
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify (register template RPCs; import
  `indicatorsClient` from `@/lib/connectClients`)
- `services/xstockstrat-ui/src/lib/browserClients/configUiIndicatorsClient.ts` — create (config-ui
  browser client for the indicators template RPCs)
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

No `browserClients/indicatorsClient.ts` change: it is a `createClient(IndicatorsService, …)` bound to
`/insights/api`, so the new RPCs appear on it once Step 2 regenerates the stubs. The same holds for
`analysisClient.ts` and `insightsIngestClient.ts` (both `/insights/api`). No `connectClients.ts`
change: the server-side `indicatorsClient` already exists (`connectClients.ts:109`).

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, config mutation safety.

**Codebase Evidence**:
- **Rendered nav.** `NAV_GROUPS` (`navGroups.tsx:39-104`), Engine group items `:58-70`, `adminOnly`
  flag (`:19-21`). `PLATFORM_SUBNAV` is legacy and inert (`PlatformHeader.tsx:69-95`), registered only
  for C-10(a) wording (design §10).
- **BFF dispatch.** `router.service(<Service>, {...})` with `forward`/`forwardAdmin`
  (`insightsBff.ts:31-178`; `bffShared.ts` `forward:64`, `forwardAdmin:80`, `requireAdminScope:47`).
  `createDispatch(router, '/insights/api')` (`:177`). The config-ui router registers only explicit
  methods (`configUiBff.ts:24-80`).
- **Config-ui server clients.** `configUiBff.ts:7` imports `configClient, ingestClient,
  analysisClient, identityClient` from `@/lib/connectClients`; `indicatorsClient` is exported there
  (`connectClients.ts:109`) but not yet imported by the config-ui BFF, and no `IndicatorsService` is
  registered on the config-ui router.
- **Browser-client pattern.** One file per (service, segment), each
  `createClient(<Service>, makeBrowserTransport('<segment>/api'))`:
  - `browserClients/indicatorsClient.ts:5` → `/insights/api`;
  - `browserClients/configUiAnalysisClient.ts:7` → `/config-ui/api` (the config-ui twin of the
    insights `analysisClient.ts`);
  - `browserClients/ingestClient.ts:5` → `/config-ui/api`.

  The config-ui templates page therefore uses `configUiAnalysisClient`, `ingestClient` and a new
  `configUiIndicatorsClient`.
- **Admin detection.** `useIsAdmin` (`hooks/useLiveStrategies.ts:60`).
- C-17 primitives: `DataTable`/`EmptyState`/`FormDialog`/`QueryStateMessages` (design §10).

**TDD**: N/A (frontend; covered by Step 39 e2e)

**Covers**: —

**Instructions**:
1. **Insights BFF.** Register `listTemplates` (`forward`) and `instantiateTemplate` (`forward`) on
   `IndicatorsService`, `IngestService` and `AnalysisService`.
2. **Config-ui BFF.** Register `listTemplates` (`forward`) and `manageTemplate` (`forwardAdmin`) for all
   three services. Backend re-checks the ADMIN bit.
   - Add a `router.service(IndicatorsService, { listTemplates, manageTemplate })` block, and add
     `indicatorsClient` to the `@/lib/connectClients` import (`configUiBff.ts:7`) plus the
     `IndicatorsService` proto import.
   - Extend the existing `IngestService` (`:52-55`) and `AnalysisService` (`:59-61`) blocks, and
     update the "Only the admin-scoped manual producer trigger is exposed" comment (`:57-58`).
   - Create `browserClients/configUiIndicatorsClient.ts`, mirroring `configUiAnalysisClient.ts`:
     `createClient(IndicatorsService, makeBrowserTransport('/config-ui/api'))`, exported as
     `configUiIndicatorsClient`.
3. **`useTemplates.ts`.** List per kind; an instantiate mutation that returns the new object id.
4. **`/insights/templates`.**
   - Tabs (formula / strategy / signal source) over a `DataTable`, with `EmptyState` (the catalog
     starts empty).
   - A "Use template" button with a unique accessible name ("Use template <name>").
   - Instantiate, then `router.push` to the new formula, strategy or source.
   - A signal-source template of type `mcp_client` is **not** instantiable from this step's page
     (its "Use template" is disabled with an explanatory tooltip). Step 38 adds the bearer prompt,
     because the per-user secret-write hook and the insights `setConfig` handler land there. This
     step has no forward dependency on Step 38.
5. **`StrategyWizard.tsx`.** A "Start from template" entry lists strategy templates and instantiates
   them, with an optional strategy id.
6. **Update-available badge** on the strategy detail page when `definition.origin?.updateAvailable`.
7. **`/config-ui/templates`** (admin): create, edit and retire per kind via `FormDialog`, with the
   payload as structured fields per kind. Non-admins see `CardNotice` "Admin only".
8. **Nav.** In `NAV_GROUPS`, add `{ label: 'Templates', href: '/insights/templates' }` to Engine and
   `{ label: 'Templates', href: '/config-ui/templates', adminOnly: true }` to Settings. Mirror both in
   `PLATFORM_SUBNAV.insights` / `.config`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && npx tsc --noEmit && pnpm run lint:dup
grep -n "insights/templates\|config-ui/templates" src/components/shared/navGroups.tsx src/components/shared/PlatformHeader.tsx
grep -n "IndicatorsService\|indicatorsClient" src/lib/configUiBff.ts
ls src/lib/browserClients/configUiIndicatorsClient.ts
```

---

### Step 38 — service: UI per-user signal sources page, per-user secret write, admin read-only view

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/signal-sources/page.tsx` — create
- `services/xstockstrat-ui/src/hooks/useOwnSignalSources.ts` — create
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify (becomes the admin read-only view)
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts` — modify
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSources.ts` — modify
- `services/xstockstrat-ui/src/app/insights/templates/page.tsx` — modify (enable `mcp_client` source
  templates: bearer prompt, moved here from Step 37)
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, no secret values rendered in UI.

**Codebase Evidence**:
- **Existing page.** `config-ui/sources/page.tsx` (756 lines) holds today's create form with weight
  guidance and the inline weight editor (`@feature-161 @AC-4/@AC-5`).
- **Existing hooks.**
  - `useSignalSourceMutations.ts:9-21` `useManageSignalSource`.
  - `useRegisterMcpClientSource` writes the **global** key `mcp_credential.${slug}` via
    `configClient.setConfig` with `value: { …, isSecret: true }` and `createKey: true` (`:29-54`).
  - `SetConfigRequest.create_key = 8`; the secret flag is `ConfigValue.is_secret = 6`
    (`config.proto:68,132`).
  - `useSignalSources.ts:5-19` lists via `ingestClient.listSignalSources({ includeInactive: true })`.
- **Transports.** The browser `ingestClient` uses `/config-ui/api` (`browserClients/ingestClient.ts:5`);
  `insightsIngestClient.ts` exists for `/insights/api`.
- **BFFs.**
  - Config-ui `setConfig` is admin-only (`configUiBff.ts:27-49`); config-ui ingest registers
    `listSignalSources`/`manageSignalSource` (`:52-55`).
  - Insights ingest registers only `listSignalSources`/backfills (`insightsBff.ts:73-88`).
  - Insights `ConfigService` registers only `getConfig` (`insightsBff.ts:151-154`); the browser
    `insightsConfigClient` is bound to `/insights/api` (`browserClients/insightsConfigClient.ts:7`).
- **Nav.** The Engine item `{ label: 'Signal sources', href: '/config-ui/sources' }`
  (`navGroups.tsx:67`).
- **Ledger.** insights.md 2026-08-21 config-secrets-and-scoping: clamp a per-user scope to the session
  user **server-side**.
- **Admin users.** The `identityClient.listUsers` admin forward exists (`configUiBff.ts:66`).

**TDD**: N/A (frontend; covered by Step 39 e2e)

**Covers**: —

**Instructions**:
1. **Insights BFF.**
   - Register `IngestService.manageSignalSource` (`forward`).
   - Register a `ConfigService.setConfig` handler that forces
     `{ ...req, userId: claims.user_id, environment: nativeConfigEnvironment(), author: claims.user_id, createKey: true, value: { ...req.value, isSecret: true } }`.
     Forcing `isSecret: true` and `createKey: true` server-side means a client can never store the
     bearer in plaintext under an `ingest.mcp_credential.*` key, whatever it sends.
   - It rejects any request whose `namespace !== 'ingest'` or whose key does not start with
     `mcp_credential.` (per-user secret write only; the backend's owner-only gate re-checks).
2. **`/insights/signal-sources`.**
   - Move the create form (with reliability-weight guidance) and the inline weight editor from
     `config-ui/sources/page.tsx`. This is the CHANGE re-home of `@feature-161 @AC-4/@AC-5`, signed off.
   - Use `insightsIngestClient` for the BFF calls.
   - Rows with `userId === 'system'` render read-only, with no edit or deactivate controls (C-10(c)).
   - The `mcp_client` register writes the per-user secret with an opaque key
     `mcp_credential.${crypto.randomUUID()}` and then registers with `credentialsRef`.
3. **`useSignalSourceMutations.ts`.** Retarget `useRegisterMcpClientSource` to the insights transports
   (`insightsConfigClient`, `insightsIngestClient`) and the opaque per-user key.
4. **`/insights/templates` (from Step 37).** Enable "Use template" for `mcp_client` source templates:
   prompt for the bearer via `FormDialog`, write it through the same per-user secret path as item 3
   (opaque `mcp_credential.${crypto.randomUUID()}` key), then call ingest `instantiateTemplate` with
   `credentialsRef`. The bearer is never rendered back.
5. **`/config-ui/sources`** becomes the FR-13 admin read-only view:
   - a user `Select` (from `listUsers`) → `listSignalSources({ includeInactive: true, ownerUserId })`;
   - **no** create, edit, deactivate or weight controls;
   - non-admins see `CardNotice`;
   - **no** credential or bearer is ever rendered.
6. **Nav.**
   - Change the Engine item to `{ label: 'Signal sources', href: '/insights/signal-sources' }`.
   - Add `{ label: 'Signal sources (admin)', href: '/config-ui/sources', adminOnly: true }` to Settings.
   - Mirror both in `PLATFORM_SUBNAV`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && npx tsc --noEmit && pnpm run lint:dup
grep -n "mcp_credential" src -r   # opaque randomUUID key only; no `${slug}` key
grep -n "insights/signal-sources" src/components/shared/navGroups.tsx
grep -n "isSecret: true\|createKey: true" src/lib/insightsBff.ts   # forced server-side
```

---

### Step 39 — test: UI e2e (public UI removed, templates, signal sources, nav, BFF traversal)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/templates.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/signalSources.ts` — modify (add `userId`, a system source)
- `services/xstockstrat-ui/e2e/fixtures/formulas.ts` — modify (drop `isPublic`)
- `services/xstockstrat-ui/e2e/fixtures/index.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/playwright.config.ts` — modify (`INDICATORS_ENDPOINT`)
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/templates.spec.ts` — create
- `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` — create
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/api-smoke.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify (config-ui `ManageTemplate`
  smoke check)

**Reviewers**: `xstockstrat-ui` owner.

**Codebase Evidence**:
- **Nav test.** `nav-reachability.spec.ts:21-60` hard-codes `GROUPS`, including
  `{ label: 'Signal sources', href: '/config-ui/sources' }`.
- **Mock backend.**
  - `mock-backend.ts:1-12`: port 9092 serves Analysis, Identity, Trading and Portfolio; 9093 serves
    Config, Identity and Ingest.
  - `router.service(AnalysisService` at `:813`, `IngestService` at `:1347`.
  - IndicatorsService is not mocked; specs use `page.route` (recon).
- **Playwright env.** `ANALYSIS_ENDPOINT` 9092, `CONFIG_ENDPOINT`/`INGEST_ENDPOINT` 9093, no
  `INDICATORS_ENDPOINT` (`playwright.config.ts:147-157`).
- **BFF traversal precedent.** `api-smoke.spec.ts:131-150` asserts status 200 through the real BFF
  (fails.md 2026-10-05: a `page.route` mock is no evidence the route exists).
- **Config-ui smoke suite.** `e2e/config-ui/api-smoke.spec.ts` already holds the `/config-ui/api/...`
  router-traversing checks (`SET_CONFIG_BFF` at `:20`, admin-only denial case at `:188`), so config-ui
  BFF checks belong there, not in the insights suite.
- **Fixtures.** `INVENTORY.md:25` (`FORMULAS`) and `:79` (`SIGNAL_SOURCES`); C-12.
- **CHANGE rules.** `acceptance/surface-signal-weight-decay-config.feature:8-18`.

**TDD**: `red-green required` (e2e asserts the new pages and removed controls; red before Steps 36–38)

**Covers**: AC-24

**Instructions**:
1. **Fixtures (C-12).**
   - `templates.ts` exports `FORMULA_TEMPLATE_ZSCORE`, `STRATEGY_TEMPLATE_MEANREV`,
     `SOURCE_TEMPLATE_NEWSLETTER` and `TEMPLATES`, with Connect-JSON shapes and an `INVENTORY.md` row.
   - Add a `system` source and `userId` to `signalSources.ts`.
   - Drop `isPublic` from `formulas.ts`.
2. **Mock backend.**
   - Add `ListTemplates`/`InstantiateTemplate`/`ManageTemplate` handlers to `AnalysisService` (9092) and
     `IngestService` (9093).
   - Add an `IndicatorsService` router on 9092 with only `ListTemplates`/`InstantiateTemplate`/`ManageTemplate`,
     and set `INDICATORS_ENDPOINT: '127.0.0.1:9092'`.
   - Add `ManageSignalSource` owner semantics on 9093 and a `ConfigService.setConfig` capture on 9093.
3. **AC-24.** In `formulas.spec.ts`, no "Public" checkbox, badge or filter is rendered.
   `templates.spec.ts` asserts:
   - the Engine "Templates" nav entry is visible;
   - the catalog lists `TEMPLATES` with "Use template <name>";
   - clicking it navigates to the created object;
   - an "Update available" badge is shown for an instance with `updateAvailable`.
4. **`signal-sources.spec.ts`.**
   - The `@feature-161 @AC-4/@AC-5` assertions run on `/insights/signal-sources`: weight persisted, and
     guidance text visible in both the form and the inline editor.
   - The system row is read-only.
   - The `mcp_client` register sends `setConfig` with key `mcp_credential.<uuid>` and `isSecret`.
   - **Server-forced secret flag (Step 38 item 1):** a direct `POST` to
     `/insights/api/xstockstrat.config.v1.ConfigService/SetConfig` with an `ingest`
     `mcp_credential.<uuid>` key and `value.isSecret: false` (and `createKey: false`) reaches the
     mock `setConfig` capture with `isSecret: true`, `createKey: true` and `userId` equal to the
     session user. A non-`ingest` namespace or a key outside `mcp_credential.` is rejected.
5. **`config-ui/sources.spec.ts`.** Admin read-only: no create, edit or deactivate controls, and the
   user selector drives `ownerUserId`.
6. **`nav-reachability.spec.ts`.** Update `GROUPS`:
   - Engine "Signal sources" → `/insights/signal-sources`;
   - add Engine "Templates";
   - add Settings "Templates" (admin) and "Signal sources (admin)".
7. **`e2e/insights/api-smoke.spec.ts`.** Add router-traversing (no `page.route`) status-200 checks
   for:
   - `/insights/api/xstockstrat.analysis.v1.AnalysisService/ListTemplates`;
   - `/insights/api/xstockstrat.indicators.v1.IndicatorsService/InstantiateTemplate`;
   - `/insights/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource`.
8. **`e2e/config-ui/api-smoke.spec.ts`.** Add the router-traversing status-200 check for
   `/config-ui/api/xstockstrat.analysis.v1.AnalysisService/ManageTemplate` (admin cookie), plus a
   non-admin denial case in the style of the existing `SetConfig` one (`:188`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/insights/templates.spec.ts e2e/insights/signal-sources.spec.ts
grep -n "templates" e2e/fixtures/INVENTORY.md
grep -n "ManageTemplate" e2e/config-ui/api-smoke.spec.ts
```

Coverage: N/A — Playwright e2e has no coverage tool (vitest coverage is scoped to `src/lib/**`); the
behavior gate is `pnpm test:e2e` over these specs.

---

### Step 40 — docs: context teardown, conventions, and the C-16 CHANGE route update

**Status**: `done`
**Service**: `docs/`, service `CLAUDE.md` files
**Files**:
- `CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/patterns/database.md` — modify
- `services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- **Root `CLAUDE.md:328`.** The stale line `xstockstrat-indicators → xstockstrat-ingest (QuerySignals
  for signal-aware formulas)`; indicators has no ingest caller (context.md round 4, verified).
- **Ingest `CLAUDE.md:11`.** "…for consumption by indicators and analysis" (stale).
- **Ingest `CLAUDE.md:31-32` § Authorization.** "`TriggerBackfill` …, `CancelBackfill`, and
  `ManageSignalSource` are **admin-gated**" — `ManageSignalSource` stops being admin-gated for headered
  callers (Step 19); the two backfill RPCs stay admin-gated.
- **Ingest `CLAUDE.md:99-103`.** The `mcp_client` bearer note describes a per-source **global** key
  `ingest.mcp_credential.<slug>` written by the "config-ui two-write"; it becomes an opaque per-user key
  `ingest.mcp_credential.<uuid>` resolved as the source owner (Steps 23, 34, 38).
- **Analysis `CLAUDE.md:76`.** Fundsignal source registration: "This call is admin-scoped; the
  background path injects the admin bit, the RPC path forwards the caller's scope" — replaced by the
  SAN-bound `system` identity (Step 7). (`:77` "the admin-scoped `RunFundamentalsScan` RPC" stays true.)
- **Analysis `CLAUDE.md:25-26`.** "(The `strategy_scores` cache stays keyed by bare `strategy_id` — a
  derived cache cross-checked for ownership at the RPC layer, feature 133 D-2.)" — superseded by
  `strategy_scores_v2` keyed `(user_id, strategy_id)` (Steps 6, 9).
- **Indicators `CLAUDE.md`.**
  - § Role describes `is_public` and `_INTERNAL_FORMULA_READERS` header-only reads.
  - § Seeded Formulas calls the seeded formula "**public**".
  - § Database migration list skips `005` (recon Risk 18).
  - § Dependencies lacks ledger.
- **Secrets wording.** `docs/patterns/config-governance.md:10` and config `CLAUDE.md:38` say "Secrets
  stay/remain global-only".
- **Durable suite.** `acceptance/surface-signal-weight-decay-config.feature:8-18` names "config-ui
  Signal Sources" (the CHANGE signed off 2026-10-06).
- Root `CLAUDE.md` § Teardown requires the `/context-forge:context-constitution refresh` audit.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. **Root `CLAUDE.md`.** Delete the stale indicators→ingest line. Add `xstockstrat-indicators →
   xstockstrat-ledger (audit.admin_read)` to § Inter-Service Dependencies.
2. **Ingest `CLAUDE.md`.**
   - Fix the "consumption by indicators" claim.
   - Record the ownership convention: `user_id='system'` is a reserved owner, writable only via the
     SAN-bound `analysis-fundsignal` grant, and system slugs are reserved (C-10(c)).
   - Document `SignalScope`, the per-owner dedup (`signal_dedup_claims`) and the N-only headerless
     tolerance.
   - § Authorization (`:31-32`): drop `ManageSignalSource` from the admin-gated list (owner-gated for
     headered callers; headerless N keeps the admin gate); `TriggerBackfill`/`CancelBackfill` stay.
   - `mcp_client` bearer note (`:99-103`): opaque per-user key `ingest.mcp_credential.<uuid>`,
     resolved via `GetSecret(user_id=<owner>)` under the SAN-bound grant; a `LEGACY_GLOBAL` row (only if
     Step 18 shipped it) keeps the global key.
3. **Indicators `CLAUDE.md`.**
   - Rewrite § Role: owner/system-only reads, header-only author, admin audited read-only, and the
     SAN-bound N-only analysis reader.
   - Fix § Seeded Formulas ("system", not "public").
   - Complete the migration list (`005`, `007`) and add the ledger dependency.
4. **Analysis `CLAUDE.md`.** Owner-keyed tables, templates and saga, the fundsignal `system` identity
   and fail-closed scoring.
   - Rewrite `:76`: the producer registers its source as the SAN-bound `system` identity
     (`x-internal-caller: analysis-fundsignal`), not an injected admin bit.
   - Rewrite the feature-133 note at `:25-26`: scores are cached in `strategy_scores_v2` keyed
     `(user_id, strategy_id)`; the bare-id `strategy_scores` table is retained only for N-1 and dropped
     by the follow-up.
   - Record the saga's dedicated `analysis-template-saga` caller id (Steps 27/31).
5. **Config `CLAUDE.md` and `config-governance.md`.** Per-user secrets (feature 224 operator override
   of feature 147), exact-scope `GetSecret`, and the SAN-bound ingest grant.
6. **`database.md`.** The `-- requires-env:` and `-- contract-of:` migration headers, plus the
   `migration-rerun`/`migration-contract-gate` CI jobs.
7. **`surface-signal-weight-decay-config.feature`.** Change "config-ui Signal Sources" to
   "`/insights/signal-sources`" in `@AC-4`/`@AC-5` (route only; assertions unchanged — C-16 CHANGE
   sign-off).
8. Run `/context-forge:context-constitution refresh` scoped to these files and fix the grounded drift.
   If the plugin is unavailable, do the manual reconciliation and record it in the PR body.

**Verification**:
```bash
grep -n "xstockstrat-indicators → xstockstrat-ingest" CLAUDE.md                     # → none
grep -n "global-only" docs/patterns/config-governance.md services/xstockstrat-config/CLAUDE.md   # → none
grep -n "insights/signal-sources" services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature
grep -n "global-only\|global-scope only\|injects the admin bit\|keyed by bare\|mcp_credential.<slug>" \
  services/xstockstrat-ingest/CLAUDE.md services/xstockstrat-analysis/CLAUDE.md   # → none
grep -n "admin-gated" services/xstockstrat-ingest/CLAUDE.md
#   → read each hit: only TriggerBackfill/CancelBackfill may remain; no ManageSignalSource mention
```

---

### Step 41 — docs: create follow-up feature "224 enforce + contract" and its merge-order row

**Status**: `done`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/<NNN>-private-by-default-enforce-contract/status.md` — create (via `/sdd-story`)
- `docs/roadmap/features/<NNN>-private-by-default-enforce-contract/feature.md` — create (via `/sdd-story`)
- `docs/roadmap/features/<NNN>-private-by-default-enforce-contract/product-spec.md` — create (via `/sdd-story`)
- `docs/roadmap/features/<NNN>-private-by-default-enforce-contract/acceptance.feature` — create (via `/sdd-story`)
- `docs/roadmap/features/<NNN>-private-by-default-enforce-contract/context.md` — create (via `/sdd-story`)
- `docs/roadmap/features/merge-order.md` — modify

`<NNN>` is resolved at `/sdd-story` time as `max(existing NNN) + 1` (root `CLAUDE.md` § Feature
Roadmap numbering rule). The resolved number is recorded in this spec's Deviation Log.

**Reviewers**: none

**Codebase Evidence**:
- `design.md` Open Risks: "Follow-up '224 enforce + contract' must be created (number at its
  /sdd-story) with a `merge-order.md` row". Its scope: fail-closed headerless,
  `_INTERNAL_FORMULA_READERS` removal, `backtest_runs.user_id` NOT NULL, dropping the N-1 triggers, old
  tables and `strategy_scores`, refusing downs, deleting `LEGACY_GLOBAL`.
- `merge-order.md` rows 71-72 show the row format.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Run `/sdd-story private-by-default-enforce-contract` with the scope above. It creates the five files
   listed in Files. NNN = `max(existing NNN) + 1` at run time; record the resolved number in the
   Deviation Log below.
2. Add a `merge-order.md` row: the follow-up waits for 224 to be **launched**, and its contract
   migrations carry `-- contract-of:` headers enforced by the Step 3 CI gate. The row also
   **pre-reserves** the follow-up's contract migration numbers: analysis `027`, indicators `008`,
   ingest `014` (the next free number after 224's `026`/`007`/`013`). Re-verify them with a
   `git ls-tree` scan of every remote branch when the follow-up runs `/sdd-spec`.

**Verification**:
```bash
ls docs/roadmap/features/*-private-by-default-enforce-contract/{status.md,feature.md,product-spec.md,acceptance.feature,context.md}
grep -n "private-by-default-enforce-contract" docs/roadmap/features/merge-order.md
grep -n "027\|008\|014" docs/roadmap/features/merge-order.md | grep "enforce-contract"   # reserved numbers
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### D-1 — Step 1: buf run via Docker
- **Expected**: `buf lint` / `buf breaking` from a host `buf` binary.
- **Actual**: buf is not on the host; ran `bufbuild/buf:1.72.0` (the pinned version) in Docker, and `breaking` against `.git#ref=HEAD,subdir=packages/proto`.
- **Disposition**: CI-equivalent fallback.

### D-2 — Step 3: `scripts/Dockerfile.migrate` copies `render-migrations.sh`
- **Expected**: Step 3 Files did not list `scripts/Dockerfile.migrate`.
- **Actual**: `db-migrate.sh` now calls `scripts/render-migrations.sh`. The migrator image (DO prod and dev PRE_DEPLOY jobs, and docker-compose `db-migrator`) copied only `db-migrate.sh`, so every deploy's migrator would have failed. Added one `COPY scripts/render-migrations.sh` line. Step 4's `render-migrations.test.sh` (e) asserts it, and the `migrations` CI filter now includes `scripts/Dockerfile.migrate`.
- **Disposition**: operator-approved scope expansion (2026-10-07, blocker gate, option A).

### D-3 — Step 3: `migration-rerun` replays through the dirty-recovery path
- **Expected**: "force every service to version 0 and run `db-migrate.sh up` again".
- **Actual**: the script marks each `<schema>_schema_migrations` row `dirty`, so `db-migrate.sh`'s own dirty branch runs `force 0` and the replay. That is the exact production recovery path, not a parallel reimplementation. The job runs inside the `Dockerfile.migrate` image (migrate + psql + envsubst) against a `timescaledb:latest-pg16` service container.
- **Disposition**: implementation detail within scope.

### D-4 — Step 7: evaluator call site was `_load_benchmark_bars`, not `_replay_state`
- **Expected**: apply `for_owner` in `_replay_state`.
- **Actual**: `_replay_state` is pure and never calls the evaluator. The evaluator call it meant is in `_load_benchmark_bars`, so `for_owner` is applied there and in `_eval_pair`.
- **Disposition**: spec text error; intent honored.

### D-5 — Step 7: lazy own-signal drain, shared identity constants, attribution fails closed
- **Own-signal drain**: an owner's own signals are drained only when that owner has a signal-eligible, non-blend strategy, which is the only consumer. The system drain still runs once per cycle.
- **Shared constants**: `SYSTEM_IDENTITY = "system"` and `_FUNDSIGNAL_CALLER` are shared constants (DRY) rather than repeated literals.
- **Attribution**: if `ListSignalSources` fails, the visible set is empty, so the response returns no attribution instead of falling back to raw slugs.
- **Pre-flight**: runs after the `dry_run` return and before the `force` DELETE.
- **Disposition**: within scope; the decision 7 filter fails closed.

### D-6 — Step 8: `tests/test_entry_backfill.py` modified (not in Files)
- **Actual**: Step 7 renames `_drain_signals` to `_drain_system_signals` + `_drain_owner_signals`. The existing fake loop in `test_entry_backfill.py` stubbed the old name and would fail without updating.
- **Disposition**: required test-fixture follow-through for an in-scope rename; no behavior change asserted.

### D-7 — Step 8: guard accepts `analysis-system-read` as well as `analysis-fundsignal`
- **Actual**: Step 7 itself specifies the SAN-bound `analysis-system-read` grant for the live-loop system drain, so the stub-level guard permits `x-user-id: system` only with either grant. Owner calls must carry no stub-level grant.
- **Disposition**: consistent with Step 7.

### D-8 — Step 9: audit per-page owner cap = 100; boot recompute needs owner evidence; ownerless runs
- **Audit cap**: neither analysis nor ingest has a maximum page size, so the "K ceiling = max page size" cap is the named constant 100, the platform's default list page size.
- **Boot recompute**: `list_unscored_pairs` selects ambiguous pairs that have no v2 score **and** have owner evidence cells. Otherwise pairs that can never score would take the 50 slots on every boot and the rest would never be reached.
- **Ownerless run**: a `RunBacktest` with no caller id is still stored ownerless, as before. The owner-filtered retention DELETE never matches it.
- **Disposition**: within scope; fixed constants per the round-5 ruling.

### D-9 — Step 9: admin `GetBacktest` of another owner's run is DENIED (operator decision)
- **Expected**: the spec cross-references "admin foreign reads follow item 6".
- **Actual**: FR-13's admin read view lists formulas, strategies, signal sources and signals, not backtests. Operator decision (2026-10-07, checkpoint 2): deny, matching the spec literally. `GetBacktest` on any non-owned or ownerless run returns `PERMISSION_DENIED` for everyone, admins included, and emits no audit event. A missing run is still `NOT_FOUND`.
- **Disposition**: operator decision.

### D-10 — Step 9: Verification grep quoting
- **Actual**: the spec's `grep -n "strategy_scores_v2\|user_id = \$"` puts `\$` inside double quotes, which the shell turns into an end-of-line anchor, so the grep can never match. I ran it with single quotes; the owner predicates match at `backtest_run_symbols.py`, `backtest_details.py` and `backtest_runs.py`.
- **Disposition**: verification-command defect; the equivalent check passed.

### D-11 — Step 10: `tests/test_analysis_servicer.py` modified (not in Files)
- **Actual**: 11 existing assertions followed the new `(user_id, strategy_id)` keys and the repo signatures (upsert argument shift, hydrate rows gain `user_id`, the `GetBacktest` fake returns `(bytes, owner)`). No assertion was weakened.
- **Disposition**: required follow-through for in-scope signature changes.

### D-12 — Step 11: warning logged inside the evaluator; AC-30 rejection names the unreadable formula first; UPDATE warnings cover the request's components
- **Logging**: instruction 4 says to log at each surface and in the live loop, but `live_loop.py` is not in Step 11's Files. The warning is logged once per formula per evaluator, at the NOT_FOUND catch, so every surface, the live loop included, gets it without duplication. `unreadable_formulas` is still exposed to callers.
- **AC-30 rejection**: a rejected write returns no definition to carry a warning, so the `INVALID_ARGUMENT` message puts the unreadable-formula warning ahead of the "unknown series" reason. The spec only said to compute the warning before the rejection.
- **UPDATE scope**: UPDATE warnings cover only the request's components, matching `_refuse_deleted_bindings`.
- **Disposition**: within scope.

### D-13 — Step 12: helper rename follow-through in two existing tests
- **Actual**: Step 11 renames `_deleted_formula_warnings` to `_formula_status_warnings(include_unreadable=…)`. Updated the call sites in `tests/test_analysis_servicer.py` (2) and `tests/test_owner_header_guard.py` (1). No assertion changed.
- **Disposition**: required follow-through for the rename.

### D-14 — Step 13: `pending_intent_id` column added; rollback note on N-1 `ListFormulas`
- **Actual**: 007 also adds `pending_intent_id UUID` with a partial index. These are the pending-hidden saga rows the design requires (§6), which Step 14's `pending_intent_id IS NULL` read filter and Step 27 use.
- **Rollback note (accepted)**: after 007 sets `is_public = FALSE`, an N-1 indicators `ListFormulas(include_public=true)` no longer returns system formulas, because its SQL keys on `is_public = TRUE`. N-1 `GetFormula`/`ExecuteFormula` still read them via `author == 'system'` (N-1 `_can_read_formula`). The N-1 seed also re-upserts the fundamentals formula's `is_public`. The impact is limited to list discovery during a rollback window.
- **Disposition**: within scope; documented risk.

### D-15 — Step 14: `list_owned` repo method; `is_public` stored false on every update
- **Actual**: the admin owner selector needs an owner-only listing, so `FormulasRepository` gains `list_owned(author, …)` alongside `list_visible(reader, …)`, both also on the no-DB path. `is_public` is no longer an update-mask path and is stored false on every update, not only on full replaces.
- **Disposition**: within scope.

### D-16 — Step 15: follow-through edits to existing indicators tests
- **`test_formulas.py`**:
  - body-author-wins → body author ignored;
  - admin-override update/delete success → `PERMISSION_DENIED` with no repo call;
  - masked update `is_public` True → False;
  - `repo.list(…)` → `repo.list_visible(…)`.
- **`test_fundamentals_formula.py`** (not in Files): `IS_PUBLIC is True` → `is False`, required by the seed change.
- **`test_formula_read_authz.py`**: the `author_public_only` list tests are removed because that path no longer exists; AC-2 coverage moved to `test_private_formulas.py`.
- **Disposition**: required by the intended behavior change; no assertion weakened beyond it.

### D-17 — Step 16: verification grep still matches one unrelated test name
- **Expected**: `grep -rn "internal_caller\|InternalCallerInterceptor" app tests` returns no matches.
- **Actual**: one match remains, `test_internal_caller_metadata_appended_not_replaced` (`tests/test_fundsignal_loop.py`). It is a fundsignal-grant test, unrelated to the deleted interceptor, and that file is outside Steps 16/17. The module and its tests are fully removed.
- **Disposition**: false positive on a test name; left unchanged to keep scope surgical.

### D-18 — Step 17: indicators-header check not applied to `test_list_opportunities_compute_drains`
- **Actual**: that fixture makes no indicators calls, so a non-empty indicators assertion cannot apply to it. Its existing ingest-side assertions are unchanged. No saga code exists yet, so Step 31's saga tests must call `_assert_indicators_headers(…, path="template-saga")`.
- **Disposition**: within scope; follow-up noted for Step 32.

### D-19 — Step 18: `credential_scope` omitted; N-1 rollback-window limits on `signal_sources` writes
- **`credential_scope`**: omitted together with its CHECK, backfill and reset trigger, per the operator gate (2026-10-07: prod has zero `mcp_client` sources).
- **Down file**: refuses to run once any slug has more than one owner, or any dedup key does. Reversing the PK swap would otherwise collide.
- **Accepted risk**: the N-1 owner-fill trigger covers `newsletter_signals` inserts only, as the spec names. During a rollback window, an N-1 instance that **registers** a new source without `user_id` fails the NOT NULL, and an N-1 `mark_source_*` UPDATE by slug touches every owner's row with that slug. Registration is admin-only, and N-1 has no `ON CONFLICT (slug)` (round-3 verification). Both are confined to N/N-1 coexistence and disappear once N is fully rolled out.
- **Disposition**: operator gate plus a documented, accepted risk.

### D-20 — Step 19: `mcp_client_loop.py` touched early; `_ingest_external_signal(owner=…)` added now
- **Actual**: the owner-keyed `mark_source_error(db, user_id, slug, error)` signature would have broken the running poller. The three poller call sites now pass `src["user_id"]` (Step 23's file). `IngestSignal` needs the owner now, so `_ingest_external_signal` already takes `owner`. Step 23 only has to pass `owner=src["user_id"]` and do the exact-scope `GetSecret`.
- **Disposition**: minimal follow-through to keep the build green; Step 23 scope reduced accordingly.

### D-21 — Step 19: headered `IngestSignal` to an own **inactive** source → `NOT_FOUND`
- **Actual**: "active" is folded into the owner-held check per the spec's reading, so this case returns `NOT_FOUND`; it was `INVALID_ARGUMENT`. No durable `@AC-*` pins the old code (grep of the ingest/agent/platform acceptance suites).
- **Other details**: a non-admin REGISTER checks for an existing slug before validation, inside a `pg_advisory_xact_lock` transaction, so the original check order is kept. `SignalSource.user_id` is also filled on the `ManageSignalSource` response.
- **Disposition**: within scope.

### D-22 — Step 20: follow-through edits outside Files
- **Actual**:
  - `tests/_helpers.py`: `transaction_conn` gains a `slug_holders` keyword and an async `conn.execute`.
  - `tests/test_source_health.py`: `args[1]=="uw"` → `args[1:]==("u1","uw")`.
  - `tests/test_mcp_client_loop.py`: the fixture gains `user_id`, and the fake `mark_source_error` takes the owner.
  - `test_ingest_servicer.py`: REGISTER tests use a headered owner and patch `slug_holders`.
  - Same expected status codes throughout.
- **Disposition**: required by the owner-keyed signatures; no assertion weakened.

### D-23 — Step 25: REGISTER guard runs after definition validation; local shadowing removed
- **Actual**: the guard sits after `definition.user_id = caller_user_id` as specified, which is after `_validate_definition_proto`. An invalid definition submitted under the blend id therefore gets the validation error first. The DEACTIVATE and SetStrategyLive branches used to hold a local named `blend_strategy_id`; they now call the accessor directly, so the function name is no longer shadowed.
- **Disposition**: within scope.

### D-24 — Step 21/22: `userId` added to the GetSecret decrypt-failure log; in-memory store test instead of loopback gRPC
- **Actual**: the existing `GetSecret decrypt failed` error log now includes `userId`, for diagnosis. It never logs plaintext. `perUserSecrets.test.ts` calls the handlers directly against an in-memory `config_values` store, because insecure loopback gRPC cannot present a peer certificate. SAN parsing against a real mTLS peer is already proven by the Step 5 spike.
- **Disposition**: within scope.

### D-25 — Step 23: no `credential_scope` branch; servicer unchanged
- **Actual**: the `credential_scope`/`LEGACY_GLOBAL` branch is omitted per the operator gate (prod has 0 `mcp_client` rows). Every source resolves its secret with exact scope `user_id=src["user_id"]` and never falls back to a global row. No servicer edit was needed, because D-20 already added `_ingest_external_signal(owner=…)`. Verification ran `uv run ruff` rather than bare `ruff`.
- **Disposition**: operator gate.

### D-26 — Step 29: `_LIST_COLS` follow-through; origin stamped by UPDATE in the register txn; extra status codes
- **`_LIST_COLS`**: `app/repositories/signal_sources.py` (not in Step 29 Files) gains `origin_template_id, origin_template_version` in `_LIST_COLS`, so `ListSignalSources` can read origin.
- **Origin stamping**: the new source is stamped by a separate `stamp_origin` UPDATE inside the same register transaction, so the existing `insert_source` SQL is unchanged. The REGISTER body is extracted into `_register_source`, which `ManageSignalSource` and `InstantiateTemplate` share (DRY).
- **Status codes** for cases the spec does not cover:
  - duplicate template create → `ALREADY_EXISTS`;
  - headerless instantiate → `FAILED_PRECONDITION` (the existing register convention);
  - no slug on either the request or the template → `INVALID_ARGUMENT`;
  - updating a retired template → `NOT_FOUND`.
- **Limitation**: the `ManageSignalSource`/`InstantiateTemplate` response reports origin without `latest_version`, because only `ListSignalSources` performs the batched version lookup that FR-8 requires.
- **Disposition**: within scope.

### D-27 — Step 27: unspecified status codes and helper extraction
- **Unspecified status codes**:
  - headerless `ListTemplates` → `UNAUTHENTICATED`;
  - user-path instantiate with an empty or `system` owner → `PERMISSION_DENIED`;
  - duplicate template id (including a retired one) → `ALREADY_EXISTS`;
  - non-UUID `intent_id` → `INVALID_ARGUMENT`;
  - a failed copy batch → `INTERNAL`, and the transaction rolls back;
  - updating a retired or missing template → `NOT_FOUND`;
  - retiring an already-retired template is idempotent.
  - A repo-less instance (no DB) returns `UNAVAILABLE` on the template RPCs.
- **Saga template reads**: the saga reads its templates with one `get` per unique id. There is no batch read method; the copies themselves are still one insert transaction.
- **Refactoring (DRY)**:
  - `_validate_register_payload` is extracted, so RegisterFormula and template validation share one code path.
  - `_dt_to_ts` is hoisted to module level.
  - `GetFormula` returns a copy, so origin filling never mutates the cached formula.
- **Follow-through**: `tests/test_formulas.py:592` binds by position `args[10]`; it used `args[-2]` before the INSERT gained three columns.
- **Coverage note**: `app/handlers/servicer.py` was already excluded from coverage in `pyproject.toml`. The new handler code is tested but not counted toward the 84.81% figure.
- **Disposition**: within scope.

### D-28 — Step 31: fingerprint excludes `origin`; shared `source_symbol` check; saga edge handling
- **`_FINGERPRINT_EXCLUDED_KEYS`**: gains `"origin"` (servicer follow-through). Without it, a masked UPDATE of an instantiated strategy would fold origin into the definition fingerprint and reset its evidence (preserves ANALYSIS-3).
- **Shared check**: the `source_symbol`/fundamentals conflict check is extracted into `_fundamentals_source_symbol_conflict`, used by both `_validate_definition_proto` and the new `_validate_template_definition`. The error message is unchanged.
- **Origin from columns only**: `_row_to_strategy_definition` clears any `origin` taken from a request body, so origin always comes from the columns.
- **Saga edge handling**:
  - A template with no formula components skips the indicators copy call.
  - If the request path loses a CAS, it leaves cleanup to the sweep.
  - The sweep processes `ABORTING`/`COMMITTED` intents of any age, and `PENDING` intents only after `_INTENT_STALE_SECONDS`. The indicators resolve call is idempotent.
- **Constants**: `_INTENT_STALE_SECONDS = 900` and `_INTENT_SWEEP_SECONDS = 300`, as the spec records. Operator re-confirmed on 2026-10-07; an earlier gate prompt mis-stated these as 300/60.
- **Disposition**: within scope; operator-confirmed constants.

### D-29 — Step 33: replay limited to the feature-224 up-files (supersedes D-3); fresh-DB guard; defect filed
- **Expected**: Step 3's pass 2 forces every service to version 0 and replays the whole chain.
- **Actual**: about 14 already-applied up-files are not idempotent, for example `indicators/001_formulas.up.sql:3` and `ingest/001_newsletter_signals.up.sql:8`. The full replay would fail before any 224 assertion runs, and F-01 forbids fixing those files in place. Operator decision (2026-10-07): pass 2 renders and re-applies only indicators 007, ingest 013 and analysis 026 with `psql -1 -f`. That proves each new file is idempotent on the migrated schema; the N-1 trigger-count stability check is kept. The pre-existing defect is filed at `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`, status `open`, for `/sdd-triage`.
- **Other changes**:
  - Pass 0 refuses to run on an already-migrated DB, because `goto` would run down-files.
  - `service_db_url` is mirrored as a 4-line function, because `db-migrate.sh` is not in Files.
  - Assertion files receive `-v seed_user_id`.
  - Fixture source types avoid mediated and `mcp_client` (replaying 006/007 adds narrower CHECKs).
- **Verification**: offline only. `bash -n`, shellcheck, shfmt and render checks pass, and pglast parses all four SQL files. The live run is CI-only.
- **Disposition**: operator decision plus a defect report.

### D-30 — Step 34/35: extra doc fixes; follow-through test edits; pre-existing UI tsc errors
- **Doc fixes**:
  - `mcp-tools.md` gains a missing `### set_strategy_live` section (the runbook-parity test exposed it), plus a template usage pattern.
  - The stale `author="<user_id>"` argument is removed from the strategy-management example.
  - `SKILL.md` Scope lists both new tools, as `docs/patterns/strat-lab-plugin.md` requires.
  - The deprecated `author` field stays in the register request, because the backend ignores it.
- **Follow-through tests outside Files**:
  - `tests/test_tools.py`: the bearer key now matches `startswith("mcp_credential.")` plus `user_id`, and `is_public` is now rejected with a `TypeError`.
  - `tests/test_formula_builders.py`: `is_public` added to the intentionally-unset sets.
  - `tests/test_strategy_builders.py`: `origin` added to `_STRATEGY_INTENTIONALLY_UNSET`. That test was already red after the Step 1 proto fields; it is green now.
- **UI `tsc --noEmit`**: 2 errors in `e2e/insights/backfills.spec.ts:135-136` (`'never'`). They reproduce on `origin/main-dev`, so they predate this feature; the file is untouched.
- **Out of scope, noted only**: `mcp-tools.md` still calls `manage_strategy` an "Admin-scoped write", which has been stale since feature 133.
- **Disposition**: within scope; the pre-existing items are recorded, not fixed.

### D-31 — Step 36: `author` also dropped from `useRegisterFormula`; badge placement
- **Actual**: `useRegisterFormula` no longer sends `author` either. The BFF is now a pass-through, and indicators takes the author from `x-user-id`; no caller passed it. The new "System" (`secondary`) and "Update available" (`info`) badges use existing `Badge` variants and sit beside the formula name (C-17). `SYSTEM_FORMULA_AUTHOR` is reused rather than repeating the `'system'` literal.
- **Left for Step 39**: e2e fixtures `e2e/fixtures/formulas.ts` and `e2e/insights/formulas.spec.ts:75` still carry `isPublic` in mock data. They still type-check, because the field is deprecated, not deleted.
- **Disposition**: within scope.

### D-32 — Step 37: signal-source instance link targets `/config-ui/sources` until Step 38; per-kind authoring fields
- **Instance link**: `/insights/signal-sources` arrives in Step 38, so `instanceHref` for SIGNAL_SOURCE temporarily points at `/config-ui/sources`. Step 38 repoints it.
- **Authoring form**: the admin form covers these fields per kind; anything else in the payload is preserved on edit:
  - formula: source and warm-up period;
  - strategy: id, display name, entry/exit rules, and a schema-checked component JSON;
  - source: slug, name, type, extractor, weight, and config JSON.
- **Source type**: entered as free text, because `SOURCE_TYPES` is private to `config-ui/sources/page.tsx`.
- **Blocked bearer path**: "Use template" is disabled, with an accessible reason, for `mcp_client` source templates until Step 38 adds the bearer prompt.
- **Disposition**: within scope.

### D-33 — Step 38: `useTemplates.ts` follow-through; unit test added; e2e red until Step 39
- **Follow-through**: `instanceHref` for signal sources is repointed to `/insights/signal-sources`, and the `needsBearer` comment is updated (`useTemplates.ts`, Step 37's file, the D-32 follow-up).
- **New test**: `src/lib/insightsBff.test.ts` (4 tests, red then green) shows the insights `SetConfig` handler forces `userId`, `author`, `environment`, `createKey: true` and `isSecret: true`. It also rejects any key outside `ingest`/`mcp_credential.*` with `PermissionDenied`.
- **Hook and page changes**:
  - `useRegisterMcpClientSource` no longer takes `slug`; the secret key is a random UUID.
  - The admin read-only view drops the stat tiles and the credentials column.
  - The authenticated-website "Credentials Ref (secret.* key name)" label was moved over unchanged, though the `secret.*` prefix is retired (Step 40 candidate).
- **Known red until Step 39**: `e2e/config-ui/sources.spec.ts` expects the old create/edit UI, and `nav-reachability.spec.ts` lists the old href.
- **Disposition**: within scope.

### D-34 — Step 39: SetConfig assertion via echo; warmup routes; durable-feature re-home deferred to Step 40
- **SetConfig assertion**: the mock backend runs in a separate process. Its `ConfigService.setConfig` therefore echoes the `{userId, createKey, isSecret}` it actually received, as JSON in `version`, for `ingest`/`mcp_credential.*` keys. This proves what the insights BFF forced server-side. The echo is catalogued in `INVENTORY.md`.
- **Follow-through**: `e2e/warmup.setup.ts` `ROUTES` gains `/insights/templates` and `/insights/signal-sources`.
- **Deferred**: Step 40 item 8 owns the `surface-signal-weight-decay-config.feature` route re-home; the equivalent e2e assertions already run on `/insights/signal-sources`. `e2e/mobile-overflow.spec.ts` still checks `/config-ui/sources` and has no case for `/insights/signal-sources`; it is outside Step 39 Files.
- **Pre-existing**: 3 unused-variable lint errors in `e2e/` lie in lines this step did not change.
- **Disposition**: within scope.

### D-35 — Step 41: follow-up resolved to 225; committed ahead of Step 40
- **Number**: `225-private-by-default-enforce-contract`. The max NNN across `main-dev` and every remote `feature/*`/`claude/*` branch was 224.
- **Order**: Step 41 was committed before Step 40 because Step 40's doc teardown was still in flight. The two steps touch disjoint files.
- **merge-order.md**: a new row (225 waits for 224 to be launched) pre-reserves analysis `027`, indicators `008` and ingest `014`.

### D-36 — Step 40: manual teardown reconciliation beyond the listed Files
- **Plugin**: `/context-forge:context-constitution refresh` was not run, so item 8 was done by hand.
- **Additional files reconciled** (each grounded drift caused by feature 224):
  - root `docs/context-constitution.md` (PLAT-4 fundsignal `system` exception) and `docs/context-constitution-findings.md`;
  - the per-module constitution and findings files for ingest, indicators, analysis and config;
  - the agent `CLAUDE.md` `manage_formula` note (no admin override);
  - the durable feature's description header (route only).
- **Not changed** (out of scope or not a doc):
  - `e2e/mobile-overflow.spec.ts` still checks `/config-ui/sources`;
  - the `mcp_credential.<slug>` docstring in `services/xstockstrat-ingest/app/config/watcher.py`;
  - pre-224 drift (`_is_admin:425` anchor, stale ingest anchors, the `database.md` run-order line).
- **LEGACY_GLOBAL**: not shipped (ingest 013 has no `credential_scope`; D-19/D-25), so it is not documented.
