# Design: config-secrets-and-scoping

**Status:** design-approved (quick mode, 1 round; adversary = NEEDS WORK, no Floor breach — all
objections folded in below). Operator gate 2026-08-20: approved keeping per-user resolution on
**both** `GetConfig` and `WatchConfig` (FR-9 unchanged).

## Chosen Approach

Land the feature as a single vertical slice anchored on the config service's two existing choke
points so the redaction contract becomes true end-to-end without new fan-out.

### 1. Encryption at rest + redaction (FR-1, FR-2, FR-4)
- New `services/xstockstrat-config/src/crypto.ts` ports the Go AES-256-GCM scheme verbatim
  (`services/xstockstrat-trading/internal/repository/account_repo.go:217/239`): Node
  `crypto.createCipheriv('aes-256-gcm', key, nonce)`, 12-byte random nonce, wire layout
  `nonce(12) || ciphertext || authTag(16)`, key = `CONFIG_SECRETS_ENCRYPTION_KEY` hex → 32 bytes.
  `encryptSecret(plaintext) → Buffer`, `decryptSecret(buf) → string` (throws on GCM auth failure).
  Fail-fast at startup if the env var is absent/wrong length (config refuses to boot rather than
  encrypt with a zero key).
- Secret ciphertext lives in a **new `value_encrypted BYTEA` column**; for any secret row
  `value_data` holds the literal `'[redacted]'` sentinel (defense-in-depth double guard). The typed
  parse in `buildConfigValue` (`configServiceImpl.ts:457`) is untouched.
- **`is_secret` is row-authoritative on write** (adversary fix): `setConfig` extends its
  existence-gate `SELECT` (`:355`) to also read the existing row's `is_secret`, and encrypts +
  forces `value_data='[redacted]'` **whenever the stored row is secret**, regardless of the request's
  `is_secret` field. An admin update that omits the flag therefore can never land plaintext in
  `value_data` (closes the exact fails.md-2026-08-19 leak). Creating a brand-new secret key requires
  `create_key=true` + request `is_secret=true`.
- `buildConfigValue` returns `{ string_val: '[redacted]', is_secret: true }` for any secret row
  regardless of `value_type` — one site covers `WatchConfig` snapshot/delta (AC-2) and `GetConfig`
  (AC-3). `listKeys` sets `currentValue = is_secret ? '[redacted]' : value_data` (AC-3).
- **Structural invariant (adversary fix):** `value_encrypted` is selected **only** by `getSecret`'s
  dedicated query. `reloadAll`/`reloadNamespace`/`listKeys` never add it to their column lists, and
  `toProtoSnapPayload`'s spread fallback (`:60`) never sees it — so ciphertext cannot reach the wire.

### 2. GetSecret RPC (FR-3)
- New `getSecret(call, callback)`: resolves the **global** `(namespace, key, environment,
  user_id IS NULL)` row, decrypts `value_encrypted`, returns `{ value, found }`.
- Gated by a new `SECRET_CALLER_ALLOWLIST` + `hasSecretCallerAuthority(md, namespace, key)` in
  `src/grpc/authz.ts`, structurally mirroring `INTERNAL_CALLER_ALLOWLIST`/`hasInternalCallerAuthority`
  (`:90/:104`, fail-closed on absent/unlisted `x-internal-caller`). Seeded grants: `callerID
  'marketdata'` → the four `marketdata.*` vendor keys (AC-4, AC-5).
- **Distinct failure modes (adversary fix, AC-16):** row absent OR `value_encrypted IS NULL` →
  `found=false`, empty value; ciphertext present but `decryptSecret` throws → `INTERNAL`, never a
  partial/empty plaintext (so a key mismatch cannot masquerade as "unset credential").
- Registered in the gRPC server binding (`src/grpc/serviceDefinition.ts` + `src/index.ts`).

