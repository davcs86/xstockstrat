# Product Spec: fix-db-tls-fail-closed

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-db-tls-fail-closed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, finding D-32 (re-verified on main-dev @ a053b0e).

**Observed.** Every Node-side `pg.Pool` uses `ssl: { rejectUnauthorized: !!caCert, ...(caCert ? { ca } : {}) }`:
ledger `services/xstockstrat-ledger/src/index.ts:37`, config `services/xstockstrat-config/src/index.ts:40`, identity
`services/xstockstrat-identity/src/index.ts:39`, notify `services/xstockstrat-notify/src/index.ts:41`, and the UI
audit route `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts:31`. With `DATABASE_CA_CERT` unset, TLS is
encrypted but unverified, with no log line. `.do/app.yaml` and `.do/app.dev.yaml` bind `DATABASE_CA_CERT` for the
four backends only; `xstockstrat-ui` has `DATABASE_URL` but no CA, so its audit pool is unverified in both deployed
environments today.

**Expected.** Unless the URL explicitly says `sslmode=disable` (local compose), a pool verifies the server against a
configured CA or the process refuses to start (backends) / the audit route refuses to connect (UI), with a clear
log line. Both `.do` specs give `xstockstrat-ui` `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}`.

## Reproduction Steps

1. Run any affected service with a non-`sslmode=disable` `DATABASE_URL` and no `DATABASE_CA_CERT`, against a
   Postgres presenting a self-signed cert.
2. It connects and serves with no warning. Correct: refuse.
3. `awk '/- name:/{n=$NF} /DATABASE_CA_CERT/{print n}' .do/app.yaml` omits `xstockstrat-ui`.

## Root Cause Hypothesis

The CA was treated as optional hardening rather than a required production input, and the pool setup was
copy-pasted per service (debt-radar D-20), spreading the fail-open default; the UI was never wired with the CA.

## Affected Services

- xstockstrat-ledger
- xstockstrat-config
- xstockstrat-identity
- xstockstrat-notify
- xstockstrat-ui (config-ui audit route, plus its `.do/app.yaml` / `.do/app.dev.yaml` env block)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated — `DATABASE_CA_CERT` is a boot-time env var (it secures the channel config
  itself reads from; a `WatchConfig` key would be circular). The change adds that env var to the UI component in
  both `.do` specs.

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug (a shared Node DB-pool package is debt-radar D-20; design may choose it but it is
  not required)
- Performance improvements unrelated to the fix
- Go/Python services on the PgBouncer pool (`sslmode` handling in pgx/asyncpg) and the `db-migrator` job — not
  cited by D-32; record separately if design finds the same class there
