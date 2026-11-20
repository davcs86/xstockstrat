# Implementation Spec: fix-ci-enforcement-gaps

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/324-fix-ci-enforcement-gaps/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-ci-enforcement-gaps`
**Severity**: SEV-2
**Grounded in**: `design.md` (Chosen Approach, mandatory), `debate.md` (D-1, D-4, D-5, D-7, D-8, D-9), `recon.md` (Patterns to REUSE), tree `origin/main-dev@fb52065c`

---

## Execution Summary

The feature branch (`867a0380`) is 168 commits behind `origin/main-dev`, and its own 12 commits touch
only this feature directory. Every `path:line` below was therefore grepped on `origin/main-dev@fb52065c`,
the tree the branch holds after Step 1. Step 1 merges main-dev and re-stamps `recon.md` (D-7). Step 2
writes the per-leaf c8 baseline to `context.md` (D-8). Steps 3–5 are one atomic unit: the `node-test`
guard (D-5), the notify below-40 proof for @AC-1, and the `--check-coverage` flag in the four leaf
scripts (D-1), with one red→green cycle. Step 6 deletes the dead `coverage_threshold` matrix values.
Step 7 is the proof-only ruff sequence for @AC-2 against the existing `scripts-python` job (D-9). It
ships no ruff code. Steps 8–9 flip the docs, the findings rows and both defect-report sidecars.

**Consumer surface (C-14)**: none. The change is internal/platform-only (CI, four `package.json`
scripts, docs), as design.md states. No `xstockstrat-ui` or `xstockstrat-agent` step is required.

**No proto, migration or config-key step**: product-spec.md § Fix Scope answers "no" to all three.

**Trading-domain constraints (step-constraints.md §A)**: not applicable. No step touches trading,
portfolio, broker, order or `TRADING_MODE` code.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` A Node leaf below 40% line coverage fails its coverage run | Step 2 (baseline records), Step 3 (guard), Step 4 (below-40 proof in notify), Step 5 (flag) |
| `@AC-2` scripts/ Python is ruff-clean and CI enforces it | Step 7 (green in both invocation forms, planted-import red, fixture ignored, job wiring) |

## Spec-time measurement records

These are the records the operator ruling of 2026-11-20 asked the spec to carry. They were taken on
an export of `origin/main-dev@fb52065c` with node v22.23.4 (CI uses 24), c8 10.1.3 and ruff 0.17.4.
Step 2, Step 4 and Step 7 repeat every run at the synced tip and write the results to `context.md`.

### c8 baseline, unflagged scripts (@AC-1)

Each row is `pnpm run test:coverage`, then `pnpm exec c8 check-coverage --lines 101`, with no
`--all`, `--src` or `--allowExternal`.

| Leaf | Tests pass / fail | All files % Lines | `--lines 101` forced-miss aggregate | Impl rows non-zero / total | LH / LF (lcov) | Verdict |
|---|---|---|---|---|---|---|
| xstockstrat-config | 394 / 0 | 92.26 | 92.26% | 10 / 10 | 1706 / 1849 | >= 40 |
| xstockstrat-identity | 161 / 0 | 84.82 | 84.82% | 10 / 10 | 1683 / 1984 | >= 40 |
| xstockstrat-ledger | 168 / 0 | 85.78 | 85.78% | 10 / 10 | 1352 / 1576 | >= 40 |
| xstockstrat-notify | 416 / 0 | 90.7 | 90.7% | 20 / 20 | 2518 / 2776 | >= 40 |

No leaf is below 40, so D-4 adds no test step. With the flag applied, `pnpm run test:coverage` exited 0
in all four leaves.

### Guard and @AC-1 proof dry run (notify)

| Run | Result |
|---|---|
| Guard on the unflagged script, four leaves | exit 1 each |
| Guard on the flagged script, four leaves | exit 0 each |
| Guard on a script with `--check-coverage` after `node` | exit 1 |
| Proof tree, unflagged: `pnpm run test:coverage` | exit 0 at All files 37.32% Lines; `pnpm exec c8 check-coverage --lines 40` right after exits 1 |
| Proof tree, flagged: `pnpm run test:coverage` | exit 1, `ERROR: Coverage for lines (37.32%) does not meet global threshold (40%)`; forced-miss aggregate 37.32% |
| Proof module row | `acProof.js` 1.02% Lines, LF 4082, LH 42 |
| Sizing | T = 2776, covered = 2518, module of 40 functions × 101 lines; total after = 2560 / 6858 |

### Ruff proof dry run (@AC-2)

| Run | Result |
|---|---|
| `uv run --project scripts --no-sync ruff check scripts/` (repo root) | exit 0, "All checks passed!" |
| `uv run --project scripts --no-sync ruff format --check scripts/` (repo root) | exit 0, "60 files already formatted" |
| Job form in `scripts/`: `ruff check .`, `ruff format --check .`, `pytest` | exit 0 each; 491 passed |
| `import os` planted above `import argparse` in `scripts/ledger-guard.py` | both forms exit 1; `scripts/ledger-guard.py:9:8: F401` and `:9:1: I001` |
| `import os` planted after `import json` in `scripts/tests/test_manage_users.py` | both forms exit 1; `scripts/tests/test_manage_users.py:20:8: F401` |
| `import os` planted at line 1 of `scripts/config-wiring-fixtures/gate/row-checks/services/xstockstrat-ingest/app/reader.py` | both forms exit 0 |

