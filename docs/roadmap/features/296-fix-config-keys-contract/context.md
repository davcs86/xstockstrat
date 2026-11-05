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

## Session 2026-11-05 (from 295 design approval)

- 295's design was approved on 2026-11-05 (5 rounds). Binding inputs for 296:
  - **Migration anchor:** `-- contract-of: …/035_config_markers.up.sql` (floor 35). 295's heal is
    `036`.
  - **Marker contract:** row `relative_keys_v1` plus a
    `pg_notify('config_changed','{"marker":"relative_keys_v1"}')` in the rename transaction. 295's
    servers read the marker in the same statement as the rows (reloadAll, reloadNamespace, overlay),
    behind a `to_regclass` guard.
  - **Inputs:**
    - the 296-owned `seeded-unread` baseline entries;
    - the `twin-secret-class` / `twin-kept-unsigned` / `per-user-unread` heal report rows;
    - heal rows with `updated_by='system:config-migration-036'`.
  - **Dead-row evidence rule:** zero `config.read_key` hits plus complete `config.read_coverage`
    across the staging release window. UI-read namespaces are never proven dead.
  - **Gate (295 decision 23):** 295 merged to `main-dev` plus one full staging release. No
    production DB exists (295 decision 24).
- Must also own:
  - the agent `get_config` FQN dedupe;
  - removing the FR-1 internal-caller canonicalisation exception in its follow-up.

## Session 2026-11-05 — sdd-review product-spec (correction, supersedes the 035/036 pins above)

- 295's implementation spec renumbered its migrations: marker `040_config_markers`, heal
  `041_heal_config_keys_to_reader_catalog` (heal artifacts `config_heal_report_041`,
  `system:config-migration-041`). 296's `-- contract-of:` anchor is `040_config_markers`; the final
  number is recorded by 295 Step 38. Disregard "035"/"036" in the entries above.
- Dead-row evidence window is one full **staging** release (295 decisions 23/24), not production.
- 296's own migrations are numbered max+1 after 295's chain at spec time.

## Session 2026-11-05 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (pass 3 of 3; passes 1–2 failed/warned on C-15 FR-3/6/7/8 coverage, then on evidence-window and placeholder items, all fixed).
- Warnings: FR-1 internal-caller exception scope (fixed: `SetConfig` only, grant `trading-reconciliation-poller`); generated contract key table deferred to design.
- Overlap findings: 296 vs 295 is a sequential expand/contract complement, no FAIL. Informational (not 296's): 291/295 on migration 035, 282/293 on 038, shared `scripts/config-wiring.json`. merge-order row 26 re-anchored to `040_config_markers`.
- Recommended design depth: full (DB migrations, 12 services, overlap warnings).

