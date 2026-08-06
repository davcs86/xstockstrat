# Context: resumable-chunked-backfills  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as a full rewrite of feature 052's single-fetch `_execute_backfill`, not an additive layer on top of it — chunk planning/persistence/execution now replaces 052's exec path entirely, with a chunk-level semaphore, per-chunk retry, and startup-time job resumption (context.md:92-93, Session 2026-06-09 execute).
**Why (irrecoverable rationale)**: Resume idempotency was verified safe *before* coding by confirming `marketdata_repo.go` uses `ON CONFLICT ... DO UPDATE` — so a resumed chunk can just re-fetch its whole window rather than needing fine-grained byte-range tracking (context.md:56-58). This let the design collapse to "chunk-level COMPLETED-or-retry" instead of a more complex partial-chunk state machine — a complexity trade only justified because that upsert property already existed elsewhere.
**Rejected alternatives**:
- Sharing the chunk-concurrency knob with 052's job-concurrency key — lost because chunk-level fan-out needed independent tuning; shipped as separate `ingest.backfill.max_concurrent_chunks` (default 3) (context.md:31).
- GAPS_ONLY as the universal default — lost because manual/human-triggered backfills expect full refetch by default; GAPS_ONLY only defaults on for agent-scheduled (feature 010) triggers (context.md:33).
**Scars & gotchas**: - Stacking on two unmerged prerequisite features (052, 053) meant proto field numbers computed at `/sdd-spec` time were stale by execute time — a mandatory "re-spec gate" had to re-derive field numbers and migration NNNs against the actual stacked base (chunks_total/completed went from 11/12 to 13/14, fill_mode from 5 to 6, ingest migration 003→004, config migration none→005) (context.md:76-81). Any future feature stacked on in-flight prerequisites needs this same re-spec-before-execute step, not just a re-run of `/sdd-spec` once at grounding time.
**Permanent deviations**: - Product-spec framed this as adding chunk tracking "extends" 052's model -> shipped as a wholesale replacement of 052's `_execute_backfill` -> because a partial/additive chunk layer on top of 052's monolithic fetch was judged unworkable once chunking, resume, and GAPS_ONLY all had to interact; explicit user sign-off recorded as "USER DECISION: full chunked rewrite (replaces 052 single-fetch model)" (context.md:92-93).
**Cross-feature signal**: - Third feature in the 052→053→054 backfill-hardening chain to use sequential branch-stacking with a mandatory re-spec gate before execute; the pattern (unmerged hard prereqs, stale field numbers, respec-then-execute) recurred identically across all three (context.md:69-81).
**Deferred follow-ons**: - none found in context.md.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (the upsert idempotency at `marketdata_repo.go:42-47` is cited as already-known/reused, not a new invariant).
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
