# Design: signal-map-instrumentation

**Created**: 2026-11-04
**Rounds**: 6 (full; approved; the operator overrode the 5-round cap, recorded in context.md)
**Approved by**: operator, at the final design gate, with the round-6 adversary's listed fixes applied (no round 7)
**Grounded in**: `recon.md`, `product-spec.md`, `docs/repo-surveyor/signal-map-findings.md`

Citations are `path:line` as read during rounds 3-6; step evidence cites symbols (F-09), so `/sdd-spec` re-greps them.

## Chosen Approach

### 1.0 Consumer surface (C-14)
- **Internal-only**, matching product-spec.md:108-110.
- The UI and the agent get server-side metrics and logs only. No page, route, MCP tool or response shape changes.
- Operators consume the new series and logs in Grafana Cloud through the existing OTLP export. A later feature registers them and alerts on them.
- Nothing is added to `packages/otel/` (AC-43).

### 1.1 Instruments and accessors (per language)
Every signal is an inline counter, histogram or observable gauge with **bounded enum labels**. Each one is built through a rebinding accessor inside the service's existing telemetry module:
- Go: `internal/telemetry/otel.go` (trading, portfolio, marketdata).
- Python: `app/telemetry.py` (analysis, ingest, indicators, agent).
- Node: `src/telemetry.ts` (identity, config, ledger, notify, ui).

There are no new `instruments.*` files and no cross-service library.

**Rebinding rule.**
- Go: the accessor caches the instrument keyed on `otel.GetMeterProvider()` identity, with a generation-counter fallback.
- Python: it rebinds when `metrics.get_meter_provider()` identity changes.
- Node: it follows the existing `bffMetrics.ts:13-23` rebind pattern.

So test readers installed after module import still see the instruments. The agent's existing histogram is create-once (`if self._histogram is None`, tool_metrics.py:36). It is not the precedent.

**Every record call is never-raising.**
- Go: OTel API calls do not panic.
- Python and Node: each helper wraps its body in `try/except Exception: pass` (`try/catch {}` in Node), so a metrics fault can never change control flow.

**Label keys** are constants in each telemetry module. Step 13's allowlist test asserts that every collected key is a member. The trading alert label key is `alert_kind`, not `category` (AC-41).

### 1.2 The logTickOK helper
**Go (trading, marketdata, portfolio).** Added to `internal/telemetry/otel.go`:
- `type Loop string`, a closed constant block, and an exported `Loops` slice (AC-7).
- `const LoopTickOKMsg = "loop tick ok"`.
- `func LogTickOK(ctx context.Context, loop Loop, d time.Duration, state string)`. It takes a duration rather than a start time, so the caller's clock seam controls `duration_ms`. This deliberately deviates from `(ctx, loop, start, state)`.
- `type TickThrottle struct{ last time.Time }` with `Allow(now time.Time) bool`, a 60 s leading edge.
- Trading gains a field `now func() time.Time` and a nil-safe `clock()`. This mirrors portfolio's field at portfolio_service.go:71 and `clock()` at offline_valuation.go:72-76. Tests that build a `TradingService{}` literal keep working.

**Python (analysis, ingest).** Added to `app/telemetry.py`:
- `LOOP_TICK_OK`, `class Loop(StrEnum)`, and `log_tick_ok(logger, loop, duration_ms, state=None)`. It uses `extra`, so the attributes reach the OTel LoggingHandler.

**No tick helper** in Node, the UI, indicators or the agent. The ledger notifier, the config listener and the indicators watcher are reconnect loops, not tick loops.

**Record format.** INFO `loop tick ok` with:
- `loop` (a constant), `duration_ms` (int), and optional `state` in {idle, disabled, paused, budget, skipped}. No `state` means work was done.

**Rules.**
- A tick writes no record when it failed as a whole.
- The failure rule: the denominator is "items that reached the fallible call". A tick failed when that count is > 0 and every one of them failed. A count of 0 gives `idle`, or `skipped` when items existed but none reached the call.
- "Throttled" means the 60 s leading-edge throttle per loop.
- KEPT means the existing cycle record stays and no `loop tick ok` is added.

### 1.3 FINAL per-loop tick table
| Svc | loop | Where written | No record (tick failed) when | state | cadence |
|---|---|---|---|---|---|
| trading | fill_poller | end of pollFills (trading.go:1752-1807); only production caller :1739 | `polled>0 && failed==polled`. `polled` = candidates that reach GetOrder (:1799). `failed` = GetOrder errors (:1800-1802) | `idle` if len(candidates)==0; `skipped` if len(candidates)>0 && polled==0 (every candidate hit the no-broker continue :1794-1796) | 5 s (:1730) |
| trading | reconciliation | before return in reconcileTick (:2212). `polled++` just before ListOrders (:2035-2036), after the skip continues :2024-2026, :2031-2033 | `polled>0 && systemicCount==polled`. A credential rejection after the call (:2039-2041, :2128-2130) is polled but not systemic. Return signature unchanged | `idle` if polled==0 | 60 s (:1925) |
| trading | position_sync | KEPT "position sync cycle complete" (:2360) | n/a | n/a | 300 s |
| trading | credential_health | end of checkCredentialHealth (:2757-2782). :2778 becomes `if st, _ := s.validateAndRecordCredential(...); st == int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNKNOWN) { unknown.Add(1) }`; `n = len(brokerMap)` (:2759-2768) | `n>0 && unknown==n`. INVALID counts as a completed check (credentialStatusFromError :3039-3047) | `idle` if n==0; `disabled` in a new else of `if intervalMs > 0` (:2748) | 300 s; 60 s while disabled (:2726) |
| trading | bracket_watchdog | end of checkBracketProtection (:2972-2998) | ListExpiredProtection errored (:2976-2978). Ok means the scan succeeded, not that a flatten succeeded | `idle` if 0 expired | 5 s (:2956-2960) |
| trading | order_intent_sweeper | end of sweepOrderIntents (order_intent.go:162-180) | SweepStalePending errored (:165-167), or `len(stale)>0` and every ReclaimOrphanIntent errored (:170-173). No pre-call skip exists | `idle` if 0 stale | 5 s (:112) |
| marketdata | warm_quote | new `warmQuotesOnce(ctx, symbols)` extracted from marketdata_service.go:1133-1181. The outer loop keeps the pause continue and `ticker.Reset` (:1125-1132) | registry.Get errored (:1143-1145), or the per-symbol fallback ran with fetched==0. Cache-insert failures do not fail the tick | `idle` if 0 symbols (:1139); `paused` in the outer loop (:1126-1128) | 30 s |
| marketdata | bar_ingest | KEPT "bar ingest: cycle complete" (:1338) | n/a | n/a | 300 s |
| marketdata | classification_refresh | KEPT (classification_service.go:244) | n/a | n/a | 24 h |
| marketdata | etf_flag_filler | throttled, once per dequeued item, in fillEtfFlag (etf_flags.go:123-124 -> :130) | FetchIsEtf error (:160-169). An unlabelled empty profile counts as ok | fmp_disabled/no_cap -> `disabled`; budget -> `budget` (:144-156) | event-driven |
| marketdata | quote_retention | end of runQuoteRetentionStep (:1050-1072) | DropQuoteChunksBefore errored (:1064-1067) | safety skip (:1054-1057) -> `skipped` (its WARN stays); `s.retention==nil` (:1059-1061) -> `disabled` | 1 h (:1030) |
| ingest | mcp_client | end of run_one_cycle (mcp_client_loop.py:160-181) | list_all_sources raised (:164, propagates to :197), or `attempted>0 && failed==attempted`. `failed` = poll_one_source raised (:174). The "bearer not configured" returns (:129-131, :136-138) count as attempted, not failed | `idle` if 0 mcp_client sources | 300 s |
| analysis | live_loop | KEPT "live_loop: cycle complete" (live_loop.py:345) | n/a | n/a | 60 s |
| analysis | fundsignal | `_tick` (fundsignal_loop.py:136-164). `summary = await self.run_once(..., _emit_counts=counts)` replaces the discarding call at :155; the record is written after `_advance_schedule` (:159) | the except path (:160-163); or `summary.status=="failed"` (`_abort_cycle` :680-692); or `status=="partial" && symbols_processed==0`; or `counts[0]>0 and counts[1]==counts[0]` (attempted vs emit_failed, 1.5) | `idle` if completed with 0 processed; `disabled` at :144-146; no record when not due (:139-141) or when the lock is held (:147-152) | 24 h |
| analysis | opportunity_refresh | `_opportunity_refresh_tick` (servicer.py:5961-5991), after the advance at :5990 | enumeration failed (:5973-5979), or `len(user_ids)>0` and every user failed (:5986-5987) | `idle` if 0 users; no record when not due (:5969-5971) | 24 h |
| analysis | readiness_materializer | `_readiness_materializer_tick` (:6138-6168), after :6167 | enumeration failed (:6150-6156), or `len(by_owner)>0` and every owner failed (:6161-6165) | `idle` if 0 owners; `disabled` after the advance at :6146-6149 | 24 h |
| analysis | template_intent_sweep | `_template_intent_sweep_tick` (:6199-6226), after :6225 | a new local `enum_failed` set at :6211-6213 (swallow-and-advance unchanged), or `len(intents)>0` and every intent failed (:6223-6224) | `idle` if 0 intents | 300 s |
| analysis | pnl_consumer | throttled, after `_process_with_retry` returns (pnl_pattern_consumer.py:189) | outer exception (:193-206) | n/a | event-driven |
| portfolio | order_fill, position_sync, deregistration, bracket, balance | throttled per consumer, inside `observed`/`boundedRetry` on outcome ok/acked (not parked) | handler error | n/a | event-driven |

