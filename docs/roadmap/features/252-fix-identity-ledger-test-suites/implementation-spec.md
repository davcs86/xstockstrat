# Implementation Spec: fix-identity-ledger-test-suites

**Status**: `pending`
**Created**: 2026-10-20
**Feature**: `docs/roadmap/features/252-fix-identity-ledger-test-suites/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-identity-ledger-test-suites`

---

## Execution Summary

The steps follow `design.md` § Chosen Approach (`design.md:15-195`). There are two services, each with a runner step and then a hardening step, plus one teardown step. The design's requirement amendment did not land at design time: the branch `acceptance.feature` still has AC-1..AC-5 only, with the old AC-4 wording at `acceptance.feature:33-40`. So Step 1 applies it, as `design.md:122` provides.

- **Step 2 (identity runner).** Switches identity to compile-then-test, matching config and notify, and keeps the `before()` try/catch. With the catch still in place, the impl loads under the compiled CJS layout, so AC-1 and AC-4 go green. AC-6's discriminating RED is captured at the end of this step (`design.md:39`, `:45-48`).
- **Step 3 (identity hardening).** Removes the swallow and all skip guards, then proves FR-3 (AC-3, AC-6).
- **Steps 4 and 5.** The same pair for ledger.
- **Step 6 (teardown).** Narrows the "40% enforced" doc claims, files the follow-up defect report, adds the merge-order note and runs the context audit.

There is no proto, migration, config-key, `ci.yml`, Dockerfile or lockfile change (`design.md:17`).

**Consumer surface (C-14).** None — internal/platform-only (`product-spec.md:78-80`). This is a decision, not an omission: the feature changes the unit-test runner and c8 scope only.

**Not trading-domain-relevant.** No trading or portfolio service and no broker, order or `TRADING_MODE` surface is involved, so `step-constraints.md` §A does not apply.

**Header propagation.** No step adds an outbound gRPC call, so §B "Header propagation" is N/A.

**New env vars / ports.** None (`recon.md:181`).

### Scenario Coverage (C-15)

These IDs refer to the **amended** `acceptance.feature` text (Step 1, `design.md:116-169`). At impl-spec review (`011e369e`) the on-branch file had AC-1..AC-5 only; the AC-6 rows and the reworded AC-1/AC-4/AC-5 are re-checked against this table right after Step 1.

| Scenario | RED captured | GREEN / covered |
|---|---|---|
| `@AC-1` identity suite executes against the real impl | Step 2 pre-change mutated run | Step 2; re-confirmed in Step 3 |
| `@AC-2` ledger suite executes against the real impls | Step 4 pre-change mutated runs | Step 4; re-confirmed in Step 5 |
| `@AC-3` unloadable subject fails the run (identity row) | Step 2 pre-change `.missing` run | Step 3 |
| `@AC-3` (two ledger rows) | Step 4 pre-change `.missing` runs | Step 5 |
| `@AC-4` coverage gate measures the impl | Steps 2 and 4 pre-change report (no impl rows) | Steps 2 and 4; final in Steps 3 and 5 |
| `@AC-5` existing tests pass once executed (guard, not `@regression`) | n/a — passes vacuously on buggy code | Steps 2–5 gate; final in Steps 3 and 5 |
| `@AC-6` compiled test with deleted compiled subject fails (identity row) | end of Step 2 | Step 3 |
| `@AC-6` (two ledger rows) | end of Step 4 | Step 5 |

Every `FR-N` has a scenario:

| FR | Scenario(s) |
|---|---|
| FR-1 | AC-1 |
| FR-2 | AC-2 |
| FR-3 | AC-3, AC-6 |
| FR-4 | AC-4 |
| FR-5 | AC-5 |

### Stop-and-ask (P-03), binding for Steps 2–5

Source: `design.md:103-114`. Each of the following is recorded in `context.md`, filed as a `docs/reports/` defect, and taken to the operator:

- an impl regression;
- a stale assertion;
- mock or setup drift (a mock or fixture that no longer matches the impl's SQL or shape);
- an aggregate `% Lines` below 40;
- a pre-change RED that does not appear (see Step 2 / Step 4 Instructions).

For any of these, nobody deletes, skips or weakens a test, lowers the threshold, or adds tests ad hoc (operator decision 2026-10-20, `context.md`).

Failures caused by the runner change itself are fixed with no assertion change, **inside the current step's Files only**. These include tooling, `tsc` type errors in test files, mtls, telemetry and hangs. If that fix would touch an assertion, stop and ask.

`pnpm build` in Step 2 compiles `identityServiceImpl.test.ts`, and in Step 4 it compiles `ledgerServiceImpl.test.ts` and `eventNotifier.test.ts`. Those files belong to Steps 3 and 5, not to Steps 2 and 4. A fix that needs a file outside the current step's Files is a stop-and-ask: log it in the Deviation Log and get operator sign-off before staging it (F-08).

The feature does not reach `code-completed` while any test fails or the aggregate is below 40.

### Execution environment

Every gate capture runs on **Node 24**, matching CI (`.github/workflows/ci.yml:572`; `design.md:71`, `:219`). Record `node --version` in the evidence.

The `/sdd-spec` session's sandbox had `v22.22.0`. A host without Node 24 is a stop-and-ask. Never substitute Node 22: the rejected alternative is at `design.md:219`.

Two repo defaults point the wrong way for this feature's gates: `.nvmrc:1` is `22`, and `.claude/skills/sdd-execute/reference/tooling-setup.md:30` provisions "Node 22". Do not follow either. Provision Node 24 before the Step 2 and Step 4 pre-change captures.

## Step Dependencies

- **Step 1 before everything else.**
  - Steps 2–5 verify the amended AC-1/AC-4/AC-5 wording and AC-6 (`design.md:120-123`). `design.md:123` wanted the amendment on the branch before impl-spec review. It was not: `/sdd-review … impl-spec` (2026-10-20) ran against `acceptance.feature` @ `011e369e` with AC-1..AC-5 only.
  - So Step 1 is the first `/sdd-execute` step and runs before any Step 2 capture. After it, run `grep -n '@AC-' acceptance.feature` and re-check § Scenario Coverage against the amended file. A scenario with no row there is a stop-and-ask.
  - If the identical text is already present when Step 1 runs, Step 1's Verification passes with no diff and the step is marked `done` with a "no-op, already applied" note in `context.md`.
- **Step 3 [test] covers Step 2 [service]** (C-08 pair).
  - Step 3 needs Step 2's compiled layout. The `.js` subject specifiers resolve only under `dist/` (`recon.md:110`).
  - Step 3 also needs the AC-6 RED captured at the end of Step 2. It is the only discriminating AC-6 RED (`design.md:45-48`, `:210`).
  - Step 3 needs the AC-3 RED captured before Step 2's edits, because after Step 2 `tsc` may already reject the bogus import (`recon.md:221-224`, `design.md:204`).
- **Step 5 [test] covers Step 4 [service]**, for the same reasons.
- **Order between services.** Steps 2–3 (identity) and Steps 4–5 (ledger) are independent and may run in either order.
- **Step 6 requires Steps 1–5.** It documents the shipped runner and the final scripts.
- **Hotfix #1262** (`origin/hotfix/fix-refresh-token-rotation` @ `e69e953d`). This is a rebase-only interaction, not a hard ordering row.
  - Whichever lands second merges the other's `identityServiceImpl.test.ts` changes (operator decision 2026-10-20).
  - If #1262 is on the base when Step 3 runs, Step 3 removes its 2 extra guards and keeps its `:495` assertion.
  - Steps 2 and 3 pick the AC-1 mutation by base (Step 2 Instructions).
- **Feature 248 (`fix-ledger-trimmed-notify-payload`).** Its branch `ddc18f6e` has no `services/xstockstrat-ledger/src` change. If its regression tests land in `ledgerServiceImpl.test.ts` or `eventNotifier.test.ts` before Step 5, Step 5 de-guards them too. Once 252 lands, a guarded 248 case is a silent pass.
- **Feature 241** has no overlap (`context.md`, sdd-review correction).

---

### Step 1 — docs: Apply the design's requirement amendment (C-15) to acceptance.feature and product-spec.md

**Status**: `pending`
**Service**: `docs/roadmap/features/252-fix-identity-ledger-test-suites/`
**Files**:
- `docs/roadmap/features/252-fix-identity-ledger-test-suites/acceptance.feature` — modify
- `docs/roadmap/features/252-fix-identity-ledger-test-suites/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The amendment text is in `design.md:116-169`:
  - AC-4 block `:127-134`;
  - FR-4 `:138`;
  - AC-6 block `:142-154`;
  - AC line `:157`;
  - AC-1 line `:161`;
  - AC-5 Then `:166`.
- The ownership fallback is `design.md:122`: "the **first spec step owns the edit**, with both files in its **Files** (F-08)".
- Current targets, re-read at `ca8b9236`:
  - `acceptance.feature:10` is the AC-1 last line with the `identityServiceImpl.ts:524-527` anchor;
  - `acceptance.feature:33-40` is the AC-4 block (`:39` "the 40 percent line threshold still passes");
  - `acceptance.feature:46` is the AC-5 Then `"# fail 0"`;
  - `acceptance.feature:52` is the last line (`| xstockstrat-ledger   |`);
  - `product-spec.md:66` is FR-4;
  - `product-spec.md:85` is the AC line ending "AC-4 (FR-4).".
- Ledger rationale for the reporter-neutral AC-5: `docs/roadmap/ledger/fails.md:2953-2966`.

**TDD**: `N/A (docs — scenario text only)`

**Covers**: —

**Instructions**:

1. In `acceptance.feature`, replace line `:10` with `design.md:161`, verbatim (4-space indent preserved):

   ```gherkin
       And a mutation that removes single-use revocation of the presented refresh token in refreshOAuthToken makes the "rotates the refresh token and mints a new aud-bound access JWT" test fail
   ```

2. Replace the AC-4 block `acceptance.feature:33-40` (from `@AC-4 @FR-4 @regression` through the `# Rows are matched…` comment) with `design.md:127-134`, verbatim. The tag line and Scenario title stay the same. The Given becomes `Given each service's c8-wrapped "pnpm run test:coverage" run`. The third Then becomes `And "c8 check-coverage --lines 40", run in each of those services right after its run, exits 0 and the report shows a numeric All files % Lines of at least 40`. The comment line is kept.

3. Replace `acceptance.feature:46` with `design.md:166`, verbatim: `    Then the test summary reports 0 failed tests`. Keep `:47`, the no-delete/skip/todo/assertion-removal line.

4. After `:52`, append one blank line and then the AC-6 Scenario Outline `design.md:142-154`, verbatim. That is the `@AC-6 @FR-3 @regression` tag, the two Givens, the When, the two Thens (`exits non-zero`, `the TAP summary reports "# pass 0"`) and the 3-row Examples table.

   IDs are append-only (C-15). Do not renumber AC-1..AC-5.

5. In `product-spec.md`, replace `:66` with the `design.md:138` text, verbatim, without the leading `> `:

   > FR-4. The c8 coverage report measures the impl modules (a non-zero row for each), and `c8 check-coverage --lines 40` run after `test:coverage` exits 0 over a numeric aggregate. The scripts' `--lines 40` flag alone enforces nothing (unenforced in all four Node leaves; follow-up defect report).

6. In `product-spec.md:85`, change `AC-4 (FR-4).` to `AC-4 (FR-4), AC-6 (FR-3).`. Leave the rest of the sentence and `:86` unchanged.

7. Do not edit the main-checkout (`main-dev` working tree) copies (`design.md:11`, `:220`).

8. Record the amendment:
   - In `context.md`, add a session entry ("Requirement amendment (C-15) applied per `design.md:116-169`").
   - In `feature.md` § Status History, add a row with no status change, e.g. `| <date> | (no status change) | /sdd-execute step 1 | Requirement amendment (C-15) applied: AC-1/AC-4/AC-5 reworded, AC-6 appended, FR-4 narrowed |`. This follows `design.md:121`.

**Verification**:
```bash
F=docs/roadmap/features/252-fix-identity-ledger-test-suites
grep -c '@AC-' "$F/acceptance.feature"                                   # 6
grep -n '@AC-6 @FR-3 @regression' "$F/acceptance.feature"                # 1 hit
grep -n 'c8 check-coverage --lines 40' "$F/acceptance.feature" "$F/product-spec.md"   # AC-4 Then + FR-4
grep -n 'single-use revocation of the presented refresh token' "$F/acceptance.feature" # 1 hit (AC-1)
grep -n 'the test summary reports 0 failed tests' "$F/acceptance.feature"             # 1 hit (AC-5)
grep -n 'identityServiceImpl.ts:524-527\|40 percent line threshold still passes\|"# fail 0"' "$F/acceptance.feature"  # no hits
grep -n 'AC-6 (FR-3)' "$F/product-spec.md"                               # 1 hit
grep -n '@FR-' "$F/acceptance.feature"                                   # FR-1..FR-5 each tagged at least once
git diff --stat -- "$F"                                                  # only acceptance.feature, product-spec.md (+ feature.md, context.md)
```

---

### Step 2 — service: identity — compile-then-test runner (scripts, tsconfig, non-impl test imports)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-identity/tsconfig.json` — modify
- `services/xstockstrat-identity/src/__tests__/mtls.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetry.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence** (re-grepped at `ca8b9236`; the merge base with `origin/main-dev` @ `51e3cc9b` is `45356952`, and nothing under `services/xstockstrat-identity/src` or `ci.yml` differs):
- **Scripts.**
  - `services/xstockstrat-identity/package.json:12` is `"test": "node --experimental-strip-types --test src/__tests__/*.test.ts"`.
  - `:13` is `"test:coverage": "c8 --reporter=text --reporter=lcov --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts"`.
  - `:8` is `"build": "tsc"`.
  - `:14` is `"lint": "eslint src --ext .ts"`.
- **Reuse target (mandatory, `recon.md:101-104`).** `services/xstockstrat-config/package.json:12-13`:
  - `"test": "tsc && node --test dist/__tests__/*.test.js"`
  - `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
  - Notify's `:12-13` is identical.
  - `typescript` `:51`, `c8` `:43` and `ts-node` `:50` are already devDependencies in identity, so no lockfile change is needed.
- **tsconfig.**
  - `services/xstockstrat-identity/tsconfig.json:19-23` is `"exclude": [ "node_modules", "dist", "src/**/*.test.ts" ]` (test exclusion `:22`).
  - `:9` `rootDir ./src`; `:8` `outDir ./dist`; `:4` `module commonjs`; `:10` `strict: false`.
  - Reuse target: `services/xstockstrat-config/tsconfig.json:15` `"exclude": ["node_modules", "dist"]` (`recon.md:105`).
- **Non-impl imports** (`recon.md:50-51`, `:112-114`):
  - `mtls.test.ts:13` is `import * as mtls from '../mtls.ts';` (config counterpart `services/xstockstrat-config/src/__tests__/mtls.test.ts:13` `'../mtls'`).
  - `telemetry.test.ts:3` is `import { buildResource } from '../telemetry.ts';` (config `telemetry.test.ts:3` `'../telemetry'`).
  - `telemetry.export.test.ts`:
    - `:5` is `import { createRequire } from 'node:module';`;
    - `:7` is the strip-types ESM comment;
    - `:8` is `(globalThis as { require?: NodeRequire }).require = createRequire(import.meta.url);`;
    - `:9` is `const TELEMETRY = '../telemetry.ts';`, used at `:53`;
    - `:31` is the comment `// Node runtime warnings ("(node:<pid>) …", e.g. MODULE_TYPELESS_PACKAGE_JSON under strip-types) are not OTel output.`
  - Config counterpart `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts:6` is `const TELEMETRY = '../telemetry';`, with no shim.
  - `import.meta` is invalid under `module: commonjs` (`recon.md:205`).
- **Impl `before()` try/catch.** It stays in this step (`design.md:39`): `src/__tests__/identityServiceImpl.test.ts:28-40`, with the import `:30` `'../grpc/identityServiceImpl.js'`, `:34` `'../grpc/authz.js'` and the catch `:37-39`.
- **AC-1 mutation anchors** (`design.md:94-99`, re-grepped):
  - main-dev base: the revoke statement `src/grpc/identityServiceImpl.ts:524-527` (`await this.pool.query('UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_id = $1', [token_id]);`) inside `refreshOAuthToken` `:502`. Test `identityServiceImpl.test.ts:403` asserts `/UPDATE identity\.refresh_tokens SET revoked_at/` at `:417`. The `last_used_at` UPDATE `:520-523` does not match that regex.
  - #1262 base `e69e953d`: `rotateRefreshToken` `:340-372`, claim line `:353` `AND rt.revoked_at IS NULL`, called from `refreshOAuthToken` at `:530`. The test regex at `:495` is `/SET revoked_at = NOW\(\)[\s\S]*revoked_at IS NULL/`. Re-grepped at spec time, unchanged. `grep -c "private async rotateRefreshToken"` is 1 on #1262 and 0 on main-dev.
- **Build/CI.**
  - CI `node-test` runs on Node `"24"` (`ci.yml:572`), with proto build `ci.yml:579-580` and `pnpm run test:coverage` at `ci.yml:582-584`.
  - The identity impl needs proto `dist` at load time (`ledgerAudit.ts:8` → `LedgerServiceClient`; `recon.md:31-34`).
  - `dist/` and `coverage/` are git-ignored (`.gitignore:15`, `:20`, `:25`).
- **c8.**
  - `--check-coverage` defaults to false (`node_modules/.pnpm/c8@10.1.3/node_modules/c8/lib/parse-args.js:85-86`).
  - `--lines` defaults to 90 (`:103-104`).
  - The temp dir defaults to `<reportsDir>/tmp` (`:169-170`).
  - Thresholds are checked only with `checkCoverage` (`lib/commands/report.js:43`).
  - `'Unknown' < 40` is false, so an empty map passes (`lib/commands/check-coverage.js:56-59`).
- **Lint config.** `services/xstockstrat-identity/.eslintrc.json` has `no-unused-vars` as an error. The `createRequire` import must go with the shim.
- **C-13.** No new domain literal. Every inline mock keeps one consumer, and `src/__tests__/fixtures/` does not exist and is not created (`recon.md:118`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4, AC-5`. AC-1 and AC-4 go green here. AC-3's identity RED and AC-6's identity RED are captured here for Step 3.

**Instructions**:

**A. Pre-change captures.** Run these on the unmodified tree, on Node 24, from the repo root. Never commit a mutation.

1. Record the base, the Node version, and the baseline counts:
   - `node --version` must print `v24.*`.
   - `grep -c "private async rotateRefreshToken" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` gives 0 for main-dev or 1 for #1262.
   - Run `pnpm --filter @xstockstrat/proto run build`, then `cd services/xstockstrat-identity && pnpm run test:coverage`. Record the reporter's `tests` count (pre-step count), `fail`/`cancelled`/`skipped`/`todo`, and the c8 text table. On a correct capture the table has **no** `identityServiceImpl` and **no** `authz` row: this is the **AC-4 RED**.
   - For each `src/__tests__/*.test.ts`, record the per-file assert count: `grep -o 'assert\.[A-Za-z]*(' <file> | wc -l`.

2. **AC-1 RED.**
   - Apply the base's mutation:
     - main-dev: delete the 4-line statement `src/grpc/identityServiceImpl.ts:524-527`.
     - #1262: delete the `AND rt.revoked_at IS NULL` line of the `rotateRefreshToken` claim (`e69e953d:…:353`). Re-grep it first: `grep -n "AND rt.revoked_at IS NULL" src/grpc/identityServiceImpl.ts` and pick the hit inside `rotateRefreshToken`.
   - Run `pnpm run test:coverage; echo "exit=$?"`. On the buggy runner it exits 0 and `rotates the refresh token and mints a new aud-bound access JWT` is reported passed. That is the RED: AC-1's mutation Then fails today.
   - Restore with `git checkout -- src/grpc/identityServiceImpl.ts`.
   - **If the mutated run already fails that test, the RED is absent.** Record it and stop and ask. `docs/roadmap/ledger/fails.md:2224` claims Node 24 strip-types loads these suites, and `product-spec.md:12-22` says it does not.

3. **AC-3 RED (identity row, captured for Step 3).**
   - Change the specifier at `src/__tests__/identityServiceImpl.test.ts:30` to `'../grpc/identityServiceImpl.missing'`.
   - Run `pnpm run test:coverage; echo "exit=$?"`. The buggy code exits 0 with that file's tests reported passed.
   - Restore with `git checkout -- src/__tests__/identityServiceImpl.test.ts`.

**B. Edits.**

4. **`package.json`.** Replace `:12-13` with the two lines from `services/xstockstrat-config/package.json:12-13`, byte-identical:
   ```json
       "test": "tsc && node --test dist/__tests__/*.test.js",
       "test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js",
   ```
   - No `--check-coverage`, no `--test-reporter`, no timeout and no force-exit flag (`design.md:27`, `:216`).
   - No dependency change.

5. **`tsconfig.json`.** Delete `:22` (`"src/**/*.test.ts"`) and the trailing comma after `"dist"` on `:21`. Make no other change: no reformatting, and no `rewriteRelativeImportExtensions` (rejected, `design.md:202`). Tests then emit to `dist/__tests__/`.

6. **`mtls.test.ts:13`** becomes `import * as mtls from '../mtls';`.

7. **`telemetry.test.ts:3`** becomes `import { buildResource } from '../telemetry';`.

8. **`telemetry.export.test.ts`.**
   - Delete `:5`, `:7` and `:8`.
   - Change `:9` to `const TELEMETRY = '../telemetry';`.
   - Change the `:31` comment to `// Node runtime warnings ("(node:<pid>) …") are not OTel output.`, keeping the `(node:` filter on `:32-33` unchanged.
   - No assertion changes in any file.

9. Leave the impl `before()` try/catch at `identityServiceImpl.test.ts:28-40` **untouched** in this step (`design.md:39`).

**C. Runner probe (one-off; `design.md:40-44`).**

10. In `services/xstockstrat-identity`, run `pnpm exec tsc`, then:
    ```
    perl -e 'alarm shift; exec @ARGV' 900 node --test --test-timeout=60000 dist/__tests__/*.test.js; echo "exit=$?"
    ```
    - This is a macOS-compatible wall-clock bound; exit `142` means SIGALRM, i.e. a hang. Do not pass `--test-force-exit`.
    - If the run hangs, re-run with `--test-force-exit` **only** to identify the file holding the event loop. A pass that only happens with force-exit is a hang finding: fix it with no assertion change, or stop and ask.
    - `tsc` type errors in test files are runner fallout (`recon.md:215-218`). Fix them with no assertion change, and only in this step's Files. An error in `identityServiceImpl.test.ts` (Step 3's file) is a stop-and-ask plus a Deviation Log entry with operator sign-off (§ Stop-and-ask).
    - A bcrypt native-binding load failure is a finding (`design.md:231`). Record it and stop and ask.

**D. Gate and GREEN.** Run the **Verification** below in full.

11. **AC-1 GREEN.**
    - Re-apply the same base mutation as in item 2.
    - `pnpm run test:coverage` must exit non-zero.
    - Then `node --test --test-reporter=tap dist/__tests__/identityServiceImpl.test.js | grep -n "not ok .*rotates the refresh token and mints a new aud-bound access JWT"` must give exactly one hit.
    - Restore with `git checkout -- src/grpc/identityServiceImpl.ts && pnpm exec tsc`.

**E. AC-6 RED (end of step; `design.md:45-48`).**

12. Run these in `services/xstockstrat-identity`:
    - `pnpm exec tsc`
    - Positive control: `node --test --test-reporter=tap dist/__tests__/identityServiceImpl.test.js; echo "exit=$?"` exits 0 with `# pass` above 0.
    - `rm dist/grpc/identityServiceImpl.js`
    - Rerun the same command. It exits 0 because the kept catch swallows the failure. That is AC-6's RED.
    - `pnpm exec tsc` to restore `dist/`.

13. Record in `context.md`, one line each:
    - the Node version and base;
    - the pre/post `tests` counts;
    - the AC-1, AC-3 and AC-4 RED results;
    - the AC-1 and AC-4 GREEN results (aggregate %, impl rows);
    - the AC-6 RED;
    - the c8 row naming (`src/` vs `dist/`);
    - the post-Step-2 outcome of the AC-3 bogus import (`tsc` TS2307 vs runtime), as context only (`design.md:204`).

**Verification**:
```bash
node --version                                    # v24.* (CI ci.yml:572); record it
pnpm --filter @xstockstrat/proto run build
cd services/xstockstrat-identity
pnpm build                                        # tsc incl. tests; exit 0 (feature 175 @AC-2/@AC-3)
ls dist/index.js dist/__tests__/identityServiceImpl.test.js dist/grpc/identityServiceImpl.js dist/grpc/authz.js
pnpm run lint                                     # exit 0
OUT="${TMPDIR:-/tmp}/252-identity-step2.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "test:coverage exit=${PIPESTATUS[0]}"   # 0
pnpm exec c8 check-coverage --lines 40; echo "check-coverage exit=$?"                   # 0; never add --all/--src/--allowExternal
pnpm exec c8 check-coverage --lines 101 2>&1 | grep -oE 'lines \([0-9.]+%\)'           # record-only, exit ignored: c8 prints the aggregate pct only on a miss (check-coverage.js:58-66); record it next to the table's All files % Lines (check-coverage builds its Report without excludeNodeModules/excludeAfterRemap/allowExternal/src, check-coverage.js:22-34 vs report.js:21-41); both >= 40
grep -E '^(ℹ|#) (tests|pass|fail|cancelled|skipped|todo) ' "$OUT"   # fail/cancelled/skipped/todo = 0; tests == pre-step count (same base)
grep -E 'All files' "$OUT"                        # numeric % Lines >= 40 (not "Unknown")
grep -E 'identityServiceImpl|authz' "$OUT"        # one row each, % Lines > 0
node --test --test-reporter=tap dist/__tests__/identityServiceImpl.test.js | grep -E '^# (pass|fail) '   # pass > 0, fail 0 (AC-1 first Then)
for f in src/__tests__/*.test.ts; do printf '%s ' "$f"; grep -o 'assert\.[A-Za-z]*(' "$f" | wc -l; done   # every count == pre-step count
grep -nE '\.(skip|todo)\(|(skip|todo): *true' src/__tests__/*.test.ts   # no hits
grep -rn '__tests__/fixtures' src/__tests__ || echo "C-13: no fixture home created; single-consumer inline mocks unchanged"
git status --short                                # only the 5 Files (+ feature/context/spec docs)
```

---

### Step 3 — test: identity — hard-fail subject imports, remove skip guards, add harness case

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence** (re-grepped at `ca8b9236`):
- **Header and banner.**
  - The file header is the JSDoc `:1-12`, which includes the skip rationale `:7-9` and `Run: node --experimental-strip-types …` `:11`.
  - The banner `:18-20` reads `// Lazy imports — guard against strip-only TypeScript syntax errors`.
- **Subject bindings `:22-26`.**
  - `let IdentityServiceImpl: any;`
  - `userIdFrom`
  - `first`
  - `isBlockedDefaultAdmin`
  - `SEED_ADMIN_PASSWORD_HASH`
- **Swallowed import.** `before(async () => {` `:28`, `try {` `:29`, body `:30-36`, `} catch {` `:37`, comment `:38`, `}` `:39`, `});` `:40`.
- **Guards.** `grep -c "if (!"` returns 65. All 65 are subject-missing guards:
  - 29 × `if (!impl) return;`;
  - 27 × `if (!IdentityServiceImpl) return;`;
  - 4 × `if (!IdentityServiceImpl) return null;` (`:56`, `:272`, `:692`, `:892`);
  - `if (!isBlockedDefaultAdmin) return;` `:129`;
  - `if (!userIdFrom) return;` `:648`, `:654`;
  - `if (!first) return;` `:660`, `:666`.
  - On #1262 `e69e953d` the count is 67. Every non-matching line was filtered and none remained.
- **Second silent skip** (proto regression test `:222-232`, `recon.md:46`, `:199-202`): `let TokenClaims: any;` `:227`, `try {` `:228`, `({ TokenClaims } = await import('@xstockstrat/proto/identity/v1/identity.js'));` `:229`, `} catch {` `:230`, `return; // proto package unavailable…` `:231`, `}` `:232`.
  - Exports map: `packages/proto/gen/ts/package.json:5-7` `"./*": "./dist/*.js"`. The `.js` specifier resolves at runtime to `…/identity.js.js`, so it fails.
  - Reuse: the extensionless form at `services/xstockstrat-identity/src/index.ts:6` (`'@xstockstrat/proto/identity/v1/identity'`).
- **`catch` / `try` inventory.**
  - main-dev: `catch` at `:37` and `:230` only (both subject/proto); `try {` at `:29`, `:143` (the `APPLICATION_ENV` try/finally in the seed-admin lockout test) and `:228`.
  - #1262 base: the same shape (`:29`, `:143`, `:228`).
- **Hard-fail precedent (mandatory reuse, `recon.md:107`).**
  - `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:15-17` (rationale comment), `:18-21` (bare `before()` import, no try/catch) and `:23-27` (`describe('test harness')`).
  - The `typeof Impl === 'function'` check comes from `docs/roadmap/ledger/fails.md:2226`.
- **Baselines.** Assert count is `grep -o 'assert\.[A-Za-z]*(' … | wc -l`: 145 on main-dev, 150 on #1262.
- **authz exports** (`src/grpc/authz.ts`): `first` `:14`, `userIdFrom` `:20`.
- **C-13.** The harness case adds no domain data. No fixture home is created.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4, AC-5, AC-6`. These are the identity rows of AC-3 and AC-6.

**Instructions**:

1. **Base and baselines.** Re-run the Step 2 base check (`grep -c "private async rotateRefreshToken" src/grpc/identityServiceImpl.ts`). On the post-Step-2 tree, record:
   - the `tests` count (pre-step count);
   - this file's assert count.

2. **Proto regression, RED then GREEN** (`design.md:52-54`).
   - Delete `:228` (`try {`) and `:230-232` (`} catch {` / `return; …` / `}`). Keep `:227` and `:229` with the `.js` specifier.
   - Run `pnpm run test:coverage`. **RED**: `returns Date timestamps that ts-proto encodes without throwing` fails with `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND`. If `tsc` rejects the specifier instead, record that.
   - Then change the specifier to `'@xstockstrat/proto/identity/v1/identity'` → **GREEN**.

3. **Hard-fail subject import** (`design.md:55-61`).
   - Replace `:28-40` with the block below. The body is unchanged from `:30-36`, minus the try/catch, and keeps the `.js` subject specifiers (`recon.md:110`):
     ```ts
     // This import must throw on failure — never wrap it in try/catch or early-return on a
     // missing subject; a swallowed import turns every case into a silent pass.
     before(async () => {
       const mod = await import('../grpc/identityServiceImpl.js');
       IdentityServiceImpl = mod.IdentityServiceImpl;
       isBlockedDefaultAdmin = mod.isBlockedDefaultAdmin;
       SEED_ADMIN_PASSWORD_HASH = mod.SEED_ADMIN_PASSWORD_HASH;
       const authz = await import('../grpc/authz.js');
       userIdFrom = authz.userIdFrom;
       first = authz.first;
     });
     ```
   - Keep the `let … : any` bindings `:22-26` (`design.md:55`, C-18 trade-off `:173`).
   - Delete the banner `:18-20`. The constraint comment supersedes it.

4. **Harness case** (`design.md:62-64`). Insert this directly after the `before()` block:
   ```ts
   describe('test harness', () => {
     it('imports the implementation under test', () => {
       assert.strictEqual(typeof IdentityServiceImpl, 'function', 'IdentityServiceImpl must import — never skip silently');
       assert.strictEqual(typeof userIdFrom, 'function', 'authz.userIdFrom must import — never skip silently');
     });
   });
   ```

5. **Remove every subject-missing guard** (`design.md:65`).
   - main-dev base: all 65 `if (!…)` lines above, which leaves the 4 helpers returning their impl unconditionally.
   - #1262 base: also the 2 guards inside `${method} rotation is single-use`, so 67 in total, and keep its `:495` assertion.
   - No other line in any test body changes.

6. **Header** (`design.md:66`). Replace the JSDoc `:1-12` with this one line:
   ```ts
   // Unit tests for IdentityServiceImpl and authz — pool and config are inline mocks; no real DB.
   ```

7. **AC-6 GREEN** (identity row).
   - `pnpm exec tsc`
   - Positive control: `node --test --test-reporter=tap dist/__tests__/identityServiceImpl.test.js` exits 0 with `# pass` above 0.
   - `rm dist/grpc/identityServiceImpl.js`
   - Rerun. It must exit non-zero and print `# pass 0`.
   - `pnpm exec tsc`
   - If the output shape differs (for example, cancelled vs failed subtests), record it. Only the exit code and `# pass 0` are asserted (`design.md:226`).

8. **AC-3 GREEN** (identity row).
   - Change the `before()` specifier to `'../grpc/identityServiceImpl.missing'`.
   - `pnpm run test:coverage; echo "exit=$?"` must exit non-zero, and no test in this file is reported passed. Record whether `tsc` (TS2307) or the runtime rejected it.
   - Restore the `.js` specifier (re-apply item 3's text, then `git diff` must show only the intended Step 3 changes).

9. **AC-1 re-confirm.** Repeat Step 2 item 11 on the current base. The mutated run exits non-zero, and the rotation test is reported `not ok`. Restore.

10. Run the **Verification**. Any non-runner failure, or an aggregate below 40, is a stop-and-ask (§ Stop-and-ask).

11. Record in `context.md`:
    - the proto RED/GREEN;
    - the AC-6, AC-3 and AC-1 results. Label the AC-3 GREEN by mechanism. If `tsc` (TS2307) rejected the `.missing` specifier, mark it "non-discriminating for the `before()` hard-fail". AC-6 is then the discriminating FR-3 evidence;
    - the counts (expected absolute counts, context only: 75 on main-dev, 79 on #1262; `design.md:89`).

**Verification**:
```bash
node --version                                    # v24.*
pnpm --filter @xstockstrat/proto run build
cd services/xstockstrat-identity
pnpm build && pnpm run lint                       # both exit 0
OUT="${TMPDIR:-/tmp}/252-identity-step3.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "test:coverage exit=${PIPESTATUS[0]}"   # 0
pnpm exec c8 check-coverage --lines 40; echo "check-coverage exit=$?"                   # 0
pnpm exec c8 check-coverage --lines 101 2>&1 | grep -oE 'lines \([0-9.]+%\)'           # record-only, exit ignored: c8 prints the aggregate pct only on a miss (check-coverage.js:58-66); record it next to the table's All files % Lines (check-coverage builds its Report without excludeNodeModules/excludeAfterRemap/allowExternal/src, check-coverage.js:22-34 vs report.js:21-41); both >= 40
grep -E '^(ℹ|#) (tests|pass|fail|cancelled|skipped|todo) ' "$OUT"   # fail/cancelled/skipped/todo = 0; tests == pre-step count + 1
grep -E 'All files' "$OUT"                        # numeric % Lines >= 40
grep -E 'identityServiceImpl|authz' "$OUT"        # % Lines > 0 for each
F=src/__tests__/identityServiceImpl.test.ts
grep -c 'if (!' "$F"                              # 0
grep -n 'catch' "$F"                              # no hits (no catch wraps a subject/proto import; equivalent on main-dev and #1262 bases)
grep -n 'try {' "$F"                              # only the APPLICATION_ENV try/finally in the seed-admin lockout test
grep -n 'await import(' "$F"                      # subject .js x2 (before) + extensionless proto x1; none under a try
grep -o 'assert\.[A-Za-z]*(' "$F" | wc -l        # == pre-step count + 2; other test files unchanged
grep -nE '\.(skip|todo)\(|(skip|todo): *true' src/__tests__/*.test.ts   # no hits
grep -n 'strip-types\|gracefully skip\|Lazy imports' "$F"   # no hits
git status --short                                # only this file (+ feature/context/spec docs)
```

---

### Step 4 — service: ledger — compile-then-test runner (scripts, tsconfig, non-impl test imports)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-ledger/tsconfig.json` — modify
- `services/xstockstrat-ledger/src/__tests__/mtls.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/telemetry.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-grepped at `ca8b9236`; nothing under `services/xstockstrat-ledger/src` differs from `origin/main-dev`):
- **Scripts.**
  - `services/xstockstrat-ledger/package.json:13` is `"test": "node --experimental-strip-types --test src/__tests__/*.test.ts"`.
  - `:14` is `"test:coverage": "c8 --reporter=text --reporter=lcov --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts"`.
  - `:8` is `"build": "tsc"` and `:15` is `"lint": "eslint src --ext .ts"`.
  - Devdeps: `c8` `:39`, `ts-node` `:48`, `typescript` `:49`.
  - Reuse target: `services/xstockstrat-config/package.json:12-13` (byte-identical scripts).
- **tsconfig.** `services/xstockstrat-ledger/tsconfig.json` is byte-identical to identity's (`diff` empty): `:19-23` exclusion with `"src/**/*.test.ts"` at `:22`. `:11` `esModuleInterop` is needed by `pg-cursor`'s default import at `ledgerServiceImpl.ts:2`.
- **Non-impl imports.** The shapes match identity (`recon.md:84`):
  - `mtls.test.ts:13` `'../mtls.ts'`;
  - `telemetry.test.ts:3` `'../telemetry.ts'`;
  - `telemetry.export.test.ts:5`, `:7-9`, `:31`.
  - The ledger `telemetry.export.test.ts` and `telemetry.test.ts` are byte-identical to identity's (`diff` empty).
  - The ledger `mtls.test.ts` alone has the `@feature-210 @AC-6` rotated-leaf case at `:149` (`recon.md:85`). It is not changed.
- **Impl try/catch kept in this step** (`design.md:39`):
  - `ledgerServiceImpl.test.ts:21-29` (import `:23` `'../grpc/ledgerServiceImpl.js'`, catch `:26-28`);
  - `eventNotifier.test.ts:16-23` (import `:18` `'../services/eventNotifier.js'`, catch `:20-22`).
- **AC-2 mutation anchors** (`recon.md:86`, re-read):
  - The duplicate-key branch in `appendEvent` is `src/grpc/ledgerServiceImpl.ts:84` `if (claim.rows.length === 0) {` through `:105` `return;`, and the block closes at `:106` `}`.
    - The target test is `ledgerServiceImpl.test.ts:444` `idempotent path: returns the stored event on a duplicate key (no second insert)`. It asserts `resp.eventId === 'orig'` and that no `INSERT INTO ledger\.events` was issued.
    - The mutation deletes `:84-106` so the file still compiles. Deleting only `:84-105` leaves an orphan `}`, and `tsc` would fail for a syntax reason instead of the test failing.
  - `src/services/eventNotifier.ts:132` is `sub.onEvent(row);` inside `dispatch` `:119`. The target test is `eventNotifier.test.ts:82` `fans out an event to a matching subscriber`, which asserts `got.length === 1`.
- **Timing risk.**
  - The reconnect test `eventNotifier.test.ts:151-176` uses `reconnectDelayMs = 1` and `n.stop()`; the timer is at `eventNotifier.ts:113`.
  - CI `node-test` has no `timeout-minutes` (`ci.yml:534-591`; `design.md:232`).
- **Build/CI/c8.** The same anchors as Step 2 (`ci.yml:572`, `:579-580`, `:582-584`; c8 `parse-args.js:85-86`, `:103-104`, `:169-170`; `report.js:43`; `check-coverage.js:56-59`).
- **C-13.** No new domain literal and no fixture home (`recon.md:118`).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-4, AC-5`. AC-2 and AC-4 go green here. The ledger RED rows of AC-3 and AC-6 are captured here for Step 5.

**Instructions**:

**A. Pre-change captures** (unmodified tree, Node 24; never commit a mutation).

1. Record:
   - `node --version` (must be `v24.*`).
   - Run `pnpm --filter @xstockstrat/proto run build`, then `cd services/xstockstrat-ledger && pnpm run test:coverage`. Record the `tests` count (pre-step count), `fail`/`cancelled`/`skipped`/`todo`, and the c8 table. On a correct capture the table has **no** `ledgerServiceImpl` and **no** `eventNotifier` row: this is the **AC-4 RED**.
   - The per-file assert counts (`grep -o 'assert\.[A-Za-z]*(' <file> | wc -l` for each `src/__tests__/*.test.ts`).

2. **AC-2 RED, mutation (a).**
   - Find the branch by content first with `grep -n 'if (claim.rows.length === 0) {' src/grpc/ledgerServiceImpl.ts`. It is `:84`, and its closing `}` is `:106`.
   - The AC-2 text cites `:84-105` only to point at the branch. Feature 248 may shift these lines.
   - Delete the branch from that `if` through its matching `}` (`:84-106` at `ca8b9236`).
   - `pnpm run test:coverage; echo "exit=$?"` exits 0, and `idempotent path: returns the stored event on a duplicate key (no second insert)` is reported passed.
   - Restore with `git checkout -- src/grpc/ledgerServiceImpl.ts`.

3. **AC-2 RED, mutation (b).**
   - Re-grep it first with `grep -n 'sub.onEvent(row);' src/services/eventNotifier.ts`, because 248 rewrites `dispatch`. Then delete that line (`:132` at `ca8b9236`).
   - The same run exits 0, and `fans out an event to a matching subscriber` is reported passed.
   - Restore with `git checkout -- src/services/eventNotifier.ts`.

4. If either mutated run already fails its target test, the RED is absent. Record it and stop and ask (see Step 2 item 2, and `fails.md:2224` vs `product-spec.md:12-22`).

5. **AC-3 RED (ledger rows, captured for Step 5).** Do each row on its own, restoring with `git checkout -- <file>` after each:
   - `ledgerServiceImpl.test.ts:23` → `'../grpc/ledgerServiceImpl.missing'`;
   - `eventNotifier.test.ts:18` → `'../services/eventNotifier.missing'`.
   - Each `pnpm run test:coverage` exits 0, with that file's tests reported passed.

**B. Edits.**

6. **`package.json`.** Replace `:13-14` with the two lines from `services/xstockstrat-config/package.json:12-13`, byte-identical (see the Step 2 item 4 text). No other flag and no dependency change.

7. **`tsconfig.json`.** Delete `:22` (`"src/**/*.test.ts"`) and the trailing comma on `:21`. No other change.

8. **`mtls.test.ts:13`** becomes `import * as mtls from '../mtls';`.

9. **`telemetry.test.ts:3`** becomes `import { buildResource } from '../telemetry';`.

10. **`telemetry.export.test.ts`.**
    - Delete `:5`, `:7` and `:8`.
    - Change `:9` to `const TELEMETRY = '../telemetry';`.
    - Change the `:31` comment to `// Node runtime warnings ("(node:<pid>) …") are not OTel output.`, keeping the `(node:` filter.
    - No assertion changes.

11. Leave the `before()` try/catch in `ledgerServiceImpl.test.ts:21-29` and `eventNotifier.test.ts:16-23` **untouched**.

**C. Runner probe** (`design.md:40-44`).

12. Run `pnpm exec tsc`, then:
    ```
    perl -e 'alarm shift; exec @ARGV' 900 node --test --test-timeout=60000 dist/__tests__/*.test.js; echo "exit=$?"
    ```
    - Exit `142` means a hang. Do not pass `--test-force-exit`, except for a diagnosis-only re-run.
    - The `eventNotifier` reconnect case is the named timing risk. If it flakes, or holds the loop, it is a finding: fix it with no assertion change, or stop and ask.
    - `tsc` type errors in test files are runner fallout. For example, the `protected streamExportRows` override at `ledgerServiceImpl.test.ts:586` compiles only while the subject is `any` (`recon.md:76`). Fix them with no assertion change, and only in this step's Files. An error in `ledgerServiceImpl.test.ts` or `eventNotifier.test.ts` (Step 5's files) is a stop-and-ask plus a Deviation Log entry with operator sign-off (§ Stop-and-ask).

**D. Gate and GREEN.** Run the **Verification** in full.

13. **AC-2 GREEN.** Re-apply each mutation in turn:
    - (a): `pnpm run test:coverage` exits non-zero, and `node --test --test-reporter=tap dist/__tests__/ledgerServiceImpl.test.js | grep -n "not ok .*idempotent path: returns the stored event on a duplicate key"` gives exactly one hit.
    - (b): `pnpm run test:coverage` exits non-zero, and `node --test --test-reporter=tap dist/__tests__/eventNotifier.test.js | grep -n "not ok .*fans out an event to a matching subscriber"` gives exactly one hit.
    - Restore each with `git checkout -- <file> && pnpm exec tsc`.

**E. AC-6 RED (end of step).**

14. Run `pnpm exec tsc`. Then, for each pair below:
    - positive control: `node --test --test-reporter=tap <compiled_test>` exits 0 with `# pass` above 0;
    - `rm <compiled_subject>`;
    - rerun: it exits 0 (swallowed), which is the RED;
    - `pnpm exec tsc`.

    The pairs are:
    - `dist/__tests__/ledgerServiceImpl.test.js` / `dist/grpc/ledgerServiceImpl.js`
    - `dist/__tests__/eventNotifier.test.js` / `dist/services/eventNotifier.js`

15. Record in `context.md`:
    - the Node version;
    - the pre/post `tests` counts;
    - the AC-2, AC-3 and AC-4 RED results;
    - the AC-2 and AC-4 GREEN results;
    - the AC-6 REDs;
    - the probe outcome (including the reconnect test);
    - the c8 row naming;
    - the post-Step-4 AC-3 mechanism (context only).

**Verification**:
```bash
node --version                                    # v24.*
pnpm --filter @xstockstrat/proto run build
cd services/xstockstrat-ledger
pnpm build                                        # exit 0
ls dist/index.js dist/__tests__/ledgerServiceImpl.test.js dist/__tests__/eventNotifier.test.js dist/grpc/ledgerServiceImpl.js dist/services/eventNotifier.js
pnpm run lint                                     # exit 0
OUT="${TMPDIR:-/tmp}/252-ledger-step4.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "test:coverage exit=${PIPESTATUS[0]}"   # 0
pnpm exec c8 check-coverage --lines 40; echo "check-coverage exit=$?"                   # 0; never add --all/--src/--allowExternal
pnpm exec c8 check-coverage --lines 101 2>&1 | grep -oE 'lines \([0-9.]+%\)'           # record-only, exit ignored: c8 prints the aggregate pct only on a miss (check-coverage.js:58-66); record it next to the table's All files % Lines (check-coverage builds its Report without excludeNodeModules/excludeAfterRemap/allowExternal/src, check-coverage.js:22-34 vs report.js:21-41); both >= 40
grep -E '^(ℹ|#) (tests|pass|fail|cancelled|skipped|todo) ' "$OUT"   # fail/cancelled/skipped/todo = 0; tests == pre-step count
grep -E 'All files' "$OUT"                        # numeric % Lines >= 40
grep -E 'ledgerServiceImpl|eventNotifier' "$OUT"  # one row each, % Lines > 0
node --test --test-reporter=tap dist/__tests__/ledgerServiceImpl.test.js | grep -E '^# (pass|fail) '   # pass > 0, fail 0
node --test --test-reporter=tap dist/__tests__/eventNotifier.test.js | grep -E '^# (pass|fail) '       # pass > 0, fail 0
for f in src/__tests__/*.test.ts; do printf '%s ' "$f"; grep -o 'assert\.[A-Za-z]*(' "$f" | wc -l; done   # every count == pre-step count
grep -nE '\.(skip|todo)\(|(skip|todo): *true' src/__tests__/*.test.ts   # no hits
grep -rn '__tests__/fixtures' src/__tests__ || echo "C-13: no fixture home created; single-consumer inline mocks unchanged"
git status --short                                # only the 5 Files (+ feature/context/spec docs)
```

---

### Step 5 — test: ledger — hard-fail subject imports, remove skip guards, add harness cases

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-grepped at `ca8b9236`):
- **`ledgerServiceImpl.test.ts`.**
  - Header JSDoc `:1-10` (skip rationale `:5-7`, `Run: node --experimental-strip-types …` `:9`).
  - Banner `:14-16`, `// Lazy imports — guard against strip-only TypeScript syntax errors`.
  - Bindings `let LedgerServiceImpl: any;` `:18` and `let rowToEvent: any;` `:19`.
  - Swallowed import: `before(async () => {` `:21`, `try {` `:22`, body `:23-25`, `} catch {` `:26`, comment `:27`, `}` `:28`, `});` `:29`.
  - Guards: `grep -c "if (!"` returns 31:
    - 9 × `if (!LedgerServiceImpl) return;`;
    - 7 × `if (!h) return;`;
    - 9 × `if (!impl) return;`;
    - 4 × `if (!rowToEvent) return;`;
    - 2 × `if (!LedgerServiceImpl) return null;` (`makeImpl` `:45`, `makeExportImpl` `:568`).
  - Second silent skip (`rowToEvent serialization (regression)`): `let LedgerEvent: any;` `:729`, `try {` `:730`, `({ LedgerEvent } = await import('@xstockstrat/proto/ledger/v1/ledger.js'));` `:731`, `} catch {` `:732`, `return; …` `:733`, `}` `:734`.
  - `catch`: only `:26` and `:732`. `try {`: only `:22` and `:730`.
  - Assert count: 71.
