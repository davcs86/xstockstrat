# Context: config-secrets-and-scoping

**Feature**: `docs/roadmap/features/147-config-secrets-and-scoping/feature.md`
**Product Spec**: `docs/roadmap/features/147-config-secrets-and-scoping/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/147-config-secrets-and-scoping/implementation-spec.md`

---

## Session 2026-08-20 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  operator request.

### Constitution Rule 6 override — explicit operator sign-off (REQUIRED RECORD)

The root CLAUDE.md §Config Governance Rule 6 and `docs/patterns/config-governance.md` Rule 6 are a
**Commandment**: "A vendor API credential is never a config key … the `secret.*`/`is_secret`
mechanism was tried once and reversed (feature 076)." Overriding a Commandment requires the user's
**explicit** sign-off recorded here.

**Sign-off obtained** via `AskUserQuestion` on 2026-08-20. The operator directed:
1. **Secrets scope** — migrate *vendor API keys only* (Alpaca key+secret, FMP, Finnhub) into an
   encrypted config store; keep `JWT_SECRET`, encryption master keys, and `DATABASE_URL` as bootstrap
   env vars; and **delete `MCP_AGENT_SECRET` once and for all**.
2. **Dimensions** — *replace* `trading_mode` with a global/per-user axis; environment becomes
   `production`/`staging`; paper/live is derived from environment.
3. **Encryption** — *AES-256-GCM + env-var master key* (`CONFIG_SECRETS_ENCRYPTION_KEY`), mirroring
   `BROKER_ACCOUNTS_ENCRYPTION_KEY`; decrypt only inside config; expose via an authenticated
   `GetSecret` RPC; redact everywhere else.

Why this is *not* a repeat of the feature-076 mistake: 076 was reversed because (a) config values were
plaintext and (b) broadcast to every `WatchConfig` subscriber, and (c) the `secret://` resolver was
never built. This feature closes all three gaps — encryption at rest, redaction on every
broadcast/read edge, and a real server-side-decrypt resolver (`GetSecret`) gated to allow-listed
internal callers. The insights.md 2026-08-19 rule ("prove no mechanism exists before building") is
satisfied: 076 *explicitly declined* to build the resolver as out-of-scope, and the operator has now
scoped it in with sign-off.

### Known traps carried into design (from the Ledger)

- **fails.md 2026-08-19 (fmp-key-to-secret-env)**: a credential must never sit plaintext in a
  `WatchConfig`-broadcast table. Design must guarantee ciphertext-at-rest + redaction-on-broadcast so
  this stays true even though the credential now lives in config.
- **fails.md 2026-08-19 (fundamentals-provider-alternative)**: three governance docs still assert the
  dead `secret.*` ban. This PR must rewrite them, not add a fourth stale copy.
- **fails.md 2026-08-13 (feature 129)**: a vendor credential wired into fewer than all required
  deploy files deploys silently empty. Inverse now applies: every *removed* env var must be scrubbed
  from all wiring files, and `CONFIG_SECRETS_ENCRYPTION_KEY` added to all of them. Grep-verify.

### MCP_AGENT_SECRET replacement — resolved mid-design (2026-08-20)

Recon (agent) found the product-spec assumption wrong: **`JWT_SECRET` is not in the agent env** (the
agent delegates JWT validation to identity over gRPC; `app/auth.py:26`), and `MCP_AGENT_SECRET`'s
only live use is HMAC-signing the stateless OAuth `txn` blob (`app/oauth_server.py` `_sign_txn`/
`_verify_txn`) — a shared key that must verify across instances. Surfaced the fork to the operator
(env-var vs. encrypted-config-secret via GetSecret vs. inject JWT_SECRET). **Operator chose: inject
`JWT_SECRET` into the agent and sign the `txn` with it.** FR-7 + AC-9 updated accordingly. The
vestigial `MCP_AGENT_SECRET` reads in `auth.py`/`client.py` are removed as well; the `AGENT-6`
invariant (agent `context-constitution.md:21`) is rewritten.

### Open forks deferred to /sdd-design

- Secret storage column shape (ciphertext in `value_data` TEXT (base64) vs a dedicated
  `value_encrypted BYTEA`).
- Exact `GetSecret` allow-list grants.
- `MCP_AGENT_SECRET` OAuth `txn`-signing replacement (verify `app/oauth_server.py`; candidate:
  re-base on `JWT_SECRET`).
- Per-user scope key sentinel for the unique constraint (NULL vs `''` vs a literal `*`).
- `trading_mode`-row collapse winner rule (FR-10).

## Session 2026-08-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: config, marketdata, agent, ui, + all WatchConfig client
  edges). Key reuse patterns: trading's AES-256-GCM helper (`account_repo.go:217`), the feature-102
  internal-caller allow-list (`authz.ts`), redaction-on-read already wired at the agent/ui edges,
  deprecate-don't-delete (`common.proto` Timeframe).
- Phase 1 Grilling: 1 round (quick). Proposer → adversary (**NEEDS WORK**, no Floor breach). Chosen
  approach: `value_encrypted BYTEA` + `[redacted]` sentinel double-guard, redaction at
  `buildConfigValue`, `GetSecret` + `SECRET_CALLER_ALLOWLIST`, env×user_id scope with a deterministic
  `trading_mode`-collapse migration. Rejected: base64-in-value_data; a fatal Alpaca guard;
  GetSecret-sourced OAuth key; per-user overlay cut from WatchConfig.
- **Adversary fixes folded in:** `is_secret` row-authoritative on write; `value_encrypted` never in
  broadcast SELECTs; migration 017 rewrites both audit triggers + alters `config_audit`; GetSecret
  distinguishes NULL-ciphertext (`found=false`) from decrypt-failure (`INTERNAL`); premigration
  snapshot table for a faithful down; MCP_AGENT_SECRET removal gates on operative symbols (docs may
  name it); JWT_SECRET fail-fast-if-unset + txn-only; security ACs RED-before-GREEN non-zero-assertion
  (074 trap); `ENVIRONMENT_STAGING` handled in both the string branch and numeric ENV_MAP (078 scar).
- **Operator gate (2026-08-20):** kept per-user resolution on **both** GetConfig and WatchConfig
  (declined the recommended GetConfig-only narrowing). Added AC-13/AC-14 to test the WatchConfig
  overlay + its redaction-safety; overlay composed from redacted values, secrets global-only.
- **Verified factual assumptions:** the 4 vendor env vars are read **only** by marketdata
  (`config.go:43-52`); Alpaca empty-credential behavior is **warn-and-start**, not fatal
  (`main.go:85-95`) — corrected FR-6/AC-7.
- Constitution rules touched: C-05/Rule-6 (overridden, sign-off), F-07, C-04, C-09, C-07/F-01,
  C-08/P-06, C-10, C-14, F-06. Floor breaches: none.
- Status: draft → design-approved.

### Open Threads
- WatchConfig per-user overlay redaction-safety + cache growth → config service step + test step.
- Migration 017 lossy down (mitigated by premigration table) → migration step.
- Post-deploy: operator sets real vendor creds via SetConfig (seed ciphertext NULL) → docs step.
- JWT_SECRET agent blast radius → accepted/recorded, no further action.
