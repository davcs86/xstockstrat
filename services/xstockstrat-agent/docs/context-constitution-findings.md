# xstockstrat-agent — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not
governance. The internal admin-scope self-grant (`x-access-scope=7`) is a cross-cutting ⚠ security
question tracked in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
_None currently open_ — ~~CLAUDE.md "Config Keys Consumed" lists only `agent.oauth.*`~~ **RESOLVED** (confirmed 2026-08-09 refresh): CLAUDE.md now lists `agent.signal.alert_threshold` alongside `agent.oauth.*`; the `source.<slug>.credentials` plaintext read was removed entirely (`_CREDENTIALS_UNSUPPORTED`, `app/tools.py:49-54`) rather than documented, so there is no longer a second undocumented key to reconcile.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~`client.get_config_value` hardcodes `namespace="agent"` … reads may always return `None` and silently fall back to defaults~~ **RESOLVED (feature 093):** `get_config_value` now takes required `namespace`/`environment`, projects the active oneof stringified (the `float`-typed `signal.alert_threshold` returned `None` under the old `string_val`-only read regardless of scope), and surfaces transport errors instead of swallowing. `signal.alert_threshold`/OAuth reads are env-scoped best-effort; the `source.<slug>.credentials` plaintext read was **removed** (extract tools raise when credentials are required — a plaintext config secret would violate C-05/invariant #6). | Resolved | `app/client.py` `get_config_value`; `app/tools.py` extract tools + alert read; `app/oauth_server.py` |
| `MCP_TRANSPORT` default is `"stdio"` while the whole service (port 9000, OAuth, Streamable HTTP) assumes the HTTP transport; an **unrecognized** value also falls through to stdio | Running without the env var set — or with a typo like `htp` — starts the wrong transport. Still open after feature 079, but **narrowed**: `resolve_transport()` now logs a warning on both the deprecated `sse` alias and any unrecognized value. The fallthrough itself is deliberate (AC-4). Aggravating factor: the agent has no HTTP healthcheck (only a TCP probe on 9000 in compose, and no `health_check` block in `.do/app*.yaml`), so the mis-start is otherwise silent | `app/main.py` `resolve_transport()` |
| **`ensure_signal_watchlist` / `add_watchlist_symbol` emit `x-user-id` TWICE** (2026-09-02) — both use the non-dedup splat `[*_metadata(), ("x-user-id", user_id)]`, but under a bound caller context `_metadata()` already emits `x-user-id`, so the header is sent twice (violates the AGENT-4 dedup contract). Low impact today (the value equals the caller's own id, feature-127 auto-add path) but wrong if the two ever diverge. | Duplicate metadata header on two watchlist RPCs; a latent divergence bug. | `app/client.py:298`, `:316` — fix: use the de-duplicating `_metadata(("x-user-id", user_id))` form |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/config/__init__.py` | empty, unused package; config access goes through `client.get_config_value` | `app/config/__init__.py` |
| `app/prompts/signal_extraction.md` (+ `__init__.py`) | zero references (no `@server.prompt`, no file read) | `app/prompts/` (grep zero) |

## Open questions (unresolved *why* — needs a maintainer)

- `snapshot_offline_positions` sets **both** a request-body `user_id` (`app/client.py:1899`) **and** the `x-user-id` header (`:1910`), while the CLAUDE.md caller-identity contract does not list snapshot among the body-`user_id` builders. Is the body `user_id` on `SnapshotOfflinePositionsRequest` a deliberate target selector, or leftover caller-identity duplication to drop (like the feature-164/133 builders)? — status: **open**
- `manage_signal_source` bearer-token orchestration writes the encrypted secret **before** registering the source, with **no compensating cleanup** on a failed register (`app/tools.py:976-991`, "leaves only a harmless redacted orphan secret"). Confirm the orphan-secret-on-partial-failure is an accepted trade-off, not a reconciliation gap. — status: **open**

## MCP tool ↔ backend alignment audit (2026-08-01) — 13/13 resolved

Full triage: [`docs/reports/2026-08-01-mcp-tools-alignment-triage.md`](../../../docs/reports/2026-08-01-mcp-tools-alignment-triage.md).
All 13 findings (F-1 through F-11, plus two docs-only rows) are resolved — most landed with features
086–093 (2026-08-02), reconfirmed clean on 2026-08-09. Generalizable lessons (add descriptor-parity/
return-shape contract tests over the `app/client.py` request builders + projections) are distilled into
`docs/roadmap/ledger/insights.md` and `fails.md` (2026-08-02 entries).

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