- **`eventNotifier.test.ts`.**
  - Header JSDoc `:1-10` (`Run: …` `:9`).
  - `let EventNotifier: any;` `:14`.
  - Swallowed import: `before(async () => {` `:16`, `try {` `:17`, body `:18-19`, `} catch {` `:20`, comment `:21`, `}` `:22`, `});` `:23`.
  - Guards: 7 × `if (!EventNotifier) return;` (`:72`, `:83`, `:96`, `:112`, `:126`, `:139`, `:152`).
  - `catch`: only `:20`.
  - Assert count: 13.
- **Proto specifier.**
  - Exports map: `packages/proto/gen/ts/package.json:5-7`. `…/ledger.js` resolves to `dist/ledger/v1/ledger.js.js` at runtime, so it fails (`recon.md:199-201`).
  - Extensionless reuse: `services/xstockstrat-identity/src/index.ts:6` and `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:22`.
- **Precedents.** Hard-fail: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:15-27` (`recon.md:107`). Untyped mocks stay untyped (`recon.md:111`): `{}` as `ConfigWatcher` `:47`, the `streamExportRows` override `:586`, and `FakeClient` `eventNotifier.test.ts:27`, `:85`.
- **C-13.** The harness cases add no domain data. No fixture home is created.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-4, AC-5, AC-6`. These are the ledger rows of AC-3 and AC-6.

