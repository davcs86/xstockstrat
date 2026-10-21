# Context Log: fix-identity-ledger-test-suites

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md` (Issues disabled), operator-approved. Found while red/green-proving
  hotfix #1262 (`hotfix/fix-refresh-token-rotation`).
- Severity: SEV-3. Environment: dev (main-dev) @ 4535695. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), context.md.
- Affected services: xstockstrat-identity, xstockstrat-ledger (test scripts/files only). config and notify verified
  unaffected (compile-then-test).
- Confirmation evidence (main-dev @ 4535695): `pnpm test` identity 74/74, ledger 45/45; the as-written imports fail
  `ERR_MODULE_NOT_FOUND` and the `.ts` imports fail `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; an ad-hoc `tsc` compile +
  `node --test` executes the impl tests (identity 66/67, ledger 36/37 — the single failure in each was `mtls.test`,
  likely an artifact of the ad-hoc compile's paths; design must confirm under the real compile-then-test setup).
- Design forks for /sdd-design:
  - compile-then-test (`tsc` → `dist/`, like config/notify; c8 over dist with source maps) vs a TS loader (tsx) vs
    `--experimental-transform-types` + explicit `.ts` imports (needs extension rewrites in the impl, larger blast radius).
  - how the lazy-import guard becomes a hard failure (static import vs `before()` that throws).
  - tsconfig excludes `src/**/*.test.ts` — a test-build tsconfig (or the config/notify approach) is needed.
- Overlaps: hotfix #1262 adds identity rotation tests that only truly run once this lands; feature
  241-fix-config-audit-author-spoof and 248-fix-ledger-trimmed-notify-payload touch identity/ledger-adjacent tests
  (config, ledger) — whichever lands second merges the other's test changes.
- Recommended design depth: full → `/sdd-design fix-identity-ledger-test-suites` (rationale: 2 affected services, CI
  surface; operator rule 2026-10-20: full is the minimum for automated fixes).
- Development branch: feature/fix-identity-ledger-test-suites

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, no Floor `F-*` breach).
  Overlap: WARN (no config-key, proto or migration collision).
- Warnings (8) and notes (3), with what this session did:
  - Crit 2 + 8 / C-15, no FR list or `@FR` tags → fixed: added `## Functional Requirements` FR-1..FR-5 and tagged
    AC-1..AC-4; added AC-5 (`@FR-5`, a guard, not `@regression`) for "existing tests pass once they execute".
  - Crit 8, AC-3 not concrete → fixed: Scenario Outline over identityServiceImpl / ledgerServiceImpl / eventNotifier
    with a named nonexistent import; Then = non-zero exit and no test in that file reported as passed (holds whether
    `tsc` or the runner rejects the import).
  - Crit 8, internal-state Thens → fixed: AC-1/AC-2 first Then is now "exits 0 with the file's tests reported as
    passed"; AC-2 gained mutation discriminators `ledgerServiceImpl.ts:84-105` (duplicate-key branch) →
    `ledgerServiceImpl.test.ts:444`, and `eventNotifier.ts:132` (`sub.onEvent(row)`) → `eventNotifier.test.ts:82`.
  - Crit 8, AC-4 over-specified `src/` path → fixed: rows matched by module name (src/ or dist/); authz added.
  - Crit 9, unchecked "CI change possible" box + template placeholder → fixed: plain checked statement
    (`ci.yml:584` unchanged), placeholder deleted.
  - Crit 11 / C-14, no Consumer Surface(s) → fixed: "None — internal/platform-only".
  - Crit 1, no persona → fixed: "Who is affected" line (developers, reviewers, identity/ledger owners; `ci.yml:582-584`).
  - Scope accuracy → fixed: Affected Services now "test tooling", naming tsconfig `:19-23` exclusion, a possible
    loader devDependency + lockfile, and the `.ts`-extension imports in `mtls.test.ts:13`, `telemetry.test.ts:3`,
    `telemetry.export.test.ts:9`. Whether production `tsc` output may gain compiled tests left to design (config's
    does: `services/xstockstrat-config/tsconfig.json:14-15`). Out of Scope clarifies guard removal and import edits
    are in scope.
  - Note, "authz" listed as loaded → fixed: only mtls and telemetry load; authz tests (`identityServiceImpl.test.ts:646`)
    sit behind the failed import (`:30-36`).
  - Note, stale working-tree copy of acceptance.feature in the main checkout (`refreshToken` wording) → no edit here;
    the branch copy is authoritative. Sync the main checkout before relying on it.
  - Note, verified claims (package.json lines, guard counts 65 and 31 + 7, lazy imports, parameter properties,
    `ci.yml:584`) → no action.