`scripts-python` is green at spec time, so the design's block-and-escalate condition does not apply,
and O-3 and O-9 stay moot.

## Step Dependencies

- Step 1 comes first: every later citation and edit assumes the tree at or after `origin/main-dev@fb52065c` (D-7).
- Step 2 requires Step 1 and precedes the unit: D-4 needs every leaf's verdict before the flag lands. A leaf below 40 at Step 2 blocks the feature and returns it to `/sdd-spec` for a named test step. The threshold is never lowered (R-2).
- Steps 3+4+5 land together: Step 3's guard and Step 4's proof assert behavior that only Step 5's flag creates (step-constraints.md §C, "adds a test that references a symbol a later step creates"). Committed apart, the guard would turn `node-test` red on its own tree, and Step 4's green half could not pass. The unit is three adjacent steps on the backend surface.
- Step 3 [test] and Step 4 [test] cover Step 5 [service] (C-08).
- Step 6 requires the unit: after it, the script is the only home of the threshold (D-1, C-18). Step 6 has no paired test because it deletes data that no step reads.
- Step 7 requires Step 1 only. It needs `scripts/pyproject.toml` and the `scripts-python` job, which exist only after the sync.
- Steps 8 and 9 require Steps 5 and 7: the docs may claim enforcement only after both proofs are recorded (C-01, C-10).
- Peer overlap: `.github/workflows/ci.yml` is shared with features 297, 298 and 318, and the ledger and notify `package.json` with 323. If main-dev is merged again after Step 1, re-grep each step's cited lines before editing.
- Merge-train (O-21): before the integration PR merges, re-run only the wiring check in Step 7's Verification (block 1). Do not re-run the whole proof.

---

### Step 1 — docs: Sync the feature branch to main-dev and re-stamp recon.md (D-7)

**Status**: `pending`
**Service**: `docs/roadmap/features/324-fix-ci-enforcement-gaps/`
**Files**:
- `docs/roadmap/features/324-fix-ci-enforcement-gaps/recon.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `git rev-list --left-right --count origin/main-dev...HEAD` → `168 12`; merge base `c4fd48b0a`.
- Confirmed via: `git diff --name-only c4fd48b0a HEAD` → six files, all under this feature directory.
- Confirmed via: `git merge-tree --write-tree --name-only HEAD origin/main-dev` → a tree id and no conflict list, so the merge is clean at `fb52065c`.
- Stale stamp: `recon.md:5` reads `**Tree**: detached@c4fd48b0a ≡ origin/main-dev (…)`.
- Stale claims: `recon.md:49` (no ruff config), `recon.md:36-44` (old `ci.yml` numbers, a `sops-secrets` ruff step), `recon.md:46-48` (8 scripts, 1 test), `recon.md:53` (root `CLAUDE.md` claim).

**TDD**: `N/A (docs: a merge and a dossier re-stamp, no code)`

**Covers**: —

**Instructions**:
1. On `feature/fix-ci-enforcement-gaps`, run `git fetch origin` and `git merge origin/main-dev`. The dry run at `fb52065c` showed no conflicts. If main-dev has moved and a conflict appears outside this feature directory, take main-dev's side: the branch has no edits there. The merge commit is the one sanctioned change outside **Files** (D-7).
2. Edit `recon.md`. Replace line 5 with `**Tree**: feature/fix-ci-enforcement-gaps@<sha7> ≡ origin/main-dev@<sha7> merged (re-stamped 2026-11-20, D-7)`. Then correct the Codebase Map from a fresh grep at the synced tip. The values at `fb52065c` were:
   - Coverage scripts: config, identity and notify `package.json:13`, ledger `package.json:14` (unchanged).
   - `node-test` job at `ci.yml:746`; matrix `coverage_threshold: 40` at `:764,766,768,770,774`; ui comment at `:771-772`; coverage step at `:794-796`.
   - Other `coverage_threshold` consumers: Go at `ci.yml:384` (values `:331,333,335`), Python at `:519` (values `:468,471,474,477`).
   - `python-lint` ruff steps at `ci.yml:436-443`.
   - `scripts-python` job at `ci.yml:861-894`, in `ci-gate` at `:1392` and `:1425`. The `sops-secrets` ruff step no longer exists.
   - `scripts` change filter at `ci.yml:68-72`.
   - Ruff config exists: `scripts/pyproject.toml:25-27`, `requires-python` at `:5`; ruff 0.17.4 at `scripts/uv.lock:402-403`.
   - `scripts/` holds 29 top-level `.py` files and a `scripts/tests/` suite (491 tests); 19 fixture `.py` files under `scripts/config-wiring-fixtures/`.
   - Doc claims: `docs/patterns/ci-overview.md:25` and `:90`. The root `CLAUDE.md` holds no "not enforced" claim.
3. If any value differs at the synced tip, write the difference in this spec's Deviation Log before starting Step 2.

**Verification**:
```bash
git merge-base --is-ancestor origin/main-dev HEAD && echo "synced"
sed -n 5p docs/roadmap/features/324-fix-ci-enforcement-gaps/recon.md | grep -q "re-stamped 2026-11-20" && echo "re-stamped"
grep -n '"test:coverage"' services/xstockstrat-config/package.json services/xstockstrat-identity/package.json services/xstockstrat-ledger/package.json services/xstockstrat-notify/package.json
grep -n "coverage_threshold" .github/workflows/ci.yml
grep -n "^  scripts-python:\|      - scripts-python\|needs.scripts-python.result" .github/workflows/ci.yml
grep -n "extend-exclude\|requires-python" scripts/pyproject.toml
```
Expected: `synced`, `re-stamped`, four script lines, 14 `coverage_threshold` lines, three `scripts-python` lines, two `pyproject.toml` lines.

---

### Step 2 — test: Per-leaf c8 baseline records (D-8)

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `docs/roadmap/features/324-fix-ci-enforcement-gaps/context.md` — modify (append a `## c8 measurement` table)

