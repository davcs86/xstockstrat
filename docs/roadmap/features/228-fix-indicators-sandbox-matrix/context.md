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