**Loop-name counts:** trading has 5 names plus KEPT position_sync. Marketdata has 3 plus 2 KEPT. Analysis has 5 plus KEPT live_loop. Ingest has 1. Portfolio has 5 plus feature 281's prune loop. Every service is at most 8 (AC-7).

**Caveats.**
- Event-driven loops write no idle heartbeat, so staleness for them is ambiguous. This is documented, not alerted.
- A filter on `|= "loop tick ok"` misses the KEPT records.
- `position_sync` exists in both trading and portfolio, so any filter must also key on `service_name`.

### 1.4 FINAL outcome vocabulary (labels outside each closed set map to `other` unless the row says none exists)

**trading** (trading.go unless noted)
| Instrument | Labels / values -> site |
|---|---|
| trading.flatten.outcome | `no_broker` :2858-2860; `offline` :2864-2866; `order_not_found` :2872-2874; `lookup_error` = `err!=nil && grpcstatus.Code(err)!=codes.NotFound` (split from :2885; new ERROR "flattenAndHalt: position lookup failed" with account_id, symbol, error; return); `flat` = `err==nil && (position==nil‖Qty==0)` or `Code(err)==NotFound` (existing text at :2886 kept, WARN->INFO, return); `hash_error` :2912-2914; `flattened` :2941-2942; `halted` :2947 |
| trading.bracket.outcome | `lookup_failed` :3456-3460; `create_failed` :3487-3490; `created` after :3491; `resized` :3472. Not counted: the no-op at :3452-3454 and the default branch at :3473-3476 |
| trading.order_submit{broker_type, outcome} | `broker_type` = `strings.TrimPrefix(BrokerType.String(),"BROKER_TYPE_")` (ALPACA/IBKR/OFFLINE/UNSPECIFIED). Outcome comes from `submitOutcome(err error, brokerStatus tradingv1.OrderStatus) string`: `uncertain` (:714 branch); `invalid_credentials` (:724 branch with `errors.Is(err, broker.ErrInvalidCredentials)`); `rejected` (:724 branch otherwise, or `err==nil && brokerStatus==ORDER_STATUS_REJECTED`); `accepted` otherwise. Recorded at :712-713 for errors and at :744 with `alpacaStatusToProto(brokerOrder.Status)` |
| trading.ledger_emit{event_type, outcome} | counted inside `appendLedgerEvent` (:3762-3788), which also covers the direct caller at :1103. `ok` = success on attempt 1; `retried_ok` = success on attempt 2 (`appendMaxAttempts = 2`, :3752; the retry happens only on `codes.Unavailable`, :3779); `failed` = a returned error: Unavailable on both attempts, any non-Unavailable error, ctx done, or the payload-build error at :3765. "ledger emit failed" (:3804) gains `stream_key`. event_type allowlist: order.{created, approval_requested, submitted, broker_call_uncertain, broker_rejected, broker_submitted, bracket_updated, canceled, replaced, filled, partially_filled, rejected}; account.{positions.synced, positions.baseline_set, balance.synced, deregistered, halt.resumed}; reconciliation.mismatch_found; order_intent.resolved_by_reconciliation; order_intent.reclaimed_unknown (`reclaimedUnknownEventType`, order_intent.go:156, :178) |
| trading.alert_emit{alert_kind, outcome ok\|failed} | new `type alertKind string` with constants reconciliation, halt, account, bracket, approval, trade. `s.recordAlertEmit(kind, err)` sits right after each EmitAlert call and its error assignment: :1985 (reconciliation), :2237 (reconciliation, `alertErr`), :2839 (halt), :3151 (account), :3433 (bracket), :3809 (approval), :3823 (trade). The matching `Category:` lines are :1987/:2239/:2841/:3153/:3435/:3811/:3825. There is no `other` branch: every site passes a typed constant, and step 13's allowlist test guards the set |
| trading.escalation.systemic | unlabelled, at escalateSystemic entry (:2218) |

**portfolio** (portfolio_service.go unless noted)
| Instrument | Labels / values -> site |
|---|---|
| portfolio.consumer.events{consumer, outcome} | `consumer` comes from a closed `consumerLabel(name)` over the 5 names passed at :174, :1237, :1249, :1463, :1511 -> order_fill, position_sync, deregistration, bracket, balance, else other. `ok` :1305-1309; `error` :1322-1323; `parked` :1325-1328; `acked` for the ackAlways consumers (:1463, :1511). The `observed(label,h)` wrapper covers order_fill (:174) and the two ackAlways consumers; `boundedRetry` covers the other two |
| portfolio.marketdata_fetch{op="quotes", outcome} | in latestQuotesFor (:409-419): `timeout` when `qctx.Err()==context.DeadlineExceeded`, else `error` (:412-414); `ok` (:416-419). The empty set (:406-407) is not counted |
| portfolio.snapshot{outcome} | `written`; `skipped_unpriced` (:1032-1035); `db_error`. The InsertSnapshot error dropped by `_ =` at :1047 becomes `if err := ...; err != nil { slog.ErrorContext(ctx, "portfolio snapshot insert failed", "error", err); record db_error } else { record written }`. It does **not** return: the `portfolio.snapshot` ledger emit and the subscriber broadcast (:1048-1062) still run, so behavior is unchanged |
| portfolio.mark_source{mark_source, path} | `mark_source` = lower-cased MarkSource name without its prefix: broker (:474), none (:477), quote (:488), plus pickMark's values. `path` in {read, pnl, snapshot, risk}. Recorded by `observeQuotePass(ctx, positions, quotes, path)` after each production applyQuotes: offline_valuation.go:113 (read), :146 with `other` (read), :753 (pnl), :1030 (snapshot), :1094 (risk). pickMark (offline_valuation.go:240) records `path=read` right after `p.MarkSource = src` (:243) and before the `continue` (:244-246), only inside `if p != nil` (:242). `valueOffline` is pure and has no `ctx` (offline_valuation.go:203), so the pickMark add uses `context.Background()`. This is a rate, not a state |

