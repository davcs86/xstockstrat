# Defect: setup-env produces an .env that docker compose rejects

**Recorded**: 2026-10-02
**Severity**: SEV-3
**Impact type**: local-onboarding-broken
**Environment**: local
**Affected service(s)**: scripts (setup-env.sh), docker-compose.yml
**Config-only fix possible**: no

## Observed

`scripts/setup-env.sh` (the documented first-run path via `bootstrap.sh`) never collects or
generates `CONFIG_SECRETS_ENCRYPTION_KEY` or `BROKER_ACCOUNTS_ENCRYPTION_KEY`, both of which
`docker-compose.yml` requires with `${VAR:?…}` — so `docker compose up` aborts on a freshly
generated `.env`. The script also still prompts for and writes variables removed by feature 147
(`ALPACA_API_KEY`/`ALPACA_API_SECRET`, `MCP_AGENT_SECRET`), which root CLAUDE.md says must not be
reintroduced.

## Expected

A fresh `setup-env.sh` run (interactive and `--defaults`) writes a `.env` containing both
encryption keys (generated with `openssl rand -hex 32`, matching `.env.example`) and none of the
removed variables; `docker compose config` then succeeds.

## Reproduction

1. `rm -f .env && ./scripts/setup-env.sh --defaults`
2. `docker compose config >/dev/null`
3. Fails: `CONFIG_SECRETS_ENCRYPTION_KEY is required - copy .env.example to .env`.

## Evidence

`docker-compose.yml:132`
> CONFIG_SECRETS_ENCRYPTION_KEY: "${CONFIG_SECRETS_ENCRYPTION_KEY:?CONFIG_SECRETS_ENCRYPTION_KEY is required ...

`docker-compose.yml:466`
> BROKER_ACCOUNTS_ENCRYPTION_KEY: "${BROKER_ACCOUNTS_ENCRYPTION_KEY:?...

`scripts/setup-env.sh` — grep for either key: 0 hits. Removed vars still written:
`scripts/setup-env.sh:164` (`prompt_value ALPACA_API_KEY`), `:208`, `:221` (`MCP_AGENT_SECRET`).

## Root cause hypothesis

`setup-env.sh` was not updated when features 147 (config-secret encryption, vendor creds moved to
config) and the broker-account encryption key landed; `.env.example` was.

## Confidence

high
