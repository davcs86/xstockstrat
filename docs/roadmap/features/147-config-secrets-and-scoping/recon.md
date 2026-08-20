# Recon: config-secrets-and-scoping

**Phase 0 dossier.** Grounded facts for the design debate and `/sdd-spec`. All claims `path:line`.

## Objective

Store secrets encrypted at rest in `xstockstrat-config` and serve them only via a new authenticated
`GetSecret` RPC (never on `WatchConfig`/`GetConfig`/`ListKeys`), migrate the four vendor credentials
out of `type: SECRET` env vars into that store, delete `MCP_AGENT_SECRET`, and re-model config scope
to environment(`production`/`staging`) × global/per-user with trading_mode removed as a config axis.

## Codebase Map

### xstockstrat-config (Node/TS, owner of the change)
- `src/grpc/configServiceImpl.ts` — the servicer. Key sites:
  - `buildConfigValue(row)` `:457` — **single choke point** DB row → `ConfigValue` for the in-memory
    cache. Redaction for secrets belongs here (return redacted value, keep `is_secret=true`), so
    plaintext never enters the broadcast cache.
  - `reloadAll` `:149` / `reloadNamespace` `:181` — build the snapshot cache; fan `trading_mode='all'`
    into paper/live/all buckets `:160` (the mechanism being removed).
  - `toProtoSnapPayload` `:30` — carries `isSecret` on the wire `:55`; secondary redaction guard.
  - `setConfig` `:289` — admin/internal-caller gate `:301-314`; existence gate `:355`; upsert
    `ON CONFLICT (namespace,key,environment,trading_mode)` `:372`; `pg_notify` `:380`. Encryption on
    write goes here; audit must not carry secret plaintext.
  - `getConfig` `:270`, `listKeys` `:390` (`currentValue = value_data` `:428`; redaction needed).
  - `resolveEnv` `:87` / `resolveMode` `:93` — enum→scope-string maps (accept string-const AND numeric;
    feature 078 scar). New `user_id`/scope resolution added alongside.
- `src/grpc/authz.ts` — `ADMIN_SCOPE=0x04`, `HEADER_INTERNAL_CALLER='x-internal-caller'`,
  `INTERNAL_CALLER_ALLOWLIST` (feature 102), `hasInternalCallerAuthority` (fail-closed). The
  `GetSecret` caller allow-list mirrors this exact shape.
- `src/services/configWatcher.ts` — shared **client** lib for Node services; sets `environment`/
  `tradingMode` from `APPLICATION_ENV`/`TRADING_MODE` `:37-40`.
- Migrations: last is `016_deprecate_analysis_signal_source_weights_desc`. Next config migration =
  **017**. Schema: `config.config_values(id,namespace,key,value_type,value_data,is_secret,description,
  default_value,consuming_service,updated_by,update_reason,created_at,updated_at,environment,
  trading_mode,caller_identity)`; unique `(namespace,key,environment,trading_mode)`;
  `environment CHECK IN ('dev','production')`, `trading_mode CHECK IN ('paper','live','all')`.
  Audit table + `config.audit_config_change()`/`audit_config_insert()` triggers (migrations 010/014).
- Proto `packages/proto/config/v1/config.proto`: `WatchConfigRequest{namespace,client_id,version,
  environment=4,trading_mode=5}`; `ConfigValue{oneof value, is_secret=6, description=7,
  default_value=8}`; `ConfigSnapshot{…,environment=7,trading_mode=8}`; `SetConfigRequest{…
  environment=6,trading_mode=7,create_key=8}`; `Get/ListKeysRequest{…environment,trading_mode}`;
  `ConfigKeyMeta{…is_secret=4,…environment=6,trading_mode=7,current_value=9}`.
- `packages/proto/common/v1/common.proto`: `Environment{UNSPECIFIED=0,DEV=1,PRODUCTION=2}` `:57`;
  `TradingMode{UNSPECIFIED=0,PAPER=1,LIVE=2}` `:49`.

### xstockstrat-marketdata (Go, credential consumer)
- `internal/config/config.go` `LoadFromEnv` `:36` reads `ALPACA_API_KEY:43`, `ALPACA_API_SECRET:44`,
  `FMP_API_KEY:51`, `FINNHUB_API_KEY:52` (once, at startup). Comment `:47-50` states the feature-076
  ban being reversed.
- Consumed at client construction: `internal/alpaca/client.go:87-88` (headers), `stream.go:209`
  (ws auth); `internal/fmp/fmp_client.go:54,125`; `internal/finnhub/finnhub_client.go:46,126`.
- marketdata already opens a config connection + `WatchConfig` at startup → `GetSecret` fits there,
  before building the vendor clients.