**Instructions**:

1. **Baselines.** On the post-Step-4 tree, record the `tests` count (pre-step count) and both files' assert counts. If feature 248's tests are present in either file (`git log --oneline -- src/__tests__/ledgerServiceImpl.test.ts src/__tests__/eventNotifier.test.ts` shows a 248 commit), de-guard them too, in the same way, and record that.

2. **Proto regression, RED then GREEN.**
   - In `ledgerServiceImpl.test.ts`, delete `:730` (`try {`) and `:732-734`. Keep `:729` and `:731` with the `.js` specifier.
   - Run `pnpm run test:coverage`. **RED**: `produces Date timestamps that ts-proto encodes without throwing` fails with `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND`. If `tsc` rejects it instead, record that.
   - Then change the specifier to `'@xstockstrat/proto/ledger/v1/ledger'` → **GREEN**.

3. **Hard-fail subject imports.**
   - In `ledgerServiceImpl.test.ts`, replace `:21-29` with:
     ```ts
     // This import must throw on failure — never wrap it in try/catch or early-return on a
     // missing subject; a swallowed import turns every case into a silent pass.
     before(async () => {
       const mod = await import('../grpc/ledgerServiceImpl.js');
       LedgerServiceImpl = mod.LedgerServiceImpl;
       rowToEvent = mod.rowToEvent;
     });
     ```
     and delete the banner `:14-16`.
   - In `eventNotifier.test.ts`, replace `:16-23` with:
     ```ts
     // This import must throw on failure — never wrap it in try/catch or early-return on a
     // missing subject; a swallowed import turns every case into a silent pass.
     before(async () => {
       const mod = await import('../services/eventNotifier.js');
       EventNotifier = mod.EventNotifier;
     });
     ```
   - Keep the `let … : any` bindings.

