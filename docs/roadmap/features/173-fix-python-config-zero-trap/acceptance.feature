Feature: fix-python-config-zero-trap (bug fix)
  Regression guard for comment-audit report item 3 (CF-N10): a config value deliberately stored as 0
  must not silently revert to the coded default in the indicators and ingest config watchers.

  @AC-1 @regression
  Scenario Outline: A stored zero for a 0-meaningful key round-trips as zero
    Given the <service> config watcher has a snapshot where "<key>" is present with an int/float value of 0
    When the service reads "<key>" through its 0-meaningful (present-aware) accessor
    Then the value returned is 0
    And it is NOT replaced by the accessor's coded default

    Examples:
      | service    | key                                |
      | indicators | (a 0-meaningful indicators int key)|
      | ingest     | (a 0-meaningful ingest int key)    |

  @AC-2 @regression
  Scenario: An unset key still falls back to its coded default
    Given the config watcher has a snapshot where the key is absent (no oneof field set)
    When the service reads the key through the present-aware accessor
    Then the coded default is returned
