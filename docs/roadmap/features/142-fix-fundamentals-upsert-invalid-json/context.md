# Context: fix-fundamentals-upsert-invalid-json  (archived 2026-09-01)
**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-01 — /sdd-archiver

**What**: Fixed `MarketDataRepo.UpsertFundamentals` crashing with `SQLSTATE 22P02` (invalid JSON)
for every symbol. Root cause: `extraJSON` was bound as `[]byte`; under pgx v5 `QueryExecModeExec`
(active when `DB_PGBOUNCER=true`) `[]byte` is wire-encoded as `bytea` OID regardless of a `::jsonb`
SQL cast — `bytea::jsonb` goes through hex-escaped text representation which is never valid JSON. The
cast-only fix (PR #967) did not help; the real fix (PR #969) was to bind `string(extraJSON)` so pgx
sends the `text` OID and `$14::jsonb` becomes a genuine text→jsonb parse.

**Why (irrecoverable rationale)**:
- A `::jsonb` SQL cast does NOT override the Go wire OID for `[]byte` under `QueryExecModeExec`.
  This is a pgx v5 behavior, documented in pgx's own `QueryExecModeSimpleProtocol` comment ("string
  must be used instead for text type values including json and jsonb"), shared with Exec mode.
- The cast-only fix was deployed to staging (PR #967) and confirmed broken there, establishing this
  as a driver-level constraint, not a DB schema issue.
- The mandatory live-DB repro gate (Steps 1 and 3) was blocked in every execute session for lack of
  Docker; unblocked in the 2026-08-29 session when it was recognized that `DB_PGBOUNCER=true` + any
  real Postgres binary satisfies the repro — no actual PgBouncer infrastructure needed.
- The pgxmock regression test was strengthened with a custom `isStringArg` matcher on the
  `extra_metrics` argument ($14) specifically; a SQL-text-only mock would pass on either binding.

**Rejected alternatives**:
- `::jsonb` cast on `[]byte` (PR #967) — insufficient; `bytea::jsonb` is never valid JSON.
- Changing `QueryExecModeExec` to `QueryExecModeSimpleProtocol` — would have required pool
  reconfiguration and broken PgBouncer compatibility.

**Scars & gotchas**:
- `[]byte` → `bytea` OID under `QueryExecModeExec` applies to EVERY pgx param of type `[]byte`
  against a jsonb column. Any future UpsertX that binds JSON as `[]byte` will hit the same bug.
- The repro does NOT need Docker or a real PgBouncer: `DB_PGBOUNCER=true` env var activates
  `QueryExecModeExec` in the service; any real Postgres binary suffices.
- The `isStringArg` matcher pattern (confirm Go type, not just value, in pgxmock) is the correct
  regression test approach for jsonb-column parameters.

**Permanent deviations**:
- Steps 1 and 3 (mandatory live-DB repro) were blocked across multiple sessions; finally verified
  2026-08-29 after both PRs had already shipped. The fix commit `6af00b9d` (PR #969) is in
  `origin/main` (production) and was verified RED (original + cast-only) then GREEN (string binding).

**Cross-feature signal**:
- PLAT-JSONB-1 candidate: any pgx `[]byte` param bound against a `jsonb` column under
  `QueryExecModeExec` (`DB_PGBOUNCER=true`) must be typed `string`. Recommend adding to
  `docs/context-constitution.md` as a platform invariant.

**Deferred follow-ons**: None.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-09-01 entries for 142-fix-fundamentals-upsert-invalid-json.

**Runtime-invariant recommendations (→ /context-constitution)**:
- PLAT-JSONB-1: In pgx v5 `QueryExecModeExec`, `[]byte` parameters are always wire-sent as `bytea`
  OID; JSON/JSONB columns must be bound as `string`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
commit preceding the archive branch `claude/archive-batch-2026-09-01`.
