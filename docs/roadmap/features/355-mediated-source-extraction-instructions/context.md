# Context: mediated-source-extraction-instructions

**Feature**: `docs/roadmap/features/355-mediated-source-extraction-instructions/feature.md`
**Product Spec**: `docs/roadmap/features/355-mediated-source-extraction-instructions/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/355-mediated-source-extraction-instructions/implementation-spec.md`

---

## Session 2026-11-17 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **User decisions (2026-11-17, asked before the story was written):**
  1. Prose home = first-class field (`extraction_instructions` column + additive proto field), not a
     `config_json` key.
  2. `extractor_module` = hide for mediated only. Proto field 4 and the DB column stay; non-mediated
     sources keep exposing it. Full removal and all-types hiding were offered and declined.
  3. Observed symptom = the consuming agent reads `extractor_module: app.extractors.noop` and
     concludes there is no work. "Fetches but ingests nothing" and "stalls at registration" were
     offered and not selected.
  4. Enforcement = required for new only. No backfill of existing rows; empty legacy rows fall back
     to the generic extraction guidance.
- Entered as a feature via `/sdd-story` (not `/sdd-triage`): it adds a contract field and changes
  tool shapes. Stated to the user as an assumption; not contradicted.
- Recon facts the story rests on: `extractor_module` is stored and echoed but never imported
  (ingest findings 2026-11-04); `list_signal_sources` already omits it, so today's exposure to
  agents is `manage_signal_source` (param, docstring, return) and `instantiate_template` (return).
- Open questions OQ-1..OQ-6 in product-spec.md go to `/sdd-design`; OQ-1 (seeded templates vs
  "required for new") is the one that can change scope.

## Session 2026-11-17 — sdd-review product-spec (round 1: FAIL, fixed)

- `spec-reviewer` failed criterion 9 (OQ-1..OQ-6 open). All six were put to the user and resolved:
  1. OQ-1 → seed prose into the four mediated system templates (FR-11).
  2. OQ-4 → literal generic prose + `extraction_instructions_is_default` (FR-6).
  3. OQ-5 → keep `app.extractors.noop`, written server-side (FR-3).
  4. OQ-2/3/6 → "Strict, larger cap": clearing rejected (FR-12), non-empty on non-mediated rejected
     (FR-13), 16,000-character cap (FR-14).
- My own assumptions (not asked): a supplied `extractor_module` on a mediated source is overridden,
  not rejected (the `/insights` edit form round-trips it); FR-6's two fields appear on every agent
  response for a mediated source, not just the list; whitespace-only counts as empty.
- A1b: none of the demoted/canceled features concerns signal sources — answered "no" without asking.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: `ccr-424ada30-29m2lv@ccbe424 ≡ origin/main-dev`.
- Round 2 failed criterion 8 on one defect: AC-2's two website rows lacked `scrape_selector` (and the
  authenticated row a credential), so they would have been rejected for the wrong reason. Fixed and
  checked against `validate_config_json` / `_validate_source_write` directly; not re-sent to the
  subagent a third time.
- Warnings folded in: update variants for FR-13/FR-14 (AC-21, AC-22), the "omitted" row in AC-2,
  whitespace on a legacy empty row (AC-23).
- Warnings carried to design: several `Given` steps name no source type; confirm the FR-11 seed
  migration against the `system` read-only rule (it guards RPC writes, not migrations — verify);
  re-derive proto field 15 and migration prefix 017 from the union of open branches.
- Overlap findings: no FAIL. WARN — `328-fix-agent-bearer-secret-orphan` (spec-ready) edits the same
  `manage_signal_source` / `instantiate_template` bodies in `services/xstockstrat-agent/app/tools.py`.
  Suggested order 328 → 355 (rebase-only). No `merge-order.md` row written — needs operator confirmation.
- Recommended design depth: full (proto change, DB migration, ≥2 services, warning-level overlap).

## Session 2026-11-17 — sdd-design (in progress)

- Mode: full. Tree: `ccr-424ada30-29m2lv@f8e7a99 ≡ origin/ccr-424ada30-29m2lv`. The harness-assigned
  `ccr-*` branch stands in for `feature/<slug>` in this session (pushes are restricted to it);
  `origin/main-dev` is an ancestor.
- Phase 0 Recon: wrote recon.md from four scouts (ingest+proto, agent, ui, scenario-recon). No
  existing `@AC-*` needs a CHANGE sign-off.
- Phase 1: round 1 proposer running. No debate.md yet.
- Round 1 (2026-11-17): proposer + adversary run; debate.md written. Both blocking objections
  (migration-rerun hardcoded ingest version; stale `list_signal_sources` docstring) verified in code
  and folded in (D-8, D-9).
- **Round-1 gate — user decisions:** (1) maskless update = plain replace-all, no "empty means
  omitted" exception (D-11, R-6); (2) `ManageTemplate` CREATE/UPDATE require prose on a mediated
  payload (D-12) — goes beyond FR-1..14, accepted; (3) no `merge-order.md` row for the 328 overlap;
  (4) run round 2.
