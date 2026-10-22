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

## Session 2026-10-22 (re-verification on main-dev)

- Purpose: bring the 230 triage artifacts onto `main-dev` (copied unchanged from `origin/feature/fix-etf-flag-fill`
  `459fb5c2`) and re-verify the defect, triaged at `a8a3cfd`, against `main-dev` `6923e95a` (86 commits later). The
  report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md` and its `triaged` sidecar are already on
  main-dev and were left untouched. Status stays `draft`.
- **Still reproduces by reading** (`services/xstockstrat-marketdata`). None of the three suspect sites changed:
  - Fill gate: `internal/service/etf_flags.go:140-146` `etfFillAllowed` — `fmp.enabled`, budget wired, `cap > 0`,
    `!atQuotaAlertThreshold(used, cap)` (`marketdata_service.go:1959`, `count >= cap*8/10`). No drift in
    `etf_flags.go` since `a8a3cfd`.
  - Boot seed: `cmd/server/main.go:129-130` `fmpClient.SeedBudget(repo.CountFundamentalsFetchedToday(ctx))` — no drift.
    `CountFundamentalsFetchedToday` is still an unfiltered `count(*)` over today's `marketdata.fundamentals`
    (`internal/repository/marketdata_repo.go:656-664`; was `:565`, drift +91 from unrelated repo edits). Non-FMP rows
    still land in that table: the EDGAR fallback WARN `edgar snapshot not producible — falling back to vendor`
    (`marketdata_service.go:1864`, was `:1627`) feeds `resolveFundamentals`, and `UpsertFundamentals` call sites are
    at `:1707`, `:1762`, `:1879` (was `:1634` for the edgar snapshot write).
  - Fetch-error visibility: `etf_flags.go:126` still `slog.DebugContext(ctx, "etf flag fill failed", …)`; the gate-closed
    path (`:121-123`) returns with no log at all. The process logger is `slog.NewJSONHandler(os.Stdout, nil)`
    (`cmd/server/main.go:35`), i.e. Info level, so both causes stay invisible.
  - Wiring unchanged: `SetClassification(..., fmpClient)` sets `s.fmpBudget` (`main.go:152`,
    `classification_service.go:55`), `SetEtfFlagSource` `:153`, `StartEtfFlagFiller` `:162`.
  - Root cause is still unconfirmed from logs (no staging log access in this session); the code-level hypotheses
    in the 2026-10-15 entry all still hold.
- **Overlaps with in-flight features:**
  - `255-fix-marketdata-fundamentals-cache` (implementation-ready) — **subsumes 230's primary fix (@AC-1).** Its D-51 /
    FR-2 / `@AC-3` make `CountFundamentalsFetchedToday` source-filtered (`WHERE source = $1 AND (fetched_at >= $d OR
    as_of >= $d)`, `$1 = fmp.SourceName`) and extract the `main.go:129-130` seed into `SeedFMPBudget`. 255 does not
    mention 230 and does not touch `etf_flags.go` logging. Recommendation for /sdd-design: rescope 230 to land after 255,
    keep only @AC-2 (label on a later call) and @AC-3 (Info-level, rate-limited skip/fail visibility), and either drop
    230 @AC-1 or cite 255 `@AC-3` as its coverage. Note 255's design also warns that its D-53b re-fetch amplification
    can reach the FMP cap earlier and "starve the 215 ETF filler" — that strengthens the case for 230's @AC-3 logging.
  - `215-block-fundamentals-strategy-on-etf` (in-progress) — owns `etf_flags.go` (Step 9) and its tests
    (`etf_flags_test.go`, `@AC-14` gate cases incl. 80/100 skip, 0/0, fetch error not cached). 230 must preserve
    `@AC-14@feature-215` (C-16) and land after 215; merge-order already has 255 after 215.
  - `254-fix-marketdata-secret-exposure` (implementation-ready) — edits `fmp_client.go` error wrapping
    (`FetchIsEtf` `:375` on its list, transport `*url.Error` carries `apikey=`). If 230 logs the `FetchIsEtf` error at
    Info/Warn, it must not log the raw error string before 254 lands (or must log a class only, as 255 §5.3′ does).
    Soft rebase overlap; record a merge-order row at /sdd-spec.
  - `253-fix-edgar-companyfacts-decode` (launched) — reduces the `zero_history` EDGAR fallback flood (cik-as-string
    decode), which shrinks — but does not remove — the non-FMP row inflation behind the seed over-count. Its
    out-of-scope list leaves rate-limiting that WARN open.
- Recommended design depth unchanged: quick → `/sdd-design fix-etf-flag-fill quick`, with the 255 rescope as the
  first design question.
