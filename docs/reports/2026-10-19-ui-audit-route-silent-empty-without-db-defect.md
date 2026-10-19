# Defect: Config-UI audit route returns an empty log silently when DATABASE_URL is unset

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: silent-misconfig
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: yes
**Source**: `services/xstockstrat-ui/docs/context-constitution-findings.md` § Open questions #1 (audit route `{ entries: [] }` when `DATABASE_URL` unset)

## Observed
After the session and admin-scope checks pass, `GET /config-ui/api/audit` returns HTTP 200
`{ entries: [] }` when `DATABASE_URL` is unset — no log line, no error status. In a deployment
where the env var is missing or dropped, the audit page shows "no entries", indistinguishable from
a genuinely empty `config.config_audit`, hiding the misconfiguration.

## Expected
Either a signalled misconfiguration (e.g. 503 or an explicit flag the page renders) outside local
dev, or an explicit maintainer ruling that silent-empty is the intended dev-mode behaviour.

## Reproduction
1. Run xstockstrat-ui without `DATABASE_URL` set.
2. Log in as an admin and open the config-ui audit page.
3. Observe an empty audit log with HTTP 200 and no server warning.

## Evidence
`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts:52-53`
> `  if (!process.env.DATABASE_URL) {`
> `    return NextResponse.json({ entries: [] });`

`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts:45-46` (admin gate runs first)
> `  if (!hasAdminScope(claims.roles)) {`
> `    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });`

## Root cause hypothesis
Deliberate graceful degradation for local dev (the UI is otherwise DB-free), applied
unconditionally with no environment check or diagnostic. Config-only mitigation: ensure
`DATABASE_URL` is set for the UI in every deploy spec.

## Confidence
low
