# Product Spec: config-ui-weight-validation

**Created**: 2026-06-01

---

## Problem Statement

The config-ui weight editor currently accepts any string value for keys whose value is a JSON
weight map (e.g. `analysis.signals.source_weights`). Bounds are only enforced server-side in
the consuming analysis service (which clamps out-of-range values at read time). Operators
can save invalid weights and receive no immediate feedback — they must wait for an analysis
cycle to observe the silently-clamped result. A principled fix requires the config service to
declare its validation rules in the proto contract so any client (UI or agent) can enforce them
generically without key-name heuristics.

## User Story

As an operator editing signal source weights in the config UI, I want the editor to reject
weight values outside `[0.0, 1.0]` before submitting the `SetConfig` call, so that I receive
immediate feedback for invalid input, and as a developer, I want those validation rules
declared in the proto contract so future config keys get the same enforcement automatically.

## Functional Requirements

FR-1. A `ValidationRule` message is added to `packages/proto/config/v1/config.proto` with
fields: `value_type` (enum: `VALUE_TYPE_UNSPECIFIED = 0`, `VALUE_TYPE_FLOAT_MAP = 1`),
`min_value` (float), `max_value` (float). An optional `validation` field of type
`ValidationRule` is added to the existing `ConfigKey` message.

FR-2. The `xstockstrat-config` service populates `validation` for all keys registered with
known value types. At minimum, `analysis.signals.source_weights` is registered with
`value_type = VALUE_TYPE_FLOAT_MAP, min_value = 0.0, max_value = 1.0`.

FR-3. The `xstockstrat-ui` config-ui section reads the `validation` field from each
`ConfigKey` response and, when `value_type == VALUE_TYPE_FLOAT_MAP`, validates every numeric
leaf in the JSON value against `[min_value, max_value]` before calling `SetConfig`.

FR-4. Validation is triggered on blur and on form submission. Invalid values display an inline
error identifying the offending key and the allowed bounds. The submit button is disabled while
any value fails validation.

FR-5. If `validation` is absent or `value_type == VALUE_TYPE_UNSPECIFIED`, the editor behaves
exactly as today — no validation applied, backward compatible.

FR-6. The `SetConfig` call is only made when all validated fields pass. An invalid map produces
no network request.

FR-7. `buf gen` is re-run after the proto change and the updated generated stubs are committed.

## Out of Scope

- Client-side heuristic key detection (Option A) — superseded by Option B.
- Validation of non-weight key types (enums, booleans, free-form strings) — follow-on feature.
- Backend enforcement changes — the analysis service already clamps at read time; unchanged.
- Any new UI components beyond the existing inline editor.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` — new `ValidationRule` message and `validation` field on `ConfigKey`
- `xstockstrat-config` — populate `validation` on registered weight keys in the key registry
- `xstockstrat-ui` — read `validation` field in the config-ui section; enforce in inline editor

Note: must follow `045-ui-consolidation-nextjs`. The implementation target is `xstockstrat-ui`
(post-045), not `xstockstrat-config-ui`.

## Proto Contract Changes

Non-breaking additions to `packages/proto/config/v1/config.proto`:
- New `ValidationRule` message with `value_type` (enum), `min_value` (float), `max_value` (float)
- New optional `validation` field on `ConfigKey` message
- Existing clients that ignore unknown fields continue to work without changes

## Config Key Changes

- [x] No new config keys — validation rules are declared in the proto registry, not the config
  service key store

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/config-ui-weight-validation` (branch from `main-dev`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-config` owner, `xstockstrat-ui` owner — non-breaking
  proto addition, no schema migration)
- [x] Proto Reviewer — new message + field addition (non-breaking; `buf lint` + `buf breaking`
  must pass)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (addition only)
- [ ] DBA review + service owner (schema migration) — N/A

## Merge-order Dependencies

- **Must follow 045 (`ui-consolidation-nextjs`)**: implementation targets `xstockstrat-ui`
  (the consolidated frontend); without 045, `xstockstrat-config-ui` is the target service, and
  the implementation branch would need to be rebased after 045 merges.

## Acceptance Criteria

1. `buf lint` and `buf breaking` pass after the proto addition.
2. `buf gen` regenerates TypeScript and Go stubs with the new `ValidationRule` type and
   `ConfigKey.validation` field visible in the generated output.
3. The `xstockstrat-config` key registry returns `validation` populated for
   `analysis.signals.source_weights` with `min_value = 0.0, max_value = 1.0`.
4. Entering `1.5` or `-0.1` as a weight in the config-ui editor shows an inline error and
   disables the save button; no `SetConfig` RPC is issued.
5. Entering `0.0`, `0.5`, or `1.0` clears the error, re-enables save, and `SetConfig`
   succeeds.
6. A config key with no `validation` field behaves as before — no validation applied.
7. `tsc --noEmit` passes with zero errors across `xstockstrat-ui`.

## Open Questions

_Resolved at `/sdd-review product-spec` gate (2026-06-01)._

- [x] **Validation approach.** **Decision: Option B — proto-declared validation (`ValidationRule`
  field on `ConfigKey`).** More principled; future keys automatically get validation enforcement
  without client-side key-name heuristics.
- [x] **Key detection heuristic.** **N/A — Option B chosen.** The config service declares
  `value_type` per key; no pattern matching needed in the UI.
- [x] **Sequencing vs 045.** **Decision: after 045 — target `xstockstrat-ui`.** 016 waits for
  045 to land; implementation is done in the consolidated `xstockstrat-ui` service.