### 3. Scope re-model: environment{production,staging} × global/per-user (FR-8, FR-9, FR-10)
- Proto (deprecate-don't-delete): `common.proto` `Environment` adds `ENVIRONMENT_STAGING = 3`,
  marks `ENVIRONMENT_DEV = 1 [deprecated = true]`. `config.proto` deprecates `trading_mode` on
  `WatchConfigRequest(5)`/`GetConfigRequest(3)`/`SetConfigRequest(7)`/`ListKeysRequest(3)`/
  `ConfigSnapshot(8)`/`ConfigKeyMeta(7)`; adds `string user_id` to the four requests
  (`WatchConfigRequest=6, GetConfigRequest=4, SetConfigRequest=9, ListKeysRequest=4`); adds
  `rpc GetSecret(GetSecretRequest{namespace,key,environment}) returns (GetSecretResponse{value,found})`.
- `resolveEnv` (`:87`) maps `ENVIRONMENT_STAGING` **and** the deprecated `ENVIRONMENT_DEV` → `'staging'`,
  `ENVIRONMENT_PRODUCTION` → `'production'`. Fix **both** the string-constant branch and the numeric
  `ENV_MAP` (`:22`) — `stringEnums=true`, the feature-078 scar. `resolveMode`/`requestMode` and the
  paper/live/all fan-out in `reloadAll`/`reloadNamespace` are removed; the global snapshot cache key
  drops from `ns:env:mode` to `ns:env`.
- **Per-user overlay on BOTH read paths (operator-approved):** a subscriber/caller may pass
  `user_id`. Resolution = the global `(ns,env)` snapshot **overlaid** with that user's
  `(ns,env,user_id)` rows. The overlay is composed from **already-redacted** `buildConfigValue`
  output, and secrets are **global-scope only**, so a per-user overlay can never carry secret
  plaintext (AC-14). `WatchConfig`: per-user subscribers get their own subscriber record keyed by
  `user_id`; on `pg_notify` for `(ns,env)` the broadcast recomputes each per-user subscriber's overlay
  (global base + that user's rows, both redacted) and sends a DELTA (AC-13). `GetConfig`: one-shot
  overlay (AC-11). Global subscribers (`user_id` empty) are unchanged — the common case.

### 4. Migration 017 (`017_config_secrets_and_scoping`)
1. `ADD COLUMN value_encrypted BYTEA`, `ADD COLUMN user_id TEXT` (NULL = global) on
   `config.config_values`; `ADD COLUMN user_id TEXT` on `config.config_audit`.
2. `UPDATE ... SET environment='staging' WHERE environment='dev'` (values + audit table); drop the
   old `environment` CHECK, add `CHECK (environment IN ('staging','production'))`.
3. **FR-10 collapse** — before dropping `trading_mode`, snapshot every row into a
   `config.config_values_premigration_017` audit table (adversary fix: faithful, auditable, and a
   schema-honest `.down.sql`). Then per `(namespace,key,environment)` pick the winner: env-matched
   mode > `all` > opposite mode (`production`→`live`, `staging`←`paper`), write it into the global
   (`user_id NULL`) row, delete the losers. Documented winner rule in the migration header. AC-12:
   `(production,live=HALTED)` beats `(production,all=ACTIVE)` → `HALTED`.
4. Drop unique `(namespace,key,environment,trading_mode)`; `DROP COLUMN trading_mode` on **both**
   `config_values` and `config_audit`; `CREATE UNIQUE INDEX config_values_scope_uniq ON
   config.config_values (namespace, key, environment, COALESCE(user_id,''))`.
5. **Rewrite both audit trigger functions** `config.audit_config_change()` (migration 001) and
   `config.audit_config_insert()` (migration 010) in the same migration so they carry `user_id` and
   no longer reference `trading_mode` — else every `SetConfig` throws `column "trading_mode" does not
   exist` at runtime, invisible to CI (adversary fix, fails.md fix-listorders shape). They keep
   copying `value_data` (already the `[redacted]` sentinel for secrets) and never read
   `value_encrypted`.
6. Seed the four vendor secret rows for **staging + production**, global scope, `is_secret=true`,
   `value_encrypted=NULL`, `value_data='[redacted]'`, `consuming_service='xstockstrat-marketdata'`:
   `marketdata.alpaca.api_key`, `marketdata.alpaca.api_secret`, `marketdata.fmp.api_key`,
   `marketdata.finnhub.api_key`. Ciphertext is NULL (SQL has no master key); the operator sets real
   values post-deploy via `SetConfig` (which encrypts). A NULL-ciphertext row resolves via GetSecret
   as `found=false` → marketdata sees empty creds → the existing warn-and-start path (FR-6).
- `.down.sql`: re-add `trading_mode` (default `'all'`) + old CHECK, restore rows from
  `config_values_premigration_017`, drop the new columns/index/RPC-independent state; documented as
  best-effort (the collapse is inherently lossy but the premigration table makes it faithful).

### 5. marketdata resolves the four keys via GetSecret (FR-5, FR-6)
- `internal/config/config.go` `LoadFromEnv` (`:36`) drops the four env reads (`:43,44,51,52`). A new
  startup step in `cmd/server/main.go` (after the config connection is up, before building the
  alpaca/fmp/finnhub clients at `:65`+) calls config `GetSecret` with `x-internal-caller='marketdata'`
  and `environment` from `APPLICATION_ENV`, for the four keys, and writes the resolved strings into
  the **same** `Config` fields (`AlpacaAPIKey/AlpacaAPISecret/FMPAPIKey/FinnhubAPIKey`) the vendor
  clients and the `looksLikePlaceholderCred` warn-and-start guard (`main.go:85-95`) already read — so
  behavior is byte-for-byte preserved (AC-6, AC-7). `TRADING_MODE`/`ALPACA_BASE_URL` env stay.

### 6. Agent: delete MCP_AGENT_SECRET, re-sign txn with JWT_SECRET (FR-7)
- `app/oauth_server.py:33` `MCP_AGENT_SECRET` → `JWT_SECRET = os.environ["JWT_SECRET"]`; `_sign_txn`/
  `_verify_txn` (`:36/:46`) use it. **Fail-fast at import if `JWT_SECRET` is unset** (adversary fix —
  the agent has no settings module; an absent var would otherwise HMAC with an empty key). Remove the
  vestigial `MCP_AGENT_SECRET` reads in `app/auth.py:19`/`app/client.py:23`. Update `AGENT-6`
  invariant (agent `context-constitution.md:21`), `tests/conftest.py:56,67`, `docs/oauth.md`.
- Inject `JWT_SECRET` into the agent block (reuse the existing platform value). **Removal gate
  (adversary fix, AC-8):** the operative-symbol scrub (env reads + deploy-spec keys + workflow +
  `do-inject-prod-secrets.py`) must be zero; docs may still *name* `MCP_AGENT_SECRET` in a
  removed-vars note (platform convention, e.g. `N8N_WEBHOOK_SECRET`).

### 7. Env-var wiring
- **Add** `CONFIG_SECRETS_ENCRYPTION_KEY` to the config block and `JWT_SECRET` to the agent block in:
  `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`, `scripts/do-inject-prod-secrets.py`,
  `scripts/setup-env.sh`, `.env.example`, and the deploy workflows (`deploy.yml`, `deploy-dev.yml`,
  `deploy-prod.yml`, `prod-up.yml`). Mirror `BROKER_ACCOUNTS_ENCRYPTION_KEY` shape.
- **Remove** `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `FMP_API_KEY`, `FINNHUB_API_KEY` from marketdata's
  wiring — **verified marketdata-only consumer** (`config.go:43-52`; trading uses per-account
  encrypted creds, not a global env key). Grep-verify every add/remove across all wiring files
  (fails.md-129 inverse: a partial scrub leaves a dangling secret; a partial add deploys silently empty).

### 8. Consumer edges
- `NamespaceEditor.tsx`: environment selector `dev/production` → `production/staging`; remove the
  trading-mode selector; add a `global`/per-user (`user_id`) scope selector feeding the RPC; secrets
  keep rendering `[secret]` (`:164`) and stay edit-suppressed (`:184`). Update the BFF connect client
  building `environment`/`user_id`.
- `app/tools.py` `get_config`/`list_config_keys`: drop the `trading_mode` arg; `environment` accepts
  `production`/`staging`; keep `is_secret` → `[redacted]` (`:1017`); retire the `secret.*` name-prefix
  check in favor of the `is_secret` flag. `app/client.py:1157/1185` map accordingly.
- Go/Python/Node `ConfigWatcher` clients drop `trading_mode` from the `WatchConfig` request
  (`configWatcher.ts:37-40`, marketdata `config.go` request builder). They may still send it (proto
  field deprecated, server ignores) — but we stop populating it.

## Rejected Alternatives
- **base64 ciphertext in `value_data`** (no new column) — lost: the `value_encrypted BYTEA` +
  `[redacted]` sentinel gives the audit triggers and every legacy `value_data` reader the sentinel
  for free; simpler to prove no plaintext leaks.
- **Cut per-user overlay from `WatchConfig`, GetConfig-only** — proposed by both subagents as safer;
  **operator chose to keep it** (2026-08-20 gate). Mitigated by composing the overlay from redacted
  values + secrets-are-global-only (AC-14) + a dedicated overlay test (AC-13).
- **Add a fatal Alpaca credential startup guard** — lost: today's behavior is warn-and-start
  (`main.go:85-95`); a fatal guard is both a behavior change (C-14/sign-off) and a resilience
  regression (a transient GetSecret blip would hard-kill marketdata). Preserve warn-and-start.
- **Resolve the OAuth txn key from encrypted config via GetSecret** — lost to the operator's choice to
  inject `JWT_SECRET` (simpler bootstrap, no agent→config GetSecret dependency at OAuth time).
- **Delete `trading_mode` proto fields outright** — lost: violates deprecate-don't-delete /
  `buf breaking` (C-09); deprecate-in-place is non-breaking.

## Open Risks (mirror into context.md Open Threads)
- **WatchConfig per-user overlay** (kept per operator): cache-key growth ∝ distinct per-user
  subscribers; rebroadcast recomputes each on change. Bounded (per-user subscribers are rare;
  services subscribe global). Redaction-safety guaranteed by redacted-overlay + global-only secrets;
  AC-14 tests it. → target: config service step + its test step.
- **JWT_SECRET blast radius**: the internet-facing agent (port 9000, runs MCP tool code) now holds
  identity's JWT signing secret; a compromised agent could forge admin JWTs. Accepted, operator-locked;
  mitigated by txn-HMAC-only use + fail-fast-if-unset. → recorded; no further action.
- **Migration 017 down-migration is lossy-by-nature**; the `config_values_premigration_017` table makes
  it faithful. → target: migration step.
- **Post-deploy operator action**: real vendor credentials must be set via `SetConfig` after deploy
  (seed ciphertext is NULL). → target: runbook/docs step.

## Constitution Rules Touched
- **C-05 / root Rule 6** (no secrets in config; `secret.*` prefix) — **overridden with explicit
  operator sign-off** recorded in `context.md`. The three root causes 076 cited are all closed
  (encryption at rest, redaction at every edge, real `GetSecret` resolver). Governance docs rewritten
  in this PR.
- **F-07** (read config from the service, don't hardcode) — honored: secrets move to a server-side RPC.
- **C-04** (enum hygiene) — `ENVIRONMENT_STAGING=3` added with the `_UNSPECIFIED=0` sentinel intact;
  deprecate-don't-delete on `ENVIRONMENT_DEV` and the `trading_mode` fields.
- **C-09** (proto verify) — `buf lint` + `buf breaking` on the proto step; deprecate-in-place keeps it
  passing; `./scripts/buf-gen.sh` after.
- **C-07 / F-01** — migration 017 is new (no edit to an applied migration), with an up+down pair.
- **C-08 / P-06** — security ACs (AC-1/1b/2/3/5/16) proven RED-before-GREEN with **non-zero
  assertions against compiled output** (feature-074 zero-assertion trap).
- **C-10** — the `trading_mode`-drop completeness sweep (server reads + both audit triggers + audit
  table) and the env-var add/remove sweep across all wiring files.
- **C-14** — consumer surfaces named (config-ui selectors, agent tool args).
- **F-06** — no new DB pool; config stays direct at max 2.

## Business Rules Touched (C-16)
- No `services/xstockstrat-config/acceptance/*.feature` suite exists (net-new behavior; nothing to
  regress). The redaction/scope guarantees are new `@AC-*` promoted into the config suite at
  integration. No existing platform `@AC-*` is changed.

## Rounds
1 (quick mode). Termination: operator approved at the round-1 gate (kept WatchConfig per-user overlay).