### xstockstrat-agent (Python, MCP_AGENT_SECRET owner)
- `app/oauth_server.py` — signs the stateless OAuth `txn` blob with `MCP_AGENT_SECRET` (HMAC).
  _Exact sites pending discovery agent — see Not found._
- `app/tools.py` `get_config`/`list_config_keys` already redact `is_secret`→`[redacted]` `:1017-1018`,
  `:24-25`; args include `trading_mode` (to be removed).
- `app/client.py` `get_config` `:1157` maps `is_secret` `:1174`; `list_config_keys` `:1185` `:1205`.

### xstockstrat-ui (config-ui consumer)
- `src/app/config-ui/[namespace]/NamespaceEditor.tsx` — `isSecret` `:78`; renders `[secret]` `:164`;
  suppresses edit for secrets `:184`. Environment/trading-mode selectors feed the RPC scope.

### Deploy surfaces (env-var wiring)
- `docker-compose.yml`: `ALPACA_API_KEY:?` `:250`, `ALPACA_API_SECRET:?` `:251`, `FMP_API_KEY:-` `:256`,
  `FINNHUB_API_KEY:-` `:259`, `BROKER_ACCOUNTS_ENCRYPTION_KEY:?` `:435`, `MCP_AGENT_SECRET:-` `:531`.
- `.do/app.yaml` (prod: `APPLICATION_ENV=production`,`TRADING_MODE=live`) + `.do/app.dev.yaml`
  (staging: `APPLICATION_ENV=development`,`TRADING_MODE=paper`) — `type: SECRET` blocks for the four
  vendor keys + broker key + MCP secret.
- `.github/workflows/{deploy,deploy-dev,deploy-prod,prod-up}.yml`, `scripts/do-inject-prod-secrets.py`
  (`PLACEHOLDER_KEYS`/`OPTIONAL_PLACEHOLDER_KEYS`).

## Patterns to REUSE (anti-duplication core)

- **AES-256-GCM helper** — `services/xstockstrat-trading/internal/repository/account_repo.go:217`
  `EncryptCredentials`/`:239` `DecryptCredentials` (12-byte random nonce prepended, hex key from env).
  The config service is Node, so port the **algorithm** (Node `crypto` `createCipheriv('aes-256-gcm')`,
  nonce-prepended, GCM tag) — same scheme, same env-var-hex-key custody as `BROKER_ACCOUNTS_ENCRYPTION_KEY`.
- **Internal-caller allow-list** — `src/grpc/authz.ts` `INTERNAL_CALLER_ALLOWLIST` +
  `hasInternalCallerAuthority` (fail-closed, per-grant, feature 102). `GetSecret` reuses this exact
  structure ({callerID, namespace, key}).
- **Redaction-on-read is already the consumer-edge contract** — agent `tools.py:1017`, config-ui
  `NamespaceEditor.tsx:164` already render `[redacted]`/`[secret]` from `is_secret`. Encrypting at rest
  + redacting in `buildConfigValue` makes that contract finally true end-to-end.
- **Deprecate-don't-delete proto** — `common.proto` `Timeframe` `:80-84` shows the platform's
  `[deprecated = true]` pattern (keep field number, never `reserved`). Apply to `trading_mode` config
  fields and `Environment.ENVIRONMENT_DEV`.
- **Per-(env,mode) seed collapse precedent** — migration `011_platform_trading_state` seeds 4 rows;
  the collapse migration inverts that into per-env rows.

## Dependencies

