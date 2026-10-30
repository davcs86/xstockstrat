# Feature: fix-ibkr-request-signing

**Type**: bug
**Development Branch**: `feature/fix-ibkr-request-signing`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (14 warnings; overlap WARN: file-level, rebase-only vs 240) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps |
| 2026-10-28 | `implementation-ready` (no change) | /sdd-execute (re-spec) | Steps 1, 4, 6, 7, 15 re-grounded against the codebase after merging origin/main-dev (line-drift only; substance unchanged) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 1 done: IBKR reference fixtures (ibind vectors, test keys, DH params) + gitleaks scope incl. the operator-approved `vectors.json` path allowlist |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Steps 2+3 done in one commit (operator decision): LST signer `authorize`/`authorizeLST`/`buildBaseString` + ibind known-answer tests; FR-3 ruled include query params |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Steps 4+5 done in one commit (standing operator rule "Merge pairs + standing rule"): coalesced LST session (`ensureSession`, handshake, `ssodh/init`, negative cache, `invalidate`/`reinit`) + `testdata.IBKRAuthHandler` and session tests (AC-3/4/5/10 broker half) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Steps 6+7 done in one commit (standing operator rule "Merge pairs + standing rule"): `c.do` send seam (11 call sites migrated, `signRequest` deleted, 401 retry, no-bridge re-init, `ErrOutcomeUncertain`) + wire-level/retry-matrix/AC-8 tests and existing IBKR tests migrated to `IBKRAuthHandler` (AC-1/2/6/8 broker half) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Steps 8+9 done in one commit (standing operator rule "Merge pairs + standing rule"): trading plumbing (7-field `ibkrCreds`, `ibkrTiming` from `trading.ibkr.*`, IBKR-only `validateIBKRCreds`, `isUncertainBrokerOutcome`, `reconcileTick` credential-rejected skip) + service-level tests (AC-3..AC-10 service half) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 10 done: three `trading.ibkr.*` keys (`lst_refresh_margin_ms` 60000, `handshake_timeout_ms` 10000, `reauth_min_interval_ms` 30000) registered in the trading CLAUDE.md Config Keys table and the config-governance Per-Feature Registered Keys log (unseeded, feature 102 precedent) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 11 done: `trading.proto` `RegisterBrokerAccountRequest.credentials_json` comment lists the 7-key IBKR shape (`signature_key`, `encryption_key`, `dh_prime` added); comment-only, `buf lint`/`buf breaking` clean |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 12 done: `./scripts/buf-gen.sh` regenerated exactly the 5 `gen/` stubs (Go `trading.pb.go`, TS `trading_pb.ts`/`trading.ts` and their `dist` `.d.ts`), with comment-only diffs; Go plugins rebuilt with go1.27 to match CI `proto-freshness` |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Steps 13+14 done in one commit (standing operator rule; operator "B: Keep native" for the empty-key assertion): `/trader` IBKR form collects `signatureKey`/`encryptionKey`/`dhPrime` as PEM `Textarea`s, 7-key `credentials_json`, `CREDENTIAL_KEYS`-derived watch/set/map, `FieldError` per input; e2e AC-7 register/blocked-submit/edit-no-echo + Offline guard |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Steps 15+16 done in one commit (standing operator rule): agent `manage_account` docstring and `mcp-tools.md` `credentials_json` row list the 7-key IBKR shape (`signature_key`/`encryption_key`/`dh_prime` as PEM) and the incomplete-IBKR `INVALID_ARGUMENT`; tests add IBKR no-echo, 7-key verbatim forwarding, `INVALID_ARGUMENT` surfacing and the docstring assertion |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 17 done: `ibkr.md` OAuth 1.0a + LST section, trading `CLAUDE.md` credential-health IBKR handshake note, TRADING-3 widened (deterministic credential failures, any IBKR call), findings open question resolved (feature 249) + stale anchors re-stamped; teardown by manual reconciliation (context-forge refresh unavailable) |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute sequential | All 17 steps done; 10 acceptance scenarios promoted to `services/xstockstrat-trading/acceptance/fix-ibkr-request-signing.feature` (C-16) |

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

`/sdd-review fix-ibkr-request-signing impl-spec` — validate implementation spec, then `/sdd-execute fix-ibkr-request-signing`. FR-3 query-param inclusion vs the ibind reference: operator ruled "include" on 2026-10-29 (context.md).
