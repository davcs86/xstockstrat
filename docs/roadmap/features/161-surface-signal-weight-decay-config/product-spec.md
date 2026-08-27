# Product Spec: surface-signal-weight-decay-config

**Created**: 2026-08-26

---

## Problem Statement

Two live signal-scoring knobs are under-surfaced and one dead key lingers. (1) Per-source
`reliability_weight` (feature 134) is fetched by the agent's client but dropped before it reaches the
model in `list_signal_sources`, and `manage_signal_source` cannot read or write it at all; in the UI
it is only inline-editable after a source exists and carries no guidance text. (2) The decay half-life
`analysis.scoring.signal_decay_half_life_hours` (feature 022) is read with a hardcoded 24.0 default
but was never registered as a config key, so it is invisible in config-ui. (3) The superseded
`analysis.signals.source_weights` key is retained-but-dead and still documented, inviting operators to
edit a value nothing reads. Operators and the agent cannot reliably see or tune signal ranking.

## User Story

As a platform operator (and the MCP agent acting on their behalf), I want the per-source reliability
weight and the signal decay half-life to be visible and editable through config-ui and the agent
tools with plain-language guidance, and the dead source-weights key removed, so that I can tune signal
ranking confidently without editing a value that has no effect.

## Functional Requirements

FR-1. The MCP `list_signal_sources` tool includes each source's `reliability_weight` in its returned
data and documents it in the tool docstring/return contract.

FR-2. The MCP `manage_signal_source` tool accepts an optional `reliability_weight` argument on
`create`/`update`, passes it through to the `ManageSignalSource` RPC (with the correct AIP-161
`update_mask` path `reliability_weight` on update), and returns the resulting `reliability_weight`.
Out-of-range values (outside `[0.0, 1.0]`) are rejected by the existing backend validation and the
tool surfaces that error rather than swallowing it.

FR-3. The config-ui signal-source create/edit modal form includes a `reliability_weight` field
(numeric, `[0,1]`, default 1.0) so the weight can be set at registration time, with brief
plain-language guidance text at the field.

FR-4. The existing config-ui inline weight editor on the Signal Sources page gains brief
plain-language guidance text explaining what the weight does and its `[0,1]` / default-1.0 semantics.

FR-5. `analysis.scoring.signal_decay_half_life_hours` is registered as a config key via a
config-service seed migration: value_type `float`, default `24.0`, and a description carrying operator
guidance. It then appears in config-ui's `analysis` namespace editor with that description and its
bounds, and is cleanly settable via `set_config` / the MCP `set_config` tool without `create_key`.
(Design decision, 3-round debate: the operator chose **enforced** bounds over guidance-only. Enforcing
scalar bounds requires a new `config.v1.ValueType` enum member — this is an explicit operator override
of this spec's original "no proto changes" scope, signed off in `context.md`.)

FR-8. The decay key's bounds `[0, 8760]` (0 = disable decay; 8760h = 1yr, a unit-typo guard) are
**enforced server-side** in the config service's `SetConfig` write path (parsing the value across all
oneof shapes, not string-only), so an out-of-range or non-numeric write is rejected `INVALID_ARGUMENT`
without persisting — regardless of caller (config-ui, agent `set_config`, or direct `SetConfig`).
config-ui also pre-validates against the same bounds for immediate feedback (UX only; the server is
authoritative). config-ui surfaces the bound via a new `VALUE_TYPE_FLOAT_SCALAR` validation type.

FR-6. The dead `analysis.signals.source_weights` config key is removed via a config-service migration
(delete the `config.config_values` row), and its stale references in documentation
(`docs/patterns/config-governance.md`, `services/xstockstrat-analysis/CLAUDE.md`, and any
Per-Feature Registered Keys log entry) are removed or marked removed.

FR-7. A descriptor-parity / return-shape contract test guards the agent's `SignalSource` request
builder and response projection so that a future proto field added to `SignalSource` fails the test
until the builder/projection carries it (or explicitly opts out) — closing the F-6/RC-1 drift class
that dropped `reliability_weight` in the first place.

## Out of Scope

- Any change to how `reliability_weight` or the decay half-life are *applied* in analysis scoring
  (the `_compute_opportunities` formula, screener weighting) — this feature only surfaces and
  registers existing knobs; the math is unchanged.
- Ingest proto changes — `reliability_weight` already exists on `ingest.SignalSource` (field 12); no
  new ingest fields, messages, or RPCs. (A non-breaking additive enum value is added to
  `config.v1.ValueType` — see Proto Contract Changes — but no new messages/RPCs/field renumbering.)
- Per-user (non-global) scoping semantics for the decay key beyond what the generic config machinery
  already provides.
- Changing the decay default away from the current 24.0 hardcoded value.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — surface `reliability_weight` in `list_signal_sources`; add it to
  `manage_signal_source` input/passthrough/return; add the descriptor-parity contract test.
