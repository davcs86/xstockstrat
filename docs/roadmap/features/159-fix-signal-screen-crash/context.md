# Context Log: fix-signal-screen-crash

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-26 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md`
  (GitHub Issues disabled on this repo → `--from-report` path).
- Discovered during the feature-154 fundamentals-producer first-cycle check-in on staging: the
  producer ran and registered its `fundamentals` (`derived`) source, but consuming the signals via
  `screen_symbols(signal_sources=["fundamentals"], signal_weight>0)` crashed server-side with
  `AttributeError: timestamp`. Verified reproducible (4×) and bracketed against a healthy technical-only
  baseline.
- Severity: SEV-2. Environment: dev (main-dev). Config-only: no. Impact type: signal-screen-crash.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md.
- Affected services: xstockstrat-analysis (single).
- Root cause (high confidence): `app/services/scoring.py:17` reads `bar.timestamp.ToDatetime()`, but
  the marketdata `Bar` proto field is `time` (`packages/proto/marketdata/v1/marketdata.proto` →
  `Timestamp time = 2`). Reached from `app/services/screener.py` only when `signal_sources` set and
  `signal_weight > 0` (gate at `screener.py:329`), which is why technical-only screens work. Fix:
  `bar.timestamp` → `bar.time` + regression test; grep for other `bar.timestamp` readers.
- Confirmed the buggy line still present on `main-dev` at triage time (`scoring.py:17`).
- Recommended design depth: **quick** → `/sdd-design fix-signal-screen-crash quick` (rationale: SEV-2
  per C-0; single service, no proto/migration/config and a crystal-clear one-line root cause, so `skip`
  straight to `/sdd-spec` is a defensible alternative if the operator prefers).
- Development branch: feature/fix-signal-screen-crash.
- NNN note: assigned **159** as max(existing NNN)+1 (158 was the highest on disk), per the root
  CLAUDE.md Feature Numbering rule — not the count-based snippet in the triage skill (which under-counts
  when gaps exist).
