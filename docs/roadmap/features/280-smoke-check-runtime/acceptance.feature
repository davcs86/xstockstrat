Feature: smoke-check-runtime
  As a platform engineer, I want a staging-only service that runs registered checks against the deployed
  environment and records every attempt against the deployed commit, so that failures are tracked and the
  next feature part can correct them.

  @AC-1 @FR-1
  Scenario: The catalog lists each check with its hash and the deployed SHA
    Given an image built from commit "a1b2c3d" containing the check "example.pass_trivial" for feature "smoke-check-runtime", part "phase-1"
    When a caller sends GET /checks with header x-smoke-key "k-123" (the configured key)
    Then the response is 200 with deployed_sha "a1b2c3d"
    And checks contains id "example.pass_trivial", feature "smoke-check-runtime", part "phase-1" and a check_hash of 64 hex characters

  @AC-2 @FR-1
  Scenario: A check module that fails to import is a load error, not a crash
    Given the checks directory also contains "checks/broken/bad_syntax.py" with a syntax error
    When a caller sends GET /checks with the valid key
    Then the response is 200 and load_errors has an entry with module "checks.broken.bad_syntax" and an error containing "SyntaxError"
    And "example.pass_trivial" is still listed in checks

  @AC-3 @FR-2
  Scenario: A request without the key is rejected and nothing executes
    Given the configured key is "k-123"
    When a caller sends POST /runs for "example.pass_trivial" with no x-smoke-key header
    Then the response is 401
    And no check was executed

  @AC-4 @FR-2
  Scenario: The service refuses to start without the auth key
    Given the config secret smoke.api.key is empty
    When the xstockstrat-smoke process starts
    Then it exits with a non-zero status and a message naming "smoke.api.key"
    And it binds no port

  @AC-5 @FR-3
  Scenario: Outcomes are recorded per check and a hung check does not stop the run
    Given checks "c.pass" (returns), "c.fail" (raises CheckFailure "expected 3 rows, got 2") and "c.hang" (sleeps 5 s, timeout_s 1)
    When a run of ["c.pass","c.fail","c.hang"] completes
    Then the records show outcomes PASS, FAIL and TIMEOUT in that order
    And the FAIL evidence contains "expected 3 rows, got 2"

  @AC-6 @FR-3
  Scenario: A second run while one is in flight is rejected
    Given run "r-1" is executing check "c.hang"
    When a caller sends POST /runs for "c.pass"
    Then the response is 409 and run "r-1" continues unaffected

  @AC-7 @FR-3
  Scenario: Evidence is redacted and size-bounded
    Given a check that records evidence {"api_token": "abc123", "blob": a 10000-character string}
    When it runs
    Then the stored evidence shows api_token as "[redacted]"
    And the serialized evidence is at most 4096 bytes

  @AC-8 @FR-4
  Scenario: DB access is read-only
    Given a check that runs "SELECT count(*) FROM config.config_values" and another that runs "UPDATE config.config_values SET value_data = 'x'"
    When both run
    Then the first returns a count and PASSes
    And the second ends with outcome ERROR carrying SQLSTATE 25006

  @AC-9 @FR-5
  Scenario: A pure-read RPC is allowed and audited
    Given the smoke user id "u-smoke-1" and the annotated read RPC "xstockstrat.ledger.v1.LedgerService/QueryEvents"
    When a check calls it
    Then the call carries x-user-id "u-smoke-1", an x-trace-id equal to the run id, and an x-access-scope without the admin bit 0x04
    And the record's rpcs_invoked equals ["xstockstrat.ledger.v1.LedgerService/QueryEvents"]

  @AC-10 @FR-5
  Scenario: Mutating or unannotated RPCs are refused before a channel opens
    Given phase-1 policy
    When checks call "xstockstrat.ledger.v1.LedgerService/AppendEvent" and "xstockstrat.marketdata.v1.MarketDataService/GetFundamentals"
    Then both end with outcome ERROR naming MutatingRpcRefused
    And no gRPC channel was opened

  @AC-11 @FR-6
  Scenario: A run is recorded as one immutable file on the results branch
    Given run "r-20261030T031500Z-1" in environment "homelab-staging" at 2026-10-30T03:15:00Z
    When the recorder commits the run
    Then branch smoke-results contains "smoke-results/homelab-staging/20261030T031500Z-r-20261030T031500Z-1.json"
    And the file holds check_id, check_hash, env, deployed_sha, outcome, started_at and evidence for every check in the run

  @AC-12 @FR-6
  Scenario: Pending is computed from the catalog and recorded PASSes
    Given catalog checks c1, c2 and c3 whose hashes are 64 "a" characters, 64 "b" characters and 64 "c" characters; recorded for env "do-dev": c1 PASS and c2 FAIL
    When pending is computed for "do-dev"
    Then pending is [c2, c3]

  @AC-13 @FR-6
  Scenario: Concurrent writers each end up committed exactly once
    Given two recorders each hold a different run file committed locally from the same smoke-results base
    When both push to smoke-results
    Then the branch contains both run files exactly once
    And its history is linear

  @AC-14 @FR-7
  Scenario: The homelab post-deploy workflow runs no smoke step for production
    Given deploy-homelab.yml invoked with environment "production"
    When the workflow runs
    Then no smoke step runs

  @AC-15 @FR-7
  Scenario: The DO POST_DEPLOY job records results and exits 0 on a failing check
    Given the do-dev deployment finishes and one check FAILs
    When the POST_DEPLOY job runs
    Then the run file is on branch smoke-results
    And the job exits with status 0

  @AC-16 @FR-7
  Scenario: The agent tool exists only on a staging agent and is admin-gated
    Given a production agent with SMOKE_ENDPOINT unset and a staging agent with SMOKE_ENDPOINT "xstockstrat-smoke:9110"
    When each lists its tools
    Then the production agent still advertises 45 tools and has no smoke_checks
    And the staging agent advertises smoke_checks, and a non-admin caller invoking it gets a PermissionError

  @AC-17 @FR-8
  Scenario: Production renders never contain the smoke service
    Given the production and staging homelab release renders
    When they are rendered and asserted
    Then production has 13 services, none named xstockstrat-smoke, and published ports exactly 3000 and 9000
    And staging has 14 services including xstockstrat-smoke published on 9110
    And .do/app.yaml contains no xstockstrat-smoke component

  @AC-18 @FR-8
  Scenario: The DO dev smoke component has no public listener
    Given .do/app.dev.yaml
    When the xstockstrat-smoke component is read
    Then it declares internal_ports [9110] and no http_port
    And no ingress rule routes to it

  @AC-19 @FR-9
  Scenario: An allowlisted write succeeds only under every guard and is audited
    Given smoke.writes.enabled true, env "do-dev", smoke user "u-smoke-1", and the allowlisted portfolio CreateWatchlist RPC
    When a check creates watchlist "smoke-r1-wl"
    Then the call succeeds with no admin bit in x-access-scope
    And the record's writes_performed lists the CreateWatchlist RPC

  @AC-20 @FR-9
  Scenario: A write is refused while the kill switch is off
    Given smoke.writes.enabled false, env "do-dev" and the allowlisted CreateWatchlist RPC
    When a check calls it
    Then the check ends with outcome ERROR naming MutatingRpcRefused
    And no gRPC channel was opened

  @AC-21 @FR-9
  Scenario: Cleanup runs even when the check times out
    Given a check that creates fixture "smoke-r1-wl", registers its cleanup, then sleeps past timeout_s 1
    When it runs
    Then the outcome is TIMEOUT, "smoke-r1-wl" no longer exists, and cleanup is "OK"

  @AC-22 @FR-9
  Scenario: A failed cleanup surfaces as ERROR without hiding the original failure
    Given a check that raises CheckFailure "row missing" and whose cleanup raises
    When it runs
    Then the outcome is ERROR with cleanup "FAILED"
    And the evidence still contains "row missing"

  @AC-23 @FR-9
  Scenario: Leftover fixtures are gone before the next check body runs
    Given a leftover watchlist "smoke-r0-wl" owned by the smoke user from a crashed run
    When the next run starts a check that declares a janitor for "smoke-" fixtures
    Then the check body finds no watchlist whose name starts with "smoke-r0" when it begins

  @AC-24 @FR-10
  Scenario: A missing smoke user id errors RPC checks but not DB checks
    Given smoke.rpc.user_id is ''
    When a DB-only check and an RPC check run
    Then the DB check PASSes
    And the RPC check ends with outcome ERROR and evidence "smoke.rpc.user_id unset"

  @AC-25 @FR-2
  Scenario: A request with the wrong key is rejected and nothing executes
    Given the configured key is "k-123"
    When a caller sends POST /runs for "example.pass_trivial" with x-smoke-key "wrong"
    Then the response is 401
    And no check was executed

  @AC-26 @FR-7
  Scenario: A red smoke result fails the homelab staging step but does not change the release
    Given deploy-homelab.yml invoked with environment "staging" and one check FAILs
    When the smoke step runs
    Then the step exits 1
    And the deployed release image digests are unchanged

  @AC-27 @FR-9
  Scenario: A write is refused outside a staging environment label
    Given smoke.writes.enabled true, env "production" and the allowlisted CreateWatchlist RPC
    When a check calls it
    Then the check ends with outcome ERROR naming MutatingRpcRefused
    And no gRPC channel was opened

  @AC-28 @FR-9
  Scenario: A privileged RPC is refused even with writes enabled in staging
    Given smoke.writes.enabled true and env "do-dev"
    When a check calls "xstockstrat.config.v1.ConfigService/SetConfig"
    Then the check ends with outcome ERROR naming MutatingRpcRefused
    And no gRPC channel was opened

  @AC-29 @FR-4
  Scenario: A slow query is cancelled by the statement timeout
    Given a check running "SELECT pg_sleep(10)" with a statement timeout of 2000 ms
    When it runs
    Then the outcome is ERROR carrying SQLSTATE 57014
    And the check took less than 5 seconds

  @AC-30 @FR-6
  Scenario: A failed attempt is retained after a later pass
    Given check c2 has a FAIL recorded at 2026-10-30T03:15:00Z and a PASS recorded at 2026-10-30T04:15:00Z for the same hash in env "do-dev"
    When the run files for "do-dev" are read
    Then both records are present
    And pending no longer includes c2

  @AC-32 @FR-6
  Scenario: An edited check is pending again
    Given check c1 has a PASS recorded for env "do-dev" with hash of 64 "a" characters, and the catalog now lists c1 with hash of 64 "d" characters
    When pending is computed for "do-dev"
    Then c1 is in pending

  @AC-31 @FR-5
  Scenario: Several RPCs in one check are recorded in call order
    Given a check that calls LedgerService/QueryEvents and then ConfigService/GetConfig
    When it runs
    Then the record's rpcs_invoked equals ["xstockstrat.ledger.v1.LedgerService/QueryEvents", "xstockstrat.config.v1.ConfigService/GetConfig"]
