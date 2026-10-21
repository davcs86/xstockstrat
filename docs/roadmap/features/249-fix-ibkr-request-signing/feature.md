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

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement | TBD (/sdd-spec) |
| Security | Secrets encrypted at rest, redacted at every read edge; new credential wiring per `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy" | TBD — LST handshake adds RSA/DH key material to the encrypted IBKR credential blob |
| `xstockstrat-ui` owner | Config mutation safety, no secret values rendered in UI | Only if the IBKR account form gains credential fields (`src/components/trader/accountShared.tsx`) |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output | Only if `manage_account` gains IBKR credential fields (`app/tools.py`) |
| `packages/proto` owner | Backward compatibility, naming conventions | Only if the `credentials_json` shape comment (`trading/v1/trading.proto:267`) changes |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (3 rounds, full)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ibkr-request-signing`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`IBKRClient.signRequest` signs plain OAuth 1.0a: query params are excluded from the base string, the HMAC key is
`&` + access-token secret instead of a Live Session Token, and the header has no `realm`. Every IBKR call is
therefore expected to 401; `ValidateCredentials` maps that to INVALID (TRADING-3).

## Next Action

`/sdd-spec fix-ibkr-request-signing` — generate implementation spec from the approved design.
