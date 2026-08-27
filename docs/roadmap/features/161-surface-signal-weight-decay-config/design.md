# Design: surface-signal-weight-decay-config

**Created**: 2026-08-26
**Rounds**: 3 (full; termination: approved — open-risk-accepted on the 8760 ceiling)
**Approved by**: user @ 2026-08-26
**Grounded in**: recon.md

---

## Chosen Approach

Six work-areas. Two consumer surfaces (C-14): the **config-ui** segment and the **agent** MCP tools.

### 1. Agent — surface `reliability_weight` (FR-1, FR-2) → consumer surface: `list_signal_sources`, `manage_signal_source`
- `list_signal_sources` tool projection (`tools.py:232-240`) adds `reliability_weight` (the client layer already reads it, `client.py:195`); docstring updated.
- `manage_signal_source` (`tools.py:890-934`) gains an optional `reliability_weight` param; `client.py` builder (`:1004-1010`) sets it on `ingest_pb2.SignalSource` **and** adds `'reliability_weight'` to the `update_mask` **only when the caller explicitly supplies it** — `reliability_weight` is `optional double` (`ingest.proto:160`), so an unconditional set + mask would reset the weight to 0.0 on a display-name-only update (the F-6/RC-1 defect in write direction). Response projections (`client.py:1033-1040`, and the list projection) carry `reliability_weight`. Out-of-range `[0,1]` values are rejected by existing ingest validation and surfaced (not swallowed).

### 2. Agent — descriptor-parity contract test (FR-7)
Mirror `test_summary_key_set_covers_every_proto_field` (insights.md). **Separate tests per surface**, never a blanket shared opt-out (round-1 adversary): the **request builder** (`client.py:1004-1010`) opts out only server-set/read-only fields with a per-field justification; **each response projection** carries every readable field or per-field justifies. Do **not** opt out `has_credentials` (it is carried, `client.py:184/1039`); do **not** reference `credentials_ref` for `SignalSource` (it is a field of `ManageSignalSourceRequest`, not `SignalSource` — `ingest.proto:142`). A separate targeted test covers the **mask-omission** semantic (`@AC-10`), which the field-set parity test does not guard.

### 3. Proto — scalar-bounds value type (FR-5 enablement)
Add `VALUE_TYPE_FLOAT_SCALAR = 2` to `config.v1.ValueType` (`config.proto:80` — currently `UNSPECIFIED=0`, `FLOAT_MAP=1`). **Additive enum value → non-breaking** (`buf breaking` passes; adversary confirmed). Mark `FLOAT_MAP = 1` with `[deprecated = true]` (its code path is being removed; the member stays for enum stability) and update the `ValidationRule` doc-comment (`config.proto:85-87`) to (a) mark the FLOAT_MAP sentence deprecated and (b) define scalar semantics: "when `value_type == VALUE_TYPE_FLOAT_SCALAR`, the scalar `float_val` must satisfy `[min_value, max_value]`." Run `./scripts/buf-gen.sh`; commit regenerated stubs.

### 4. Config-service — register decay key + server-side enforced bounds (FR-5)
- **Migration 019** registers `analysis.scoring.signal_decay_half_life_hours`: `value_type='float'`, `default_value='24.0'`, post-147 (migration-017) column layout, **both** `staging`+`production` rows, `user_id NULL` (global), description carrying guidance. `019.down.sql` deletes **only** what 019 inserted — the two global (`user_id IS NULL`) staging+production rows — never a per-user override.
- **`configServiceImpl.ts`**: add `SCALAR_BOUNDS_REGISTRY = {'analysis.scoring.signal_decay_half_life_hours': {minValue: 0, maxValue: 8760}}`. **Server-side enforcement in `setConfig`** (the real enforcement point, guarding agent `set_config` + direct `SetConfig` + closing the stale-config-ui fail-open window): after the existing value extraction, when the key is in `SCALAR_BOUNDS_REGISTRY`, parse the value via the **all-oneof-shape `extractValueData(value)`** (`configServiceImpl.ts:574-585`) → `Number(...)`, and reject `code:3 INVALID_ARGUMENT` when `Number.isNaN(n) || n < min || n > max`. **Not** the string-only `trading_state` read (`:385`) — the agent sends `float_val` (`client.py:1572-1573`), which a string-only read would coerce to `''`→`0`→pass, leaving the fail-open hole the whole server-side move exists to close (round-3 catch). `0` is valid (min inclusive) — never a `!n` zero-trap.
- `listKeys` emits `validation:{valueType: VALUE_TYPE_FLOAT_SCALAR, minValue, maxValue}` for `SCALAR_BOUNDS_REGISTRY` keys (config-ui renders hint + pre-validates).