4. **Harness cases.** Insert one in each file, directly after its `before()`:
   ```ts
   describe('test harness', () => {
     it('imports the implementation under test', () => {
       assert.strictEqual(typeof LedgerServiceImpl, 'function', 'LedgerServiceImpl must import — never skip silently');
     });
   });
   ```
   In `eventNotifier.test.ts`, use the same case with `EventNotifier` / `'EventNotifier must import — never skip silently'`.

5. **Remove every subject-missing guard**: the 31 in `ledgerServiceImpl.test.ts`, which leaves `makeImpl` / `makeExportImpl` returning unconditionally, and the 7 in `eventNotifier.test.ts`. No other line in any test body changes.

6. **Headers.**
   - `ledgerServiceImpl.test.ts:1-10` becomes this one line:
     ```ts
     // Unit tests for LedgerServiceImpl — the pool is an inline mock routed by SQL text; no real DB.
     ```
   - `eventNotifier.test.ts:1-10` becomes this one line:
     ```ts
     // Unit tests for EventNotifier — a FakeClient stands in for pg.Client; no real DB.
     ```

7. **AC-6 GREEN** (two ledger rows). Run `pnpm exec tsc`. Then, for each pair from Step 4 item 14:
   - positive control exits 0 with `# pass` above 0;
   - `rm <compiled_subject>`;
   - the rerun exits non-zero and prints `# pass 0`;
   - `pnpm exec tsc`.
   Record the output shape.

