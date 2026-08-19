# Feature: fmp-key-to-secret-env

**Type**: bug
**Development Branch**: `feature/fmp-key-to-secret-env` (this run: implemented on the
harness-designated branch `claude/runs-073-074-sdd-6wtwal` → `main-dev`)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Severity**: SEV-2
**Created**: 2026-07-29
**Last Updated**: 2026-08-19
**Committed to main**: 1d97c6c78caa532a24265dae2fa79c674b3b69dd
**Launched date**: 2026-08-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `bug-reported` → `code-completed` | direct fix | Surfaced while resolving feature 073's secrets blocker; user decided to use the existing Alpaca/IBKR secret mechanism rather than permit plaintext in config. |

| 2026-08-19 | `code-completed` → `launched` | status reconciliation | Reconciled to launched: code in production (main==main-dev @ 1d97c6c7); CI status automation (ci-validate-feature-status.yml) missed the slug grep-match. PR #818. |
---

## Artifacts

- [Product Spec](product-spec.md)
- [Context Log](context.md)

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `service` — xstockstrat-marketdata | Service owner — credential delivery, FMP client wiring |
| `migration` — xstockstrat-config | Service owner + DBA — removal of the seeded key row |
| Security | Required — this is where the platform's credential-handling convention gets applied |

## Summary

Feature 059 routed the FMP API key through `xstockstrat-config` as
`secret.marketdata.fmp.api_key` — the only credential on the platform stored that way, and the only
`is_secret = TRUE` row. Its migration comment promised a `secret://` reference "resolved at deploy,
never plaintext", but **no resolver was ever built** and `marketdata` passed the value straight to
the FMP client as the API key. Setting a working key therefore required putting a real credential
into `config.config_values` in plaintext, where it is streamed to every `WatchConfig` subscriber.

Every other credential — Alpaca, JWT, MCP agent, broker-account encryption key — is delivered as a
DigitalOcean App Platform `type: SECRET` environment variable. This aligns FMP with that mechanism.

## Next Action

Merge with PR #805. Set `FMP_API_KEY` in the DO dev/prod app env and in local `.env` before
enabling `marketdata.fmp.enabled`.
