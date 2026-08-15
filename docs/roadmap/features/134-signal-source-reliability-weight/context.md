# Context: signal-source-reliability-weight

**Feature**: `docs/roadmap/features/134-signal-source-reliability-weight/feature.md`
**Product Spec**: `docs/roadmap/features/134-signal-source-reliability-weight/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/134-signal-source-reliability-weight/implementation-spec.md`

---

## Session 2026-08-13T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 130 (renumbered to 134 on 2026-08-14 — see the renumbering session entry
  below).
- Story originated from a conversational design-scouting pass (not `/sdd-story` invoked cold): the
  user asked whether signal source weights could live on `ingest.SignalSource` instead of only the
  `analysis.signals.source_weights` config blob, and whether the Opportunities queue could apply
  that weight. Code was scouted directly (not docs) to confirm: `signal_axis` in
  `_compute_opportunities` (`servicer.py:2163`) uses raw `sig.conviction`, no weight applied today;
  analysis holds an `ingest` stub but never calls `ListSignalSources`; the config-ui Sources page
  already renders a read-only weight column sourced from the config blob
  (`useSignalSources.ts:19-30`), which is the natural consumer surface once the field is real.
- Surfaced during scouting, not yet decided: whether to fold in dormant draft feature
  `022-signal-time-decay` (exponential confidence decay by age, never implemented) in the same
  design pass, since both multiply into the same effective-confidence computation. Deferred to
  `/sdd-design` as FR-6 / an Open Question rather than silently expanding or silently ignoring it.
- Ledger checked (fails.md/insights.md): flagged two relevant entries in Open Questions —
  (1) 2026-08-05 `023-position-sizing-engine` — the `Opportunity.conviction` (ordinal) vs.
  `ExternalSignal.conviction` (cardinal) semantic-mismatch trap; this feature's `signal_axis` input
  is the correct (`ExternalSignal.conviction`) field, but the design pass must re-confirm this
  explicitly, not assume it from this note. (2) 2026-08-05 `signal-source-weighting` (feature 007) —
  a `grpcio` version mismatch between regenerated proto stubs and `uv.lock` across three Python
  services, caught only at test-import time; re-check `uv.lock` after regenerating stubs here.

## Session 2026-08-13T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS. Warnings: `## Database Changes` should state the
  migration follows `NNN_description.up.sql`/`.down.sql` naming and that the next number in
  `services/xstockstrat-ingest/migrations/` is `010_*` (current highest is `009_signal_dedup_keys`)
  — maps to C-07. Advisory, to be filled in at `/sdd-spec` time, not a blocker.
- Overlap findings: none. Confirmed CLEAN against all other active features — `125-unified-symbol-page`
  and `084-droplet-compose-deploy` share `xstockstrat-analysis`/deploy topology respectively but touch
  disjoint files/messages/config keys. `007-signal-source-weighting` (launched) is the historical
  origin of `analysis.signals.source_weights`, not a live collision. `022-signal-time-decay` (draft)
  is self-flagged in this spec's own FR-6, not a scanner finding.

## Session 2026-08-13T00:30:00Z — fix review warning

- Fixed the one advisory warning from the sdd-review pass: `## Database Changes` now states the
  migration naming convention explicitly — next free number in
  `services/xstockstrat-ingest/migrations/` is `010_*` (current highest is `009_signal_dedup_keys`),
  named as `010_add_signal_source_reliability_weight`, with a note to re-verify the number is still
  free immediately before `/sdd-execute` runs it (numbering-collision risk per
  `docs/runbooks/feature-workflow.md` § Feature Numbering).

## Session 2026-08-13T01:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ui;
  key reuse patterns: `NamespaceEditor.tsx`'s inline-edit-cell + `validateFloatMap`, AIP-161 masked
  partial update already end-to-end). Two new forks surfaced beyond the product spec's own FR-4/FR-6:
  reject-vs-clamp semantics (ingest's own `conviction` precedent rejects; the config blob it replaces
  clamps) and whether `ManageSignalSourceResponse`'s row-construction should include the new field.
