# xstockstrat-ui — Opportunities-first shell: skip and unreadable rows

Moved from `CLAUDE.md` § Opportunities-first shell → Decide screens.

- **Fundamentals skip row (feature 215).** A row with `fundamentalsUnavailable` is non-actionable:
  - It renders the exhaustive `FUNDAMENTALS_GAP` badge ("Fundamentals unavailable", or
    "Fundamentals unavailable (ETF)") in place of the action badge, with no act buttons.
  - The badge test ids are `fundamentals-unavailable-<sym>` (desktop queue),
    `mobile-fundamentals-unavailable-<sym>` (mobile queue) and `detail-fundamentals-unavailable`
    (Signal-detail).
  - `SignalReadiness` adds a `readiness-fundamentals-unavailable` notice.
- **Formula-unreadable row (289).** `formulaUnreadable` on `Opportunity` and `SymbolReadiness`
  means a strategy formula is not readable by the owner. It renders the `READINESS_CUE.unreadable`
  cue ("formula not readable"), never a 0/0 or "no data" verdict.
  - A non-held row shows the cue in place of the action badge, with no act buttons. A held row
    shows its action badge plus the cue.
  - The test ids are `opportunity-formula-unreadable-<sym>` (desktop queue),
    `opportunity-formula-unreadable-mobile-<sym>` (mobile queue), `detail-formula-unreadable`
    (Signal-detail header), `readiness-formula-unreadable` (the `SignalReadiness` notice, keyed off
    the `EvaluateReadiness` result) and `readiness-cue-unreadable` (watchlist readiness panel).
  - `readinessState` takes a **required** `formulaUnreadable` (as does `SignalItem`), so `tsc`
    flags every call site; `rollupReadiness` counts it in its own `unreadable` bucket.
