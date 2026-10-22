# Context Log: fix-ingest-seeded-config-keys

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` (Issues disabled)
- Severity: SEV-3, environment dev (staging) → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-ingest, xstockstrat-config
- Root cause hypothesis: mixed seed key convention; ingest seeds are namespace-stripped, readers use the dotted form
- Recommended design depth: full → `/sdd-design fix-ingest-seeded-config-keys` (rationale: two services, a config key change or migration, and an open platform-wide sweep)
- Development branch: feature/fix-ingest-seeded-config-keys
- The runtime effect (reads miss the snapshot) is inferred from code and the live key registry, not observed; the design must confirm it with a live `set_config` check on staging before choosing the fix shape.
- Open questions for design: re-key seeds vs change readers; handling of operator-edited rows on re-key; whether other namespaces' older bare seeds are also inert; INGEST-9 wording; whether the unseeded `max_concurrent_jobs` and `retry_on_failure` keys should be seeded.

## Session 2026-10-22 (live check, staging)

- Ran `get_config(namespace="ingest")` on staging (read-only; no `set_config` was issued). The served snapshot's `values` are keyed by the bare
  seeded names (`mcp_client.request_timeout_seconds`, `mcp_client.poll_interval_seconds`, `backfill.chunk_max_bars`,
  `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`) with no `ingest.`-prefixed entries, and requesting the prefixed key returns the
  same snapshot. This confirms the snapshot shape that makes ingest's `values.get("ingest.…")` miss.
- Not observed: the behavioural effect (an edited value being ignored). No ingest log or metric exposes the effective timeout or poll interval,
  and a `set_config` write on staging would not be observable without adding one. The design should prove the effect with a unit test against a
  snapshot built from the seeds (AC-2) rather than a staging write.

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches). Trading-domain checks skipped (not a trading feature; C-1 to C-5 n/a).
- Warnings:
  - Criterion 9: four open questions remain (re-key vs change readers; bare+dotted conflict rule; seed `max_concurrent_jobs`/`retry_on_failure`; sweep scope). Deferred to /sdd-design; Q1 must be settled with 244 and 261 before /sdd-spec.
  - Criterion 8: AC-5 (FR-4) is either/or and defers to the approved design; pin it once FR-4 is decided.
  - Criterion 8: no scenario covers the both-rows-exist conflict (Open Question 2); add one (e.g. @FR-2 with a pre-existing dotted row) once the conflict rule is chosen.
  - Criterion 8: AC-6/AC-7 are documentation-state scenarios (not machine-verifiable); AC-1 to AC-3 assume the seeds-re-keyed outcome and need revising if the readers option is chosen.
  - Cross-feature migration numbering: 243 claims 031, 244 and 248 both claim 032. 277 needs 033 or later, re-derived across remote branches at spec time. Applied migrations 005 and 025 stay unedited.
  - Criterion 11: Consumer Surface section present and sufficient.
- Overlap findings: level WARN, no FAIL-level clash.
  - 277's migration slot 033 is unclaimed on trunk and on every live branch; no other live feature seeds the five ingest keys.
  - File collision (WARN): INGEST rules table in `services/xstockstrat-ingest/docs/context-constitution.md` is also edited by 244 and 261 (merge-order.md:82).
  - Conditional (WARN): the readers option would edit `app/config/watcher.py` and `app/engine/mcp_client_loop.py:133-138,162-167`, the same lines 244 rewrites to `int_positive`; the seeds option avoids it.
  - Config-key seam (WARN): 261 reuses `ingest.mcp_client.request_timeout_seconds` and references the bare 025 seed row; re-check 261's step against the final key form.
  - Low-risk shared context: `services/xstockstrat-ingest/CLAUDE.md:124-133`; unseeded `max_concurrent_jobs` (shared with 244's zero-trap test); `retry_on_failure` test surface.
  - Merge-order: no entry for 277 in `docs/roadmap/features/merge-order.md`. Proposed (not written; needs operator approval): 277 waits for 244 only if the readers option is chosen; 277's migration merges after 243's 031 and 244's/248's 032.
  - Note: the working-tree product-spec said no migration is anticipated while the branch copy requires one; the branch copy governs.

### OPERATOR DECISIONS (binding, recorded 2026-10-22)

- Triaged 2026-10-22 from docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md; Track C; the feature dir lives on the base branch ccr-fac38b1f-6m24q2 (PR #1322, not yet merged to main-dev).
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Operator instruction 2026-10-22: run the full speccing (review, recon, full design debate, spec, impl-spec review). A live read-only staging check was done: get_config(namespace='ingest') serves a snapshot keyed by the BARE seeded names with no 'ingest.'-prefixed entries (recorded in context.md and the report). The behavioural effect on ingest was not observed; the design should prove it by a unit test over a snapshot built from the seeds, not by a staging write. Do not run any data or config change on staging or production during speccing.
- Design must include a platform-wide sweep of every seeded config key against its reader (all namespaces and both snapshot key forms), reported as findings; fixing other namespaces stays out of scope unless the operator extends it at the design gate. The sweep must also reconcile the INGEST-9 wording and the 2026-09-03 findings entry with the real snapshot shape, and decide whether the unseeded ingest.backfill.max_concurrent_jobs and ingest.backfill.retry_on_failure keys should be seeded. Re-keying seeds must preserve operator-edited rows.
- Review note 2026-10-22: the first two product-spec reviews failed on acceptance coverage (FR-5/FR-6 uncovered; AC-5 stated a process step). The branch already carries AC-6 (FR-5), AC-7 (FR-6) and a rewritten observable AC-5, so review the CURRENT branch text.
