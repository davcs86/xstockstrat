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
