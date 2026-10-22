# Context Log: fix-legacy-formula-authors

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md` (Issues disabled)
- Severity: SEV-2, environment dev (staging) → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services: xstockstrat-indicators
- Root cause hypothesis: pre-migration rows never backfilled from username to user id
- Recommended design depth: full → `/sdd-design fix-legacy-formula-authors` (rationale: a data rewrite on ownership rows is mentioned, and production has not been checked)
- Development branch: feature/fix-legacy-formula-authors
- Scope boundary with 275: 275 reports the failure instead of hiding it; this feature removes the cause.
- Open questions for design: are there production rows and other legacy-username authors; how the username maps to a user id (identity lookup vs a fixed mapping); delivery shape (migration vs script vs admin RPC) and rollback; whether the read guard should reject non-user-id authors at write time.

---

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - Criterion 9: OQ-1 to OQ-4 are plain bullets and still unresolved. OQ-1 (username-to-user-id mapping source) gates FR-1, FR-3, AC-1 to AC-3 and AC-7. They must be resolved at `/sdd-design` (C-11), before `/sdd-spec`. Kept as plain bullets deliberately (open checkboxes would fail criterion 9).
  - Criterion 7: DB strategy (migration, script or admin RPC), run order and down-migration meaning are unresolved; next migration number is 008 (tip 007), re-derive at spec time. A migration cannot call identity (OQ-1).
  - Criterion 8: AC-8 was non-deterministic. Resolved: rewritten as a concrete interleaving with concrete ids.
  - Criterion 8: FR-7 had no scenario for who-may-run or system-author rows. Resolved: added AC-9; the who-may-run mechanism is still a design decision.
  - Criterion 8: non-UUID ids (`f-orphan`, `f-ambiguous`, `f-live`, `f-gone`, `f-system`, `f-owned`) in AC-2 to AC-5 and AC-7, and AC-5 gives counts but no concrete rows. Left as-is; make concrete at `/sdd-spec`.
  - Criterion 8: AC-1 packs three outcomes in one `Then`; AC-5 presupposes a report-only mode (FR-5 allows dry-run or read-only report). Mechanism-agnostic by intent.
  - Cosmetic: FR-7 listed before FR-6. Resolved: reordered.
  - C-10(c): design must make FR-7 concrete (operator authority, concurrency protection, reserved system author never touched).
  - C-14: deferred checks to carry into `/sdd-spec`: confirm no UI code change, and check the `strat-lab` plugin `backtest` skill for any documented quirk this changes.
  - Code-grounded check: the read guard matches the spec (`_can_read_formula` at services/xstockstrat-indicators/app/handlers/servicer.py:141-148; `GetFormula` NOT_FOUND for a non-reader non-admin). The `list_formulas` author_filter behaviour and the 268/275 overlap content were not verified by the reviewer.
- Overlap findings (WARN, no FAIL):
  - File: services/xstockstrat-indicators/app/handlers/servicer.py read path and `_can_read_formula` vs `268-fix-indicators-formula-correctness` (product-spec.md:77-78, D-54). Rebase-level risk; 276 must not edit the read guard (FR-6).
  - File: servicer.py vs `269-fix-template-update-metadata` (implementation-spec.md:65, :77, ManageTemplate, disjoint handler). Rebase-only.
  - File: servicer.py vs `244-fix-python-config-stored-zero`. Rebase-only.
  - Handoff, not a collision: `275-fix-backtest-silent-symbol-skip` (product-spec.md:61-63, :159) defers the legacy-username author rewrite to this feature; 275 is read-only on indicators and expects this fix to remove the cause of the PERMISSION_DENIED/NOT_FOUND it reports.

### OPERATOR DECISIONS (binding, recorded 2026-10-22)

- Triaged 2026-10-22 from docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md; Track C; same triage-to-spec workflow as the debt-radar batch (254-275). The feature dir lives on the base branch ccr-fac38b1f-6m24q2 (PR #1322, not yet merged to main-dev).
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Scope boundary with feature 275-fix-backtest-silent-symbol-skip: 275 makes the failure visible (EVALUATION_FAILED rows, INSUFFICIENT_DATA, and maps an admin's PERMISSION_DENIED to FORMULA_ERROR); this feature removes the cause by correcting the stored authors. Do not re-do 275's reporting changes.
- Operator instruction 2026-10-22: run the full speccing (review, recon, full design debate, spec, impl-spec review). Production has NOT been checked for legacy-username authors; the design must treat the prod row count as unknown and must not assume the six staging ids are the only ones. Do not run any production or staging data change during speccing.
- Review note 2026-10-22: the first two product-spec reviews failed on PERMISSION_DENIED vs NOT_FOUND. Indicators returns NOT_FOUND to a non-admin caller (servicer.py:251-253) and PERMISSION_DENIED only to an admin (servicer.py:245-250); the branch already carries the corrected FR-1 and AC-6 text, so review the CURRENT branch text.