- **Proto** (breaking-ish → deprecate-don't-delete keeps it non-breaking): add
  `Environment.ENVIRONMENT_STAGING` (new number, keep DEV deprecated-but-mapped); add `user_id` to
  `WatchConfig/GetConfig/SetConfig/ListKeys` requests; deprecate `trading_mode` on all config messages
  (server ignores); add `rpc GetSecret(GetSecretRequest) returns (GetSecretResponse)`.
- **DB migration 017** (config): add `user_id TEXT` (NULL=global); change `environment` CHECK to
  `('staging','production')` + data `UPDATE 'dev'→'staging'`; collapse `trading_mode` rows per FR-10
  then drop the column; rewrite unique constraint to `(namespace,key,environment,COALESCE(user_id,''))`;
  encrypted ciphertext for `is_secret` rows (base64 in `value_data`, or new `value_encrypted BYTEA`);
  seed the 4 vendor secret rows as encrypted placeholders; audit trigger stops storing secret plaintext.
- **New env var** `CONFIG_SECRETS_ENCRYPTION_KEY` — absent from `docker-compose.yml`,
  `.do/app.yaml`, `.do/app.dev.yaml`; must be added to all (mirror `BROKER_ACCOUNTS_ENCRYPTION_KEY`).
- **Removed env vars** (scrub every wiring file): `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `FMP_API_KEY`,
  `FINNHUB_API_KEY` from marketdata; `MCP_AGENT_SECRET` platform-wide.
- **Client edges**: every `WatchConfig` caller (Go config.go, Python, Node configWatcher.ts) stops
  relying on trading_mode scope; config-ui + agent tools swap environment values dev→staging and drop
  trading_mode.

## Risks / Not-found

- **MCP_AGENT_SECRET is live and load-bearing** (resolved): `app/oauth_server.py:33` reads it;
  `_sign_txn:36`/`_verify_txn:46` HMAC-SHA256-sign the stateless OAuth `txn` blob (feature 049 edge
  auth). A **shared** key is required so instance A's `txn` verifies on instance B's callback
  (`instance_count > 1` must stay safe). **`JWT_SECRET` is NOT in the agent env** (grep-confirmed
  absent; agent delegates JWT validation to identity via gRPC `app/auth.py:26`), so the product-spec's
  "re-base on JWT_SECRET" candidate is **invalid** — using it would newly inject JWT_SECRET into the
  agent (trading one env secret for another). Agent has **no settings module** (each module reads
  `os.environ` at import). Full deploy-wiring hit list captured: `docker-compose.yml:531`,
  `.do/app.yaml:295`, `.do/app.dev.yaml:299`, `.env.example:44`, `prod-up.yml:51`,
  `do-inject-prod-secrets.py:36` (`INJECT_KEYS`), `setup-env.sh:208+`, agent `CLAUDE.md:138`,
  `docs/oauth.md:9`, agent `context-constitution.md:21` (invariant **AGENT-6**), `tests/conftest.py:56,67`.
  → FR-7 replacement is a real fork (env-var vs. encrypted-config-secret vs. injected JWT) — user gate.
- **Startup ordering**: marketdata must resolve `GetSecret` after the config connection is up but
  before constructing vendor clients. Config itself must have the master key before serving `GetSecret`.
- **Data-loss risk in the collapse (FR-10)**: a key with *different* paper vs live values in the same
  environment needs a documented winner rule (staging←paper, production←live) — no silent loss.
- **Bootstrap**: `CONFIG_SECRETS_ENCRYPTION_KEY` and `DATABASE_URL` stay env vars (config can't fetch
  its own master key from itself). JWT stays env (edge auth needs it pre-config).
- **fails.md 2026-08-19 (×2)** — plaintext-in-broadcast ban (must stay true via encryption+redaction);
  stale `secret.*` governance docs (must rewrite root CLAUDE.md, config-governance.md, reviewer-registry.md).
- **fails.md 2026-08-13 (129)** — partial env-var wiring deploys silently empty; grep-verify every add
  (`CONFIG_SECRETS_ENCRYPTION_KEY`) and every removal (4 vendor keys, MCP secret) across all wiring files.
- **Constitution**: **C-05** (`secret.*` prefix mandate) and root Rule 6 overridden with sign-off
  (context.md). **F-07** honored (secrets read from the config service, not hardcoded). **C-04** enum
  hygiene for the new `ENVIRONMENT_STAGING`. **C-09** buf lint/breaking on the proto step.

## Existing Business Rules (C-16)

- No `services/xstockstrat-config/acceptance/*.feature` suite exists today (checked: none). Cross-cutting
  `docs/sdd/business-rules/platform.feature` — to be read in the debate; the redaction/scope guarantees
  this feature adds are net-new, not a change to an existing `@AC-*`. _(Confirm in Phase 1.)_

## Recommended Scope (advisory step boundaries)

1. Proto: enum + user_id + deprecate trading_mode + `GetSecret` RPC; `buf-gen`.
2. Config migration 017: scope re-model + encryption columns + collapse + seed placeholders.
3. Config service: encryption helper, redaction in `buildConfigValue`, `GetSecret` + allow-list,
   scope resolution (env×user_id), `setConfig` encrypt-on-write + audit redaction.
4. marketdata: resolve 4 keys via `GetSecret` at startup; drop env reads + guards behavior preserved.
5. agent: delete `MCP_AGENT_SECRET`, re-base `txn` signing; drop `trading_mode` tool arg; env dev→staging.
6. UI config-ui: environment production/staging + global/per-user selector; keep secrets unrendered.
7. Client edges: Go/Python/Node config watchers drop trading_mode reliance.
8. Deploy wiring: add `CONFIG_SECRETS_ENCRYPTION_KEY`, remove 4 vendor keys + MCP secret everywhere.
9. Governance docs rewrite (Rule 6 / C-05 / reviewer-registry) + config-governance Per-Feature log.
