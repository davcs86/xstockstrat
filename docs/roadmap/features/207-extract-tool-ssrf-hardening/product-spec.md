# Product Spec: extract-tool-ssrf-hardening

**Created**: 2026-09-25

---

## Problem Statement

The `xstockstrat-agent` MCP tools `extract_website_content` and `extract_email_content` fetch
caller-supplied URLs server-side and follow redirects with **no egress allowlist or address
validation** (`docs/reports/2026-09-16-trading-system-security-audit.md`, M-list; recommended in
DT-2 §150). Because the agent is a prompt-injectable LLM surface that also ingests untrusted external
content, an injected instruction can direct these tools at internal targets — cloud-provider metadata
(`169.254.169.254`), loopback admin surfaces, the private-network gRPC services (`50051–50060`), and
the config service's secret-bearing paths — turning a content-extraction convenience into a
server-side request forgery (SSRF) pivot and internal-data exfiltration primitive.

## User Story

As a platform operator, I want the agent's content-extraction tools to refuse any fetch whose target
resolves to a non-public network address (and to resist DNS-rebinding, hostile redirects, and
oversized responses), so that a prompt-injected or compromised agent session cannot use them to reach
internal infrastructure or exfiltrate private-network data.

## Functional Requirements

FR-1. `extract_website_content` and `extract_email_content` MUST reject, **fail-closed and before any
socket is opened**, every request whose resolved target address falls in a non-public range: RFC1918
private (`10/8`, `172.16/12`, `192.168/16`), loopback (`127/8`, `::1`), link-local (`169.254/16`,
`fe80::/10`) including the cloud-metadata address `169.254.169.254`, unique-local (`fc00::/7`), and
the unspecified/reserved ranges (`0.0.0.0/8`, `::`).

FR-2. The fetch path MUST be DNS-rebinding-safe: resolve the hostname, validate **every** resolved A/
AAAA address against FR-1, and connect to a **pinned validated address** rather than re-resolving, so
a time-of-check/time-of-use rebind cannot swap a public name onto an internal address between
validation and connect.

FR-3. Only the `http` and `https` URL schemes are permitted; any other scheme (`file:`, `gopher:`,
`ftp:`, `data:`, `dict:`, …) is rejected fail-closed.

FR-4. Redirects are bounded (a fixed maximum hop count) and **each hop's target is re-validated**
against FR-1–FR-3; a redirect to a denied address terminates the fetch with an error. Response size,
connect timeout, and read timeout are bounded so a hostile endpoint cannot exhaust the agent process.

FR-5. The egress policy (the deny ranges of FR-1, the max-redirect / max-size / timeout limits, and
an optional operator domain allowlist) MUST be sourced from config/env rather than hardcoded literals
(Constitution **C-05** / config-governance) — the exact key(s) and whether a domain allowlist ships
in this feature are a design decision.

FR-6. A blocked fetch returns a generic, non-enumerating tool error to the caller (no internal
hostname/IP or resolved-address detail leaked back to the model) and the block is recorded on the
agent's telemetry/audit path.

## Out of Scope

- Any change to the agent's **other** MCP tools, its tool count, or its auth model.
- The broader agent-egress network policy at the container/infra layer (e.g. a NetworkPolicy or
  egress firewall on the agent pod) — a complementary defense-in-depth control, tracked separately if
  pursued; this feature hardens the in-tool fetch path.
- The DB-tooling removal (feature 211 `remove-agent-postgres-mcp`, which superseded demoted feature
  193) and the orphaned-role teardown (`208-psql-db-role-grant-hardening`) — sibling security
  follow-ons, not this feature.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — owns `extract_website_content` / `extract_email_content` and their HTTP
  fetch implementation (`app/tools.py` and the fetch helper it calls); this is the only service that
  changes.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `extract_website_content`, `extract_email_content`.
  No new tool, no new argument, no tool-count change — the observable change is behavioral: a fetch
  to a denied target now returns an error instead of internal content. Legitimate public-URL
  extraction is unchanged.
- [ ] **UI** — none.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- Likely `agent.extract.*` egress-policy key(s) (deny ranges / limits / optional domain allowlist) per
  FR-5 — **exact names and set pinned at /sdd-design/`/sdd-spec`**; recorded here as an open question,
  not yet registered.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/extract-tool-ssrf-hardening` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-agent`) + Security review (security-sensitive change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Config surface (FR-5): which `agent.extract.*` key(s), and does an operator **domain allowlist**
  ship now or is deny-by-range sufficient for v1?
- [ ] Does `extract_email_content` fetch remote resources (inlined image/link URLs, remote content
  references) on a path distinct from `extract_website_content`, and does that path share the same
  hardened fetch helper? (Design must confirm both tools route through one validated egress point.)
- [ ] Known trap (ledger): egress policy values must be config/env-driven, never hardcoded literals
  (C-05) — surface any hardcoded CIDR/limit in review.
