# Product Spec: fix-db-tls-fail-closed

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-db-tls-fail-closed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, finding D-32 (re-verified on main-dev @ a053b0e).

**Who is affected.** The platform operator/deployer, whose services' database connections can be silently
intercepted (and who must now supply the CA for a service to boot), and the config-ui admin, whose
`/config-ui/api/audit` reads run over an unverified channel today.

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

## Functional Requirements

FR-1. xstockstrat-ledger, xstockstrat-config, xstockstrat-identity and xstockstrat-notify refuse to start (non-zero
exit, before serving gRPC, with a log line naming `DATABASE_CA_CERT`) when `DATABASE_CA_CERT` is unset and
`DATABASE_URL` does not explicitly set `sslmode=disable`. This includes a URL with no `sslmode` and with
`sslmode=prefer`/`allow`/`require`; exactly how `sslmode` is parsed is pinned at design, as one parse shared by
the four backends and the UI audit route (today the route uses a substring `includes('sslmode=disable')`).
FR-2. When `DATABASE_CA_CERT` is set, every affected pool verifies the server certificate against it
(`rejectUnauthorized: true`); a certificate not signed by that CA is rejected, and a backend exits non-zero with a
logged certificate verification error.
FR-3. A `DATABASE_URL` with `sslmode=disable` (local compose) keeps connecting without TLS and without a CA.
FR-4. The config-ui audit route (`/config-ui/api/audit`) under the FR-1 condition responds with an error status,
logs that `DATABASE_CA_CERT` is required, and sends no database query.
FR-5. Both `.do/app.yaml` and `.do/app.dev.yaml` bind `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}` for every component
among the five affected services that has `DATABASE_URL`, including `xstockstrat-ui`.

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

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/config-ui` segment: the existing audit view's API route
  `/config-ui/api/audit` returns an error (FR-4) instead of reading over unverified TLS when the CA is missing. No
  new page, route, field or control; deployed environments get the CA via FR-5, so the view keeps working there.
- [ ] **Agent** — not affected. No `xstockstrat-agent` MCP tool or response mapping changes; the agent reaches the
  backends over gRPC, not their database pools.
- Operator-visible (not an end-user surface): the four backends now refuse to boot without the CA (FR-1).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated — `DATABASE_CA_CERT` is a boot-time env var (it secures the channel config
  itself reads from; a `WatchConfig` key would be circular). The change adds that env var to the UI component in
  both `.do` specs.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug (a shared Node DB-pool package is debt-radar D-20; design may choose it but it is
  not required)
- Performance improvements unrelated to the fix
- Go/Python services on the PgBouncer pool (`sslmode` handling in pgx/asyncpg) — not cited by D-32; record
  separately if design finds the same class there
- The `db-migrator` job (has `DATABASE_URL` but no `DATABASE_CA_CERT` in either `.do` spec; golang-migrate, not a
  Node `pg.Pool`) — not cited by D-32; FR-5 covers only the five affected services
