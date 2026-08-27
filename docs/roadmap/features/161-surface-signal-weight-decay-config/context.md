# Context: surface-signal-weight-decay-config

**Feature**: `docs/roadmap/features/161-surface-signal-weight-decay-config/feature.md`
**Product Spec**: `docs/roadmap/features/161-surface-signal-weight-decay-config/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/161-surface-signal-weight-decay-config/implementation-spec.md`

---

## Session 2026-08-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  request: clean up the dead `analysis.signals.source_weights` key and surface `reliability_weight`
  (feature 134) + the decay half-life (feature 022) to config-ui and the MCP agent, with in-UI
  guidance.
- Pre-story discovery (read-only) established the current state:
  - Agent `list_signal_sources` fetches `reliability_weight` in the client layer
    (`app/client.py:195`) but the tool re-projection drops it (`app/tools.py:232-239`);
    `manage_signal_source` has no `reliability_weight` param (`app/tools.py:890-899`) and never sets
    it on the proto (`app/client.py:1004-1040`).
  - config-ui Signal Sources page (`src/app/config-ui/sources/page.tsx`) exposes weight only as an
    inline table cell (`:329-366`, save at `:185-203`), NOT in the create/edit modal `FormState`
    (`:49-77`); no guidance text anywhere.
  - config-ui is a generic key/value editor; per-key descriptions come from the config service's
    `ListKeys` metadata, seeded via `services/xstockstrat-config/migrations/`. To add key guidance you
    write a migration, not UI code.
  - `analysis.scoring.signal_decay_half_life_hours` is NOT registered (no migration); read with
    hardcoded 24.0 via `get_float_present` (`servicer.py:3057-3059`). Feature 022's `context.md:20`
    recorded the seed migration as a deferred follow-on — this feature completes it.
  - Dead key `analysis.signals.source_weights` was registered by config migration 003, reworded
    "SUPERSEDED" by 016; still read by no service.
- **Operator decisions (AskUserQuestion, this session):**
  1. Register the decay half-life as a real config key (seed migration) rather than leaving it
     unregistered/doc-only.
  2. Add `reliability_weight` to the source create/edit form (settable at registration), in addition
     to the existing inline editor — both get guidance text.
- **Ledger traps folded into the spec:** F-6/RC-1 (SignalSource MCP builder silently dropped proto
  fields → FR-7 descriptor-parity test); F-11 (config value_type immutability → only add/delete keys,
  never retype); migration-numbering (ls migrations before numbering — config store at 018, so
  019/020 expected).
- No ingest proto changes required (`reliability_weight` already on `ingest.SignalSource`, field 12).

## Session 2026-08-26 — sdd-design (quick invoked; ran full — 3 rounds)

- Phase 0 Recon: wrote recon.md (services: agent, ui, config, analysis-docs). Key reuse: inline
  `saveWeight` `[0,1]` shape, secret-field help-text pattern, migration-017 column layout,
  descriptor-parity test pattern.
- Phase 1 Grilling: 3 rounds. Chosen approach: server-side enforced scalar bounds for the decay key
  (new `config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR`, enforced in `setConfig` via all-shape
  `extractValueData`), agent `reliability_weight` surfacing with conditional update-mask, UI form
  field + guidance, dead-key + orphaned-FLOAT_MAP removal. Rejected: guidance-only, client-only
  validation, string-only bounds parse (the round-3 fail-open catch), keep-FLOAT_MAP-dormant.
- **Operator decisions this session (AskUserQuestion — P-04):**
  - **Fork 1 → ENFORCED bounds** (not guidance-only). This is an explicit operator **override of the
    product-spec's original "no proto changes" scope** — enforcing scalar bounds requires the additive
    `config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR` enum member (non-breaking; `buf breaking` passes).
    Recorded per the C-11 commandment override convention.
  - **Fork 2 → remove the orphaned FLOAT_MAP validation machinery** (registry entry + emit branch +
    its positive tests), not leave it dormant — because keeping it after deleting its sole key/tests
    ships live-but-zero-coverage code (round-1 adversary; fails.md/074). The proto `FLOAT_MAP=1` member
    is retained (`[deprecated=true]`) for enum stability.
  - **Approved the design** after round 3 (chose "approve & implement").
