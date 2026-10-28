# Design: enforce-config-key-wiring

**Created**: 2026-10-23
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-23 (operator approval at the round-2 design gate; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

Internal tooling only; there is no consumer surface (C-14: none, as the product spec states). No runtime service, proto, migration or config key changes, and no reader or seed is edited.

**Check script.** A zero-dependency Node script `scripts/check-config-wiring.mjs`, tested by `node --test` with fixtures. Node is chosen because `node --test` already runs in CI (`recon.md:42`, `ci.yml:723-724`) and a bash 3.2 script cannot parse three languages (`recon.md:38`, `scripts/merge-train-resolve.mjs` and `scripts/workflow-tests/harness.mjs` are the precedent). State lives in `scripts/config-wiring.json`, with two sections: `findings` (the baseline, each entry carrying an owner and its env list) and `registry` (dynamic-key sets and `forwarders` keyed `file:symbol`). The registry lives in the JSON file, not in reader code, because the feature may not edit readers.

**Stored set (seed side).** Built offline from `services/xstockstrat-config/migrations/*.up.sql` in NNN order (`recon.md:16-20`), keyed `(namespace, key, environment)`. Stored form is the raw `key` column, as served by `configServiceImpl.ts:188`. Parser scope, one fixture each:
- The rewrite model and the fail-closed trigger match `UPDATE config.config_values` only, not `config.config_audit` (017:39).
- Only `user_id IS NULL` rows enter the set (`configServiceImpl.ts:181,207`).
- `*.down.sql` is excluded.
- It models the 017 environment rename (`SET environment='<lit>' WHERE environment='<lit>'`) and the 029 heal with its exact guards (`NOT LIKE ns.'%'`, `is_secret=false`, `namespace IN (...)`, `029_heal_config_keys_full_dotted.up.sql:24-28`).
- Any other rewrite statement the model cannot interpret trips a fail-closed trigger. The allow-list for known non-key-neutral statements is keyed on migration file plus a content hash of the statement, never on shape or NNN alone, so a later dedupe `DELETE` cannot pass unreviewed.
- Secret rows (`is_secret=true`) are a separate class read via `GetSecret` with namespace-relative keys (`recon.md:21`); they are not compared against ordinary readers and values are never read or printed.

**Reader set.** Python uses stdlib `ast`: it resolves multi-line calls (`fundsignal_loop.py:148`) and same-file constants (`tools.py:78,628`) at no dependency cost. Go and TypeScript use regex extraction over the `Get*` methods and `values[...]` index syntax (`recon.md:22-29`), with same-service imported-constant resolution (`portfolio/internal/config/config.go:160`) and `registry.forwarders` for parameterized helpers such as `resolvePositiveInt` (`marketdata_service.go:982-987`) and 244's refactor. A key that cannot be resolved is reported as `dynamic-read`. Runtime-built keys are `dynamic-read` unless a registry entry enumerates them. The extractor quality gate is the count of false-dynamic-read entries (literal argument split across lines) in the Go/TS extractors, which must be zero. Keys created at runtime (`SetConfig create_key=true`, config-ui) are invisible to the migration-derived set and surface as `read-unseeded` by design; the remedy is to seed them in a migration, and the governance section says so.

**Join with collapse.** Findings are computed per `(namespace, key, environment)` and then grouped by `(namespace, key, kind)`. A key missing from every environment yields one finding with no `env`; `env=<e>` is emitted only when the key is seeded in some environments and absent in others. No fifth finding kind (`env-partial` rejected). Output lines are `file:key:kind[:env]` and never contain values. The baseline records the env list per entry and the ratchet compares env lists, so a fix in one environment shrinks the entry rather than leaving it stale; a validator and fixture pin this.

**Execution gates.** Step-time runs the non-final mode only: `form-mismatch`, `dynamic-read`, unmodelled-rewrite, and declared-key findings that are not missing-side. Missing-side `seeded-unread` and `read-unseeded` for declared keys are PENDING at step time. `--final` runs once, at the feature completion gate (last step done, or the integration-PR gate), and in CI. This needs no "last step touching K" parsing and no step-body quoting, so it works for impl-specs written before 278 (243, 244, 261) and F-09 holds (step bodies immutable, `SKILL.md:487`). The Phase 3 gate sits before the `done` flip (`sdd-execute/SKILL.md:289-299`) and is mirrored in `reference/sequential-mode.md`. Two-step fixtures (seed then reader, reader then seed) pass at step time and fail under `--final` when a leg is missing.

**Review gate.** A B2 row in `.claude/skills/sdd-review/reference/impl-spec-criteria.md` (B2 table `:12-31`) with two clauses (a step naming the reader file and symbol; a test over a snapshot-built read, per @AC-11), rendered as a prominent FAIL row on the `C-14` precedent (`:31`) although Mode B is advisory (`:4`). The earlier third clause (reader step quotes the backticked stored key) is dropped. The `sdd-story` template pins the `Config Key Changes` declared-key format.

**CI.** Job `config-wiring` modeled on `migration-contract-gate` (`ci.yml:676-692`): whole-tree scan, not the diff (`fails.md:1040`), a new path filter in `changes` (`:39-91`), added to `ci-gate` `needs:` and echo list (`:776-818`), and the `node --test` suite run by the job itself.

**Baseline owners.** The 18 form-mismatch keys (5 ingest, 13 analysis) and the two dead seeds (`analysis backtest.max_duration_seconds`, `ledger stream.notify_enabled`) name feature 277/278, since the ingest defect report is closed `wont-fix` (`recon.md:80-86`). The four extra unseeded keys (`ingest backfill.max_retry_attempts`, `signals.dedup_window_hours`; `analysis fundsignal.retry_seconds`, `startup_jitter_seconds`) are owned by "feature 278" (operator may overrule; recorded in `context.md`). `indicators.sandbox.*` is owned by feature 243 until its migration 031 lands.

**Build order for /sdd-spec.** Parser + fixtures; ast and regex reader extraction + join with collapse; first real run (fills `findings`, records counts); the environment-baseline decision gate; CI job + `ci-gate`; skills (execute Phase 3 completion-gate mirror, B2 row, story template); `docs/patterns/config-governance.md` section (append-only, keep 182's registered-keys entries); `scripts/check-context-map.sh`.

**Environment-baseline decision gate (operator step).** Before `findings` is frozen, the implementation spec carries a step the OPERATOR performs. The session has only the staging MCP and cannot read production, so the spec must not assume the agent can read production. The step (i) runs the first offline pass and records the count and list of `read-unseeded env=` entries in `context.md`; (ii) lists 2-3 sampled 001-era keys and the exact read-only `get_config` command for the operator to run against production, writing nothing, and records the result in `context.md`. The operator then rules whether env-scoped `read-unseeded` is blocking in CI or reported-only (kept out of the ratchet). CI must not depend on the result until that ruling. Why the gate is needed: 002:7 back-fills only via the column `DEFAULT 'dev'` and 017:38 renames dev to staging, so every 001-era key that 002:46-72 does not re-insert for production appears staging-only offline.

## Rejected Alternatives

- Fifth finding kind `env-partial` — rejected: exceeds the product spec's four kinds and forces an AC amendment; `env=` is a field on existing kinds instead.
- Per-key `--final` at "last step touching K" — rejected: depends on step-body quoting that already-written impl-specs (243, 244, 261) cannot satisfy and F-09 forbids fixing; a seed step could look last and block with no unblock path.
- Keeping the B2 third clause (reader step quotes the backticked stored key) — rejected: the completion-gate design no longer parses step bodies.
- Per-line regex extraction for Python with a raw 20-entry dynamic-read threshold — rejected: it measures parser weakness (multi-line calls), not real dynamic reads.
- Dropping the environment axis and unioning environments — rejected: silently confirms keys seeded only in staging that are inert in production.
- Bash or Python as the script language — rejected: Node already runs `node --test` in CI, and bash 3.2 cannot parse multi-language sources.
- A declared per-service key registry that readers must match — rejected: a second source of truth that can claim wiring that does not exist (`fails.md:2335` class).
- Allow-listing migration 017 or 029 by statement shape or by NNN alone — rejected: a later non-key-neutral dedupe `DELETE` would pass unreviewed; file plus statement content hash instead.
- In-code annotations naming dynamic key sets or forwarders — rejected: violates the no-reader-edit constraint; the registry lives in `config-wiring.json`.

## Open Risks

- [ ] Env-scoped `read-unseeded` findings may inflate the baseline and make the ratchet noisy; the offline model cannot decide whether production genuinely lacks 001-era rows or the model is blind to runtime-created rows — to be addressed at the environment-baseline decision-gate step (operator ruling before `findings` freezes).
- [ ] Unverified assumption: no migration after 017 renames environments again, and no other migration trips the fail-closed rewrite trigger (002, 005, 025 unchecked) — to be addressed at the first-run step; any new shape is added to the closed list with a fixture, never by weakening the trigger.
- [ ] Ownership of the four extra unseeded keys is set to "feature 278"; operator may overrule — to be recorded in `context.md` at the baseline-fill step.
- [ ] Unread inputs: `reference/sequential-mode.md:112` (gate mirror location), `scripts/check-duplication.sh` and `.jscpd.json` contents were not verified — `/sdd-spec` must confirm them before citing line numbers.
- [ ] Env-list ratchet semantics (one baseline entry covering several environments must shrink when one is fixed) — to be addressed with an explicit validator and fixture in the ratchet step.
- [ ] Go and TS regex extraction can still mis-resolve cross-file constants, aliased watchers and 244's helper refactor; these surface as `dynamic-read` and are managed via same-service imported-constant resolution and `registry.forwarders` keyed `file:symbol` — to be addressed at the reader-extraction step.
- [ ] The ratchet couples 243, 244, 261 and any key-fixing feature to editing `scripts/config-wiring.json`; ordering against PR #1322 (base branch `ccr-fac38b1f-6m24q2` not yet merged) and merge-order drift — to be addressed at /sdd-spec and the merge-order file.
- [ ] The completion-gate `--final` finds a missing reader or seed only at the last step, so a wrong-side defect can survive several steps; step-time `form-mismatch` and `dynamic-read` checks bound this — accepted.
- [ ] The offline stored set cannot see runtime-created rows; documented as by-design in the governance section and sampled once read-only — to be addressed at the decision-gate step.

## Constitution Rules Touched

- `C-11` — honored by: the design gate was run in full mode (2 rounds) before any code.
- `C-15` — honored by: `acceptance.feature` stays the single source of acceptance truth; the design adds no scenario, only fixtures that reproduce @AC-1 to @AC-3, @AC-9 and the negative matches.
- `C-16` — honored by: PRESERVE/EXTEND lines below; no CHANGE.
- `C-18` — honored by: the check is deterministic and offline, run from a repo script, not from model judgment.
- `F-08` — honored by: the check reads migrations and source only and prints keys, never values (secrets included).
- `F-09` — honored by: no step body is edited or parsed; the completion-gate `--final` replaces per-key step-body quoting.
- `P-03` — honored by: every unverified input is listed in Open Risks, none guessed.
- `C-14` — precedent only: the prominent FAIL row in an advisory review mode (`impl-spec-criteria.md:31`); no consumer surface for this feature.
- `C-03` — not applicable: the check makes no requests. The operator's x-trace-id rule (2026-10-21) has no surface here; the only environment access is one operator-run read-only `get_config` sample, and no staging or production write occurs.

## Business Rules Touched (C-16)

No CHANGE lines; no existing `@AC-*` guarantee is altered, so no operator sign-off reference is required.
- PRESERVE `@AC-1` "The seed migration registers all four materializer keys per environment" (feature 182, `services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — not regressed by: the check is read-only, edits no migration, and classifies those keys as wired.
- EXTEND `@AC-1` (feature 278, `acceptance.feature`) — new cases added: the per-environment join collapses to exactly one finding when a key is missing from every environment, and `env=<e>` appears only on partial seeding.
- PRESERVE `@AC-3` (feature 278) — still exactly one finding per `(namespace, key, kind)`, tested for the all-environments-missing case.
- PRESERVE `@AC-5` (feature 278) — step-time gate behavior is unchanged in outcome; missing-side findings for declared keys are PENDING until the completion gate.
- PRESERVE `@AC-10` (feature 278) — the migration-trigger scenario holds: a step that is not done stays not-done and the output names the check result.