### 5. Config-service — remove dead key + orphaned FLOAT_MAP machinery (FR-6; operator Fork-2 sign-off)
- **Migration 020** deletes `analysis.signals.source_weights` (up: DELETE both env rows; down: re-INSERT **both** staging+production rows, post-147 columns, `value_type='string'`, `value_data='{}'`, the **016-reworded** "SUPERSEDED" description — with a comment that the down clobbers any live operator edit to `value_data`, inherent to down-migrations).
- Remove the `WEIGHT_KEY_REGISTRY` (sole entry = the deleted key), the FLOAT_MAP validation-emit branch, and their **positive** assertions in `configServiceImpl.test.ts` / `listKeysWire.test.ts`. Add scalar wire tests + a **`setConfig` bounds-rejection test** (in-range accept, `>max` reject, `<min`/NaN reject).

### 6. Config-ui + UI sources form + docs (FR-3, FR-4)
- **Signal Sources page** (`sources/page.tsx`): add `reliability_weight` (numeric `[0,1]`, default 1.0) to `FormState`/`formFromSource`/`handleSave` + a form field, reusing the inline `saveWeight` `[0,1]` shape (`:185-203`); guidance `<p className="text-muted-foreground text-xs mt-0.5">` on **both** the form field and the existing inline editor (secret-help pattern `NamespaceEditor.tsx:160-165`). Reuses the existing admin-gated `ManageSignalSource` mutation (preserves `@AC-9`).
- **`NamespaceEditor.tsx`**: remove the now-dead `validateFloatMap` path; add scalar pre-validation for `valueType === VALUE_TYPE_FLOAT_SCALAR` (validate single numeric against `[min,max]`, show bounds hint) — **UX only; the server is authoritative**. The decay key auto-renders with its description + bounds hint. Rework the e2e fixtures/specs that assert the FLOAT_MAP key by name: `e2e/fixtures/configKeys.ts:84`, `e2e/config-ui/api-smoke.spec.ts:225-243` (hard `VALUE_TYPE_FLOAT_MAP` assertion), `audit.spec.ts:25`, `value-persists-after-save.spec.ts:16` → scalar decay key.
- **Docs**: analysis `CLAUDE.md:300` (drop dead-key row; note decay key now registered + server-bounded — and drop the now-false "set 0 **or negative** to disable" since `min=0` makes negative unsettable via SetConfig, though analysis still tolerates it defensively at `servicer.py:3248`); `config-governance.md:320` + Per-Feature Registered Keys log; proto docs; `/context-scrubber scan`.

**Build order:** agent (self-contained) → proto+buf-gen → config migrations → config-service code+tests → config-ui+e2e → UI form → docs.

## Rejected Alternatives

