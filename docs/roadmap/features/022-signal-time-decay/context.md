# Context: signal-time-decay

**Feature**: `docs/roadmap/features/022-signal-time-decay/feature.md`
**Product Spec**: `docs/roadmap/features/022-signal-time-decay/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/022-signal-time-decay/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 022.
- No proto or schema changes. Single config key + analysis scoring loop change.
- Key design decision captured: use `ingested_at` (not source publication time) as age reference.
- Two open questions deferred to /sdd-spec: age reference confirmation, and whether to add a max-age floor to drop ancient signals entirely.

## Session 2026-08-13T00:20:00Z — sdd-review product-spec (round 1, FAIL)

- `/sdd-review signal-time-decay product-spec` returned FAIL:
  - C-14 blocker: no `## Consumer Surface(s)` section at all — this dormant spec predates that
    template requirement (it was written 2026-05-26, before `134-signal-source-reliability-weight`
    established the current pattern for this scoring pipeline).
  - P-03 blocker: both Open Questions were unresolved `- [ ]` items ("confirm at impl-spec time" /
    "decision deferred to impl-spec") rather than settled or explicitly routed to a design-phase
    fork.
- No files were modified per the review-gate's FAIL rule (feature stayed `draft`).

## Session 2026-08-13T00:25:00Z — fix + re-review prep

- Added `## Consumer Surface(s)` to product-spec.md: `/insights` UI, grounded by direct code read
  (not inferred) — `BacktestDiagnostics.tsx:153` renders `bar.conviction` per row, which is
  downstream of the `signal_score` this feature decays (`combine_score()`'s input); second-order,
  `StrategyScore.overall_score`/`rating` (`analysis.proto:170,172`) on the same strategy detail
  page reflects the resulting entry/exit decisions via feature 065's evidence aggregation.
- Resolved OQ1: `ingested_at` — checked off, since FR-4 already committed to this; the question was
  closed, not actually open.
- Resolved OQ2: no max-age floor in V1 — checked off with rationale (exponential decay is
  self-limiting; a floor is a DB-query-perf optimization, not a correctness requirement; named as a
  future follow-up against ingest's signal-retention story if it's ever needed, not silently
  dropped). Added a corresponding line to `## Out of Scope` for consistency.
- This is a design decision made without a live human sign-off on OQ2 specifically (OQ1 merely
  restates an already-committed FR). Surfaced to the user in the session response rather than
  left implicit only in this file.

## Session 2026-08-13T00:35:00Z — sdd-review product-spec (round 2, FAIL — stale premise found)

- Re-review found the round-1 fix insufficient: the spec's **core premise was stale**, not just
  missing a section. FR-1 targeted "the analysis service scoring loop" — but feature 097
  (`servicer.py:326-331`) retired the signal-confidence blend from `RunBacktest` entirely before
  this dormant 2026-05-26 draft was ever implemented. `combine_score`/`compute_signal_score` only
  survive in `ScreenSymbols` (`screener.py:235,456`), not the backtest/live path FR-1 assumed. The
  Consumer Surface citation chain added in round 1 (`BarDiagnostic.conviction` /
  `StrategyScore.overall_score` via `combine_score`) was consequently code-false — each individual
  citation was real, but `combine_score` is never actually invoked on that path. FR-4 also assumed
  `signal.ingested_at` was available on `ExternalSignal`; it isn't (verified against
  `ingest.proto:106-116`), even though the underlying DB column exists.
- User asked, via `AskUserQuestion`: where should decay now apply, given the original target is
  gone? Options presented: Screener only / `Opportunity.signal_axis` / both / defer entirely into
  134's design phase. **User chose `Opportunity.signal_axis`** — the same expression
  `134-signal-source-reliability-weight` already targets (`servicer.py:2163`).
