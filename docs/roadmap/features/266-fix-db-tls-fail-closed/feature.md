# Feature: fix-db-tls-fail-closed

**Type**: bug
**Development Branch**: `feature/fix-db-tls-fail-closed`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-db-tls-fail-closed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-db-tls-fail-closed-defect.md` (debt-radar D-32) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN with 242/248/241) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps |
| 2026-10-29 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 1–17 re-grounded after main-dev merge (252 tsc-first runners, 248 `makeListenerClient`, line drift) |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-29 | `in-progress` (steps 1–2 done) | /sdd-execute sequential | Resolver `dbTls.ts` + test table in five services, one commit per the operator's merge-pairs standing rule |
| 2026-10-29 | `in-progress` (step 3 done) | /sdd-execute sequential | CI `xstockstrat-ui` filter gains `.do/**`; UI devDependency `yaml@^2.9.0` |
| 2026-10-29 | `in-progress` (steps 4–5 done) | /sdd-execute sequential | Ledger resolves DB TLS first in `main()` (Pool + EventNotifier); boot + Pool-level TLS-stub tests, one commit per the merge-pairs standing rule |
| 2026-10-29 | `in-progress` (steps 6–7 done) | /sdd-execute sequential | Config resolves DB TLS first in `main()` (before `loadMasterKey`); boot tests through `main()` for AC-1, AC-2 (wrong CA + positive control) and AC-3, one commit per the merge-pairs standing rule |
| 2026-10-29 | `in-progress` (steps 8–9 done) | /sdd-execute sequential | Identity resolves DB TLS first in `main()` (before `ConfigWatcher`) and probes `SELECT 1` at boot; boot + Pool-level TLS-stub tests, one commit per the merge-pairs standing rule |
| 2026-10-29 | `in-progress` (steps 10–11 done) | /sdd-execute sequential | Notify resolves DB TLS first in `main()` (before `ConfigWatcher`) and probes `SELECT 1` at boot; boot + Pool-level TLS-stub tests, one commit per the merge-pairs standing rule |
| 2026-10-29 | `in-progress` (steps 12–13 done) | /sdd-execute sequential | Config-ui audit route resolves DB TLS fail-closed before building its pool, logs trace id + code + message only, returns a generic 500; route vitest for AC-4, AC-7, AC-8, one commit per the merge-pairs standing rule |
| 2026-10-29 | `in-progress` (step 14 done) | /sdd-execute sequential | `xstockstrat-ui` binds `DATABASE_CA_CERT` (`${xstockstrat.CA_CERT}`, `RUN_TIME`) after its `DATABASE_URL` in `.do/app.yaml` and `.do/app.dev.yaml` (FR-5); `db-migrator` untouched |
| 2026-10-29 | `in-progress` (step 15 done) | /sdd-execute sequential | Platform guard vitest `dbTlsPlatformGuard.test.ts`: AC-5 YAML parse of both `.do` specs (+ negative row), SHA-256 copy guard over the five `dbTls.ts`, static resolver-wiring scan (AC-2) with a two-entry ledger `ssl:` allow-list and a synthetic negative |
| 2026-10-29 | `in-progress` (step 16 done) | /sdd-execute sequential | Docs: `DATABASE_CA_CERT` env rows in the ledger/config/identity/notify/ui `CLAUDE.md` (identity/notify note the boot `SELECT 1` DB dependency); `docs/patterns/database.md` § Node DB TLS (fail-closed); scoped `dbTls.ts`/`mtls.ts` exemption in `docs/patterns/dry-guard-rail.md` |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md`, written by /sdd-spec on 2026-10-22 from the per-step **Reviewers**.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant and event ordering; query pool + LISTEN/NOTIFY client boot under the TLS gate | 1, 2, 4, 5, 15 |
| `xstockstrat-config` owner | Secret-bearing DB channel; boot ordering beside `CONFIG_SECRETS_ENCRYPTION_KEY`; WatchConfig stability | 1, 2, 6, 7, 15 |
| `xstockstrat-identity` owner | Secret store integration (password and refresh-token hashes); new boot `SELECT 1` | 1, 2, 8, 9, 15 |
| `xstockstrat-notify` owner | Stream delivery and boot behaviour; new boot `SELECT 1` | 1, 2, 10, 11, 15 |
| `xstockstrat-ui` owner | No direct DB access except the audit log; no secrets in responses; environment scope of the `.do` binding; CI gate scope | 1, 2, 3, 12, 13, 14, 15 |
| Security | Fail-closed TLS verification; CA as public bootstrap env; no connection material in client responses; drift guard | 1–15 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Four Node services and the UI audit route set `rejectUnauthorized: !!caCert`, so a missing `DATABASE_CA_CERT`
silently downgrades to unverified TLS; the UI component has no `DATABASE_CA_CERT` in either `.do` spec, so its
audit route already connects unverified in both deployed environments.

## Next Action

`/sdd-review fix-db-tls-fail-closed impl-spec` — validate implementation spec, then `/sdd-execute fix-db-tls-fail-closed`