**Reviewers**: Service owner (xstockstrat-config) — WatchConfig stream stability; Service owner (xstockstrat-identity) — JWT expiry and rotation; Service owner (xstockstrat-ledger) — append-only invariant; Service owner (xstockstrat-notify) — stream delivery guarantees

**Codebase Evidence**:
- Confirmed via: `grep -n '"test:coverage"' services/xstockstrat-*/package.json` → config, identity, notify `:13`, ledger `:14`: `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`.
- c8 devDependency `^10.1.2`: config `package.json:54`, identity `:50`, ledger `:47`, notify `:47`; installed 10.1.3.
- CI prerequisites: `ci.yml:788-792` (`pnpm install --no-frozen-lockfile`, `pnpm --filter @xstockstrat/proto run build`).
- Measurement rule: `docs/roadmap/ledger/fails.md:3274-3277` (forced-miss aggregate right after the wrapped run, no `--all`/`--src`/`--allowExternal`, non-zero impl rows).
- `coverage/` and `dist/` are ignored: `.gitignore:15,20`.
- Spec-time values: § Spec-time measurement records.

**TDD**: `N/A (measurement records only; no code changes)`

**Covers**: `AC-1`

**Instructions**:
1. From the repo root, run `pnpm install --no-frozen-lockfile` and `pnpm --filter @xstockstrat/proto run build`.
2. In each of the four leaves, run `pnpm run test:coverage`, then at once `pnpm exec c8 check-coverage --lines 101`. Pass no `--all`, `--src` or `--allowExternal`.
3. Append a `## c8 measurement` section to `context.md` inside this step's session entry. Use one row per leaf with these columns: leaf, git SHA, node version, All files % Lines (from the c8 table), the forced-miss aggregate (from the `ERROR: Coverage for lines (X%) …` line), the count of implementation rows with non-zero lines against the total, and the verdict (`>= 40` or `< 40`).
4. A verdict of `< 40`, or a non-zero-rows count of 0, blocks the feature. Record it and return to `/sdd-spec` for a named test step (D-4). Do not lower the threshold.
5. C-13: this step adds no test data.

**Verification**:
```bash
for s in config identity ledger notify; do
  ( cd services/xstockstrat-$s || exit 1
    pnpm run test:coverage > /dev/null 2>&1 || exit 1
    pnpm exec c8 check-coverage --lines 40 || exit 1
    pnpm exec c8 check-coverage --lines 101 && exit 1
    awk -F: -v s="$s" '/^SF:/{n++} /^LF:/{lf+=$2} /^LH:/{lh+=$2; if ($2>0) nz++}
      END{printf "%s rows=%d nonzero=%d lines=%.2f%%\n", s, n, nz, 100*lh/lf; exit !(nz>0 && lh/lf>=0.4)}' coverage/lcov.info
  ) || { echo "FAIL $s"; break; }
done
grep -c "^## c8 measurement" docs/roadmap/features/324-fix-ci-enforcement-gaps/context.md
```
Expected: four `rows=… nonzero=… lines=…%` lines, each at or above the 40% line threshold, no `FAIL`, and a count of 1.

---

### Step 3 — test: `node-test` guard step for the coverage flag (D-5)

**Status**: `pending`
**Service**: `.github/workflows/ci.yml` (`node-test` job)
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Service owner (xstockstrat-config) — WatchConfig stream stability; Service owner (xstockstrat-identity) — JWT expiry and rotation; Service owner (xstockstrat-ledger) — append-only invariant; Service owner (xstockstrat-notify) — stream delivery guarantees. The registry has no CI-workflow owner row (**Not found**).

**Codebase Evidence**:
- Confirmed via: `grep -n "^  node-test:\|test with coverage\|pnpm run test:coverage" .github/workflows/ci.yml` → job at `:746`, step `- name: test with coverage` at `:794`, `working-directory: services/${{ matrix.service }}` at `:795`, `run: pnpm run test:coverage` at `:796`.
- Preceding step: `- name: build proto stubs` at `ci.yml:791-792`.
- The ui leaf must be skipped: its `test:coverage` is `vitest run --coverage` (`recon.md:32`), and it is the fifth matrix entry (`ci.yml:773`).
- No existing guard: `grep -n "check-coverage" .github/workflows/ci.yml` → no match.
- Dry run: § Guard and @AC-1 proof dry run (exit 1 unflagged, exit 0 flagged, exit 1 with the flag after `node`).