- Retargeted the spec accordingly:
  - FR-1 now decays `signal_axis`'s `sig.conviction` term directly, with an explicit coordination
    note that 134 and 022 both multiply into the same expression — whichever lands second rebases
    to include both terms.
  - FR-4 now specs the real gap: add `ExternalSignal.ingested_at` (proto field 10, next free after
    `tags=9`), select/populate it in `QuerySignals` — `xstockstrat-ingest` added to Affected
    Services and Proto Contract Changes updated (no longer "no proto changes required").
  - FR-5's backtest-determinism framing dropped (no backtest replay concept applies to a live
    queue compute) — replaced with same-compute-pass reference-timestamp consistency, grounded in
    the real `session_end_seconds` variable at `servicer.py:2179-2185`.
  - Consumer Surface rewritten to the real surface: the Opportunities queue's existing ranking
    display, no new BarDiagnostic/StrategyScore claim.
  - Acceptance Criteria rewritten against `signal_axis`/`QuerySignals`, not backtest scores.
  - Added a "Known trap" Open Question item (023-position-sizing-engine ordinal/cardinal
    conflation) since this feature now touches the same `signal_axis` neighborhood as that trap.
- Added a `docs/roadmap/features/merge-order.md` row: `signal-time-decay` (022) must wait for
  `signal-source-reliability-weight` (134) — same-expression overlap on `servicer.py:2163`, 134
  lands first (already `spec-ready`), 022 rebases the combined formula onto it.
- Re-running `/sdd-review signal-time-decay product-spec` next.

## Session 2026-08-13T00:40:00Z — sdd-review product-spec (round 3, overlap findings)

- Overlap re-scan (round 3): the 022↔134 `merge-order.md` row is present and correctly shaped. New
  finding: `131-live-strategy-opportunity-attribution` (also `spec-ready`) restructures the same
  `_compute_opportunities` candidate-creation/signals-merge block (`servicer.py:2144-2168`) that
  contains the `signal_axis` line (`:2163`) 022/134 already coordinate on — a three-way
  same-function overlap, not previously recorded.
- Added a second `merge-order.md` row: 022 must also wait for 131, with a recommended landing
  order **134 → 131 → 022** (134's factor addition first since simplest/earliest spec-ready; 131's
  structural candidate-loop change next; 022's decay factor composes last on the combined
  expression). This row governs 022's ordering relative to 131 — 131 itself has no dependency here
  (confirmed clean in its own overlap scan).
- Criteria re-review (round 3) in progress; awaiting result.

## Session 2026-08-13T00:45:00Z — sdd-review product-spec (round 3, criteria FAIL — self-introduced bug)

- Criteria re-review (round 3) FAIL: my own round-2 fix introduced a genuine internal
  contradiction. FR-5 required the decay multiplier (written at FR-1's site, `servicer.py:2163`,
  inside the signals-merge loop `servicer.py:2152-2166`) to use `session_end_seconds` as its
  reference clock — but `session_end_seconds` is declared `= 0` at `servicer.py:2184`, inside a
  **later** per-candidate bar-fetch loop that runs after the signals-merge loop, and is a
  bars-derived running max (used only for `valid_until`), not a wall-clock timestamp at all. FR-1's
  write-site literally cannot read a variable that doesn't exist yet at that point in the function.
- Root cause: I pattern-matched the original 2026-05-26 spec's "determinism" concern (backtest
  window's `now` vs. wall clock) onto the wrong variable in the new target function, without
  tracing the actual order of operations in `_compute_opportunities` before citing it.
