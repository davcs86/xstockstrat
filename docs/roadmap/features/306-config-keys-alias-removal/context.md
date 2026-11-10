# Context: config-keys-alias-removal

**Feature**: `docs/roadmap/features/306-config-keys-alias-removal/feature.md`
**Product Spec**: `docs/roadmap/features/306-config-keys-alias-removal/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/306-config-keys-alias-removal/implementation-spec.md`

---

## Session 2026-11-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the story text in `296-fix-config-keys-contract/design.md` §1.
- Number `306` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh`.
- **Provenance:** slice **D** of the four-way split of feature 296 (operator decisions, 296 `context.md` rounds 2–5); `Type: feature`; the `/sdd-story` bug guard (`SKILL.md:274`) is not triggered (planned slice created on the operator's explicit direction). This is 296's FR-8 / AC-12 "named follow-up": its product spec removes the alias, the write tolerance and the internal-caller exception and declares `Depends on` feature 296 (and 304).
- Baseline entries re-owned here (operator decision, 296 round 4/5): `platform` / `log_level` (UI reader, never provably dead) and `trading` / `risk.daily_loss_limit` (documented future key — a product decision). Owner string `feature 306`.
- Ledger read (`fails.md`): 295 test-blast-radius entry recorded as a Known trap in Open Questions.

## Session 2026-11-09 — cross-feature note from 305 design (docs-only)

- Operator decision recorded in `305-config-dead-rows-prune/context.md` (design gate, AskUserQuestion, davcs86, 2026-11-09): the `seeded-unread` baseline entry `ledger` / `stream.notify_enabled` is **re-owned from feature 305 to this feature**. 305 keeps the row (the operator declined the C-16 CHANGE of 295 @AC-15 / 304 @AC-12), so 305 can never close the entry.
- Edited here (docs-only, before this feature's `/sdd-review`): FR-6 (two → three entries), the Open Questions line, `acceptance.feature` @AC-6 Given/Then, `feature.md` summary. No code or baseline change; the owner string in `scripts/config-wiring.json` flips to `feature 306` in 305's step S2.
- Ordering: 305 merges before FR-6 closes here (otherwise 305's AC-8/AC-10 "still present / still exists" would go red). A delete of this row is a C-16 CHANGE of 295 @AC-15 and 304 @AC-12 and needs fresh operator sign-off. `membership()`'s `/^feature (305|306)\b/` regex and the baseline-3 `/^feature (305|306)$/` exemption already cover 306; once 305 has no entries the `305` branch is live only through the gate-7 fixture — a cleanup that fits this feature (it edits the same files).

## Session 2026-11-10 — operator decisions at /sdd-review product-spec (first pass FAIL, fixes applied)

- First `/sdd-review product-spec` pass: FAIL on criterion 9 (3 open questions) and criterion 8 (@AC-5 malformed). No lifecycle change.
- Operator decisions (AskUserQuestion, davcs86, 2026-11-10): FR-6 = **delete all three rows** (`platform`/`log_level`, `trading`/`risk.daily_loss_limit`, `ledger`/`stream.notify_enabled`). Deleting `stream.notify_enabled` is a C-16 CHANGE of 295 @AC-15 and 304 @AC-12: the operator chose delete, but the exact scenario edits still need a fresh sign-off before any step touches those scenarios. `platform`/`log_level` has a UI surface to check at design.
- Spec fixes applied: @AC-5/@AC-1/@AC-2 rewritten as observable outcomes, @AC-6 extended, FR-3 now owns the WARN-free evidence (@AC-7), FR-1/FR-5 made testable, anchors refreshed, deletion-migration strategy stated (next free config number, 047 as of today, shared with 280), the done ledger-parenthetical task dropped, open questions closed or moved to design.
- Overlap note (feature-overlap): merge-order row 305/306/280 does not yet name `dormantAlias.test.ts` or the `047` owner; not edited (operator decision pending).

## Session 2026-11-10 — sdd-review product-spec (second pass)

- Product spec approved. Status: draft → spec-ready. Warnings: UI surface for the deleted `platform`/`log_level` row (design); update the trading `CLAUDE.md` `risk.daily_loss_limit` row (added to FR-5's file list); anchors refreshed (`tools.py:1833-1838`, `trading.go:2270-2277`); poller exception sites `configServiceImpl.ts:703-710,:751,:786` and `canonical` still used at `:183,:189` to be reconciled at design/spec.
- Overlap findings: no key/proto collision; config migration `047` is contended with 280 (first to merge takes it); `dormantAlias.test.ts` and the owner-string hand-off are not named in the merge-order row (operator decision pending); 304 is `code-completed`, so the earliest-start gate is unmet (execute precondition).
- Recommended design depth: full (3 services, reversible data migration, C-16 CHANGE, shared gate files).

## Session 2026-11-10 — sdd-design: C-16 batch sign-off (operator, verbatim) and gate decisions

- **C-16 batch sign-off** (AskUserQuestion at the design gate, operator davcs86, 2026-11-10). Question: "Do you sign off on ALL of these changes to durable scenarios, recorded verbatim with your handle/date in context.md? REAL EDITS: 295 @AC-15 and 304 @AC-12 (drop the 'stream.notify_enabled still exists/kept' Given/Then; read-key recording stays). DATED READ-NOTES (scenario text untouched): 296 @AC-3/@AC-4/@AC-5 (alias retired), 295 @AC-34 (+amend the existing line-11/13 notes with a feature-306 clause), 241 @AC-2 and 294 @AC-54 and 295 @AC-25 (request key becomes 'trading_state'; these files say do-not-edit, so the note is a hand edit you are authorising), platform.feature 278 @AC-1, 278 @AC-7, 296 @AC-24 Then 1, 295 @AC-19 (:1440), and 305 @AC-1 scoped CHANGE (306 deletes three operator-decided rows by key, without read-evidence/sha)." **Answer: "Sign off on all (Recommended)".**
- Same gate, second question (design approval): the operator chose **"Run another round"** (no steering note). Round 3 follows; design.md is not yet written; status stays `spec-ready`.
- Operator decision earlier (2026-11-10): predicate delete (no sha) with 305 @AC-1 handled as the scoped CHANGE above; FR-6 = delete all three rows.
- Round 1 and 2 adversary: no Floor breach. Resolved so far: 305 @AC-1 (sign-off), read-notes for 241/294/295 @AC-25, @AC-5/@AC-6 rewording, evidence = zero-count + positive control + trading image ancestry, rel() both sides, real-data dry-run (5 rows on dev/fresh DB, <=6 by index), slug-named assertion file. Open from round 2 (carried into round 3): seed-loop expression at check-config-wiring.mjs:611-621 must keep 296 @AC-6/@AC-22 semantics; unit B size and its offline verification (F-05 residual: CI on the draft PR is the proof); fake `perUserSecrets.test.ts:73-94` fixed rather than production SQL; report global-secret rows as out-of-scope.

## Session 2026-11-10 — sdd-design (approved)

- Phase 0 Recon: wrote recon.md (config, trading, agent, ui, tooling, ledger rules; key reuse: 305's 046 CTE migration + pass 2d + sha pin).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: five units (Step0 evidence; A server; C gate; D agent; B predicate-delete migration + baseline, atomic, CI-verified; E docs + signed C-16). Rejected: sha allowlist, wholesale `resyncAll` removal, `SELECT is_secret` probes, seeded-unread for prefixed-only reads.
- Constitution rules touched: C-16, C-15, F-01, F-05, F-04, C-07, C-05, C-18, P-03, P-06. Floor breaches: none (3 adversary passes).
- Operator approval at the gate: AskUserQuestion "Approve this design" (davcs86, 2026-11-10); C-16 batch sign-off recorded above.
- Corrected in recon after a code check: `migration-rerun.sh:671-677` does not break (044 emits the marker NOTIFY).
- Status: spec-ready → design-approved.

## Session 2026-11-10 — sdd-spec

- Generated implementation-spec.md with 13 steps. Status → implementation-ready.
- Tree: feature/config-keys-alias-removal@17cc0ea ≡ origin/feature/config-keys-alias-removal (merged with origin/main-dev). Every path:line in the spec was re-verified on it; recon.md was stamped at cce1aa3.
- Key codebase findings:
  - `setConfigAuthz.test.ts:179` (294 @AC-54) sends the prefixed `platform.trading_state` and expects PERMISSION_DENIED; design.md's test list omits it. After FR-3 it is INVALID_ARGUMENT before authz, so Step 3 re-keys it to `trading_state`.
  - Adding the migration changes `inputs_sha256` (`storedInputsSha256` hashes every file under `services/xstockstrat-config/migrations`), so migration + stored-set regen + baseline removal are one atomic unit (Steps 8-10). `config-wiring-stored.json` round-trips byte-exact through `JSON.stringify(…, null, 4) + '\n'`, so an offline regeneration is possible; CI `config-wiring-stored` is the proof.
  - Trading needs no code or test change: the poller already sends `trading_state` (`trading.go:2270-2277`) and its tests are relative. The product spec's "test constants" change is Not found. `docs/runbooks/mcp-tools.md` has no alias text, so FR-4's parity edit is empty.
  - `acceptance.feature` @AC-5 ("ordinary unseeded read") conflicts with design.md's `join 11` (`prefixed-read`); @AC-7 lacks the positive-control and ancestry evidence design.md requires. Both are amended in-step (Steps 5 and 1), IDs unchanged. @AC-6 conflicts with nothing found.
  - Step 11 needs the operator rehearsal on DO dev; its "production" count is the `environment='production'` rows inside the DO dev database (305 precedent: DO production and homelab have no running instance). Confirm that reading before writing the sign-off section.

## Session 2026-11-10 — sdd-review impl-spec (advisory), pass 1

- Result: 0 failures, 4 warnings, 5 notes (advisory — did not block). Overlap: no FAIL-level collision (047 free; 280 and 299 have no spec, rebase-only on `tools.py`).
- Unresolved ✗ / ⚠ carried into execution (all four warnings fixed in the spec the same session; re-review pending):
  - Step 3: [x] test asserts `/canonicalis/i` (not the literal) so the Verification grep stays empty; `dormantAlias.test.ts` header and `MARKER_PROBE` cleanup added (C-08).
  - Step 5: [x] design note "@AC-22 scoped to export.max_window_days" resolved — no test carries @AC-22 in `config-wiring.test.mjs`; the guarantee is pinned by `join 9 @AC-6` (C-15).
  - Step 9: [x] literal count 5 removed from `config-alias-removal-rows.sql`; asserts report = snapshot = audit with 1 ≤ n ≤ 6 (P-06).
  - Step 11: [x] marked operator-gated in Status and Step Dependencies so `/sdd-execute all` halts; "production/staging counts" meaning (DO dev `environment` values) to be confirmed with the operator before writing the section (P-03).
- Notes folded in: Step 2/3 ordering assertion (`prefixedKeyRejection` before `lookupScalarBounds`; `setConfigScalarBounds.test.ts` added to Step 3 Files); Step 4 known consequence (prefixed-stored row read relative loses type/default checks, fixture-only); Step 12 grep for the operator's delete decision; Step 8 bytes are final only after Step 11's sha.
- Merge-order row 31 (306 waits on 296/304) flipped Resolved → Yes.

## Session 2026-11-10 — sdd-review impl-spec (advisory), pass 2

- Result: 0 failures, 2 distinct warnings (Step 3), 3 notes. Prior warnings Step 5, Step 9, Step 11 resolved.
- Fixed the same session: Step 3 [x] verification grep no longer contradicts the dormantAlias test (token `marker_active` scoped to `src/grpc`); Step 3 [x] instruction 6a (redundant, green-before-red) and the `setConfigScalarBounds.test.ts` Files entry removed, existing guard `:311-320` cited. Notes: Step 5 `:307` left alone; Step 1 greps are satisfiable only after Step 1 runs (by design).

## Session 2026-11-10 — sdd-review impl-spec (advisory), pass 3

- Result: 0 failures, 1 warning, 1 note. Step 3 greps verified correct.
- Fixed the same session: Step 13 [x] instruction 2 and the evidence now name CONFIG-8 (`services/xstockstrat-config/docs/context-constitution.md:25`, an `until feature 306` clause) so the step's negative grep passes; Step 3 [x] the `setConfigSpelling.test.ts:41` fake comment is updated to `key = $n` only.

## Session 2026-11-10 — sdd-review impl-spec (advisory), pass 4 — FINAL

- Result: **0 failures, 0 warnings** (2 notes folded in: Step 10 `baseline 3` retitle; Step 12 first Verification grep is now a real negative check `! grep -E "still exists|still kept"`). Overlap: no FAIL-level collision.
- Unresolved ✗ / ⚠ carried into execution: none from the review. Execution gates that remain (not review findings): Step 1 (@AC-7 evidence: Loki zero-count + positive control + trading image ancestry; 304 is launched) blocks Steps 2-13; Step 11 is operator-gated (DO dev rehearsal counts; confirm "production/staging" = `environment` values on DO dev); Unit B (Steps 8-10) is proven only by CI on the draft integration PR.

## Session 2026-11-10 — @AC-7 evidence pulled (Step 1 data; Step 1 itself not yet executed)

Pulled by the agent at the operator's request ("pull the Loki data"), read-only. Datasource `grafanacloud-logs`; `service_name` values seen: agent, analysis, config, identity, indicators, ingest, ledger, marketdata, notify, portfolio, trading, ui; `deployment_environment` values over 72h: `staging` only (no `production` stream).
- Window: 20h ending 2026-11-10T06:10:00Z, i.e. 2026-11-09T10:10Z → 2026-11-10T06:10Z. Context: 304's trading change merged 2026-11-09 01:11 -0800 (79abf13); the staging app's current deployment `fa3cc1a2-c38a-4000-8532-b7eae19ef8c6` was created 2026-11-10T03:42Z (cause "app spec updated", phase ACTIVE), so the window spans at least one full staging deploy cycle after 304 and the deploy that carried 305.
- (a) Zero-count: `sum(count_over_time({deployment_environment="staging", service_name="config"} |= "SetConfig canonicalised internal-caller key" [20h]))` at 2026-11-10T06:10:00Z → **no samples (0)**. Case-insensitive `|~ "(?i)canonicalis"` over `service_name=~"config|trading"` → no samples (0).
- (b) Positive control, same selector and window: `... |= "GetSecret served" [20h]` → **28900** (> 0; selector and retention are live).
- (c) Ancestry: staging trading image tag `44ce639` (DO deployment spec, `davcs86/xstockstrat/xstockstrat-trading`); `git merge-base --is-ancestor 79abf13 44ce639` → **exit 0**.
- (d) At `44ce639`, `services/xstockstrat-trading/internal/service/trading.go:2270-2277` sends `Namespace: "platform"`, `Key: "trading_state"` (caller `trading-reconciliation-poller`).
- Production: **no instance** — DigitalOcean lists a single app (`xstockstrat-staging`) and Loki has no `production` stream (operator: no production running, 2026-11-10); (a)/(c) for production are therefore N/A.
- Caveats (P-03): the WARN fires only in a systemic escalation, so (a) is weak by itself; (c)+(d) carry the weight. The trading service logged no lines matching `reconciliation|systemic|escalat|trading_state` in the window (the poller is quiet when healthy); `loop tick ok` lines are present for other loops (e.g. `order_intent_sweeper`, `fill_poller`). "Full staging release" is interpreted as the window above (first staging deploy after the 304 merge through the current deploy that carries 305) — confirm that reading before Step 1 is marked done.
- Not done: `acceptance.feature` @AC-7 wording amendment, the Step 1 status flip, and Steps 2-13 (execution is gated on `/sdd-execute` confirmation).

## Session 2026-11-10 — sdd-execute Step 1 DONE

- Operator confirmed ("yes, mark it as done", 2026-11-10) the reading of "full staging release" (20h window ending 2026-11-10T06:10Z, through the staging deploy that carries 305) and accepted the evidence above (a)-(d). Production N/A (no instance).
- Edits: `acceptance.feature` @AC-7 Then amended (positive control + ancestry added; ID and tags unchanged); Step 1 Status `pending` → `done` (only the Status line); `feature.md` history row and Next Action; `status.md` = `in-progress`.
- Steps 2-13 remain `pending`; Step 11 operator-gated.

## Session 2026-11-10 — sdd-execute (sequential, unattended per operator) — Steps 2+3

- Mode: sequential; operator ("Yes. That was part of the unattended ask") authorised the run; checkpoint reports are printed but not gated. Tooling: node v22.23.4 (CI uses 24; suite green on 22), pnpm 9.15.9, uv 0.11.32 + agent `uv sync --extra dev` ✓.
- ### Steps 2+3 — Remove the alias, tolerance and poller exception; config tests [done] (atomic unit)
  - Red (before implementation, new/updated tests vs baseline): 339 tests, 314 pass, **25 fail** (log `scratchpad/306-step3-red.log`) — snapshot still alias-doubled, marker NOTIFY still resyncs, prefixed poller key still canonicalised, `key IN` probe trips the throwing fakes. Green (after): **339/339**; `c8 check-coverage --lines 40` exit 0; `pnpm run lint` 0 errors.
  - Removed: `MARKER_ACTIVE_SQL` (+3 uses), `withLegacyAliases`, `markerActive` plumbing, the marker branch of `onNotification` (`resyncAll` kept for reconnect), the poller exception, `altSpelling` (server + `authz.ts`), the ambiguity branch, `writeKey`; probes are exact `key = $n` (select list unchanged); `canonical` stays exported for `prefixedKeyRejection` only; grant re-keyed to `trading_state` with `===`.
  - Tests: `dormantAlias` inverted (marker cases kept, writer scan kept), `contentVersion` (+marker NOTIFY no-reload), `changeFeedLiveness`/`contentVersion` fakes drop `marker_active`, `setConfigSpelling` (@AC-2/@AC-3, throwing `key IN` fake, @AC-34 cases removed), `internalCallerSetConfig`, `internalCallerAuthz` (+prefixed denial), `setConfigAuthz.test.ts:179` (294 @AC-54 key → `trading_state`), `perUserSecrets` fake answers the new probe and throws on unrecognised `config_values` SQL.
  - Deviations: test titles/messages avoid the word "canonicalisation" because the node reporter prints titles to the mocked stdout the tests capture (a test asserting no `/canonicalis/i` line matched its own title). No spec change.
  - Verification greps (Steps 2/3) empty. Files modified: `services/xstockstrat-config/src/grpc/{configServiceImpl,authz}.ts` and the eight test files above.

### Steps 4+5 — Remove alt/partnerOf/form-mismatch from the wiring gate; gate tests [done] (atomic unit)
- Red (tests first vs the old gate): `node --test scripts/config-wiring.test.mjs` 75 tests, 70 pass, **5 fail** (join 1, join 9 @AC-6, the three new join 11 tests). Green: **75/75**; `--final` exit 0; `--doc-check` exit 0; `! grep -E "form-mismatch|partnerOf|alt\(" scripts/check-config-wiring.mjs` clean.
- Gate: one `rel`/`relId` helper replaces `alt`/`partnerOf`; the relative-seed hoist and the prefixed-only-read suppression are kept (a relative seed read only prefixed emits `prefixed-read` only); secrets/catalog lookups normalise both sides; prefix-catalog branch compares raw keys; `form-mismatch` is gone from `BASELINE_KINDS`, `findingLine`, `namesOf`. `canonical` and `membership()` untouched.
- Tests: join 1 → 3 lines (seeded-unread + prefixed-read + read-unseeded); join 9 @AC-6 → seeded-unread + reader_c read-unseeded + 2 prefixed-reads + REPORTED line, exactly one `max_window_days` prefixed-read (296 @AC-22); `form-mismatch` baseline entries removed from the two @AC-7 tests; `baseline 2` kind list; new `join 11` pure test (relative seed + prefixed reader → exactly `['prefixed-read']`), `validateState` rejects `form-mismatch`, source assertion. `SWEEP_277`/`baseline 3`/`dead 3` untouched (Step 10).
- `acceptance.feature` @AC-5 Then amended per design (ID/tags unchanged). Known consequence (Step 4 note): a prefixed-stored row read relative loses type/default checks (fixture-only; the 045 CHECK forbids prefixed stored keys).
- Files: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.test.mjs`, `acceptance.feature`. Deviations: none.

