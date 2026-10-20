# Context Log: fix-python-config-zero-trap

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-python-config-zero-trap-defect.md` (Issues disabled):
  Python config getters collapse a stored 0 / "" to the coded default (CF-N10).
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Config-only fix: no. Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1 getters, AC-2 zero-cost backtest,
  AC-3 zero signal-rank weight, AC-4 unset → default, AC-5 ingest semaphore clamp kept), context.md.
- Affected services (from report): xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest.
- Root cause hypothesis: truthiness `or default` conflates unset with zero; fixed only per key via `*_present`.
- Confirmation evidence (report, confidence high, static; triage re-grep 2026-10-20): `or default` at
  analysis `watcher.py:97,105,134`, indicators `:96,114,130`, ingest `:110,118,144`; `get_bool` uses `HasField`
  in all three; indicators lacks `get_int_present`/`get_float_present`. Call sites `servicer.py:787-788,4615`,
  `live_loop.py:351` confirmed.
- Design risks found at triage (for recon):
  - Deliberate trap call sites besides ingest `watcher.py:185,208`: analysis `servicer.py:790` (0 and absent both
    mean legacy), `:1152`, `:2913` (stored 0 → default 20). A blanket `HasField` switch changes these; each needs an
    explicit clamp or a kept trap.
  - Seeded zero/empty rows change effective value under `HasField` wherever the coded default differs from the
    seed, e.g. `analysis.fundsignal.explicit_symbols` / `scoring_formula_id` (`''`), `fundsignal.min_conviction_to_emit`
    (`0.0`), `opportunity.refresh_hour_utc` / `readiness_materializer.refresh_hour_utc` (`0`). Recon must audit every
    seeded 0/`""` row against its call-site default before switching.
  - Config bounds (`configServiceImpl.ts:115-117`) set `minValue: 1` on keys "where 0 already collapses to the code
    default"; with the trap gone, a stored 0 could become reachable via those keys' existing rows — recheck.
- Overlap: 243-fix-sandbox-seed-keys touches the same indicators `watcher.py` (sandbox getters use `get_int`);
  soft ordering, whichever lands second reconciles.
- Recommended design depth: full → `/sdd-design fix-python-config-zero-trap` (rationale: SEV-2; 3 affected
  services; per-key behaviour change across every Python config read needs a debated clamp policy).
- Development branch: feature/fix-python-config-zero-trap
