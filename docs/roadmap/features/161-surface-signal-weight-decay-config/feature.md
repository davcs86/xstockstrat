# Feature: surface-signal-weight-decay-config

**Development Branch**: `feature/surface-signal-weight-decay-config`
**Created**: 2026-08-26
**Last Updated**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-26 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. Operator overrode "no proto changes" for enforced bounds; server-side bounds fail-open bug caught in round 3 |
| 2026-08-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (sdd-design Phase 0)
- [Design](design.md) — debated architecture, rejected alternatives, open risks (sdd-design Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Clean up the dead `analysis.signals.source_weights` config key (superseded by feature 134) and fully
surface the two live signal-scoring knobs — per-source `reliability_weight` (feature 134) and the
`analysis.scoring.signal_decay_half_life_hours` decay half-life (feature 022) — to the config-ui and
MCP-agent consumers, with brief in-UI guidance wherever they are configurable.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-config` (service owner) | Config key naming (`<service>.<category>.<key>`), scoping, WatchConfig stream stability; migration correctness for the seed + delete rows |
| `xstockstrat-agent` (service owner) | MCP tool contract stability (name, params, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output |
| `xstockstrat-ui` (service owner) | Config mutation safety, Connect-RPC call safety, no secret values rendered, environment scope correctness |
| `xstockstrat-analysis` (service owner) | Confirm the decay key registration matches the value the service already reads (`get_float_present`, default 24.0) — no scoring-determinism change |
| Proto Reviewer | Additive `config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR` enum value + `FLOAT_MAP` deprecation; `buf lint`/`buf breaking` pass; `ValidationRule` comment semantics |
| DBA | Config migration NNN numbering (no gaps/conflicts), up+down pair present, run-order compliance |

## Next Action

`/sdd-review surface-signal-weight-decay-config impl-spec` — validate the implementation spec, then `/sdd-execute surface-signal-weight-decay-config`
