# Feature: extract-tool-ssrf-hardening

**Development Branch**: `feature/extract-tool-ssrf-hardening`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit agent SSRF — M-list backlog, called out in DT-2 §150; prompt-injection egress ingress) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
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
(feature 211 `remove-agent-postgres-mcp`, which superseded demoted feature 193).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | SSRF egress-policy correctness: deny-by-default of RFC1918/loopback/link-local/metadata/ULA, DNS-rebinding pin (resolve → validate → connect to pinned IP), redirect re-validation on every hop, no internal host/IP enumeration leaked back to the model |
| `xstockstrat-agent` | Change is confined to the `extract_*` tools' fetch path; no change to the advertised tool count or other tools; `docs/runbooks/mcp-tools.md` parity |

## Next Action

`/sdd-review extract-tool-ssrf-hardening product-spec` — AI review of product spec before running /sdd-spec
