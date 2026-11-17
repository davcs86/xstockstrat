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
- Round 2 (2026-11-17): proposer + adversary run. No Floor breach, no register violation, no
  petitions; the decision table yields the right gRPC code for every `@AC-1..23`. Folded in D-13..D-19
  and R-7. **Proposer finding:** `extract_website_content` returns the whole response body —
  `scrape_selector` is never applied (`agent/app/tools.py:630-647,2713-2772`) — so seeded prose is
  written for raw Atom XML / list-page HTML.
- Still open after round 2: O-15 (seeded prose floods the signals watchlist; no `valid_until`; sell
  conviction sits on the alert threshold) — blocking, operator's call; O-20 (feed-structure claims
  unverified) — a live read-only fetch of the three staging sources is running to check them.
- **Live check (2026-11-17, read-only, staging `extract_website_content`):** all three website
  sources fetched without error (SEC `request_headers` are honored). 8-K feed: 72.5k chars, 100
  entries, title `8-K - <Company> (<CIK>) (Filer)` (and `8-K/A - …`), summary lists `Item N.NN: …`
  for every entry, tags `category/id/link/summary/title/updated`, no ticker anywhere. Form 4 feed:
  56k chars, 100 entries (56 Reporting / 44 Issuer) paired by `AccNo`, no transaction data, no
  ticker. PR Newswire: 201k chars, 25 anchors, each with time + headline + teaser; 8 of 25 carried
  an exchange:ticker in the teaser; hrefs relative. Robinhood Snacks (email) not checked.
- **Round-2 gate — user decisions:** watchlist signals from seeded prose expire after 7 days; 8-K
  scope narrow (sell 0.6 for 1.03/3.01/4.02, watchlist 0.3 for 1.01/2.01, skip the rest); Form 4
  cluster-only watchlist; **run another round** (round 3).
- Round 3 (2026-11-17, user-requested): proposer wrote the final texts; adversary re-traced
  `ingest_signal` and ingest dedup. Architecture unchanged; no Floor breach, no register violation.
  **Finding:** dedup is one slot per `(user, source, symbol, direction)`, re-won after the window or
  when `conviction`/`valid_until` differs, and ignores `valid_from` — the drafted prose's
  idempotence claim was wrong. Folded in D-22 (prose corrections) and D-23 (step refinements).
  Open for the gate: O-27 recency bound, O-28 PR Newswire / Snacks rules, O-29 Form 4 joint
  filings, O-30 `8-K/A` skipped + sell without `valid_until`.
- **Round-3 gate — user decisions:** recency bound 24 hours; PR Newswire + Robinhood Snacks
  watchlist-only (0.3, 7-day expiry, never buy/sell); Form 4 cluster = two or more separate filings
  by different reporting persons; `8-K/A` skipped, sell without `valid_until`, and the gRPC size
  limit as a recorded risk were shown and left as drafted; **run another round** (round 4).
- Round 4 (2026-11-17, user-requested): final texts written and attacked. No Floor breach, no
  register violation. Folded in D-25: `origin` on mediated `list_signal_sources` entries; default
  text conviction fixed to 0.3 / 0.6 / 0.9; "date and time of day" wording; website fallback covers
  a raising tool. Verified in code: dedup ignores `valid_from`; the 7-day watchlist expiry reaches
  only new / tracked SIGNAL entries (feature-281 behaviour). Open for the gate: O-39 Form 4 shared
  reporting person, O-40 default text's 7-day rule.
- **Round-4 gate — user decisions:** Form 4 cluster needs two filings with no reporting person in
  common; the default text carries the firm 7-day watchlist expiry; no server clock (R-8) — wording
  only.
- **Round-cap override (user sign-off, 2026-11-17):** at the round-4 gate the user answered
  "override rounds cap, continue until design is sound". The `/sdd-design` five-round hard cap is
  lifted for this run by explicit operator instruction. Rounds continue without an inter-round gate
  unless a product decision is needed, until an adversary pass returns no blocking objection; the
  approval gate (P-04) is then presented. The Floor (F-11) is not affected.