**Lands with**: `Step 4, Step 5`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. In the `node-test` job, insert this step between `build proto stubs` (`ci.yml:791-792`) and `test with coverage` (`ci.yml:794`), with a blank line on each side:
   ```yaml
         - name: coverage flag guard
           if: matrix.service != 'xstockstrat-ui'
           working-directory: services/${{ matrix.service }}
           run: |
             node -e '
             const t = require("./package.json").scripts["test:coverage"].split(/\s+/);
             const c8 = t.indexOf("c8"), flag = t.indexOf("--check-coverage"), node = t.indexOf("node");
             if (!(c8 >= 0 && flag > c8 && node > flag)) {
               console.error("test:coverage must pass --check-coverage to c8 before node: " + t.join(" "));
               process.exit(1);
             }
             '
   ```
   Indent it to match the neighbouring steps (six spaces before `- name:`).
2. The step reads only `scripts['test:coverage']`, requires the token order `c8` < `--check-coverage` < `node`, and holds no threshold literal (D-5). Add no second guard anywhere (C-18).
3. RED, before Step 5's edit: run the Verification below. Each leaf must print `guard=1`. Record the four results in `context.md`.
4. GREEN, after Step 5's edit: the same command prints `guard=0` for each leaf. Record it.
5. C-13: no test data.

**Verification**:
```bash
GUARD=$(mktemp)
python3 - > "$GUARD" <<'EOF'
import yaml
steps = yaml.safe_load(open(".github/workflows/ci.yml"))["jobs"]["node-test"]["steps"]
names = [s.get("name") for s in steps]
g = steps[names.index("coverage flag guard")]
assert names.index("coverage flag guard") < names.index("test with coverage")
assert g["if"] == "matrix.service != 'xstockstrat-ui'"
assert g["working-directory"] == "services/${{ matrix.service }}"
assert "40" not in g["run"]
print(g["run"])
EOF
for s in config identity ledger notify; do
  ( cd services/xstockstrat-$s && bash -e "$GUARD" ) && echo "$s guard=0" || echo "$s guard=1"
done
```
Expected at the unit's commit: `guard=0` four times. Before Step 5's edit the same command prints `guard=1` four times (the RED).

---

### Step 4 — test: @AC-1 below-40 proof in notify

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `docs/roadmap/features/324-fix-ci-enforcement-gaps/context.md` — modify (proof record)
- `services/xstockstrat-notify/src/acProof.ts` — temporary: create, then delete. Never staged.
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — temporary: modify, then revert. Never staged.

**Reviewers**: Service owner (xstockstrat-notify) — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-notify/src` → `__tests__ dbTls.ts fanout grpc index.ts mtls.ts services telemetry.ts`; `acProof.ts` is absent (**Not found** — created by this step and removed again).
- Confirmed via: `sed -n 10p services/xstockstrat-notify/src/__tests__/fanout.test.ts` → `import { describe, it } from 'node:test';`.
- `services/xstockstrat-notify/tsconfig.json:4` (`"module": "commonjs"`), `:6-7` (`outDir ./dist`, `rootDir ./src`), `:14` (`"include": ["src/**/*"]`). An unused named import is elided, so the import must be a side-effect import (O-12).
- c8 runs without `--all`, so only loaded files count (`recon.md:100-104`).
- Spec-time sizing: T = 2776, covered = 2518; a module of 40 functions × 101 lines gave 2560 / 6858 = 37.32%.

**Lands with**: `Step 3, Step 5`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. Read T (sum of `LF`) and covered (sum of `LH`) for notify from the `coverage/lcov.info` that Step 2 produced. The module needs U uncovered lines with U > (covered + c) / 0.4 − T − c, where c is the module's own covered lines (42 at spec time). At spec-time numbers U must exceed 3582. Generate at least 300 lines more than the bound.
2. Generate the module with the throwaway generator in Verification. Raise the function count if T or covered moved. The bodies are uncalled functions, because executed top-level statements count as covered.
3. Load it from `src/__tests__/fanout.test.ts` by adding `import '../acProof.js';` directly below line 10.
4. RED, on the unflagged script (before Step 5's edit): `pnpm run test:coverage` exits 0 while the table shows All files % Lines below 40, and `pnpm exec c8 check-coverage --lines 40` right after exits 1. This is @AC-1 failing on the buggy behavior. Record the exit codes and the table total.
5. GREEN, on the flagged script (after Step 5's edit): `pnpm run test:coverage` exits non-zero with `does not meet global threshold (40%)`. Then run `pnpm exec c8 check-coverage --lines 101` and record the aggregate. Record the `acProof.js` row (non-empty) and T, covered and the module size.
6. Revert: delete `src/acProof.ts` and `dist/acProof.js`, and run `git checkout -- services/xstockstrat-notify/src/__tests__/fanout.test.ts`. Do not stage either file (F-08, O-17).
7. C-13: the proof module is generated filler, not domain data. Nothing ships.

**Verification**:
```bash
cd services/xstockstrat-notify
python3 - 40 > src/acProof.ts <<'EOF'
import sys
for i in range(int(sys.argv[1])):
    print(f"export function acProof{i}(x: number): number {{")
    print("  let y = x;")
    for j in range(97):
        print(f"  y += {j};")
    print("  return y;")
    print("}")