**marketdata**
| Instrument | Labels / values -> site |
|---|---|
| marketdata.vendor.requests{vendor, op, outcome} and .request.duration{vendor, op} | shared outcome set: ok, http_429, http_4xx, http_5xx, transport, read, decode, ctx, cap, throttle, build, other. `ctx` wins whenever the request context has errored. A duration sample is recorded only when a request was sent. Sites: fmp getJSON (fmp_client.go:235-287): build :242-249, throttle :250-252, cap :253-256, transport :263-270, read :275-278, http :279-282, decode :283-285, ok :286; op in {quote, ratios, profile}. finnhub getJSON (finnhub_client.go:110-145), op in {metric, quote, profile}. edgar get (edgar_client.go:75-95), op in {tickers, companyfacts}. alpaca do() (client.go:83-92): limiter -> ctx/throttle; Do error -> ctx/transport; status -> http_*/ok; duration = time to headers; op from path (bars, quotes_latest, trades_latest, assets, dividends) |
| marketdata.stream.reconnects{result} | `reconnected` after stream.go:196 when attempts<max; `gave_up` at :198 |
| marketdata.stream.last_message_age | observable gauge, specified in 1.7 |
| marketdata.backfill.symbols{kind bars\|fundamentals, outcome written\|empty\|failed} | (r3/recon) |

**analysis**
| Instrument | Labels / values -> site |
|---|---|
| analysis.live_loop.pairs | ok, no_bars, error (live_loop.py:471-479) |
| analysis.live_loop.drain_failures{source} | signals :531-533, held :565-567, watchlist :593-595 |
| analysis.live_loop.triggers{trigger entry\|exit, outcome} | throttled :843-845; alerted after :847; alert_failed (from the `except Exception: ...; raise` wrap at :847) |
| analysis.live_loop.cycle.duration | unlabelled |
| analysis.fundsignal.signals{outcome} | `emitted` (:297); `failed` (the new else, 1.5) |
| analysis.opportunity.recompute{kind full\|retry, outcome ok\|failed} | full servicer.py:4891-4906; retry :4923-4930 |

The `_emit_ledger` swallow (live_loop.py:909-910) gets no instrument.

**agent** (app/)
| Instrument | Labels / values -> site |
|---|---|
| mcp.auth.rejected{reason} | missing_bearer (main.py:157-158); wrong_audience (auth.py:83-84); identity_unavailable (:92-94); invalid_token (:95-96); internal_error (:97-99, inside the existing except, still returns None). That ERROR log becomes `log.error("Unexpected error validating JWT claims: %s: %s", type(e).__name__, e)` so it names the exception class; the token is never logged |
| oauth.requests{grant_type, outcome} | grant_type in {authorization_code, refresh_token, other}. Outcome at oauth_server.py:250-272: `upstream_error` = AioRpcError UNAVAILABLE/DEADLINE_EXCEEDED; `invalid_grant` = any other AioRpcError; `error` = non-gRPC; `unsupported_grant_type` = :272. The bare excepts at :259 and :268 gain a WARN carrying the code name. client.exchange_auth_code (client.py:1519-1543) and refresh_oauth_token (:1546-1562) have no try, so AioRpcError propagates unwrapped |
| oauth.txn.rejected{reason} | malformed :61-62; bad_sig :64-65; decode :68-69; state_mismatch :203 |
| agent.backend.rpc_errors{backend, grpc_code} | recorded in the secure_channel wrapper (4.1). `backend` = target name minus `xstockstrat-`, clamped to {analysis, ingest, indicators, identity, config, portfolio, trading, marketdata, notify, unknown} |
| agent.degraded{kind} | alert_threshold_default (tools.py:677-679); auto_alert (:698-701); watchlist_add (:709-712); policy_default (:2609-2611) |

**identity** (src/grpc/identityServiceImpl.ts)
| Instrument | Labels / values -> site |
|---|---|
| identity.login.failures | missing_fields :135-136; unknown_or_inactive :143-144; blocked_default_admin :151-156; bad_password :160-161; internal :180-182 (also catches the getter throw via mintAccessToken :164, a declared overlap) |
| identity.token.validate_failures | missing_token :191. Classified in the catch at :202, before `callback`: `!process.env.JWT_SECRET` -> secret_missing (the getter at :113-120 throws, so read the env var, not the getter); err.name TokenExpiredError -> expired; JsonWebTokenError or NotBeforeError -> invalid; else other. Only secret_missing logs: one ERROR per process, "ValidateToken: JWT secret missing" |
| identity.oauth.exchange_failures | missing_fields :482-483; unknown_code :495; replay :497; expired :498-500; client_or_redirect_mismatch :501-503; pkce_mismatch :506-508; redeem_race :514; internal :517-519 |
| identity.refresh.rejections{kind} | first_party :217-218; oauth :534 |
| identity.audit.failures{event_type} and .audit.append.duration | in ledgerAudit.ts: the catch at :60-65; the duration wraps :55-59. event_type in the 6 user.* types (:708, :769, :830, :872, :921-922) + other |

**config** (src/grpc/)
| Instrument / log | Labels / values -> site |
|---|---|
| GetSecret denial reason (log) | `secretDenialReason(call, ns, key)` in authz.ts beside `hasSecretCallerAuthority` (:168-183), checked in order: no_caller_header, unknown_caller, key_not_granted, peer_san_mismatch. The denial log (configServiceImpl.ts:460-463) gains callerId (truncated), reason, hadPeerSan. **The gate is still driven by the boolean**; the reason is log-only and parity-tested |
| GetSecret success / DB error (log) | INFO "GetSecret served" with found false (:476) or true (:488); DB error (:489-491) -> ERROR "GetSecret DB error" |
| SetConfig denial reason (log) | no_admin_or_internal_grant (:511-517); not_owner (:519-528). With an x-internal-caller header present, :512 is raised to ERROR with internalCaller (truncated) |
| config.watch.terminated{reason} | client_error (:400-402, now logs the error message, WARN "WatchConfig subscriber error"); server_error (endSubscriber :428) |
| config.listener_up / listener_reconnects / last_reload_timestamp | specified in 1.7 |

**ledger** (src/services/eventNotifier.ts)
- ledger.notify.listener_up: 1 at :103, 0 at the top of scheduleReconnect (:131).
- ledger.notify.listener_reconnects: +1 at :106 when `reconnected` (:104).

**notify** (src/)
| Instrument | Labels / values -> site |
|---|---|
| notify.delivery{channel, outcome} | `fanout` (pre-channel gates): gated_severity fanout/fanout.ts:57, gated_conviction :65, deduped :76, dispatch_error :100-102. `slack`/`sendgrid`: sent, http_error (:130, :173), timeout (AbortError), error (:133-134, :176-177). `push`: disabled webPush.ts:87, gated_severity :93, admin_lookup_error :107-111, no_audience :113/:122, sent, pruned :173-176, error :177-178/:182, dispatch_error :135-136 |
| notify.stream.evictions{reason} | write_error (grpc/notifyServiceImpl.ts:86-88); stream_error (:143) |
| notify.stream.subscribers | gauge over `this.subscribers.size` |

