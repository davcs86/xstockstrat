# Promoted from feature 257 (fix-ledger-query-pagination) at launch, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-ledger-query-pagination (bug fix)
  Regression guard: QueryEvents honours pageToken, caps page_size, and StreamEvents replay does not starve AppendEvent on the single-connection pool.

  # "Exactly once" covers every matching event committed before the walk passes its sequence; a lower sequence
  # committing after the walk passed it is not delivered by that walk (operator sign-off 2026-10-22, change (a)).
  @AC-1 @FR-1 @FR-2 @regression @feature-257
  Scenario: Following next_page_token returns each event exactly once
    Given the ledger holds 3 events of type "t" appended in order "e1", "e2", "e3"
    When QueryEvents is called with event_type "t" and page_size 2
    Then it returns "e1", "e2" and a non-empty next_page_token
    When QueryEvents is called again with event_type "t", page_size 2 and that next_page_token
    Then it returns only "e3" and an empty next_page_token

  @AC-2 @FR-3 @regression @feature-257
  Scenario: An oversized page_size is capped at 1000
    Given the ledger holds 20000 events of type "t"
    When QueryEvents is called with event_type "t" and page_size 1000000
    Then it returns exactly 1000 events and a non-empty next_page_token

  @AC-7 @FR-4 @regression @feature-257
  Scenario: Callers that omit page_token still get the oldest first page
    Given the ledger holds 150 events of type "t" appended in order "e1" to "e150"
    When QueryEvents is called with event_type "t", no page_size and no page_token
    Then it returns "e1" to "e100" in ascending sequence order and a non-empty next_page_token
    When QueryEvents is called with event_type "t", page_size 500 and no page_token
    Then it returns "e1" to "e150" in ascending sequence order and an empty next_page_token

  # The 2-second bound is the pass threshold. On the buggy code the append waits for the whole replay.
  @AC-5 @FR-7 @regression @feature-257
  Scenario: StreamEvents replay does not starve AppendEvent
    Given the ledger holds 200000 events and its query pool has 1 connection
    And a StreamEvents call is replaying from sequence 0
    When AppendEvent is called while the replay is still in progress
    Then AppendEvent commits within 2 seconds
    And the replay still delivers, in ascending sequence order and exactly once, every event committed before the replay passed its sequence
