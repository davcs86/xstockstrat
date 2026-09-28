# Feature: indicators-sandbox-os-isolation

**Development Branch**: `feature/indicators-sandbox-os-isolation`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit C-3 / DT-1 — OS-level isolation for the escapable formula sandbox) |
| 2026-09-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS, 2 advisory). AC-6 phrasing NOTE fixed pre-advance (observable Then, no `sandbox.py` reference). The 4 Open Questions (isolation mechanism, DO/compose runtime compat, tunable-vs-fixed config split, latency budget) are correctly-deferred /sdd-design inputs, not spec defects. Overlap scan CLEAN — watch at impl-spec: pin NEW `indicators.sandbox.*` leaf names (existing timeout_ms/max_concurrent/allowed_imports are trunk), and potential indicators-Dockerfile co-edit with 210 (mTLS). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec indicators-sandbox-os-isolation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the indicators formula sandbox's in-process builtins/import **blocklist** (escapable via the
`().__class__.__base__.__subclasses__()` reflection chain — no AST allowlist) with **OS-level
isolation**: evaluate untrusted formula code in a locked-down child (no network namespace, no
filesystem write beyond scratch, dropped Linux capabilities, RLIMIT CPU/memory/wall-clock caps) so a
sandbox escape yields no code execution against the service's credentials, network, or peers. The
Critical finding C-3 in `docs/reports/2026-09-16-trading-system-security-audit.md`; DT-1 is its design
ticket. Builds on the shipped C-4 partial mitigation (minimal child env, `_sandbox_env()`), which
severed secret inheritance but left the escape itself outstanding.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Escape containment: an escaped evaluator has no network egress, no DB credential, no writable FS beyond scratch, and dropped capabilities; the isolation boundary is OS-enforced, not language-level; the `subclasses()` reflection escape no longer yields lateral movement |
| `xstockstrat-indicators` | `app/services/sandbox.py` correctness: legitimate formulas evaluate identically; resource-limit termination is deterministic and returns a typed error; latency/throughput impact acceptable |
| Platform lead | Runtime/deployment mechanism (subprocess hardening vs a jailer such as nsjail/gVisor), Dockerfile/base-image and capability requirements, CI feasibility of the isolation in the indicators image |

## Next Action

`/sdd-design indicators-sandbox-os-isolation` — recon + adversarial design debate (resolves the 4 Open Questions, esp. the isolation-mechanism fork)
