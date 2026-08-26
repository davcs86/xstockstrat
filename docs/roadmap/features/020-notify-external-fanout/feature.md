# Feature: notify-external-fanout

**Development Branch**: `feature/notify-external-fanout`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26
**Committed to main**: d908f33dc3283b79b61b233d57542cd47014c4ab
**Launched date**: 2026-08-21
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved after fixing 3 blockers. **Scope reduction accepted by feature owner** (sign-off in context.md): the two vendor credentials (SendGrid key, Slack webhook URL) move from config keys to `type: SECRET` env vars per config governance (feature 076), so credential rotation now requires a redeploy rather than a live config push. Also added the Consumer Surface section and resolved both open questions (credential storage → env var; dedup store → in-memory V1). |
| 2026-08-19 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Round 1 grounded the central fork — NO producer writes `context.confidence`, so the spec's confidence gate was inert; user chose a HYBRID gate (severity-primary + conviction-floor-when-present). Round 2 fixed dedup (content hash), fire-and-forget ordering, and NaN handling; user set `min_severity` default = WARNING (2). |
| 2026-08-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps. Config migration 017 (5 keys) + fanout module + emit-wiring (queueMicrotask post-callback) + full 8-file credential pipeline + docs. Deploy wiring expanded from design.md's 3 files to the full add-data-source credential checklist (C-10; config-governance.md:60 cites feature 129's incomplete 3-of-8 wiring as a defect). |
| 2026-08-20 | `implementation-ready` → `code-completed` | /sdd-execute | All 7 steps done — config migration 017, FanoutDispatcher (Slack + SendGrid, gate/dedup/timeout), emitAlert queueMicrotask wiring, 37 notify tests pass (fanout 96% cov), full 8-file SECRET pipeline, docs. Executed on harness branch `claude/execute-020-042-127-pfa5cw`. context-forge plugin unavailable → /context-scrubber not run (noted). |

| 2026-08-21 | `code-completed` → `launched` | CI workflow | Promoted via PR #997; committed d908f33dc3283b79b61b233d57542cd47014c4ab |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(1); promoted 9 scenarios → notify suite; pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (hybrid severity+conviction gate, content-hash dedup)
- [Implementation Spec](implementation-spec.md) — 7 numbered steps with grounded codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds HTTP fanout to the notify service so that platform alerts are delivered to Slack and/or email (SendGrid) in addition to the existing Connect-RPC stream, ensuring traders receive time-sensitive signal and fill notifications even when not viewing the UI.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication (Steps 2–6) |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, value_type↔getter match (Step 1) |
| DBA | Migration NNN numbering (no gaps), up+down pair present, run-order compliance (Step 1) |
| Security | Vendor credential is a `type: SECRET` deploy env var (never a `secret.*` config key); full add-data-source credential checklist (Step 6) |

## Next Action

`/sdd-review notify-external-fanout impl-spec` — validate the implementation spec, then `/sdd-execute notify-external-fanout`
