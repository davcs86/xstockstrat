# Product Spec: fmp-key-to-secret-env

**Type**: bug
**Severity**: SEV-2
**Created**: 2026-07-29

---

## Problem Statement

`secret.marketdata.fmp.api_key` is a config key (`migrations/007_marketdata_fmp.up.sql`), seeded
with the placeholder `secret://marketdata/fmp-api-key` and described as "resolved at deploy, never
plaintext". Two things make that false:

1. **No resolver exists.** A repo-wide search for `secret://` across `services/`, `packages/` and
   `scripts/` finds no resolution logic anywhere.
2. **The consumer uses the value literally.** `services/xstockstrat-marketdata/cmd/server/main.go`
   passed `cfgWatcher.GetString("secret.marketdata.fmp.api_key", "")` directly into
   `fmp.NewClient` as `APIKey`.

So making the FMP pipeline work required storing the real key as plaintext in
`config.config_values` — a table with no encryption, whose contents stream to every `WatchConfig`
subscriber and are exposed through `GetConfig`/`ListKeys`.

Meanwhile the platform already has a credential mechanism, used by **every** other secret:
DigitalOcean App Platform `type: SECRET` environment variables (10 per app spec), read via
`getEnv`, with `${VAR}` from `.env` locally. Examples: `ALPACA_API_KEY`, `ALPACA_API_SECRET`,
`JWT_SECRET`, `MCP_AGENT_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY` (the IBKR/broker-account
credential encryption key). FMP was the sole exception.

## Affected Services

- `xstockstrat-marketdata` — reads the credential
- `xstockstrat-config` — migration removing the seeded row

## Fix Scope

- [x] No proto changes
- [x] Migration required — `009_drop_fmp_api_key_config` removes the seeded row (new numbered
      migration; the applied `007` is never edited, per Floor rule F-01)
- [x] Config keys: one **removed**. The non-secret FMP knobs (`enabled`, `base_url`, `metrics`,
      `cache_ttl_hours`, `daily_request_cap`) stay in config — only the credential moves.
- [x] New env var `FMP_API_KEY` in `docker-compose.yml`, `.env.example`, `.do/app.yaml`,
      `.do/app.dev.yaml`

## Acceptance Criteria

- [x] AC-1 `marketdata` reads the FMP credential from the `FMP_API_KEY` env var, not from config.
- [x] AC-2 `FMP_API_KEY` is declared `type: SECRET` in both DO app specs, in the marketdata block.
- [x] AC-3 The seeded `secret.marketdata.fmp.api_key` row is removed by a new numbered migration
      with a working `.down.sql` that restores only the placeholder, never a real credential.
- [x] AC-4 Unit tests assert the key comes from the environment and defaults to empty when unset.
- [x] AC-5 Docs no longer describe a `secret://` resolver that does not exist.
- [ ] AC-6 **Operator step, outstanding:** set `FMP_API_KEY` in the DO dev/prod app env and in local
      `.env` before flipping `marketdata.fmp.enabled` to true.

## Out of Scope

- Building a real secret store / `secret://` resolver.
- The `is_secret` flag and `ConfigValue.is_secret` propagation — that mechanism still exists and is
  still correct (fixed in feature 075); there simply are no `is_secret` rows left after this.
- Any other feature-059 behavior (caching, request caps, metric tiers).