- Phase 1 Grilling: 4 rounds (full). Round 1 found a real correctness bug (plain `double` → new
  sources silently get weight `0.0` via proto3's zero-value, since the create form is untouched) and
  a factually broken UI-reuse claim (`validateFloatMap` validates a JSON map, not a scalar — would
  make every edit unsavable). Round 2 fixed both but introduced a second real bug (`None` doesn't
  fall through to a `NOT NULL DEFAULT` column in Postgres when the column is named in the INSERT —
  crashes every UI-driven registration) and shipped a cosmetic, not functional, resolution of FR-4
  (config key "deprecated" in description text only, while `ScreenSymbols` kept reading it live — the
  exact dual-source anti-pattern FR-4 forbids). Round 3 fixed both for real (Python-side default
  resolution; genuine repoint of `ScreenerEngine` off the config blob) — confirmed via independent
  grep-verification, not trust. Round 4 closed six remaining loose ends (a stale e2e test, two stale
  docs, an explicit accepted trade-off for the now-unread-but-still-editable config key, a restored DB
  `CHECK`, two carry-forward decisions, and a corrected test-churn count). Adversary recommended
  approval at round 4; user approved.
- Chosen approach: `optional double reliability_weight = 12` on `ingest.SignalSource`
  (explicit-presence required to avoid the zero-value bug), reject-at-write + DB `CHECK` validation
  (matches `conviction`'s own precedent, departs from the config blob's clamp), FR-4 resolved as a
  genuine replace (`ScreenSymbols` AND `_compute_opportunities` both repoint to a shared
  `_drain_source_weights` helper), UI reuses only `NamespaceEditor`'s click-to-edit shell with a
  bespoke scalar validator. Rejected: override-layer FR-4, `None`-relies-on-SQL-DEFAULT, cosmetic
  deprecation, deleting the config key outright, verbatim `validateFloatMap` reuse.
- Constitution rules touched: C-01, C-05, C-07, C-09, C-10(b), C-12, C-14, P-01, P-02, P-03, F-01,
  F-08 — all honored, no Floor breach at any round.
- Status: spec-ready → design-approved.
- **Insight worth recording**: this debate is a strong case study for grep-verifying a design
  proposal's claims rather than trusting its prose — three of the four rounds' real defects (the
  proto zero-value bug, the SQL NULL/DEFAULT crash, the cosmetic-not-functional FR-4 "fix") were each
  *plausible-sounding and internally consistent* in the proposer's own text, and were only caught
  because the adversary re-traced the actual code/DB semantics instead of accepting the proposal's
  self-description. Logged to `docs/roadmap/ledger/insights.md`.

## Session 2026-08-14T07:00:00Z — feature-number collision resolved (130 → 134)

- **Trigger**: merging `origin/main-dev` into `claude/opportunity-scoring-signals-ex8u1w` (this
  session's working branch) brought in `130-user-metadata-management` (PR #934, `/sdd-story` ran
  2026-08-14T00:00:00Z, already `code-completed` and merged to `main-dev`) — colliding with this
  feature's own `130` (`/sdd-story` ran 2026-08-13T00:00:00Z, still `design-approved`, never merged
  upstream).