- Fixed: FR-5 rewritten to require a single `now_utc` read at the **start** of
  `_compute_opportunities` (a new local variable, not yet present in the function) reused for every
  signal's `age_hours` in that pass — explicitly distinguished from `session_end_seconds`. AC-3
  updated to match. Also fixed two advisory items from the same round: the "Known trap" Open
  Question item moved out of checklist (`- [ ]`) format since it's a guardrail note, not an
  unresolved decision (was tripping Criterion 9's literal checkbox rule); `feature.md`'s Summary and
  Reviewers table updated to match the retargeted spec (was still describing the pre-097 premise,
  flagged as stale/informational by the reviewer).
- Re-running `/sdd-review signal-time-decay product-spec` (round 4) next.

## Session 2026-08-13T00:50:00Z — sdd-review product-spec (round 4, FAIL — arithmetic error)

- Round 4 confirmed the FR-1/FR-5 contradiction is genuinely fixed (verified against
  `servicer.py:2083-2242`'s real control flow: `now_utc` read at the top of the function is in
  scope at the `:2163` write-site; `session_end_seconds` correctly identified as a distinct,
  later-declared variable). Overlap re-scan also clean — both merge-order rows still accurate.
- One new, previously-uncaught defect: AC-1's worked example was arithmetically wrong. "48 hours
  ago, 24-hour half-life → half the weight" is incorrect — two half-lives elapsed means
  `0.5^(48/24) = 0.25`, a quarter, not a half (contradicted AC-5's own correct `t=half_life ⇒ ≈0.5`
  statement in the same spec).
- Fixed: AC-1 now states the correct `0.25`/quarter result explicitly, with the exponent shown.
- Re-running `/sdd-review signal-time-decay product-spec` (round 5) next.

## Session 2026-08-13T00:55:00Z — sdd-review product-spec (round 5, PASS)

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS, zero blockers, zero warnings. Reviewer independently re-derived every
  Acceptance Criterion's arithmetic from FR-1's formula and re-traced `_compute_opportunities`'s
  real control flow line-by-line to re-confirm FR-1/FR-5 compatibility — both hold.
- Overlap verdict: CLEAN. Both `merge-order.md` coordination rows (022 waits for 134; 022 waits
  for 131) re-confirmed accurate against current trunk and current sibling-feature state.
- Five review rounds total this session, each catching a distinct real defect: (1) missing
  Consumer Surface + unresolved Open Questions, (2) a stale premise targeting code feature 097 had
  already retired, (3) an FR-1/FR-5 internal contradiction (a cited variable that didn't exist yet
  at the write-site), (4) an AC-1 arithmetic error. This is the pipeline working as designed — a
  dormant, unreviewed 2026-05-26 draft had accumulated all four defects silently; nothing caught
  them until this review pass actually ran.
- Next: `/sdd-spec signal-time-decay`, but only after `134-signal-source-reliability-weight` and
  `131-live-strategy-opportunity-attribution` land (merge-order.md dependency).

## Session 2026-08-14T00:00:00Z — /sdd-design signal-time-decay (Phase 0 Recon)

- Recon written (`recon.md`): confirmed `_compute_opportunities` has no existing `now_utc`/decay
  code (grep-clean); `ingested_at` is stored (migration `001`) but never exposed by `QuerySignals`;
  the `SignalSource.last_seen_at.FromDatetime(...)` pattern is the direct reuse for exposing it.
- Flagged as **Critical**: `ConfigWatcher.get_float`'s `v.float_val or default` zero-trap would
  silently defeat FR-3's "0 disables decay" rollback contract — no `get_float_present` equivalent
  exists yet (only `get_int_present`). Design must resolve this explicitly.
- Flagged the 134/131 same-expression/same-function composition risk (already recorded in
  `merge-order.md`, landing order 134 → 131 → 022) as something design must state precisely, not
  just note.

## Session 2026-08-14T00:30:00Z — /sdd-design signal-time-decay (Phase 1, full mode, 4 rounds)

- **Round 1**: adversary found a structurally-reachable negative-`age_hours` bug — ambiguity in
  exactly when `now_utc` is captured relative to `await self._drain_active_signals(...)`
  (`servicer.py:2098`, a real network round-trip) meant a signal ingested concurrently with that
  await could carry `ingested_at > now_utc`. `math.exp` on a negative age produces
  `decay_multiplier > 1.0` with no downstream clamp, risking `signal_axis` silently exceeding the
  `[0,1]` range every consumer assumes.
- **Round 2**: proposer fixed it (capture `now_utc` immediately after `:2098`'s await resolves,
  plus a defensive `age_hours = max(0.0, age_hours)` clamp regardless of ordering). Adversary
  verified the fix but found **two new, real must-fix defects**: (1) the FR-6/AC-4 mandated
  per-signal DEBUG log referenced `age_hours`, which was only assigned in the `half_life > 0`
  branch — FR-3's disable path (`half_life <= 0`, an intentional operator rollback, not a rare
  edge case) would raise `UnboundLocalError` on every signal; (2) `ExternalSignal.ingested_at`
  reaching analysis unset (proto zero-value = epoch 1970) during a routine ingest/analysis
  independent-deploy-ordering race (the two services redeploy on separate merges) would make every
  signal's age ~55 years, underflowing `decay_multiplier` to a literal `0.0` for **every** signal
  platform-wide — a silent full signal blackout, not the self-limiting per-signal decay the spec's
  Open Questions explicitly signed off on.