EOF
python3 - <<'EOF'
p = "src/__tests__/fanout.test.ts"
a = "import { describe, it } from 'node:test';\n"
s = open(p).read()
assert a in s
open(p, "w").write(s.replace(a, a + "import '../acProof.js';\n", 1))
EOF
pnpm run test:coverage > /tmp/ac1-proof.txt 2>&1; echo "test:coverage rc=$?"
grep -n "^All files\|acProof\|global threshold" /tmp/ac1-proof.txt
pnpm exec c8 check-coverage --lines 101; echo "forced-miss rc=$?"
rm -f src/acProof.ts dist/acProof.js dist/acProof.js.map
git checkout -- src/__tests__/fanout.test.ts
cd ../.. && git status --porcelain services/xstockstrat-notify/src
```
Expected at the unit's commit (flag applied): `test:coverage rc=1`, an `All files` row below the 40% line threshold, a non-empty `acProof.js` row, the `(40%)` threshold error, `forced-miss rc=1`, and an empty `git status` listing. Before Step 5's edit the same block prints `test:coverage rc=0` with the same sub-40 total (the RED).

---

### Step 5 — service: `--check-coverage` in the four leaf `test:coverage` scripts (D-1)

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/package.json` — modify
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-notify/package.json` — modify
- `docs/roadmap/features/324-fix-ci-enforcement-gaps/context.md` — modify (second-pass rows)

**Reviewers**: Service owner (xstockstrat-config) — WatchConfig stream stability; Service owner (xstockstrat-identity) — JWT expiry and rotation; Service owner (xstockstrat-ledger) — append-only invariant; Service owner (xstockstrat-notify) — stream delivery guarantees

**Codebase Evidence**:
- Confirmed via: `grep -n '"test:coverage"' services/xstockstrat-config/package.json services/xstockstrat-identity/package.json services/xstockstrat-ledger/package.json services/xstockstrat-notify/package.json` → `:13`, `:13`, `:14`, `:13`, the same string in all four: `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js",`.
- No c8 config file exists in any leaf (`recon.md:31`), and none is added (`recon.md:58`).
- Lint script: `"lint": "eslint src --ext .ts"` at config, identity, notify `package.json:14`, ledger `:16`.
- The edit adds no dependency, so `pnpm-lock.yaml` is unchanged.
- Dry run: with the flag, `pnpm run test:coverage` exited 0 in all four leaves.
- No new env var, port or outbound gRPC call: deployment files and header propagation are untouched.

**Lands with**: `Step 3, Step 4`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. In each of the four files, insert `--check-coverage ` directly before `--lines 40`. The script becomes:
   `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --check-coverage --lines 40 node --test dist/__tests__/*.test.js",`
2. Change nothing else: `tsc &&`, the reporters, the test glob and the `test` script stay as they are (platform `@AC-3` and `@AC-6` PRESERVE). Add no c8 config file.
3. Run Step 3's and Step 4's GREEN halves now.
4. Second pass (D-8): run `pnpm run test:coverage` in each leaf and add an `exit code after flag` column, or a second table, to the `## c8 measurement` section in `context.md`. Each leaf must exit 0 with 0 failed tests (platform `@AC-5` PRESERVE).
5. Commit the unit as one commit: `.github/workflows/ci.yml`, the four `package.json` files and `context.md`.

**Verification**:
```bash
grep -c -- "--reporter=lcov --check-coverage --lines 40 node --test" \
  services/xstockstrat-config/package.json services/xstockstrat-identity/package.json \
  services/xstockstrat-ledger/package.json services/xstockstrat-notify/package.json
for s in config identity ledger notify; do
  ( cd services/xstockstrat-$s && pnpm run test:coverage > /dev/null 2>&1 \
    && pnpm exec c8 check-coverage --lines 40 && pnpm run lint > /dev/null 2>&1 ) \
    && echo "$s ok" || echo "$s FAIL"
done
git status --porcelain
```
Expected: a count of 1 per file; `ok` four times (coverage at or above the 40% line threshold, enforced by the script itself, and lint clean); the status lists only `.github/workflows/ci.yml`, the four `package.json` files and this feature's `context.md`. Then run the Verification of Step 3 and Step 4 (the unit's union).

---

### Step 6 — config: Delete the dead `coverage_threshold` values from the `node-test` matrix (D-1, R-8)

**Status**: `pending`
**Service**: `.github/workflows/ci.yml` (`node-test` job)
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Service owner (xstockstrat-config) — WatchConfig stream stability; Service owner (xstockstrat-identity) — JWT expiry and rotation; Service owner (xstockstrat-ledger) — append-only invariant; Service owner (xstockstrat-notify) — stream delivery guarantees. The registry has no CI-workflow owner row (**Not found**).