Startup INFO "delivery channels" goes after index.ts:41.

**ui** (src/)
| Instrument | Labels / values -> site |
|---|---|
| ui.auth.events{event[, reason]} | login_invalid_request (api/auth/login/route.ts:9-11), login_ok (:17), login_failed (:29-31), login_error (:34-38); refresh_ok / refresh_rejected (Unauthenticated) / refresh_error in refreshSession (lib/identity.ts:14-26); refresh_missing (api/auth/refresh/route.ts:7-9); logout (logout/route.ts:10, with no failure outcome because revokeToken swallows errors, identity.ts:29-32); jwt_rejected with reason no_secret (the early return at lib/auth.ts:25) or expired/invalid (catch :28-30) |
| ui.bff.requests{rpc_service, rpc_method, outcome ok\|client_error\|server_error} | in the createDispatch finally (lib/bffShared.ts:144-148), unary only. `rpc_service` = `handler.service.typeName` verbatim (e.g. `xstockstrat.analysis.v1.AnalysisService`). `rpc_method` = `handler.method.name`. Unmatched paths (:125-127) record unmatched/unmatched/client_error. `BffSegment` gains `'auth'` (bffMetrics.ts:7) |

**ingest**
| Instrument | Labels / values -> site |
|---|---|
| ingest.source.poll{outcome} | ok; no_bearer (mcp_client_loop.py:129-131, :136-138; both returns also write WARN "mcp_client loop: source %s bearer not configured" with the slug, because today they only call `mark_source_error`, a DB UPDATE with no log); config_error (:125-126); all_items_failed (:156-157); error |
| ingest.source.poll.duration | wraps the call at :173 |
| ingest.signal.dropped{stage="extract", reason} | non_object, bad_symbol_direction, bad_conviction (extractors/mcp_client.py:27-39) |
| ingest.signal.outcome{path mcp_poll\|rpc, outcome ingested\|deduplicated\|rejected\|error} | counted at the two callers (spec in 1.14) |
| ingest.backfill.jobs{outcome="failed"} | at the `_resume_job` re-raise |

**indicators**
| Instrument | Labels / values -> site |
|---|---|
| indicators.sandbox.executions{exit_reason} and .duration{exit_reason} | values from exit_reason_map: success, timeout, memory_exceeded, runtime_error, import_blocked (servicer.py:313-319); the missing-declared-output branch (:324-337) -> runtime_error; unmapped -> other. The parameter_errors path is not counted |
| indicators.sandbox.queue_wait | brackets `async with self._sandbox_sem` (:301). "executing formula" (:292) moves to DEBUG |
| indicators.config.snapshot_age | specified in 1.7 |
| template.instantiate{service, outcome} | (r3/recon) |

### 1.5 Fundsignal counts
**Problem.** `RunFundamentalsScan` calls `self._fundsignal_loop.run_once(...)` directly without the lock (servicer.py:3921-3926). Only `_tick` takes `self._lock` (fundsignal_loop.py:153). So no instance state is used.

**Mechanism: a keyword-only sink, always aliased.** `run_once(self, force=False, dry_run=False, override_symbols=None, metadata=(), *, _emit_counts: list[int] | None = None)`. At the top of `run_once`: `counts = _emit_counts if _emit_counts is not None else [0, 0]`, meaning [attempted, emit_failed]. The increments are unconditional on `counts`, and `counts` is always passed to `_finish`. Only `_tick` passes a sink, so it can read the counts after `run_once` returns; the RPC path (`RunFundamentalsScan`) passes none and still gets a correct summary line (otherwise `attempted 0 emit_failed 0` would be logged while emits really failed).
- `attempted` counts claims newly inserted, i.e. `_emit_signal` was actually called. The increment goes right after `confirmed = False` (:274), after the `row is None` continue (:272-273).
- `emit_failed` gets a new `else:` on `if signal_id is not None:` (:285). That branch is reached when `_emit_signal` returned None (:627-628); NOT_FOUND raises (:622-626) and aborts the cycle as today. The else also does `analysis.fundsignal.signals{failed} += 1`.
- The list is updated in place at those two increments, so every return path sees the current counts, including the abort at :301-309.

**Why a sink, not a ContextVar.** The RPC task runs in its own context, so a ContextVar would also be safe. But a sink is explicit at the one call site and is not hidden ambient state. The existing tests patch `loop.run_once` with `AsyncMock` and assert only `assert_awaited_once()` / `assert_not_awaited()` (tests/test_fundsignal_loop.py:455-529). The sink stays `[0,0]`, which reads as "not failed", so they stay green.

**Summary log.** One field name everywhere: `emit_failed`. `_finish(self, run_id, status, symbols_done, calls_spent, deferred, signals_emitted=0, *, universe=None, scored=None, attempted=0, emitted=None, emit_failed=0)` (:632; summary proto :653-661). The new kwargs have defaults because `_finish` is also reached from dry-run (:207) and from `_abort_cycle` (:685); a `None` field is left out of the INFO "fundsignal run summary". The main return (:319) passes `universe=len(universe), scored=len(scores), attempted=counts[0], emitted=emitted, emit_failed=counts[1]`.

**Unchanged.** The status (:311) and the feature-260 rules: release-on-failed-emit (:298-300) and only accepted signals count in `signals_emitted` (:297).

### 1.6 Portfolio `observeQuotePass` (DRY; replaces round 4's `recordMarkSources`)
`observeQuotePass(ctx, positions, quotes, path)` runs right after each production applyQuotes call (sites in 1.4). It does two things:
1. Records `portfolio.mark_source{mark_source, path}` per position.
2. Counts the positions left at MARK_SOURCE_NONE whose symbol **is** present in `quotes`, meaning the quote was present but unusable. If that count is > 0, it writes one `slog.WarnContext(ctx, "latest quote has no usable price", "count", n, "sample_symbols", <=5)`. Because it uses `ctx`, the line carries trace_id (AC-11).

The per-position Warn at portfolio_service.go:484 is deleted. Otherwise `applyQuotes` (:471-491) is unchanged, so the parity test and its test callers are untouched. A missing quote is not "unusable": on a timeout the map is empty, so AC-9 writes no such line.

**Test-shape notes (AC-9, AC-11).** A production snapshot never runs alone: `processOrderFill` calls `checkRiskLimits` and then `broadcastSnapshot` (portfolio_service.go:382-383), so a fill-driven snapshot also adds `marketdata_fetch{timeout}` +1 and `mark_source{none,risk}` +2. AC-9's exact +2 counts hold only because its When invokes `broadcastSnapshot` directly. `GetPortfolio` routes accounts without a balance row into `offlineCandidates` (:631-637, then `GetOfflineStates` at offline_valuation.go:117-118), so AC-9 and AC-11 give every account a balance row and stub `ListOfflineAccountIdsByUser` empty (:620-624). The aggregate WARN applies only to non-offline positions; offline ones go through `pickMark` and never write it. `trace_id` appears only when the call runs inside an active span (WrapLogHandler), so AC-11 runs inside one. AC-9's timeout needs a fake that blocks until `qctx` expires: an immediate DeadlineExceeded error counts as `error` (:412-414).

