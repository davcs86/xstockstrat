# Context Log: fix-analysis-backtest-bounds

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:272-fix-analysis-backtest-bounds`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-28, D-29.
- Severity: SEV-2 (group). Impact type: silent-partial-backtest-data. Environment: dev (main-dev) @ a053b0e.
  Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services: xstockstrat-analysis (fix site), xstockstrat-config (seeded key; migration only if retired).
- Root cause hypothesis: D-28 guard does not tell EOF from a re-served page by whether a token was sent; D-29 key
  seeded in the first config migration with no implementation.
- Re-verification on a053b0e: both D-ids reproduce by reading; no line drift.
  - D-28: `servicer.py:1432-1435` (unchanged); docstring `:1394-1412`; `_MAX_BAR_PAGES = 32` `:298`,
    `_BAR_PAGE_SIZE = 1000` `:294`. **Test that locks the bug in:** `tests/test_warmup.py:236-243`
    (`test_identical_page_with_identical_token_terminates` asserts `[1, 2]`). The fix must invert it to expect
    `_BarFetchError` — a deliberate test change, not a regression (record in design per C-18).
  - D-29: `001_config_tables.up.sql:69`, `002_config_environment.up.sql:71`, analysis `CLAUDE.md:468` (all unchanged);
    0 readers in `app/`; screener's own key read at `servicer.py:3786` (unchanged); `RunBacktest` at `:785`, no
    `wait_for`. `docs/reports/2026-08-07-config-governance-audit.md` also mentions the key (historical).
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) changes the analysis getters. If D-29 wires the key,
    read it presence-aware so a stored 0 is not silently replaced (or clamp 0 = no limit explicitly), and rebase on 244.
  - `docs/reports/2026-10-19-dead-config-keys-defect.md` (`open`) does not list this key; if design retires it, note
    the addition there or in its eventual feature to avoid a second retirement.
  - No feature in 240–253 touches `_fetch_bars_paged` or `RunBacktest`'s deadline.
  - `strat-lab` plugin: if `run_backtest` gains a new failure mode (truncation error or `DEADLINE_EXCEEDED`), root
    CLAUDE.md requires the `backtest` skill update in the same PR (`docs/patterns/strat-lab-plugin.md`).
- Recommended design depth: full → `/sdd-design fix-analysis-backtest-bounds` (rationale: 2 affected services and a
  possible config migration — the C-0 full trigger). Design fork for D-29: wire `asyncio.wait_for` (and the
  production 120 s value then becomes live — check current backtest durations on dev first) vs retire the key.
- Development branch: feature/fix-analysis-backtest-bounds
