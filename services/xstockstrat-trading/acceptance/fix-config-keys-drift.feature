# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rules xstockstrat-trading guarantees for config getters and live broker timeout.

Feature: xstockstrat-trading - config getters and broker timeout
  What xstockstrat-trading guarantees: type-mismatched config falls back to the default with a WARN, and the broker timeout is live.

  @AC-12 @FR-11 @regression @feature-295
  Scenario Outline: A type-mismatched or absent value follows the uniform getter rule
    Given trading "trading.broker.timeout_ms" is <stored>
    When trading reads it with the <getter> getter and default 5000
    Then the result is <result>
    And a WARN naming "trading.broker.timeout_ms" is logged: <warn>

    Examples:
      | stored              | getter | result | warn |
      | int 7000            | float  | 7000.0 | no   |
      | float 7000.5        | int    | 5000   | yes  |
      | string "7000"       | int    | 5000   | yes  |
      | absent from snapshot | int   | 5000   | yes  |

  @AC-17 @FR-7 @regression @feature-295
  Scenario: The broker HTTP timeout changes for existing broker clients without a restart
    Given trading has an Alpaca broker client built with "trading.broker.timeout_ms" = 5000
    When an operator sets it to 8000
    Then the next Alpaca request from that client uses an 8000 ms timeout
