# Feature: extract-tool-ssrf-hardening

**Development Branch**: `feature/extract-tool-ssrf-hardening`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit agent SSRF — M-list backlog, called out in DT-2 §150; prompt-injection egress ingress) |
| 2026-09-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved. C-15 blocker fixed before advancing: FR-5 had no covering scenario → added `@AC-8 @FR-5` (config-sourced egress policy). OQ2 resolved (both extract tools share `_fetch_url` at tools.py:2226). OQ1 (config keys + allowlist-in-v1?) and FR-6 audit mechanism flagged as /sdd-design forks. Overlap: WARN-only (soft tools.py rebase vs 214, now moot — 214 merged). |
| 2026-09-28 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. 3-layer SSRF hardening (not-is_global validator → subclassed httpx transport w/ pinned httpcore backend → manual per-hop redirect loop w/ cross-origin credential-strip + streamed byte-cap). Adversary caught CGNAT fail-open, total-bypass silent-revert, unenforced per-hop scheme, credential-leak on hand-rolled redirects, blocking getaddrinfo — all folded. Operator deferred the domain allowlist (deny-by-range core). No Floor breach. |
| 2026-09-28 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |
| 2026-09-28 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1-2 landed (egress validators + tests) |
| 2026-09-28 | `in-progress` → `code-completed` | /sdd-execute | All 7 steps done — 3-layer SSRF hardening (deny-by-range `not is_global` validator + IPv4-mapped unwrap; DNS-rebind-safe pinning httpx transport; hardened `_fetch_url` manual redirect loop with per-hop scheme + literal-IP target re-validation, cross-origin credential strip, streamed byte-cap, config-sourced `agent.extract.*` limits, FR-6 non-enumerating error). 474 tests pass, egress.py 94%. Deviations DEV-1..DEV-4 logged. Teardown done manually (context-forge plugin unavailable): reconciled service CLAUDE.md, config-governance keys log, mcp-tools.md error tables. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + httpx/httpcore pinning mechanism (Phase 0)
- [Design](design.md) — chosen 3-layer approach, rejected alternatives, Constitution/C-16 rules (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Harden the `xstockstrat-agent` MCP `extract_website_content` / `extract_email_content` tools against
server-side request forgery: they currently fetch caller-supplied URLs and follow redirects with no
egress policy, so a prompt-injected agent session can reach cloud metadata, loopback, and internal
gRPC/admin surfaces on the private network. Add fail-closed egress validation (deny non-public
address ranges, pin the validated address against DNS-rebinding, scheme allowlist, bounded
redirects/size/timeouts) so the untrusted-content ingress cannot pivot to internal targets. Closes
the agent SSRF finding (`docs/reports/2026-09-16-trading-system-security-audit.md`, M-list backlog;
recommended in DT-2 §150) — the prompt-injection ingress left out of the agent DB-tooling remediation
(feature 214 `remove-agent-postgres-mcp`, which superseded demoted feature 212 `sysadmin-db-write-role`).

## Reviewers

_(Snapshot finalized at /sdd-spec time from the distinct per-step reviewers — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | SSRF egress-policy correctness: deny-by-default of RFC1918/loopback/link-local/metadata/ULA/unspecified, DNS-rebinding pin (resolve → validate every A/AAAA → connect the pinned IP), reject-if-any mixed resolution, construction-time fail-closed identity assertion, redirect re-validation on every hop, cross-origin credential strip, bounded redirects/size/timeouts, no internal host/IP/port enumeration leaked back to the model |
| `xstockstrat-agent` | Change is confined to the `extract_*` tools' fetch path; no change to the advertised tool count (43) or other tools; MCP tool contract (name/params/return) unchanged; `docs/runbooks/mcp-tools.md` parity; config key naming + declared defaults (C-05) |

## Next Action

`/sdd-review extract-tool-ssrf-hardening impl-spec` — validate the implementation spec, then `/sdd-execute extract-tool-ssrf-hardening`.