- **Round 3**: proposer fixed both by splitting age-derivation (branches only on
  `sig.HasField("ingested_at")`) from decay-application (branches only on `half_life`) — neither
  branch depends on the other's outcome, so all four log-referenced names are always bound.
  Adversary verified: traced all 4 branch combinations (confirmed no `UnboundLocalError` path
  remains), confirmed `HasField` is valid protobuf API for this plain submessage field (not a
  oneof), confirmed the deploy-race degrades to a neutral per-signal `decay_multiplier=1.0` + one
  WARNING instead of a blackout. Zero Floor breaches. Adversary recommended folding 4 remaining
  mechanical objections into `design.md` without a full round 4: an unverified "134's term, already
  landed" claim (false against `main-dev` — a `fails.md` 2026-08-05/023, 2026-07-30/080
  claim-vs-producer-contract repeat); a C-08 test-pairing gap (AC-5 didn't cover the
  `age_known=False` branch — exactly round 2's blackout regression surface); a self-flagged
  per-signal WARNING log-volume risk (proportional to active-signals × active-users during a
  routine deploy race); and a NaN fail-safety concern (the existing `max()`'s NaN-discarding
  behavior is a real but fragile argument-order-dependent emergent property, not a designed guard).
- **User explicitly chose to run round 4 anyway** (via `AskUserQuestion`, selecting "Run another
  round" over "Approve design" and "Approve but skip the isfinite() code guard") rather than accept
  round 3's fixups as final.
- **Round 4**: proposer resolved all four objections concretely — (1) design.md states 134 is not
  landed and `/sdd-spec` must re-verify the actual landed expression, not trust any design-time
  citation; (2) exact AC-5 amendment text + new AC-7 (aggregated-WARNING call-count assertion)
  drafted; (3) `missing_ingested_at_count`/`total_signal_count` aggregation, incremented once per
  signal, one `log.warning` after the full section fires; (4) adopted an explicit
  `if not math.isfinite(effective_conviction): effective_conviction = 0.0` guard rather than a
  doc-only tripwire. While grounding decision (3) against the real code, the proposer **found its
  own new structural bug**: the signals-merge section is actually a two-level nested loop
  (`signals_by_symbol` → `targets` → `sigs`, `targets` can have >1 entry when a symbol is bound to
  multiple watchlist strategies) — computing/logging/counting inside the `targets` loop as a flat
  loop would have implied would multiply DEBUG log volume and the missing-count by `len(targets)`,
  reintroducing the exact amplification objection 3 was meant to fix. Fixed by hoisting decay
  computation into a `sig_contribs` list above the `targets` loop, computed once per signal.
- **Round 4 adversary**: verified the nested-loop claim directly against `servicer.py:2083-2242`
  (confirmed correct, zero regression vs. current trunk) and the hoisted-computation fix (confirmed
  it correctly avoids per-target duplication). Zero Floor breaches. Found 4 more finalization gaps,
  all closable without a round 5: `get_float_present` was being *used* in pseudocode without being
  explicitly committed as a required `/sdd-spec` code change to `watcher.py`; the claimed AC-5/AC-7
  amendments existed only in debate text, not yet written into `product-spec.md` itself (a P-04
  process gap — `/sdd-spec` reads `product-spec.md`, not this session's debate transcript); the
  thesis/`best_direction` staying keyed on raw (not decayed) conviction was a real, accepted scope
  asymmetry that needed to be stated explicitly rather than left implicit; and FR-5's literal
  wording ("at the start of `_compute_opportunities`") mismatched the actual placement (after the
  `:2098` await, not the true first line) — recommended softening the wording rather than moving
  the read (moving it would reopen round 1's race).
- **Closed all four round-4 adversary gaps in the same pass**: `product-spec.md` FR-5 reworded to
  state the exact placement and why (race avoidance, not incidental); AC-5 amended in place to add
  the `age_known=False` test case; new AC-7 added for the aggregated-WARNING call-count assertion;
  `design.md` written with the explicit `get_float_present` commitment, the 134-composition
  spec-time-reverify instruction, and the accepted decay-blind-thesis-selection scope note.
- **Result**: `design.md` written (Chosen Approach / Rejected Alternatives / Open Risks /
  Constitution Rules Touched). `feature.md` updated: `spec-ready` → `design-approved`, full 4-round
  history recorded. Zero Floor breaches at any of the 4 rounds — every round's findings were real,
  concrete, code-grounded defects (not architecture forks), consistent with this session's own
  `insights.md` 2026-08-13/14 lesson recurring one layer deeper inside round 3 itself (the
  "already landed" claim was prose-plausible but code-false).
- Next: `/sdd-spec signal-time-decay` — but only after `134-signal-source-reliability-weight` and
  `131-live-strategy-opportunity-attribution` land (`merge-order.md` dependency, landing order
  134 → 131 → 022). `/sdd-spec` must re-verify the actual landed `_compute_opportunities` shape at
  that time per this design's explicit instruction — do not copy this design's pseudocode verbatim
  without re-grounding it.

## Session 2026-08-14T02:00:00Z — /sdd-design signal-time-decay (follow-up round, Open Risks review)

- User asked to run a round targeting 022's 2 remaining `design.md` Open Risks, to see if either
  could be resolved further rather than left as documented-and-deferred.
- Proposer evaluated both honestly rather than manufacturing a fix:
  - **Composition-unverified risk**: confirmed no defensive code (e.g. `getattr`/duck-typing around
    `weight_for`) is warranted — `merge-order.md`'s hard `134 → 131 → 022` sequencing plus
    Constitution **F-04** ("Never invent a file path or symbol... block the step",
    `docs/sdd/constitution.md:76`) already guarantee/enforce the symbol exists before `/sdd-spec`
    could ever cite it; a runtime guard would be speculative scaffolding for a codepath that cannot
    exist in the delivered artifact, violating root `CLAUDE.md`'s "write the minimum" principle.
    Added one clarifying paragraph to `design.md` citing F-04 as the actual backstop mechanism —
    strengthens the existing procedural mitigation's justification, no code change.
  - **Thesis-decay-blind risk**: confirmed this isn't actually an open risk — `product-spec.md`
    FR-1 (`:39`) is the sole FR defining decay's scope and names only `signal_axis`; no FR/AC covers
    `thesis`/`best_direction`/`_best_sig_conv`. Extending decay there would be user-visible scope
    expansion requiring a product-spec amendment via `/sdd-story`, not something a design round can
    fold in unilaterally. Reclassified out of "Open Risks" into a new "Scope Decisions (not risks)"
    section in `design.md` — kept visible (not deleted) so a future reader finds the reasoning
    already done rather than re-opening it as undecided.
- Verified the F-04 citation directly (`grep -n "F-04" docs/sdd/constitution.md` → line 76, exact
  wording matches) before accepting the round's claim, consistent with this session's own
  `insights.md` 2026-08-13/14 lesson (verify every claim against the real source, not prose
  responsiveness).
- Result: documentation-only `design.md` amendment, no code/config/proto change, no re-approval gate
  needed (no architecture change — status stays `design-approved`).

## Session 2026-08-14T04:00:00Z — /sdd-spec signal-time-decay

- Generated `implementation-spec.md` with **7 steps**. Status → `implementation-ready`.
- **Executed the design's mandatory spec-time re-verification** (design.md § Chosen Approach —
  "134 composition — verify at spec time, not design time"): **134 and 131 have NOT landed** — both
  are `implementation-ready`, not `launched`. Grep-confirmed against current trunk:
  - Write site is still `c["signal_axis"] = max(c["signal_axis"], sig.conviction)`
    (`services/xstockstrat-analysis/app/handlers/servicer.py:2163`), **no `source_weight` term**.
  - `grep -rn "weight_for" services/xstockstrat-analysis/` → zero hits (134's symbol absent);
    `live_by_symbol` → zero hits (131 absent). `source_weights` exists only in the screener path
    (`scoring.py:23`, `screener.py`), never in `_compute_opportunities`.
  - The current-trunk signals-merge section (`:2154-2168`) is exactly the two-level nested loop the
    design wrote against (`for key in targets: for sig in sigs:`), so the design's `sig_contribs`
    hoist maps 1:1.
  - **Per Constitution F-04**, Step 5 cites only the real current expression
    (`effective_conviction = sig.conviction * decay_multiplier`, no invented `source_weight`) and
    carries an explicit **MERGE-ORDER / REBASE CONSTRAINT** in `## Step Dependencies`: `/sdd-execute`
    must re-grep the landed `_compute_opportunities` and add `× source_weight` / adjust the loop shape
    only against real landed symbols if 134/131 have landed by then. Landing order 134 → 131 → 022
    (`merge-order.md:59-60`) is enforced at the integration-PR gate.
- Key codebase findings (all `path:line`-grounded):
  - Proto: `ExternalSignal` `packages/proto/ingest/v1/ingest.proto:106-116`; highest field `tags = 9`
    (`:115`), **field 10 free**; `google.protobuf.Timestamp` already imported/used (`:111-112`).
  - Ingest `QuerySignals` `servicer.py:898-994`: SELECT (`:958-960`) and `ExternalSignal(...)`
    construction (`:976-983`) both omit `ingested_at`; query already `ORDER BY ingested_at DESC`
    (`:962`). Column `NOT NULL DEFAULT NOW()` (`migrations/001_newsletter_signals.up.sql:10`) — no
    migration, no `IngestSignal` change. Reuse `SignalSource.last_seen_at.FromDatetime(...)`
    (`servicer.py:1039-1040`), no null guard (NOT NULL). `Timestamp` imported (`:20`).
  - Config zero-trap (recon Critical): analysis `watcher.py` `get_float` (`:124-130`) is
    `v.float_val or default`; `get_int_present` (`:103-114`) is the presence-aware template; **no
    `get_float_present` exists** — Step 5 adds it (design-mandated explicit change). `float_val` is
    oneof member #3 (`packages/proto/config/v1/config.proto:48-52`), so `HasField("float_val")` valid.
  - Analysis servicer already imports `math` (`:17`), `datetime/UTC/timedelta` (`:19`), `log` (`:61`) —
    no new imports for the decay logic.
  - Config key is **runtime-registered, no config-service seed migration** — the sibling
    `analysis.scoring.*` keys (065) are not seeded either
    (`services/xstockstrat-config/docs/context-constitution-findings.md:13`); declared in analysis
    `CLAUDE.md` only (Step 7). Tradeoff surfaced in the spec (a seed migration is optional, not
    required for correctness).
  - **C-14**: no UI/Agent step — product spec's Consumer Surface is the existing `ListOpportunities`
    ranking, which reflects the decayed `signal_axis` with no frontend change. Restated as a decision
    in `## Execution Summary`.
  - Test homes confirmed: ingest `tests/test_ingest_servicer.py` (QuerySignals); analysis
    `tests/test_analysis_servicer.py` (`_FakeOppRepo` harness `:3517`, `_sig` fixture builder `:3504`,
    existing `signal_axis` assertions `:3769-3792`) + `tests/test_config_watcher.py`.

### Decisions

- Spec cites current-trunk code (no `source_weight`, current 2-level loop); rebase deferred to
  `/sdd-execute` per F-04 and the design's explicit spec-time-reverify instruction.
- Config key runtime-registered (no seed migration) — sibling-precedent-backed; a seed migration is a
  named, optional follow-up, not required.
- No config-service reviewer on the snapshot — the `config`-category step (analysis `CLAUDE.md`
  declaration) is analysis-owned per the reviewer matrix; config service is untouched.

### Open Threads

- Hard: 022's integration PR must land after 134 and 131 (landing order 134 → 131 → 022). At execute
  time, re-grep `_compute_opportunities` and rebase Step 5's expression/loop shape onto whatever
  134/131 actually left — adding `× source_weight` only against a real landed symbol (F-04).

---

## Session — 2026-08-15 (/sdd-execute, stacked on landed 134/131)

Executed all 7 steps directly on `feature/signal-time-decay` (branched off `main-dev` after
133/134/131 landed; 134=#953 and 131=#954 are ancestors of this branch).

### Steps
- **Steps 1–4 (prior commits `3d8e79b`, `10e0b9a`)** — proto `ExternalSignal.ingested_at = 10`,
  regenerated stubs, ingest `QuerySignals` SELECT + `FromDatetime` population, ingest test. Statuses
  flipped to `done` this session (prior commits omitted the status edits).
- **Step 5 — decay in `_compute_opportunities`** (`watcher.py` + `servicer.py`):
  `get_float_present` added to the watcher (presence-aware `float_val`, no zero-trap). In the
  servicer: `now_utc`/`half_life`/counters captured once right after the `_drain_active_signals`
  await; the §3 signals-merge loop rewritten with a per-signal `sig_contribs` hoist above the
  `targets` loop. **Rebased onto landed 134 (D-1):** the write site already carried
  `source_weights.get(sig.source, 1.0)`, so `effective_conviction = raw × source_weight ×
  decay_multiplier` and the DEBUG log gained `source_weight`. 131's two-level nesting confirmed
  intact. Aggregated WARNING (one per compute pass) emitted before the `max_universe` read.
- **Step 6 — tests** (`test_analysis_servicer.py` only; **D-2**): `get_float_present` cases added to
  `TestConfigWatcherGetters` (reusing `_StubWatcher`) — spec's `test_config_watcher.py` evidence was
  stale (that file has only resolve_* cases; the getter tests live in `test_analysis_servicer.py`).
  9 decay cases added beside the source-reliability test (`_sig` extended with `ingested_at`;
  `make_servicer` gained a `get_float_present` default stub): t=0/1/2/3 half-lives, disabled by 0 and
  by negative, missing-`ingested_at`-treated-as-fresh, exactly-one aggregated WARNING, and silent when
  fully stamped.
- **Step 7 — config doc**: `analysis.scoring.signal_decay_half_life_hours` (float, `24.0`) row added
  to analysis `CLAUDE.md` § Config Keys Consumed.

### Verification
- Analysis: `ruff check` clean, `ruff format` applied, `pytest --cov` → **487 passed, 82.7%**.
- Ingest: `ruff` clean, `pytest --cov` → **191 passed, 79.2%**.

### Deviations
- **D-1** — Step 5 `× source_weight` factor added against the real landed 134 symbol (planned rebase).
- **D-2** — Step 6 `get_float_present` tests placed in `test_analysis_servicer.py`, not
  `test_config_watcher.py` (spec evidence drift; DRY reuse of `_StubWatcher`).

## Session 2026-08-16 (CI: feature status automation)

- Promotion PR #963 merged to main
- Feature promoted and committed: 94e4e24fa6ac41eb20bd16e1e9af15c8388e885a
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-16
