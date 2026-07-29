# xstockstrat-agent — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The internal admin-scope self-grant (`x-access-scope=7`) is a cross-cutting ⚠ security
question tracked in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md "Config Keys Consumed" lists only `agent.oauth.*` | Code also reads `signal.alert_threshold` and `source.<slug>.credentials` | `app/client.py:678,689`, `app/tools.py:32,193` | Document the additional consumed keys |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| `client.get_config_value` hardcodes `namespace="agent"` but is called to read `signal.alert_threshold` and `source.<slug>.credentials` — keys not in the `agent.*` namespace | Those reads may always return `None` and silently fall back to defaults (alert threshold 0.6 / no credentials) | `app/client.py:689`, `app/tools.py:32,193` |
| `MCP_TRANSPORT` default is `"stdio"` while the whole service (port 9000, OAuth, Streamable HTTP) assumes the HTTP transport; an **unrecognized** value also falls through to stdio | Running without the env var set — or with a typo like `htp` — starts the wrong transport. Still open after feature 079, but **narrowed**: `resolve_transport()` now logs a warning on both the deprecated `sse` alias and any unrecognized value. The fallthrough itself is deliberate (AC-4). Aggravating factor: the agent has no HTTP healthcheck (only a TCP probe on 9000 in compose, and no `health_check` block in `.do/app*.yaml`), so the mis-start is otherwise silent | `app/main.py` `resolve_transport()` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/config/__init__.py` | empty, unused package; config access goes through `client.get_config_value` | `app/config/__init__.py` |
| `app/prompts/signal_extraction.md` (+ `__init__.py`) | zero references (no `@server.prompt`, no file read) | `app/prompts/` (grep zero) |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