- Round 5 (2026-11-17): proposer audit found no blocking defect; adversary found one — a Form 4
  filing cut off at the tail of the latest-100 feed reads as a disjoint filing (false cluster).
  Fixed in the text (D-27). D-28 lists the spec amendments, D-29 the step refinements. Adversary:
  "with that clause fixed the design is APPROVABLE". Round 6 runs as a confirming pass under the
  user's continue-until-sound instruction.
- Round 6 (2026-11-17, confirming pass): proposer — all five texts compliant; adversary — **sound,
  no blocking objection**, no Floor breach, no register violation. Verified on the saved live Form 4
  body: newest-first ordering and one `<updated>` per accession number. Pending at closeout: write
  the D-28 amendments into product-spec.md / acceptance.feature. Approval gate presented next.

## Session 2026-11-17 — sdd-design

- Phase 0 Recon: wrote recon.md (services: ingest, agent, ui, proto; key reuse patterns: the
  `reliability_weight` end-to-end column pattern; the agent descriptor-parity tests).
- Phase 1 Grilling: 6 rounds (full; cap lifted by the user). Chosen approach: a first-class
  `extraction_instructions` field validated by ingest on every write path, `app.extractors.noop`
  forced server-side, agent tool-layer shaping that always returns prose (stored or a fixed default)
  and never `extractor_module` for mediated sources, prose seeded into the four system templates by
  one migration. Rejected: R-1..R-8 (optional field, version bump, shared constant, served prompt,
  second migration, maskless exception, SQL normalization, server clock).
- Constitution rules touched: C-01, C-07, C-08, C-09, C-10, C-12, C-13, C-14, C-15, C-16, C-18,
  P-01, P-02, P-04, P-06, F-01, F-04, F-11. Floor breaches: none in any round.
- **User approved the design** at the round-6 gate (2026-11-17). Status: spec-ready → design-approved.
- Spec amendments applied at approval (D-28): FR-3, FR-5, FR-6, FR-14 wording; new FR-15;
  `@AC-24..26` appended.

## Session 2026-11-17 — sdd-spec

- Generated implementation-spec.md with 11 steps. Status: design-approved → implementation-ready.
- Tree: `ccr-424ada30-29m2lv@9703dad ≡ origin/ccr-424ada30-29m2lv` (`origin/main-dev@f0ec13f` is an
  ancestor). `origin/feature/mediated-source-extraction-instructions` does not exist and the feature
  directory is not on `main-dev`, so the harness branch stood in for the feature branch, as in the
  sdd-design session. No file under ingest, agent, ui, `packages/proto`, `scripts/` or the MCP runbook
  changed since the recon tree `f8e7a99`.
- Discovery was done inline (no `codebase-discovery` scouts): recon.md covered the map; this session
  re-read every cited file for line numbers and the break radius.
- Step map: design S1 = Steps 1–4 (proto, proto-gen, agent client, agent parity tests — one unit);
  S2 = Step 5 (migration 017); S3 = Steps 6–7 (ingest); S4 = Steps 8–9 (agent); S5 = Steps 10–11 (UI).
- Key codebase findings:
  - `SignalSource` field 15 and ingest migration 017 are free on this tree, on `origin/main-dev` and
    on all 66 `origin/{feature,feature-steps,fix,hotfix}/*` heads (shallow-fetched for this check;
    highest `SignalSource` field on any of them is 14; none has an ingest migration ≥ 017).
    `claude/*` / `ccr-*` heads were not scanned.
  - `ruff` enforces 100 columns in the agent and the default text has lines up to 881 characters, so
    `_DEFAULT_EXTRACTION_INSTRUCTIONS` must be concatenated literals; Step 8 compares the constant
    with design.md by a one-off command (design.md is deleted at archive, so no committed test can).
  - `insert_source` / `update_source` are called directly only by `test_signal_sources.py:257,282,301`;
    every other test patches them with `AsyncMock` or a `**kw` fake, so the new required keyword
    breaks only those three calls and the four from-the-end positional assertions (`:274,276,316,317`).
  - `ui/src/app/config-ui/sources/page.tsx` has no write call; the two pages in Step 10 are the only
    UI signal-source write surfaces.
  - A `page.route` fixture cannot hold `BigInt` (the shared source fixtures do), so
    `SIGNAL_SOURCE_MEDIATED_LEGACY` is Connect-JSON shaped.
  - The runbook's `list_signal_sources` section documents source-health fields the tool does not
    return (`mcp-tools.md:149-152` vs `tools.py:561-571`). Existing drift: Step 8 rewrites only the
    return example; the paragraph is reported, not fixed.
