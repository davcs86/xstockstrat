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
