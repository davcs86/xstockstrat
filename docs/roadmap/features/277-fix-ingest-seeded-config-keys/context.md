# Context Log: fix-ingest-seeded-config-keys

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` (Issues disabled)
- Severity: SEV-3, environment dev (staging) → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-ingest, xstockstrat-config
- Root cause hypothesis: mixed seed key convention; ingest seeds are namespace-stripped, readers use the dotted form
- Recommended design depth: full → `/sdd-design fix-ingest-seeded-config-keys` (rationale: two services, a config key change or migration, and an open platform-wide sweep)
- Development branch: feature/fix-ingest-seeded-config-keys
- The runtime effect (reads miss the snapshot) is inferred from code and the live key registry, not observed; the design must confirm it with a live `set_config` check on staging before choosing the fix shape.
- Open questions for design: re-key seeds vs change readers; handling of operator-edited rows on re-key; whether other namespaces' older bare seeds are also inert; INGEST-9 wording; whether the unseeded `max_concurrent_jobs` and `retry_on_failure` keys should be seeded.

## Session 2026-10-22 (live check, staging)

- Ran `get_config(namespace="ingest")` on staging (read-only; no `set_config` was issued). The served snapshot's `values` are keyed by the bare
  seeded names (`mcp_client.request_timeout_seconds`, `mcp_client.poll_interval_seconds`, `backfill.chunk_max_bars`,
  `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`) with no `ingest.`-prefixed entries, and requesting the prefixed key returns the
  same snapshot. This confirms the snapshot shape that makes ingest's `values.get("ingest.…")` miss.
- Not observed: the behavioural effect (an edited value being ignored). No ingest log or metric exposes the effective timeout or poll interval,
  and a `set_config` write on staging would not be observable without adding one. The design should prove the effect with a unit test against a
  snapshot built from the seeds (AC-2) rather than a staging write.
