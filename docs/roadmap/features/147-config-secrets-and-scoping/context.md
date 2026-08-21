# Context: config-secrets-and-scoping  (archived 2026-08-21)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-21 — /sdd-archiver

**What**: Shipped an encrypted config-secret store (AES-256-GCM at rest, `[redacted]` at every
broadcast/read edge, an authenticated `GetSecret` RPC for allow-listed internal callers), migrated
the four Alpaca/FMP/Finnhub vendor credentials out of env vars into config rows, replaced the
`trading_mode` config axis with `environment{production,staging} × global/per-user`, and deleted
`MCP_AGENT_SECRET` (the agent now HMAC-signs its stateless OAuth `txn` with `JWT_SECRET`). This
deliberately reverses the feature-076 "no secrets in config" Commandment under recorded operator
sign-off. A post-launch operator review (PR #994) then materially reshaped the access model, so much
of the shipped authz/edge behavior diverges from what `design.md` described (see Permanent deviations).

**Why (irrecoverable rationale)**: The override is not a repeat of 076 because 076's three root
causes are all closed (plaintext → encrypted; broadcast-to-all → redacted at the single row→message
choke point; missing resolver → a real `GetSecret`); 076 *explicitly declined* to build the resolver,
so the "prove no mechanism exists before building" bar was met. The operator chose to **inject
`JWT_SECRET` into the agent** for OAuth-`txn` signing rather than resolve that key via `GetSecret` —
a simpler bootstrap with no agent→config dependency at OAuth time — knowingly accepting that an
internet-facing agent now holds identity's JWT signing secret (a compromise could forge admin JWTs).
Recon overturned the product-spec's premise that `JWT_SECRET` was already in the agent env (it was
not — the agent delegates JWT validation to identity over gRPC), turning that into a real design fork.

**Rejected alternatives**:
- base64 ciphertext in `value_data` (no new column) — lost to a dedicated `value_encrypted BYTEA` +
  `[redacted]` sentinel, which hands every legacy `value_data` reader and both audit triggers the
  sentinel for free, making "no plaintext leaks" trivially provable.
- fatal Alpaca-credential startup guard — lost to warn-and-start; a fatal guard is both a behavior
  change and a resilience regression (a transient `GetSecret` blip would hard-kill marketdata).
- `GetSecret`-sourced OAuth `txn` key — lost to the `JWT_SECRET`-injection choice above.
- cut the per-user overlay from `WatchConfig` (GetConfig-only) — proposed by *both* design subagents
  as safer; the **operator overrode** and kept it on both read paths, accepting per-subscriber
  cache-key growth, mitigated by redacted-overlay composition + secrets-are-global-only.
- delete the `trading_mode` proto fields outright — lost to deprecate-don't-delete / `buf breaking`.

**Scars & gotchas**:
- Dropping the `trading_mode` column broke the **config-ui BFF audit route**, which directly
  `SELECT`s the config service's audit table — a cross-service reader outside the owning service,
  invisible to the migration and to CI. The design sweep caught the two in-schema audit triggers but
  not this UI-service DB reader. (→ fails.md, migration.)
- `is_secret` must be **row-authoritative on write** — an admin update that omits the flag would
  otherwise land plaintext in `value_data`; `setConfig` re-reads the stored row's flag and forces
  encryption + sentinel regardless of the request. (Already in the 2026-08-20 insights entry.)
- Edge header-forwarding via a contextvar works **only** because the MCP SDK's `ServerMiddleware`
  runs in the handler's own task — explicitly verified (`runner.py` `_make_context` →
  `_compose_server_middleware`) before relying on the contextvar reaching every `client.*` call.

**Permanent deviations** (shipped contradicts design):
- design: config-ui secret rows stay edit-suppressed and agent tools **refuse** `is_secret` writes →
  shipped **unblocks** secret writes via both MCP and config-ui (Edit offered; editor opens BLANK,
  never the redacted sentinel; password-masked) → because the operator ruled the backend admin gate +
  row-authoritative encryption make a client-side refusal redundant and wrong.
- design: agent config tools accept a caller-facing `environment` param → shipped **removed** it; env
  is always `APPLICATION_ENV` → because environment is a deployment property, not a caller choice.
- design: no agent header forwarding → shipped makes the agent a full **edge** forwarding the whole
  `x-user-id`/`x-access-scope`/`x-trace-id` trio on every outbound gRPC and minting a trace-id when
  absent → because the operator flagged AGENT-4 as "the opposite of what I wanted".
- design: per-user authz unspecified → shipped **owner-only self-service**: a global write needs
  ADMIN; a per-user write requires `x-user-id == target user_id`; an admin earns **no** override for
  another user's per-user row (secrets stay global-only).

**Cross-feature signal**: A self-service backend authz rule and its UI affordance must agree — the
config-ui first shipped a free-form "enter any user id" scope control that contradicted the owner-only
backend rule and had to be clamped server-side to the session user (PR #996). Recurring class: a UI
exposing a scope the backend forbids. Also: the platform now has **two independent AES-256-GCM ports**
(trading per-account creds `account_repo.go:217`; config secrets `crypto.ts`) that could drift.

**Deferred follow-ons**: The four vendor secret rows seed with **NULL ciphertext** — real
per-environment credentials must be set post-deploy via an admin `SetConfig` (which encrypts) or
marketdata resolves them empty and takes its warn-and-start path. No key-rotation tooling exists for
`CONFIG_SECRETS_ENCRYPTION_KEY` (single active key); external KMS/Vault custody is out of scope.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-08-21 entries. (The
2026-08-20 three-guard-redaction + distinct-resolver insight was written at execute time and is not
duplicated.)

**Runtime-invariant recommendations (→ /context-constitution)**: `xstockstrat-ui` directly reads the
**config service's** DB schema (config-ui audit route, direct pool `:25060`), so a config-owned
schema change can break the UI service — a cross-module coupling worth a `PLAT-*` / `UI-*` invariant.
(AGENT-3/AGENT-4 "agent-is-an-edge, forwards the full trio + mints trace-id" were already rewritten
in the agent's own `context-constitution.md` this feature — no new routing needed.)

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
679ae9e2.