### Steps 6+7 — Remove the alias filter from the agent's get_config; agent test [done] (atomic unit)
- Red: `tests/test_config_tools.py::TestConfigKeyFqn::test_get_config_returns_the_servers_values_unfiltered` failed against the old filter (1 failed, 46 passed). Green: file passes; full agent suite **740 passed**, coverage **87.93%** (gate 40); `ruff check` and `ruff format --check` clean.
- `app/tools.py`: the prefixed-twin filter after the secret redaction is deleted (redaction kept). Tests: the "drops the alias" case now asserts the server's dict is returned unfiltered; the lone-prefixed case asserts exact equality; class docstring updated. `docs/runbooks/mcp-tools.md` has no alias text — no edit (spec). Consumer surface (C-14, Agent): `get_config` returns exactly the server's values.
- Files: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/tests/test_config_tools.py`. Deviations: none.

### Steps 8+9+10 — Alias-removal row migration, rerun pass 2e + slug-named assertion, baseline/stored-set close-out [done] (atomic unit B)
- Step 8: `services/xstockstrat-config/migrations/047_config_alias_removal_rows.{up,down}.sql` (046-shaped single CTE statement; predicate delete of global non-secret rows of `platform/log_level`, `trading/risk.daily_loss_limit`, `ledger/stream.notify_enabled` in every environment; latch marker `alias_removal_rows_306`; snapshot, audit as `system:config-migration-feature-306`, report actions `alias-removal-row-deleted` and latch-gated `alias-removal-out-of-scope`; per-(ns,env) notify; down scoped to its own marker and action). Offline verification only (no database started): both files exist, no `BEGIN/COMMIT/ROLLBACK`, no numbered actor, `pglast` (the real PostgreSQL grammar, scratch venv) parses each as one statement, and the down inverts the up's rows, marker and notify. **The file bytes are final only after Step 11's sha is recorded.**
- Step 9: `scripts/migration-rerun.sh` — slug-glob discovery (`a_base`, `A_DOWN`, `a_actor`, `a_block`, `a_pairs`), a latched-replay no-op check, and pass 2e (down restores exactly the deleted rows and audits the restore, rows outside the target keys and 305's rows untouched; a rolled-back per-user sub-test; re-up under a later marker); `scripts/migration-assertions/config-alias-removal-rows.sql` (slug-named, scoped to the current marker's `set_at`, report = snapshot = audit with 1 ≤ n ≤ 6, no literal count); `config-046.sql` AC-10 existence half dropped (audit-never half kept). `bash -n`, `shellcheck`, `shfmt -d -i 2` clean; both SQL assertion files parse (`pglast`). Proven only by CI `migration-rerun` on the draft integration PR (F-05).
- Step 10: `scripts/config-wiring.json` — the three `feature 306` entries removed (`broker.paper` kept); `scripts/config-wiring-stored.json` — the 5 rows removed (ledger notify staging; log_level and daily_loss_limit staging+production) and `inputs_sha256` = `637efed4…ed06` (offline byte-exact regeneration; CI `config-wiring-stored` is the proof); `dead 3` rewritten (zero entries for the three keys, no `feature 306` owner, `--final` 0); `baseline 3` retitled and its 305/306 exemption dropped.
- Red (Step 10): against the previous baseline file the new tests fail (`dead 3`, `baseline 3`, and `baseline 1` — 3 failures); green: gate suite **75/75**, `--final` 0, `--doc-check` 0, no `feature 306` text in `scripts/config-wiring.json`.
- Deviations: none from the spec. Files: the two migration files, `scripts/migration-rerun.sh`, `scripts/migration-assertions/{config-alias-removal-rows,config-046}.sql`, `scripts/config-wiring.json`, `scripts/config-wiring-stored.json`, `scripts/config-wiring.test.mjs`.
- Open (carried): Steps 8-10 are proven only by CI on the draft integration PR; the migration SQL has never run against a database.
