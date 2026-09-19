# Product Spec: proto-deprecated-field-removal-program

**Type**: tech-debt / contract-hygiene · **Severity**: SEV-3 · **Config-only**: no
**Status**: design-approved (approach: **response-edge omission** — see `design.md`)

> **Framing update (post-`/sdd-design`).** This feature began as a proto-field *removal* program. The
> design debate (`design.md`, 3 rounds) rejected in-place removal: it violates the proto module's
> **PROTO-2** invariant (deprecate-don't-delete, no `reserved`), has no documented in-place procedure
> (only v1→v2), and the module is **BSR-published** with external consumers. The approved approach is
> **response-edge omission** — keep every `[deprecated = true]` field in the `.proto` (PROTO-2 intact,
> no `buf breaking`, no v1→v2, no BSR schema break) and stop *populating* genuinely-dead fields in
> responses (the feature-194 read-edge pattern). This spec is reconciled to that approach; the removal
> framing survives only in `@AC-1`/`@AC-4`, explicitly annotated out-of-scope as the record of the
> rejected path.

## Source

`docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` **Defect 2** — the per-proto
inventory of the 33 `[deprecated = true]` fields (the candidate set). The recon reader audit
(`recon.md`) and the debated approach (`design.md`) are the authoritative refinements of it.

## Objective

Stop emitting genuinely-dead `[deprecated = true]` fields in service **responses** (response-edge
omission), keeping the proto definitions intact, so consumers are nudged off dead fields **without a
breaking schema change** — and **never** omitting a field any consumer still reads. The engineering
deliverable is the grounded reader audit (`recon.md`) + the per-field omission plan (`design.md`); the
omissions themselves ship per-field only after an external-consumer-confirmation gate (FR-3).

## Consumer Surface(s)

**None — internal/platform-only** (a wire-contract change with no trader/analyst/operator-visible
consequence, C-14). The real external exposure is **BSR consumers** of the published module (see Open
Questions and the FR-3 per-field gate), which C-14 does not model — handled as a gate, not a surface.

## Affected Services

Registry service names (the Inventory table below is keyed by **proto module**, not service):

- **xstockstrat-marketdata** (Go) — `Bar.timeframe` response edges (GATED).
- **xstockstrat-ingest** (Python) — `BackfillJob.timeframe` response edge (GATED).
- **xstockstrat-portfolio** (Go) — `Watchlist.symbols` (**KEEP** — verified live reader).
- **No-op (already server-ignored request-only fields):** xstockstrat-trading, xstockstrat-portfolio,
  xstockstrat-analysis, xstockstrat-indicators.
- `common` / `config` are **proto modules**, not services; their deprecated enum values are out of scope.

## Functional Requirements

- **FR-1 — KEEP load-bearing fields.** A deprecated field with any live reader (in-repo or external)
  is never omitted. Canonical: `portfolio.proto Watchlist.symbols` (readers:
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1691`;
  `services/xstockstrat-analysis/app/engine/live_loop.py:525`).
- **FR-2 — Omit only at pure response edges.** A field is omitted only at a serialization edge whose
  value feeds no persistence or other consumer. A `Bar` produced at `alpaca/client.go:142` also feeds
  `InsertBars` → the `marketdata.ohlcv.timeframe` column, so it is **not** an omission edge (omitting
  corrupts the store; breaks `@AC-2`/`@AC-3`/GetBars).
- **FR-3 — GATED omission with enum co-emission + consumer gate.** A GATED field's deprecated string is
  omitted only after its per-field consumer-confirmation gate clears — every named consumer reads the
  replacement `timeframe_enum`; the deprecation window is formally closed to BSR consumers; sign-off in
  `context.md` — and the replacement `timeframe_enum` stays co-emitted at the same edge.
- **FR-4 — Proto definitions unchanged.** No field or enum-value removal, no `reserved`, no
  `buf breaking` / v1→v2 / BSR schema change; PROTO-2 preserved.
- **FR-5 — Request-only dead fields need no change.** The 10 dead body `user_id` (trading ×4,
  portfolio ×5, analysis ×1), `is_paper`, and the deprecated `operation` string are request-only and
  already server-ignored (header-authoritative identity); they never appear in a response.
- **FR-6 — Enum values out of scope.** Deprecated enum members (`TIMEFRAME_*`, `ENVIRONMENT_DEV`,
  `VALUE_TYPE_FLOAT_MAP`) cannot be per-message unset and remain deprecated; retirement is deferred
  pending a data audit.

## Inventory (candidate set — keyed by proto module, NOT verified-dead)

| Proto module | Count | Fields |
|---|---|---|
| analysis | 1 | `ListStrategiesRequest.user_id` |
| common | 5 | `ENVIRONMENT_DEV`; `TIMEFRAME_1MIN`/`_5MIN`/`_15MIN`/`_1HOUR` |
| config | 7 | `trading_mode` ×6; `VALUE_TYPE_FLOAT_MAP` |
| indicators | 2 | `user_id` ×2 |
| ingest | 3 | `timeframe` ×2; `operation` (string) |
| marketdata | 4 | `timeframe` ×4 |
| portfolio | 6 | `user_id` ×5; `symbols` (**live reader — KEEP**) |
| trading | 5 | `user_id` ×4; `is_paper` |

## Per-field plan (from design.md — grounded)

- **KEEP** — `Watchlist.symbols` (live reader + feature-097 old-client mirror). [FR-1]
- **EXCLUDE (not a response edge)** — `Bar.timeframe` @ `barFromAlpaca` (`alpaca/client.go:142`, feeds
  the DB write). [FR-2]
- **GATED (omit after the gate)** — `Bar.timeframe` @ `scanBars` (`marketdata_repo.go:144`) and
  `stream.go:247`; `BackfillJob.timeframe` @ `job_row_to_proto` (`ingest servicer.py:149`);
  `timeframe_enum` co-emitted at each. [FR-3]
- **NO-OP (request-only, already ignored)** — the 10 dead `user_id`, `is_paper`, `operation` string,
  request-side `timeframe` strings. [FR-5]
- **OUT OF SCOPE** — deprecated enum values. [FR-6]

## Out of Scope

- **In-place removal + `reserved` numbering** — rejected by `design.md` (violates PROTO-2, no
  procedure, BSR-breaking). `@AC-1`/`@AC-4` retain the removal wording only as the out-of-scope record.
- `Watchlist.symbols` omission — KEEP (live reader). [FR-1]
- Deprecated enum-value retirement — deferred (data audit). [FR-6]
- Any field a per-field reader/consumer audit finds still consumed. [FR-1/FR-3]

## Open Questions

- [ ] **BSR / external-consumer exposure** — the module is `buf push`-published (external consumers
  presumed to exist until proven otherwise). Carried into the **FR-3 per-field consumer-confirmation
  gate**, which is the true blocker on any omission shipping. Not resolvable by fiat.

## Governance gates

- **No proto change → no breaking-change approval.** The "2 owners + platform lead per breaking proto
  change" gate applied only to the rejected removal approach; response-edge omission makes no `.proto`
  edit, so it does not apply.
- **Per-field consumer-confirmation gate (FR-3)** blocks each GATED omission until external/BSR + every
  named in-repo consumer is confirmed reading the `timeframe_enum` replacement (`design.md`).

## Trading-domain note

`trading_mode` ×6 and `is_paper` are dead-field cleanup only — **no paper-vs-live execution-behavior
change** (feature 147 derives mode from environment; the fields are request-only and server-ignored).

## Acceptance

See `acceptance.feature` (`@AC-*`, C-15). Every `FR-N` above is covered by ≥1 scenario; `@AC-1`/`@AC-4`
are retained (append-only) but annotated out-of-scope as the rejected-removal record.
