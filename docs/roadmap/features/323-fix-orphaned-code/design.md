# Design: fix-orphaned-code

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Seven service-scoped cleanup steps plus a final verification, behind an operator gate that is now
closed. The change is **internal-only**: it reaches no consumer surface (product-spec Consumer
Surface(s): none). The one ui edit is a comment and the agent edit deletes an unreferenced prompt file.

Item status carried from recon: item 5 is already resolved and gets no code change (recon.md:63,66);
item 7 is live and excluded (recon.md:87); item 9 is reachable and is kept (recon.md:96-97,149).

**Step 0 — operator gate (O-1), closed.** The operator chose option (b) on 2026-11-20: the
`node-pg-migrate` removal covers four Node leaves (ledger, config, identity, notify). Both amendments
D-8/D-10 require are on the feature branch: `acceptance.feature` @AC-2 (Given lists the four leaves;
When reads "each touched leaf's package.json and the root pnpm-lock.yaml importers are inspected, and
git ls-files is searched for the deleted paths"; Then unchanged) and product-spec Affected Services
(adds xstockstrat-identity, `package.json` only). The scope fork this closes is recon.md:150.

**Step 1 — portfolio (D-1).** Swap `r.pool` to `r.db` at the three call sites in `GetSnapshot`,
`CountPositions` and `UpdatePositionBracket` (recon.md:102-105). No interface change: `queryRower`
already exposes `QueryRow` and `Exec` (recon.md:99,112). `Pool()` keeps returning `r.pool`, because
sibling repos reuse it (recon.md:101). Add pgxmock tests for all three methods in the existing
`portfolio_repo_test.go`, reusing its `NewPortfolioRepoWithDB(mock)` shape (recon.md:111). Each test
is proven RED on its own via `go test -run` (nil-pool panic, recon.md:166), with no `recover()`.

**Step 2 — config (D-5, D-6).** Delete `src/services/configWatcher.ts` and its test, whose only
importer is that test (recon.md:37-38). Remove the four `configWatcher.ts` entries at
`scripts/config-wiring.json:52-55` and keep `:56,59,73` (recon.md:41), then confirm with
`node scripts/check-config-wiring.mjs --final` (recon.md:118). In the same step: reword
`services/xstockstrat-config/CLAUDE.md:131` (`APPLICATION_ENV`) to "telemetry resource attribute
only", close config findings `:14`, and review config findings `:4,:33` and
`docs/context-constitution.md:7,18,19,50` (recon.md:42,162); leave findings `:22` alone. Gate:
`rm -rf dist`, then `pnpm build && pnpm test:coverage`, re-checking c8 `--lines 40` (recon.md:40).

**Step 3 — Node package hygiene (D-4, D-7, D-9, D-11, D-12, D-13).**
- notify: remove `jsonwebtoken`, `bcrypt` and their `@types` (recon.md:52).
- ledger, config, notify and identity: remove the `migrate` script and the `node-pg-migrate`
  devDependency (recon.md:45,53,150). Identity is a 2-line deletion at `package.json:11,55`, with no
  `src/` change and no identity doc edit.
- Regenerate the **root** `pnpm-lock.yaml`, which is what the leaf images build from with
  `--frozen-lockfile` (recon.md:47,54,117,151): `pnpm install --lockfile-only`, then
  `pnpm install --frozen-lockfile`. One regeneration covers all four leaves.
- Expected lock diff: the touched importer entries plus the transitive `packages:`/`snapshots:`
  closure that `pnpm why` confirms has no remaining dependent. Anything else is drift and fails the
  step. Expected `pnpm why node-pg-migrate`: zero dependents across all workspace importers. Expected
  `pnpm why bcrypt jsonwebtoken`: identity only, so their `packages:` entries stay (recon.md:152).
- Gates: `pnpm build && pnpm test:coverage` per touched leaf, and
  `docker compose build xstockstrat-ledger xstockstrat-notify xstockstrat-config xstockstrat-identity`.
- Required evidence, recorded in context.md: the local `pnpm install --frozen-lockfile` output and the
  compose build output. CI installs these leaves with `--no-frozen-lockfile`, so CI cannot catch a
  drifted root lock. No CI guard is added here.
- The four per-service `pnpm-lock.yaml` files are not build input (recon.md:117). They are neither
  regenerated nor deleted; the step adds one root `docs/context-constitution-findings.md` row naming
  them vestigial and stale against their manifests.
- Docs in the same step: retire the ledger and notify banner and findings rows, and close root
  findings `:57`, which names all four leaves (recon.md:48,56,154-161).
- Merge order against peer 324 goes in `docs/roadmap/features/merge-order.md`. Whichever feature
  merges later rebases and regenerates the root lock under this protocol; nobody resolves it by hand
  (recon.md:167-170).

**Step 4 — marketdata.** Delete the `AlpacaAsset` type, the last declaration in `client.go`
(recon.md:59), and resolve marketdata findings `:33` (recon.md:60). Gate:
`GOWORK=off go build ./... && go vet ./...`.

**Step 5 — ingest (D-3).** Delete `example_simple_email.py`, `noop.py` and the whole of
`tests/test_extractor.py`, which tests only the two orphans (recon.md:67,77-82). Trim the five
non-MCP dataclasses and keep the `RawInput` name, narrowed to `McpClientInput` (recon.md:68-74).
Close ingest findings `:23`; annotate `:24` with the now-dangling labels `app.extractors.noop` and
`app.extractors.example_simple_email`. Leave `fundsignal_loop.py:623`, the ui `page.tsx:604` and the
opaque fixture strings unchanged (recon.md:76,83,164). Refresh the INGEST-6 line anchors. Gate:
`uv run pytest --cov=app --cov-fail-under=40` plus `ruff`.

**Step 6 — agent.** Delete `app/prompts/signal_extraction.md` and resolve agent findings `:34`
(recon.md:90-91). `list_correlation.md` and the `app/config/` package stay (recon.md:87-89,92). Gate:
`uv run pytest`, which includes `tests/test_config_watcher.py` (covers AC-3).

**Step 7 — ui (D-2).** Keep the `PortfolioPanel` combined branch. Add a constraint comment of at most
2 lines at `PortfolioPanel.tsx:85` stating when the combined view renders: no active account, or a
failed account fetch (recon.md:95-97,149). No behavior change. Gate: `next build` plus
`offline-pnl.spec.ts`.

**Final AC-2 verification (D-10).** A scoped presence check, never a repo-wide
`grep node-pg-migrate` (the stale per-service locks would make it RED after a correct fix):
- each touched leaf's `package.json` has no `node-pg-migrate` and no `"migrate"` script, and notify's
  has no `jsonwebtoken`, `bcrypt` or `@types` entries for them;
- root-workspace `pnpm why` matches the expected output in step 3;
- the deleted paths are absent from `git ls-files`;
- `grep AlpacaAsset` is empty;
- the build and test gates pass per service.

This follows the feature-175 pure-deletion pattern (recon.md:113-116,165). Item 5 is recorded as a
no-op with its grep evidence (recon.md:194).

**Spec-time note.** Re-grep every anchor when writing implementation-spec.md. Peers 322, 311 and 324
may shift lines (recon.md:167-170).

## Rejected Alternatives

- `R-1` Delete the PortfolioPanel combined branch — rejected because it turns durable @AC-30 into a C-16 CHANGE and breaks `offline-pnl.spec.ts`.
- `R-2` Migrate WatchlistRepo and signal_expiry_repo to a mockable db handle — rejected because it is scope creep: it needs a Begin-capable interface and collides with peer 311.
- `R-3` Change the `extractor_module` value at `fundsignal_loop.py:623` — rejected because it changes stored-row semantics, and the label is never resolved.
- `R-4` Spin identity's node-pg-migrate removal off into a follow-up bug — rejected because it needs a second lock regeneration and a second PR for a one-line deletion (C-18).
- `R-5` Resolve the `pnpm-lock.yaml` conflict with peer 324 by hand — rejected because it risks a corrupted or drifted lock; the later-merged feature regenerates it instead.
- `R-6` Delete or regenerate the four vestigial per-service `pnpm-lock.yaml` files in this feature — rejected because deleting is outside the report's ten items and against the feature-175 deferral, and regenerating is unscoped churn on files nothing reads (D-7, C-18). A findings row records the gap instead.
- `R-7` Use a repo-wide `grep node-pg-migrate`, or the unamended "repository is searched" wording, as the AC-2 check — rejected because it reports RED after a correct fix (stale per-service locks), and narrowing the check without rewording the scenario is a silent C-15/P-03 deviation.
- `R-8` Add a CI `--frozen-lockfile` guard for the Node leaves in this feature — rejected because it is out of scope per the product spec; peer 324 owns CI enforcement gaps.

## Open Risks

- [ ] The per-service `pnpm-lock.yaml` files stay stale and now list deps their manifests no longer declare. "Not build input" rests on a negative grep plus the four Dockerfiles; an unfound consumer would invalidate it — to be addressed at step 3 (the findings row makes the gap durable).
- [ ] CI installs the Node leaves with `--no-frozen-lockfile`, so a drifted root lock passes CI and fails only at image build — to be addressed at step 3 (recorded frozen-install and compose-build evidence).
- [ ] Scope now includes identity. Any identity edit beyond `package.json:11,55` is off-spec (F-08/P-03) — to be addressed at /sdd-spec (step 3 Files list).
- [ ] The lock regeneration may drop a still-needed transitive package or bring in drift — to be addressed at step 3 (`pnpm why` expected output, expected-diff check, then `pnpm install --frozen-lockfile`).
- [ ] Collision with peer 324: its coverage-script edits sit 2-3 lines from the `:11` deletion in all four leaf `package.json` files, and both features rewrite the root lock — to be addressed at step 3 and at merge (merge-order.md entry; regenerate after rebase).
- [ ] The identity C-16 sweep was keyword-based over all seven suites; a suite asserting through other terms could be missed — to be addressed at step 3 (identity `pnpm build && pnpm test:coverage`).
- [ ] Config c8 line coverage can shift when `configWatcher.ts` and its test are deleted together — to be addressed at step 2 (re-run `--lines 40` after `rm -rf dist`).
- [ ] pgxmock proves the handle and the SQL shape, not live SQL semantics — to be addressed at step 1 (accepted limit; dev smoke test per product-spec Acceptance Criteria).
- [ ] Peers 322, 311 and 324 may shift line anchors — to be addressed at /sdd-spec (re-grep every anchor).
- [ ] The dangling `extractor_module` labels stay visible until a separate defect fixes them — accepted; recorded at step 5 (ingest findings `:24` annotation).

## Constitution Rules Touched

- `C-01` — honored by: every anchor is re-grepped at spec time before it enters implementation-spec.md (O-2 closure).
- `C-08` — honored by: step 1 pairs the portfolio swap with pgxmock tests for all three methods; the deletion steps run each service's real coverage gate.
- `C-11` — honored by: this is a Track C bug that ran recon and a 3-round full debate; no code precedes the design.
- `C-15` — honored by: AC-1 is covered by step 1, AC-3 by step 6, and AC-2 by the scoped final verification, whose wording now matches the amended scenario (D-10).
- `C-16` — honored by: no CHANGE. Item 9 keeps the combined branch so @AC-30 stays PRESERVE (D-2, R-1); the identity sweep is recorded below.
- `C-18` — honored by: least mechanism throughout: a handle swap with no interface change, one lock regeneration for four leaves, and no per-service-lock or CI work (R-2, R-4, R-6, R-8).
- `F-08` — honored: the identity `package.json` and root findings `:57` enter a step's Files list only because the product-spec and @AC-2 amendments landed first (D-8).
- `P-03` — honored by: the identity scope fork went to the operator as O-1 rather than being guessed, and the AC-2 check was narrowed by rewording the scenario, not silently.
- `P-06` — honored by: step 1 proves each pgxmock test RED per test before the swap; AC-2 uses the construct-scoped presence check as its honest RED→GREEN.

## Business Rules Touched (C-16)

No CHANGE. The AC-2 extension is the only line that needed an operator decision, and has one.

- EXTEND `@AC-1` "The portfolio repository built on a mock DB serves GetSnapshot without panicking" (`docs/roadmap/features/323-fix-orphaned-code/acceptance.feature`) — new cases added: `CountPositions` and `UpdatePositionBracket` under the same mock (D-1).
- EXTEND `@AC-2` "Orphaned modules, scripts and dependencies are gone" (`docs/roadmap/features/323-fix-orphaned-code/acceptance.feature`) — new case added: config, identity and notify join ledger in the node-pg-migrate removal, with the When reworded to the scoped check (D-10); covered by the operator decision of 2026-11-20 (context.md, Session 2026-11-20).
- PRESERVE `@AC-3` "The live agent config package survives the cleanup" (`docs/roadmap/features/323-fix-orphaned-code/acceptance.feature`) — not regressed by: step 6 deletes only `signal_extraction.md`.
- PRESERVE `@AC-30` "The combined PortfolioPanel sums each account's own figures" (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature`) — not regressed by: the branch is kept; step 7 adds a comment only.
- PRESERVE `@AC-14` (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature`) — not regressed by: the single-account path is untouched.
- PRESERVE `@AC-12` "Ledger logs the relative key as read evidence" (`services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature`) — not regressed by: step 2 deletes config's `configWatcher.ts` only; ledger's own watcher and test are untouched.
- PRESERVE `@AC-4` (`docs/sdd/business-rules/platform.feature`, `@feature-252`) — not regressed by: the ledger and identity `test:coverage` gate runs in step 3.
- PRESERVE `@AC-1` `@feature-252` (`services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature`) — not regressed by: its Then clause is discharged by identity's `pnpm build && pnpm test:coverage`; its mutation clause is recorded as unaffected (no `src/` change), not claimed as discharged.
