# Context: fix-backfill-timeframe-enum  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A 4-service, 8-step fix closing an entire deprecated-string/enum producer family (ingest
`BackfillJob`, marketdata `Bar` at four construction sites + two request readers, analysis's third
`GetBars` producer, the UI's two `getBars` senders), plus a forward-only marketdata
data-remediation migration. What began as "populate one missing enum field" ended as closing seven
producer sites and fixing a live wrong-data write-path bug the original bug report never suspected.
The design debate genuinely ran **4 full rounds**, not capped by mechanism — it kept extending
because every round found a producer/reader the previous round had asserted didn't exist. **Round 4
itself deviated from the standard protocol**: the proposer/adversary subagent pair could not be
started because the session's subagent limit had been reached, so the orchestrator performed round
4's deliverable (the completeness-proving readers sweep) directly by grep instead of running the
standard adversarial round. A future reader needs this to correctly weight how much scrutiny round
4's "family closed, no new producer found" conclusion actually received — it was a direct grep
sweep, not an adversarially-contested one.

**Why (irrecoverable rationale)**: The severity raise (SEV-3→SEV-2) and the scope quadrupling were
forced by round-3 design debate discovering that the product spec's own central claim ("the write
path already migrated correctly") was false, and that the feature's own primary caller (UI-created
backfill jobs) would have shipped `UNSPECIFIED` under the originally-proposed fix.

**Rejected alternatives**:
- Leave the WS-stream `Bar` site's `TimeframeEnum` unset and document "no representable canonical
  timeframe" — lost because it preserves exactly the populated-string/empty-enum shape the feature
  exists to eliminate; overruled by explicit user decision.
- Add a stored `timeframe_enum` column to `ingest.backfill_jobs` instead of deriving it — lost
  because canonicalize-on-write (FR-13) makes the string reliable, so a derived value achieves the
  same guarantee without dual-write discipline; the original rejection rationale ("two values could
  disagree") was itself falsified mid-design — they already disagreed.
- Split into two features (live wrong-data bugs now, labelling cleanup later) — genuinely
  attractive once severity rose, explicitly weighed, and rejected: splitting a defect family across
  features "has already demonstrated this failure mode four times" in this codebase's history.
- `barRow.toBar()` repository extraction for a test seam — lost as overbuild; a totality test in the
  already-coverage-measured `internal/timeframe` package achieves the same guarantee.
- `tests/conftest.py` re-import for the shared ingest test fixture — lost because it depends on
  pytest import-mode internals with no ergonomic advantage over a plain `tests/_helpers.py` module.
- FR-10's fallback for an unresolvable `bar_ingest_timeframe`: "pass raw through, or skip the
  cycle" — this was the **proposer's own recommendation** ("pass-raw was strictly additive... and
  was my recommendation") and was **overruled by the user** in favor of falling back to `"15m"`, on
  the rationale "this is the platform's only continuous OHLCV feed and a misconfiguration should
  degrade to a working default rather than to silence."

**Scars & gotchas**:
- A review-gate **fix is itself unreviewed until executed**: round 1 of `/sdd-review impl-spec`
  proposed fixing two blockers by citing `source.Source` (a symbol that does not exist — the real
  interface is `source.DataSourceClient`) and by recording Playwright requests into a module-level
  array in `e2e/mock-backend.ts` (which starts in Playwright's `globalSetup`, a different process
  from the workers — a worker would read its own empty array). Round 2 caught both only because it
  re-executed rather than re-read the round-1 fixes.
- `page.reload()` is non-deterministic for asserting a specific follow-up network request in this
  Playwright environment — it races `ChartPanel`'s multi-request mount cascade. Fixed by triggering
  the second request via a deterministic UI interaction (clicking the `'1h'` timeframe button)
  instead.
- Line-shift citation repair must account for *every* preceding edit compounding, not just the
  nearest one: an instruction asserted a line "does not move" because a field was appended after an
  existing one, but ignored that the same instruction's import addition shifted every line below it.
- `golangci-lint` requires its own `//nolint:staticcheck` on *every* line that reads a deprecated
  field, even a line that only re-reads a value already captured into a local for an earlier
  annotated read.
- **Migration-vs-concurrent-writer scar**: the migration originally diffed whole-table counts and
  assumed sequential clearing (delete-duplicates-then-update), but the marketdata bar-ingest poller
  writes to the same table roughly every 60s, so a canonical row can be committed *between* the
  delete branch and the update branch, reintroducing the exact PK violation the delete-the-
  alias-duplicate policy exists to avoid. The fix required *both* a pre-flight quiesce **and** an
  independent `WHERE NOT EXISTS` re-check inside the UPDATE statement itself — "a migration must not
  depend on an operator remembering a manual step."

**Permanent deviations**:
- design/impl-spec said the AC-8 sender-side e2e assertion would use `page.route()` interception
  driven by `page.reload()` → shipped a **separate** deterministic click-triggered test → because
  `page.reload()` proved non-deterministic against `ChartPanel`'s mount cascade in this environment.
- product-spec/design assumed per-step branches PR'ing into `feature/fix-backfill-timeframe-enum` →
  shipped as **one commit per step on `claude/impl-080-timeframe-enum`, single PR to main-dev** →
  because that feature branch was never created and the harness authorizes only `claude/*` branches.
  Consequence: step 5's DBA/service-owner migration gate has no dedicated PR of its own and had to
  be called out explicitly in the integration PR body.
- design/spec's Step 5 was marked `blocked` (unverifiable without a live DB per an F-05 reading) →
  shipped as `done`, verified by SQL review against DDL facts only → because that F-05 reading did
  not survive a repo-precedent check (see fails.md entry below).

**Cross-feature signal**:
- Features 039/040 (TimescaleDB compression/retention, both `idea`) must spec against marketdata
  migration `004+` (080 took `003`) and must re-check FR-14's assumption that compression is not yet
  applied, since their own purpose is adding the policy that would break FR-14's migration
  precondition.
- Feature 017 (`idea`, `session`/`extended_hours` field on `GetBarsRequest`) will land in
  `barFromAlpaca`/`TIMEFRAME_ENUM` territory this feature just built — whoever specs it should read
  080 first.
- `marketdata_handler.go:258` (the live gRPC `StreamBars` reader) stays a raw, unresolved reader —
  excluded from this feature only on *reachability* (zero producers of `StreamBarsRequest` today),
  not correctness. It becomes a live instance of this exact defect family the moment any future
  feature adds a `StreamBars` caller.

**Deferred follow-ons**:
- FR-14's migration still needs **DBA + service-owner sign-off** before it runs anywhere shared — it
  was authored and reviewed but never executed against a live database in any session.
- Rows with `timeframe=''` or `'1m'` in `marketdata.ohlcv` were deliberately left unremediated
  (unrecoverable intent / never-persisted anomaly respectively) — a scoped `DeleteBars` cleanup is
  explicitly out of scope and unassigned.
- Out-of-repo producers (the staging MCP client that originally surfaced this bug, `grpcurl`, DO-side
  jobs) cannot be swept by any code-based completeness check and remain an open residual.

**Ledger entries written**: insights.md (4), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: SDD-skill mechanics gap — a
permanently `blocked` step has asymmetric consequences not obviously visible from the skill surface:
`/sdd-execute`'s selector still routes into the ALL-DONE path and opens an integration PR even while
the feature is stranded below `code-completed`, and `/promote` silently never harvests it. Candidate
for a note in `docs/patterns/context-engineering.md` or the `sdd-execute` skill, not a Ledger entry.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
`fe278020abe1e4b0c128a7a2207fd46596d8a9e8`.
