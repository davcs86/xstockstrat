# Feature: fix-marketdata-secret-exposure

**Type**: bug
**Development Branch**: `feature/fix-marketdata-secret-exposure`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md` (debt-radar D-39, D-40) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; 5 WARN-level file overlaps, no FAIL) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator signed off the config @AC-4 CHANGE (header → header+SAN) and folded the `build request: %w` sites into Step 1 |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-10-28 | `implementation-ready` (no change) | /sdd-execute (re-spec) | Steps 1, 5, 7, 8, 9 re-aligned to the codebase after merging `origin/main-dev` (line drift only; Step 7 pre-merge gate grep moved to `deploy.yml:101`) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Sequential execution started; up-front plan confirmed by operator standing authorization (see context.md) |
| 2026-10-28 | `in-progress` (no change) | /sdd-execute sequential | Step 1 done: D-39 `*url.Error` redaction at the FMP and Finnhub transport and build-request sites |
| 2026-10-28 | `in-progress` (no change) | /sdd-execute sequential | Step 2 done: D-39 client tests (transport, build-request, deadline, budget refund) for FMP and Finnhub |
| 2026-10-28 | `in-progress` (no change) | /sdd-execute sequential | Step 3 done: D-39 service-edge test, `Unavailable` status is key-free on `GetFundamentals` and `GetFundamentalsMulti` |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute (re-spec) | Steps 4-9 re-checked against the codebase after merging `origin/main-dev`: all cites resolve; Step 5 `setEnv(...leaf, caPem)` arity clarified, Step 9 log check via DO apps MCP `apps-get-logs` |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 4 done: shared mTLS PKI test helper `mtlsTestPki.ts` (`sh`, `mintLeaf`, `setEnv`) extracted from `peerSanSpike.test.ts` and `mtls.test.ts` |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 5 done: the GetSecret describe of `secretsAndScope.test.ts` now runs over mTLS (config server leaf, marketdata client leaf, plus an `ingestClient` for Step 6) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 6 done: wire AC-3 (254) wrong-SAN negative added to `secretsAndScope.test.ts`; recorded RED against the header-only marketdata grant (pairs with Step 7) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 7 done: D-40 `marketdata` GetSecret grant bound to `peerSan: 'xstockstrat-marketdata'`; unit deny matrix (AC-3/AC-4/AC-6) in `perUserSecrets.test.ts`; wire AC-3 (254) now green |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 8 done: config/marketdata/root docs state the `marketdata` grant's DNS SAN `xstockstrat-marketdata`; residuals defect report `docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md` filed (`open`) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 9 marked done by operator decision: the dev smoke of marketdata credential resolution is post-merge verification, run and recorded by the operator's session after the integration PR deploys to dev (not yet performed) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), collected from each step's `**Reviewers**`.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-marketdata` owner | Vendor client error handling (D-39); the marketdata leaf SAN the D-40 grant binds to | 1, 2, 3, 7 |
| `xstockstrat-config` owner | Secret encryption + redaction, `GetSecret` allow-list (D-40) | 4, 5, 6, 7 |
| Security | No plaintext secret in errors, logs or OTel; `GetSecret` gated by verified caller identity (header + mTLS SAN) | 1, 6, 7 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

FMP/Finnhub transport errors wrap a `*url.Error` whose message carries the vendor API key (D-39). Config's
`marketdata` `GetSecret` grant has no `peerSan`, so any mTLS peer can decrypt all four vendor credentials by
sending `x-internal-caller: marketdata` (D-40).

## Next Action

`/sdd-review fix-marketdata-secret-exposure impl-spec` — validate implementation spec, then `/sdd-execute fix-marketdata-secret-exposure`
