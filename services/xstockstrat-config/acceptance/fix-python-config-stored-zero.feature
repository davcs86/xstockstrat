# Promoted from docs/roadmap/features/244-fix-python-config-stored-zero/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-244` tag.
# Durable business rules xstockstrat-config guarantees for explicit-zero config values.

Feature: xstockstrat-config - explicit zero values on the write edge and the wire
  What xstockstrat-config guarantees for zero-valued rows: bounds still apply, the WatchConfig wire preserves a zero member, and the corrective migration is description-only.

  @AC-8 @FR-6 @regression @feature-244
  Scenario: SetConfig still rejects 0 for a minValue-1 key read by a Python service
    Given an ADMIN caller
    And "analysis.opportunity.max_concurrent_bars_fetches" exists as an int config row (seeded by 028:87,90)
    When SetConfig writes "analysis.opportunity.max_concurrent_bars_fetches" = 0
    Then it fails with INVALID_ARGUMENT naming the bounds [1, 5]

  @AC-10 @FR-1 @regression @feature-244
  Scenario Outline: An explicit zero survives the WatchConfig wire
    Given config rows hold "<key>" as the <type> value <stored>
    When a WatchConfig <update> payload is serialized and deserialized through ConfigServiceService
    Then the decoded ConfigValue for "<key>" holds its <type> member set to <stored>

    Examples:
      | key                       | type   | stored | update   |
      | analysis.test.zero_int    | int    | 0      | SNAPSHOT |
      | analysis.test.zero_float  | float  | 0.0    | SNAPSHOT |
      | analysis.test.zero_string | string | ""     | SNAPSHOT |
      | analysis.test.zero_int    | int    | 0      | DELTA    |

  @AC-11 @FR-6 @regression @feature-244
  Scenario: The corrective description migration changes descriptions only and reverses cleanly
    Given the 027 and 028 seeded rows whose descriptions name the zero-trap
    When the description-only migration is applied
    Then only the description column of those rows changes, matched on their exact old text
    And no value_data, value_type or key changes and no row is inserted or deleted
    And the down migration restores each old description text exactly
