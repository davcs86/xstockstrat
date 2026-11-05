# Defect: Notify CLAUDE.md banner and credential note cite resolved or retired items

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no
**Source**: `services/xstockstrat-notify/docs/context-constitution-findings.md` § Documentation that lies — additions (2026-10-14) row 1

## Observed
- The Constitution banner lists "fictional ledger dep" as an open defect. That dependency and `LEDGER_ENDPOINT` were removed on 2026-08-02 (findings RESOLVED row). The banner also omits the open dead `jsonwebtoken`/`bcrypt` dependencies.
- The env note justifies keeping `SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY` and `VAPID_PRIVATE_KEY` as env vars by saying they are "never config-service rows (config governance / feature 076)". Feature 147 overrode that ban; root CLAUDE.md now stores secrets encrypted in config. Keeping these on env is a choice, but the cited rule no longer exists.

## Expected
The banner lists only open defects. The env note states that these channels deliberately stay on env `SECRET`s, without citing the retired feature-076 ban.

## Reproduction
1. Read `services/xstockstrat-notify/CLAUDE.md:4` and compare it with the findings file's RESOLVED ledger-dependency row.
2. Read `CLAUDE.md:124` and compare it with root `CLAUDE.md` § Config Governance Rules ("Secrets now live in config, encrypted at rest (feature 147 …)").

## Evidence
`services/xstockstrat-notify/CLAUDE.md:4`
> `… defects (3 dead config keys, fictional ledger dep, `severities` type/runtime mismatch) in …`

`services/xstockstrat-notify/CLAUDE.md:124`
> `> config-service rows (config governance / feature 076). `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` are`

## Root cause hypothesis
The banner was not refreshed when the findings rows were resolved, and the env note predates feature 147.

## Confidence
high
