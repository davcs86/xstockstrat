Feature: proto-deprecated-field-removal-program (tech-debt / contract-hygiene)
  Acceptance for the APPROVED approach — response-edge omission (design.md): keep every
  [deprecated=true] field in the proto (PROTO-2 intact, no removal, no reserved, no buf-breaking/BSR
  change) and stop POPULATING genuinely-dead fields in responses, never omitting a field any consumer
  still reads. Scenarios trace to the product-spec FR-1..FR-6.
  (docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md, Defect 2.)

  # --- Out-of-scope record (append-only per C-15): @AC-1 and @AC-4 describe the REMOVAL + reserved
  # approach the design REJECTED (violates PROTO-2, BSR-breaking). Retained for provenance, not active
  # requirements; they map to no FR under the approved omission approach. ---

  @AC-1 @out-of-scope @rejected-removal
  Scenario: a removed field's number is reserved
    Given a deprecated proto field verified to have no reader
    When it is removed from the .proto
    Then its field number is added to a reserved statement
    And buf breaking is satisfied via the documented v-migration workflow

  @AC-4 @out-of-scope @rejected-removal
  Scenario: a removed enum value's number is reserved
    Given a deprecated enum value cleared by the data audit for removal
    When it is removed from the enum
    Then its numeric value is added to a reserved statement (never silently reused by a later value)

  # --- Active scenarios (approved omission approach) ---

  @AC-2 @FR-1 @regression
  Scenario: a field with a live reader is never removed or omitted
    Given portfolio.proto Watchlist.symbols has a live reader (portfolio_service.go:1691 and the analysis live_loop legacy-row fallback)
    When the omission plan is applied
    Then Watchlist.symbols stays populated in responses (it is a KEEP field)

  @AC-3 @FR-6 @regression
  Scenario: deprecated enum values stay deprecated pending a data audit
    Given a deprecated enum member (TIMEFRAME_*, ENVIRONMENT_DEV, VALUE_TYPE_FLOAT_MAP) with stored/wire values
    When the omission approach is applied
    Then the enum value is neither removed nor unset per-message (out of scope) and remains deprecated

  @AC-5 @FR-4 @regression
  Scenario: proto definitions are unchanged
    Given the approved response-edge-omission approach
    When the feature is implemented
    Then no .proto field or enum value is removed and no reserved statement is added
    And buf breaking reports no change and the BSR module schema is unchanged

  @AC-6 @FR-3 @regression
  Scenario: a GATED field's deprecated string is omitted only after the consumer gate, enum twin kept
    Given the per-field consumer-confirmation gate has cleared for BackfillJob.timeframe (every named consumer reads timeframe_enum; window closed; sign-off recorded)
    When ingest serializes a BackfillJob response
    Then the deprecated string timeframe field is unset
    And the replacement timeframe_enum field is still populated

  @AC-7 @FR-1 @regression
  Scenario: omitting a KEEP field would break its in-repo reader
    Given Bar/Watchlist producers under the omission plan
    When Watchlist.symbols is (correctly) left populated
    Then AddWatchlistSymbols' per-list cap still enforces from existing.Symbols (the reader is unaffected)

  @AC-8 @FR-2 @regression
  Scenario: an edge that also feeds persistence is never an omission edge
    Given the Bar produced at alpaca/client.go:142 flows into InsertBars which writes the ohlcv.timeframe column
    When the omission plan is applied
    Then Bar.timeframe is NOT omitted at that edge (only the pure DB->proto read edge scanBars, and the stream edge, are omittable)
    And a 400-day GetBars / BatchGetBars daily-bar query still returns rows

  @AC-9 @FR-5 @regression
  Scenario: request-only dead fields require no change
    Given a dead request-body field (user_id x10, is_paper, or the deprecated operation string)
    When a service handles the request
    Then identity/behavior is resolved as today (header-authoritative) and no response ever carried the field, so nothing is omitted
