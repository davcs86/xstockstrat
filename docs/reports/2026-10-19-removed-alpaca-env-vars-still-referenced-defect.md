# Defect: Removed ALPACA_* env vars still referenced in .env.example header and marketdata WARN

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-marketdata; repo root (`.env.example`)
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Documentation that lies row "`.env.example` header"

## Observed
Feature 147 removed `ALPACA_API_KEY` / `ALPACA_API_SECRET` env vars; the credentials are now
encrypted config rows resolved by marketdata through `GetSecret`. Two places still point operators
at the env vars:
- `.env.example`'s header lists `ALPACA_*` among `.env` secrets (the same file states the removal at
  line 30), and says `.env.fe.local` loads on "the 3 Next.js services (trader, insights, config-ui)",
  which were consolidated into `xstockstrat-ui` by feature 045.
- marketdata's placeholder-credential warning tells operators to "set the real
  ALPACA_API_KEY/ALPACA_API_SECRET secrets", though the values come from `resolveSecret`.

## Expected
Header drops `ALPACA_*` and names `xstockstrat-ui` as the single Next.js consumer; the WARN names
the config secret rows (`marketdata.alpaca.api_key` / `api_secret`).

## Reproduction
1. Read `.env.example:4-11`, compare with `.env.example:30`.
2. Read `services/xstockstrat-marketdata/cmd/server/main.go:79-80` vs `:106-108`.

## Evidence
`.env.example:8`
> #                   only on the 3 Next.js services (trader, insights, config-ui).

`.env.example:10`
> #                   ALPACA_*, JWT_SECRET, OTEL_EXPORTER_OTLP_ENDPOINT,

`.env.example:30`
> # Feature 147: ALPACA_API_KEY, ALPACA_API_SECRET, FMP_API_KEY and FINNHUB_API_KEY are no longer

`services/xstockstrat-marketdata/cmd/server/main.go:79`
> cfg.AlpacaAPIKey = resolveSecret("alpaca.api_key")

`services/xstockstrat-marketdata/cmd/server/main.go:106-108`
> slog.Warn("ALPACA credentials look empty or are still set to a placeholder — "+
> "every Alpaca market-data call will fail with a 401; set the real "+
> "ALPACA_API_KEY/ALPACA_API_SECRET secrets",

## Root cause hypothesis
Features 045 and 147 changed the env surface without sweeping the header comment and the log string.

## Confidence
high