8. **AC-3 GREEN** (two ledger rows). Do each row on its own:
   - point the `before()` specifier at `'../grpc/ledgerServiceImpl.missing'` (or `'../services/eventNotifier.missing'`);
   - `pnpm run test:coverage; echo "exit=$?"` must exit non-zero, with no test in that file reported passed;
   - record the mechanism;
   - restore item 3's text.

9. **AC-2 re-confirm.** Repeat Step 4 item 13 (both mutations). Each exits non-zero, with its target test reported `not ok`. Restore.

10. Run the **Verification**. Any non-runner failure (for example, mock/setup drift in `makeIdempotentPool` `:56`), or an aggregate below 40, is a stop-and-ask.

11. Record in `context.md`:
    - the proto RED/GREEN;
    - the AC-6, AC-3 and AC-2 results. Label each AC-3 GREEN by mechanism, as in Step 3 item 11. A `tsc` TS2307 rejection is non-discriminating for the `before()` hard-fail, and AC-6 is the discriminating evidence;
    - the counts (expected absolute count, context only: 47; `design.md:89`).

**Verification**:
```bash
node --version                                    # v24.*
pnpm --filter @xstockstrat/proto run build
cd services/xstockstrat-ledger
pnpm build && pnpm run lint                       # both exit 0
OUT="${TMPDIR:-/tmp}/252-ledger-step5.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "test:coverage exit=${PIPESTATUS[0]}"   # 0
pnpm exec c8 check-coverage --lines 40; echo "check-coverage exit=$?"                   # 0
pnpm exec c8 check-coverage --lines 101 2>&1 | grep -oE 'lines \([0-9.]+%\)'           # record-only, exit ignored: c8 prints the aggregate pct only on a miss (check-coverage.js:58-66); record it next to the table's All files % Lines (check-coverage builds its Report without excludeNodeModules/excludeAfterRemap/allowExternal/src, check-coverage.js:22-34 vs report.js:21-41); both >= 40
grep -E '^(ℹ|#) (tests|pass|fail|cancelled|skipped|todo) ' "$OUT"   # fail/cancelled/skipped/todo = 0; tests == pre-step count + 2
grep -E 'All files' "$OUT"                        # numeric % Lines >= 40
grep -E 'ledgerServiceImpl|eventNotifier' "$OUT"  # % Lines > 0 for each
for F in src/__tests__/ledgerServiceImpl.test.ts src/__tests__/eventNotifier.test.ts; do
  echo "== $F"
  grep -c 'if (!' "$F"                            # 0
  grep -n 'catch' "$F"                            # no hits (no catch wraps a subject/proto import)
  grep -n 'await import(' "$F"                    # subject .js in before() (+ extensionless proto in ledgerServiceImpl); none under a try
  grep -o 'assert\.[A-Za-z]*(' "$F" | wc -l      # == pre-step count + 1
  grep -n 'strip-types\|gracefully skip\|Lazy imports' "$F"   # no hits
done
grep -nE '\.(skip|todo)\(|(skip|todo): *true' src/__tests__/*.test.ts   # no hits
git status --short                                # only these 2 files (+ feature/context/spec docs)
```

