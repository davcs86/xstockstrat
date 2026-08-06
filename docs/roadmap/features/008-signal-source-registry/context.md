# Context: signal-source-registry  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped a DB-backed `ingest.signal_sources` registry with 10 source types (5 programmatic + 5 Claude-`mediated_*`), a `BaseExtractor` ABC, and admin-gated `ListSignalSources`/`ManageSignalSource` RPCs, plus a config-ui `/sources` page — closing the free-form `source` slug fragmentation bug that silently zeroed out analysis backtests (product-spec.md:9).
**Why (irrecoverable rationale)**: The `mediated_*` types exist because the agent MCP feature needs Claude itself to read email/website content directly (no programmatic extractor) — the 1:1 mirroring with programmatic types was a deliberate taxonomy choice "so every programmatic source category has a Claude-mediated equivalent" (product-spec.md:181, Open Questions). No seeding strategy was built by design — operators register sources on-demand via the UI post-deploy (context.md session 2026-05-21).
**Rejected alternatives**: - Migration seed data for initial sources — rejected in favor of on-demand UI registration; resolved as an explicit open question, not worth the coupling (product-spec.md:180).
**Scars & gotchas**:
- The impl-spec was generated once (11 steps), then had to be re-run mid-execution because it *omitted all five `mediated_*` values* from the migration CHECK constraint and the `noop.py` extractor entirely — caught only on spec re-run, not the first pass (context.md:55-61, 2026-05-22 sdd-spec re-run).
- Even after the re-run, `noop.py` and the mediated-type coverage in `validate_config_json` still slipped and had to be patched again during Step 8 test-writing (context.md:151-153) — a spec-timing gap recurred twice on the same items.
- `upsert_source`/`ManageSignalSource` initially didn't persist `active` on write, breaking the re-activation toggle; fixed reactively in Step 10, not anticipated in spec (context.md:173-175).
- `buf`/proto plugins and Playwright browsers were not pre-installed in the execution environment, forcing ad hoc installs and, for Playwright, a `tsc --noEmit`-only verification substitute (context.md:76,87,186).
**Permanent deviations**: - none beyond the spec-vs-spec corrections above (no recon.md/design.md were produced for this feature — it predates the /sdd-design gate; spec-ready came straight from /sdd-story + /sdd-review).
**Cross-feature signal**: - Confirms a repeating pattern (also seen elsewhere): a fresh /sdd-spec run can miss requirements embedded in a large FR table (FR-2's mediated types) on the first pass, and a second full re-run was needed to catch it — spec review alone (impl-spec review) did not catch the omission, only the re-run did.
**Deferred follow-ons**: - Signal-source-weighting (007) still owns making the Sources UI weight field editable (currently read-only per FR-15/product-spec.md:84).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
