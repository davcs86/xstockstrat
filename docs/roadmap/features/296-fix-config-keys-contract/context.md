# Context Log: fix-config-keys-contract

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (split from 295 /sdd-design)

- Created by the 295 design-phase re-scope (295 `context.md`, operator decision 13): Release B
  (contract) became a separate feature, so 295 launches cleanly at its promotion. This feature
  carries a merge-order row "waits for `fix-config-keys-drift` launched".
- Number 296 was reserved via `scripts/sdd-allocate-feature-number.sh`.
- Binding inherited operator decisions (295 context.md): 1 (relative canonical key), 10 (C-16
  CHANGE sign-off C1–C6, N2), 12 (alias activates only after the rename, via marker + pg_notify),
  13 (this split).
- Moved from 295: product-spec FR-1/FR-2 (enforcement and literal rewrite), the rollout/rollback
  ACs (295's former AC-1, AC-2, AC-5, AC-21), and the relative half of AC-19/AC-20.
- Design input: 295's `recon.md` and `design.md` (once approved). Notably R1 (two-release
  sequencing), and the round-1 adversary objection M5 (the 037/038 race leaves PRE_DEPLOY dirty) and
  minor m9 (contract-of proves the file, not the deployed alias code).
- Development branch: feature/fix-config-keys-contract.

## Session 2026-11-04 (from 295 design round 2)

- Inherits **295 decision 15**: dead-row deletion (formerly 295 FR-6/AC-15) moves here, gated on
  static and runtime evidence: FR-9 / AC-7.
- The rename migration's `-- contract-of:` anchors on **295's 036 marker DDL** (round 2 MAJOR-7).