- Open tension for /sdd-design: FR-5 lets a failing test be "recorded in context.md", but AC-5 needs `# fail 0` and
  skip/delete/weaken is forbidden. Design must say how a recorded-but-unfixed failure lands (fix in this feature, or
  stop and ask).
- Overlap findings:
  - Hotfix PR #1262 (`hotfix/fix-refresh-token-rotation`) edits `identityServiceImpl.test.ts` (rotation tests); 252
    edits the same file (import `:30`, guards). Textual merge, whichever lands second; #1262 diff not inspected.
  - Feature 248-fix-ledger-trimmed-notify-payload: conditional same-file overlap on `ledgerServiceImpl.ts` and
    `eventNotifier.ts` only if design picks the strip-only route (extension/parameter-property rewrites); fix regions
    disjoint (248 at `ledgerServiceImpl.ts:197,371-373`, `eventNotifier.ts:124`). None under compile-then-test. 248's
    regression test, if it lands in `ledgerServiceImpl.test.ts`/`eventNotifier.test.ts`, becomes a hard failure once
    252 lands.
  - Feature 250-fix-otel-metrics-logs-gap: possible `package.json` overlap only if it adds OTel deps; blocks disjoint
    from the test scripts (identity `package.json:12-13`, ledger `:13-14`).
  - Correction to the /sdd-triage entry above: 241-fix-config-audit-author-spoof names only xstockstrat-config and
    xstockstrat-agent (`241-fix-config-audit-author-spoof/product-spec.md:40-44`); no collision with 252.
  - No merge-order.md row needed (no FAIL-level overlap).
- Operator decisions (binding, recorded 2026-10-20), verbatim:
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth (operator: full is the minimum for automated fixes).
  - Any existing test that fails once it actually executes is a pre-existing defect to fix or record in context.md — never delete, skip or weaken it.
  - Interacts with hotfix #1262 (identity rotation tests) and features 241/248: whichever lands second merges the other's test changes.
- Next: `/sdd-design fix-identity-ledger-test-suites` (full — operator: no quick designs).

## Session 2026-10-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-identity, xstockstrat-ledger; key reuse patterns: config/notify
  compile-then-test scripts `services/xstockstrat-config/package.json:12-13` + no-test-exclusion tsconfig `:14-15`;
  hard-fail bare `before()` import + harness case `configServiceImpl.test.ts:15-27`).
- Phase 1 Grilling: 4 rounds (full). Termination: auto-approved by the orchestrator under the operator standing
  authorization (above): rounds ≥ 2, no Floor breach, no blocking objection, no CHANGE to a durable `@AC`. The round-3
  blocker (AC-4/FR-4 vacuous under path (b)) was closed by the r4 rewording. The r4 adversary verdict was SOUND, and its
  11 non-blocking items were adopted into design.md.
  - Chosen approach:
    - compile-then-test, with scripts and tsconfig byte-identical to config/notify;
    - path (b): no `--check-coverage` in the scripts; 40% proven by `c8 check-coverage --lines 40` after the wrapped run;
    - Step A (runner) keeps the impl try/catch so AC-6 has a discriminating RED;
    - Step B (hardening) removes it plus 103 guards, adds a harness case and a 2-line constraint comment.
  - Rejected: tsx loader, `--experimental-transform-types`, `tsconfig.test.json`, `rewriteRelativeImportExtensions`,
    static import + casts, `--check-coverage` in all four Node leaves. Runner-up: path (a), `--check-coverage` in
    identity/ledger only, which needs operator sign-off (C-10).