**Codebase Evidence**:
- Confirmed via: `grep -n "coverage_threshold" .github/workflows/ci.yml` → 14 lines. `node-test` matrix values at `:764,766,768,770,774`. Go values at `:331,333,335` with the consumer at `:384` (`THRESHOLD=${{ matrix.coverage_threshold }}`). Python values at `:468,471,474,477` with the consumer at `:519` (`--cov-fail-under=${{ matrix.coverage_threshold }}`).
- No `node-test` step reads the value: the job's steps (`ci.yml:776-803`) hold no `matrix.coverage_threshold`.
- ui comment at `ci.yml:771-772`: `# xstockstrat-ui runs the vitest unit suite (feature 065); the real coverage gate is` / `# vitest's own scoped src/lib threshold (vitest.config.ts) — this entry just runs it.`
- Line numbers are from `fb52065c`. Step 3 adds 12 lines below the matrix, so the matrix lines do not move.

**TDD**: `N/A (config: deletes matrix data that no step reads; no behavior changes)`

**Covers**: —

**Instructions**:
1. In the `node-test` matrix `include:` list, delete the five `coverage_threshold: 40` lines (`ci.yml:764,766,768,770,774`). Each entry keeps only its `- service:` line.
2. Replace the ui comment (`ci.yml:771-772`) with two lines that name no threshold:
   ```yaml
             # xstockstrat-ui runs the vitest unit suite (feature 065); vitest.config.ts owns its
             # coverage gate, so this entry only runs the suite.
   ```
3. Leave the Go and Python jobs untouched (`ci.yml:331-335,384,468-477,519`).

**Verification**:
```bash
python3 - <<'EOF'
import yaml
inc = yaml.safe_load(open(".github/workflows/ci.yml"))["jobs"]["node-test"]["strategy"]["matrix"]["include"]
assert [e["service"] for e in inc] == ["xstockstrat-config", "xstockstrat-ledger", "xstockstrat-identity", "xstockstrat-notify", "xstockstrat-ui"]
assert all(set(e) == {"service"} for e in inc), inc
print("matrix ok")
EOF
grep -c "coverage_threshold" .github/workflows/ci.yml
grep -n "matrix.coverage_threshold" .github/workflows/ci.yml
```
Expected: `matrix ok`; a count of 9 (14 before); exactly two consumer lines, the Go `THRESHOLD=` line and the Python `--cov-fail-under=` line.

---

### Step 7 — test: @AC-2 proof sequence against the existing `scripts-python` gate (D-9)

**Status**: `pending`
**Service**: `scripts/` (Python operator tooling) and `.github/workflows/ci.yml` (`scripts-python` job, read only)
**Files**:
- `docs/roadmap/features/324-fix-ci-enforcement-gaps/context.md` — modify (proof record)
- `scripts/ledger-guard.py` — temporary: modify, then revert. Never staged.
- `scripts/tests/test_manage_users.py` — temporary: modify, then revert. Never staged.
- `scripts/config-wiring-fixtures/gate/row-checks/services/xstockstrat-ingest/app/reader.py` — temporary: modify, then revert. Never staged.

**Reviewers**: none. The registry has no `scripts/` owner row (**Not found**).

**Codebase Evidence**:
- `scripts/pyproject.toml:5` `requires-python = ">=3.12"`; `:25-27` `[tool.ruff]` with `extend-exclude = ["config-wiring-fixtures"]`. No `scripts/ruff.toml` and no root `pyproject.toml` or `ruff.toml` exist.
- `scripts/uv.lock:402-403` → `name = "ruff"`, `version = "0.17.4"`.
- `scripts-python` job at `ci.yml:861-894`: gate `contains(…, 'scripts') || contains(…, 'ci')` at `:864-866`; `working-directory: scripts` at `:868-870`; `uv lock --check` at `:881`; `uv sync --extra dev --frozen` at `:884`; `uv run --no-sync ruff check .` at `:888`; `uv run --no-sync ruff format --check .` at `:891`; `uv run --no-sync pytest` at `:894`.
- `ci-gate`: `- scripts-python` in `needs:` at `ci.yml:1392`; echo line at `:1425`; the failure step `contains(needs.*.result, 'failure')` at `:1444-1450`.
- `scripts` change filter matches `'scripts/**'` at `ci.yml:68-69`.
- `scripts/ledger-guard.py:9` is `import argparse`, the first import. `scripts/tests/test_manage_users.py:19` is `import json`.
- The job is the only ruff gate over `scripts/`: `python-lint` runs per service (`ci.yml:436-443`). The lock therefore pins ruff for this gate, which answers O-4.
- The gate arrived with `c4b70c27` (`chore(scripts): pytest/ruff harness, shell freeze gate and tooling audit (port PR 1 of N) (#1514)`).
- Dry run: § Ruff proof dry run.

**TDD**: `N/A (proof-only: this feature ships no ruff code; the pre-fix red state is the tree before c4b70c27, cited and not re-run)`

**Covers**: `AC-2`

