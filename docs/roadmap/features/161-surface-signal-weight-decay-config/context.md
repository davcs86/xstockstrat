# Context: surface-signal-weight-decay-config  (archived 2026-09-01)
**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-01 — /sdd-archiver

**What**: Surfaced two live signal-scoring knobs to the config-ui and MCP agent: (1)
`analysis.scoring.signal_decay_half_life_hours` decay half-life (seeded via config migration 019,
previously unregistered, read with hardcoded 24.0); (2) per-source `reliability_weight` exposed in
the signal-source create/edit form (with guidance text) and via the agent `manage_signal_source`
tool. Removed the dead `analysis.signals.source_weights` key (migration 020). Added server-side
scalar bounds enforcement via a new `config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR=2` proto enum
member; retired `FLOAT_MAP=1` runtime machinery (`[deprecated=true]` retained for enum stability).

**Why (irrecoverable rationale)**:
- Server-side bounds (not guidance-only or client-only) were an explicit operator override of the
  original "no proto changes" product-spec scope. The override required `VALUE_TYPE_FLOAT_SCALAR=2`
  (additive, `buf breaking` passes). Recorded per C-11 commandment override convention.
- Removing `FLOAT_MAP` live code (not keeping it dormant) was required because shipping
  live-but-zero-coverage code after deleting its sole key violates C-13. The proto member stays
  `[deprecated=true]` for enum stability — removing a numeric proto member is a breaking change.
- The `WEIGHT_KEY_REGISTRY` registry-lookup bug (keyed on bare `r.key` rather than
  `${namespace}.${r.key}`) existed for the prior `FLOAT_MAP` path and was masked by non-representative
  full-path test fixtures. The fix at Step 6 catches it for all future registry additions.
- Round-3 fail-open catch: the `platform.trading_state`-mirrored bounds parse reads `float_val` as
  a string with `!n` zero-trap — `float_val:0` (valid lower bound) coerces to `0` and passes the
  guard unchecked. Fix: parse via `extractValueData` + `Number.isNaN||<min||>max`.

**Rejected alternatives**:
- Guidance-only (no enforcement): rejected (Fork 1 operator override).
- Client-only validation: rejected (drifts from backend; does not protect direct API access).
- String-only bounds parse (`!n` zero-trap): rejected in round-3 (0 is a valid lower bound).
- Keep FLOAT_MAP dormant: rejected (zero-coverage live code; C-13 violation).

**Scars & gotchas**:
- Config registry map keys MUST be full `namespace.key` paths, not bare `key` column values. Any
  future registry entry must use `` `${namespace}.${r.key}` `` as the lookup key.
- `VALUE_TYPE_FLOAT_SCALAR=2` is the authoritative bounds-enforced type; new scalar keys register
  in `SCALAR_BOUNDS_REGISTRY` with `{min, max}` at `configServiceImpl.ts`.
- `FLOAT_MAP=1` is `[deprecated=true]` in proto but no longer registered or emitted — future
  features must NOT add new `FLOAT_MAP` keys.
- Migration 019 (register decay) / 020 (remove dead key) are in `xstockstrat-config/migrations/`;
  020's down-restore clobbers any live operator edit to the dead key's `value_data`.

**Permanent deviations**:
- Operator override of "no proto changes" scope (C-11 commandment override, recorded in context.md).
- `[deprecated=true]` on `FLOAT_MAP=1` proto member instead of removal.

**Cross-feature signal**:
- CONFIG-REGISTRY-1 candidate: registry lookups in `configServiceImpl.ts` must always use the full
  `namespace.key` path as the map key. Recommend adding to `docs/context-constitution.md`.
- CONFIG-BOUNDS-1 candidate: float range guards in config handlers use `extractValueData` parse +
  `Number.isNaN||<min||>max`; `!n` zero-traps are prohibited.

**Deferred follow-ons**:
- `8760` upper bound on decay half-life is a unit-typo guard; revisit if a legitimate >1yr half-life
  is ever needed.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-09-01 entries for 161-surface-signal-weight-decay-config.

**Runtime-invariant recommendations (→ /context-constitution)**:
- CONFIG-REGISTRY-1: registry lookups must use full `namespace.key` path as map key.
- CONFIG-BOUNDS-1: float range guards use `extractValueData` + `Number.isNaN||<min||>max`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
commit preceding the archive branch `claude/archive-batch-2026-09-01`.
