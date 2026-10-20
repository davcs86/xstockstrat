# Context Log: fix-sandbox-seed-keys

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md`
  (Issues disabled): indicators sandbox config seeds use bare keys and never apply.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Report marks config-only fix possible (yes) and impact
  type `config-propagation`, which would route Track B.
- **Operator decision (2026-10-20): fix in code plus a config migration, not a manual SetConfig.** This overrides
  the Track B (config-only `SetConfig create_key`) route; routed to SDD path (Track C) instead. Fix Scope DB
  migration line ticked accordingly.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1 migration result, AC-2 watcher
  resolution, AC-3 description), context.md.
- Affected services (from report): xstockstrat-indicators, xstockstrat-config.
- Root cause hypothesis: 001/002 seeds namespace-relative keys; CONFIG-9 serves the raw `key` column, so
  `indicators.sandbox.*` getters never match.
- Confirmation evidence (report, confidence high, static; triage re-grep 2026-10-20): bare seeds at
  `001_config_tables.up.sql:62-64` and `002_config_environment.up.sql:61-63`; watcher reads full-dotted at
  `watcher.py:134,138,142-143`; zero `indicators.sandbox` hits in config migrations. Feature 228 context.md
  independently observed staging config showing bare `sandbox.*` keys at 128 MiB.
- Additional triage finding: migration 029 (feature 189) healed bare keys only for
  `platform/trading/portfolio/marketdata` (`029_heal_config_keys_full_dotted.up.sql:28`); its guarded
  `UPDATE … SET key = namespace || '.' || key` is the reuse candidate. Latest config migration is 030, so next is
  031 at triage time; recon must re-check for collisions with in-flight features.
- Design fork (must be decided, not defaulted): healing activates the 002 production seeds, a live production
  change (timeout 5000 → 3000 ms; memory 128 MiB → 64 MiB headroom). Feature 228's operator decision
  (2026-10-15) chose a 128 MiB default headroom over 64 MiB, so the production `memory_bytes` value needs an
  explicit operator call. AC-2 uses a fixture value (100663296) to test key resolution independent of that choice.
- Overlaps:
  - 235-fix-python-config-zero-trap also touches `services/xstockstrat-indicators/app/config/watcher.py`
    (`get_int` zero-trap); soft ordering, whichever lands second reconciles.
  - hotfix `fix-sandbox-overrides-unclamped` (PR #1263, `origin/hotfix/fix-sandbox-overrides-unclamped`) clamps
    `ExecuteFormula` overrides to the configured limits, so once production rows resolve the clamp ceiling tightens
    with them.
  - 228-fix-indicators-sandbox-matrix (launched) deferred "production seed correction, config migration 031" as a
    design decision (`228/recon.md:120,148`).
- Recommended design depth: full → `/sdd-design fix-sandbox-seed-keys` (rationale: SEV-2; DB (config) migration;
  2 affected services; production limit change needs a decided value).
- Development branch: feature/fix-sandbox-seed-keys
