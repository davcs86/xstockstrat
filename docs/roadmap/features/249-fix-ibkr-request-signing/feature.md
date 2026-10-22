# Feature: fix-ibkr-request-signing

**Type**: bug
**Development Branch**: `feature/fix-ibkr-request-signing`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (14 warnings; overlap WARN: file-level, rebase-only vs 240) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-21). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 |
| Security | Secrets encrypted at rest, redacted at every read edge; committed test key material and gitleaks scope; RSA/DH key handling; private keys entered in the UI | 1, 4, 8, 13 |
| Proto Reviewer | Field number uniqueness, no breaking change, `buf lint` / `buf breaking` | 11, 12 |
| `packages/proto` owner | Backward compatibility, naming conventions | 11, 12 |
| `xstockstrat-ui` owner | Trading UI correctness, no secret values rendered in UI | 13, 14 |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output | 15, 16 |
| Config team (approval) | New config keys `trading.ibkr.*` (owner + config team, `docs/runbooks/approval-flow.md`) | 10 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (3 rounds, full)
- [Implementation Spec](implementation-spec.md) — 17 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`IBKRClient.signRequest` signs plain OAuth 1.0a: query params are excluded from the base string, the HMAC key is
`&` + access-token secret instead of a Live Session Token, and the header has no `realm`. Every IBKR call is
therefore expected to 401; `ValidateCredentials` maps that to INVALID (TRADING-3).

## Next Action

`/sdd-review fix-ibkr-request-signing impl-spec` — validate implementation spec, then `/sdd-execute fix-ibkr-request-signing`. Operator ruling owed before the integration PR merges: FR-3 query-param inclusion vs the ibind reference (implementation-spec.md § Execution Summary, CONFLICT).
