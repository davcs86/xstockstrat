# Context: fmp-key-to-secret-env  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: A config key (`secret.marketdata.fmp.api_key`, seeded by feature 059's migration `007`) was documented as a `secret://` reference "resolved at deploy, never plaintext" — but no `secret://` resolver was ever built, and `marketdata` passed the value straight into `fmp.NewClient` as the literal API key. Making FMP work therefore required a real credential in plaintext in `config.config_values`, a table with no encryption whose rows stream to every `WatchConfig` subscriber. This feature deleted that row (migration `009`) and moved FMP onto the same DO App Platform `type: SECRET` env var mechanism every other credential already used. FMP was the platform's sole credential-in-config and its only `is_secret = TRUE` row.

**Why (irrecoverable rationale)**: The user's decision was explicitly conditional — permit plaintext-in-config only if no existing secret mechanism existed, and triple-check that first. The check found the mechanism decisively (`type: SECRET` env vars already carrying ALPACA/JWT/MCP/broker keys), so the ruling was "use the same existing mechanism used for ibkr and alpaca keys" rather than build a `secret://` store. This is the rationale behind the one-line reversal note now in root CLAUDE.md; the root cause — that the promised resolver was pure aspiration in a migration comment — survives only here.

**Rejected alternatives**:
- Permit plaintext secret in `config.config_values` (feature 073's original fork) — lost because it exposes the credential to every `WatchConfig` subscriber via `GetConfig`/`ListKeys`.
- Build a real `secret://` resolver / secret store — lost as out-of-scope; the existing `type: SECRET` env-var path already covered every other credential.

**Scars & gotchas**: Any environment that already had a real key written into `secret.marketdata.fmp.api_key` must treat it as compromised and rotate at FMP — migration `009` deletes it, but it was plaintext in a broadcast table. `FMP_API_KEY` in `docker-compose.yml` uses the optional `${FMP_API_KEY:-}` form, deliberately not the `:?` required-guard the Alpaca keys use, because the FMP pipeline is off by default; an unset key fails as an empty-key client build, not at container start. The `.down.sql` restores only the placeholder string, never a real credential.

**Permanent deviations**: none — no `design.md` existed (direct SDD-path bug fix); the shipped behavior is the fix itself.

**Cross-feature signal**: Closed a loop across features — 059 introduced the resolver-less config-secret pattern, 075 made `is_secret` trustworthy, 073 surfaced the plaintext question as a review blocker, 076 removed the last `is_secret` row — making 073's `set_config` `is_secret` rejection largely moot while keeping the guard as a forward tripwire. Confirms the two-pattern credential taxonomy: (a) platform-wide vendor key → plain `type: SECRET` env var (Alpaca, FMP); (b) per-user broker creds → AES-256-GCM DB blob with master key from env (IBKR). FMP is case (a).

**Deferred follow-ons**: AC-6 operator step still open — `FMP_API_KEY` must be set in the DO dev/prod app env and local `.env` before flipping `marketdata.fmp.enabled` to true. Until then the FMP client builds with an empty key.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-19 `fmp-key-to-secret-env` entries.

**Runtime-invariant recommendations (→ /context-constitution)**: none — the credential-handling convention (`type: SECRET` env vars, no config-stored secrets) is already captured in root CLAUDE.md § Config Governance Rules and `docs/runbooks/add-data-source.md`.

**Pruned artifacts**: product-spec.md — last present at 1d97c6c.
