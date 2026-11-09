# Context: config-dead-rows-prune

**Feature**: `docs/roadmap/features/305-config-dead-rows-prune/feature.md`
**Product Spec**: `docs/roadmap/features/305-config-dead-rows-prune/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/305-config-dead-rows-prune/implementation-spec.md`

---

## Session 2026-11-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the story text in `296-fix-config-keys-contract/design.md` §1.
- Number `305` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh`.
- **Provenance:** slice **C** of the four-way split of feature 296 (operator decisions, 296 `context.md` rounds 2–5); `Type: feature`; the `/sdd-story` bug guard (`SKILL.md:274`) is not triggered (planned slice created on the operator's explicit direction). FR-9 and AC-7/13/14 of 296 moved here (296's IDs are retired, never reused).
- Operator decisions inherited: cap of 5 signed tuples (`ledger/stream.notify_enabled` 1 staging tuple; `analysis/opportunity.sparkline_bars` 2; `marketdata/alpaca.paper` 2; hashes dedupe across the staging DB and fresh); `platform/log_level` and `trading/risk.daily_loss_limit` re-owned to feature 306; baseline owner string for the three entries is `feature 305`.
- Ledger read (`fails.md`): 295 test-blast-radius entry recorded as a Known trap in Open Questions.

## Session 2026-11-09 — cross-feature note from 304 design
- Operator decision recorded in `304-config-keys-relative-consumers/context.md`: **305 owns removing** `services/xstockstrat-indicators/app/maintenance/config_allow296.py` and its test (the tool is valid only before migration R reached main-dev, which it has). 304 keeps both in place. Add the removal (and the `docs/runbooks/config-rollout.md` references to it) to this feature's spec.
- 304's design keeps `attribute()` list-receiver support unchanged (FR-4), so 305 FR-3's `registry.receivers` subscriber handling is not affected; trading's receiver becomes a single namespace plus a separate `platform` receiver, which keeps the (trading, platform) subscriber pair.

## Session 2026-11-09 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (tree: main-dev @ 885297f; PR #1479 / feature 304 not yet merged — docs-only phases first).
- First pass FAIL (criterion 9: 3 open `- [ ]` questions). Resolved into `## Resolved Decisions`; added **FR-6** (remove `services/xstockstrat-indicators/app/maintenance/config_allow296.py` + test + CLAUDE.md paragraph + runbook note — the known gap carried from 304, operator-assigned, confirmed unowned elsewhere) and **FR-7** (stale refs: 3 service CLAUDE.md rows, ledger durable `fix-config-keys-drift.feature` @AC-15 "still exists", `configServiceImpl.ts:141` bounds entry); AC-9/AC-10 added; AC-6 "five", AC-8 Given named.
- Warnings carried:
  - [ ] C-05: name each key's seed migration (ledger/marketdata 001/002, analysis 028) in the spec or design.
  - [ ] FR-7: design must disposition the `configServiceImpl.ts:141` bounds entry (remove vs keep; must not read as a reader against FR-3).
  - [ ] AC-10: ledger @AC-15 supersession is a **C-16 CHANGE needing operator sign-off**; check the `@superseded-by-*` tag convention and record sign-off here.
- Overlap findings: no duplicate keys; baseline entries disjoint from 306. **Gap (needs operator confirmation, not written):** no `merge-order.md` row pairs 305↔306 (shared `check-config-wiring.mjs`, `config-wiring.test.mjs`, `config-wiring.json`) and nobody claims config migration 046 (305, 306, 280 all draw from it).
- Execute-time dependency: the Loki evidence export (FR-4) is an operator action; the sequential run must pause for it.
- Recommended design depth: full (config migration deleting prod/staging rows; overlap findings).

## Session 2026-11-09 — sdd-design (in progress)

