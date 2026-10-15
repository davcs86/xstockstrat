# Context Log: fix-etf-flag-fill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-15 (/sdd-triage)

- **Origin:** defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`, from feature 215 Step 26(a) staging verification. The report and
  its sidecar live on `docs/215-staging-verification` (PR #1249).
- **Classification:** SEV-3, dev environment, not config-only. Routed to the SDD path (Track C).
- **Created:** status.md, feature.md, product-spec.md, acceptance.feature (@AC-1..3), context.md.
- **Affected services:** xstockstrat-marketdata.
- **Root cause hypothesis:** the boot-seed over-count closes the 80% fill gate. This is unconfirmed:
  log access was blocked in the triage session.
  - The alternatives are a Debug-only fetch error or an empty-profile negative cache.
  - The staging log tail at 19:00–19:22Z shows a steady stream of
    `edgar snapshot not producible — falling back to vendor`, which feeds the seed.
- **Operator decision (2026-10-15):** "Yes". Triage now, with the fix shape being an FMP-only seed
  count plus Info-level visibility for a skipped or failed fill.
- **Recommended design depth:** quick → `/sdd-design fix-etf-flag-fill quick`. Rationale: SEV-3,
  single service and no proto, migration or config change, but the root cause is unconfirmed.
  - **Recon must first confirm the cause:** from the marketdata run logs, or from a per-`source` count
    of today's `marketdata.fundamentals` rows.
  - **Open design question:** which `source` values cost an FMP call. `fmp` does; `edgar+fmp` is
    the PIT history in `fundamentals_history`, so it is not counted. Check whether Finnhub-provider
    rows ever spend FMP calls.
- **Development branch:** `feature/fix-etf-flag-fill`.