- **Guidance-only decay key (no proto, no server guard)** — rejected by operator (chose enforced bounds); it ships no unit-typo protection. (Recorded as the recon Fork-1 alternative; the operator override of the product-spec's original "no proto changes" is signed off in context.md.)
- **Client-side (config-ui) bounds only** — rejected: not enforcement; leaves agent `set_config`/direct `SetConfig` unguarded and fails **open** on a stale config-ui (C-10(c) trap, recurred on this file 2026-08-07/115).
- **Mirror the string-only `trading_state` guard for the bounds parse** — rejected: reads only `string_val`; the agent's `float_val` write coerces to `0` and passes unchecked (round-3 fail-open catch). Use all-shape `extractValueData`.
- **Keep the FLOAT_MAP machinery dormant** (round-2 adversary's minimum-change preference) — rejected per operator Fork-2 sign-off: keeping the code after deleting its sole key/tests ships live-but-zero-coverage code (round-1 adversary, fails.md/074). Removed cleanly (code + its tests together); proto enum member retained (deprecated) for `buf` stability.
- **Enforce the bound in the analysis reader (`get_float_present` call site)** — rejected: spreads the bound into a consumer and loses write-time reject-at-source + the config-ui hint. The config service is the chokepoint.
- **Reuse `FLOAT_MAP` to render scalar bounds without a new enum value** — rejected: a semantic lie (scalar ≠ map); config-ui would render a map editor.

## Open Risks

- [ ] **`8760` (1yr in hours) upper bound is a unit-typo guard, not a math limit** — the decay half-life has no mathematical ceiling (`servicer.py:3223-3251`); `0` is the canonical disable, and a half-life beyond a year is functionally no-decay over the Opportunities-queue age window. Accepted as a sanity bound; revisit if an operator has a legitimate >1yr half-life. Addressed at the config-service step (registry value).
- [ ] **Migration numbering 019/020 is derived from the local tree** — re-scan `origin/*` config migration dirs at `/sdd-spec` / `/sdd-execute` time before writing the numbers (fails.md 2026-07-29/081). Addressed at the migration steps.
- [ ] **020 down-restore clobbers any live operator edit** to the dead key's `value_data` (inherent to hardcoded down-migrations; the 2026-08-07 defect report shows this row was edited live). Documented in the migration comment; nothing reads the key, so runtime impact is nil.

## Constitution Rules Touched

- `C-10(c)` — honored by: enforcing the decay bound at the **write chokepoint** (`setConfig`), not via UI presentation, so agent/direct writes and stale clients cannot bypass it.
- `C-11` — honored by: this SDD story → 3-round design → ledger touch, before any code.
- `C-13` — honored by: config-ui e2e domain data stays in `e2e/fixtures/configKeys.ts`; new scalar fixture added there, not inlined.
- `C-14` — honored by: both named consumer surfaces (config-ui, agent tools) get their own steps; no backend-only stall.
- `C-15` — honored by: every `@AC-1..@AC-11` maps to a test step; `@AC-10` (mask omission) and `@AC-11` (server bounds rejection) appended for the two new behaviors.
- `C-04` — honored by: proto `ValidationRule` comment extended for scalar semantics; `FLOAT_MAP` marked `[deprecated=true]` so no comment describes non-executing validation.
- `P-03` — honored by: the all-shape `extractValueData` parse (no guard that fails to execute against the real `float_val` producer shape).
- `P-04` — honored by: fork resolutions + product-spec "no proto" override recorded in context.md.
- `F-01` — honored by: 019/020 are new migration files, never edits to applied ones.
- `F-06` — honored by: no DB pool/budget change (config service stays direct, no new pool).
- `F-07` — honored by: decay value read via `WatchConfig` (`get_float_present`), not hardcoded; only its default + bounds are declared.
- `F-11` — honored by: no Floor breach flagged across 3 rounds.

## Business Rules Touched (C-16)

- PRESERVE `@AC-3` "GetConfig/ListKeys redact secrets at the edge" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — not regressed: decay key is non-secret; redaction choke points untouched.
- PRESERVE `@AC-2` "WatchConfig never streams secret plaintext" (same suite) — not regressed: new key non-secret; stream redaction untouched.
- PRESERVE `@AC-1` "signal-weighted screen returns results" (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature`) — not regressed: weights flow from `ListSignalSources.reliability_weight` via `_drain_source_weights` (`servicer.py:3065,3231`), not the deleted config key; no analysis code touched.
- PRESERVE `@AC-2` "compute_signal_score returns a valid score" (same suite) — not regressed: scoring path untouched.
- PRESERVE `@AC-9` "config-ui trigger control is admin-gated" (`services/xstockstrat-ui/acceptance/fix-fundamentals-signal-producer.feature`) — not regressed: the reliability_weight form + decay editor reuse the existing admin-forwarding mutation/SetConfig path; the new server bounds-reject rides the same gated RPC.
- Net-new (no existing `@AC-*`): agent `reliability_weight` surfacing, decay-key registration + server bounds. New scenarios `@AC-1..@AC-11` authored; no CHANGE to a promoted rule.
