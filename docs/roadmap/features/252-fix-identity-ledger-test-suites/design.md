# Design: fix-identity-ledger-test-suites

**Created**: 2026-10-20
**Rounds**: 4 (full; termination: auto-approved under operator standing authorization 2026-10-20)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-20 (`context.md`, § Session 2026-10-20 — sdd-review product-spec, "Operator decisions")
**Grounded in**: recon.md

Gate conditions met: 4 rounds (≥ 2), no unresolved Floor breach, no blocking objection, no CHANGE to a durable `@AC` rule.
Round 3 left one blocker: AC-4/FR-4 held vacuously under path (b). Round 4 reworded AC-4/FR-4 to close it, and the round-4 adversary verdict was SOUND.

Bases: authoritative artifacts are on `origin/feature/fix-identity-ledger-test-suites` @ `968e9e8c`. The #1262 base is `origin/hotfix/fix-refresh-token-rotation` @ `e69e953d`. The working-tree main-dev `acceptance.feature` is the older text. Do not edit it; `/sdd-sync` reconciles it.

---

## Chosen Approach

**Internal-only.** There is no consumer surface (C-14). This is test tooling plus c8 scope, with no runtime behaviour change (`product-spec.md:78-80`). There are no proto, migration, config, `ci.yml`, Dockerfile or lockfile changes.

Five steps: **identity A**, **identity B**, **ledger A**, **ledger B**, **teardown**.

### Step A — runner (per service)

