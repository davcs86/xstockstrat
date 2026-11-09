# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-trading - namespace-relative config reads
  What xstockstrat-trading guarantees: the order gate reads the platform key relative to its own watcher, with no alias.

  @AC-1 @FR-1 @FR-6 @feature-304
  Scenario: Trading gates an order on the platform key read through its platform watcher with the alias off
    # Bound test: TestPlaceOrder_GatesOnPlatformWatcher_AliasOff (trading_state_gate_test.go). Harness: TradingService{
    #   cfgW: MustSnapshotWatcher("trading", {"trading_state": ACTIVE}),
    #   platformCfgW: MustSnapshotWatcher("platform", {"trading_state": REDUCE_ONLY}),
    #   brokers: {"acct-1": {userID: "u1", brokerType: ALPACA}}, portfolio: GetPosition -> NotFound },
    # request with ClientOrderId and TradingMode PAPER, context user "u1". Without those, PlaceOrder returns
    # InvalidArgument/NotFound/PermissionDenied before the gate and the test is vacuous.
    Given namespace "platform" stores key "trading_state" = "REDUCE_ONLY"
    And namespace "trading" stores key "trading_state" = "ACTIVE"
    And the marker row "relative_keys_v1" is absent
    And trading reads namespace "trading" through its trading watcher and namespace "platform" through a separate platform watcher
    When a user places an exposure-increasing BUY order for "AAPL" on their own account, which holds no AAPL position
    Then the order is rejected with FailedPrecondition "trading reduce-only: no existing position in AAPL; order would increase exposure"
    And it is not rejected as "trading halted: platform.trading_state=HALTED" (the code default) and not accepted (the "trading" namespace's ACTIVE)