**Instructions**:
1. Run `uv sync --project scripts --extra dev --frozen`.
2. Wiring: run Verification block 1. It asserts that `scripts-python` runs on the `scripts` filter, runs the three commands, and is in both `ci-gate` lists.
3. Green: run block 2. All five commands exit 0. The job form must include `uv run --no-sync pytest` (O-20).
4. Red, the @AC-2 negative clause: run block 3. A planted `import os` in `scripts/ledger-guard.py` makes `ruff check scripts/` and the job form exit non-zero with F401 naming the file. The same holds for `scripts/tests/test_manage_users.py`. In the fixture file both forms exit 0. Each file is restored with `git checkout --` right after its runs. Nothing is staged (F-08, O-17).
5. Record every command, exit code and the F401 lines verbatim in `context.md`. State there that:
   - `ruff check scripts/` from the repo root and the job's `ruff check .` in `scripts/` gave the same result in every case, and that this equivalence carries to the C-16 promotion of @AC-2 (O-14);
   - @AC-2's pre-fix red state is the tree before `c4b70c27` (#1514), cited and not re-run (O-19);
   - O-4 is closed by the 0.17.4 lock while `scripts-python` is the only ruff gate over `scripts/`.
6. If any command in block 2 fails, stop and escalate for an operator ruling. Do not fix `scripts/` in this feature (design.md Part B).
7. No coverage threshold applies to `scripts/` (`docs/patterns/ci-overview.md:22`, threshold column `—`). C-13: no test data.

**Verification**:
```bash
# Block 1 — wiring
python3 - <<'EOF'
import yaml
j = yaml.safe_load(open(".github/workflows/ci.yml"))["jobs"]
sp = j["scripts-python"]
assert "'scripts'" in sp["if"]
assert sp["defaults"]["run"]["working-directory"] == "scripts"
runs = [s.get("run") for s in sp["steps"]]
for r in ("uv run --no-sync ruff check .", "uv run --no-sync ruff format --check .", "uv run --no-sync pytest"):
    assert r in runs, r
gate = j["ci-gate"]
assert "scripts-python" in gate["needs"]
assert "needs.scripts-python.result" in gate["steps"][0]["run"]
assert "contains(needs.*.result, 'failure')" in gate["steps"][1]["if"]
print("scripts-python gate wired")
EOF

# Block 2 — green
uv run --project scripts --no-sync ruff check scripts/; echo "root check rc=$?"
uv run --project scripts --no-sync ruff format --check scripts/; echo "root format rc=$?"
( cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync pytest -q ); echo "job form rc=$?"

# Block 3 — red, then the ignored fixture
plant() {  # $1 file, $2 anchor line ("" = top of file)
  python3 - "$1" "$2" <<'EOF'
import sys
p, a = sys.argv[1], sys.argv[2]
s = open(p).read()
if a:
    assert a + "\n" in s
    s = s.replace(a + "\n", "import os\n" + a + "\n", 1)
else:
    s = "import os\n" + s
open(p, "w").write(s)
EOF
}
probe() {  # $1 file, $2 anchor
  plant "$1" "$2"
  uv run --project scripts --no-sync ruff check scripts/ --output-format concise | grep "F401"; echo "$1 root rc=${PIPESTATUS[0]}"
  ( cd scripts && uv run --no-sync ruff check . > /dev/null 2>&1 ); echo "$1 job rc=$?"
  git checkout -- "$1"
}
probe scripts/ledger-guard.py "import argparse"
probe scripts/tests/test_manage_users.py "import json"
probe scripts/config-wiring-fixtures/gate/row-checks/services/xstockstrat-ingest/app/reader.py ""
git status --porcelain scripts/
```
Expected: `scripts-python gate wired`; `root check rc=0`, `root format rc=0`, `job form rc=0`; for `ledger-guard.py` and `test_manage_users.py` an F401 line naming the file and `rc=1` in both forms; for the fixture no F401 line and `rc=0` in both forms; an empty `git status` listing.

---

### Step 8 — docs: Flip the c8 enforcement claims in the CI overview and the two skill references (C-10)

**Status**: `pending`
**Service**: `docs/patterns/`, `.claude/skills/`
**Files**:
- `docs/patterns/ci-overview.md` — modify
- `.claude/skills/sdd-spec/reference/spec-template.md` — modify
- `.claude/skills/sdd-qa/reference/lang-node.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "not enforced\|unenforced\|follow-up defect\|only enforcing" docs/patterns/ci-overview.md .claude/skills/sdd-spec/reference/spec-template.md .claude/skills/sdd-qa/reference/lang-node.md` → `ci-overview.md:25`, `:90`; `spec-template.md:163`; `lang-node.md:9`, `:48`, `:52`, `:53`. No other hit in the three files.
- `ci-overview.md:25`: `| \`node-test\` (×4) | \`pnpm run test:coverage\` (Node.js services only) | 40% declared, not enforced (no \`--check-coverage\`; follow-up defect) |`.
- `ci-overview.md:90`: the Node.js leaves coverage note ending "`--lines 40` is unenforced without `--check-coverage`; verify with `pnpm exec c8 check-coverage --lines 40` after `test:coverage` (follow-up defect …)".
- `ci-overview.md:22` already documents `scripts-python`; it needs no change.
- `spec-template.md:163`: the Node leaves row, command `cd services/<name> && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40` with the note "`--lines 40` in the script alone is not enforced (follow-up defect)".
- `lang-node.md:9`, `:47` (`# c8 --reporter=text --lines 40 …`), `:48` ("the only enforcing check"), `:52-54` (the "declared … not enforced by CI" paragraph).
- Root `CLAUDE.md`: `grep -n "not enforced\|check-coverage" CLAUDE.md` → no match. The touchpoint is dropped (O-18).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `docs/patterns/ci-overview.md:25` — replace the row with:
   `| \`node-test\` (×4) | \`pnpm run test:coverage\` (Node.js services only); a guard step fails the job if a leaf's \`test:coverage\` stops passing \`--check-coverage\` to c8 | 40% lines, enforced by \`c8 --check-coverage --lines 40\` in each leaf's \`test:coverage\` |`