- `xstockstrat-ui` — add the `reliability_weight` form field + guidance to the config-ui Signal
  Sources create/edit modal; add guidance text to the existing inline weight editor.
- `xstockstrat-config` — seed migration (019) registering `analysis.scoring.signal_decay_half_life_hours`;
  delete migration (020) removing the dead `analysis.signals.source_weights` rows; `configServiceImpl.ts`
  server-side scalar-bounds enforcement in `SetConfig` + `ListKeys` validation emission + removal of the
  orphaned FLOAT_MAP machinery.
- `packages/proto` — add `VALUE_TYPE_FLOAT_SCALAR` to `config.v1.ValueType` (non-breaking); regenerate stubs.
- `xstockstrat-analysis` — **docs-only**: update its `CLAUDE.md` Config Keys table (drop the dead
  key; note the decay key is now registered). No code change — it already reads the decay key with a
  default and already ignores the dead key.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/config-ui`: (a) new `reliability_weight` field with guidance
  in the Signal Sources create/edit modal (`/config-ui/sources`); (b) guidance text added to the
  existing inline weight editor on the same page; (c) the newly-registered decay key auto-appears in
  the generic `/config-ui/analysis` namespace editor with its description. All reachable through the
  existing config-ui nav entry (no new page/route → no new `PLATFORM_SUBNAV` registration needed;
  C-10(a) does not apply).
- [x] **Agent** — `xstockstrat-agent` MCP tools: `list_signal_sources` (new returned field
  `reliability_weight`), `manage_signal_source` (new `reliability_weight` arg + passthrough + return).
  The decay key is reachable through the already-generic `get_config`/`set_config`/`list_config_keys`
  tools once registered — no per-key tool change.
- [ ] **None**

## Proto Contract Changes

- **`config.v1.ValueType`**: add member `VALUE_TYPE_FLOAT_SCALAR = 2` (additive → non-breaking; `buf breaking` passes) and mark `VALUE_TYPE_FLOAT_MAP = 1` `[deprecated = true]`; extend the `ValidationRule` doc-comment to define scalar-bound semantics. Required to surface + enforce the decay key's scalar bounds (FR-5/FR-8). Explicit operator override of the original "no proto changes" scope (context.md). Run `./scripts/buf-gen.sh`.
- `ingest.SignalSource.reliability_weight` (field 12) already exists — no ingest proto change.

## Config Key Changes

- **ADD** `analysis.scoring.signal_decay_half_life_hours` — float, default `24.0`, server-enforced
  bounds `[0, 8760]` (0 disables decay; 8760 = 1yr typo-guard), description with operator guidance.
  Registered in `xstockstrat-config` (owner of the config store); read by `xstockstrat-analysis`.
- **REMOVE** `analysis.signals.source_weights` — dead since feature 134; delete both registered rows
  (staging + production) and its `WEIGHT_KEY_REGISTRY` entry + the now-orphaned FLOAT_MAP validation
  machinery (operator Fork-2 sign-off, context.md).

## Database Changes

- [x] Two `xstockstrat-config` migrations against `config.config_values` (data rows, not schema):
  - `NNN_register_analysis_signal_decay_half_life.{up,down}.sql` — insert the decay key row (down: delete it).
  - `NNN+1_remove_analysis_signal_source_weights.{up,down}.sql` — delete the dead key row (down: re-insert it to restore reversibility).
  - Numbering confirmed at `/sdd-spec` time by `ls services/xstockstrat-config/migrations/` (currently highest is `018`, so likely `019`/`020`).

## Feature Workflow Notes

Branch to create: `feature/surface-signal-weight-decay-config` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config key change) — `xstockstrat-config` owner
- [x] Proto Reviewer (non-breaking proto change — additive enum value; `buf breaking` must pass)
- [ ] 2 service owners + platform lead — N/A, proto change is **non-breaking**
- [x] DBA review + service owner (config-store migrations 019/020)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- **Known trap (F-6 / RC-1, ledger fails.md):** the agent's hand-written `SignalSource` dict→proto
  request builder and response projection are explicitly named as having silently dropped new proto
  fields before (this feature exists because `reliability_weight` was one such drop). FR-7 mandates a
  descriptor-parity contract test as the durable antidote (insights.md, `test_backtest_view` pattern).
- **Known trap (F-11 / config value_type immutability, ledger fails.md):** do not touch any existing
  config key's `value_type`. This feature only *adds* the decay key (float) and *deletes* the dead
  key — no in-place type change.
- **Known trap (migration numbering, ledger fails.md):** `ls services/xstockstrat-config/migrations/`
  immediately before writing either migration number; never assume the next NNN.
- [x] **RESOLVED (design):** Decay-key upper bound = **8760** (1yr in hours) — a unit-typo guard, not
  a math limit (the half-life has no mathematical ceiling; 0 is the canonical disable). Accepted as an
  Open Risk in design.md; revisit only if an operator has a legitimate >1yr half-life.
