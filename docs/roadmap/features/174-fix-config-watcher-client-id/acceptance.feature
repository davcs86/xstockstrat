Feature: fix-config-watcher-client-id (bug fix)
  Regression guard for comment-audit report item 4: the analysis and ingest config watchers must
  identify to xstockstrat-config with their own service name, not the copy-pasted "indicators-" prefix.

  @AC-1 @FR-1 @regression
  Scenario: The analysis watcher identifies as an analysis subscriber
    Given xstockstrat-analysis constructs its WatchConfig request
    When the request's client_id is inspected
    Then it is prefixed with "analysis-" (not "indicators-")

  @AC-2 @FR-1 @regression
  Scenario: The ingest watcher identifies as an ingest subscriber
    Given xstockstrat-ingest constructs its WatchConfig request
    When the request's client_id is inspected
    Then it is prefixed with "ingest-" (not "indicators-")
