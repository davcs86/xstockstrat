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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + httpx/httpcore pinning mechanism (Phase 0)
- [Design](design.md) — chosen 3-layer approach, rejected alternatives, Constitution/C-16 rules (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec extract-tool-ssrf-hardening`_
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

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | SSRF egress-policy correctness: deny-by-default of RFC1918/loopback/link-local/metadata/ULA, DNS-rebinding pin (resolve → validate → connect to pinned IP), redirect re-validation on every hop, no internal host/IP enumeration leaked back to the model |
| `xstockstrat-agent` | Change is confined to the `extract_*` tools' fetch path; no change to the advertised tool count or other tools; `docs/runbooks/mcp-tools.md` parity |

## Next Action

`/sdd-spec extract-tool-ssrf-hardening` — generate the implementation spec from the approved design.
