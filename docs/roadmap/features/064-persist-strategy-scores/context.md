# Context: persist-strategy-scores  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Added DB-backed durability for `ScoreStrategy` output via a write-through cache: `self._strategies` stays the sole read path, the DB is a best-effort durability backup, and a boot-time `hydrate_scores()` repopulates memory from `analysis.strategy_scores`. Shipped exactly as designed — no read-path change, no new pool (context.md:107-154).
**Why (irrecoverable rationale)**: The proposer's original plan (DB-direct reads) was rejected mid-debate because best-effort writes (FR-7) + DB-direct reads created a false-success hazard: a client told "scored" via a swallowed upsert would get `NOT_FOUND` on the very next read. Write-through+hydrate makes read-your-writes hold under a silent write failure (design.md:12-16, 85-87).
**Rejected alternatives**:
- DB-direct reads — false-success under swallowed writes; also leaves `:708`'s in-memory write dead/unbounded (design.md:85-87).
- Pure DB-direct + fake-repo for no-DB tests — removes dead-state but keeps the ack-then-vanish gap, forces touching `make_servicer()` (design.md:88-90).
- Explicit DB-then-memory read precedence — solves read-your-writes without a boot hook but reintroduces dual-source read branching for no real gain over hydrate (design.md:91-93).
- FK `strategy_id → strategies.strategy_id CASCADE` — strategies are only soft-deactivated, and ad-hoc backtests can score an id with no definition row, so FK buys nothing but adds ordering constraints (design.md:94-96).
**Scars & gotchas**:
- Docker/local DB unavailable during execution; migration apply/rollback/upsert-idempotency proven instead against a throwaway local `postgres:16` cluster (initdb+pg_ctl, unprivileged user), pre-creating `CREATE SCHEMA analysis` manually (context.md:110-114).
- Interactive confirmation gates unavailable in this non-interactive sequential run; the explicit `/sdd-execute … sequential` invocation was logged as standing authorization; per-step PRs replaced by per-step commits + one integration PR #742 (context.md:103-105).
- JSONB copy-trap avoided ahead of time: mirrored `_to_dict` had to decode `component_scores`, not blind-copy `strategies.py`'s `definition_json` key (design.md:44-46).
- `math.isfinite` deliberately scoped only to the `component_scores` comprehension, never around `overall_score`, because `overall_score` lands in a `DOUBLE PRECISION` column (Postgres accepts NaN/Infinity there) while `component_scores` lands in JSONB (Postgres rejects non-finite numbers, silently failing the upsert). The asymmetric guard in `servicer.py` is intentional, not a bug (design.md:109-112; context.md:85-87).
- Testing-methodology gotcha surfaced in adversarial debate: mocking the repo's `fetchrow` to echo back its own input as the return value produces false serialization coverage — a repo/servicer test built that way never exercises `_to_dict`'s real JSONB-string-decode branch, so a decode bug would pass silently. This is why the design mandated the repo test assert `_to_dict` against a literal JSON **string** row, not a mock-echoed dict — a generalizable trap for any future repo test mocking asyncpg with JSONB/serialized columns (design.md:72-73; context.md:43).
**Permanent deviations**: none — design.md's approach shipped faithfully; encapsulating hydrate logic in a testable `hydrate_scores()` method was already implied by design.md, not a divergence (context.md:69-71).
**Cross-feature signal**: - Deliberately reverses the Phase-3 in-memory-storage decision (`phase3-deviations.md`) but *only* for scores — not `self._backtests` or screener scans. Future analysis-service features must not assume a general "persist everything" precedent (design.md:51-52).
**Deferred follow-ons**:
- `BacktestResult`/`latest_backtest` still not persisted — post-restart returns `null` until a fresh `RunBacktest` (design.md:100-104).
- No retention/pagination on `analysis.strategy_scores`; deactivated/ad-hoc scores persist and hydrate indefinitely (design.md:105-108).
**Ledger entries written**: insights.md (3), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