- Spec-level choices (listed in the spec's "Assumptions"): validator message wording; the ingest
  constant `_MEDIATED_EXTRACTOR_MODULE`; the new keyword has no default; test module names; the UI
  over-cap message and `aria-label`; the concrete `@AC-15` rule (`non-mediated` within 200 characters
  of every `extractor_module`; none in the prompt file); offline `pglast` parse for the migration.
- Ledger: `insights.md` / `fails.md` were filtered to signal-source, template, agent-parity and
  migration-harness entries, not read end to end.
- Nothing was committed by this session.

## Open Threads

- [ ] Operator reviews the five instruction texts (design.md § Instruction texts) before the
  migration step merges — after that they change only by a new migration. — Step 5.
- [x] Re-derive proto field 15 and ingest migration prefix 017 from the union of open branches. —
  done by /sdd-spec 2026-11-17 (both free; `claude/*` / `ccr-*` heads not scanned). Re-check at
  `/sdd-execute` Step 1 and Step 5.
- [ ] Feature 328 overlap on `agent/app/tools.py` (no merge-order row; second merger rebases). — Step 8.
- [ ] Runbook guidance for hosts without a clock, and a pointer to the watchlist-expiry backfill
  runbook for entries the 7-day rule does not reach. — Step 8.
- [ ] Note in the Step 6 PR that admin-authored mediated templates without prose stop instantiating. — Step 6.
- [ ] State the lazy `""` → noop flip in the ingest findings row. — Step 6.
- [ ] Report the `list_signal_sources` runbook drift (source-health fields the tool does not return)
  through `/sdd-qa defect`. — after Step 8.

## Session 2026-11-17 — sdd-review impl-spec (advisory)

- Tree: `ccr-424ada30-29m2lv@638920e1 ≡ origin/ccr-424ada30-29m2lv` (merged `origin/main-dev@98d8d3d9`;
  the merge touched `agent/app/tools.py` and `docs/runbooks/mcp-tools.md` — a watchlist change that
  alters nothing Steps 3/8/9 rely on).
- Result: 1 failure, 5 warnings (advisory — did not block). No Floor risk. Every D-1..D-30 is
  reflected in a step; all `@AC-1..26` have a `**Covers**` home.
- Fixed in the spec before execution started (spec not yet in-progress): Step 8 stale citations
  (`_get_source`, Usage Patterns) and the Step 8 grep expectation, which the new `_is_mediated`
  prefix literal would have tripped (pattern now requires a type name after the prefix).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 2: `**Files**` uses wildcards for generated stubs (the generated-output convention) — [ ] unaddressed (accepted: generated output cannot be enumerated ahead of codegen)
  - Step 1: `buf breaking` against `feature/<slug>` — the branch does not exist; use the spec's `ref=HEAD` fallback (C-09) — [ ] unaddressed
  - Step 2: verification runs `./scripts/buf-gen.sh` rather than naming `buf lint` / `buf breaking` — [ ] unaddressed (Step 1 runs both)
- Overlap findings: **FAIL-level** with `323-fix-orphaned-code` (spec-ready): 323 deletes
  `agent/app/prompts/signal_extraction.md` (this feature edits it, Step 8) and
  `ingest/app/extractors/noop.py` (this feature stores the string `app.extractors.noop`; nothing
  imports it). Operator decision pending. WARN-level, disjoint functions/sections: 351, 354, 343,
  340, 314 on `agent/app/tools.py` / `client.py` / `docs/runbooks/mcp-tools.md`; 328 unchanged.
- **Operator decisions after the impl-spec review (2026-11-17):** (1) `signal_extraction.md` is
  edited as planned (323 may delete it later; that conflict resolves as a delete); (2) keep
  `app.extractors.noop` as the stored module for mediated sources; (3) `merge-order.md` row added:
  323 waits for 355 and rebases; (4) **execute all 11 steps** — one commit per step group on the PR
  branch `ccr-424ada30-29m2lv` (the session may push only there; no per-step branches or PRs),
  tests before each commit, stop at the first step that cannot pass or needs a decision.

## Session 2026-11-17 — sdd-execute (sequential)

- Mode entry + up-front confirmation: the operator's "Start, all steps" answer (above). Commits go
  directly to `ccr-424ada30-29m2lv` (PR #1567), the branch standing in for `feature/<slug>`.
  Checkpoint reports are printed without a gate — the operator chose "report at the end, stop only
  on a failing step or a decision".
- Tooling setup (steps 1–11): uv ✓ 0.11.32 · python ✓ 3.13 · ruff/pytest ✓ (uv sync) · pnpm ✓ 9.15.9 ·
  node 22.23 (repo pins 24; `tsc` and install pass) · buf ✗ on host → Docker `xstockstrat-codegen`
  image ⬇ (baseline regeneration reproduced the committed stubs: empty diff) · Chromium ✓
  pre-provisioned · no database.
- Baseline before any change: agent 765 passed, ingest 531 passed.

### Step 1 — proto: `extraction_instructions` on `SignalSource` [done]
- Added `string extraction_instructions = 15` (unit with Steps 2–4). `buf lint` OK; `buf breaking`
  OK against `ref=HEAD` (the spec's documented fallback — the feature branch ref does not exist).
- Files modified: `packages/proto/ingest/v1/ingest.proto`
- Deviations: none. TDD: N/A (proto).

### Step 2 — proto-gen: regenerate stubs [done]
- Regenerated in the pinned codegen image; only `ingest/v1` generated files changed (0 others).
  Ingest suite 531 passed; UI `tsc --noEmit` exit 0.
- Files modified: `packages/proto/gen/{go,python,ts,ts/dist}/ingest/v1/*`
- Deviations: none. TDD: N/A (proto-gen).

### Step 3 — service: agent client carries `extraction_instructions` [done]
- List projection and request builder carry the field; `_managed_source_to_dict` untouched (D-18).
- Files modified: `services/xstockstrat-agent/app/client.py`
- Deviations: none.

### Step 4 — test: agent descriptor-parity tests cover the new field [done]
- AC-6 (client half) red: both descriptor-parity assertions failed on the missing
  `extraction_instructions` (2 failed, 6 passed) → green: agent suite 766 passed, coverage 88.11%.
- Files modified: `services/xstockstrat-agent/tests/test_signal_source_projection.py`,
  `services/xstockstrat-agent/tests/test_signal_source_builder.py`
- Deviations: none.

### Step 5 — migration: ingest `017` — prose column and seeded template prose [done]
- Created the 017 pair (defaulted `extraction_instructions` column; guarded payload overlay on the
  four system templates, no version bump), `ingest-017.sql`, and bumped the clean ingest version in
  `migration-rerun.py` to 17. Offline checks: `pglast` parses 2 + 2 statements; the four seeded
  literals equal design.md's texts byte for byte; exactly one `*_seed_source_templates.up.sql`;
  scripts suite 491 passed, ruff clean. Down reverses up by inspection (key removed, column dropped).
- Files modified: `services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.{up,down}.sql`,
  `scripts/migration-assertions/ingest-017.sql`, `scripts/migration-rerun.py`
- Deviations: none. TDD: N/A (migration). Live apply / replay / refused-down / `ingest-017.sql` are
  proven by CI `migration-rerun` on the PR, not here.
