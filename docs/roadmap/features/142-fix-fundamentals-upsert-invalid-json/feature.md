# Feature: fix-fundamentals-upsert-invalid-json

**Type**: bug
**Development Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C) from `docs/reports/2026-08-16-marketdata-fundamentals-upsert-invalid-json-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-16
**Last Updated**: 2026-08-29
**Archived**: 2026-08-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-08-16 | `draft` (unchanged) | /sdd-triage (boot correction) | Corrected **Development Branch** `feature/fix-fundamentals-upsert-invalid-json` → `claude/commit-135-opportunities-strategies-0xjnxk` — session's harness assignment requires all work stay on the `claude/*` branch (same pattern as feature 135's own boot correction) |
| 2026-08-16 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Chosen: `::jsonb` cast fix, gated on a mandatory manual repro (reproduce-then-fix) before merge. |
| 2026-08-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps. |
| 2026-08-16 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 2 (::jsonb cast) and 4 (pgxmock regression test) done, red-before-green confirmed. Steps 1 and 3 (the mandatory live-DB repro) are **blocked** — no Docker daemon in this execute sandbox, and sdd-execute's HARD CONSTRAINTS forbid starting a DB container to verify a step. User chose to apply the code-only steps now and leave the repro as a required follow-up before this fix is considered fully verified — see implementation-spec.md Deviation Log. |
| 2026-08-16 | `in-progress` (unchanged) | /sdd-execute | **PR #967 merged and deployed to staging — the `::jsonb`-cast-only fix did NOT resolve the bug.** Post-deploy staging logs (`xstockstrat-marketdata`) showed the identical `SQLSTATE 22P02` error for symbol UPRO after the fix commit (`57d3424`) was live, confirming Steps 1/3's blocked mandatory-repro gate would have caught this before merge. Root cause corrected: `extraJSON` was bound as `[]byte`, which pgx's `QueryExecModeExec` encodes as `bytea` regardless of the `::jsonb` SQL-text cast — `bytea::jsonb` casts through bytea's hex-escaped text representation, never valid JSON (confirmed via pgx v5's own doc comment on `QueryExecModeSimpleProtocol`, which `QueryExecModeExec` shares behavior with: "string must be used instead for text type values including json and jsonb"). Fix corrected to bind `string(extraJSON)` instead of the raw `[]byte`. `pgxmock` regression test strengthened with a custom `isStringArg` matcher on the `extra_metrics` argument specifically, so it now catches this exact regression (confirmed red against `[]byte`, green against `string`) — the prior test only pinned the SQL text and would have passed either way. Still blocked on Steps 1/3's live-DB repro; the next staging deploy is the closest available real-world confirmation. |
| 2026-08-29 | `in-progress` → `launched` | /sdd-execute | **Mandatory live-DB repro (Steps 1 & 3) finally ran and passed**
| 2026-08-31 | archived | /sdd-archiver | Synthesis distilled to context.md + Ledger (2 insights, 2 fails); scenarios promoted to services/xstockstrat-marketdata/acceptance/; product-spec.md, recon.md, design.md, implementation-spec.md pruned (recoverable from git) | — the verification gate blocked in every prior session for lack of Docker. Insight that unblocked it: the bug needs only pgx in `QueryExecModeExec` (`DB_PGBOUNCER=true`) against *any* real Postgres, not Docker or a real PgBouncer — this environment had local PostgreSQL 16 binaries + Go 1.27. Repro reproduced `SQLSTATE 22P02` against both the original (`$14`+`[]byte`) and the #967 cast-only (`$14::jsonb`+`[]byte`) code (RED), and confirmed the shipped #969 code (`$14::jsonb`+`string`, via the real `UpsertFundamentals`) succeeds and persists valid `jsonb` (GREEN). Full transcript in context.md (2026-08-29 entry). Fix commit `6af00b9d` (PR #969) is already in `origin/main` (production), so the feature is now both shipped and verified — Steps 1–4 all `done`. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (::jsonb cast + mandatory repro gate)
- [Implementation Spec](implementation-spec.md) — 4 steps: manual repro (RED) → `::jsonb` fix → manual repro (GREEN) → `pgxmock` regression test
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`MarketDataRepo.UpsertFundamentals` failed for UPRO (and, in fact, every symbol) with Postgres
`invalid input syntax for type json (SQLSTATE 22P02)`, so its fundamentals never persisted to cache
and were re-fetched from the provider on every request. **Root cause (resolved):** the `extra_metrics`
value was bound as `[]byte`, which pgx's `QueryExecModeExec` (active under the service's
`DB_PGBOUNCER=true` pool) wire-encodes as `bytea`; `bytea::jsonb` casts through bytea's hex-escaped
text representation, never valid JSON — so a `::jsonb` SQL cast alone (PR #967) did not help. Fix
(PR #969): bind `string(extra_metrics-JSON)` so pgx sends the `text` OID and the `$14::jsonb` cast is
a genuine text→jsonb parse. Symbol-agnostic; unrelated to features 131/132/133/134/022/138.

## Reviewers

| Role | Focus |
|---|---|
| Service owner (`xstockstrat-marketdata`) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |

## Next Action

**None — feature complete (`launched`).** The corrected fix (PR #969, `string(extraJSON)` +
`$14::jsonb`) is in production (`origin/main`, commit `6af00b9d`) and was verified on 2026-08-29 by
the mandatory live-DB repro (Steps 1 & 3, RED/GREEN transcript in context.md). All four steps are
`done`.
