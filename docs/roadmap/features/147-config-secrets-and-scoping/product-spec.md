# Product Spec: config-secrets-and-scoping

**Created**: 2026-08-20

---

## Problem Statement

The platform has no safe way to store a secret in configuration: `config.config_values` is
plaintext and every row is broadcast to every `WatchConfig` subscriber and served unredacted by
`GetConfig`/`ListKeys`, so feature 076 banned secrets from config (Constitution Rule 6) and pushed
every vendor credential into `type: SECRET` deploy env vars. Separately, config is scoped by
`environment` (`dev`/`production`) × `trading_mode` (`paper`/`live`/`all`) — an axis the operator
wants collapsed, since paper/live is already 1:1 with the deployment environment, and replaced with
a **global/per-user** axis so per-user overrides become possible. This feature builds the encryption
+ redaction + resolver that 076 declined (so secrets can live in config safely) and performs the
scope re-model.

## User Story

As a **platform operator**, I want to store vendor credentials and other secrets encrypted in the
config service and manage config per-environment and per-user, so that secrets are never exposed in
plaintext at any consumer edge and I can override configuration for individual users without a
redeploy.

## Functional Requirements

**A. Encrypted secrets at rest**

FR-1. A config value flagged secret is stored **encrypted** (AES-256-GCM) in the DB, using a master
key from a new `CONFIG_SECRETS_ENCRYPTION_KEY` env var (hex, per environment), mirroring the existing
`BROKER_ACCOUNTS_ENCRYPTION_KEY` pattern in `xstockstrat-trading`. Plaintext is never persisted.

FR-2. Secret plaintext is **never exposed at any consumer edge**: `WatchConfig` snapshots/deltas,
`GetConfig`, and `ListKeys` return secret values redacted (a `[redacted]` sentinel / empty oneof with
`is_secret=true`), and the config-ui and agent tools render/return only the redaction sentinel.

FR-3. A new authenticated `GetSecret` RPC decrypts a secret **server-side** and returns the plaintext
**only** to an allow-listed internal service caller (structural `x-internal-caller` channel, mirroring
feature 102), fails closed for any un-allow-listed caller, and never appears in the broadcast path.

FR-4. Writing a secret via `SetConfig` accepts plaintext from an admin caller, encrypts it before
persistence, and writes an audit row that records the change **without** the plaintext (old/new
value columns store the redaction sentinel for secret keys).

**B. Migrate vendor credentials into the store**