- **Verified before acting**: a fresh checkout of `origin/main-dev` alone has only ONE `130`
  (`130-user-metadata-management`) — no collision exists on the trunk. The collision was confined
  entirely to this session's working branch, since this feature's work predates `main-dev`'s current
  state and was never merged there. Renumbering `130-user-metadata-management` would have been wrong
  (it's already correctly numbered on the trunk, the actual source of truth); this feature — the one
  still in-flight — is the one that needed to move.
- **Resolution per `docs/runbooks/feature-workflow.md` § Feature Numbering's collision-resolution
  rule** ("renumber the later one"): this feature's `/sdd-story` ran first (2026-08-13), so by the
  rule's own "later one" test it might seem like `130-user-metadata-management` should move — but
  that feature is already merged/code-completed on `main-dev`, where it holds `130` uncontested. The
  practical resolution (consistent with the rule's actual purpose — resolve the collision with the
  least disruption to already-landed work) was to renumber THIS feature to the next free number,
  `134` (the highest existing at the time, `133-strategy-user-ownership`, plus one).
- `git mv docs/roadmap/features/130-signal-source-reliability-weight
  docs/roadmap/features/134-signal-source-reliability-weight`, then updated every cross-reference:
  this feature's own self-referential `**Feature**`/`**Product Spec**`/`**Implementation Spec**` path
  lines and two bare-number self-mentions in `recon.md`; `docs/roadmap/features/merge-order.md`'s two
  `(130)` table-cell citations; `022-signal-time-decay`'s `context.md`/`design.md`/`feature.md`/
  `product-spec.md`/`recon.md` (extensive — 022's own design explicitly composes with this feature's
  landed change throughout multiple documents, per the `merge-order.md` `130 → 131 → 022` sequencing,
  now `134 → 131 → 022`); `131-live-strategy-opportunity-attribution`'s `context.md`; `132-strategy-
  symbol-denylist`'s `context.md`; `docs/roadmap/ledger/insights.md`'s 2026-08-13 entry title/citation.
  One false positive avoided: `022-signal-time-decay/recon.md`'s `watcher.py:124-130` line-range
  citation was protected (not a feature reference) before the bulk `\b130\b` → `134` sweep, then
  restored unchanged.
- **Not touched**: the other 5 pre-existing duplicate `NNN` prefixes already in the repo (`058`,
  `064`, `065`, `097`, `111`) — these predate this session and this merge, are unrelated to this
  collision, and are out of scope for this fix.
- Status unchanged (`design-approved`) — this was a pure renumbering, no content/design change.
- Next: unchanged — `/sdd-spec signal-source-reliability-weight` (slug unchanged, only `NNN` moved).

## Session 2026-08-14T20:30:00Z — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready. Consumed recon.md +
  design.md as authoritative; re-verified every load-bearing `path:line` by grep before citing it.
- Step list: 1 proto (`optional double reliability_weight = 12` on `SignalSource`) → 2 proto-gen
  (buf-gen + `uv lock --check` in ingest/analysis/indicators for the feature-007 grpcio trap) →
  3 ingest migration `010` (ADD COLUMN + CHECK) → 4 ingest service (register/update HasField+reject
  merge, `_SS_MASKABLE_PATHS`, repo kwargs, both row-builds, `list_all_sources` cols) → 5 ingest tests
  → 6 analysis service (new `_drain_source_weights` helper + `signal_axis` weighting at `:2163` +
  genuine FR-4 replace of the `ScreenSymbols` config-blob read at `:1890-1901`) → 7 analysis tests →
  8 UI (`useSignalSources` drops the config-blob combine, inline-edit weight cell) → 9 UI e2e +
  C-12 fixture centralization → 10 config migration `016` (description-only UPDATE, F-01-safe) →
  11 docs drift fixes.
- Key codebase findings (grep-verified this session):
  - `SignalSource` fields 1–11 in use; **field 12 free, no `reserved` block** (`ingest.proto`).
  - Ingest last migration is `009_signal_dedup_keys` → `010` free; config last is `015_marketdata_finnhub`
    → `016` free. Both to be re-verified immediately before `/sdd-execute` (numbering-collision guard).
  - `insert_source` positional args: `config_param` is index 6, `active` is 7 — `reliability_weight`
    must be appended **after `active`** (index 8) to keep `test_signal_sources.py:277`'s
    `call_args[0][6]` assertion valid (design.md Open Risk confirmed against the real test).
  - Analysis `_drain_active_signals` (`servicer.py:2358`) calls `self._ingest.QuerySignals(…,
    metadata=propagation_meta)` — the header-propagation (C-03) pattern the new `ListSignalSources`
    call reuses; `propagation_meta` is already in scope at both `:1885` (ScreenSymbols) and
    `:2098-2100` (`_compute_opportunities`).
  - `analysis.signals.source_weights` is seeded by config migration `003` (dev+prod rows) and its
    only remaining truthful-description edit is a **new** UPDATE migration (F-01: never edit `003`).
  - Doc-drift sites confirmed: `docs/patterns/config-governance.md` (feature-097 "unchanged — stays
    the screener's") and `services/xstockstrat-analysis/CLAUDE.md:169,192` — both falsified by the
    FR-4 replace, fixed in Step 11 (same-PR teardown rule).
  - C-12: signal-source mock is inline at `e2e/mock-backend.ts:882-923`, `INVENTORY.md:60` "not yet
    centralized" — this is the second consumer, so Step 9 creates `e2e/fixtures/signalSources.ts`.

## Session 2026-08-15 — sdd-execute (sequential)

### Step 1 — proto: add reliability_weight field [done]
- Added `optional double reliability_weight = 12;` to `message SignalSource` in
  `packages/proto/ingest/v1/ingest.proto` (after `signals_fed = 11`, field 12 was free, no reserved
  block). Explicit presence (`optional`) so an omitted create-form field is distinguishable from an
  explicit 0.0.
- Files modified: `packages/proto/ingest/v1/ingest.proto`
- Verify: `buf lint` clean; `buf breaking` (run from repo root, `--against .git#ref=HEAD,subdir=packages/proto`
  since the fresh branch has no commits and HEAD==main-dev) exits 0 — additive field is non-breaking.
  Note: the spec's `--against .git#branch=<branch>` form failed with a git-remote read error on a
  brand-new local branch; the HEAD-ref form is the CI-equivalent baseline. Recorded as a benign
  verification-form substitution (not a deviation — same non-breaking result).
