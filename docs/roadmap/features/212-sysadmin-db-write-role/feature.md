# Feature: sysadmin-db-write-role

**Development Branch**: `feature/sysadmin-db-write-role` (deleted 2026-09-26 after import)
**Created**: 2026-09-17
**Last Updated**: 2026-09-26

> **Renumbered 193 → 212 on 2026-09-26** to resolve a collision with the launched
> `193-fix-blend-queue-fundamentals-universe`. This feature is `demoted/canceled`; the record is
> preserved on `main-dev` as rejected-architecture memory. In-body references to "193" reflect the
> original design-time number — see `context.md` § Import & renumber provenance.

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-17 | `idea` → `draft` | /sdd-story | Product spec generated (closes security audit H-5 / DT-2) |
| 2026-09-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 1 advisory C-10 mirror-enumeration warning carried into design; 0 blockers) |
| 2026-09-17 | `spec-ready` → `draft` | /sdd-design | **Operator pivot** — superseded the in-ACL SYSADMIN-bit approach; re-baselined to privilege separation (extract db_* tooling into a standalone independently-authenticated psql MCP). Spec + acceptance rewritten; re-review required |
| 2026-09-17 | `draft` → `spec-ready` | /sdd-review | Re-baselined spec approved (PASS WITH WARNINGS: 0 blockers, no Floor breach; overlap WARN-only — rebase vs 187, deployment coordination vs 084). Advisory @AC-9 enumeration folded in |
| 2026-09-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved. Chosen: standalone `xstockstrat-psql-mcp` (Option A, transparent low-level-Server proxy over localhost postgres-mcp) with per-operator token-file auth + durable audit; public /psql, IP allowlist WAIVED (accepted-risk). Spec augmented FR-7/FR-8 + @AC-11..@AC-14, @AC-8 credential-only. recon.md + design.md written |
| 2026-09-17 | `design-approved` (unchanged) | /sdd-review | Re-validated the FR-7/FR-8 augmentation — PASS WITH WARNINGS (0 blockers, no Floor breach). Fixed FR-4 stale "no network route" wording + @AC-8/@AC-9 attribution. Status not regressed |
| 2026-09-25 | `design-approved` (amended) | operator | Deployment-topology amendment: NOT a new DO service — an isolated on-demand `supervisord` container on the feature-084 droplet, internal-only (`docker start/stop`); public `/psql` superseded. Core mechanism unchanged; per-operator token + audit retained. Hard dep 084 (`084 → 193`). Amended spec/acceptance/design/recon |
| 2026-09-25 | `design-approved` (unchanged) | /sdd-review | Merged latest main-dev; re-validated amended+merged spec — PASS WITH WARNINGS (0 blockers, no Floor breach). Corrected tool count 49→40 ⇒ 52→43 (merge drift). Added `084 → 193` blocking merge-order row + soft 187 note. @AC-13 firmed up. Status not regressed |
| 2026-09-26 | `demoted/canceled` (imported + renumbered) | /sdd-sync | Imported from the `feature/sysadmin-db-write-role` branch to `main-dev` and renumbered **193 → 212** (collision with launched `193-fix-blend-queue-fundamentals-universe`). Source branch deleted. Docs-only archival record; no code. |
| 2026-09-26 | `design-approved` → `demoted/canceled` | operator | **Demoted — architecture abandoned.** Operator swerve: postgres-mcp (crystaldba **and** pgEdge families) is deemed **inherently insecure**, so the whole premise of this feature — privilege-separating the DB tooling into a standalone psql-MCP that is *itself a hardened proxy over postgres-mcp* — is rejected. Hardening a wrapper around an insecure dependency is the wrong move; **eliminate the surface instead.** Superseded by **feature 211 (`remove-agent-postgres-mcp`)**, which removes the 9 `db_*` tools + the postgres-mcp co-process outright (no replacement service, operators use out-of-band `psql`). The DB-role teardown that this feature would have needed is carried by the rescoped **feature 208 (`psql-db-role-grant-hardening`)**. Design artifacts kept on-branch as rejected-alternative memory; key lesson distilled to the Ledger. This branch is not merged to `main-dev`. |

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

> **⚠️ DEMOTED 2026-09-26 — architecture abandoned; not merged.** postgres-mcp was judged inherently
> insecure, so privilege-separating it behind a hardened proxy is rejected in favor of **removing** the
> DB-tool surface entirely. **Superseded by feature 211 (`remove-agent-postgres-mcp`)** for the removal
> and feature 208 (`psql-db-role-grant-hardening`) for the orphaned-role teardown. The text below
> describes the abandoned approach, retained as rejected-alternative memory.

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
| `xstockstrat-agent` | Removal correctness: all nine `db_*` tools + postgres-mcp co-process gone; `docs/runbooks/mcp-tools.md` parity + every tool-count surface (52→43 on the current baseline) |
| `xstockstrat-ui` | `src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` mirror (52→43), no drift |

## Next Action

**None — demoted.** Work continues under **feature 211 (`remove-agent-postgres-mcp`)** (the removal) and
feature 208 (`psql-db-role-grant-hardening`, rescoped to orphaned-role teardown). Do not run `/sdd-spec`
on this slug.