---

### Step 6 — docs: Teardown — narrow the coverage-enforcement claims, file the follow-up defect, add the merge-order note, run the context audit

**Status**: `pending`
**Service**: `docs/`, `.claude/skills/sdd-qa/`, `.claude/skills/sdd-spec/`, root `CLAUDE.md`, the Node-leaf findings logs
**Files**:
- `.claude/skills/sdd-qa/reference/lang-node.md` — modify
- `.claude/skills/sdd-spec/reference/spec-template.md` — modify
- `docs/patterns/ci-overview.md` — modify
- `CLAUDE.md` — modify
- `services/xstockstrat-identity/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify
- `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md` — create
- `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.status` — create
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- **Teardown set.** `design.md:182-195`.
- **`.claude/skills/sdd-qa/reference/lang-node.md`.**
  - `:9` reads "Coverage via `c8 --lines 40`.".
  - `:11-32` is the "Two different runners" section. `:13-18` wrongly lists notify as strip-types; `:16-17` is `pnpm --filter xstockstrat-<ledger|identity|notify> run test` / `node --experimental-strip-types …`.
  - `:36` is the glob `src/__tests__/*.test.ts` (trap 1), which becomes false once all four use `dist/__tests__/*.test.js`. `:37` is the `sub/thing.test.ts` placement example.
  - `:54` is the `test:coverage` command line and `:58` reads "Threshold is 40% lines for all four".
- **`docs/patterns/ci-overview.md`.**
  - `:18` is the `` `node-test` (×4) `` row with `40%`.
  - `:56` reads "Node.js: `0%` shown in c8 table is a known TypeScript tooling artefact — tests do pass.".
  - `xstockstrat-ui`'s vitest threshold is enforced (`services/xstockstrat-ui/vitest.config.ts:29-33`; `ci.yml:559-562`). It is excluded from the narrowing (`design.md:186`).
- **`.claude/skills/sdd-spec/reference/spec-template.md:148`.** The Node-leaf row of the coverage table reads `` `cd services/<name> && pnpm run test:coverage` — confirm threshold passes ``. It is another "40% enforced" instance (C-10, impl-spec review 2026-10-20). It is the only `confirm threshold passes` hit in the file.
- **Root `CLAUDE.md:304`.** "Coverage thresholds: Go/Python/Node.js ≥40% (indicators ≥50%)." It is narrowed, not deleted (`design.md:188`).
- **Enforcement facts.**
  - No Node-leaf script passes `--check-coverage` (Step 2/4 scripts; `recon.md:194-195`).
  - c8 checks thresholds only with it (`report.js:43`, `parse-args.js:85-86`).
  - `node-test` never reads `matrix.coverage_threshold`; its entries are `ci.yml:552-562`, and only `:266` and `:401` (other jobs) read it.
- **Findings logs.**
  - The 252 report rows are at identity `:57` and ledger `:50`. Their tables carry the rule "A row stays here until its report is resolved" (identity `:49-50`). The 252 report is `triaged` (`docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.status`) and counts as resolved once `252` is `launched` (`.claude/skills/sdd-qa/reference/defect-filing.md`, `ref:` kinds), so its rows stay.
  - The tables to append to are:
    - identity `:52-57`;
    - ledger `:44-50`;
    - config `:45-51`;
    - notify `:50-58`.
  - Precedent: recording a report adds one row per affected service's findings log. Commit `0027fa17` added the 252 rows. The multi-service `2026-10-19-orphaned-code-defect` row appears in config `:51`, notify `:58` and ledger `:49`.
  - **Spec-time addition, not in `design.md:189`.** The follow-up defect affects all four Node leaves, so config and notify get the row too (C-10).
- **Defect format.** `.claude/skills/sdd-qa/reference/defect-filing.md` gives the template headings, the `.status` sidecar `open`, the "exactly one severity token" rule and the format check (`grep -oE 'SEV-[123]' … | sort -u`). Parent report severity: `SEV-3` (`product-spec.md:5`).
- **Overlap (impl-spec review 2026-10-20).** `084-droplet-compose-deploy` (`spec-ready`) FR-8 (`084 product-spec.md:63-64`) edits `docs/patterns/ci-overview.md` and root `CLAUDE.md`. `250-fix-otel-metrics-logs-gap` (`draft`) changes all 12 runtimes' telemetry only under fix (b) (`250 product-spec.md:40-41`).
- **`docs/roadmap/features/merge-order.md:121-138`.** The rebase-only note format (`> **Note on … — rebase-only, no hard ordering row.**` plus `> - **A ↔ B on <file>.**` bullets). Insertion point: after `:138`, before the `---` at `:140`.
- **Context audit.**
  - Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh`, or a manual reconciliation recorded in the PR body.
  - `.agents/context-forge.json:6` `scrubberExtraTargets`: `README.md`, `docs/patterns/ui-ux-governance.md`. Neither is touched.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. **Defect report.** Create `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md`, where `<filing-date>` is the ISO date the step runs. Use the template in `.claude/skills/sdd-qa/reference/defect-filing.md`.
   - Fields:
     - `**Recorded**: <filing-date>` (template `defect-filing.md:57`);
     - `**Severity**: SEV-3` — the only severity token in the file;
     - `**Impact type**: test-coverage-gap`;
     - `**Environment**: dev (main-dev)`;
     - `**Affected service(s)**: xstockstrat-config, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify`;
     - `**Config-only fix possible**: no`.
   - Sections:
     - **Observed:** each leaf's `test:coverage` passes `--lines 40` with no `--check-coverage`, so c8 never checks it. Cite the four `package.json` script lines as they stand after Steps 2 and 4, plus `report.js:43` and `parse-args.js:85-86`. `node-test` ignores `matrix.coverage_threshold` (`ci.yml:552-562` vs `:266`, `:401`).
     - **Expected:** CI fails a Node leaf below 40% lines.
     - **Reproduction:** run `pnpm run test:coverage` then `pnpm exec c8 check-coverage --lines 40` in one leaf, and compare the exit codes on a sub-40 tree.
     - **Evidence:** the `path:line` citations above.
     - **Root cause hypothesis:** the scripts were copied without `--check-coverage`.
     - **Confidence:** high.
   - Create the sidecar `<same-basename>.status` containing the single line `open`.

2. **`lang-node.md`.**
   - `:9`: append "— declared, not enforced: no script passes `--check-coverage` (see § Commands)."
   - Replace `:11-32` with a "One runner — compile first" section. All four services run `tsc && node --test dist/__tests__/*.test.js`. Keep the 074 (`fails.md` 2026-07-29) rationale sentence, and note that identity and ledger followed in feature 252. State that tests are in the `tsc` program, so a `.ts`-suffixed import (TS5097, `fails.md:2239`) or `import.meta` in a test breaks `pnpm build`.
   - `:36`: change the glob to `dist/__tests__/*.test.js`. The `:37` placement example stays.
   - After `:54`, add `pnpm --filter xstockstrat-<svc> exec c8 check-coverage --lines 40   # right after test:coverage — the only enforcing check`.
   - `:58`: becomes "40% lines is declared for all four but not enforced by CI; check it with the `check-coverage` line above. Follow-up: `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md`. `docs/patterns/ci-overview.md` is the reference."

3. **`ci-overview.md`.**
   - `:18`: change the threshold cell `40%` to `40% declared, not enforced (no \`--check-coverage\`; follow-up defect)`. Leave the other cells.
   - `:56`: becomes "Node.js leaves (config, ledger, identity, notify): tests run compiled (`tsc && c8 … node --test dist/__tests__/*.test.js`), and the c8 table has a non-zero row per impl module. `--lines 40` is unenforced without `--check-coverage`; verify with `pnpm exec c8 check-coverage --lines 40` after `test:coverage` (follow-up defect `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md`)." Do not narrow the `xstockstrat-ui` vitest gate.

3a. **`spec-template.md:148`.** In the Node-leaf row, change the command cell to `` `cd services/<name> && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40` — `--lines 40` in the script alone is not enforced (follow-up defect) ``. Leave the `40%` cell and the other rows unchanged.

4. **Root `CLAUDE.md:304`.** Change "Coverage thresholds: Go/Python/Node.js ≥40% (indicators ≥50%)." to "Coverage thresholds: Go/Python ≥40% (indicators ≥50%); the Node.js leaves declare 40% but CI does not enforce it (no `--check-coverage` — see `docs/patterns/ci-overview.md`)." Leave the rest of the line.

5. **Findings logs.** In each of the four files, append this row as the last row of the "Filed as defect reports" table:
   ```
   | [`<filing-date>-node-leaf-c8-check-coverage-unenforced-defect`](../../../docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md) | Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`) |
   ```
   The files are identity (after `:57`), ledger (after `:50`), config (after `:51`) and notify (after `:58`). Leave the 252 rows at identity `:57` and ledger `:50` unchanged.

6. **`merge-order.md`.** After `:138`, insert one blank line and then this blockquote:
   ```
   > **Note on 252 `fix-identity-ledger-test-suites` ↔ hotfix #1262 / 248 / 084 / 250 / 241 — rebase-only, no hard ordering row.**
   > 252 makes the identity and ledger impl suites execute (compile-then-test) and deletes every
   > `if (!<subject>) return;` skip guard. None of the overlaps is a field-number / migration / config-key collision:
   >
   > - **#1262 `hotfix/fix-refresh-token-rotation` ↔ 252 on `identityServiceImpl.test.ts`.** #1262 adds two
   >   `if (!impl) return;` guards in `${method} rotation is single-use`; whoever lands second deletes them and
   >   keeps the conditional-claim regex assertion.
   > - **248 `fix-ledger-trimmed-notify-payload` ↔ 252 on `ledgerServiceImpl.test.ts` / `eventNotifier.test.ts`.**
   >   248 writes its tests unguarded (a guarded case is a silent pass once 252 lands); whoever lands second
   >   de-guards and merges the other's test changes.
   > - **084 `droplet-compose-deploy` ↔ 252 on root `CLAUDE.md` and `docs/patterns/ci-overview.md`.** 084 FR-8
   >   rewrites both for the deploy topology; 252 narrows only the coverage sentence (`CLAUDE.md` CI/CD Overview)
   >   and the `node-test` row + Node.js tooling bullet (`ci-overview.md`). Different sections; whoever lands
   >   second rebases.
   > - **250 `fix-otel-metrics-logs-gap` ↔ 252 on identity/ledger `telemetry*.test.ts` (conditional).** Only under
   >   250's fix (b), which changes every runtime's telemetry module. 252 changes only those tests' import specifiers
   >   and the strip-types shim; whoever lands second keeps 252's extensionless imports.
   > - **241 `fix-config-audit-author-spoof`** — no overlap (config + agent only).
   ```

7. **Context audit.**
   - Run `/context-forge:context-constitution refresh`, scoped to the files touched by Steps 2–6.
   - Fix the grounded drift it reports **within this step's Files**. Drift in any other file is recorded in `context.md` and the PR body for a follow-up, never staged here (F-08).
   - If the plugin is unavailable, do it by hand: re-read every file in this step's Files plus `services/xstockstrat-{identity,ledger}/CLAUDE.md` against the post-Step-5 code. Record in the PR body both that the plugin was unavailable and what you reconciled (root `CLAUDE.md` § Teardown; `fails.md:670`).

8. Write a ledger line (`insights.md` or `fails.md`) only if the execution surfaced a new reusable pattern or trap. If so, record it under F-08.

**Verification**:
```bash
R=docs/reports; B=$(ls $R | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}-node-leaf-c8-check-coverage-unenforced-defect\.md$' | sed 's/\.md$//')
echo "$B"                                         # exactly one basename
grep -oE 'SEV-[123]' "$R/$B.md" | sort -u         # exactly one line: SEV-3
grep -n '^\*\*Recorded\*\*:' "$R/$B.md"                  # 1 hit
grep -n '^\*\*Severity\*\*:' "$R/$B.md"
grep -nE '^## (Observed|Expected|Reproduction|Evidence|Root cause hypothesis|Confidence)$' "$R/$B.md"   # 6 headings
head -1 "$R/$B.status"                            # open
grep -n 'experimental-strip-types --test' .claude/skills/sdd-qa/reference/lang-node.md   # no hits
grep -n 'check-coverage' .claude/skills/sdd-qa/reference/lang-node.md docs/patterns/ci-overview.md CLAUDE.md   # >= 1 hit each
grep -n 'tooling artefact' docs/patterns/ci-overview.md                                  # no hits
grep -n 'confirm threshold passes' .claude/skills/sdd-spec/reference/spec-template.md    # no hits
grep -n 'c8 check-coverage --lines 40' .claude/skills/sdd-spec/reference/spec-template.md   # 1 hit (Node-leaf row)
grep -n 'Go/Python/Node.js ≥40%' CLAUDE.md                                               # no hits
grep -c "$B" services/xstockstrat-identity/docs/context-constitution-findings.md services/xstockstrat-ledger/docs/context-constitution-findings.md services/xstockstrat-config/docs/context-constitution-findings.md services/xstockstrat-notify/docs/context-constitution-findings.md   # 1 line (the new row) per file
grep -c '2026-10-20-node-impl-test-suites-never-load-impl-defect' services/xstockstrat-identity/docs/context-constitution-findings.md services/xstockstrat-ledger/docs/context-constitution-findings.md   # unchanged: 1 line each
grep -n 'fix-identity-ledger-test-suites' docs/roadmap/features/merge-order.md          # the new note
git status --short                                # only this step's Files (+ feature/context/spec docs, ledger if written)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