- Deviations: none.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh` (Docker codegen available). Diff limited to 8 files under
  `packages/proto/gen/{go,python,ts,ts/dist}/ingest/v1/` — the additive `reliability_weight`
  accessor only, no unrelated churn. Present in Go/Python/TS stubs.
- `uv lock --check` in ingest/analysis/indicators all pass (no grpcio floor bump this time — the
  feature-007 trap did not recur; no uv.lock changes to commit).
- Files modified: `packages/proto/gen/**` (generated)
- Deviations: none.

### Step 3 — migration: ingest signal_sources.reliability_weight column [done]
- Created `010_add_signal_source_reliability_weight.{up,down}.sql`: up `ADD COLUMN reliability_weight
  DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (reliability_weight BETWEEN 0 AND 1)`; down `DROP COLUMN`.
  `010` confirmed free (highest was `009_signal_dedup_keys`). CHECK mirrors `conviction` in `001`.
- Files modified: `services/xstockstrat-ingest/migrations/010_*.{up,down}.sql`
- Verify (offline, no DB): both files exist; `.up` ADD reversed by `.down` DROP. Live apply runs in CI.
- Deviations: none.

### Step 4 — service: ingest persist/return reliability_weight [done]
- `signal_sources.py`: `insert_source` gains required kwarg `reliability_weight` (trailing INSERT
  column/param $8, after `active` — preserves the config_json positional index 6); `update_source`
  gains it (SET `reliability_weight = $7`); `list_all_sources` cols string appends `reliability_weight`.
- `servicer.py`: added `reliability_weight` to `_SS_MASKABLE_PATHS`; register branch validates
  `HasField && [0,1]` (reject INVALID_ARGUMENT, mirrors conviction) then passes `weight` (1.0 default,
  never None on the NOT NULL column); update branch rejects out-of-range and computes `merged_weight`
  (masked+present → request value, else stored); both row builds (ManageSignalSource + ListSignalSources)
  carry `reliability_weight`. Validation kept inline (no shared module — scope guard, mirrors conviction).
- Files modified: `app/handlers/servicer.py`, `app/repositories/signal_sources.py`
- TDD: red (7 failing — unknown kwarg + missing validation) → green (190 passed, 76.39%). Deviations: none.