2. `docs/patterns/ci-overview.md:90` — keep the first sentence. Replace the rest, from "`--lines 40` is unenforced" to the end of the bullet, with:
   "`test:coverage` passes `--check-coverage --lines 40`, so a leaf below 40% lines fails locally and in `node-test`. c8 counts loaded files only, and an empty coverage map still passes, so check for non-zero impl rows when changing the harness."
3. `.claude/skills/sdd-spec/reference/spec-template.md:163` — replace the third cell with:
   `` `cd services/<name> && pnpm run test:coverage` — the script enforces 40% lines (`c8 --check-coverage --lines 40`) ``
4. `.claude/skills/sdd-qa/reference/lang-node.md`:
   - `:9` — replace "Coverage via `c8 --lines 40` — declared, not enforced: no script passes `--check-coverage` (see § Commands)." with "Coverage via `c8 --check-coverage --lines 40` in `test:coverage` — enforced locally and in CI (see § Commands)."
   - `:47` — change the comment to `# c8 --reporter=text --check-coverage --lines 40 … (fails below 40% lines)`.
   - `:48` — change the comment to `# optional re-check right after test:coverage (reads coverage/tmp)`.
   - `:52-54` — replace the paragraph with: "40% lines is enforced for all four by `test:coverage` (`--check-coverage`), locally and in the `node-test` job. `docs/patterns/ci-overview.md` is the reference."
5. Touch no other line in the three files.

**Verification**:
```bash
grep -n "not enforced\|unenforced\|follow-up defect\|only enforcing" \
  docs/patterns/ci-overview.md .claude/skills/sdd-spec/reference/spec-template.md .claude/skills/sdd-qa/reference/lang-node.md
grep -c -- "--check-coverage" docs/patterns/ci-overview.md .claude/skills/sdd-spec/reference/spec-template.md .claude/skills/sdd-qa/reference/lang-node.md
grep -n "not enforced\|check-coverage" CLAUDE.md
```
Expected: the first grep prints nothing; each file counts at least 1; the root `CLAUDE.md` grep prints nothing.

---

### Step 9 — docs: Mark the leaf findings rows and both defect-report sidecars resolved

**Status**: `pending`
**Service**: `services/*/docs/`, `docs/reports/`
**Files**:
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-identity/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify
- `docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.status` — modify
- `docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.status` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "c8-check-coverage-unenforced" services/xstockstrat-*/docs/context-constitution-findings.md` → config `:60`, identity `:62`, ledger `:63`, notify `:76`. Each row reads `| [\`2026-10-28-node-leaf-c8-check-coverage-unenforced-defect\`](../../../docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md) | Node-leaf c8 \`--lines 40\` is declared but never enforced (no \`--check-coverage\`) |`.
- Row convention for a fixed defect: `services/xstockstrat-config/docs/context-constitution-findings.md:55` ends its second cell with `→ fix: feature 241`. The section header at `:48-51` says a row stays until its report is resolved and pruned.
- The ruff report has no findings row: `grep -rln "scripts-ruff-lint-gap" services docs/context-constitution-findings.md` → no match.
- Both sidecars read `triaged` / `ref: feature:324-fix-ci-enforcement-gaps`.
- Sidecar format: `.claude/skills/sdd-qa/reference/defect-filing.md:26-47` — line 1 the status, line 2 `ref: <kind>:<target>`; kinds include `feature:<NNN-slug>` and `commit:<sha>` ("fixed directly, outside any track").
- The ruff gap was closed by `c4b70c27` (#1514), not by code in this feature (design.md Part B).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In each of the four findings files, append ` → fix: feature 324` to the second cell of the c8 row (config `:60`, identity `:62`, ledger `:63`, notify `:76`). Keep the link and the rest of the row. `/sdd-archiver` prunes the row with the report.
2. Overwrite `docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.status` with two lines: `resolved` and `ref: feature:324-fix-ci-enforcement-gaps`.
3. Overwrite `docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.status` with two lines: `resolved` and `ref: commit:c4b70c27`. The sidecar format has no third line, so the Step 7 proof and the pre-`c4b70c27` red state are cited in `context.md` (Step 7, instruction 5), which this `ref:` points back to through the commit.
4. Do not edit either report body.

**Verification**:
```bash
grep -c "c8-check-coverage-unenforced-defect.md) | .* → fix: feature 324 |" \
  services/xstockstrat-config/docs/context-constitution-findings.md services/xstockstrat-identity/docs/context-constitution-findings.md \
  services/xstockstrat-ledger/docs/context-constitution-findings.md services/xstockstrat-notify/docs/context-constitution-findings.md
cat docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.status docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.status
git diff --stat -- docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md
```
Expected: a count of 1 per findings file; `resolved`, `ref: feature:324-fix-ci-enforcement-gaps`, `resolved`, `ref: commit:c4b70c27`; an empty diff for the two report bodies.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
