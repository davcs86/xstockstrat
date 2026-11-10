# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
# 2026-11-10 (feature 306, operator-signed C-16, davcs86): 294 @AC-54 is a CHANGE: the request key is `trading_state` (a prefixed key is INVALID_ARGUMENT before authz, so the PERMISSION_DENIED denial path is reachable only with the relative key); the denial test now sends it.
Feature: signal-map-instrumentation (config)

  @AC-25 @FR-8 @feature-294
  Scenario: A denied secret read is logged with the caller and a reason, never a value
    Given caller "marketdata" calls GetSecret for namespace "marketdata", key "fmp.api_key", without the "xstockstrat-marketdata" mTLS peer SAN
    When the request is denied
    Then a warn log carries callerId "marketdata", reason "peer_san_mismatch" and hadPeerSan false
    And caller "ingest" asking for that namespace and key is denied with reason "key_not_granted"
    And no log line contains a secret value

  @AC-26 @FR-8 @feature-294
  Scenario: A successful secret read leaves an audit line without the value
    Given caller "marketdata" presenting the "xstockstrat-marketdata" mTLS peer SAN reads existing secret namespace "marketdata", key "fmp.api_key"
    When GetSecret succeeds
    Then exactly 1 INFO "GetSecret served" line carries callerId "marketdata", namespace "marketdata", the key name and found true
    And no log line contains the decrypted value

  @AC-48 @FR-8 @feature-294
  Scenario: Config listener health and WatchConfig termination are exposed
    Given the config LISTEN connection drops and reconnects, and a WatchConfig subscriber call errors
    When both events happen
    Then "config.listener_up" is 0 while disconnected and 1 after reconnect
    And "config.listener_reconnects" increases by 1
    And "config.last_reload_timestamp" reports the time of the last namespace reload
    And "config.watch.terminated" with reason "client_error" increases by 1
    And the previously silent error handler writes a WARN "WatchConfig subscriber error" line with the error message and no config value

  @AC-54 @FR-8 @feature-294
  Scenario: Config denial of a global SetConfig write is attributed
    Given caller "trading-reconciliation-poller", with no admin access scope, writes "platform.trading_state" in namespace "platform" to "ACTIVE", which its grant forbids
    When SetConfig is denied
    Then the log carries internalCaller "trading-reconciliation-poller" at level error
    And the response is still PERMISSION_DENIED
    And no config value other than the target state name is logged
