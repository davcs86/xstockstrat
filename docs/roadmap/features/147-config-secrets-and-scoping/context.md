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

## Session 2026-08-20 — implementation (all 12 steps)

Implemented on `claude/config-secrets-environment-e0eue6` (harness branch, PR → main-dev).

- **Step 1 proto**: `ENVIRONMENT_STAGING`; deprecate `trading_mode` on all config messages + `ENVIRONMENT_DEV`; add `user_id` to Watch/Get/Set/ListKeys; new `GetSecret` RPC. Provisioned the codegen toolchain on the host (no Docker daemon) per `docs/runbooks/codegen-toolchain-host-setup.md`, validated an empty stub diff before editing, regenerated. `buf lint`+`buf breaking` pass.
- **Step 2 migration 017**: validated end-to-end against a real ephemeral PostgreSQL (000→017 apply, down reverses, re-up clean). Collapse precedence, per-user scope, audit triggers verified live.
- **Steps 3–4 config service**: `crypto.ts` (AES-256-GCM), `SECRET_CALLER_ALLOWLIST`, redaction in `buildConfigValue`, `GetSecret` (distinct found=false vs INTERNAL), row-authoritative encrypt-on-write, env×user_id scope + per-user overlay on GetConfig **and** WatchConfig. 80 tests, coverage 82%.
- **Steps 5–6 marketdata**: `Watcher.ResolveSecret` (GetSecret at startup); warn-and-start preserved.
- **Steps 7–9 agent + config-ui**: OAuth txn → `JWT_SECRET` (fail-closed); MCP_AGENT_SECRET deleted; tools drop trading_mode / add user_id; config-ui env production/staging + per-user ScopeControl; **fixed a real runtime break** — the config-ui audit route SELECTed the dropped `trading_mode` column. 47 config-ui e2e pass.
- **Step 10 client edges**: Node/Go/Python config watchers → STAGING, drop trading_mode.
- **Step 11 deploy**: `CONFIG_SECRETS_ENCRYPTION_KEY` added everywhere; `JWT_SECRET` into agent; 4 vendor keys + `MCP_AGENT_SECRET` scrubbed. Grep-verified.
- **Step 12 docs**: rewrote the stale `secret.*` ban across root CLAUDE.md, config-governance, reviewer-registry, add-data-source, constitution C-05, and the config/marketdata/agent docs.

### Consumer-surface decision (C-14)
Operator chose (2026-08-20 `AskUserQuestion`) to do the **full config-ui modernization in this PR**
(production/staging labels, remove the paper/live selector, add a global/per-user scope selector),
not defer it. Done in Step 9b with all 8 config-ui e2e specs updated and passing.

### Post-deploy operator action (required)
The 4 vendor secret rows are seeded with NULL ciphertext. After deploy, set the real Alpaca/FMP/
Finnhub credentials per environment via the config write path (an admin `SetConfig`), which encrypts
them. Until set, marketdata resolves them empty and takes its warn-and-start path.

### Teardown note
`/context-scrubber` (context-forge plugin) is not available in this session, so the doc-drift scan
was not run automatically; the governance docs were rewritten directly in Step 12 instead.

## Session 2026-08-21 — PR #994 review round (operator comments)

The operator left four review threads on PR #994; all four were addressed on the same branch.

1. **env tied to the deployment instance** (`tools.py`). Removed the caller-facing `environment`
   parameter from the three agent config tools (`get_config`/`list_config_keys`/`set_config`) — env
   is a deployment property, always resolved from `APPLICATION_ENV`; a caller can no longer select a
   different environment. Tests + `mcp-tools.md` + agent CLAUDE.md updated.

2. **unblock secret writes via MCP + UI** (`tools.py:1121`, "This also applies to the UI"). Removed
   the agent's client-side `is_secret` refusal (+ its ListKeys pre-check) — an admin now sets a
   secret through the MCP, relying on the backend admin gate + row-authoritative encryption.
   config-ui `NamespaceEditor` now offers Edit for secret rows (masked `[secret]` display, editor
   opens BLANK — never the redacted sentinel, password-masked input). New e2e `secret-editing.spec.ts`;
   the stale `secret.`-prefixed fixture renamed to `marketdata.alpaca.api_key`.

3. **per-user config authorization** (operator gate, `AskUserQuestion`). Operator chose **per-user
   self-service**, with the constraint *"admins only have access to themselves and globals, not other
   users."* So `SetConfig` is now scope-aware (`configServiceImpl.setConfig` + new
   `PER_USER_SCOPE_ERROR`): a **global** write needs the ADMIN bit (or an authorized internal caller);
   a **per-user** write is allowed only when the propagated `x-user-id` == the target `user_id` — an
   admin earns NO override for another user's per-user row. Secrets stay global-only. New authz tests
   in `setConfigAuthz.test.ts`; config CLAUDE.md invariant #5 + config-governance rewritten; config-ui
   shows a self-service note. This relies on the agent now forwarding `x-user-id` (item 4).

4. **all edge services forward all headers** (`context-constitution.md:19`, "the opposite of what I
   wanted"). Operator chose **full uniform forwarding + a generated trace-id**. The agent is now an
   edge that forwards the full trio (`x-user-id` + `x-access-scope` + `x-trace-id`) on EVERY outbound
   backend gRPC, sourced from the verified OAuth claims (feature-111 anti-spoofing preserved), minting
   a fresh `x-trace-id` at the edge when absent. Implemented with ONE `CallerPropagationMiddleware`
   (`app/tools.py`) that binds `client`'s per-request contextvar for each `tools/call` — verified the
   MCP SDK's `ServerMiddleware` runs in the handler's own task (`runner.py` `_make_context` →
   `_compose_server_middleware`), so the contextvar propagates to every `client.*` call with no
   per-tool plumbing. `client._metadata(*extra)` de-dups a legacy per-call header against the context
   and stays empty on the pre-token OAuth path / stdio. AGENT-3/4 rewritten (AGENT-4 was the exact
   line commented on). New `tests/test_header_propagation.py` (12 cases).

**thread 4** (`main.go:82`, "globals or per user?") — answered on the PR thread: the four vendor
credentials are **global** (resolved at startup with no `user_id`; secrets are global-only by design).
No code change.

Test status this round: agent 237 pass / ruff clean / 77% cov; config 83 pass; config-ui tsc clean +
19 config-ui e2e pass (incl. new secret-editing spec).

## Session 2026-08-21 (CI: feature status automation)

- Promotion PR #997 merged to main
- Feature promoted and committed: d908f33dc3283b79b61b233d57542cd47014c4ab
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-21
