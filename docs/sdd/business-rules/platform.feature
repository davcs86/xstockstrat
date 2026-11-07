# Cross-cutting / platform-wide business rules — the behavioral sibling of the PLAT-* structural
# invariants in docs/context-constitution.md. Rules that span more than one service live here;
# single-service rules live in services/xstockstrat-<svc>/acceptance/*.feature.
#
# Populated by scenario PROMOTION when a launched feature's acceptance.feature carries a cross-cutting
# guarantee (Constitution C-16). Source-feature provenance is carried on each scenario's `@feature-N` tag.

Feature: Platform-wide guarantees
  Cross-service behavioral rules the platform must preserve across features.

  @AC-8 @FR-7 @feature-147
  Scenario: MCP_AGENT_SECRET is absent from the codebase and deploy surfaces
    Given the repository is checked out
    When the repository is grepped for "MCP_AGENT_SECRET"
    Then there are no matches in service code, docker-compose.yml, .do/app.yaml, .do/app.dev.yaml, the deploy workflows, or do-inject-prod-secrets.py

  @AC-1 @FR-1 @FR-2 @feature-127
  Scenario: A watchlist-direction signal adds the symbol to the caller's system-managed watchlist
    Given the authenticated caller "user-42" has no NVDA entry in their system-managed signals watchlist
    When ingest_signal is called with direction="watchlist" for symbol "NVDA" and the response has deduplicated=false
    Then NVDA appears in the caller's system-managed signals watchlist bindings
    And that binding's source is WATCHLIST_ENTRY_SOURCE_SIGNAL

  @AC-2 @FR-6 @feature-127
  Scenario: Non-watchlist directions cause no watchlist mutation
    When ingest_signal is called with direction="buy" for symbol "NVDA"
    Then no watchlist binding is created or changed for the caller

  @AC-3 @FR-4 @feature-127
  Scenario: A deduplicated ingest does not re-trigger the auto-add
    When ingest_signal is called with direction="watchlist" for symbol "NVDA" and the response has deduplicated=true
    Then no watchlist binding is created or changed for the caller

  @AC-7 @FR-8 @FR-9 @feature-127
  Scenario: A system-managed watchlist cannot be deleted via API or UI
    Given the caller "user-42" owns a system_managed watchlist
    When DeleteWatchlist is called for that watchlist
    Then the RPC returns FAILED_PRECONDITION
    And the watchlist still exists
    And on /insights/watchlists the delete affordance for that watchlist is hidden or disabled
    And its rename, add-symbol, and remove-symbol affordances remain enabled

  @AC-5 @FR-4 @feature-149
  Scenario: Every documentation surface reflects the widened manage_strategy input type
    Given the manage_strategy change has been applied
    When the manage_strategy docstring, docs/runbooks/mcp-tools.md, and the strat-lab backtest skill are read
    Then each states that entry_rule/exit_rule accept a JSON string or a JSON object (dict)

  @AC-15 @FR-1 @feature-157
  Scenario: Deregistering an offline account purges its positions and realized P&L
    Given an offline account with open positions and recorded realized P&L
    When the user deregisters that offline account
    Then an account.deregistered event is emitted for that account_id
    And the account's positions and its offline_account_realized row are removed
    And the account no longer appears in ListBrokerAccounts

  @AC-18 @FR-8 @feature-163
  Scenario: Deregistering an offline account purges its baseline rows
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When the OFFLINE account "acc-1" is deregistered
    Then no offline_position_baselines rows remain for account "acc-1"
    And the deregistration also purges the account's positions and realized P&L

  @AC-1 @FR-1 @FR-2 @feature-021
  Scenario: Date-range export streams every event as NDJSON in global-sequence order
    Given the ledger holds 1,200 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And the "Content-Type" is "application/x-ndjson"
    And the body contains 1,200 newline-delimited JSON objects, one per event in that window
    And the objects appear in ascending ledger global-sequence order

  @AC-2 @FR-2 @feature-021
  Scenario: CSV format returns a header row and one data row per event
    Given the ledger holds 3 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31&format=csv"
    Then the response status is 200
    And the "Content-Type" is "text/csv"
    And the first line is the header "event_id,event_type,occurred_at,source_service,correlation_id,sequence,stream_key,user_id,payload"
    And 3 data rows follow, one per event

  @AC-7 @FR-6 @feature-021
  Scenario: A one-million-row export streams without buffering the full result set
    Given the ledger holds 1,000,000 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And all 1,000,000 rows are streamed to the client
    And the ledger reads rows from a DB cursor and emits them on the ExportEvents stream, and the BFF pipes each message straight to the HTTP response, so neither process buffers the full result set

  @AC-10 @FR-4 @feature-029
  Scenario: A per-fill fee flows through the fee-capture plumbing into the net win test
    Given a fill carrying a $1.20 fee on the "order.filled" event payload
    And that fill fully closes a position whose gross realized P&L is $1.00
    When the portfolio realized-P&L fold accumulates the fee and seals the position
    Then the "portfolio.position.closed" event carries fees_total=$1.20 and an unchanged gross realized_pnl=$1.00
    And analysis persists fees_total=$1.20 on the pnl_positions row
    And GetAttribution's win test uses net = $1.00 - $1.20 = -$0.20 and counts the trade as a loss

  @AC-3 @FR-2 @feature-110
  Scenario: A blank quantity on the symbol-page ticket triggers the auto-sizing path
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence of 0.82 attached via the signalConfidence prop
    When the trader submits the ticket with the quantity field left blank
    Then the blank quantity is coerced to 0 (never NaN) and the PlaceOrder request is sent with qty <= 0 and confidence 0.82, and the trading service computes the quantity via ComputePositionSize rather than rejecting the order

  @AC-8 @FR-5 @feature-110
  Scenario: The symbol-page OrderForm reaches PlaceOrder while the plain /trader form's blank-qty path does not auto-size
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence attached and the quantity field left blank
    And the plain /trader order form for "CAPR" (no signalConfidence prop) with the quantity field left blank
    When each is submitted
    Then the symbol-page OrderForm sends a PlaceOrder request that routes into 023's auto-sizing path (qty <= 0 with the real confidence)
    And the plain /trader form sends no PlaceOrder request and is rejected with a "quantity required" validation error, so it never auto-sizes

  @AC-1 @FR-1 @regression @feature-171
  Scenario Outline: A telemetry module's built Resource no longer carries the trading_mode attribute
    Given OTEL_ENABLED is "true" and TRADING_MODE is set to "paper"
    When <service> initialises telemetry and builds its OTel Resource
    Then the resource attributes do NOT include "trading_mode"
    And they still include "service.name", "deployment.environment", and "platform"

    Examples:
      | service                 |
      | xstockstrat-trading     |
      | xstockstrat-portfolio   |
      | xstockstrat-marketdata  |
      | xstockstrat-agent       |
      | xstockstrat-ingest      |
      | xstockstrat-indicators  |
      | xstockstrat-analysis    |
      | xstockstrat-ledger      |
      | xstockstrat-identity    |
      | xstockstrat-config      |
      | xstockstrat-notify      |

  @AC-2 @FR-3 @regression @feature-171
  Scenario: Telemetry init remains non-blocking after the trading_mode attribute is removed
    Given OTEL_ENABLED is "true"
    When a telemetry module builds its Resource with the trading_mode attribute removed
    Then telemetry initialisation completes without raising
    And the service proceeds to start normally

  @AC-3 @FR-2 @regression @feature-171
  Scenario: The dashboards README documents the emitted attribute set, without trading_mode
    Given packages/otel/dashboards/README.md lists the resource attributes every service attaches
    When the documented attribute list is inspected
    Then it does NOT list "trading_mode"
    And it still lists "service.name", "deployment.environment", and "platform"

  @AC-5 @FR-4 @feature-181
  Scenario: Watchlist readiness decoration introduces no analysis-to-portfolio dependency cycle
    Given xstockstrat-analysis already depends on xstockstrat-portfolio for watchlist reads
    When readiness decoration is added to the watchlist read path (GetWatchlistReadiness)
    Then xstockstrat-portfolio declares no AnalysisService client/stub and issues no outbound call to analysis
    And the root CLAUDE.md Inter-Service Dependencies graph gains no portfolio->analysis edge (stays acyclic)

  @AC-1 @FR-1 @regression @item-5 @feature-175
  Scenario: The dead getEnvBool is gone from the Go config packages
    Given the three Go services (trading, portfolio, marketdata)
    When their internal/config packages are inspected and built
    Then getEnvBool (and its suppressor and its dedicated unit test) no longer exist
    And each service still compiles, lints (golangci-lint), and passes its config-package tests

  @AC-2 @FR-2 @regression @item-6 @feature-175
  Scenario: The confirmed-dead propagation middleware is gone from the Node leaf services
    Given the ledger, notify, and config services
    When their src trees are inspected and built
    Then src/middleware/propagation.ts no longer exists
    And each service still builds (tsc) and passes its tests
    And the identity service's propagation.ts is handled per the recorded design decision (deleted or
      documented as intentionally retained), never silently left in an undecided state

  @AC-3 @FR-3 @regression @item-7 @feature-175
  Scenario: The Node leaf type surface matches the Node 24 runtime
    Given the four Node leaf services (ledger, notify, config, identity)
    When their package.json and lockfiles are inspected
    Then @types/node resolves to a ^24 major
    And each service typechecks (tsc via its build script — not only its test runner) and builds against it

  @AC-6 @FR-5 @feature-182
  Scenario: Docs no longer claim the readiness-materializer keys have no seed migration
    Given the analysis CLAUDE.md Config Keys table previously stated "No seed migration" for the analysis.readiness_materializer.* keys
    When feature 182 lands
    Then those four rows cite seed migration 027 instead of "No seed migration"
    And the config-governance per-feature registered-keys log records the four keys under feature 182
    And the ~5 other analysis.* / analysis.opportunity.* rows that still have no seed migration keep their "No seed migration" note unchanged

  @AC-3 @FR-2 @feature-205
  Scenario: Declared fundamental inputs round-trip on read
    Given formula "pe_value_score" has fundamental_inputs [PE_RATIO, PB_RATIO]
    When an author calls get_formula for "pe_value_score"
    Then the response carries fundamentalInputs = ["FUNDAMENTAL_METRIC_PE_RATIO", "FUNDAMENTAL_METRIC_PB_RATIO"] (camelCase key, enum NAME-strings, per MessageToDict)
    And the FormulaEditor shows both metrics as selected

  @AC-4 @FR-3 @feature-205
  Scenario: The fundamental-metric catalog is discoverable
    Given an author who has not read the proto
    When the author requests the available fundamental metrics via the MCP
    Then the response includes all 11 FundamentalMetric values with a human-readable meaning for each
    And the /insights fundamental-input picker offers the same 11 options

  @AC-7 @FR-6 @feature-205
  Scenario: An authored fundamentals formula behaves identically as a strategy component
    Given formula "pe_value_score" authored via the FormulaEditor with fundamental_inputs [PE_RATIO, PB_RATIO]
    When the same formula is used as a COMPONENT_KIND_CUSTOM_FORMULA in a strategy (feature 201)
    Then the strategy evaluator feeds it the same pe_ratio and pb_ratio snake_case data-keys
    And the component's numeric output equals the score test_formula returned for the identical input values

  # ─── Inter-service mutual TLS (feature 210) ───────────────────────────────
  # Platform-wide transport guarantee: every inter-service gRPC hop is mutually authenticated and
  # fail-closed. @AC-3 (per-RPC identity-scoped authz) was @descoped at design — no guarantee shipped,
  # not promoted. Provenance: @feature-210.

  @AC-1 @FR-1 @feature-210
  Scenario: A plaintext gRPC caller is refused in production configuration
    Given a backend gRPC server (e.g. xstockstrat-trading on :50051) configured for production mTLS enforcement
    When a client attempts a plaintext h2c connection presenting no client certificate
    Then the connection is refused at the TLS layer before any RPC is dispatched
    And no header trio (x-user-id / x-access-scope / x-trace-id) from that caller is honored

  @AC-2 @FR-1 @FR-2 @feature-210
  Scenario: A mutually-authenticated peer with a valid platform-issued identity is accepted
    Given xstockstrat-ui presenting a client certificate issued by the platform CA for its own service identity
    When it opens a gRPC channel to xstockstrat-trading, which verifies the client cert and presents its own server cert
    Then the handshake succeeds, both certs verify against the platform CA, and the RPC proceeds
    And the propagated x-user-id / x-access-scope / x-trace-id are honored on that authenticated channel

  @AC-4 @FR-4 @feature-210
  Scenario: mTLS is enforced identically in every environment; verification cannot be disabled
    Given docker-compose using dev certs from scripts/gen-dev-certs.sh (dev self-signed CA)
    When the stack is brought up locally
    Then inter-service gRPC works end to end over full mutual TLS for development
    And a service started without its MTLS_CERT/MTLS_KEY/MTLS_CA_CERT material fails to start (fail-closed)
    And no env var or flag exists in any configuration that disables peer verification or accepts plaintext
    And the production app spec loads production-CA certificates

  @AC-5 @FR-5 @feature-210
  Scenario: Header-propagation semantics are unchanged beneath mTLS
    Given an authenticated mTLS channel from xstockstrat-ui through xstockstrat-trading to xstockstrat-portfolio
    When a request carries x-user-id / x-access-scope / x-trace-id
    Then the trio is propagated across the hop exactly as before mTLS (Go interceptor / Python per-method / Node AsyncLocalStorage)
    And downstream ownership/scope checks observe the same values as before this feature

  @AC-6 @FR-6 @FR-3 @feature-210
  Scenario: A long-lived streaming RPC survives a certificate rotation
    Given an active WatchConfig (or StreamEvents) stream over mTLS
    When the platform rotates the relevant service certificate before its expiry
    Then existing streams continue or transparently re-establish without dropping data
    And new connections use the rotated certificate with no service downtime

  # ─── Private-by-default objects & template catalog (feature 224) ──────────
  # Cross-service guarantees: the SAN-bound system identity contract (analysis → indicators/ingest),
  # the strategy-template saga (analysis + indicators), reserved system slugs, the empty catalog, and
  # per-owner MCP bearer resolution (ingest + config). Single-service rules live in each service's
  # acceptance/private-by-default-templates.feature. Provenance: @feature-224.

  @AC-6 @FR-3 @FR-1 @feature-224
  Scenario: The fundamentals loop still runs the system scoring formula
    Given analysis.fundsignal.scoring_formula_id is set to system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
    When the fundamentals signal loop scores symbol "AAPL"
    Then ExecuteFormula for system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b" succeeds
    And indicators receives the ExecuteFormula call with x-user-id "system" and x-internal-caller "analysis-fundsignal"

  @AC-15 @FR-7 @feature-224
  Scenario: Catalog starts empty after migration
    Given a database migrated from the pre-feature schema with 8 public formulas
    When "bob" calls ListTemplates
    Then the response contains 0 templates

  @AC-18 @FR-9 @feature-224
  Scenario: Strategy template instantiation deep-copies referenced formulas
    Given strategy template "tpl-meanrev" whose two components reference formula templates "tpl-zscore" and "tpl-er"
    When "bob" instantiates "tpl-meanrev"
    Then "bob" owns a new inactive, non-live strategy and 2 new private formulas copied from "tpl-zscore" and "tpl-er"
    And each strategy component's formula_id points to "bob"'s copies

  @AC-19 @FR-9 @feature-224
  Scenario: A failed deep copy leaves nothing behind
    Given strategy template "tpl-meanrev" whose second formula copy fails
    When "bob" instantiates "tpl-meanrev"
    Then the call fails
    And "bob" owns 0 new strategies and 0 new formulas visible via ListFormulas

  @AC-23 @FR-11 @feature-224
  Scenario: System special-cases are unchanged
    Given system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b" and "bob" owns live strategy "fundamentals_macd_blend"
    When an admin calls UpdateFormula on system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
    Then the call fails with PERMISSION_DENIED as before
    And "bob" calling ManageStrategy DEACTIVATE on "fundamentals_macd_blend" is refused as before

  @AC-26 @FR-6 @feature-224
  Scenario: System-owned fundamentals signals are visible to every user
    Given the fundamentals producer emitted a BUY signal for "MSFT" under a source owned by "system"
    And "bob" owns signal_eligible strategy "s-fund"
    When the live loop evaluates "s-fund" for "MSFT"
    Then the "system" signal for "MSFT" is consumed for "bob"
    And "bob" calling ManageSignalSource UPDATE on that system source fails with PERMISSION_DENIED

  @AC-32 @FR-12 @feature-224
  Scenario: Agent docs and strat-lab skill stay in parity with the tool contract
    Given the agent tool catalog includes "list_templates" and "instantiate_template"
    When docs/runbooks/mcp-tools.md and plugins/strat-lab/skills/backtest/SKILL.md are checked
    Then both list "list_templates" and "instantiate_template" and neither mentions "is_public" or "include_public"

  @AC-35 @FR-14 @feature-224 @feature-225
  Scenario: Two users with the same mcp_client slug use their own credentials
    Given "alice" and "bob" each own mcp_client source "acme-mcp" with bearers "tok-a" and "tok-b"
    When the ingest poller polls both sources
    Then the request for "alice"'s source carries "Authorization: Bearer tok-a" and "bob"'s carries "Bearer tok-b"
    And GetConfig, ListKeys and WatchConfig never return "tok-a" or "tok-b" in plaintext to any caller
    And with a global config secret under the same key alongside an owner's per-user one, ingest calls config "GetSecret" with that owner's "user_id" and sends the per-user value, not the global one

  @AC-36 @FR-4 @feature-224
  Scenario: System slugs are reserved in both directions
    Given a "system"-owned source "fundamentals" exists
    When "bob" calls ManageSignalSource REGISTER with slug "fundamentals"
    Then the call fails with ALREADY_EXISTS and no source owned by "bob" exists
    Given "bob" owns source "macro-feed" and analysis.fundsignal.source_slug is reconfigured to "macro-feed"
    When the fundamentals signal loop registers its system source
    Then the registration fails with FAILED_PRECONDITION
    And the cycle emits no signal and raises an ERROR notify alert naming slug "macro-feed"

  @AC-5 @FR-4 @regression @feature-196
  Scenario: deprecating a response field never changes the proto schema
    Given a deprecated proto field whose value is no longer populated in responses
    When the change ships
    Then no .proto field or enum value is removed and no reserved statement is added
    And buf breaking reports no change and the BSR module schema is unchanged

  @AC-3 @FR-6 @regression @feature-196
  Scenario: deprecated enum values stay defined
    Given a deprecated enum member (TIMEFRAME_*, ENVIRONMENT_DEV, VALUE_TYPE_FLOAT_MAP) with stored or wire values
    When a field is omitted from responses
    Then the enum member stays defined and [deprecated = true], and TIMEFRAME_1MIN is still emitted on streamed bars

  @AC-9 @FR-5 @regression @feature-196
  Scenario: request-only dead fields stay server-ignored
    Given a dead request-body field (user_id on owner-scoped requests, is_paper, or the deprecated operation string)
    When a service handles the request
    Then identity and behavior are resolved from headers and environment as today, and no response carries the field

  # ─── Private-by-default enforce + contract (feature 225) ──────────────────
  # Platform migration tooling: the contract gate, refusing contract downs, replay-safe contract
  # up-files, and the db-migrate.sh contract-floor dirty guard. Single-service rules live in each
  # service's acceptance/private-by-default-enforce-contract.feature. Provenance: @feature-225.

  @AC-5 @FR-5 @feature-225
  Scenario: A contract migration whose expand file is not yet on main is rejected
    Given a PR adds "services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql" whose line 1 is "-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql"
    And that expand file is not on "origin/main"
    When the "migration-contract-gate" CI job runs
    Then it exits non-zero naming "027_contract_owner_dimension.up.sql"

  @AC-6 @FR-5 @feature-225
  Scenario: A contract migration's down-file refuses to run
    Given analysis migration "027_contract_owner_dimension.up.sql" is applied
    When "migrate goto 26" is run for the analysis schema
    Then it exits non-zero with output containing "irreversible contract"
    And the analysis migration state is dirty
    And "analysis.backtest_runs.user_id" is still NOT NULL

  @AC-12 @FR-5 @feature-225
  Scenario: Contract up-files are replay-safe
    Given analysis 027 and ingest 014 have been applied once
    When "scripts/migration-rerun.sh" replays the 224 expand and 225 contract up-files
    Then every replay succeeds, the contracted objects stay absent, and the N-1 trigger count is 0

  @AC-18 @FR-8 @feature-225
  Scenario: db-migrate refuses the force-0 replay for a dirty contract service
    Given analysis migration "027_contract_owner_dimension.up.sql" is applied
    And a refused "migrate goto 26" has left the analysis migration state dirty at version 26
    When "scripts/db-migrate.sh up" runs
    Then it exits non-zero with output naming "analysis" and "force 25"
    And the analysis migration state is still dirty at version 26
    And after "migrate force 25" for the analysis schema, "scripts/db-migrate.sh up" exits 0
    And the analysis migration state is clean at version 27 and "analysis.backtest_runs.user_id" is NOT NULL

  @AC-19 @FR-8 @feature-225
  Scenario: Dirty recovery below the contract floor is unchanged
    Given a migrations directory whose only contract file "027_x.up.sql" declares "-- contract-of: services/xstockstrat-x/migrations/026_y.up.sql"
    When the dirty guard evaluates "20 (dirty)", and separately a directory with no contract file evaluates "27 (dirty)"
    Then both evaluations allow the automatic force-0 recovery

  @AC-1 @FR-1 @regression @feature-226
  Scenario Outline: A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL
    Given OTEL_ENABLED is "true"
    And OTEL_EXPORTER_OTLP_ENDPOINT is the receiver's base URL with path "/otlp"
    And OTEL_EXPORTER_OTLP_HEADERS is "<headers>"
    When the service initialises telemetry, records a span, and flushes on shutdown
    Then the receiver gets an HTTP POST to "/otlp/v1/traces"
    And the request carries the header "Authorization: Basic dGVzdDprZXk="

    Examples:
      | form    | headers                              |
      | raw     | Authorization=Basic dGVzdDprZXk=     |
      | encoded | Authorization=Basic%20dGVzdDprZXk%3D |

  @AC-3 @FR-3 @regression @feature-226
  Scenario: A failed trace export is visible in service logs
    Given OTEL_ENABLED is "true"
    And OTEL_EXPORTER_OTLP_ENDPOINT points at a receiver that rejects the export
    When the service flushes a span
    Then the service log contains an OTel export error

  @AC-4 @FR-4 @regression @feature-226
  Scenario: Local compose routes every service to the collector's OTLP/HTTP receiver
    Given the local docker-compose stack with OTEL_ENABLED "true"
    When any service's OTEL_EXPORTER_OTLP_ENDPOINT is read from docker-compose.yml
    Then it is "http://otel-collector:4318"

  # ─── setup-env produces a bootable .env (feature 218) ─────────────────────

  @AC-1 @regression @feature-218
  Scenario: A defaults-mode setup produces a .env that docker compose accepts
    Given no .env file exists at the repo root
    When the operator runs "./scripts/setup-env.sh --defaults"
    Then the generated .env defines CONFIG_SECRETS_ENCRYPTION_KEY as 64 hex characters
    And the generated .env defines BROKER_ACCOUNTS_ENCRYPTION_KEY as 64 hex characters
    And "docker compose config" exits 0 using that .env

  @AC-2 @regression @feature-218
  Scenario: A generated .env carries none of the variables removed by feature 147
    Given no .env file exists at the repo root
    When the operator runs "./scripts/setup-env.sh --defaults"
    Then the generated .env does not define ALPACA_API_KEY, ALPACA_API_SECRET or MCP_AGENT_SECRET

  # ─── Sector enum sentinel (feature 217) ───────────────────────────────────

  @AC-9 @FR-9 @feature-217
  Scenario: The Sector enum carries an unspecified sentinel
    Given the generated Sector proto enum
    When its zero value is inspected
    Then the zero value is SECTOR_UNSPECIFIED

  @AC-18 @FR-7 @feature-240
  Scenario: Rollout backfills fees to zero and seeds lifetime realized
    Given before migration "acc-1" has since-snapshot realized 450.00 and two confirmed offline orders
    And Alpaca account "alp-1" has one filled broker order
    When the feature's migrations are applied
    Then both "acc-1" orders have fees 0.00 and the "alp-1" order has no fees value
    And "acc-1" lifetime realized P&L is 450.00, fees_since_snapshot is 0.00, and fees_lifetime is 0.00

  @AC-1 @FR-1 @regression @feature-244
  Scenario Outline: A stored zero is honoured by the Python config getters
    Given the <service> ConfigWatcher snapshot holds "<key>" as a <type> value <stored>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <stored>

    Examples:
      | service                | key                                     | type   | stored | getter    | default |
      | xstockstrat-analysis   | analysis.opportunity.signal_rank_weight | float  | 0.0    | get_float | 0.3     |
      | xstockstrat-analysis   | analysis.engine.alert_throttle_seconds  | int    | 0      | get_int   | 300     |
      | xstockstrat-analysis   | analysis.test.zero_string               | string | ""     | get_str   | "x"     |
      | xstockstrat-indicators | indicators.test.zero_int                | int    | 0      | get_int   | 7       |
      | xstockstrat-indicators | indicators.test.zero_float              | float  | 0.0    | get_float | 0.5     |
      | xstockstrat-indicators | indicators.test.zero_string             | string | ""     | get_str   | "x"     |
      | xstockstrat-ingest     | ingest.test.zero_int                    | int    | 0      | get_int   | 7       |
      | xstockstrat-ingest     | ingest.test.zero_float                  | float  | 0.0    | get_float | 0.5     |
      | xstockstrat-ingest     | ingest.test.zero_string                 | string | ""     | get_str   | "x"     |

  @AC-4 @FR-2 @regression @feature-244
  Scenario Outline: An unset or mismatched value still resolves to the coded default
    Given the <service> ConfigWatcher <state>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <default>

    Examples:
      | service                | state                                         | getter    | key                                      | default |
      | xstockstrat-analysis   | snapshot has no entry for the key             | get_float | analysis.backtest.default_commission_pct | 0.001   |
      | xstockstrat-analysis   | snapshot has no entry for the key             | get_int   | analysis.engine.alert_throttle_seconds   | 300     |
      | xstockstrat-analysis   | has received no snapshot                      | get_str   | analysis.test.unset_string               | "x"     |
      | xstockstrat-indicators | has received no snapshot                      | get_int   | indicators.test.unset_int                | 7       |
      | xstockstrat-indicators | snapshot holds the key as a string value "5"  | get_float | indicators.test.mismatched_float         | 0.5     |
      | xstockstrat-indicators | snapshot has no entry for the key             | get_str   | indicators.test.unset_string             | "x"     |
      | xstockstrat-ingest     | snapshot has no entry for the key             | get_str   | ingest.test.unset_string                 | "x"     |
      | xstockstrat-ingest     | snapshot holds the key as a float value 2.5   | get_int   | ingest.test.mismatched_int               | 7       |
      | xstockstrat-ingest     | snapshot has no entry for the key             | get_float | ingest.test.unset_float                  | 0.5     |

  @AC-6 @FR-3 @regression @feature-244
  Scenario Outline: A trap-dependent site keeps the coded default for a stored zero
    Given "<key>" is stored as the <type> value <stored>
    When <service> resolves it for <site>
    Then the effective value is <effective>

    Examples:
      | service                | key                                              | type   | stored | site                                  | effective                 |
      | xstockstrat-ingest     | ingest.backfill.max_concurrent_chunks            | int    | 0      | the backfill chunk semaphore capacity | 3                         |
      | xstockstrat-ingest     | ingest.backfill.chunk_max_bars                   | int    | 0      | the chunk planner's bar cap           | 200000                    |
      | xstockstrat-ingest     | ingest.backfill.chunk_window_days                | int    | 0      | the chunk planner's window in days    | 90                        |
      | xstockstrat-ingest     | ingest.mcp_client.poll_interval_seconds          | int    | 0      | the mcp_client poll loop              | 300                       |
      | xstockstrat-indicators | indicators.sandbox.timeout_ms                    | int    | 0      | ExecuteFormula                        | 5000                      |
      | xstockstrat-indicators | indicators.sandbox.memory_bytes                  | int    | 0      | ExecuteFormula                        | 134217728                 |
      | xstockstrat-indicators | indicators.sandbox.max_concurrent                | int    | 0      | the sandbox semaphore capacity        | 4                         |
      | xstockstrat-analysis   | analysis.engine.eval_interval_seconds            | int    | 0      | the live-loop sleep between cycles    | 60                        |
      | xstockstrat-analysis   | analysis.engine.max_strategies_per_cycle         | int    | 0      | the live-loop per-cycle pair budget   | 50                        |
      | xstockstrat-analysis   | analysis.engine.fundamentals_blend_strategy_id   | string | ""     | the blend-governed strategy id        | "fundamentals_macd_blend" |
      | xstockstrat-analysis   | analysis.strategy.default_cooldown_days          | int    | 0      | the default re-entry cooldown in days | 31                        |
      | xstockstrat-analysis   | analysis.scoring.shrinkage_days                  | int    | 0      | the headline-grade shrinkage k        | 250                       |
      | xstockstrat-analysis   | analysis.screener.max_duration_seconds           | int    | 0      | the ScreenSymbols deadline            | 120                       |
      | xstockstrat-analysis   | analysis.backtest.portfolio_position_weight      | float  | 0.0    | portfolio-mode sizing                 | 0.10                      |
      | xstockstrat-analysis   | analysis.backtest.detail_retention_per_strategy  | int    | 0      | backtest-detail retention             | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_bars_fetches | int    | 0      | the opportunity bars-fetch semaphore  | 2                         |
      | xstockstrat-analysis   | analysis.backtest.default_fill_model             | int    | 0      | a RunBacktest without fill_model      | FILL_MODEL_SAME_BAR_CLOSE |
      | xstockstrat-analysis   | analysis.backtest.max_range_days                 | int    | 0      | the RunBacktest range cap in days     | 730                       |
      | xstockstrat-analysis   | analysis.snapshot.indicator_timeout_ms           | int    | 0      | the snapshot indicator timeout in ms  | 500                       |
      | xstockstrat-analysis   | analysis.screener.max_universe_size              | int    | 0      | the ScreenSymbols universe cap        | 100                       |
      | xstockstrat-analysis   | analysis.opportunity.max_universe_size           | int    | 0      | the opportunity universe cap          | 100                       |
      | xstockstrat-analysis   | analysis.fundsignal.run_interval_hours           | int    | 0      | the fundsignal loop interval in hours | 24                        |
      | xstockstrat-analysis   | analysis.fundsignal.daily_call_budget            | int    | 0      | the fundsignal daily call budget      | 200                       |
      | xstockstrat-ingest     | ingest.mcp_client.request_timeout_seconds        | int    | 0      | the mcp_client per-call timeout       | 30                        |
      | xstockstrat-analysis   | analysis.strategy.max_concurrent_entry_backfill  | int    | 0      | the entry-backfill semaphore          | 4                         |
      | xstockstrat-analysis   | analysis.backtest.portfolio_max_concurrent       | int    | 0      | portfolio-mode max open positions     | 9                         |
      | xstockstrat-analysis   | analysis.series.max_concurrent_components        | int    | 0      | the series component semaphore        | 4                         |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_candidates   | int    | 0      | the opportunity candidate semaphore   | 4                         |
      | xstockstrat-analysis   | analysis.compute.max_worker_threads              | int    | 0      | the compute thread pool size          | 4                         |
      | xstockstrat-analysis   | analysis.readiness_materializer.max_concurrent_bars_fetches | int | 0 | the materializer bars semaphore | 2                         |
      | xstockstrat-analysis   | analysis.screener.max_concurrent_formula_evals   | int    | 0      | the screener formula semaphore        | 4                         |
      | xstockstrat-analysis   | analysis.fundsignal.source_slug                  | string | ""     | the fundamentals source slug          | "fundamentals"            |
      | xstockstrat-analysis   | analysis.fundsignal.max_symbols_per_run          | int    | 0      | the fundsignal per-run symbol cap     | 200                       |
      | xstockstrat-analysis   | analysis.fundsignal.valid_days                   | int    | 0      | the fundsignal signal validity days   | 90                        |
      | xstockstrat-analysis   | analysis.snapshot.signal_timeout_ms              | int    | 0      | the snapshot signal timeout in ms     | 500                       |
      | xstockstrat-analysis   | analysis.patterns.indicator_bucket_count         | int    | 0      | the P&L-pattern indicator buckets     | 5                         |
      | xstockstrat-analysis   | analysis.opportunity.max_live_strategies_per_symbol | int | 0      | the per-symbol live attribution cap   | 5                         |
      | xstockstrat-analysis   | analysis.opportunity.max_live_only_symbols_per_compute | int | 0   | the live-only symbol cap per compute  | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.max_live_held_symbols_per_compute | int | 0   | the held-symbol live cap per compute  | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.valid_window_hours          | int    | 0      | the opportunity validity window hours | 24                        |
      | xstockstrat-analysis   | analysis.opportunity.snooze_default_hours        | int    | 0      | the default snooze hours              | 24                        |
      | xstockstrat-analysis   | analysis.opportunity.read_db_budget_ms           | int    | 0      | the ListOpportunities DB read budget  | 20000                     |
      | xstockstrat-analysis   | analysis.opportunity.live_enrich_timeout_ms      | int    | 0      | the live-enrich timeout in ms         | 3000                      |

  # Promoted from feature 252 (fix-identity-ledger-test-suites): identity and ledger test-suite integrity.
  @AC-3 @FR-3 @regression @feature-252
  Scenario Outline: an unloadable test subject fails the run instead of passing
    Given in services/<service>, the subject import in <test_file> points at the nonexistent module "<missing>"
    When "pnpm run test:coverage" runs in services/<service>
    Then the command exits non-zero
    And no test in <test_file> is reported as passed

    Examples:
      | service              | test_file                                 | missing                             |
      | xstockstrat-identity | src/__tests__/identityServiceImpl.test.ts | ../grpc/identityServiceImpl.missing |
      | xstockstrat-ledger   | src/__tests__/ledgerServiceImpl.test.ts   | ../grpc/ledgerServiceImpl.missing   |
      | xstockstrat-ledger   | src/__tests__/eventNotifier.test.ts       | ../services/eventNotifier.missing   |

  @AC-4 @FR-4 @regression @feature-252
  Scenario: the coverage gate measures the implementation
    Given each service's c8-wrapped "pnpm run test:coverage" run
    When "pnpm run test:coverage" runs in services/xstockstrat-identity and services/xstockstrat-ledger
    Then the identity coverage report has a row with non-zero line coverage for identityServiceImpl and for authz
    And the ledger coverage report has a row with non-zero line coverage for ledgerServiceImpl and for eventNotifier
    And "c8 check-coverage --lines 40", run in each of those services right after its run, exits 0 and the report shows a numeric All files % Lines of at least 40
    # Rows are matched by module name, whether c8 reports them under src/ or dist/.

  @AC-5 @FR-5 @feature-252
  Scenario Outline: existing tests still pass once they actually execute
    Given the tests in services/<service>/src/__tests__ on main-dev
    When "pnpm run test:coverage" runs in services/<service> after the fix
    Then the test summary reports 0 failed tests
    And no existing test is deleted, marked skip or todo, or has an assertion removed

    Examples:
      | service              |
      | xstockstrat-identity |
      | xstockstrat-ledger   |

  @AC-6 @FR-3 @regression @feature-252
  Scenario Outline: a compiled test whose compiled subject is missing fails instead of passing
    Given "tsc" has completed in services/<service>
    And "node --test --test-reporter=tap <compiled_test>" exits 0 with a "# pass" count above 0
    When <compiled_subject> is deleted and "node --test --test-reporter=tap <compiled_test>" runs again
    Then the command exits non-zero
    And the TAP summary reports "# pass 0"

    Examples:
      | service              | compiled_test                              | compiled_subject                 |
      | xstockstrat-identity | dist/__tests__/identityServiceImpl.test.js | dist/grpc/identityServiceImpl.js |
      | xstockstrat-ledger   | dist/__tests__/ledgerServiceImpl.test.js   | dist/grpc/ledgerServiceImpl.js   |
      | xstockstrat-ledger   | dist/__tests__/eventNotifier.test.js       | dist/services/eventNotifier.js   |

  @AC-5 @FR-3 @regression @feature-259
  Scenario Outline: A config watcher reconnects after a non-gRPC exception
    Given the <service> ConfigWatcher whose first WatchConfig stream raises RuntimeError "boom"
    And whose second WatchConfig stream yields a snapshot with version "v2"
    When the watcher runs
    Then WatchConfig is called a second time after a backoff
    And the watcher's snapshot version is "v2"

    Examples:
      | service    |
      | analysis   |
      | indicators |
      | ingest     |

  @AC-8 @FR-3 @regression @feature-259
  Scenario Outline: A config watcher task that ends unexpectedly is retained and its exit is logged
    Given the <service> ConfigWatcher has started its watch task
    When the watch coroutine ends with RuntimeError "boom"
    Then an error naming the watch task and "boom" is logged

    Examples:
      | service    |
      | analysis   |
      | indicators |
      | ingest     |

  # ─── Database TLS fail-closed (feature 266) ───────────────────────────────
  # Node backends and the UI audit route never connect to a TLS database without verifying the certificate. Provenance: @feature-266.

  @AC-1 @FR-1 @feature-266
  Scenario Outline: A Node backend refuses to boot against a TLS database with no CA configured
    Given DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT is unset
    When <service> starts
    Then it exits non-zero before serving gRPC
    And it logs that DATABASE_CA_CERT is required for a TLS database connection

    Examples:
      | service               |
      | xstockstrat-ledger    |
      | xstockstrat-config    |
      | xstockstrat-identity  |
      | xstockstrat-notify    |

  @AC-2 @FR-2 @feature-266
  Scenario Outline: A Node backend verifies the database certificate when a CA is configured
    Given DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT holds a CA that did not sign the server's certificate
    When <service> starts
    Then the database connection is rejected with a certificate verification error
    And it exits non-zero and logs the certificate verification error

    Examples:
      | service               |
      | xstockstrat-ledger    |
      | xstockstrat-config    |
      | xstockstrat-identity  |
      | xstockstrat-notify    |

  @AC-5 @FR-5 @feature-266
  Scenario Outline: Every deployed component that reaches the database directly is given the CA
    Given the DigitalOcean app spec <spec>
    Then every component with DATABASE_URL among xstockstrat-ledger, xstockstrat-config, xstockstrat-identity, xstockstrat-notify and xstockstrat-ui also has DATABASE_CA_CERT bound to "${xstockstrat.CA_CERT}"

    Examples:
      | spec              |
      | .do/app.yaml      |
      | .do/app.dev.yaml  |

  @AC-1 @FR-1 @FR-3 @regression @feature-250
  Scenario: Every alert rule queries a metric series or log stream that some workload produces
    Given the provisioned alert rules in packages/otel/alerts/alert-rules.yaml
    And the produced-signal set: the metric names and log streams exported by the 12 runtimes or the collector, plus the metric names that a Grafana-side span-metrics path derives from exported traces, admitted only with recorded evidence (design.md) that the path returns those series for the stack
    And today that set holds no PromQL metric name and no Loki log stream, because the runtimes export traces only (feature 226)
    When each alert rule's PromQL and LogQL query is checked against that set
    Then every PromQL metric name the rule queries, including "rpc_server_duration_milliseconds_count" and "rpc_server_duration_milliseconds_bucket" if still present, is in the produced set
    And every LogQL stream selector the rule queries, including {service_name="analysis"} of "xstk-analysis-no-scoring" if still present, matches a log stream in the produced set

  @AC-2 @FR-2 @FR-3 @regression @feature-250
  Scenario: Every dashboard query targets a metric series or log stream that some workload produces
    Given the dashboards in packages/otel/dashboards/
    And the same produced-signal set as AC-1
    When each panel query and template-variable query is checked against that set
    Then no query references a PromQL metric name outside the produced set
    And every LogQL stream selector, including those of the LogQL panels in signal-pipeline-throughput.json, infrastructure.json, service-health.json and trading-service.json if still present, matches a log stream in the produced set

  @AC-3 @FR-4 @regression @feature-250
  Scenario: The observability docs list only the signals actually exported
    Given the FR-4 docs: docs/setup/grafana-cloud.md, docs/setup/CLAUDE.md, docs/patterns/observability.md, docs/launch-pdfs/product-features.md, packages/otel/alerts/README.md, packages/otel/dashboards/README.md, the packages/otel/otel-collector-config.yaml header comment, packages/otel/CLAUDE.md and packages/otel/docs/context-constitution.md
    And any other doc under docs/ or packages/otel/ outside docs/roadmap/ and docs/reports/
    When each states which OTLP signals the workloads emit, or which series or datasources the provisioned alerts and dashboards read
    Then each signal type it says a workload emits (traces, metrics, logs) has an exporter in every runtime's telemetry module, or the claim is scoped to the workloads that have one
    And each metric series, log stream or datasource it says an alert or dashboard reads is in, or holds, the produced-signal set of AC-1
    And docs/setup/grafana-cloud.md does not state that every workload "emits traces, metrics, and logs via OTLP" while no runtime exports metrics or logs

  # ─── otel metrics + logs export (feature 274) ──────────────────────────────
  # Feature 274 extends 226 @AC-1 (traces) to metrics and logs, and supersedes parts of 250:
  #  - 250 @AC-1/@AC-2: only their Given sentence "that set holds no PromQL metric name and no Loki log
  #    stream" is stale; their Then clauses are preserved and extended by 274 @AC-8 and @AC-14.
  #  - 250 @AC-3 is CHANGED by 274 @AC-9 (operator-signed C-16 CHANGE, 274 context.md R1 gate, 2026-10-21):
  #    the docs now state three signals. Read the 250 scenario as superseded by 274 @AC-9.

  @AC-2 @FR-2 @regression @feature-274
  Scenario Outline: Every gRPC backend records the server duration histogram with its status code
    Given <service> runs with OTEL_ENABLED="true"
    When a client calls one of its unary RPCs and the handler returns gRPC status NOT_FOUND (5)
    Then the next metric export contains a histogram data point for that method with rpc.grpc.status_code=5
    And in Grafana Cloud the series rpc_server_duration_milliseconds_count{service_name="<name>",rpc_grpc_status_code="5"} increases by 1
    And rpc_server_duration_milliseconds_bucket{service_name="<name>"} exists, which is the same series name the alert rules and dashboards query

    Examples:
      | service                | name        |
      | xstockstrat-trading    | trading     |
      | xstockstrat-portfolio  | portfolio   |
      | xstockstrat-marketdata | marketdata  |
      | xstockstrat-indicators | indicators  |
      | xstockstrat-ingest     | ingest      |
      | xstockstrat-analysis   | analysis    |
      | xstockstrat-ledger     | ledger      |
      | xstockstrat-identity   | identity    |
      | xstockstrat-notify     | notify      |
      | xstockstrat-config     | config      |

  @AC-8 @FR-6 @regression @feature-274
  Scenario: Restored alert rules query only produced series
    Given feature 250 has merged and this feature restores xstk-error-rate-high, xstk-p99-latency-high and the re-derived analysis scoring-stall rule
    When scripts/check-otel-produced-signals.sh runs in CI
    Then it exits 0
    And adding a rule that queries the unproduced metric "rpc_client_bogus_total" makes it exit non-zero

  @AC-9 @FR-7 @regression @feature-274
  Scenario: Docs state the three exported signals
    Given docs/patterns/observability.md and docs/setup/grafana-cloud.md after this feature
    When an operator reads the signal list
    Then both list traces, metrics and logs with the endpoints "/v1/traces", "/v1/metrics" and "/v1/logs"
    And the root findings row for "metrics and logs are never sent" is marked RESOLVED (feature 274)
    And the PLAT-3 row of docs/context-constitution.md names the "/v1/metrics" and "/v1/logs" exporters
    And OTEL-1 and OTEL-2 in packages/otel/docs/context-constitution.md name rpc_server_duration_milliseconds and the service_name Loki stream as produced
    And packages/otel/CLAUDE.md and the packages/otel findings row for the unproduced RPC metric state the signals as produced

  # AC-1 and AC-10 sample one runtime per language; AC-2 exercises metric export on all 10 gRPC backends.

  @AC-10 @FR-1 @regression @feature-274
  Scenario Outline: Each runtime language exports metrics with its resource attributes
    Given <service> runs with OTEL_ENABLED="true", SERVICE_NAME="<name>" and APPLICATION_ENV="staging"
    When one metric export interval elapses
    Then the collector receives a POST to "/v1/metrics" whose resource has service.name="<name>", deployment.environment="staging" and platform="xstockstrat"

    Examples:
      | service                | name       |
      | xstockstrat-indicators | indicators |
      | xstockstrat-agent      | agent      |
      | xstockstrat-notify     | notify     |
      | xstockstrat-ui         | ui         |

  @AC-11 @FR-3 @regression @feature-274
  Scenario Outline: Each runtime language bridges its logger to OTLP with trace correlation
    Given <service> runs with OTEL_ENABLED="true"
    When it logs a WARN record through <logger> inside an active server span
    Then the collector receives a POST to "/v1/logs" containing that record with severity WARN
    And the record's trace_id equals the active span's trace_id

    Examples:
      | service                | logger           |
      | xstockstrat-trading    | log/slog         |
      | xstockstrat-agent      | Python logging   |
      | xstockstrat-identity   | winston          |
      | xstockstrat-ui         | the server logger |

  @AC-14 @FR-6 @regression @feature-274
  Scenario: Restored mute timing and dashboards reference only produced series
    Given feature 250 has merged and this feature's packages/otel assets are applied
    When packages/otel/alerts/ and packages/otel/dashboards/*.json are inspected
    Then the mute timing "outside-us-market-hours" exists and is referenced by the re-derived analysis scoring-stall rule
    And the service-health dashboard's $service variable queries rpc_server_duration_milliseconds_count
    And scripts/check-otel-produced-signals.sh reports 0 panel exprs targeting an unproduced series

  # Added by /sdd-design (2026-10-21, design.md § Acceptance additions)

  @AC-15 @FR-2 @regression @feature-274
  Scenario: Python and Node RPC recorders satisfy the shared status vectors
    Given scripts/testdata/rpc-status-vectors.json with vectors "ok", "abort NOT_FOUND", "unhandled ValueError", "bare Exception", "node error without code", "node string code" and "ERROR status only"
    When each vector's span is ended through the Python recorder and through the Node recorder
    Then each recorded rpc.grpc.status_code equals the vector's expected code (0, 5, 2, 2, 2, 2, 2)
    And every histogram data point uses bucket boundaries [0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]

  @AC-17 @FR-6 @regression @feature-274
  Scenario: The guard pins the proto-derived stream exclusion on every restored selector
    Given packages/otel/alerts/alert-rules.yaml restored by this feature
    When a rule's rpc_server_duration_milliseconds_sum selector omits the rpc_method stream matcher
    Then scripts/check-otel-produced-signals.sh exits non-zero
    And adding "rpc StreamFoo(Req) returns (stream Resp);" to a proto without updating the matcher also makes it exit non-zero

  @AC-19 @FR-1 @regression @feature-274
  Scenario Outline: Metrics and logs honour the path-prefixed gateway and both header forms
    Given <service> runs with OTEL_ENABLED="true", OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:<port>/otlp" and OTEL_EXPORTER_OTLP_HEADERS="<headers>"
    When it records one metric and one log record and exports
    Then the receiver gets POST "/otlp/v1/metrics" and POST "/otlp/v1/logs", each with Authorization "Basic dGVzdDprZXk="

    Examples:
      | service                | headers                                  |
      | xstockstrat-trading    | Authorization=Basic dGVzdDprZXk=         |
      | xstockstrat-analysis   | Authorization=Basic%20dGVzdDprZXk%3D     |
      | xstockstrat-ledger     | Authorization=Basic dGVzdDprZXk=         |
      | xstockstrat-ui         | Authorization=Basic%20dGVzdDprZXk%3D     |

  @AC-6 @FR-4 @feature-283
  Scenario: The tool count is unchanged and its surfaces agree
    When the tool-count statements (tools.py, CLAUDE.md, mcp-tools.md, copilot.ts, remove-agent-postgres-mcp.feature and the /api/tools catalog) are read
    Then every statement states the count 45 (in words or digits) and the registered tool count is 45

  @AC-10 @FR-4 @feature-283
  Scenario: The score operation is documented in the runbook and the strat-lab skill
    When docs/runbooks/mcp-tools.md and plugins/strat-lab/skills/backtest/SKILL.md are read
    Then both describe manage_strategy operation "score" including its side effects, and the documented operations equal the tool's accepted operations

  @AC-1 @FR-1 @feature-278
  Scenario: A key seeded bare but read dotted is reported as a form mismatch
    Given a config migration seeds namespace "ingest" with key "mcp_client.request_timeout_seconds"
    And ingest code reads the key "ingest.mcp_client.request_timeout_seconds"
    When the wiring check runs
    Then it reports one finding of kind "form-mismatch" naming both strings

  @AC-2 @FR-1 @feature-278
  Scenario: A seeded key that no code reads is reported as unread
    Given a config migration seeds namespace "ledger" with key "stream.notify_enabled"
    And no service code reads "stream.notify_enabled" or "ledger.stream.notify_enabled"
    When the wiring check runs
    Then it reports one finding of kind "seeded-unread" for "ledger" "stream.notify_enabled"

  @AC-3 @FR-1 @feature-278
  Scenario: A key that code reads but no migration seeds is reported as unseeded
    Given ingest code reads the key "ingest.backfill.retry_on_failure"
    And no config migration seeds it
    When the wiring check runs
    Then it reports one finding of kind "read-unseeded" for "ingest.backfill.retry_on_failure"

  @AC-4 @FR-2 @feature-278
  Scenario: An execute step that seeds a key is not marked done while its key has a finding
    Given a "config" step declares the key "analysis.fundsignal.enabled"
    And the wiring check reports a finding for "analysis.fundsignal.enabled"
    When /sdd-execute validates the step
    Then the step stays not-done
    And the output names the finding and the key

  @AC-5 @FR-2 @feature-278
  Scenario: A step that touches no config key is not blocked by unrelated findings
    Given the wiring check reports a finding for "ledger.stream.notify_enabled"
    And an execute step changes only a Go handler and declares no config key
    When /sdd-execute validates the step
    Then the step is marked done

  @AC-6 @FR-3 @feature-278
  Scenario: An impl-spec with a config key but no reader step fails review
    Given a product spec lists the config key "analysis.fundsignal.enabled"
    And its implementation spec has no step naming the reader file and symbol for that key
    When /sdd-review reviews the implementation spec
    Then the review reports a failing finding for "analysis.fundsignal.enabled" requiring a reader step and a snapshot-built test

  @AC-7 @FR-4 @feature-278
  Scenario: CI fails on a new finding that is not in the baseline
    Given the baseline lists every finding recorded in feature 277's sweep, including its 18 form mismatches, each with an owner
    And a pull request seeds a key that no code reads
    When the CI wiring-check job runs
    Then the job fails and names the new finding

  @AC-8 @FR-4 @feature-278
  Scenario: A baseline entry without an owner is rejected
    Given a baseline entry for "ledger" "stream.notify_enabled" that names no owning defect or feature
    When the CI wiring-check job runs
    Then the job fails and names the entry

  @AC-9 @FR-1 @feature-278
  Scenario: A read whose key is built at runtime is reported, not skipped
    Given analysis code reads a config key built with the expression f"analysis.{name}.enabled" where "name" is a function parameter
    And no baseline entry or annotation names the key set
    When the wiring check runs
    Then it reports one finding of kind "dynamic-read" naming the file and symbol

  @AC-10 @FR-2 @feature-278
  Scenario: A migration that inserts a config row triggers the check
    Given an execute step adds a migration inserting key "analysis.fundsignal.enabled" into "config.config_values"
    And the step is not typed "config"
    And the wiring check reports a finding for "analysis.fundsignal.enabled"
    When /sdd-execute validates the step
    Then the step stays not-done
    And the output names the check result for that key

  @AC-11 @FR-3 @feature-278
  Scenario: An impl-spec reader step without a snapshot-built test fails review
    Given an implementation spec names the reader file and symbol for "analysis.fundsignal.enabled"
    And no test builds a config snapshot from the seeded key and asserts the reader returns the seeded value
    When /sdd-review reviews the implementation spec
    Then the review reports a failing finding for "analysis.fundsignal.enabled" requiring a snapshot-built test

  # Feature 286 (sops-secrets-migration): deploy-time secrets come from per-environment SOPS files; @AC-24 extends @AC-8 @feature-147.

  @AC-1 @FR-1 @FR-2 @feature-286
  Scenario: Each environment key decrypts only its own file
    Given secrets/staging.enc.yaml and secrets/production.enc.yaml produced by the bootstrap
    And the staging SOPS_AGE_KEY and the production SOPS_AGE_KEY
    When "sops -d secrets/production.enc.yaml" runs with only the staging key
    Then it exits non-zero with stderr containing "identity did not match any of the recipients" and no value is printed
    And "sops -d secrets/staging.enc.yaml" with only the staging key exits 0
    And each file's sops.age metadata lists exactly 2 recipients: the env key and SOPS_OPERATOR_AGE_RECIPIENT

  @AC-2 @FR-1 @FR-3 @FR-4 @feature-286
  Scenario: Keys land in exactly one of common, digitalocean, homelab
    Given DEV_JWT_SECRET="jwt-do", DO_DEV_PROJECT_ID="proj-9", and the staging env secret TS_AUTHKEY="tskey-x"
    When the bootstrap runs for staging
    Then the decrypted file has common.JWT_SECRET="jwt-do" and digitalocean.PROJECT_ID="proj-9"
    And the file has no homelab namespace, and "tskey-x" appears nowhere in it
    And DIGITALOCEAN_ACCESS_TOKEN, GH_PAT, BUF_TOKEN and any APP_ID appear in no namespace

  @AC-20 @FR-4 @FR-5 @feature-286
  Scenario: Bootstrap seeds only common and digitalocean
    Given the staging environment holds homelab secrets TS_AUTHKEY and APP_ENV
    When the bootstrap runs for staging
    Then the job succeeds and the decrypted file's top-level keys are exactly "common" and "digitalocean"

  @AC-5 @FR-4 @FR-7 @feature-286
  Scenario: The homelab APP_ENV is rendered so compose reads every value literally
    Given homelab.app_env = {APP_URL: "https://x.example", DB_PASSWORD: "p$w #1 \"x\""} and common.JWT_SECRET="j$t"
    When deploy-homelab.yml renders the release .env for staging
    Then `docker compose config` resolves DB_PASSWORD to exactly "p$w #1 \"x\"" and JWT_SECRET to exactly "j$t"
    And common keys are rendered after app_env keys

  @AC-6 @FR-5 @feature-286
  Scenario: Bootstrap never leaks plaintext and fails on a missing required value
    Given PROD_JWT_SECRET is unset and no other source holds it
    When the bootstrap runs for production
    Then the job fails with "JWT_SECRET is required but missing" before any commit or push
    And no plaintext value appears in the job log, any uploaded artifact, or the runner cache

  @AC-7 @FR-5 @feature-286
  Scenario: Successful bootstrap opens a single PR to main-dev
    Given both matrix jobs succeed
    When the bootstrap finishes
    Then branch chore/sops-bootstrap contains .sops.yaml, secrets/staging.enc.yaml and secrets/production.enc.yaml
    And one PR from chore/sops-bootstrap targets main-dev, authored with GH_PAT
    And every value in the committed files starts with "ENC[AES256_GCM,"

  @AC-8 @FR-6 @feature-286
  Scenario: DO deploy with no SOPS file yet behaves exactly as today
    Given secrets/staging.enc.yaml does not exist and DEV_JWT_SECRET="jwt-gh"
    When deploy-dev.yml deploys staging
    Then the substituted app spec carries JWT_SECRET "jwt-gh"
    And the step summary lists "JWT_SECRET: github" for every key

  @AC-9 @FR-6 @feature-286
  Scenario: DO deploy prefers SOPS and falls back per key
    Given secrets/production.enc.yaml has common.JWT_SECRET="jwt-sops" and no SENDGRID_API_KEY
    And PROD_JWT_SECRET="jwt-gh" and PROD_SENDGRID_API_KEY="sg-gh"
    When deploy-prod.yml deploys production
    Then the app spec carries JWT_SECRET "jwt-sops" and SENDGRID_API_KEY "sg-gh"
    And the step summary lists "JWT_SECRET: sops" and "SENDGRID_API_KEY: github"
    And the log shows "***" wherever either value would appear

  @AC-10 @FR-6 @feature-286
  Scenario: DO deploy fails closed only when a required key is in neither store
    Given CONFIG_SECRETS_ENCRYPTION_KEY is in neither secrets/staging.enc.yaml nor DEV_CONFIG_SECRETS_ENCRYPTION_KEY
    When deploy-dev.yml deploys staging
    Then the job fails with "CONFIG_SECRETS_ENCRYPTION_KEY is in neither SOPS nor the GitHub secrets"
    And the DO app's active deployment ID is unchanged after the run

  @AC-11 @FR-6 @FR-9 @feature-286
  Scenario: Prod bring-up resolves secrets the same way
    Given secrets/production.enc.yaml has common.JWT_SECRET="jwt-sops"
    When prod-up.yml runs with no existing prod app
    Then the rendered spec at $RUNNER_TEMP/app.yaml carries JWT_SECRET "jwt-sops"

  @AC-12 @FR-7 @feature-286
  Scenario: Homelab deploy no longer touches 1Password
    Given secrets/staging.enc.yaml has common.MTLS_CA and the full homelab namespace
    When deploy-homelab.yml deploys staging
    And OP_SERVICE_ACCOUNT_TOKEN is unset for the staging environment
    Then the deploy succeeds and the VM reports the new release as healthy
    And the step summary lists "sops" for TS_AUTHKEY, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, APP_ENV and MTLS_CA
    And the release .env passed to the VM contains APP_URL from homelab.app_env

  @AC-13 @FR-7 @feature-286
  Scenario: Homelab deploy falls back to the GitHub environment secret per key
    Given secrets/staging.enc.yaml lacks homelab.DEPLOY_KNOWN_HOSTS and the env secret DEPLOY_KNOWN_HOSTS is set
    When deploy-homelab.yml deploys staging
    Then the step summary lists "DEPLOY_KNOWN_HOSTS: github" and the deploy proceeds

  @AC-17 @FR-11 @feature-286
  Scenario: Deploy targets the app resolved by spec name, even after a prod recreate
    Given prod-up.yml recreated the prod app, so "xstockstrat-production" now has ID "app-new"
    And the legacy secret DO_PROD_APP_ID still holds the deleted ID "app-old"
    When deploy-prod.yml deploys production
    Then app "app-new" receives the new deployment, and the step summary shows "app: xstockstrat-production → app-new"

  @AC-21 @FR-11 @feature-286
  Scenario: Deploy fails closed when the app name does not resolve to exactly one app
    Given no DigitalOcean app named "xstockstrat-staging" exists
    When deploy-dev.yml deploys staging
    Then the job fails with "expected exactly 1 app named xstockstrat-staging, found 0"
    And no app is updated

  @AC-18 @FR-10 @FR-7 @feature-286
  Scenario: Homelab mints its mTLS leaves from the shared common CA
    Given common.MTLS_CA="caDO" in secrets/staging.enc.yaml
    When deploy-homelab.yml builds the release .env for staging
    Then MTLS_CA_CERT in the release .env is the CA certificate decoded from "caDO"

  @AC-14 @FR-8 @feature-286
  Scenario: Runbook covers the full operator lifecycle
    Given docs/runbooks/sops-secrets.md
    When an operator follows it from scratch
    Then it has sections for key generation, environment setup, bootstrap, local edit, rotation, adding a key and legacy-secret removal
    And every command is macOS/Homebrew-compatible (brew install sops age)

  @AC-15 @FR-5 @feature-286
  Scenario: Bootstrap refuses to overwrite an existing SOPS file without force
    Given secrets/staging.enc.yaml exists on main-dev
    When the bootstrap is dispatched with force=false
    Then the staging job fails with "secrets/staging.enc.yaml already exists; re-run with force=true to overwrite"
    And no branch is pushed

  @AC-16 @FR-9 @feature-286
  Scenario: Prod bring-up injects the full key set including VAPID and mTLS
    Given secrets/production.enc.yaml has common.VAPID_PUBLIC_KEY="BPub" and common.MTLS_CA set
    When prod-up.yml runs with no existing prod app
    Then the rendered spec at $RUNNER_TEMP/app.yaml contains "BPub" and no "YOUR_PROD_VAPID_" or "YOUR_PROD_MTLS_" placeholder remains

  @AC-22 @FR-6 @feature-286
  Scenario: A same-named environment secret cannot shadow the DigitalOcean fallback
    Given secrets/staging.enc.yaml does not exist, DEV_MTLS_CA="caDO", and the staging environment holds a secret MTLS_CA="caOther"
    When deploy-dev.yml deploys staging
    Then the minted leaves verify against the CA decoded from "caDO"
    And the step summary lists "MTLS_CA: github"

  @AC-23 @FR-4 @FR-7 @feature-286
  Scenario: Homelab app_env may not carry a common key
    Given secrets/staging.enc.yaml has common.JWT_SECRET="jwt-do" and homelab.app_env.JWT_SECRET="jwt-x"
    When deploy-homelab.yml resolves staging
    Then the job fails with "homelab.app_env must not contain common key JWT_SECRET"
    And neither value appears in the log

  @AC-24 @FR-6 @FR-9 @feature-286
  Scenario: MCP_AGENT_SECRET stays absent from every new deploy-secret surface
    Given scripts/do-render-app-spec.py, scripts/sops_secrets.py, .github/workflows/sops-bootstrap.yml and secrets/*.enc.yaml exist and scripts/do-inject-prod-secrets.py is deleted
    When the repository is searched for "MCP_AGENT_SECRET"
    Then there are no matches in any of those files, the deploy workflows, prod-up.yml or .do/app*.yaml

  @AC-1 @regression @feature-288
  Scenario: A superseded deployment ends the wait loop immediately instead of timing out
    Given the deployment being waited on reports phase SUPERSEDED
    When the "Wait for deployment" step polls it
    Then the step exits on that poll, well before the 60-iteration timeout, and does not print the timeout message

  @AC-2 @regression @feature-288
  Scenario: Two quick pushes to main-dev deploy the same app one at a time
    Given two pushes to main-dev land within a minute
    When both "Deploy dev" runs reach the deploy job
    Then the second run's deploy job waits for the first to finish before it starts, and neither run is red

  @AC-1 @regression @feature-287
  Scenario: A rendered app spec is attached to the database cluster's VPC
    Given cluster "xstockstrat" has private network UUID "d7afff57-f807-4893-9fbf-20fff8bb82dd"
    When the deploy workflow renders .do/app.yaml or .do/app.dev.yaml with that VPC ID
    Then the rendered spec has a top-level "vpc" block whose "id" is "d7afff57-f807-4893-9fbf-20fff8bb82dd"

  @AC-2 @regression @feature-287
  Scenario: Rendering fails closed when the VPC ID cannot be resolved
    Given the VPC ID lookup returns an empty value
    When the deploy workflow renders an app spec
    Then rendering fails with an error naming the unfilled VPC placeholder
    And no spec without a "vpc" block is sent to doctl

  @AC-3 @regression @feature-287
  Scenario: prod-up makes the new app a trusted source of the cluster
    Given "Prod — bring up" has just created app "<new id>"
    When the workflow continues after "doctl apps create"
    Then it appends the firewall rule "app:<new id>" to cluster "xstockstrat"

  @AC-4 @regression @feature-287
  Scenario: prod-down removes the trusted source it added
    Given app "xstockstrat-production" exists with a cluster firewall rule "app:<its id>"
    When "Prod — tear down" runs
    Then the firewall rule for "app:<its id>" is removed and the cluster itself is untouched

# Feature 279 (homelab-compose-deploy): homelab compose deploy target, Go health probe, migrator ahead rule.

  @AC-1 @FR-1 @feature-279
  Scenario: The release .env pins every image by digest and the compose file renders without a build or a bind mount
    Given a release .env with IMAGE_TRADING=ghcr.io/davcs86/xstockstrat/xstockstrat-trading@sha256:<64 hex> and the other 12 IMAGE_* lines
    When "docker compose --env-file .env -f deploy/homelab/compose.yml config" runs
    Then it exits 0 with 13 services, every image ends in "@sha256:<64 hex>", and no service has a "build" or a "volumes" key

  @AC-2 @FR-1 @feature-279
  Scenario: A missing required value fails the render instead of starting a half-configured stack
    Given a release .env with no DB_PASSWORD line
    When "docker compose config" runs on deploy/homelab/compose.yml
    Then it exits non-zero with "required variable DB_PASSWORD is missing a value"

  @AC-3 @FR-2 @feature-279
  Scenario: Only the UI and the agent publish ports, and every long-running service is health-checked
    Given the rendered homelab compose file
    When its published ports and healthchecks are listed
    Then the published ports are exactly 3000 (xstockstrat-ui) and 9000 (xstockstrat-agent)
    And every service except db-migrator has a healthcheck

  @AC-4 @FR-3 @feature-279
  Scenario: Stateless services go through PgBouncer and LISTEN/NOTIFY services connect directly, for staging
    Given TARGET_ENV=staging and DB_PASSWORD=pw in APP_ENV
    When the release .env is built and the compose file rendered
    Then xstockstrat-trading has DATABASE_URL "postgresql://xstockstrat_staging:pw@db.ts.natanddavehouse.com:6432/xstockstrat-staging?sslmode=require" and DB_PGBOUNCER "true"
    And xstockstrat-config has DATABASE_URL "postgresql://xstockstrat_staging:pw@db.ts.natanddavehouse.com:5432/xstockstrat-staging?sslmode=require" and no DB_PGBOUNCER

  @AC-6 @FR-5 @feature-279
  Scenario Outline: The Go healthcheck succeeds against its own SERVING health service over mTLS
    Given a <service> server on 127.0.0.1 presenting the "<service>" leaf and reporting SERVING
    When "service healthcheck" runs with the same MTLS_CERT, MTLS_KEY and MTLS_CA_CERT
    Then it exits 0

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |

  @AC-7 @FR-5 @feature-279
  Scenario Outline: The Go healthcheck fails while the server reports NOT_SERVING
    Given a <service> server on 127.0.0.1 reporting NOT_SERVING
    When the healthcheck probe runs
    Then it exits 1

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |

  @AC-8 @FR-6 @feature-279
  Scenario: APP_ENV cannot override pipeline-generated values
    Given APP_ENV contains DB_NAME=evil and IMAGE_UI=evil
    When the release .env is built for staging
    Then the rendered xstockstrat-ui image is the resolved "@sha256:" digest, DB_NAME is "xstockstrat-staging" and DB_USER is "xstockstrat_staging"

  @AC-9 @FR-6 @feature-279
  Scenario: Each service gets its own leaf from the environment's CA, intact through dotenv
    Given MTLS_CA is the base64 {ca_cert, ca_key} of "xstockstrat-homelab-staging-ca"
    When the release .env is built and the compose file rendered
    Then xstockstrat-trading's MTLS_CERT verifies against MTLS_CA_CERT, matches its MTLS_KEY, and has SAN "DNS:xstockstrat-trading", and MTLS_CA_CERT is byte-identical to the CA's ca.pem
    And the release .env file mode is 0600

  @AC-10 @FR-6 @feature-279
  Scenario: An image tag that was never built stops the deploy before anything is shipped
    Given no image ghcr.io/davcs86/xstockstrat/xstockstrat-config:doesnotexist
    When the digest-resolution step runs for tag "doesnotexist"
    Then the job fails with "not found" and the gate is never called

  @AC-11 @FR-7 @feature-279
  Scenario: Homelab deploys run beside the DO deploy only when enabled
    Given repository variable HOMELAB_STAGING_ENABLED is unset
    When main-dev is pushed
    Then the "Deploy to dev" job runs, the "Deploy to homelab staging" job is skipped and no xstockstrat-db-migrator image is built

  @AC-13 @FR-9 @feature-279
  Scenario: OTel is off on the homelab
    Given the rendered homelab compose file
    When the environment of any service is read
    Then OTEL_ENABLED is "false" and there is no otel-collector service

  @AC-16 @FR-3 @feature-279
  Scenario: Production uses its own database and role
    Given TARGET_ENV=production and DB_PASSWORD=pw in APP_ENV
    When the release .env is built and the compose file rendered
    Then xstockstrat-config has DATABASE_URL "postgresql://xstockstrat_production:pw@db.ts.natanddavehouse.com:5432/xstockstrat-production?sslmode=require"

  @AC-18 @FR-7 @feature-279
  Scenario: A push to main deploys homelab production only after a reviewer approves
    Given HOMELAB_PRODUCTION_ENABLED is "true" and the "production" environment requires reviewers
    When main is pushed
    Then "Deploy to prod" (DigitalOcean) runs immediately and "Deploy to homelab production" waits for approval

  @AC-19 @FR-7 @feature-279
  Scenario: A manual run redeploys an already-built SHA
    Given images tagged "98c78d3" exist for all 13 repositories
    When "Deploy homelab" is dispatched with environment "staging" and image_tag "98c78d3"
    Then every IMAGE_* line in the run summary is the digest of the "98c78d3" tag
    And the shipped compose.yml and release scripts are those of commit 98c78d3, and the release name starts with its 12-character SHA

  @AC-20 @FR-6 @feature-279
  Scenario: The runner joins the tailnet as an ephemeral CI node and leaves it afterwards
    Given a valid TS_AUTHKEY minted with tags tag:ci, --reusable and --ephemeral
    When the homelab deploy runs, whether it succeeds or fails
    Then the runner registers as "gha-xstockstrat-<run id>-<attempt>" and the "Leave the tailnet" step logs it out

  @AC-21 @FR-5 @feature-279
  Scenario Outline: The Go healthcheck fails when nothing listens on the service port
    Given nothing listening on 127.0.0.1:<port>
    When the <service> healthcheck probe runs
    Then it exits 1

    Examples:
      | service                | port  |
      | xstockstrat-trading    | 50051 |
      | xstockstrat-portfolio  | 50052 |
      | xstockstrat-marketdata | 50053 |

  # Covered by scripts/homelab-render.test.sh.
  @AC-22 @FR-6 @feature-279
  Scenario: APP_ENV cannot change the mode, environment or database names
    Given APP_ENV contains "APPLICATION_ENV=evil", "export TRADING_MODE=paper", "DB_USER=evil" and "DB_HOST: evil.example.test"
    When the release .env is built for production and rendered
    Then all 12 app services have APPLICATION_ENV "production" and TRADING_MODE "live", the .env contains no "evil", and the same build for staging renders "development" and "paper"

  @AC-23 @FR-2 @feature-279
  Scenario: The UI listens on all interfaces inside its container
    Given a rendered staging release
    When the xstockstrat-ui environment is read
    Then HOSTNAME is "0.0.0.0"

  # Covered by scripts/migration-ahead-check.test.sh and scripts/migration-rerun.sh pass 4 (CI job migration-rerun).
  @AC-24 @FR-4 @feature-279
  Scenario: An older migrator skips a schema a newer release already migrated
    Given marketdata's database is clean at version 9 and the migrator image's highest marketdata file is 008
    When db-migrate.sh up runs
    Then it logs "[ahead] marketdata is at version 9", exits 0 and leaves the version at 9

  @AC-25 @FR-4 @feature-279
  Scenario: An older migrator refuses a schema a newer release left dirty
    Given marketdata's database is dirty at version 9 and the migrator image's highest marketdata file is 008
    When db-migrate.sh up runs
    Then it exits 1 without running force 0, the version stays "9 (dirty)", and stderr names "force 8" and the literal "$DATABASE_URL" but no postgres:// URL

  @AC-26 @FR-4 @feature-279
  Scenario Outline: The ahead check fails closed on input it cannot read
    Given migrations directory <files> and version output "<version>"
    When migration-ahead-check.sh runs
    Then it exits 2

    Examples:
      | files            | version       |
      | 008_a, 009_b     | garbage dirty |
      | abc_x.up.sql     | 3             |
      | (empty)          | 3             |

  @AC-27 @FR-4 @feature-279
  Scenario: Zero-padded migration versions compare as decimal numbers
    Given migrations 008_a and 009_b
    When the ahead check runs with version "9" and then with version "10"
    Then it exits 0 for "9" and 10 for "10"

  # Covered by scripts/homelab-render.test.sh.
  @AC-28 @FR-6 @feature-279
  Scenario: Building the release .env leaves no CA key behind and prints no secret
    Given a target "qa", or an MTLS_CA that is not valid base64, or a CA key that does not match its certificate
    When homelab-release-env.sh runs
    Then it exits non-zero, writes no .env, leaves no file in its temp directory, and its stderr contains no input value

  @AC-29 @FR-6 @feature-279
  Scenario: The render check names each broken render and never passes an empty one
    Given the production render with one of: the agent service removed, ui HOSTNAME removed, trading TRADING_MODE "paper", a ":latest" image, an extra published port, DB_PGBOUNCER on config, a missing healthcheck, no services at all, or a non-object input
    When render-assert.jq evaluates it
    Then the output is a non-empty label list such as "services", "ui-hostname" or "trading-mode:xstockstrat-trading" and contains no environment value

  # Covered by the CI migrator-image contents step (ci.yml).
  @AC-30 @FR-4 @feature-279
  Scenario: The migrator image carries every script db-migrate.sh calls
    Given the image built from scripts/Dockerfile.migrate
    When CI inspects /repo/scripts in the image
    Then migration-dirty-guard.sh is executable and migration-ahead-check.sh is present

  # Covered by scripts/homelab-render.test.sh.
  @AC-31 @FR-6 @feature-279
  Scenario: A line compose cannot parse fails the render without printing the .env
    Given APP_ENV contains the line "BAD!KEY=SECRETPROBE"
    When homelab-render-check.sh renders the release
    Then it exits 1 and its output contains "details suppressed" and not "SECRETPROBE"

  @AC-32 @FR-6 @feature-279
  Scenario: An unclosed quote fails the render without printing the rest of the file
    Given APP_ENV contains the line BROKEN="SECRETPROBE with no closing quote
    When homelab-render-check.sh renders the release
    Then it exits 1 and its output contains neither "SECRETPROBE" nor "PRIVATE KEY"

  # Covered by scripts/homelab-render.test.sh.
  @AC-35 @FR-3 @feature-279
  Scenario: The database user and database name are distinct and checked separately
    Given the production render
    When config's DATABASE_URL user is changed to "xstockstrat-production" or its path to "/xstockstrat_production"
    Then render-assert.jq reports "direct:xstockstrat-config"

  @AC-36 @FR-3 @feature-279
  Scenario: The direct pools stay within the homelab connection budget
    Given the production render
    When config's DB_POOL_MAX is "5", or notify's DB_POOL_MAX is removed, or trading sets DB_POOL_MAX "2"
    Then render-assert.jq reports "pool-budget" (or "pool-budget:xstockstrat-trading")

  # Static workflow assertions + live evidence.
  @AC-41 @FR-7 @feature-279
  Scenario: Homelab production cannot be enabled by the staging switch
    Given HOMELAB_STAGING_ENABLED is "true" and HOMELAB_PRODUCTION_ENABLED is unset
    When main is pushed
    Then the "Deploy to homelab production" job is skipped and no xstockstrat-db-migrator image is built

  @AC-42 @FR-7 @feature-279
  Scenario: A manual production run must come from main and deploy a commit on main
    Given "Deploy homelab" is dispatched from branch "feature/foo" with environment "production"
    When the job starts
    Then it fails with "production deploys run only from main" before any secret is loaded

  # Covered by scripts/homelab-render.test.sh.
  @AC-43 @FR-3 @feature-279
  Scenario: Every app service waits on the migrator
    Given a homelab compose render where xstockstrat-config no longer depends on db-migrator
    When render-assert.jq evaluates it
    Then it reports "depends-migrator:xstockstrat-config" and "depends-migrator:xstockstrat-trading"

  @AC-7 @FR-1 @FR-2 @FR-3 @feature-282
  Scenario: Delisted or non-tradable symbols are blocked like OTC symbols
    Given DNB is absent from the loaded active and tradable asset set
    When DNB is added to a watchlist and GetBars is called for DNB
    Then DNB is reported in refused_symbols with a reason
    And marketdata makes 0 live Alpaca fetches for DNB
    And GetBars does not add DNB to the warm set

  @AC-17 @FR-3 @feature-282
  Scenario: A held offline unservable symbol stays valued and warm across later refreshes
    Given an offline account holds FORL, which is unservable and has a stored 1d close
    When portfolio values the account and a later asset-set refresh runs
    Then portfolio requests FORL through GetLatestQuotes and values it from the quote or stored close
    And FORL stays in the warm set after the later refresh

  @AC-22 @FR-1 @FR-5 @feature-282
  Scenario: An oversized servability request is rejected and portfolio lets the write through
    Given a GetSymbolServability request with 1001 symbols
    Then marketdata rejects it with InvalidArgument
    And portfolio, on any error from that call, adds the symbols and logs a WARN

  @AC-10 @FR-10 @regression @feature-295
  Scenario Outline: A silently stalled client stream is detected and recovered
    Given the <service> watcher with a liveness deadline of 30 seconds
    And its WatchConfig stream stops delivering without closing
    When 30 seconds elapse
    Then the watcher abandons the stream and redials
    And the last snapshot keeps serving reads while redialling
    And a config change made after the redial is applied

    Examples:
      | service    |
      | indicators |
      | trading    |
      | ledger     |
      | agent      |

  @AC-11 @FR-10 @regression @feature-295
  Scenario: A server that closes the stream cleanly does not cause a tight reconnect loop
    Given the config server ends every WatchConfig stream immediately after the snapshot
    When the watcher runs for 10 seconds
    Then it opens at most 5 streams
    And the delay between consecutive attempts never decreases

  @AC-13 @FR-15 @regression @feature-295
  Scenario: SDD review rejects a new config key without a complete contract
    Given a product spec whose Config Key Changes lists "trading" / "trading.order.max_retries" with no value_type, default, reader or seed migration
    When /sdd-review product-spec runs
    Then criterion 6 fails, citing the config-key contract rule

  @AC-19 @FR-13 @regression @feature-295
  Scenario: The config-wiring gate keeps only 296-owned dead rows and rejects new drift
    Given the extended scripts/check-config-wiring.mjs and scripts/config-wiring.json
    When the gate runs with --final on the feature branch
    Then it reports no failing finding and every baseline entry is a "seeded-unread" owned by "feature 296"
    And a fixture migration seeding a key no code reads fails the gate as seeded-unread
    And a fixture reader of "analysis" / "analysis.x.y" stored as "string" but read with get_int fails the gate as a type mismatch
    And a fixture getter on an unregistered receiver fails the gate as unattributed

  @AC-20 @FR-14 @regression @feature-295
  Scenario: The documented convention matches the enforced one
    Given C-05, CONFIG-9 and docs/patterns/config-governance.md after the change
    When the config-wiring gate's doc check runs
    Then each states that the stored key equals the reader's exact spelling and every read key is seeded
    And none permits unseeded read keys

  @AC-27 @FR-11 @regression @feature-295
  Scenario Outline: Every language's getters follow the uniform rule
    Given <service> stores "<key>" as int 7
    When it is read with the float getter and default 1.5
    Then the result is 7.0 with no WARN

    Examples:
      | service    | key                                   |
      | analysis   | analysis.opportunity.signal_rank_weight |
      | notify     | notify.fanout.min_confidence_threshold |
      | portfolio  | portfolio.risk.max_drawdown_pct        |
