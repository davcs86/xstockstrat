# Promoted from docs/roadmap/features/174-fix-config-watcher-client-id/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-174` tag.
# Durable business rule: xstockstrat-ingest identifies to xstockstrat-config with its own service name
# on its WatchConfig subscription, not the copy-pasted "indicators-" prefix.

Feature: xstockstrat-ingest — config subscriber identity
  What xstockstrat-ingest guarantees about the identity it presents to xstockstrat-config on its
  WatchConfig stream.

  @AC-2 @FR-1 @regression @feature-174
  Scenario: The ingest watcher identifies as an ingest subscriber
    Given xstockstrat-ingest constructs its WatchConfig request
    When the request's client_id is inspected
    Then it is prefixed with "ingest-" (not "indicators-")
