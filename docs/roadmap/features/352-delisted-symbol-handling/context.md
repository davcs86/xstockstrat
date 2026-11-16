# Context: delisted-symbol-handling

**Feature**: `docs/roadmap/features/352-delisted-symbol-handling/feature.md`
**Product Spec**: `docs/roadmap/features/352-delisted-symbol-handling/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/352-delisted-symbol-handling/implementation-spec.md`

---

## Session 2026-11-16 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator's request, verbatim: "file a new feature on stop failing for symbols after they are delisted".
- Source of the observations: the 2026-11-16 fundamentals backfill after feature 348; record in
  `docs/roadmap/features/348-fix-edgar-historical-fundamentals/context.md` (sections "DO staging — the 8
  failed symbols, diagnosed" and "Watchlist clean-up after the DO failures").
- Number 352 reserved by `scripts/sdd-allocate-feature-number.py`.

### Operator decisions (asked and answered in this session)

- **D-1 Scope**: both the backfill outcome and the post-add watchlist lifecycle.
- **D-2 Disposition**: remove from system-managed "Signals" watchlists; keep and mark on user-created
  watchlists. Stored bars and fundamentals are kept (the operator did not object to that premise).
- **D-3 Job status**: per-symbol outcome and reason; a delisted symbol is `skipped`, not `failed`.
- **D-4 SHPH kind of case**: same state as a real delisting, after a configurable confirmation window;
  clears when the symbol reappears.
- **D-5 Explicit backfill of a flagged symbol**: attempted; `skipped` only when the source cannot serve
  it and the symbol is flagged.
- **D-6 Rename / reuse**: out of scope; follow-up `ticker-rename-and-reuse` to be filed.
- **D-7 Surfaces**: agent watchlist and backfill tools, `/insights` watchlists page, alert on
  transition. The standalone servability-check tool was offered and not selected.

### Assumptions made in this session (not decided by the operator)

- A flagged symbol on a user-created watchlist is "marked" *and* no longer requested by
  watchlist-driven work (FR-5). Basis: D-1 includes "stops being kept warm and re-requested".
- Held positions keep being valued (FR-6). Basis: MARKETDATA-16 / R11, an existing guarantee.
- `skipped` applies to every backfill data kind, not only fundamentals (FR-7). Basis: D-3 was asked
  about "a backfill job" in general.
- Recovery does not re-add a symbol to "Signals" (FR-2). Basis: "Signals" entries come from
  `ingest_signal`; a new signal re-adds it through the normal path.
- The UI marker reuses the existing `UNSERVABLE_REASON` texts of
  `services/xstockstrat-ui/src/lib/opportunityShared.tsx` (AC-15).
- Story artifacts are filed from `claude/story-delisted-symbol-handling` into `main-dev`;
  `feature/delisted-symbol-handling` is created when design starts.

### Verified in code (`main-dev` at `78ab5ca`)

- Gate at add time only: `refuseUnservable` → `GetSymbolServability` in
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.
- Classification: `services/xstockstrat-marketdata/internal/service/asset_servability.go`.
- Failure path: `BackfillFundamentals` in
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go`; error text from
  `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` (`no CIK for ticker %q`).
- Job status contract: `BackfillJob` in `packages/proto/ingest/v1/ingest.proto` (`failed_symbols`,
  `error`, `BACKFILL_STATUS_PARTIAL`).
- Not verified here: the list of watchlist-driven requesters (FR-5) and how `xstockstrat-ingest`
  derives `PARTIAL` from marketdata's response — left to `/sdd-design` recon.

## Session 2026-11-16 — sdd-story (operator follow-up on the open questions)

- **D-8** Confirmation-window default: 5 days. The unit (calendar or trading days) was not stated;
  the scenarios read it as calendar days and the unit stays an open question.
- **D-9** Delisted state is platform-wide, per symbol, in a new symbol/company profile record. Operator:
  "create something like a symbol/company profile. It will be useful for additional metadata." This
  feature stores only the delisted state in it; other metadata is out of scope (my reading, to keep
  the feature minimal). Added FR-13 and AC-19.
- **D-10** Alerts: one per symbol. Added AC-18.
- **D-11** **C-16 sign-off**: the operator signed off changing feature 282's "only the first
  asset-set load prunes the warm set" guarantee (FR-5).
- The operator answered four of the five open items. "Record of the automatic removal" (ledger event
  or not) was not answered and stays open. Mapping of the answer "Per symbol" to the alert-volume
  question is my reading.
