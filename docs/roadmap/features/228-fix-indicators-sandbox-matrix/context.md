# Context Log: fix-indicators-sandbox-matrix

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-15 (/sdd-triage)

- Bug recorded as `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md` (Issues disabled). Found while driving PR #1247, whose indicators job went red on code it
  does not touch.
- Severity: SEV-3. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md.
- Affected services: xstockstrat-indicators.
- Root cause hypothesis: the sandbox child sits at its 128 MiB `RLIMIT_DATA` cap, and headroom is host-dependent
  (likely OpenBLAS's runtime kernel/buffer selection). Not a #1246 regression: identical tree b5a7ca59 both
  passed and failed. #1246's "attempt 2 pass" was a copied job that never executed.
- Production exposure: latent. User formulas run under the same 128 MiB default.
- Feature number: 228. 226 is on main-dev; 227 is held by open PR #1247 (`fix-opportunities-read-hangs`).
- Recommended design depth: quick → `/sdd-design fix-indicators-sandbox-matrix quick`. Rationale: SEV-3 and a single service, but the root
  cause is not yet confirmed and a config-default change is a candidate fix.
- Development branch: feature/fix-indicators-sandbox-matrix.

## Session 2026-10-15 — sdd-design (quick)

- Operator said "go" for the quick design. The `draft` status was accepted for a Track C bug.
- **Phase 0 Recon** wrote recon.md (service: indicators, plus config seeds checked). Orchestrator measurements
  (numpy 2.4.3, pandas 3.0.1, Py 3.12.3):
  - the post-import `VmData` baseline is about 75–88 MiB;
  - the 800×800 matmul needs 116 MiB total, the same for every `OPENBLAS_CORETYPE` and CPU affinity, so the
    coretype hypothesis is refuted;
  - with threads unpinned it needs 237 MiB;
  - at a 64 MiB absolute cap, any Series ≥ 20k points raises `MemoryError`;
  - with headroom semantics the headroom is exact (64 MiB: 62 MiB alloc ok, 66 MiB fails), and 800×800 needs
    42 MiB of headroom.
  - Staging config shows bare `sandbox.*` keys (128 MiB), so the indicators seeds are inert (CONFIG-9).
- **Phase 1** ran 1 round (quick). The adversary returned APPROVE WITH FIXES (11 objections, all folded in), with
  no Floor breach and no C-16 regression.
  - **Chosen:** `memory_bytes` becomes headroom above the child's pre-lockdown `VmData` baseline, probed right before
    `setrlimit`, fail-closed, with the cap clamped to int64. `json.loads` moves after the rlimits. The OpenBLAS abort
    is classified as `memory_exceeded`.
  - **Rejected:** raising the cap only; shrinking the test; `OPENBLAS_CORETYPE`; `RLIMIT_AS`; cgroups; a hybrid
    ceiling; a 64 MiB default.
- **Operator decision (2026-10-15):** default headroom **128 MiB**, chosen over 64 MiB. The larger container
  envelope is accepted as a risk: about 812–864 MiB worst case at `max_concurrent=4`, with basic-s RAM unconfirmed.
- Also: `@FR-1`/`@FR-2` were added to product-spec.md and acceptance.feature (C-15). Migrations 001/002 are not
  edited (F-01).
- **Open Threads:**
  - container envelope on basic-s (verify at the dev smoke);
  - the production `indicators.sandbox.memory_bytes` row is unverified;
  - the dev smoke (400 MiB → `memory_exceeded`; 32 MiB at a 64 MiB override → ok) is owed at post-deploy.
- Status: draft → design-approved.

## Session 2026-10-15 — sdd-review product-spec (re-run at operator request)

- **First pass: FAIL.**
  - Blockers: C-14 (no Consumer Surface(s) section) and C-15 (@AC-1/@AC-2 not concrete; the OpenBLAS half of FR-2
    was uncovered).
  - Warnings:
    - stale coretype root cause;
    - unresolved Fix Scope;
    - xstockstrat-ui missing from Affected Services;
    - no FR for the fail-closed probe;
    - personas, Out of Scope and Open Questions.
- **Fixed:**
  - Consumer Surface(s): UI `formulaReference.ts:171`; agent `test_formula` `exit_reason`.
  - `acceptance.feature` rewritten as @AC-1..5 with concrete values; FR-3 added (probe fail-closed).
  - Root Cause, Fix Scope, Affected Services (+ui), personas, Out of Scope, and Open Questions / Owed Verification
    refreshed.
  - design.md test mapping updated (T2b→1, T3→2, T2→3, T4→4, T5→5).
- **Second pass: PASS WITH WARNINGS.** The one warning (relabel the owed post-deploy checks) has been addressed.
- **Overlap: CLEAN.** PR #1247 (227) also edits `docs/context-constitution-findings.md`, which may cause an
  adjacent-row text conflict only (WARN). No merge-order entry is needed.
- Status unchanged: design-approved. The lifecycle is already past spec-ready.
- Ledger candidate: the Track C product-spec template (`.claude/skills/sdd-triage/reference/track-c-sdd.md`) has no
  `## Consumer Surface(s)` section, so every Track C spec fails C-14 at review.

## Session 2026-10-15 — sdd-spec

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
  - Steps 1–2: the `sandbox.py` service step and its paired test step (T1–T5).
  - Step 3: the UI `formulaReference.ts:171` copy.
  - Step 4: docs plus the context-forge teardown.
- Key codebase findings:
  - All runtime change is in `services/xstockstrat-indicators/app/services/sandbox.py`:
    - the wrapper input parse is at `:246-250`;
    - the `RLIMIT_DATA` block is at `:274-278`;
    - the single `.format` call site is at `:338-350`;
    - the classification is at `:391-396`.
    The probe becomes a module constant `_VMDATA_PROBE`, interpolated like `_SECCOMP_ALLOW`, so T5 can `exec` it
    standalone and inject a probe failure via monkeypatch.
  - Agent `test_formula` needs **no code step**. It forwards `exit_reason` verbatim (`agent/app/client.py:1023-1025`)
    and exposes no memory override (`tools.py:1459-1465`).
  - RED was measured on the current tree. A 32 MiB alloc at `memory_bytes=64 MiB` gives `memory_exceeded`, and so
    does a 96 MiB alloc at the default 128 MiB.
  - **Environment trap.** Running as root under a `0700` dir (`/tmp/claude-0`) fails every real-subprocess sandbox
    test with `ModuleNotFoundError: pyseccomp`, because the uid-65534 child cannot traverse to the venv. Using a
    world-traversable venv gives a baseline of 33 passed. This is recorded in the spec's § Step Dependencies.
- **P-03 escalation for /sdd-review.** design.md's dev smoke "32 MiB at `memory_bytes_override=64 MiB`" cannot run
  via the MCP, which has no override parameter. The spec substitutes a 96 MiB alloc at the default headroom, which
  fails today and passes only under headroom semantics. The operator confirms or replaces this.
- The findings go to the indicators findings file, not the root `docs/context-constitution-findings.md`. This removes
  the #1247 adjacent-row overlap noted at review.
- The runbook examples' bare `sandbox.*` keys switch to full-dotted keys for all indicators keys in those blocks
  (C-10), not only `memory_bytes`.

## Session 2026-10-15 — sdd-review impl-spec (advisory)

- **Result:** 0 failures, 5 warnings, no Floor breach (advisory). All findings were resolved before execution by
  editing the spec, since no step had started:
  - [x] Step 1: E501. The dictated comment/docstring text is rewrapped to ≤ 100 cols. Verification uses
    `uv run --no-sync ruff`.
  - [x] Steps 1–4: grep "expect none" checks became `! grep`, so they exit 0 when the text is absent.
  - [x] Step 3: a note that existing `/insights` E2E coverage still applies (B3).
  - [x] Step 4: re-anchor the findings rows at `:10`, `:20` and `:22`. Teardown fixes are limited to the step's
    Files, and other drift goes to the Deviation Log (F-08). The migration check is
    `git diff origin/main-dev...HEAD` (F-01).
  - [x] Dev smoke #2: the substitution (96 MiB at the default headroom) is accepted by the orchestrator.
    Operator confirmation is surfaced in the session summary (P-03).
- **Overlap:** CLEAN. This feature no longer edits the root findings file, so there is no overlap with #1247.

## Session 2026-10-15 — sdd-execute sequential (Steps 1–2)

- Mode: sequential, at operator request (counts as the up-front confirmation). Steps 1↔2 run as one red-green cycle:
  Step 2's tests were authored first, unstaged, and run RED against the pre-Step-1 `sandbox.py`.
- **Environment.** As root, the uid-65534 child must traverse to the venv. `/tmp/claude-0` is reset to `0700`
  between shell calls, so every real-sandbox run did `chmod 711 /tmp/claude-0` in the same command. The
  main-checkout venv (`/home/user/xstockstrat/...`) works for the sandbox files but has a stale OpenTelemetry set
  (3 `test_telemetry.py` failures: `ProxyTracerProvider.force_flush`), so the full suite used the worktree venv.

### Step 1 — service: indicators sandbox — `VmData` baseline + headroom cap, input parse after rlimits, OpenBLAS OOM marker [done]
- Files: `services/xstockstrat-indicators/app/services/sandbox.py`.
- Added `_VMDATA_PROBE` (after `_SANDBOX_GID`) and `_MEMORY_EXHAUSTED_MARKERS` (after `SandboxResult`). The wrapper
  now runs `{vmdata_probe}` → `RLIMIT_DATA = min(_baseline + memory_bytes, 2**63 - 1)` → CPU/NPROC/FSIZE/NOFILE →
  `json.loads` of `data`/`params` → seccomp `.load()` → `exec`. `.format` gained `vmdata_probe=_VMDATA_PROBE`.
  Module docstring rewrapped as dictated.
- Verification: grep anchors present (`:61`, `:201`, `:281`, `:283-284`, `:360`, `:406`); the old literal
  `RLIMIT_DATA, ({memory_bytes}, {memory_bytes})` is absent; "wrapper order OK"; `ruff check` and
  `ruff format --check` clean.
- Deviations: none.
- TDD (paired with Step 2; per-test lines in the Step 2 entry): red: 6 failed / 33 passed on
  `test_sandbox_isolation.py` + `test_sandbox.py` (T1, T2, T2b, T4, T5×2 red; T3 green as the preservation
  guard) → green: 39 passed.

### Step 2 — test: indicators sandbox — @AC-1..5 headroom, fail-closed, classification and probe [done]
- Files: `services/xstockstrat-indicators/tests/test_sandbox_isolation.py`.
- Added in-file helpers `_MIB`, `_LINALG_800_SRC` (now also used by `test_large_array_linalg_hits_mbind`),
  `_ALLOC_32MIB_SRC` and `_fake_popen` (lifted from T1's inline `_FakeProc`). C-13: single-file consumers, no
  `conftest.py` entry.
- Tests: T1 rewritten (`TestLimitsConfigured::test_rlimits_derive_from_config_in_wrapper`); T2b
  `TestNumericParityGolden::test_large_array_linalg_at_half_default_headroom`; `TestMemoryHeadroom` (T2, T3);
  `TestExitReasonClassification` (T4); `TestBaselineProbe` (T5 ×2).
- TDD red (pre-Step-1 `sandbox.py`):
  - AC-1 red: T2b `assert False is True` (`Unable to allocate 4.88 MiB` at 64 MiB absolute cap);
  - AC-3 red: T2 `_ArrayMemoryError: Unable to allocate 32.0 MiB` at 64 MiB;
  - AC-4 red: T4 `'runtime_error' == 'memory_exceeded'`;
  - AC-5 red: T5 ×2 `AttributeError: module 'app.services.sandbox' has no attribute '_VMDATA_PROBE'`;
  - T1 red: `assert 'VmData:' in wrapped`;
  - AC-2: T3 green before (`memory_exceeded`), the preservation guard.
- TDD green: `test_sandbox_isolation.py` + `test_sandbox.py` 39 passed; flake guard
  (`TestNumericParityGolden` + `TestMemoryHeadroom`) 5/5 runs × 9 passed; full suite 290 passed, coverage 85.61%
  (≥ 50%); `ruff check` / `ruff format --check` clean; `! grep conftest` OK.
- Deviations: none.

## Session 2026-10-15 — sdd-execute sequential (Steps 3–4)

- Operator confirmed the checkpoint after Step 2. Steps 3–4 run without per-step prompts.
- Tooling: `pnpm install --frozen-lockfile --filter xstockstrat-ui...` in the worktree (no lockfile change).

### Step 3 — service: xstockstrat-ui — `/insights` formula reference Memory row describes headroom [done]
- Files: `services/xstockstrat-ui/src/components/insights/formulaReference.ts`. The Memory `note` is now
  `'Headroom above the interpreter/library baseline (indicators.sandbox.memory_bytes).'`; label and value unchanged.
- Verification:
  - the grep finds the new note (now at `:174` inside the prettier-wrapped row);
  - `! grep -rn "Hard cap" src` passes;
  - `pnpm run lint` passes (warnings only, all pre-existing);
  - `prettier --check` passes after `prettier --write`;
  - `tsc --noEmit` has 2 pre-existing errors in `e2e/insights/backfills.spec.ts:135-136`, identical at base and not
    run by CI.
- TDD: N/A (copy only, per the spec).
- Deviations: the file was already non-prettier at base, so the reformat touched 3 extra blocks (whitespace-only).
  The tsc baseline errors are out of scope. See the Deviation Log.

### Step 4 — docs: headroom semantics in indicators docs and runbooks; findings; teardown [done]
- Files:
  - `services/xstockstrat-indicators/CLAUDE.md`
  - `services/xstockstrat-indicators/docs/context-constitution.md`
  - `services/xstockstrat-indicators/docs/context-constitution-findings.md`
  - `docs/runbooks/indicator-builder.md`
  - `docs/runbooks/config-rollout.md`
- Instructions 1–5 applied:
  - the headroom wording in the config table, the lockdown order and the rlimits bullet;
  - INDICATORS-1/-2 and the candidate row (OpenBLAS marker);
  - the findings re-anchors (`:10`, `:20`, `:21`, `:22`) and three new open bullets (inert seeds, D-33 unclamped
    override, `address-space` wording drift);
  - runbook headroom wording and full-dotted `indicators.sandbox.*` keys.
- Verification:
  - every grep found its target;
  - `! grep "\"key\": \"sandbox\."` passes in both runbooks;
  - every `sandbox.py:<n>` anchor in the two indicators docs resolves to the cited code (checked line by line);
  - `git diff origin/main-dev...HEAD -- services/xstockstrat-config/migrations` is empty (F-01).
- TDD: N/A (docs).
- Deviations: teardown re-grounded all stale anchors in the constitution, marked the feature-209-superseded ⚠
  security finding resolved, and fixed the CLAUDE.md:4 pointer. `config-rollout.md` drift that is not about
  sandbox memory (port-8060 `RolloutConfig` curl; the nonexistent `indicators.sandbox.memory_exceeded` alert) is
  recorded and not fixed. See the Deviation Log.

### Teardown (manual)
- **Plugin unavailable.** `/context-forge:context-constitution refresh` is not installed in this session (only
  `context-forge:context-scrubber` exists). The equivalent was done by hand, scoped to Step 4's Files plus
  `services/xstockstrat-indicators/app/services/sandbox.py`.
- **Re-read against the current code** (post-Step-1 `sandbox.py`, `app/handlers/servicer.py`,
  `app/services/parameters.py`, `app/services/seed_formulas.py`, `app/main.py`, `app/config/watcher.py`, the config
  migrations `001`/`002`, the durable suite `acceptance/indicators-sandbox-os-isolation.feature`):
  `services/xstockstrat-indicators/CLAUDE.md`, `services/xstockstrat-indicators/docs/context-constitution.md`,
  `services/xstockstrat-indicators/docs/context-constitution-findings.md`, `docs/runbooks/indicator-builder.md`,
  `docs/runbooks/config-rollout.md`. The `scrubberExtraTargets` (`README.md`, `docs/patterns/ui-ux-governance.md`)
  were grepped: no sandbox, `memory_bytes` or `RLIMIT` reference, so there was nothing to reconcile.
- **Reconciled:**
  1. `context-constitution.md`: re-grounded every `path:line` anchor. sandbox.py:
     - INDICATORS-1 `:45-53` / `:125-141`;
     - INDICATORS-2 `:61-64` / `:283-284` / `:279`;
     - INDICATORS-4 `:239-255` / `:246`;
     - INDICATORS-6 `:268-271`;
     - INDICATORS-7 `:71` / `:296-302`;
     - INDICATORS-8 `:274`;
     - INDICATORS-9 `:316-325` / `:373`;
     - candidate `:402-407` + `:201`.

     servicer.py:
     - INDICATORS-3 `:283`, `parameters.py:50,153`;
     - INDICATORS-5 `:105`, `_reader` `:115-125`;
     - gotchas `:489,592`, `:314-319`, `seed_formulas.py:35`.

     Pointers: `CLAUDE.md:179,190,214`, `main.py:48`, `watcher.py:81-83`. Added a header line for the hand
     refresh.
  2. `context-constitution-findings.md`:
     - re-anchored `:10` (`sandbox.py:22-25,279-280`), the stderr-classification question (`:201,402-407`, both
       memory markers) and `memory_used_bytes` (`sandbox.py:387,414,425`, `servicer.py:325,341`);
     - marked the ⚠ temp-file / no-OS-isolation question **resolved (feature 209)**, because the
       `NamedTemporaryFile` is gone (stdin at `sandbox.py:363-374`) and seccomp, the distinct UID and the rlimits
       shipped;
     - added the three new open bullets with verified anchors.
  3. `services/xstockstrat-indicators/CLAUDE.md:4`: the stale "⚠ sandbox env inheritance" (resolved 2026-09-16)
     now reads "defects and open questions".
- **Recorded, not fixed:** `docs/runbooks/config-rollout.md`:
  - the § Step 3 `RolloutConfig` curl uses the removed Connect-RPC port `8060`;
  - § Step 5 names a nonexistent `indicators.sandbox.memory_exceeded` alert.

  Both are pre-existing, unrelated to sandbox memory, and need a design call (Deviation Log).
- **Untouched:** the root `docs/context-constitution-findings.md`, the applied migrations (F-01) and the durable
  acceptance suite (C-16).

## Session 2026-10-15 — sdd-execute (sequential) summary

- Steps 1–4 are done: 651fefea, 97b5f02e, 830f8915, 4b554485. The operator confirmed both checkpoints.
- C-16 promotion (operator-confirmed): @AC-1..5 → `services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`,
  tagged `@feature-228`. No dedup skips.
- Owed post-deploy (O-3):
  - a 400 MiB resize gives `memory_exceeded`;
  - a 96 MiB alloc at the default headroom succeeds (the operator was told of this substitute, since `test_formula`
    cannot set an override);
  - the basic-s memory envelope;
  - whether production has a full-dotted row.
- Follow-ups recorded, not done:
  - `config-rollout.md` port-8060 curl and nonexistent alert;
  - UI tsc errors in `e2e/insights/backfills.spec.ts:135-136` (pre-existing, feature 198);
  - CI runs Python 3.12.3 instead of 3.13;
  - Track C template lacks a Consumer Surface(s) section.
