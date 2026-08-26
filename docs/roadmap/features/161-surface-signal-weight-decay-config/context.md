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

## Open Threads

- [ ] Migration numbering 019/020 derived from local tree — re-scan `origin/*` config migrations at
      /sdd-spec / /sdd-execute before writing the numbers (target: config-migration steps).
- [ ] `8760` upper bound is a unit-typo guard, not a math limit — revisit if a legitimate >1yr
      half-life is ever needed (target: config-service registry step).
- [ ] 020 down-restore clobbers any live operator edit to the dead key's `value_data` — documented in
      the migration comment (target: migration 020 step).