- Phase 0 recon written (`recon.md`, tree feature/config-dead-rows-prune@df3fa1b). Full mode.
- Round 1 synthesis (proposer → adversary, no Floor breach): shape accepted (latched signed delete, no data-dependent RAISE, one atomic step for migration + baseline + stored regen + FR-4 test, `membership()` unchanged). Carried into round 2: (1) FR-4 test must evaluate the *frozen* subscriber set committed with the evidence, not live `registry.receivers`; (2) down must mirror `041_*.down.sql` (report-row keyed, `updated_by`/`update_reason` set, explicit conflict target) instead of a time-window heuristic; (3) assert the down in `migration-rerun.sh`; (4) post-deploy probe of `config_keys_report_296` on every DB, result in `signoff.md`; (5) drop the table lock (single-statement delete+snapshot) so lock exhaustion cannot leave config dirty; (6) number-independent actor so a merge-time renumber does not edit content; (7) pin LogQL + environment selector; (8) halt rule for any `kept:*` verdict; (9) operator authors the sign-off commit; (10) C-16 tag convention for the ledger @AC-15 split; (11) production sha256s are already in committed inventories (proposer's "strongest risk" retired).
- Operator gate at round 1: none offered (full mode mandates round 2; no decision to make).

### Operator decisions at design round-2 gate (AskUserQuestion, 2026-11-09)

- **Evidence form**: metric queries (aggregated coverage per (service, ns) per 6 h bin + one instant read-hit query for the 3 keys, both spellings), not the line-level export.
- **C-16 CHANGE sign-off — GRANTED**: ledger `fix-config-keys-drift.feature` 295 @AC-15 Then #1 ("still exists") and the suite Feature description sentence ("…without deleting dead rows") are superseded by feature 305; expressed as a supersession header comment (no `@superseded-by-*` tag convention); Thens #2/#3 (read-key/read-coverage logging) PRESERVED; 184 @AC-1 and 296 @AC-21 stay PRESERVE. Operator: davcs86 (AskUserQuestion answer) — 2026-11-09.
- **Spec amendments GRANTED** (P-03): FR-3 third argument = frozen subscriber set; FR-4 evidence is metric-form and carries subscriber rows; AC-10 Then reworded to the supersession header; AC-3 uses short name `notify`. IDs unchanged (C-15).
- **Design gate**: operator chose *Run round 3* (not approve). Round-2 adversary changes to carry: P2 = rolled-back rehearsal of the exact final file on DO dev/prod/both homelabs + file sha; pass 2d applies 305 down/up files by direct psql (no 306/280 downs) + propose (not write) a 305↔306↔280 merge-order row; probe asserts marker present / 0 live rows for the 5 tuples / 0 per-user rows for the 3 keys (SetConfig is an upsert, so the "waits and finds row gone" claim is wrong); S4 bounds test red-first (SetConfig of 10000 reaches INSERT); new append-only 305 entry in config-governance (not edits of :290/:395/:528); partially-resolved notes on the 3 open defect reports; indicators coverage measured in the FR-6 step; pin details (marker lines in the block, `snapshot_at DESC`, no `-- Migration: NNN` header, one asserted replay, assertion/test file rename on renumber); S2 verification path (CI-only harness; blocked-until-sha rather than red branches).

## Session 2026-11-09 — merged origin/main-dev (79abf13)

- Operator asked to merge main-dev. PR #1479 (feature 304) and #1488 had landed; merge conflict only in this `context.md` (kept both append-only blocks). Branch is now `701c81b` ≡ main-dev + 305 docs.
- Consequences recorded in `recon.md` § Post-304 refresh: `prefixed-read` kind gone, baseline = 5 `seeded-unread`, `check-config-wiring.mjs` line numbers drifted (cite symbols), trading receiver shape changed, `subscribersOf()` to be re-derived from the merged registry. The round-3 proposer started before the merge; the round-3 adversary must re-verify its path:line claims against the merged tree.

### Operator decisions at design round-3 gate (AskUserQuestion, 2026-11-09)

- **Second C-16 CHANGE (304 @AC-12 Then #3 + binding comment (c)) — NOT signed off.** Consequence (re-scope): the `ledger` / `stream.notify_enabled` tuple is dropped from the signed set → **4 tuples, 2 keys** (`analysis` / `opportunity.sparkline_bars` staging+production; `marketdata` / `alpaca.paper` staging+production). No ledger durable scenario changes. The earlier grant for 295 @AC-15 / suite description (design round-2 gate) is therefore **unused** (the CHANGE does not happen); no supersession header is written. FR-7 / AC-1 / AC-3 / AC-5 / AC-6 / AC-7 / AC-8 / AC-10 / Problem Statement / Affected Services / Consumer Surface / Config Key Changes rewritten accordingly.
- **Spec amendments GRANTED**: FR-1 (global rows only; snapshot = DELETE…RETURNING in one statement; per-user rows probed, never deleted) and FR-4 (superset read-hit export; frozen subscriber set limited to receivers on signed namespaces; per-(service, ns) positive control for watch/list subscribers, ui exempt).
- **Positive control chosen**: `keys=` cross-check — distinct canonical read-hit keys ≥ `keys=N` of that pair's last coverage line in the window.
- **Design gate**: operator chose *Run round 4*.
- **Open for the next gate**: who owns the surviving `seeded-unread` baseline entry for `ledger` / `stream.notify_enabled` (currently `feature 305`, which would never close it). Recommended: re-own to `feature 306` (precedent: `trading` / `risk.daily_loss_limit`, "documented future key; deletion is a product decision"); needs a one-line edit of 306's product spec and the baseline owner string. Not done unilaterally.
- Adversary round-3 mechanical amendments adopted for design.md (no operator decision needed): O-2 offline S2 verification (hand-derived stored JSON + `storedInputsSha256`, no local DB, no step branches; integration-PR CI is the live check); O-3 marker INSERT gated on the latch; O-6 down `ORDER BY snapshot_at ASC`; O-7 W0 on a 6 h UTC boundary and a `service_name=~` restriction; O-8 P3 = post-launch checklist item, integration PR draft until the file-sha is pinned; O-9 `config-NNN.sql` counts scoped to the current marker's run_at; O-10 name the seed migrations (alpaca.paper 001/002, sparkline_bars 028); O-5 `baseline 2` non-empty assertion hazard (`config-wiring.test.mjs:593`) when 306 also empties the baseline — in S2 Files, and in the proposed 305↔306↔280 merge-order row (NOT written).

## Session 2026-11-09 — sdd-design (complete)

- Phase 0 Recon: wrote recon.md (services: config + gate tooling, indicators, ledger/analysis/marketdata docs; key reuse: `041`/`044` signed-delete+audit+report+notify idioms, `relativeKeysMigration.test.ts` sha-pin test, `canonical()`).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: latched single-statement signed-delete migration (4 tuples / 2 keys), metric-query evidence with frozen subscriber set + `keys=` control, one atomic S2 with offline verification, operator-authored P1/P2 commits, draft integration PR until the file-sha is pinned. Rejected: lock loop, line-level export, permanent frozen==live test, `membership()` rewrite, local-DB verification, new CI sign-off check (see design.md).
- Constitution rules touched: F-01, F-04, F-05, F-08, C-05, C-07, C-08, C-10, C-11, C-14, C-15, C-16, C-18, P-03, P-06. Floor breaches: none in any round.
- Operator decisions (all via AskUserQuestion, 2026-11-09, davcs86): metric evidence; `keys=` control; 295 @AC-15 CHANGE signed (now unused); 304 @AC-12 CHANGE **declined** → `ledger/stream.notify_enabled` kept, 4 tuples; FR-1/FR-3/FR-4/AC-3/AC-7/AC-8/AC-10 amendments; baseline entry re-owned to feature 306 (306 docs edited, docs-only); ledger comment-only parenthetical fix allowed; bounds entry removal confirmed; design approved after round 4.
- Status: spec-ready → design-approved. Proposed (NOT written) merge-order row 305 ↔ 306 ↔ 280 is in design.md.
- Carried open threads: false-zero read-hit export (P1 pre-checks); sha drift (P2/S5); indicators coverage (S3); Loki retention (P1); 306 must take the kept ledger entry; dependency note: PR #1479 (304) merged mid-design (main-dev@79abf13) and recon missed 304 @AC-12 until round 3 — see ledger.