- **Round-3 fail-open catch (why the extra rounds paid off):** mirroring the string-only
  `platform.trading_state` guard for the bounds parse would read the agent's `float_val` write as
  `''`→`Number('')===0`→inside `[0,8760]`→persist unchecked. Fixed: parse via all-oneof-shape
  `extractValueData` + `Number.isNaN||<min||>max`, never a `!n` zero-trap (0 is valid).
- Constitution rules touched: C-10(c), C-11, C-13, C-14, C-15, C-04, P-03, P-04, F-01, F-07. Floor
  breaches: none across 3 rounds.
- Acceptance: appended `@AC-10` (mask omission preserves weight), `@AC-11`/`@AC-12` (server bounds
  rejection); updated `@AC-6`/`@AC-7` for enforced bounds.
- Status: draft → design-approved.

## Session 2026-08-26 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Consumed recon.md + design.md (design-approved happy path); reused recon's Codebase Map directly
  and verified the load-bearing/open-thread references against the live tree.
- Key codebase findings:
  - **Migration numbering resolved (open thread):** config migrations max at `018_notify_fanout`
    **both locally and across every `origin` head** (verified via `git ls-remote --heads` + `git
    ls-tree` sweep) — so `019` (register decay) / `020` (remove dead key) are correct and collision-free.
  - **FR-7 sharpened — the real parity gap:** the agent already ships `test_signal_source_builder.py`
    and `test_signal_source_projection.py`. The *projection* test guards the client `list_signal_sources`
    dict (which already carries `reliability_weight`, `client.py:195`), so it passes today. The
    *builder* test asserts `ManageSignalSourceRequest` top-level fields but **does not recurse into the
    `source` sub-message** — so it never caught the dropped `SignalSource.reliability_weight` on the
    write path (the F-6/RC-1 site). Step 2 extends the builder test with a `req.source.ListFields()`
    descriptor-parity assertion (opt-out set = server-set/read-only fields). This is the concrete AC-9.
  - **Two projection layers, not one:** the tool `list_signal_sources` (`tools.py:232-240`) is a
    deliberately-slim re-projection that drops `reliability_weight` (and `active`/`health`/…); FR-1 is
    a one-line add there. The client layer already carries it.
  - **Server-bounds enforcement point + the round-3 fail-open:** `setConfig` (`configServiceImpl.ts:335`);
    parse via all-oneof-shape `extractValueData` (`:574-585`, `??`-chained so `float_val:0`→`'0'`, no
    zero-trap) + `Number(...)`; mirror the `platform.trading_state` guard *placement* (`:383-394`) but
    NOT its string-only read (`:385`) which would coerce the agent's `float_val` to `0` and pass. `0`
    is valid (min inclusive).
  - **Dead-key blast radius confirmed:** `WEIGHT_KEY_REGISTRY` sole entry (`:110-112`); FLOAT_MAP
    emit branch (`listKeys :507-530`); config-service tests (`listKeysWire.test.ts:40,117`,
    `configServiceImpl.test.ts:40-66`); config-ui `validateFloatMap` (`NamespaceEditor.tsx:31,95-99,152-154`);
    e2e fixtures/specs (`configKeys.ts:84,91`, `api-smoke.spec.ts:225-243`, `audit.spec.ts:25`,
    `value-persists-after-save.spec.ts:16`). All reworked to the scalar decay key in Steps 6/7/10/11.
  - **Proto:** `config.v1.ValueType` has only `UNSPECIFIED=0`/`FLOAT_MAP=1` (`config.proto:80-83`);
    add `VALUE_TYPE_FLOAT_SCALAR=2` (additive → `buf breaking` passes) + `[deprecated]` on FLOAT_MAP
    + `ValidationRule` doc-comment scalar semantics.
