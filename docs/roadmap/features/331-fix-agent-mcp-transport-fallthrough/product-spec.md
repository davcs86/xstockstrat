# Product Spec: fix-agent-mcp-transport-fallthrough

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Agent silently starts stdio transport when MCP_TRANSPORT is unset or mistyped

- **Observed**: `resolve_transport()` defaults to `stdio`, and any unrecognized value (e.g. `htp`)
  also falls through to stdio with only a warning. The deployed service (port 9000, OAuth, Streamable
  HTTP) assumes `http`; nothing listens on 9000, the only liveness probe is a docker-compose TCP check,
  and `.do/app*.yaml` define no agent `health_check`, so the mis-start is silent. The fall-through is a
  deliberate AC (feature 079 AC-4); the gap is the lack of any loud failure.
- **Expected**: a deployed agent either fails fast on an unrecognized value or is guaranteed to run
  `http` (deploy specs already set `MCP_TRANSPORT=http`; a health check would catch drift).
- Report: [docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md](../../../reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md)

## Reproduction Steps

1. Start the agent container with `MCP_TRANSPORT=htp`.
2. Observe the warning "is not recognized; falling back to stdio" and no listener on :9000.
3. Note no DO health check exists to mark the component unhealthy.

## Root Cause Hypothesis

Default chosen for local stdio use; any value other than `http` routes to `_run_stdio()`. Current
sites:
- `services/xstockstrat-agent/app/main.py:51` (`resolve_transport`), `:53` (`"stdio"` default),
  `:63` (unrecognized → warning + stdio), `:286` (`_run_http() if … == "http" else _run_stdio()`)
- `docker-compose.yml:581` (TCP-only probe); `.do/app.yaml:379`, `.do/app.dev.yaml:381` set
  `MCP_TRANSPORT`; neither spec has an agent `health_check`

## Affected Services

- xstockstrat-agent

## Fix Scope

- Proto changes anticipated: **no** — transport selection is process startup only.
- DB migrations anticipated: **no** — no schema or data involved.
- Config key changes anticipated: **no** — `MCP_TRANSPORT` is a boot env var, not a `WatchConfig` key. The report's config-only mitigation (keep `MCP_TRANSPORT=http` in every deploy spec — already true) is not the fix: an unset or mistyped value must fail closed in code.

## Open Questions

1. ~~Unset posture~~ — **Decided 2026-11-10 (operator sign-off):** unset defaults to Streamable HTTP on
   :9000 (the deployed mode); only an explicit `stdio` starts stdio; any other value exits non-zero naming
   `MCP_TRANSPORT`. This reverses feature 079 AC-4's fall-through — `/sdd-design` must mark that promoted
   scenario superseded (C-16).
2. ~~DO `health_check`~~ — **Decided 2026-11-10 (operator):** out of scope; follow-up.

## Consumer Surface(s)

None — internal/platform-only: MCP clients see either a started agent or a failed deploy; no tool or
response shape changes.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- An agent `health_check` in `.do/app.yaml` / `.do/app.dev.yaml` (operator decision 2026-11-10; follow-up)

- The deprecated `sse` alias behaviour (still selects `http` with a warning)
- Refactoring unrelated to the bug
