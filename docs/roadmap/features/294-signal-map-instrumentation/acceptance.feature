Feature: signal-map-instrumentation
  As the platform operator, I want the instrumentation gaps, noisy signals and feature gauges from
  docs/repo-surveyor/signal-map-findings.md implemented as one feature, so that failures on money,
  auth and data-integrity paths become diagnosable from metrics and logs instead of being invisible
  behind an OK RPC status.

  # Instrument names are the final dotted OTel names (operator decision 5), e.g. "trading.flatten.outcome".
  # Tests read counters through an in-memory OTel metric reader and logs through the service's captured
  # log handler. Label values are the bounded vocabularies in design.md 1.4.

  @AC-1 @FR-1
  Scenario: Trading counts a flatten whose position lookup errored, separately from a flat position
    Given bracket order "ord-1" on account "acc-1" whose protection window has expired
    And the portfolio GetPosition call returns UNAVAILABLE
    When flattenAndHalt runs
    Then "trading.flatten.outcome" with outcome "lookup_error" increases by 1
    And "trading.flatten.outcome" with outcome "flat" does not change
    And the "flattenAndHalt: position lookup failed" log line has level ERROR
    And no metric attribute carries "ord-1" or "acc-1"

  @AC-2 @FR-1
  Scenario: Trading counts a flat position as expected, not as an error
    Given bracket order "ord-2" whose protection window has expired
    And the portfolio GetPosition call returns Qty 0
    When flattenAndHalt runs
    Then "trading.flatten.outcome" with outcome "flat" increases by 1
    And the "flattenAndHalt: no open position to flatten" log line has level INFO

  @AC-3 @FR-1
  Scenario: Trading counts a bracket lookup failure without creating a row
    Given a filled auto-sized entry "ord-3" with stopPrice greater than 0 and bracket orders enabled
    And GetBracketByOrderID returns a database error
    When maybeSubmitBracket runs
    Then "trading.bracket.outcome" with outcome "lookup_failed" increases by 1
    And no order_brackets row is inserted for "ord-3"
    And no alert is emitted by this branch

  @AC-4 @FR-1
  Scenario: Trading counts a ledger emit that fails after the Unavailable retry
    Given the ledger AppendEvent returns UNAVAILABLE on both attempts (appendMaxAttempts) for event type "order.filled"
    When emitLedgerEvent runs for stream "ord-4"
    Then "trading.ledger_emit" with event_type "order.filled" and outcome "failed" increases by 1
    And the "ledger emit failed" log carries stream_key "ord-4"
    And when AppendEvent instead returns UNAVAILABLE once and then succeeds, outcome "retried_ok" increases by 1

  @AC-5 @FR-1
  Scenario: Trading records the broker submit outcome as a bounded value
    Given an Alpaca account and the broker SubmitOrder returns a definite rejection "insufficient buying power"
    When the order is submitted
    Then "trading.order_submit" with broker_type "ALPACA" and outcome "rejected" increases by 1
    And no metric attribute contains the text "insufficient buying power"

  @AC-6 @FR-2
  Scenario: A loop writes one record per successful tick and none for a failed tick
    Given the trading fill poller with one candidate order and an injected clock ("now" on TradingService)
    When pollFills runs twice, and the fake GetOrder advances the clock 120 ms and returns non-terminal status "new" on call 1 and returns a broker error on call 2
    Then exactly 1 INFO record "loop tick ok" is written, with loop "fill_poller" and duration_ms 120
    And no "loop tick ok" record is written for call 2, while the WARN "fill poll: broker GetOrder failed" is written
    And pollFills calls no sleep: the injected clock advances only through the fake
    And the diff of trading.go has no hunk inside StartFillPoller

  @AC-7 @FR-2
  Scenario: Loop records use fixed loop names and loops with an existing cycle record do not double up
    Given trading, marketdata, ingest, analysis and portfolio with their background loops running
    When one successful tick of each loop completes
    Then every "loop" attribute value belongs to a fixed set of at most 8 names per service
    And no record attribute contains an account, user, symbol or order identifier
    And the analysis live loop writes only "live_loop: cycle complete" for that tick
    And trading position sync writes only "position sync cycle complete" for that tick

  @AC-8 @FR-3
  Scenario: Portfolio counts a stalled and a parked consumer event
    Given the position-sync consumer's boundedRetry handler and event "evt-9" whose handler fails with SQLSTATE 23505
    When the handler is invoked directly 5 times
    Then "portfolio.consumer.events" with consumer "position_sync" and outcome "error" increases by 4
    And "portfolio.consumer.events" with consumer "position_sync" and outcome "parked" increases by 1
    And the "event parked" ERROR names "evt-9"
    And "portfolio.consumer.events" with outcome "ok" does not change

  @AC-9 @FR-3
  Scenario: Portfolio reports an unavailable quote fetch and a skipped snapshot
    Given user "u-1" with one broker account "acc-1" that has an account_balances row, no offline accounts, and 2 positions on it with CurrentPrice 0 and source UNSPECIFIED
    And the marketdata GetLatestQuotes call blocks until its context deadline (portfolio.marketdata.quote_timeout_ms)
    When GetPortfolio is called for "u-1" and then broadcastSnapshot is invoked directly for "u-1"
    Then "portfolio.marketdata_fetch" with op "quotes" and outcome "timeout" increases by 2
    And "portfolio.snapshot" with outcome "skipped_unpriced" increases by 1
    And "portfolio.mark_source" with mark_source "none" increases by 2 for path "read" and by 2 for path "snapshot"
    And no "latest quote has no usable price" line is written
    And the RPC still returns OK

  @AC-10 @FR-3
  Scenario: A failed snapshot insert is logged instead of dropped
    Given InsertSnapshot returns a database error
    When broadcastSnapshot runs for a fully priced user
    Then "portfolio.snapshot" with outcome "db_error" increases by 1
    And an ERROR "portfolio snapshot insert failed" log contains the error message
    And the "portfolio.snapshot" ledger event is still emitted and a matching subscriber still receives the snapshot

  @AC-11 @FR-3
  Scenario: Portfolio logs one aggregated unusable-quote line per call
    Given a user whose accounts all have account_balances rows, holding 40 positions with CurrentPrice 0 and source UNSPECIFIED
    And GetLatestQuotes returns a quote for all 40 symbols, of which 12 have no mark_price and no two-sided bid and ask
    And no offline accounts exist for the user (ListOfflineAccountIdsByUser returns none)
    When GetPortfolio values the 40 positions inside an active trace span
    Then exactly 1 log line "latest quote has no usable price" is written for the call
    And it carries a trace_id and the count 12
    And "portfolio.mark_source" with mark_source "none" and path "read" increases by 12

  @AC-12 @FR-4
  Scenario: Marketdata exposes the stream give-up and the age of the last message
    Given the Alpaca stream manager with an injected clock and max reconnects 5, whose first session reads a frame at time T and then drops
    And the next 4 sessions drop before the subscription ack
    When the gauge is collected at T+30s while the stream is still reconnecting, and again after the reconnect loop gives up
    Then the first collection of "marketdata.stream.last_message_age" reports 30 seconds
    And "marketdata.stream.reconnects" with result "reconnected" increases by 4 and with result "gave_up" by 1
    And the collection after the give-up reports no sample

  @AC-13 @FR-4
  Scenario: Vendor requests are counted by bounded outcome without leaking the FMP key
    Given an FMP request that returns HTTP 429 for URL "https://fmp.example/stable/profile?symbol=AAPL&apikey=SECRET123"
    When the request passes through the FMP chokepoint
    Then "marketdata.vendor.requests" with vendor "fmp", op "profile" and outcome "http_429" increases by 1
    And "marketdata.vendor.request.duration" with vendor "fmp" and op "profile" records 1 sample
    And no metric attribute, span attribute or log line contains "SECRET123"
    And no metric attribute contains "AAPL"
    And a throttle or cap exit counts outcome "throttle" or "cap" and records no duration sample

  @AC-14 @FR-4
  Scenario: A backfill of 5 symbols with 2 failures is counted per outcome and returns as before
    Given BackfillBars with timeframe "1d" for 5 symbols where 2 fail and 1 has zero bars
    When the RPC completes
    Then "marketdata.backfill.symbols" with kind "bars" increases by 2 for "written", 1 for "empty" and 2 for "failed"
    And the response still has FailedSymbols of length 2 and a nil error

  @AC-15 @FR-5
  Scenario: The live loop counts errored pairs while still logging the registered literal
    Given a live cycle that evaluates 10 pairs where 10 raise an exception
    When the cycle ends
    Then "analysis.live_loop.pairs" with outcome "error" increases by 10
    And the log text "live_loop: cycle complete" is still written exactly once

  @AC-16 @FR-5
  Scenario: A failed portfolio drain is counted as a degraded universe
    Given the portfolio ListPositions call fails for owner "o-1"
    When the live loop drains held positions
    Then "analysis.live_loop.drain_failures" with source "held" increases by 1
    And no metric attribute contains "o-1"

  @AC-17 @FR-5
  Scenario: A fundsignal run reports its emit outcome in a summary line
    Given a scheduled scan of a 200-symbol universe where 150 symbols are scored, each at or above min_conviction_to_emit, and none was emitted earlier today
    And IngestSignal fails with UNAVAILABLE (not NOT_FOUND) for all 150
    When the fundsignal _tick runs the scan
    Then "analysis.fundsignal.signals" with outcome "failed" increases by 150
    And exactly 1 INFO "fundsignal run summary" line carries universe 200, scored 150, attempted 150, emitted 0 and emit_failed 150
    And no "loop tick ok" record with loop "fundsignal" is written for that tick
    And the run status is unchanged from today's behavior

  @AC-18 @FR-5
  Scenario: Loop error logs carry a traceback and per-component INFO moves to DEBUG
    Given a live-loop cycle that raises KeyError('x')
    And a live evaluation of a strategy whose formula has a fundamentals input
    When the handler logs the error
    Then the log record has exc_info set
    And the evaluator's "fundamentals formula=" line is emitted at DEBUG, not INFO

  @AC-19 @FR-6
  Scenario: The agent counts an mTLS fault in the auth path without changing its status
    Given MTLS_CERT is unset so mtls.secure_channel raises RuntimeError during token validation
    When a request with a bearer token reaches the MCP gate
    Then "mcp.auth.rejected" with reason "internal_error" increases by 1
    And the HTTP response status is still 401
    And the auth-path ERROR log "Unexpected error validating JWT claims" names the exception class "RuntimeError" and not the token

  @AC-20 @FR-6
  Scenario: A failed OAuth refresh is counted and logged without the token
    Given the identity RefreshOAuthToken call fails with UNAVAILABLE for refresh token "rt-secret-1"
    When POST /oauth/token with grant_type "refresh_token" is handled
    Then "oauth.requests" with grant_type "refresh_token" and outcome "upstream_error" increases by 1
    And a warning log contains the gRPC code "UNAVAILABLE"
    And no log line or label contains "rt-secret-1"
    And the response is still 400 with error "invalid_grant"

  @AC-21 @FR-6
  Scenario: Backend RPC failures are attributed to a backend and gRPC code
    Given the agent tool list_opportunities receives DEADLINE_EXCEEDED from the analysis backend
    When the tool's backend call exits its mtls.secure_channel block with that error
    Then "agent.backend.rpc_errors" with backend "analysis" and grpc_code "DEADLINE_EXCEEDED" increases by 1
    And "mcp.tool.duration" gains no new attribute key

  @AC-22 @FR-7
  Scenario: Identity separates login failure reasons without logging the account
    Given a login for "a@example.com" with a wrong password and a login for an unknown email
    When both AuthenticateUser calls fail
    Then "identity.login.failures" with reason "bad_password" increases by 1
    And "identity.login.failures" with reason "unknown_or_inactive" increases by 1
    And both responses are still code 16 "invalid credentials"
    And no log line or label contains "a@example.com"

  @AC-23 @FR-7
  Scenario: Token validation failures are classified and a missing secret logs once at ERROR
    Given ValidateToken receives an expired token, then a malformed token, then runs with JWT_SECRET unset
    When each call fails
    Then "identity.token.validate_failures" increases by 1 each for reasons "expired", "invalid" and "secret_missing"
    And exactly 1 ERROR log "ValidateToken: JWT secret missing" is written, for "secret_missing"
    And no per-call log is written for the expired and invalid cases
    And every response is still code 16 "invalid or expired token"

  @AC-24 @FR-7
  Scenario: A failed audit append is counted and timed without adding a deadline
    Given the ledger AppendEvent fails for event type "identity.user.created"
    When the audit is appended
    Then "identity.audit.failures" with event_type "identity.user.created" increases by 1
    And "identity.audit.append.duration" records 1 sample
    And the AppendEvent call still has no deadline

  @AC-25 @FR-8
  Scenario: A denied secret read is logged with the caller and a reason, never a value
    Given caller "marketdata" calls GetSecret for namespace "marketdata", key "fmp.api_key", without the "xstockstrat-marketdata" mTLS peer SAN
    When the request is denied
    Then a warn log carries callerId "marketdata", reason "peer_san_mismatch" and hadPeerSan false
    And caller "ingest" asking for that namespace and key is denied with reason "key_not_granted"
    And no log line contains a secret value

  @AC-26 @FR-8
  Scenario: A successful secret read leaves an audit line without the value
    Given caller "marketdata" presenting the "xstockstrat-marketdata" mTLS peer SAN reads existing secret namespace "marketdata", key "fmp.api_key"
    When GetSecret succeeds
    Then exactly 1 INFO "GetSecret served" line carries callerId "marketdata", namespace "marketdata", the key name and found true
    And no log line contains the decrypted value

  @AC-27 @FR-8
  Scenario: Listener health is exposed as a gauge and a reconnect counter
    Given the ledger LISTEN connection drops and reconnects after 2 seconds
    When the notifier reconnects
    Then gauge "ledger.notify.listener_up" is 0 while disconnected and 1 after reconnect
    And "ledger.notify.listener_reconnects" increases by 1

  @AC-28 @FR-9
  Scenario: Ingest records poll outcomes and keeps the slug out of labels
    Given source slug "my-feed" polled with no credential configured
    When the poll runs
    Then "ingest.source.poll" with outcome "no_bearer" increases by 1
    And a log line names slug "my-feed"
    And no metric attribute equals "my-feed"
    And source health derivation is unchanged

  @AC-29 @FR-9
  Scenario: A dedup hit is counted and no longer logs at INFO
    Given a polled signal that deduplicates against signal id 41
    When it is ingested
    Then "ingest.signal.outcome" with path "mcp_poll" and outcome "deduplicated" increases by 1
    And no INFO line "deduplicated signal" is written
    And a DEBUG line is written instead

  @AC-30 @FR-9
  Scenario: A failing job resume is logged and counted, then still raises
    Given _resume_job for job "job-7" raises a database error after setting it RUNNING
    When the task runs
    Then an ERROR log "_resume_job failed" names job "job-7"
    And "ingest.backfill.jobs" with outcome "failed" increases by 1
    And the task logs and then re-raises the same exception object

  @AC-31 @FR-10
  Scenario: Notify counts gated deliveries before any channel
    Given an alert with severity INFO below notify.fanout.min_severity 2 and Slack disabled
    When fanout dispatch runs
    Then "notify.delivery" with channel "fanout" and outcome "gated_severity" increases by 1
    And no "notify.delivery" sample has channel "slack"
    And no metric attribute carries the alert category or sourceService

  @AC-32 @FR-10
  Scenario: A failed stream write evicts the subscriber visibly
    Given 3 matching StreamAlerts subscribers and a write to subscriber "sub-2" throws
    When an alert is emitted
    Then "notify.stream.evictions" with reason "write_error" increases by 1
    And gauge "notify.stream.subscribers" reads 2

  @AC-33 @FR-11
  Scenario: A failed login is measured and logged without credentials
    Given POST /api/auth/login with an unknown email and the identity call returns Unauthenticated
    When the route handles it
    Then "ui.auth.events" with event "login_failed" increases by 1
    And an "http.server.duration" sample is recorded for route "/api/auth/login" with status 401
    And the response is still 401 {"error":"Invalid credentials"}
    And no log line or label contains the email or password

  @AC-34 @FR-11
  Scenario: Refresh and JWT-verify failures are distinguished
    Given refreshSession gets DeadlineExceeded from identity and JWT_SECRET is empty on another request
    When both are handled
    Then "ui.auth.events" with event "refresh_error" increases by 1
    And "ui.auth.events" with event "jwt_rejected" and reason "no_secret" increases by 1
    And refreshSession still returns null and verifyAccessToken still returns null

  @AC-35 @FR-11
  Scenario: The audit route reports a missing database and non-admin probes
    Given DATABASE_URL is unset and a non-admin session calls GET /config-ui/api/audit
    When the route responds
    Then a warn log records the 403
    And the response is still 403
    And with an admin session and DATABASE_URL unset the response is still 200 {"entries":[]} and a warn is logged

  @AC-36 @FR-11
  Scenario: Per-method BFF outcomes use a separate bucket-free counter
    Given the Connect dispatcher handles analysis SetOpportunityAction and it returns HTTP 500
    When the call completes
    Then "ui.bff.requests" with rpc_service "xstockstrat.analysis.v1.AnalysisService", rpc_method "SetOpportunityAction" and outcome "server_error" increases by 1
    And "http.server.duration" gains no new attribute key

  @AC-37 @FR-12
  Scenario: Every sandbox failure is counted although the RPC returns OK
    Given ExecuteFormula runs a formula that exceeds timeout_ms 5000
    When the sandbox returns exit_reason "timeout"
    Then "indicators.sandbox.executions" with exit_reason "timeout" increases by 1
    And "indicators.sandbox.duration" records 1 sample for exit_reason "timeout"
    And "indicators.sandbox.queue_wait" records 1 sample
    And a warning log carries exit_reason "timeout"
    And the RPC status is still OK
    And the "executing formula" line is written at DEBUG with its text unchanged and no INFO line is written

  @AC-38 @FR-12
  Scenario: A clean end of the config stream is logged and its age is exposed
    Given the indicators WatchConfig stream ends without raising an exception
    When the watcher loop re-issues the call
    Then an INFO "config stream ended cleanly" line records the clean end
    And gauge "indicators.config.snapshot_age" reports the seconds since the last snapshot
    And the watcher still re-issues the call immediately

  @AC-39 @FR-13
  Scenario: Template instantiation outcomes are counted in all three handlers
    Given InstantiateTemplate is called on analysis, indicators and ingest, and the analysis call returns ALREADY_EXISTS
    When the three calls complete
    Then "template.instantiate" with service "analysis" and outcome "already_exists" increases by 1
    And "template.instantiate" with service "indicators" and outcome "ok" increases by 1
    And "template.instantiate" with service "ingest" and outcome "ok" increases by 1

  @AC-40 @FR-14
  Scenario: A reconnect storm logs the first failure and every Nth, at the same retry interval
    Given the ledger notifier fails to connect 30 times in a row with reconnectDelayMs 2000
    When the failures occur
    Then fewer than 30 warn lines are written and the first failure is among them
    And only the 1st, 10th, 20th and 30th consecutive failures write a warn line, each carrying consecutive_failures
    And each retry still happens 2000 ms after the previous attempt
    And after a successful connect the next failure logs again as consecutive_failures 1

  @AC-41 @FR-15
  Scenario: No new label can carry an identifier and registered signals are untouched
    Given the full set of instruments added by this feature
    When their attribute keys are listed
    Then no key is any of user_id, email, client_id, account_id, order_id, intent_id, symbol, strategy_id, stream_key, slug, category, secret key or internal_caller
    And "rpc.server.duration", "mcp.tool.duration" and "http.server.duration" keep their names and attribute keys
    And the literal "live_loop: cycle complete" still appears in live_loop.py

  @AC-42 @FR-15
  Scenario: Telemetry is a no-op when disabled and never blocks startup
    Given OTEL_ENABLED is "false" for a service
    When the service starts and every new instrument call site executes
    Then no exception is raised and no exporter is created
    And a failing OTel initialization still lets the service start

  @AC-43 @FR-15
  Scenario: The change set adds no alert, dashboard, registry row, proto, config key or migration
    Given the diff of the integration PR against main-dev
    When changed paths are listed
    Then no file under packages/otel/alerts or packages/otel/dashboards changes
    And packages/otel/produced-signals.tsv is unchanged
    And no .proto file, config migration or database migration changes
    And the OTel produced-signal guard script passes

  @AC-44 @FR-16
  Scenario: Every deferred behavior half is recorded
    Given the Deferred behavior follow-ups table in context.md
    When it is compared with the report IDs S-01, S-02, S-03, S-08, S-09, S-13, S-14, S-15, S-16, S-22, S-25, S-26, N-02 and N-04
    Then each of those 14 IDs has exactly one row naming the deferred behavior

  @AC-45 @FR-1
  Scenario: Repeated systemic escalation is countable and the broker label covers IBKR
    Given 3 consecutive reconciliation ticks with systemic_threshold_pct 0.5 where 2 of 4 accounts error
    And an IBKR account whose SubmitOrder returns an uncertain-outcome timeout
    When escalateSystemic runs on each of the 3 ticks and the IBKR order is submitted
    Then "trading.escalation.systemic" increases by 3
    And "trading.order_submit" with broker_type "IBKR" and outcome "uncertain" increases by 1
    And fill handling for a PARTIALLY_FILLED then FILLED order is unchanged

  @AC-46 @FR-4
  Scenario: Warm-poller cache-insert failures are aggregated per cycle
    Given a warm-poller cycle over 25 symbols where cacheQuote fails for 8
    When the cycle completes
    Then exactly 1 WARN "warm poller: cache insert failures" is written with count 8 and at most 5 sample symbols
    And the per-symbol "warm poller: cache insert failed" lines are written at DEBUG, not WARN
    And the cycle still continues with the remaining symbols

  @AC-47 @FR-6
  Scenario: OAuth transaction rejects, degraded post-commit steps and onboarding lines are recorded
    Given a callback with a well-formed txn blob whose HMAC does not match
    And a non-deduplicated ingest_signal with conviction 0.9 (at or above agent.signal.alert_threshold) whose auto-alert EmitAlert fails after commit
    And a successful token exchange for user "u-9" followed by that user's first successful tool call
    When these requests complete
    Then "oauth.txn.rejected" with reason "bad_sig" increases by 1
    And "agent.degraded" with kind "auto_alert" increases by 1
    And identity's existing "OAuth code exchanged" INFO carries userId "u-9", and the agent writes 1 INFO "first successful tool call" at that user's first successful tool call with user_id "u-9" as a log field
    And no metric attribute contains "u-9"

  @AC-48 @FR-8
  Scenario: Config listener health and WatchConfig termination are exposed
    Given the config LISTEN connection drops and reconnects, and a WatchConfig subscriber call errors
    When both events happen
    Then "config.listener_up" is 0 while disconnected and 1 after reconnect
    And "config.listener_reconnects" increases by 1
    And "config.last_reload_timestamp" reports the time of the last namespace reload
    And "config.watch.terminated" with reason "client_error" increases by 1
    And the previously silent error handler writes a WARN "WatchConfig subscriber error" line with the error message and no config value

  @AC-49 @FR-10
  Scenario: Notify logs its enabled delivery channels once at startup
    Given notify starts with SLACK_WEBHOOK_URL set, SENDGRID_API_KEY unset and VAPID configured
    When startup completes
    Then exactly 1 INFO "delivery channels" line lists channels "slack,push" as enabled and "sendgrid" as disabled
    And no key or webhook value appears in the line

  @AC-50 @FR-14
  Scenario: Reconnect-log reduction applies to the indicators watcher and portfolio consumers too
    Given the indicators config stream fails 20 times in a row and a portfolio consumer reconnects after 10 graceful GOAWAY closes
    When the failures occur
    Then fewer than 20 warn lines are written for the indicators watcher and its first failure is among them
    And the 10 graceful portfolio reconnects write no ERROR line: the 1st and 10th are INFO and the other 8 DEBUG
    And when a healthy session follows the 10 graceful closes, exactly 1 INFO "stream resumed" is written with consecutive_graceful 10 and consecutive_failures 0
    And no "stream resumed" line is written unless 2 or more closes of the same kind preceded the healthy session
    And the retry interval of both stays 2 seconds (portfolio via the sleep seam, indicators via a monkeypatched asyncio.sleep in watcher.py)

  @AC-51 @FR-5
  Scenario: Live-loop triggers, cycle duration and opportunity recompute are recorded
    Given a live cycle of 60 seconds interval that sends 1 entry alert, throttles 1 exit alert and takes 1.4 seconds
    And a background full opportunity recompute that fails once
    And a fundsignal _tick whose run_once raises, and a supervised tick that raises
    When the cycle ends and the recompute finishes
    Then "analysis.live_loop.triggers" increases by 1 for trigger "entry" outcome "alerted" and by 1 for trigger "exit" outcome "throttled"
    And the unlabelled "analysis.live_loop.cycle.duration" histogram records 1 sample of about 1.4 seconds
    And "analysis.opportunity.recompute" with kind "full" and outcome "failed" increases by 1
    And the "fundsignal: cycle error" log and the supervised "tick error" log have exc_info set

  @AC-52 @FR-7
  Scenario: Identity counts code-exchange and refresh rejections by bounded reason
    Given an authorization code already redeemed once and a refresh token that is expired
    When ExchangeAuthCode and RefreshToken are called
    Then "identity.oauth.exchange_failures" with reason "replay" increases by 1
    And "identity.refresh.rejections" with kind "first_party" increases by 1
    And both responses are unchanged

  @AC-53 @FR-9
  Scenario: Ingest times polls and counts dropped items with a truncated, slug-tagged log
    Given source "my-feed" returns 5 items of which 2 have a bad direction, and one of those 2 carries a 4000-character headline
    When the poll runs
    Then the "ingest.source.poll.duration" histogram records 1 sample
    And "ingest.signal.dropped" with stage "extract" and reason "bad_symbol_direction" increases by 2
    And each extractor warning names slug "my-feed" and shows at most 200 characters of the item
    And the 3 valid items are still ingested

  @AC-54 @FR-8
  Scenario: Config denial of a global SetConfig write is attributed
    Given caller "trading-reconciliation-poller", with no admin access scope, writes "platform.trading_state" in namespace "platform" to "ACTIVE", which its grant forbids
    When SetConfig is denied
    Then the log carries internalCaller "trading-reconciliation-poller" at level error
    And the response is still PERMISSION_DENIED
    And no config value other than the target state name is logged

  @AC-55 @FR-11
  Scenario: The config-ui audit route is measured
    Given an admin session calls GET /config-ui/api/audit?limit=50 and the query takes 80 ms
    When the route responds 200
    Then an "http.server.duration" sample is recorded for route "/config-ui/api/audit" with status 200
    And the response body is unchanged

  @AC-56 @FR-15 @FR-2
  Scenario: Go server metric drop views are unchanged, no client instruments appear, and portfolio writes one record per batch
    Given each Go service's telemetry module after this feature, tested per service under GOWORK=off
    When the test reader collects, and the portfolio order-fill consumer handles 4 events within 60 seconds
    Then no rpc.client.* instrument appears, in the same reader where "portfolio.consumer.events" with consumer "order_fill" and outcome "ok" increases by 4
    And exactly 1 "loop tick ok" record with loop "order_fill" is written for the batch, not 4
    And the rpc.server.* drop views in serverMetricViews are unchanged

  @AC-57 @FR-1
  Scenario: Trading counts a NotFound position lookup as flat
    Given bracket order "ord-57" whose protection window has expired
    And the portfolio GetPosition call returns gRPC NOT_FOUND
    When flattenAndHalt runs
    Then "trading.flatten.outcome" with outcome "flat" increases by 1
    And "trading.flatten.outcome" with outcome "lookup_error" does not change
    And the "flattenAndHalt: no open position to flatten" line has level INFO

  @AC-58 @FR-14
  Scenario: A portfolio consumer's reconnect counter restarts after a quiet period
    Given a portfolio consumer with an injected clock and sleep seam that has had 3 consecutive graceful closes
    And no event is delivered between the 3rd and 4th close
    When a 4th graceful close happens 11 minutes after the 3rd
    Then that close is logged at INFO with consecutive_graceful 1
    And no "stream resumed" line is written for it
    And the retry interval stays 2 seconds

  @AC-59 @FR-1
  Scenario: Position sync still counts an account whose ledger emit failed
    Given the ledger AppendEvent fails with UNAVAILABLE on both attempts for event type "account.positions.synced"
    When syncPositions runs for account "acc-59"
    Then the "position sync cycle complete" heartbeat still counts that account in accounts_synced
    And "trading.ledger_emit" with event_type "account.positions.synced" and outcome "failed" increases by 1