- Not trading-domain-relevant → skipped the trading-domain survey/constraints. No new env vars/ports →
  no docker-compose/`.do` deployment-file changes.
- Reviewers snapshot in feature.md left as the sdd-design finalization (config/agent/ui/analysis
  owners + Proto Reviewer + DBA) — a correct superset of the per-step reviewers.

## Open Threads

- [ ] Migration numbering 019/020 derived from local tree — re-scan `origin/*` config migrations at
      /sdd-spec / /sdd-execute before writing the numbers (target: config-migration steps).
      **[/sdd-spec: re-verified — 018 is max on local + all origin heads; 019/020 free.]**
- [ ] `8760` upper bound is a unit-typo guard, not a math limit — revisit if a legitimate >1yr
      half-life is ever needed (target: config-service registry step).
- [ ] 020 down-restore clobbers any live operator edit to the dead key's `value_data` — documented in
      the migration comment (target: migration 020 step).

## Session 2026-08-26 — sdd-review impl-spec (advisory)

- Overlap scan (feature-overlap): **CLEAN** — no migration/proto/config/file collisions. Only other
  in-flight feature (142-fix-fundamentals-upsert-invalid-json) is disjoint (xstockstrat-marketdata,
  no proto/config/migration). No merge-order entry required.
- Criteria pass (spec-reviewer): _pending — recorded below when it lands._
- **Environment note (execution):** the Docker codegen path (`localenv-setup.sh`/`Dockerfile.codegen`)
  is unavailable here — the container build fails fetching nodejs from deb.nodesource.com (egress
  blocked). Falling back to the host-toolchain path (`docs/runbooks/codegen-toolchain-host-setup.md`):
  go-installed buf + pinned Go/TS/Python plugins. Docker daemon itself was down and had to be started.

## Session 2026-08-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 5 warnings (advisory — did not block; no Floor F-* breach).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 6/7: **listKeys registry-key mismatch (C-01, load-bearing).** Spec Instr 3 says
    `SCALAR_BOUNDS_REGISTRY[r.key]`, but `r.key` is the DB `key` column
    (`scoring.signal_decay_half_life_hours`, namespace-stripped) while the registry key is the
    full `analysis.scoring.signal_decay_half_life_hours` → lookup returns undefined → NO validation
    emitted in prod → config-ui shows no bounds (breaks AC-6). Same latent bug exists today at
    `configServiceImpl.ts:508` (`WEIGHT_KEY_REGISTRY[r.key]`), masked by a non-representative
    full-path test fixture. **FIX at Step 6: index with `${namespace}.${r.key}` (full path); Step 7
    fixture uses the SPLIT key form to match real DB.** — [x] RESOLVED at Step 6 (configServiceImpl.ts full-path lookup + split-key fixtures; 93 tests green, RED verified).
  - Step 9/11: Playwright e2e steps state no `--cov-fail-under` threshold — matches this repo's
    frontend-e2e pattern (UI coverage is vitest-scoped to src/lib/**). — [x] accepted (repo norm).
  - Step 4: `packages/proto/gen/**` wildcard in Files — conventional for generated output, covered
    by the `proto-freshness` diff gate. — [x] accepted.
  - Step 3: status/reality drift (proto already edited while Status was pending). — [x] resolved
    (statuses flipped as steps land).
  - Step 10: "onChange" label is actually the `onBlur` handler (line refs correct). — [x] cosmetic,
    will use the right handler at impl.
- Overlap findings: (see feature-overlap run) — recorded separately.

## Session 2026-08-27 (CI: feature status automation)

- Promotion PR #1036 merged to main
- Feature promoted and committed: d52375b58af14eb4718fab73e9aab8020fc92baf
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-27