### 1.7 Gauges and listeners
**marketdata.stream.last_message_age** (internal/alpaca/stream.go)
- New fields on streamManager (:60-71): `lastFrame atomic.Int64` (unix nanos) and `now func() time.Time` (nil means `time.Now`). The same `now` is used where `lastFrame` is stored and where the gauge computes the age, so tests control both ends.
- It is stored right after the read error check (:265-267), before `json.Unmarshal` (:269). A bad frame still counts as a frame.
- It is reset with `m.lastFrame.Store(0)` at `run()` entry (:166), so a restart after give-up does not report the previous session's age.
- `func (c *Client) StreamLastFrame() (time.Time, bool)` reads **through `c.streamMgr()`** (:74-80). It never reads `c.stream` outside the Once, so there is no race under `-race`. Building an idle manager never dials, because it connects only on `add` (:112-125). It reads `m.running` under `m.mu` and returns `ok = running && lastFrame != 0`. While the stream runs (including reconnecting), the gauge reports `now - lastFrame`. After the give-up, stream.go:201 sets `running = false`, so the gauge reports **no sample**: a stale age must never read as a live stream.
- The callback is registered once in cmd/server/main.go. It observes only when ok, so a lazy stream with no subscribers reports nothing.
- Residual: `running` flips true in `add` (:117-120) slightly before `run()` resets lastFrame. That window can report at most one stale age. This is accepted.

**config.listener_up / listener_reconnects / last_reload_timestamp** (configServiceImpl.ts)
- Capture `const reconnected = this.connectedOnce;` before the reload at :199, because :200 overwrites it.
- After the reload, and **only `if (this.listener === client)`**: set `listener_up = 1`, and `listener_reconnects += 1` when `reconnected`. The reload runs on pool connections, not on the LISTEN client. If the client errors mid-reload, `dropListener` has already nulled `this.listener` and set 0, so no 1 is written without a listener.
- The :202 log gains `{reconnected}`.
- `dropListener` sets 0 right after the `this.listener !== c` guard (:211).
- On the boot failure path (:203-206) the gauge stays at its initial 0.
- `last_reload_timestamp` (unix seconds) is set at the end of reloadAll (after :288) and at the end of reloadNamespace (after :310).

**indicators.config.snapshot_age** (app/config/watcher.py)
- `self._snapshot_at = time.monotonic()` at :82. The gauge reports `monotonic() - _snapshot_at`, and nothing before the first snapshot.
- One counter `self._consecutive` serves both the FR-14 failure path and the clean-end path. It resets at :82 when a snapshot arrives.
- Clean end (after the `async for` exits normally, after :88, inside the try): `_consecutive += 1`, and INFO "config stream ended cleanly" only when the counter is 1 or a multiple of 10. The loop still re-issues immediately.
- Failure (the except at :89-91): `_consecutive += 1`, and the WARN at :90 only when the counter is 1 or a multiple of 10, carrying the count. The `asyncio.sleep(2)` at :91 is unchanged.

### 1.8 Portfolio consumer + FR-14 (corrected code; replaces portfolio_service.go:191-239)
```go
const (
	streamRetryDelay  = 2 * time.Second
	streamLogEvery    = 10
	streamQuietWindow = 10 * time.Minute
)

func (s *PortfolioService) consumeEventStream(ctx context.Context, name, eventType string, handle eventHandler) {
	var lastSeq int64
	var failures, graceful int
	var lastClose time.Time
	onHealthy := func() {
		if failures >= 2 || graceful >= 2 {
			slog.InfoContext(ctx, name+" stream resumed", "consecutive_failures", failures, "consecutive_graceful", graceful)
		}
		failures, graceful = 0, 0
	}
	for {
		next, err := s.streamEventsFrom(ctx, eventType, lastSeq, handle, onHealthy)
		lastSeq = next
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			now := s.clock()
			if !lastClose.IsZero() && now.Sub(lastClose) > streamQuietWindow {
				failures, graceful = 0, 0
			}
			lastClose = now
			if isGracefulStreamClose(err) {
				graceful++
				lvl := slog.LevelDebug
				if graceful == 1 || graceful%streamLogEvery == 0 {
					lvl = slog.LevelInfo
				}
				slog.Log(ctx, lvl, name+" stream disconnected, reconnecting", "resume_from_sequence", lastSeq+1, "consecutive_graceful", graceful)
			} else {
				failures++
				lvl := slog.LevelDebug
				if failures == 1 || failures%streamLogEvery == 0 {
					lvl = slog.LevelError
				}
				slog.Log(ctx, lvl, name+" stream error, retrying", "error", err, "consecutive_failures", failures)
			}
			s.sleepFor(streamRetryDelay)
		}
	}
}

func (s *PortfolioService) streamEventsFrom(ctx context.Context, eventType string, lastSeq int64, handle eventHandler, onHealthy func()) (int64, error) {
	healthy := false
	markHealthy := func() {
		if !healthy && onHealthy != nil {
			healthy = true
			onHealthy()
		}
	}
	// :213-223 unchanged
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			markHealthy()
			return lastSeq, nil
		}
		if err != nil {
			return lastSeq, fmt.Errorf("recv: %w", err)
		}
		if err := handle(ctx, event); err != nil {
			return lastSeq, fmt.Errorf("handle event seq %d: %w", event.Sequence, err)
		}
		markHealthy()
		if event.Sequence > lastSeq {
			lastSeq = event.Sequence
		}
	}
}
```

**What is preserved.**
- `lastSeq = next` (:195) and the resume-from-sequence invariant (:189-190).
- The whole classify / count / log / sleep block sits inside the existing `if err != nil { if ctx.Err() != nil { return } ... }`.
- The EOF path (`err == nil`, :226-227) is exactly as today: no counter change, no log, no sleep, immediate re-dial. Its only addition is `markHealthy()` inside `streamEventsFrom`.
- `s.sleepFor` is a new field `sleep func(time.Duration)`. Nil means `time.Sleep`, so production timing is unchanged.
- The quiet window only resets counters. It never changes the sleep.

