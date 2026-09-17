# Feature: sysadmin-db-write-role

**Development Branch**: `feature/sysadmin-db-write-role`
**Created**: 2026-09-17
**Last Updated**: 2026-09-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-17 | `idea` → `draft` | /sdd-story | Product spec generated (closes security audit H-5 / DT-2) |
| 2026-09-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 1 advisory C-10 mirror-enumeration warning carried into design; 0 blockers) |
| 2026-09-17 | `spec-ready` → `draft` | /sdd-design | **Operator pivot** — superseded the in-ACL SYSADMIN-bit approach; re-baselined to privilege separation (extract db_* tooling into a standalone independently-authenticated psql MCP). Spec + acceptance rewritten; re-review required |
| 2026-09-17 | `draft` → `spec-ready` | /sdd-review | Re-baselined spec approved (PASS WITH WARNINGS: 0 blockers, no Floor breach; overlap WARN-only — rebase vs 187, deployment coordination vs 084). Advisory @AC-9 enumeration folded in |
| 2026-09-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved. Chosen: standalone `xstockstrat-psql-mcp` (Option A, transparent low-level-Server proxy over localhost postgres-mcp) with per-operator token-file auth + durable audit; public /psql, IP allowlist WAIVED (accepted-risk). Spec augmented FR-7/FR-8 + @AC-11..@AC-14, @AC-8 credential-only. recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + candidate architectures (/sdd-design Phase 0)
- [Design](design.md) — chosen approach, rejected alternatives, open risks, Constitution + C-16 rules (/sdd-design Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec sysadmin-db-write-role`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

**Privilege separation of the DB tooling** — extract all nine `db_*` tools and the `postgres-mcp`
co-process out of the prompt-injectable `xstockstrat-agent` MCP into a **standalone "psql MCP"**
service that authenticates on its **own out-of-band credential**, independent of the xstockstrat
OAuth/JWT login and access-scope ACL, exposed on its **own ingress endpoint**. A prompt-injected or
compromised agent session is thereby left with **no tool, credential, or network path to execute any
SQL** — closing security-audit finding **H-5** (`docs/reports/2026-09-16-trading-system-security-audit.md`,
DT-2) at the trust boundary rather than via a model-satisfiable in-agent gate. _(Re-baselined
2026-09-17 from the original in-ACL `sysadmin`-role/scope-bit design — see `context.md`.)_

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Trust-boundary correctness: the psql MCP's auth is independent of the xstockstrat ACL; the "no prompt-injectable path to SQL" invariant (no tool, credential, or route); no blanket `x-access-scope` reuse (fails.md 2026-08-05) |
| Platform lead | New service in the registry + deployment topology (new DO component + ingress route); connection-pool budget re-label (FR-6) |
| `xstockstrat-agent` | Removal correctness: all nine `db_*` tools + postgres-mcp co-process gone; `docs/runbooks/mcp-tools.md` parity + every tool-count surface (49→40) |
| `xstockstrat-ui` | `src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` mirror (49→40), no drift |

## Next Action

`/sdd-spec sysadmin-db-write-role` — generate the numbered implementation spec from the approved design