1. **Scripts.**
   - identity `package.json:12-13` and ledger `package.json:13-14` (`recon.md:37`, `:67`) become byte-identical to `services/xstockstrat-config/package.json:12-13` (`recon.md:101-104`):
     - `"test": "tsc && node --test dist/__tests__/*.test.js"`
     - `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
   - No `--check-coverage`, `--test-reporter` or timeout flag goes into any script (path (b)).
   - No new dependency: `typescript`, `c8` and `ts-node` are already devDependencies (`recon.md:104`).
2. **tsconfig.**
   - Drop `"src/**/*.test.ts"` from `exclude` at `tsconfig.json:19-23` in both services (`recon.md:39`, `:68`), matching `services/xstockstrat-config/tsconfig.json:14-15` (`recon.md:105`).
   - `rootDir` is `./src`, so tests emit to `dist/__tests__` and the subjects to `dist/grpc` / `dist/services`.
3. **Non-impl imports** (no assertion changes; `recon.md:50-51`, `:84`, `:112-114`):
   - `mtls.test.ts:13` → `'../mtls'`.
   - `telemetry.test.ts:3` → `'../telemetry'`.
   - `telemetry.export.test.ts`:
     - delete `:5` (`createRequire`) and `:7-8` (the ESM shim). `import.meta` fails `tsc` under `module: commonjs` (`recon.md:205`).
     - set `TELEMETRY = '../telemetry'` at `:9`.
     - in the `:31` comment, drop the stale "MODULE_TYPELESS_PACKAGE_JSON under strip-types" example but keep the `(node:` filter. Both services.
4. **The impl `before()` try/catch stays in Step A**: identity `recon.md:44`, ledger `:73`, eventNotifier `:80`. Removing it here would destroy AC-6's only discriminating RED.
5. **First in-tree probe (one-off).**
   - Run `pnpm --filter @xstockstrat/proto run build` (`ci.yml:579-580`, `recon.md:93`).
   - Then run `node --test --test-timeout=60000 dist/__tests__/*.test.js` under a macOS-compatible wall-clock bound, e.g. `perl -e 'alarm shift; exec @ARGV' 900 …`, not GNU `timeout`.
   - Do not pass `--test-force-exit`. If the run does not exit, re-run with `--test-force-exit` only to find the file holding the event loop.
   - A pass that happens only with force-exit is a **hang finding**. It is runner fallout: fix it with no assertion change, or stop-and-ask if the fix would touch an assertion. This is the `fails.md:115-133` hang shape (`recon.md:238`).
6. **End-of-Step-A AC-6 RED.**
   - Delete the compiled subject and run `node --test --test-reporter=tap <compiled_test>`. It exits 0 because the catch swallows the failure.
   - This is the only discriminating RED the tdd-gate accepts for AC-6.
   - On the buggy base the result is "Could not find". That is an unmet Given and is recorded as context only.

### Step B — hardening (per impl test file)

1. **Proto regression test first** (`identityServiceImpl.test.ts:227-232`, `ledgerServiceImpl.test.ts:729-734`; `recon.md:46`, `:78`, `:199-202`).
   - Remove `catch { return; }` and keep the `.js` specifier. RED: `MODULE_NOT_FOUND` (exports map `recon.md:97`).
   - Switch to the extensionless specifier, as in `services/xstockstrat-identity/src/index.ts:6` (`recon.md:115`). GREEN.
2. **Delete the `before()` try/catch**: identity `:29-39` (block `:28-40`), ledger `:22-28`, eventNotifier `:17-22`. Keep the `let X: any` bindings (`recon.md:43`, `:72`, `:80`, `:111`).
3. **Constraint comment.** Put this 2-line comment directly above each of the three `before()` hooks:
   ```ts
   // This import must throw on failure — never wrap it in try/catch or early-return on a
   // missing subject; a swallowed import turns every case into a silent pass.
   ```
   It is the precedent at `configServiceImpl.test.ts:15-17` (`recon.md:107`), cut to 2 lines (CLAUDE.md How-to-Act #5).
4. **Harness case.** Add one `describe('test harness')` case per file: `assert.strictEqual(typeof X, 'function', …)`. In identity it also checks `userIdFrom`.
   - That is 1 case in identity and 2 in ledger (`ledgerServiceImpl` and `eventNotifier`).
   - The `typeof Impl === 'function'` tell comes from `fails.md:2223-2226` (`recon.md:240`).
5. **Remove every subject-missing guard**: identity 65 (+2 on a #1262 base), ledger 31, eventNotifier 7 (`recon.md:45`, `:74`, `:82`, `:227`).
6. **Shrink each file header to ≤ 2 lines** (`recon.md:234`).
7. **Scoped grep gate**: no `catch` may wrap a subject or proto import.

### Per-step gate

Run in `services/<svc>` on **Node 24**, matching CI (`ci.yml:572`, `recon.md:92`). Record the Node version in the evidence. Commands, in order:

1. `pnpm --filter @xstockstrat/proto run build`. The identity impl needs proto `dist` (`ledgerAudit.ts:8`, `recon.md:31-34`, `:177`).
2. `pnpm build`. This keeps feature 175 `@AC-2`/`@AC-3` honest (`recon.md:206`, `:244`).
3. `pnpm run lint`
4. `pnpm run test:coverage`
5. Immediately after, `pnpm exec c8 check-coverage --lines 40`.
   - The flag must be explicit: the default is 90 (`node_modules/.pnpm/c8@10.1.3/node_modules/c8/lib/parse-args.js:103-104`).
   - The subcommand reads `coverage/tmp`. `bin/c8.js:22-23` cleans it only before a wrapped run, and `parse-args.js:169-170` defaults `tempDirectory` to `<reportsDir>/tmp`.
   - Never add `--all`, `--src` or `--allowExternal`.

The evidence must show all of the following:

- **Coverage check.** The `check-coverage` subcommand exits 0.
- **Aggregate.** The text table shows a **numeric** All files `% Lines` of at least 40. This matters because `'Unknown' < 40` is false, so an empty map passes (`check-coverage.js:56-59`).
- **Impl rows.** Rows are non-zero for `identityServiceImpl` and `authz` (identity), and for `ledgerServiceImpl` and `eventNotifier` (ledger).
- **Clean summary.** There are zero failed, cancelled, skipped and todo tests, in whatever format the reporter prints. Node 24's default non-TTY reporter is `spec` (changed in v23.0.0), so the summary reads `ℹ fail 0`, not `# fail 0`.
- **Test count.** Verify it with a relative formula: post-step count = pre-step count on the same base + harness cases added (identity +1, ledger +2).
  - The absolute counts are context only and live in `context.md`, never in a frozen step Verification (F-09). They are identity 75 (79 on #1262) and ledger 47.
- **Assert counts.** A per-file assert-count diff reads "unchanged + harness".

**AC-1 RED** is a captured mutated run on whichever base the step executes. A re-grep does not count.

| Base | Mutation | Why it discriminates |
|---|---|---|
| main-dev | Delete the revoke UPDATE at `identityServiceImpl.ts:524-527` (`recon.md:53`). | Test `:417` asserts `/UPDATE identity\.refresh_tokens SET revoked_at/`, and only that statement matches. |
| #1262 (`e69e953d`) | Drop `AND rt.revoked_at IS NULL` at hotfix `:353`. | `rotateRefreshToken` (`:340-372`) is called from `refreshOAuthToken` at `:530`. The hotfix test regex `:495`, `/SET revoked_at = NOW\(\)[\s\S]*revoked_at IS NULL/`, then matches no query, because `issueRefreshToken` is an INSERT (`:321-334`). |

Re-grep these anchors at spec time.

**AC-2 RED** uses the recon anchors: `ledgerServiceImpl.ts:84-105` → test `:444`, and `eventNotifier.ts:132` → `eventNotifier.test.ts:82` (`recon.md:86`).

### Stop-and-ask (P-03) — resolves FR-5 vs AC-5 (`recon.md:220`)

The following failures are recorded in `context.md`, filed as a defect report, and taken to the operator:

1. an impl regression;
2. a stale assertion;
3. **mock or setup drift**, meaning a mock or fixture that no longer matches the impl's SQL or shape (e.g. the SQL-routing pool at `ledgerServiceImpl.test.ts:56`, `recon.md:77`);
4. an aggregate `% Lines` below 40 once the impl loads.

For any of these, nobody deletes, skips or weakens a test, lowers the threshold, or adds tests ad hoc.

Failures caused by the runner change itself (tooling, mtls, telemetry, hangs) are fixed with no assertion change. The feature does not reach `code-completed` while any test fails or the aggregate is below 40.

### Requirement amendment (C-15) — verbatim text

These are edits to the unlaunched feature's own scenarios. IDs stay stable. None changes a durable rule.

**Owner and timing:**
- The orchestrator applies the amendment to the **feature-branch** `acceptance.feature` and `product-spec.md` at design completion, before `/sdd-spec`. It records it in `context.md` (as a requirement amendment) and in the `feature.md` Status History.
- If the workflow cannot write those files at design time, the **first spec step owns the edit**, with both files in its **Files** (F-08). The spec's coverage map then traces the amended text.
- Either way, the amendment must land before impl-spec review. AC-6 must be covered there (C-15).

**AC-4 — reworded in place:**
```gherkin
  @AC-4 @FR-4 @regression
  Scenario: the coverage gate measures the implementation
    Given each service's c8-wrapped "pnpm run test:coverage" run
    When "pnpm run test:coverage" runs in services/xstockstrat-identity and services/xstockstrat-ledger
    Then the identity coverage report has a row with non-zero line coverage for identityServiceImpl and for authz
    And the ledger coverage report has a row with non-zero line coverage for ledgerServiceImpl and for eventNotifier
    And "c8 check-coverage --lines 40", run in each of those services right after its run, exits 0 and the report shows a numeric All files % Lines of at least 40
    # Rows are matched by module name, whether c8 reports them under src/ or dist/.
```

**FR-4 (`product-spec.md:66`) — narrowed:**
> FR-4. The c8 coverage report measures the impl modules (a non-zero row for each), and `c8 check-coverage --lines 40` run after `test:coverage` exits 0 over a numeric aggregate. The scripts' `--lines 40` flag alone enforces nothing (unenforced in all four Node leaves; follow-up defect report).

**AC-6 — appended:**
```gherkin
  @AC-6 @FR-3 @regression
  Scenario Outline: a compiled test whose compiled subject is missing fails instead of passing
    Given "tsc" has completed in services/<service>
    And "node --test --test-reporter=tap <compiled_test>" exits 0 with a "# pass" count above 0
    When <compiled_subject> is deleted and "node --test --test-reporter=tap <compiled_test>" runs again
    Then the command exits non-zero
    And the TAP summary reports "# pass 0"

    Examples:
      | service              | compiled_test                              | compiled_subject                 |
      | xstockstrat-identity | dist/__tests__/identityServiceImpl.test.js | dist/grpc/identityServiceImpl.js |
      | xstockstrat-ledger   | dist/__tests__/ledgerServiceImpl.test.js   | dist/grpc/ledgerServiceImpl.js   |
      | xstockstrat-ledger   | dist/__tests__/eventNotifier.test.js       | dist/services/eventNotifier.js   |
```

**AC line (`product-spec.md:85`):** add "AC-6 (FR-3)" after "AC-4 (FR-4)".

**AC-1 — last line reworded by behaviour.** The base-specific mutations stay in step Verification only:
```gherkin
    And a mutation that removes single-use revocation of the presented refresh token in refreshOAuthToken makes the "rotates the refresh token and mints a new aud-bound access JWT" test fail
```

**AC-5 — the Then becomes reporter-neutral.** The no-delete/skip/todo/assertion-removal line is kept:
```gherkin
    Then the test summary reports 0 failed tests
```

**AC-2 and AC-3** stay as written.

### Trade-off records (C-18)

- **`any` bindings.** A renamed export still fails `tsc` as TS2339 at the unannotated `mod`. Only the constructor and call shapes go unchecked, plus the protected override at `ledgerServiceImpl.test.ts:586` (`recon.md:76`, `:210-214`).
- **Tests in the production build.** The production `tsc` (`Dockerfile:24`) now type-checks the tests, and `dist/__tests__` ships in the image (`Dockerfile:27`, `:32`; `recon.md:56`, `:207-209`). This is accepted for parity with config/notify. The alternative, `tsconfig.test.json`, is rejected.
- **Path (b) cost.**
  - If the aggregate falls below 40, (a) and (b) stall the feature the same way: red CI under (a), stop-and-ask under (b).
  - What (b) actually costs: CI never runs `c8 check-coverage` (`recon.md:91`, `:193-198`). After launch, a drop below 40% passes CI until the follow-up defect lands. The promoted `@regression` AC-4 is checked only at manual verification. This partly repeats `fails.md:1948`.
  - The follow-up defect report is `docs/reports/<filing-date>-node-leaf-c8-check-coverage-unenforced-defect.md` plus a `.status` of `open`, filed in teardown. It covers all four Node leaves.
- **Preview provenance.** The "mtls passed" result and `ledgerAudit.js` at 38.88% are **mediator-preview observations**: Node 22.22.0, out of tree, try/catch kept. They are advisory only and are not in-tree evidence. Recon executed nothing (`recon.md:9`). The in-tree Node 24 numbers have not been observed yet.
- **Runner-up.** Path (a), `--check-coverage` in the identity and ledger scripts only. It needs operator sign-off recorded in `context.md` (C-10).

### Teardown step (each file in some step's Files, F-08)

- `.claude/skills/sdd-qa/reference/lang-node.md:9,11-32,54,58` (`recon.md:231`).
- `docs/patterns/ci-overview.md`:
  - `:18`: narrow the 40% claim to "declared, not enforced", for the four Node leaves **only**. The `xstockstrat-ui` vitest threshold is enforced (`ci.yml:559-562`).
  - `:56`: rewrite the "0% … tests do pass" note (`recon.md:232`).
- Root `CLAUDE.md` § CI/CD, "Node.js ≥40%": narrow it, do not delete it.
- Findings rows: `services/xstockstrat-identity/docs/context-constitution-findings.md:57` and `services/xstockstrat-ledger/docs/context-constitution-findings.md:50` (`recon.md:233`).
- New defect report plus `.status` (`open`): `--check-coverage` is unenforced in all four Node leaves.
- `docs/roadmap/features/merge-order.md`: a rebase-only note in the `:121-133` format.
  - **#1262**: whoever lands second removes the 2 guards and keeps `:495`.
  - **248**: writes its tests unguarded; whoever lands second de-guards and merges.
  - **241**: no overlap (`recon.md:227-229`).
- `/context-forge:context-constitution refresh`, or a manual reconciliation recorded in the PR body (`recon.md:242`; root `CLAUDE.md` § Teardown).

## Rejected Alternatives

- **`tsx` loader** — rejected. It adds a devDependency and changes the root lock (Dockerfile `--frozen-lockfile` vs CI `--no-frozen-lockfile`), and it does not type-check (`recon.md:185-186`).
- **`--experimental-transform-types` with explicit `.ts` imports** — rejected. It needs extension rewrites in the impl, keeps the `.nvmrc` 22 vs CI 24 split, and does not type-check (`recon.md:268`, `:225`).
- **`tsconfig.test.json`** — rejected. No Node service uses that shape (`recon.md:209`, `:249`), and it drifts from config/notify (DRY). Its trade-off is recorded above.
- **`rewriteRelativeImportExtensions` / `allowImportingTsExtensions`** — rejected. They change production compiler options for every file to fix 6 test specifiers (`recon.md:187`).
- **Static import plus `as any` casts** (notify precedent b) — rejected. The diff is bigger, and the protected override `:586` needs a cast (`recon.md:108`, `:213`). A bare `before()` import plus a harness case and a constraint comment is the minimum.
- **Relying on `tsc` TS2307 alone as FR-3 evidence** — rejected. It gives the same result with and without the runtime hardening (`fails.md:2226`; `recon.md:221-224`). AC-6 exists for this reason.
- **Path (a), `--check-coverage` in the identity and ledger scripts only** — runner-up. It gives real CI enforcement, but breaks parity with config/notify and needs C-10 operator sign-off.
- **`--check-coverage` in all four Node leaves, or `ci.yml` `matrix.coverage_threshold` enforcement** — rejected. It breaches "No CI workflow change" (`product-spec.md:75-76`) and the config/notify Out of Scope (`product-spec.md:96`), and config/notify coverage is unmeasured. Deferred to the follow-up defect.
- **Keeping AC-4's "script `--lines 40` threshold still passes" wording** — rejected. It is vacuous under (b), because `report.js:43` checks thresholds only with `checkCoverage` (`recon.md:116`, `:197`; `fails.md:1948`).
- **Running the `check-coverage` subcommand without reading the numeric aggregate and the non-zero rows** — rejected. It passes on an empty map, because `'Unknown' < 40` is false (`check-coverage.js:56-59`).
- **AC-6 with only a negative Then, or pinned to `# tests`/`# fail` counts** — rejected. The first is unattributable; the second over-specifies the mechanism. A positive control plus the exit code plus `# pass 0` is enough.
- **Counting the buggy-base "control step fails" as AC-6's RED** — rejected. It is an unmet Given. Only the end-of-Step-A deletion run discriminates.
- **AC-6 via a stub subject that throws at load** — rejected. It adds a new fixture to maintain (C-13; `recon.md:118`).
- **A literal "zero `catch`" grep gate** — rejected as too broad. It is scoped to subject and proto imports, which is equivalent on both verified bases.
- **AC-1 with line-number anchors in `acceptance.feature`** — rejected. The anchors are base-dependent and frozen by F-09. The AC uses behavioural wording, and the base-specific mutations live in step Verification.
- **Removing the whole claim UPDATE as the #1262-base AC-1 mutation** — rejected. The test would then fail via the `invalid_grant` path, a different cause. Dropping `:353` is verified to discriminate against `:495`.
- **A base-independent AC-1 mutation via the `aud` binding** — rejected. It moves AC-1 off the rotation rule the bug was found on (IDENTITY-4, `recon.md:166`).
- **Permanent `--test-timeout` / `--test-force-exit` / `--test-reporter=tap` in the scripts** — rejected. They diverge from config/notify. The reporter flag goes only in AC-6's ad-hoc command; the timeout is a one-off wall-clock bound on the probe.
- **`--test-force-exit` as the probe's pass condition** — rejected. It masks event-loop hangs that CI would hit, since CI has no `timeout-minutes` (`ci.yml:534-591`). It is for diagnosis only.
- **Exact `# tests` pins in a frozen step Verification** — rejected. F-09 makes them uncorrectable if #1262 or 248 lands mid-execution.
- **Capturing gate evidence only on `.nvmrc` Node 22** — rejected. Its output shape and runtime differ from CI's Node 24 (`fails.md:2223-2226`; `recon.md:95`, `:225`).
- **Editing the working-tree main-dev `acceptance.feature`/`product-spec.md`** — rejected. It splits main-dev from the feature branch. Edit the feature-branch copy only.

## Open Risks

- [ ] **The in-tree Node 24 run after hardening is unobserved** (`recon.md:215-218`, `:252-257`). Any impl regression, stale assertion, mock/setup drift or aggregate below 40 goes to stop-and-ask, and `code-completed` waits for an operator ruling. To be addressed at identity B and ledger B.
- [ ] **The aggregate `% Lines` may fall below 40** once roughly 1,000+ impl lines enter the denominator. The advisory preview showed `ledgerAudit.js` at 38.88%. Adding tests and lowering the threshold are both forbidden, so this can stall the feature. To be addressed at identity B and ledger B (gate step 5).
- [ ] **Node 24 output for a root `before()` failure (cancelled vs failed subtests) is unverified.** AC-6 asserts only the exit code and `# pass 0`, under an explicit `--test-reporter=tap`. To be addressed at identity A, ledger A and both B steps (AC-6 RED/GREEN capture).
- [ ] **Under path (b), CI enforces no 40% gate for any Node leaf** until the follow-up defect lands. The promoted AC-4 is checked only at manual verification. To be addressed at teardown (file the follow-up defect).
- [ ] **The #1262 base can move before it lands.** `:353`, `:495` and `:530` were verified on `e69e953d` only. Re-grep at spec time. To be addressed at `/sdd-spec` and identity B.
- [ ] **The acceptance/product-spec amendment may not land before `/sdd-spec`.** The spec would then trace the old AC-4 and leave AC-6 uncovered, which blocks impl-spec review (C-15). To be addressed by the orchestrator before `/sdd-spec`, or else by spec step 1.
- [ ] **The production `pnpm build` (`Dockerfile:24`) now type-checks and emits the tests, and `dist/__tests__` ships in the image** (`Dockerfile:27`, `:32`). Accepted for parity with config/notify. To be addressed at identity A and ledger A (`pnpm build` gate).
- [ ] **The bcrypt native binding becomes a hard test-time dependency** (`recon.md:218`). Low likelihood. To be addressed at identity A (first probe).
- [ ] **CI `node-test` has no `timeout-minutes`** (`ci.yml:534-591`), so a later hang could burn a runner. It is mitigated only by the bounded probe without force-exit. The `eventNotifier` reconnect test is a timing risk (`recon.md:219`). To be addressed at ledger A (probe).
- [ ] **103 mechanical guard removals (+2 on #1262).** Mitigations: the assert-count diff, the relative test-count formula, the zero cancelled/skipped/todo evidence, and the scoped `catch` grep. To be addressed at identity B and ledger B.
- [ ] **Merge order across 252 / #1262 / 248.** Whoever lands second de-guards and merges the other's test changes. The `merge-order.md` note and the `before()` constraint comments are the only controls (`recon.md:227-228`). To be addressed at teardown.

## Constitution Rules Touched

- **`C-01`** — honored by: every step cites `path:line`. The mediator re-verified these this round:
  - hotfix `:340-372`, `:353`, `:530`, and test `:481-495`;
  - main-dev `:502-540` and test `:417`;
  - `c8` `bin/c8.js:22-23` and `parse-args.js:103-104`, `:169-170`;
  - `ci.yml:534-591`;
  - the Node 24 default reporter;
  - `ledgerAudit.ts:8`;
  - `telemetry.export.test.ts:5-9,31`.

  The uncited preview figures are labelled advisory.
- **`C-08`** — honored by: the test steps are the change itself. 40% is proven by `c8 check-coverage --lines 40`, a numeric aggregate and non-zero impl rows.
- **`C-10`** — honored by: path (b) keeps parity with config/notify and grants no override to itself. Enforcement in all four Node leaves is deferred to one follow-up defect. Path (a) needs operator sign-off.
- **`C-13`** — honored by: no new domain fixture data. The harness cases add none (`recon.md:118`).
- **`C-14`** — honored by: the consumer surface is "None — internal/platform-only" (`product-spec.md:78-80`).
- **`C-15`** — honored by: AC-6 is appended (IDs are append-only) with `@FR-3`. AC-1, AC-4 and AC-5 are reworded in place with stable IDs, local to the unlaunched feature. The amendment lands before impl-spec review.
- **`C-16`** — honored by: all 30 durable rules are PRESERVE (below). The scenario edits are feature-local, not CHANGEs to durable rules. AC-4 is no longer promoted with a vacuous threshold clause.
- **`C-18`** — honored by: byte-identical scripts and tsconfig (DRY). YAGNI: no permanent timeout or reporter flags, and no stub fixture. The trade-off records are above.
- **`P-02`** — honored by: the mediator's synthesis was the only channel between proposer and adversary.
- **`P-03`** — honored by: the four stop-and-ask categories. Nothing is guessed or self-resolved.
- **`P-05`** — honored by: the requirement amendment and the preview provenance are written to `context.md` as they happen.
- **`P-06`** — honored by: RED comes before GREEN.
  - AC-6's RED is the end-of-Step-A run only.
  - AC-1's RED is a captured mutated run.
  - The proto-import RED (`MODULE_NOT_FOUND`) comes before its GREEN.
- **`F-04`** — honored by: no invented path. The not-found items stay in `recon.md:246-258`.
- **`F-05`** — honored by: no commit happens before the per-step proto build, `pnpm build`, lint, `test:coverage` and `check-coverage` evidence.
- **`F-08`** — honored by: every touched file is in some step's Files, including the acceptance/product-spec amendment if it lands at execute time.
- **`F-09`** — honored by: the relative test-count formula. Absolute counts appear only in `context.md`.
- **`F-11`** — no Floor breach in any round.

## Business Rules Touched (C-16)

There is no EXTEND and no CHANGE (`recon.md:123`). Every rule below is PRESERVE. None of them is regressed, for one reason that applies to all: the only edits are runner, specifier, guard and header edits, and **no assertion changes**.

Gate evidence that backs this:
- the per-file assert-count diff reads "unchanged + harness";
- zero failed, cancelled, skipped and todo tests;
- any failure that is not runner fallout goes to stop-and-ask (`recon.md:125`).

**Identity — `services/xstockstrat-identity/acceptance/user-management-ui.feature`** (`recon.md:127-136`). Each test newly executes against the real `IdentityServiceImpl`.

- PRESERVE `@AC-1 @feature-043` "Admin lists all users"
- PRESERVE `@AC-2 @feature-043` "Admin creates a new user who can then sign in"
- PRESERVE `@AC-3 @feature-043` "Admin resets a user's password without the current password"
- PRESERVE `@AC-4 @feature-043` "Admin assigns and removes roles"
- PRESERVE `@AC-5 @feature-043` "Admin deactivates a user, blocking login"
- PRESERVE `@AC-6 @feature-043` "Admin reactivates a previously deactivated user"
- PRESERVE `@AC-7 @feature-043` "A non-admin caller is denied every user-management RPC"
- PRESERVE `@AC-8 @feature-043` "Every user-management action writes a ledger audit event"
- PRESERVE `@AC-10 @feature-043` "Passwords are never returned or displayed"
- PRESERVE `@AC-11 @feature-043` "The last active admin cannot be deactivated or demoted"

**Identity — `services/xstockstrat-identity/acceptance/mcp-user-profile-roles.feature`** (`recon.md:137`)

- PRESERVE `@AC-10 @feature-183` "Admin profile RPCs enforce admin gating at the identity service, not only in the agent". Admin-metadata tests newly execute.

**Ledger — `services/xstockstrat-ledger/acceptance/ledger-event-export.feature`** (`recon.md:138-143`). The `exportEvents` tests newly execute against the real `LedgerServiceImpl`.

- PRESERVE `@AC-3 @feature-021` "event_type filter restricts the export to the listed types"
- PRESERVE `@AC-4 @feature-021` "Omitting event_type returns all five event types"
- PRESERVE `@AC-5 @feature-021` "A window wider than the configured maximum is rejected"
- PRESERVE `@AC-8 @feature-021` "Each exported row carries the required fields"
- PRESERVE `@AC-10 @feature-021` "Export is disabled when the feature flag is off"
- PRESERVE `@AC-11 @feature-021` "The export returns only the authenticated user's own events"

**Platform — `docs/sdd/business-rules/platform.feature`** (`recon.md:144-156`)

- PRESERVE `@AC-1 @feature-021` "Date-range export streams every event as NDJSON in global-sequence order". Only the ledger ascending-sequence clause applies, and those `exportEvents` tests are not changed.
- PRESERVE `@AC-7 @feature-021` "A one-million-row export streams without buffering the full result set". The batched-streaming test is not changed.
- PRESERVE `@AC-1 @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute". `telemetry.test.ts` changes only its import specifier.
- PRESERVE `@AC-2 @feature-171` "Telemetry init remains non-blocking after the trading_mode attribute is removed". No telemetry module source changes.
- PRESERVE `@AC-1 @feature-226` "A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL". `telemetry.export.test.ts` changes only its import, the removed shim, and a comment.
- PRESERVE `@AC-3 @feature-226` "A failed trace export is visible in service logs". The "logs a rejected export" case and its `(node:` filter are kept.
- PRESERVE `@AC-1 @feature-210` "A plaintext gRPC caller is refused in production configuration". `mtls.test.ts` changes only its import at `:13`.
- PRESERVE `@AC-2 @feature-210` "A mutually-authenticated peer with a valid platform-issued identity is accepted". The handshake test is not changed.
- PRESERVE `@AC-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled". The "fails closed" case is not changed.
- PRESERVE `@AC-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS". The trio assertion in the handshake test is not changed.
- PRESERVE `@AC-6 @feature-210` "A long-lived streaming RPC survives a certificate rotation". Ledger `mtls.test.ts:149` is not changed.
- PRESERVE `@AC-2 @feature-175` "The confirmed-dead propagation middleware is gone from the Node leaf services". The `pnpm build` and test run are in every per-step gate.
- PRESERVE `@AC-3 @feature-175` "The Node leaf type surface matches the Node 24 runtime". The production `tsc` and the `@types/node` `^24` pin are unchanged. There is no new tsconfig and no loader devDependency, and `pnpm build` is in every gate.

No CHANGE line, so no operator sign-off is required under C-16. The feature-local AC-1/AC-4/AC-5 rewording and the AC-6 append are C-15 amendments to this unlaunched feature's own scenarios.