- Constitution rules touched: C-01, C-08, C-10, C-13, C-14, C-15, C-16, C-18, P-02, P-03, P-05, P-06, F-04, F-05,
  F-08, F-09, F-11. Floor breaches: none.
- Business rules (C-16): 30 durable rules, all PRESERVE; no EXTEND/CHANGE, so no operator sign-off needed.
- **Requirement amendment (C-15).** design.md § Requirement amendment holds the verbatim text:
  - AC-4 reworded (names `c8 check-coverage --lines 40` plus a numeric aggregate);
  - FR-4 narrowed (`product-spec.md:66`);
  - AC-6 appended (`@FR-3 @regression`, `--test-reporter=tap`);
  - AC line `product-spec.md:85` gains "AC-6 (FR-3)";
  - AC-1 last line reworded by behaviour;
  - AC-5 Then made reporter-neutral.

  **This session did not apply it.** The design-completion write set (SKILL.md COMPLETION) and the computed task
  exclude `acceptance.feature`/`product-spec.md`. Owner: the orchestrator, on the feature-branch copy before
  `/sdd-spec`, recorded in a feature.md history row. If that does not happen, spec step 1 owns it, with both files in
  its **Files** (F-08). It must land before impl-spec review.
- **Preview provenance (P-05).** "mtls passed" and `ledgerAudit.js` 38.88% are mediator-preview observations only
  (Node 22.22.0, out of tree, try/catch kept). They are not in-tree evidence. In-tree Node 24 numbers: not yet observed.
- **Expected absolute test counts.** These are context only, not step Verification (F-09): identity 75 (79 on a #1262
  base), ledger 47. They are derived as the triage pre-step counts plus the harness cases (identity +1, ledger +2), and
  are to be confirmed against observed runs at execute time.
