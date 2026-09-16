# Context: agent-postgres-mcp  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Integrated the `crystaldba/postgres-mcp` server as a co-process inside the `xstockstrat-agent` container (supervisord as PID 1), re-exposed as 9 admin-gated `db_*` MCP tools on the existing port-9000 OAuth-protected endpoint — no new port, no new service, no proto/config-key change. What began as read-only DB introspection was mid-flight redefined into a DML-capable admin data-fix surface (unrestricted mode, `xstockstrat_agent` role with SELECT/INSERT/UPDATE/DELETE), guarded by an agent-layer fail-closed confirmation gate (FR-11) on destructive SQL.

**Why (irrecoverable rationale)**: The scope flip (read-only → DML) was driven by the user restating the *ultimate goal* — agents must "debug and make targeted data fixes directly on the DB," not just introspect. That single clarification invalidated three already-locked decisions (`--restricted`→`--unrestricted`, `xstockstrat_readonly`→`xstockstrat_agent`, and spawned FR-11) and reverted status draft-ward for re-review; the shipped code shows only the DML end-state. Safety was deliberately relocated *out* of postgres-mcp's own `--restricted` mode into two independent layers you own — the Postgres role's privilege grants (no DDL/TRUNCATE) plus the agent-side FR-11 confirmation gate — which is why the process runs "unrestricted" against prod despite the risk reading.

**Rejected alternatives**:
- Read-only mode + `xstockstrat_readonly` SELECT-only role — lost: could not satisfy the restated targeted-data-fix goal.
- Long-lived SSE session (connect once, reuse) — lost: a supervisord-triggered postgres-mcp restart would strand the agent on a stale connection with no recovery short of restarting the agent; per-call SSE is restart-transparent.
- Separate dedicated postgres-mcp service/container — lost: adds a registry entry + network hop + cross-container MCP client; product spec mandated the co-process (co-process decision now self-evident from `supervisord.conf`'s two `[program:*]` blocks).
- systemd / s6 / tini as PID 1 — lost: systemd unavailable in the slim base image; supervisor is pure-Python pip-installable, needing no `apt-get` layer.
- Fail-open Command-node branch (regex-only, no safe-default) — lost: violates the standing fail-closed `validate_*` ledger rule (fails.md 2026-08-06); VACUUM/REINDEX false-positive confirm-prompts accepted as the price.
- Regex-only FR-11 and sqlglot-tokenizer fallback — lost: sqlglot AST kept primary, regex only on ParseError.

**Scars & gotchas**:
- **RawConfigParser required, not ConfigParser**: supervisord's `%(ENV_*)s` syntax collides with Python `configparser`'s interpolation engine (`InterpolationMissingOptionError`); the conf test parses with `RawConfigParser`. Reverting it re-triggers the error. (Ledgered.)
- **sqlglot `.key` values are version-sensitive** — dep pinned `>=25.0.0,<26`; verified v25.34.1 (UPDATE→`update`, DELETE→`delete`, DROP→`drop`, TRUNCATE TABLE→`truncatetable`). A major bump must re-run this verification; `test_truncate_is_destructive` (passing via the frozenset match OR the Command-node safe-default) is the deliberate cross-version catch.
- **Admin gate must be enforced locally in each `db_*` handler** — unlike `trigger_backfill`/`manage_signal_source`, which delegate the admin check to a gRPC backend that re-enforces it, `db_*` tools have no backend; the `& 0x04` check in the handler is the only gate. Removing it silently opens prod DB writes to any authenticated caller. (Ledgered.)

**Permanent deviations**: design specified `configparser.ConfigParser` for the conf-validation test → shipped `RawConfigParser` → because of the interpolation-syntax collision. No other shipped-vs-design contradictions; the DML/unrestricted end-state matches the *revised* design.

**Cross-feature signal**: The credential env var `POSTGRES_MCP_DATABASE_URI` deliberately bypasses feature-147's encrypted-config-row / `GetSecret` pattern because postgres-mcp is a third-party binary that reads its URI from env at process startup, not via an RPC — the same third-party-integration exception class feature 147 itself carved. Three deploy files (`docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`) collide with feature 084-droplet-compose-deploy; whichever merged second owed a manual integration merge.

**Deferred follow-ons**: `xstockstrat_agent` role creation is a one-time manual DBA step (CREATE ROLE + GRANTs in `database.md`), NOT a golang-migrate migration — it will not auto-apply on new environments and must be run by hand per cluster.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-09-16 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: AGENT-* candidate — the agent container runs supervisord as PID 1 managing two program blocks (`app-main` uvicorn + `postgres-mcp` bound to `127.0.0.1`), a departure from the one-process-per-container norm; AGENT-* candidate — the MCP SDK imports `httpx2` (not `httpx`), so catching `httpx.ConnectError` in MCP-client code is dead code.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 594ea7e.