**Verified outputs against this code.**
| Case | Result |
|---|---|
| Park (position_sync, SQLSTATE 23505) | Attempts 1-4 return the handler error (not graceful): ERROR at failures==1; failures 2-4 at DEBUG. Attempt 5: boundedRetry writes the "event parked" ERROR (:1325, always) and returns nil (:1328). `markHealthy` -> "stream resumed" with consecutive_failures 4. |
| AC-8 (handler driven directly ×5) | `{position_sync,error}` +4, `{parked}` +1, `{ok}` unchanged. The stream loop is not involved. |
| AC-50 (portfolio half) | 10 graceful closes: closes 1 and 10 at INFO, 2-9 at DEBUG, no ERROR, every sleep 2 s through the seam. The following healthy session writes "stream resumed" with consecutive_graceful 10 and consecutive_failures 0. |
| Flap | One code-13 destroy gives failures=1 (ERROR), then a healthy session: no "resumed" line, counters reset. A single GOAWAY gives graceful=1 (INFO, same as today's :201), then healthy: no line. |
| Down ledger | Unavailable every 2 s counts as graceful: INFO at 1, 10, 20, ... (about every 20 s). It never goes silent, and the quiet window never fires at a 2 s spacing. |
| Idle consumer (closes > 10 min apart) | Each close resets first and counts as graceful=1, so it logs INFO exactly as today. A long-quiet consumer never sits mid-count. |
| ackAlways consumers | The handler always returns nil, so failures come only from the transport. The first event marks the session healthy. |

### 1.9 Agent wrapper and test strategy
`mtls.secure_channel` (app/mtls.py:37-43):
- It still calls `channel_credentials()` eagerly (test_mtls.py:122 still raises), then returns `_CountingChannel(inner, backend)`.
- `__aenter__` returns `await inner.__aenter__()`.
- `__aexit__`: if `exc` is an `AioRpcError`, it runs `try: tool_metrics.record_backend_rpc_error(backend, exc.code()) except Exception: pass`. It then awaits `inner.__aexit__(...)` and returns False, so the exception is never suppressed or replaced.
- `__getattr__` passes through.
- All 72 call sites use `async with`.

**Known effects.**
- An error caught inside the `async with` block is not counted.
- Errors that callers handle are counted, including the oauth identity calls. The same failure also counts `oauth.requests`: a declared double view.

**Tests** (tests/test_mtls_backend_errors.py, new). All patch the `grpc.aio.secure_channel` attribute that mtls.py:39 calls, and never patch `app.client.mtls`.
- (a) A raised AioRpcError(DEADLINE_EXCEEDED) gives +1, and `pytest.raises` returns the same object.
- (b) AC-21 end to end: a loopback analysis fake with `lambda ep, _creds, options=None: grpc.aio.insecure_channel(ep)`. It does not use conftest.py:124-126 or :197-199, which bypass the wrapper.
- (c) A non-RPC exception gives no count, with a positive control in the same reader.
- (d) A raising accessor still lets the original exception propagate.

### 1.10 Log-helper spec (FR-14 throttles and aggregates)
- **Reconnect throttles:** log the first failure and every 10th (N=10) in portfolio (1.8), ledger eventNotifier, and indicators (1.7). Retry intervals are unchanged.
- **Ledger placement (eventNotifier.ts).** One new field `private consecutiveFailures = 0` covers both WARNs. The connect-failed catch (:119-120) increments it for every failed attempt. The client `error` handler (:92-93) increments it **only when `this.client === client`**, checked before `scheduleReconnect` nulls it at :131; `this.client` is set at :103 only after LISTEN succeeds, so the handler counts only drops of an established listener and one failure is never counted twice, whichever way node-pg emits its events. Each site logs only when `n === 1 || n % 10 === 0`, with `consecutive_failures: n`. The counter resets to 0 at :103 right after `this.client = client` on a successful connect. `scheduleReconnect` and the `reconnectDelayMs` timing (:130-136) are unchanged.
- **Aggregates:** one line per call/cycle with a count and at most 5 sample symbols:
  - portfolio "latest quote has no usable price" (1.6);
  - marketdata "warm poller: cache insert failures" (WARN). The per-symbol "warm poller: cache insert failed" (:1152, :1173) stays at DEBUG.
- **Truncation:** items in ingest extractor logs to 200 characters, tagged with slug. Caller ids in config logs to 64 characters.
- **Where secrets and ids go:** never in labels, only in log fields. Never a secret value.
- **ui serverLog** uses the existing camelCase key `traceId` (config-ui/api/audit/route.ts:70). The divergence from the doc's `trace_id` is recorded.

### 1.11 Steps (red before green, SEV-2 first; step evidence cites symbols, not lines)
| # | Step | Tests | Files |
|---|---|---|---|
| 1 | Library: accessors, label-key constants, LogTickOK/TickThrottle/log_tick_ok | RED first: the accessor is stubbed to return a no-op, so the test fails on an assertion, not a compile error. Go rebind tests run without t.Parallel, with their own provider and a cleanup restore. Python: no duplicate-instrument warning; extra->attributes; rebind after otel_reset; characterize live_loop.py:78-81. Node: an active span survives queueMicrotask; CollectingReader rebind | the 12 telemetry modules (trading/portfolio/marketdata `internal/telemetry/otel.go`; agent/analysis/indicators/ingest `app/telemetry.py`; config/identity/ledger/notify/ui `src/telemetry.ts`) + one new test per module |
| 2 | Trading: characterization tests (checkCredentialHealth and the tick bodies), then the clock seam, flatten split (AC-1, AC-2, AC-57), bracket/submit/ledger/alert/escalation counters, tick records | AC-1..AC-7, AC-45, AC-57, AC-59 | services/xstockstrat-trading/internal/service/trading.go, order_intent.go; new internal/service/trading_telemetry_test.go |
| 3 | Portfolio: consumerLabel, counters in boundedRetry/observed, observeQuotePass (+ deletion of :484), pickMark record, snapshot outcomes + insert ERROR, FR-14 (1.8), consumer ticks | AC-8..AC-11, AC-50 (portfolio half), AC-56, AC-58 | services/xstockstrat-portfolio/internal/service/portfolio_service.go, offline_valuation.go, **portfolio_sync_retry_test.go (:73, :80 pass `nil`), portfolio_fill_errors_test.go (:155 passes `nil`)**; new internal/service/portfolio_telemetry_test.go |
| 4 | Marketdata: warm-poller characterization, warmQuotesOnce + aggregate, 4 vendor chokepoints, stream gauge/reconnects, backfill, filler and retention ticks | AC-12..AC-14, AC-46 | internal/service/marketdata_service.go, etf_flags.go; internal/alpaca/stream.go, client.go; internal/fmp/fmp_client.go; internal/finnhub/finnhub_client.go; internal/edgar/edgar_client.go; cmd/server/main.go; internal/service/marketdata_service_test.go; new internal/alpaca/stream_metrics_test.go |
| 5 | Analysis: _emit_alert characterization then the raise-wrap, live-loop counters, fundsignal sink + summary + tick, servicer ticks, exc_info, N-06 demotion. Stays out of feature 215's regions (live_loop.py:733-760, :876-891) | AC-15..AC-18, AC-51 | app/engine/live_loop.py, app/engine/fundsignal_loop.py, app/handlers/servicer.py, app/engine/pnl_pattern_consumer.py, **app/supervision.py** (exc_info on the seed error :45 and tick error :54), **app/services/evaluator.py** (the "fundamentals formula=" INFO at :613-614 moves to DEBUG), tests/test_fundsignal_loop.py; new live-loop/servicer tick tests |
| 6 | Agent: wrapper, auth/oauth/txn/degraded, onboarding | AC-19..AC-21, AC-47 | app/mtls.py, app/tool_metrics.py, app/auth.py, app/main.py, app/oauth_server.py, app/tools.py; new tests/test_mtls_backend_errors.py; tests/conftest.py only if a 2nd consumer forces a fixture (C-13) |
| 7 | Identity | AC-22..AC-24, AC-52 | src/grpc/identityServiceImpl.ts, src/grpc/ledgerAudit.ts; services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts (ledgerAudit has no client injection seam, so the audit test mocks the module) |
| 8 | Config + ledger: secretDenialReason with a parity test (`reason!==null` ⇔ `!hasSecretCallerAuthority` over the grant fixtures), audit INFO, listener/watch instruments, ledger FR-14 | AC-25..AC-27, AC-40, AC-48, AC-54 | config src/grpc/authz.ts, src/grpc/configServiceImpl.ts, config src/__tests__/configServiceImpl.test.ts and src/__tests__/secretCallerAuthz.test.ts (parity test); ledger src/services/eventNotifier.ts, ledger src/__tests__/eventNotifier.test.ts (test with a fake client that only rejects connect, and one whose established client emits `error`) |
| 9 | Notify | AC-31, AC-32, AC-49 | src/fanout/fanout.ts, src/fanout/webPush.ts, src/grpc/notifyServiceImpl.ts, src/index.ts; src/__tests__/fanout.test.ts, src/__tests__/notifyServiceImpl.test.ts |
| 10 | UI | AC-33..AC-36, AC-55 | src/lib/bffShared.ts, bffMetrics.ts, identity.ts, auth.ts; src/app/api/auth/{login,refresh,logout}/route.ts; src/app/config-ui/api/audit/route.ts; vitest under src/lib/** with fixtures from e2e/fixtures/ (C-12) |
| 11 | Ingest: McpClientInput.slug, cycle counts, signal-outcome at callers (1.14), _resume_job re-raise, N-01 | AC-28..AC-30, AC-53 | app/engine/mcp_client_loop.py, app/handlers/servicer.py, app/extractors/base.py, app/extractors/mcp_client.py, tests/test_mcp_client_loop.py |
| 12 | Indicators: sandbox instruments, watcher (1.7) | AC-37, AC-38, AC-50 (indicators half) | app/handlers/servicer.py, app/services/sandbox.py (only if exit-reason plumbing needs it), app/config/watcher.py, tests/test_config_watcher.py |
| 13 | Final pass | per-service allowlist tests: collected keys must be a subset of the module's key constants, and a MIN instrument-name set must be present (reached through the step harnesses; gauges by register-then-collect). The MIN set includes the 6 gauge/listener instruments and marketdata.stream.reconnects. Also: AC-41..AC-44 (AC-43 diff-path check), check-otel-produced-signals.sh, lint, coverage | each touched service's CLAUDE.md (fixed invariants: services/xstockstrat-{trading,portfolio,marketdata,analysis,agent,identity,config,ledger,notify,ingest,indicators,ui}/CLAUDE.md); context.md Deferred table (AC-44); context-constitution refresh (teardown) |

**Cross-step rule.** Before any demotion, re-grep alerts, dashboards and tests. Already re-grepped:
- portfolio :201: unpinned;
- indicators watcher.py:90: unpinned (test_config_watcher.py:217 asserts ERROR only);
- portfolio :484: unpinned;
- trading :2886: unpinned.

Coordinate with features 215/243/281 through merge-order.md.

### 1.12 NEW or changed log literals
- "loop tick ok" (Go, Python).
- "flattenAndHalt: position lookup failed" (ERROR). "flattenAndHalt: no open position to flatten" moves WARN->INFO.
- "<name> stream resumed" (INFO). The :201 and :203 texts are kept and gain counters; their levels follow 1.8.
- "portfolio snapshot insert failed" (ERROR).
- "latest quote has no usable price": text kept, now one aggregate per pass with a trace_id.
- "warm poller: cache insert failures" (WARN aggregate). The per-symbol line goes to DEBUG.
- "fundsignal run summary" (INFO).
- Agent: "first successful tool call" (INFO) and the oauth grant-failure WARN.
- Identity: "ValidateToken: JWT secret missing" (ERROR, once per process).
- Config: "GetSecret served" (INFO), "WatchConfig subscriber error" (WARN), "GetSecret DB error" (ERROR).
- Notify: "delivery channels" (INFO), "StreamAlerts subscriber evicted" (WARN).
- UI: login/refresh/audit 401/403/missing-DB serverLog lines.
- Ingest: "_resume_job failed" (ERROR); extractor drop logs gain slug and a truncated item.
- Ingest: "mcp_client loop: source %s bearer not configured" (WARN, with the slug).
- Agent: the ERROR "Unexpected error validating JWT claims" gains the exception class name (text prefix kept).
- Indicators: "config stream ended cleanly" (INFO, throttled N=10) and the sandbox non-success WARN. "executing formula" moves to DEBUG.

### 1.13 Named fixed invariants (code constants, not config keys; F-07)
- tick throttle 60 s;
- FR-14 N=10 (portfolio, ledger, indicators);
- **portfolio quiet window 10 minutes** (`streamQuietWindow`; resets counters only, never timing);
- portfolio retry 2 s (`streamRetryDelay`, today's literal at :205);
- 5 sample symbols per aggregate;
- 200-character item truncation;
- 64-character caller-id truncation;
- onboarding seen-set cap 10000;
- the loop cadences listed in 1.3.

Precedents: etfFlagLogEvery/etfFlagTTL, _LOOP_ERROR_BACKOFF_SECONDS, quoteRetentionInterval.

### 1.14 Ingest signal outcome (spec)
**Helper.** `_record_signal_outcome(path, outcome)` and a classifier beside the exception classes in servicer.py. The helper is never-raising. A metrics exception inside the per-item try (mcp_client_loop.py:147-154) would otherwise turn an ingested item into a skipped one.

**RPC path** (IngestSignal :970-981):
- success -> `deduplicated` or `ingested`;
- `_SignalValidationError` / `_SignalSourceNotFound` -> `rejected`;
- `_SignalIngestError` -> `error`;
- new `except Exception: record("rpc","error"); raise`, so propagation is unchanged.

**Loop path:** :148 becomes `_sid, dedup = await servicer._ingest_external_signal(...)` with the same mapping; any other exception -> `error` inside the existing except at :150.

**Why the 2-tuple unpack is not a behavior change:**
- it sits inside the per-item try;
- the real function is typed `-> tuple[int, bool]` (:984-986);
- every mock returns a 2-tuple or raises;
- the only callers are :970 and :148.

**No `path` kwarg.** test_mcp_client_loop.py:192's spy would TypeError on one.

**McpClientInput** gains `slug: str = ""` (base.py:43-46). The loop passes slug at :142.

## Rejected Alternatives
- Gauge-based loop liveness: a stale gauge can't tell "stopped" from "idle", and it adds a series per loop. Rejected for a log record per tick.
- Strict "no WARN in the tick" rule: per-item WARNs inside healthy ticks would hide liveness. Rejected for the "every item that reached the fallible call failed" rule.
- Tick rule driven by a value the body returns: it changes tick-body signatures and their tests. Rejected for counters local to the body.
- Contextvar, stamp or static-map backend attribution in the agent: action at a distance and fragile across tasks. Rejected for the secure_channel wrapper.
- New `instruments.*` files per service: they duplicate the existing telemetry modules (C-18 DRY).
- `applyQuotes(ctx, path)` signature change: churns three test callers and the parity test. Rejected for `observeQuotePass`.
- `path` kwarg on `_ingest_external_signal`: breaks the spy at test_mcp_client_loop.py:192.
- Instance state `_last_emit` for fundsignal: the RPC path runs `run_once` without the lock (servicer.py:3921-3926), so it races.
- ContextVar for fundsignal counts: workable, but hidden ambient state. Rejected for the explicit keyword-only sink.
- Hand-typed tick logs at each call site: literal drift. Rejected for one LogTickOK/log_tick_ok per language.
- `rpc.client.*` drop views: speculative (YAGNI). AC-56 asserts the absence instead.
- Letting `secretDenialReason` drive the GetSecret gate: it edits a security decision. The boolean stays authoritative and the reason is log-only plus a parity test.
- Dropping the portfolio recovery INFO: a park sequence would have no closing signal. "stream resumed" is kept.
- A return value from `streamEventsFrom` as the health signal: it arrives only at session end. Rejected for the `onHealthy` callback (operator-acknowledged).
- Resetting the counters when StreamEvents opens: that also happens on every handler-error redelivery, which defeats the throttle.

## Open Risks
- [ ] Go provider-identity rebind could miss a provider swap: step 1.
- [ ] Python LoggingHandler mapping of `extra` -> attributes: step 1.
- [ ] Node AsyncLocalStorage survives queueMicrotask: steps 1, 9.
- [ ] Alpaca read and decode are not counted: they happen in 8 callers, not in do(). Declared: step 4.
- [ ] The stale-age window between `add` setting running and `run()` resetting lastFrame (at most one stale sample): step 4.
- [ ] The indicators AC-50 test monkeypatches the process-global `asyncio.sleep`: step 12.
- [ ] Full-history replay at boot (lastSeq=0) inflates `consumer.events{ok}` on every deploy: note for the alerting feature.
- [ ] Agent counts include errors callers handle, including the oauth identity double view: step 6.
- [ ] The onboarding seen-set is in memory and capped: step 6.
- [ ] The AC-12 clock seam adds a `now` field to streamManager; the `lastFrame` store and the gauge read must both use it: step 4.
- [ ] The new ingest WARN "mcp_client loop: source %s bearer not configured" repeats every 300 s per credential-less source; accepted, it is the only log for that state: step 11.
- [ ] Ledger counter: whether real node-pg emits `error` on the client during LISTEN is recorded by the step-8 test; the `this.client === client` guard makes the count correct either way: step 8.
- [ ] EOF counts as a healthy session (counters reset). A ledger that EOFs immediately and repeatedly would never throttle, but it would also log nothing, since the EOF path writes no log: step 3.
- [ ] Logout has no failure outcome: step 10.

## Constitution Rules Touched
| Rule | How honored |
|---|---|
| C-02 | Every step reloads context.md; this design gets a context.md decision entry. |
| C-08 | Every service step names its tests (1.11) and the CI thresholds apply. |
| C-10(b) | Valuation stays parity-tested; applyQuotes is unchanged and observeQuotePass runs at every production site. secretDenialReason has a parity test against the gate. |
| C-12 / C-13 | Mocks come from the fixture homes: UI e2e/fixtures; Python conftest.py; Go internal/testdata on the 2nd consumer; Node src/__tests__/fixtures on the 2nd consumer. |
| C-14 | Internal-only, stated in 1.0. |
| C-15 | IDs are append-only: AC-57, AC-58 and AC-59 are added and existing IDs are amended in place, each with a context.md note. Every AC maps to a step. |
| C-16 | See the section below; no CHANGE. |
| C-18 | Reuses the telemetry modules, the clock seam and the bffMetrics pattern. The trade-offs are recorded: the `observeQuotePass` dual duty, the sink kwarg, typed alert constants. |
| F-02 / F-03 | There are no step PRs and no `feature/<slug>` branch. By operator decision (recorded in product-spec.md, feature.md and context.md), `/sdd-execute sequential` runs on the recorded Development Branch `ccr-b4aace27-zvuaby`, one commit per step; the integration PR is #1427 into main-dev. F-02 is honored because nothing is pushed straight to main-dev; F-03 is vacuous because step PRs do not exist. `/sdd-execute` logs this as a deviation. |
| F-04 | Cites are from files read; unverified items are marked. |
| F-07 | Every threshold is a named fixed invariant; there are no new config keys. |
| F-08 | Each step lists **Files**, including the test callers and CLAUDE.md files. |
| F-09 | Rebase drift goes to the Deviation Log. |
| P-01 / P-02 | This proposer is read-only and orchestrator-mediated. |
| P-03 | Gaps (AC-11 trace_id, AC-12 clock seam, AC-28 log literal) were surfaced and ruled on, not guessed around. |
| P-04 / P-05 | Gate approval and incremental context.md writes are owned by the orchestrator. |
| P-06 | Each step opens RED (stubbed accessor, characterization tests). |

## Business Rules Touched (C-16)
**PRESERVE**
- Platform `@AC-2/@AC-15/@AC-10/@AC-11 @feature-274`: `rpc.server.duration` is unchanged and new logs keep trace_id. The aggregate is now emitted with ctx.
- `@AC-1/@AC-2 @feature-171`: no `trading_mode` label anywhere.
- `@AC-8/@AC-14/@AC-17 @feature-274`: the guard script must pass (step 13).
- `@AC-35/@AC-6/@AC-36 @feature-224`, `@AC-5 @feature-210`, `@AC-8 @feature-147`, `@AC-6 @feature-283`: no bearer or secret plaintext, the header trio is unchanged, no new tool.
- S/trading `@AC-1..3 @feature-206`, `@AC-1..9 @feature-267`, `@AC-1..7 @feature-169`: no new halt or page, and the order ERROR logs are untouched.
- S/portfolio "batch latest quotes unavailable" (:413 untouched) and "evt-1 is parked with an error log": the park ERROR at :1325 is never throttled (1.8).
- `@AC-7 @feature-255` (budget reset) and the listed marketdata WARN literals.
- S/analysis `@feature-259/260/156/158`: timing, status and counts are unchanged. The fundsignal status at :311 and the release-on-fail rule at :298-300 are untouched. The demotion avoids the named-WARN rules.
- S/agent `@AC-11/@AC-5/@AC-10 @feature-273`, `@AC-21 @feature-274`: `_grpc_error_message` is untouched and no label is added to `mcp.tool.duration`.
- S/identity, S/config `@feature-274`: no plaintext.
- S/ledger `@AC-5/@AC-10 @feature-258`, `@AC-4 @feature-274`.
- S/notify `@AC-4/@AC-6 @feature-020`.
- UI: the 401-redirect rule, agent-health 401 and the audit route's generic 500.

**EXTEND**
- S/marketdata `@AC-8 @feature-255`: `reconnects{gave_up}` sits beside the closed channel and the ERROR.
- S/config `@AC-1/@AC-9/@AC-2/@AC-8 @feature-258`: listener gauges are guarded on `this.listener === client`, plus `watch.terminated`.
- S/ui `@AC-16 @feature-274`: auth and audit routes join `http.server.duration`.

**CHANGE:** none.

## Acceptance scenario amendments (C-15)

`acceptance.feature` is the final text (AC-1..AC-59). IDs are stable and amended in place; AC-57, AC-58 and AC-59 are new. Each change has a note in `context.md`.

| AC | Change |
|---|---|
| AC-1, 2, 5, 10, 52 | Labels renamed to the 1.4 vocabulary. AC-2 holds via the flatten split; the NotFound case is AC-57 |
| AC-3 | Given adds the `stopPrice > 0 && enabled` guard (trading.go:3452) |
| AC-4 | Two attempts (`appendMaxAttempts = 2`); `retried_ok` clause; the syncPositions heartbeat clause moved to AC-59 |
| AC-6 | Candidate stays non-terminal on call 1; diff check is "no hunk inside StartFillPoller" |
| AC-8, 9, 11 | Direct handler invocation; blocking fake, balance rows, no offline ids, direct `broadcastSnapshot`; trace span; NON-offline positions only |
| AC-12 | Injected clock on the stream manager; after the give-up the gauge reports no sample |
| AC-13, 17, 18, 19, 20, 21, 23, 25, 26 | Narrowed assertions, error codes and Given preconditions per the round-6 table (e.g. non-NOT_FOUND UNAVAILABLE for AC-17, peer SAN for AC-26, exception class name for AC-19) |
| AC-28 | Needs the new WARN literal in 1.4/1.12 |
| AC-34, 36, 40, 45, 46, 47, 50, 51, 53, 54, 56 | Wording aligned to the vocabulary and code (see acceptance.feature) |
| AC-57 | NotFound position lookup counts as `flat` |
| AC-58 | Portfolio consumer counters reset after a 10-minute quiet window; no event between the closes |
| AC-59 | Position-sync heartbeat still counts an account whose ledger emit failed |

Round-6 cross-check: every AC was verified against code by the proposer and re-verified by the adversary (see context.md for the session record).