- Open Threads (from design.md § Open Risks):
  - [ ] In-tree Node 24 run after hardening unobserved. A regression, stale assertion, mock/setup drift or aggregate
    below 40 goes to stop-and-ask. Target: identity B, ledger B.
  - [ ] Aggregate % Lines may fall below 40 once the impl enters the denominator (advisory preview: `ledgerAudit.js`
    38.88%). Target: identity B, ledger B (gate step 5).
  - [ ] Node 24 output shape for a root `before()` failure is unverified; AC-6 uses explicit `--test-reporter=tap`.
    Target: identity A/B, ledger A/B (AC-6 capture).
  - [ ] Path (b): CI enforces no 40% gate for any Node leaf until the follow-up defect lands. Target: teardown (file
    `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md` + `.status` open).
  - [ ] #1262 anchors (`:353`, `:495`, `:530`) verified on `e69e953d` only. Target: re-grep at `/sdd-spec`;
    identity B.
  - [ ] Requirement amendment not yet on the feature branch. Target: orchestrator before `/sdd-spec`, else spec
    step 1.
  - [ ] Production `pnpm build` now type-checks and emits tests; `dist/__tests__` ships in the image
    (`Dockerfile:24,27,32`). Accepted for parity. Target: identity A, ledger A (`pnpm build` gate).
  - [ ] bcrypt native binding becomes a test-time dependency (low likelihood). Target: identity A (first probe).
  - [ ] CI `node-test` has no `timeout-minutes` (`ci.yml:534-591`); eventNotifier reconnect timing
    (`recon.md:219`). Target: ledger A (bounded probe, no force-exit).
  - [ ] 103 guard removals (+2 on #1262). Controls: assert-count diff, relative count formula, zero
    cancelled/skipped/todo, scoped `catch` grep. Target: identity B, ledger B.
  - [ ] Merge order 252 / #1262 / 248: whoever lands second de-guards and merges. Target: teardown
    (`merge-order.md` note).
- Ledger: `fails.md` entry added (Node ≥ 23 default non-TTY `node --test` reporter is `spec`, so TAP literals in
  ACs/evidence do not appear on CI Node 24).
- Status: spec-ready → design-approved.

## Session 2026-10-20 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status: design-approved → implementation-ready.
  1. docs: C-15 requirement amendment
  2. service: identity runner
  3. test: identity hardening
  4. service: ledger runner
  5. test: ledger hardening
  6. docs: teardown
- Requirement amendment (`design.md:116-169`) was **not** on the feature branch.
  - At `ca8b9236`, `acceptance.feature` has AC-1..AC-5 only, with the old AC-4 at `:33-40` and the TAP-literal AC-5 at `:46`.
  - Per `design.md:122`, spec Step 1 owns it (`acceptance.feature` + `product-spec.md` in its Files, F-08).
  - Timing tension: `design.md:123` wants it landed before impl-spec review, which a step only achieves if executed first.
  - Step Dependencies therefore require Step 1 to run, or the orchestrator to apply the identical text, before `/sdd-review … impl-spec`. Step 1 is a no-op if the text is already there.
- Key codebase findings (re-grepped at `ca8b9236`):
  - Merge base with `origin/main-dev` @ `51e3cc9b` is `45356952`. `services/xstockstrat-{identity,ledger}/src`, `ci.yml`, `lang-node.md`, `ci-overview.md`, root `CLAUDE.md` and `merge-order.md` have no diff since then. All recon anchors hold.
  - Guard counts confirmed by grep: identity 65 (67 on #1262 `e69e953d`); ledger impl 31; eventNotifier 7. Every `if (!` line is a subject-missing guard. The only `catch`es are the subject and proto imports on both bases. The `try {` at identity `:143` is an `APPLICATION_ENV` try/finally.
  - #1262 anchors re-verified on `e69e953d`:
    - `rotateRefreshToken` `:340-372`;
    - claim `AND rt.revoked_at IS NULL` `:353`;
    - call `:530`;
    - test regex `:495`.
  - Base detector: `grep -c "private async rotateRefreshToken"` (0 = main-dev, 1 = #1262).
  - AC-2 mutation precision: deleting only `ledgerServiceImpl.ts:84-105` leaves the block's `}` at `:106` orphaned, so `tsc` fails for syntax and not because of the test. Step 4 deletes `:84-106`. The scenario text is unchanged.
  - Baseline assert counts (`grep -o 'assert\.[A-Za-z]*('`), context only (F-09):
    - identity impl 145 (150 on #1262);
    - ledger impl 71;
    - eventNotifier 13.
  - Expected absolute test counts (`design.md:89`), context only: identity 75 (79 on #1262), ledger 47.
- Spec-time additions beyond `design.md` (recorded per P-03):
  - (a) The follow-up defect row goes into **config and notify** findings logs too, not only identity/ledger (`design.md:189`). Precedent: one row per affected service (commit `0027fa17`; the multi-service `2026-10-19-orphaned-code-defect` rows). The defect covers all four leaves (C-10).
  - (b) The stale "Lazy imports — guard against strip-only…" banners (identity `:18-20`, ledger `:14-16`) are deleted with the try/catch; the constraint comment supersedes them.
  - (c) `lang-node.md:37` glob is updated with `:9,11-32,54,58`, because it becomes false once all four use `dist/__tests__/*.test.js`.
  - (d) The follow-up defect is filed as `SEV-3` (same class as the parent, `product-spec.md:5`).
- Open Threads added:
  - [ ] This /sdd-spec sandbox has Node `v22.22.0` only. Steps 2–5 gates require Node 24 (`ci.yml:572`). No Node 24 means stop-and-ask, never a Node 22 substitute (`design.md:219`).
  - [ ] `fails.md:2224` claims Node 24 strip-types loads these suites, contradicting `product-spec.md:12-22`. Steps 2 and 4 treat an absent pre-change RED (mutation already fails) as stop-and-ask.
  - [ ] Step 1 must land before `/sdd-review fix-identity-ledger-test-suites impl-spec` (owner: orchestrator).
