# Feature: webhook-fanout-callback

**Development Branch**: `feature/webhook-fanout-callback`
**Created**: 2026-11-11
**Last Updated**: 2026-11-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-11 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-11 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + debate.md + design.md written |
| 2026-11-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 22 steps |
| 2026-11-11 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — decisions, rejected alternatives, objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — 22 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`trigger_backfill` accepts an optional `callback_url`; when the job reaches a terminal state, ingest hands
the event to a new durable `NotifyService.FanoutWebhook` RPC and notify delivers it at-least-once over
HTTPS to an allowlisted origin. xstockstrat is the first publisher for the external `webhooks-mcp` mailbox.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-11 from the `**Reviewers**` lines of all 22 steps and
docs/runbooks/reviewer-registry.md. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking changes, `buf lint` / `buf breaking` pass against dev trunk |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| Security | SSRF control: https-only + origin allowlist enforced at one point (notify) on accept and on every delivery; no identity fields or secrets in the outbound body |
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-config` owner | Config key naming, environment scoping, WatchConfig stream stability |
| `packages/proto` owner | Field number uniqueness, backward compatibility, naming conventions |

## Next Action

`/sdd-review webhook-fanout-callback impl-spec` — validate implementation spec, then `/sdd-execute webhook-fanout-callback`