FR-5. The vendor API credentials `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `FMP_API_KEY`,
`FINNHUB_API_KEY` are stored as encrypted secret config values (per-environment, global scope) and
`xstockstrat-marketdata` resolves them at runtime via `GetSecret` instead of reading the env vars.
The `type: SECRET` env vars and their deploy-pipeline wiring for these four are removed.

FR-6. When a required credential (Alpaca) resolves empty, marketdata fails its startup guard exactly
as today; an optional credential (FMP/Finnhub) resolving empty stays a non-fatal off state.

**C. Remove MCP_AGENT_SECRET**

FR-7. `MCP_AGENT_SECRET` is deleted from the entire platform (agent code, docker-compose, both
`.do/*.yaml`, all deploy workflows, `do-inject-prod-secrets.py`, `setup-env.sh`, `.env.example`,
docs, and the agent `AGENT-6` invariant). Its only live use is HMAC-signing the stateless OAuth
`txn` blob in `app/oauth_server.py` (`_sign_txn`/`_verify_txn`). **Operator decision (2026-08-20):**
re-base that signature on **`JWT_SECRET`**, which is newly injected into the agent's environment
(the agent does not have it today — it delegates JWT validation to identity over gRPC). This
preserves OAuth statelessness (`instance_count > 1` stays safe — `JWT_SECRET` is a shared platform
secret). The residual `MCP_AGENT_SECRET` reads in `app/auth.py`/`app/client.py` (vestigial since
feature 097) are removed too.

**D. Two-dimension scope re-model**

FR-8. Config is scoped by exactly two dimensions: **environment** ∈ {`production`, `staging`} and
**scope** ∈ {`global`, per-user (`user_id`)}. The `trading_mode` dimension is removed; paper/live is
**derived** from environment (`production`→live, `staging`→paper), not a config axis.

FR-9. Resolution precedence: a **per-user** value for `(namespace, key, environment, user_id)`
overrides the **global** value for `(namespace, key, environment)`; absent both, the call-site code
default applies (unchanged CONFIG-2 semantics). `WatchConfig`/`GetConfig` resolve the effective value
for the caller's `user_id` when supplied, else the global value.

FR-10. Existing per-`trading_mode` rows are migrated deterministically: `all` → the environment's
global row; `paper`/`live` rows collapse onto their environment (`staging`/`production`) global row,
with the environment-appropriate row winning where both exist (documented collapse rule, no silent
data loss).

## Out of Scope

- External KMS/Vault for the master key (env-var key custody chosen; can be a later feature).
- Migrating bootstrap secrets `JWT_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`,
  `CONFIG_SECRETS_ENCRYPTION_KEY`, `DATABASE_URL`/`POSTGRES_PASSWORD` into config — they must exist
  before config/edge-auth is reachable.
- Per-user *secret* overrides (secrets are global-scope only in this feature; per-user applies to
  ordinary config values). Revisit if a real need appears.
- A per-user config-editing UI beyond an environment/scope selector; full per-user admin UX is a
  potential follow-up.
- Key rotation tooling for `CONFIG_SECRETS_ENCRYPTION_KEY` (single active key; rotation is a later
  feature).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-config` — encryption at rest, redaction, `GetSecret` RPC, scope re-model, migrations.
- `xstockstrat-marketdata` — resolve Alpaca/FMP/Finnhub via `GetSecret`; drop the four env vars.
- `xstockstrat-agent` — delete `MCP_AGENT_SECRET`; re-base OAuth `txn` signing.
- `xstockstrat-ui` — config-ui environment(`production`/`staging`) + global/per-user selectors; keep
  secrets unrendered.
- All services that call `WatchConfig` (trading, portfolio, indicators, ingest, analysis, ledger,
  identity, notify, config-ui) — the `WatchConfig` request drops `trading_mode`; the shared
  `ConfigWatcher` clients (Go/Python/Node) and their env→scope resolution change.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/config-ui`: the environment selector changes from
  `dev`/`production` to `production`/`staging`; the trading-mode selector is removed; a global/per-user
  scope selector is added; secret keys continue to render `[secret]` (never a value).
- [x] **Agent** — `xstockstrat-agent` MCP tools `get_config`/`list_config_keys`: their
  `trading_mode` argument is removed and `environment` accepts `production`/`staging`; secret values
  stay `[redacted]`. No new agent tool (`GetSecret` is internal-only, not an MCP tool).
- [ ] **None**

## Proto Contract Changes

- `common/v1/common.proto` — `Environment` enum: add `ENVIRONMENT_STAGING`; deprecate
  `ENVIRONMENT_DEV` (deprecate-don't-delete per proto governance). `TradingMode` stays (still used by
  trading/portfolio order routing) but is **removed from config messages**.
- `config/v1/config.proto` — remove `trading_mode` from `WatchConfigRequest`/`ConfigSnapshot`/
  `GetConfigRequest`/`SetConfigRequest`/`ListKeysRequest`/`ConfigKeyMeta` (deprecate the field
  numbers, do not reuse); add a `user_id`/scope field to `WatchConfigRequest`/`GetConfigRequest`/
  `SetConfigRequest`/`ListKeysRequest`; add `rpc GetSecret(GetSecretRequest) returns
  (GetSecretResponse)` returning the decrypted plaintext to internal callers only.
- This is a **breaking** proto change (field removals / semantic change) → 2 owners + platform lead.

## Config Key Changes

- No new *knob* keys. New **secret** config entries (encrypted, global scope, per environment):
  `marketdata.alpaca.api_key`, `marketdata.alpaca.api_secret`, `marketdata.fmp.api_key`,
  `marketdata.finnhub.api_key` (final names TBD in design; `secret.*` prefix is retired — see Open
  Questions). These are seeded as encrypted placeholders; real values are set post-deploy via
  `SetConfig` (an operator action), never committed.

## Database Changes

- `xstockstrat-config` migration(s): add a `user_id` (nullable; NULL = global) column and encrypted
  storage for secret rows (`value_data` holds ciphertext for secret keys, or a dedicated
  `value_encrypted BYTEA` column); change the `environment` CHECK to `('staging','production')`;
  drop/relax the `trading_mode` column and rewrite the unique constraint to
  `(namespace, key, environment, COALESCE(user_id, sentinel))`; data migration collapsing existing
  `trading_mode` rows (FR-10); update audit table + triggers to carry `user_id` and never store
  secret plaintext.
- DBA review + config service owner required.

## Feature Workflow Notes

Branch to create: `feature/config-secrets-and-scoping` (branch from `main-dev`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [x] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)
- [x] Security review (secrets / credential wiring)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Constitution Rule 6 override**: this feature deliberately reverses the "no secrets in config"
  Commandment. Operator sign-off obtained (session `AskUserQuestion`, 2026-08-20); recorded in
  `context.md`. Governance docs (root CLAUDE.md §Config Governance, `config-governance.md` Rule 6,
  `reviewer-registry.md` Security row) must be rewritten in this PR — leaving the stale `secret.*`
  ban is itself a documented fail (fails.md 2026-08-19).
- [ ] **Secret key naming**: retire the `secret://`-reference + `secret.*`-prefix convention. Proposed
  the real key names (`marketdata.alpaca.api_key`, …) carry `is_secret=true` metadata instead of a
  name prefix. Confirm in design.
- [x] **MCP_AGENT_SECRET replacement** — RESOLVED (2026-08-20): discovery confirmed the only live use
  is `txn` HMAC signing and that `JWT_SECRET` is absent from the agent env. Operator chose to inject
  `JWT_SECRET` into the agent and sign the `txn` with it. See FR-7.
- [ ] **`GetSecret` caller allow-list**: which service identities may resolve which secrets
  (marketdata → the four vendor keys). Model on the `INTERNAL_CALLER_ALLOWLIST` (feature 102).
- [ ] **Known trap (fails.md 2026-08-19, feature 129)**: a credential wired into fewer than all
  required deploy files deploys silently empty. The *inverse* now applies — every removed vendor env
  var must be scrubbed from all wiring files, and the new `CONFIG_SECRETS_ENCRYPTION_KEY` added to all
  of them. Grep-verify with the add-data-source checklist.
- [ ] **Known trap (insights.md 2026-08-19)**: prove no existing mechanism already does this before
  building — done (feature 076 explicitly declined to build the resolver; this feature builds it with
  operator sign-off).
