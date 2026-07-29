# Context Log: fmp-key-to-secret-env

Append-only.

---

## Session 2026-07-29 — surfaced, decided, implemented

- Surfaced while resolving feature 073's third review blocker (whether `set_config` may write a real
  plaintext secret). The user's answer was conditional: allow plaintext **only if** no existing
  secret mechanism exists, and to triple-check that first.
- The check found one, decisively: **DO App Platform `type: SECRET` env vars**, 10 per app spec,
  covering `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `JWT_SECRET`, `MCP_AGENT_SECRET` and
  `BROKER_ACCOUNTS_ENCRYPTION_KEY` (the IBKR/broker-account credential key). All read via `getEnv`,
  none through the config service. No `secret://` resolver exists anywhere in the codebase.
- User confirmed: **"no, use the same existing mechanism used for ibkr and alpaca keys."**
- Two credential patterns exist on the platform, both rooted in a `type: SECRET` env var:
  (a) platform-wide vendor credential → plain env var (Alpaca);
  (b) per-user broker credentials → AES-256-GCM blob in the DB, master key from env (IBKR,
  `EncryptCredentials`/`DecryptCredentials` in trading's `account_repo.go`).
  FMP is a single platform-wide vendor key, so pattern (a) applies.

### Changes

- `internal/config/config.go` — `FMPAPIKey: getEnv("FMP_API_KEY", "")`, beside the Alpaca keys.
- `cmd/server/main.go` — `APIKey: cfg.FMPAPIKey` instead of the `cfgWatcher.GetString` read.
- `docker-compose.yml` — `FMP_API_KEY: ${FMP_API_KEY:-}` (optional: the pipeline is off by default,
  so no `:?` required-guard, unlike the Alpaca keys).
- `.env.example` — documented, empty by default.
- `.do/app.yaml` / `.do/app.dev.yaml` — `FMP_API_KEY` `type: SECRET` in the marketdata block.
- `migrations/009_drop_fmp_api_key_config.{up,down}.sql` — removes the seeded row. New migration
  rather than editing `007` (Floor **F-01**). The `.down.sql` restores the placeholder only.
- Docs: marketdata `CLAUDE.md` key table + FMP section, `docs/patterns/config-governance.md` row.

### Verification

- `GOWORK=off go build ./...` — OK
- `GOWORK=off go test ./internal/config/...` — OK, including two new cases asserting the key comes
  from the env and defaults to empty
- `yaml.safe_load` on both app specs and `docker-compose.yml` — all parse; `FMP_API_KEY` confirmed
  inside the marketdata block, directly after the Alpaca keys

### Outstanding

- The operator must set `FMP_API_KEY` in the DO dev/prod app env and local `.env` before enabling
  `marketdata.fmp.enabled`. Until then the FMP client builds with an empty key (same failure mode as
  an unset Alpaca key).
- If any environment already had a real key written into `secret.marketdata.fmp.api_key`, migration
  `009` deletes that row — treat the value as compromised (it was plaintext in a table streamed to
  all subscribers) and rotate it at FMP rather than reusing it.

### Consequence for feature 073

`set_config` rejects `is_secret` keys. After this feature there are no `is_secret` rows left, so the
question is now largely moot — but the guard stays, so the next person who adds one cannot write a
credential through an MCP tool. `get_config`'s redaction (073 FR-1) also stays: it is cheap, and
feature 075 made the `is_secret` field trustworthy.
