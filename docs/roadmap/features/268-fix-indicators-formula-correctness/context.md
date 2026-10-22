# Context Log: fix-indicators-formula-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-indicators-formula-correctness-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-10, D-18, D-54.
- Severity: SEV-2 (group severity; D-54 alone was rated one tier lower by the surveyor). Impact type:
  wrong-indicator-output. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..7), context.md.
- Affected services: xstockstrat-indicators (fix site); xstockstrat-analysis (ATR/VWAP consumer); packages/proto
  only if D-18 adds OHLCV input.
- Root cause hypothesis: D-10 success inferred from return code alone plus `BaseException` subclasses admitted to
  formula builtins; D-18 the 1-D `values` contract cannot carry high/low/volume and the approximations kept the real
  names; D-54 the mutating RPCs bypass `_load_formula`'s pending-hidden check.
- Re-verification on main-dev @ a053b0e: all three reproduce in code. Line drift: D-10 `sandbox.py:252`, `:399`
  unchanged (output print `:310-312`, success return `:419-427`); D-18 `indicators_engine.py:103-116`, `:141-142`
  unchanged; D-54 moved — `UpdateFormula` `get_by_id` `:483` → `:490`, `DeleteFormula` `:586` → `:593`,
  `_load_formula` `:146-151` → `:150-157`.
- **D-18 changes historical backtests**: either fix (true OHLCV ATR/VWAP or rename) changes numeric output for every
  strategy/backtest using them; stored grades built on the approximations will not reproduce. Design must decide
  communication and whether grades are recomputed. `ComputeIndicatorRequest` (`indicators.proto:54-61`) has only
  `values`, so the true-indicator path is a proto change (Proto Reviewer + `buf breaking`).
- **Overlaps:**
  - Hotfix `3340a7c` (sandbox override clamp, `_clamp_override` in `servicer.py` `ExecuteFormula`) is already in
    HEAD; it does not touch `sandbox.py` or `UpdateFormula`/`DeleteFormula`. Rebase-safe; no functional overlap.
  - 243-fix-sandbox-seed-keys (`implementation-ready`): its implementation spec (on `origin/feature/fix-sandbox-seed-keys`)
    touches indicators `CLAUDE.md`, `docs/context-constitution-findings.md`, `tests/test_config_watcher.py` and a config-service
    seed-heal migration (`031_heal_indicators_sandbox_keys_full_dotted`) — not `sandbox.py`/`servicer.py` code. Expect a doc conflict in indicators `CLAUDE.md` only.
  - 244-fix-python-config-stored-zero (`implementation-ready`) edits `sandbox.py:282`, `:345-346` (memory guard,
    `RLIMIT_NPROC`) and `servicer.py` `ExecuteFormula` config reads — same file as D-10, different region; sequence via
    `merge-order.md`.
  - Open adjacent reports (not merged into this feature): `2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`
    (exit-reason classification `sandbox.py:401-405`, right beside the D-10 parse) and
    `2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`. Design may choose to absorb the first.
  - Related, unconfirmed: debt-radar NC-A (`InstantiateTemplate` retry idempotency, `servicer.py:684-713` at scan).
- Recommended design depth: full → `/sdd-design fix-indicators-formula-correctness` (rationale: affected services ≥ 2
  — analysis consumes ATR/VWAP — and D-18 may need a proto change). Design forks: D-18 OHLCV contract vs rename;
  D-10 strip `SystemExit`/`KeyboardInterrupt`/`GeneratorExit` from builtins vs treat "no output line" as failure (or both).
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-indicators-formula-correctness
