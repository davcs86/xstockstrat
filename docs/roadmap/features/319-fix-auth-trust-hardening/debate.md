# Debate Register: fix-auth-trust-hardening

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 8 | 6 | 0 | 3 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 4 | 1 | 1 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | SetConfig internal-caller authority binds the trading-reconciliation-poller grant to peerSan 'xstockstrat-trading' by reusing the GetSecret grant field and the peerDnsSans check. The gate takes the call (typed via the PeerCall alias of SecretCallerCall) instead of the metadata. | services/xstockstrat-config/src/grpc/authz.ts:133,152,158,185; configServiceImpl.ts:679-711 | settled |
| D-2 | 1 | SetConfig persists caller_identity only when internalCallerAuthorized is true. Otherwise it is NULL, so a forged x-internal-caller on an admin write is never attributed. | configServiceImpl.ts:724 reads the raw header unconditionally (verified this round); config CLAUDE.md invariant 7 | settled |
| D-3 | 1 | The SetConfig deny log keeps reason 'no_admin_or_internal_grant' and adds hadPeerSan and peerSan (truncated service name). There is no separate setConfigDenialReason. | authz.ts:228 hasPeerDnsSan; configServiceImpl.ts:693-706 | settled |
| D-4 | 1 | RevokeToken uses jwt.verify(token, this.jwtSecret, {ignoreExpiration:true, algorithms:['HS256']}). An unverifiable token gets a WARN, success:true and no UPDATE. A missing JWT_SECRET stays code 13. HS256 is also pinned in validateToken. | identityServiceImpl.ts:130-134,218,281,283-284,293-294; jsonwebtoken ^9.0.2 (package.json:34) | settled |
| D-5 | 1 | Agent DCR fails closed: a public WatchCore.has_snapshot() plus a watcher.has_snapshot(ns) helper, checked once after the JSON parse and before the redirect_uris validation. The response is 503 {error:server_error}, and the except branches return the same. AC-3 is driven by popping _WATCHERS['agent']. | watch_core.py:99-100; watcher.py:64-77; oauth_server.py:87-108,138; operator decision 2026-11-10 in context.md | settled |
| D-6 | 1 | A stale agent snapshot after a stream disconnect counts as readable. It retains the last operator-set policy and is not the permissive default, so no stream-liveness signal is added. | watch_core.py:99,194-196 (snapshot never reset); adversary r1 P-03 analysis | settled |
| D-7 | 1 | The agent 503 guard is documented as defensive and unreachable in a correctly booted process, because the HTTP lifespan and _run_stdio block on start_watchers. The reported GetConfig-stall cause was mooted by feature 295. | main.py:92,242,259; watcher.py:96-97 | settled |
| D-8 | 1 | Agent 247 @AC-4 is amended in place with an @feature-319 tag to the 503 outcome. This realises the operator's 'superseded'. | context.md operator decisions 2026-11-10; fails.md 2026-11-04 fix-marketdata-secret-exposure | settled |
| D-9 | 2 | Add a label-free OTel counter identity.revoke.unverifiable via recordRevokeUnverifiable(), incremented only in RevokeToken's verify-catch and never on missing JWT_SECRET. Its description reads 'forged, malformed, or pre-rotation'. It is registered in telemetryAllowlist.test.ts MIN_INSTRUMENTS and drive(), and asserted as an And on 319 @AC-2. | services/xstockstrat-identity/src/telemetry.ts:340-374; src/__tests__/telemetryAllowlist.test.ts:31-38,41-49 (verified r2); identity acceptance signal-map-instrumentation.feature @AC-52 | settled |
| D-10 | 2 | The RevokeToken unverifiable WARN is a fixed message carrying at most the verify error class name, never the token, payload or user_id. A test asserts its fields. | services/xstockstrat-identity/CLAUDE.md Observability ('No token, email or hash is ever logged or labelled') | settled |
| D-11 | 2 | Deployed DO leaf certificates carry DNS SAN = service name, because do-render-app-spec.py mint runs gen-dev-certs.sh on every render. The Step 1 precondition reduces to a homelab-only check. | scripts/do-render-app-spec.py:39-70 (mint -> mtls-provision.sh :44, gen-dev-certs.sh :53-62); scripts/gen-dev-certs.sh:50; authz.ts:141 live marketdata peerSan grant | settled |
| D-12 | 2 | If the operator rejects the O-1 amendments, Step 1 is deferred out of 319. The code never lands with the three config durable scenarios unamended or marked superseded. | C-16; fails.md 2026-11-04 fix-marketdata-secret-exposure | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | A separate setConfigDenialReason gate mirroring secretDenialReason | One grant does not justify a parity-tested second gate (C-18). Logging peerSan gives the same diagnosability. | locked |
| R-2 | 1 | An agent stream-liveness signal so DCR fails closed on a disconnected WatchConfig stream | A stale snapshot is not fail-open. The signal would add YAGNI coupling to watch_core and make DCR flap on redeploys. | locked |
| R-3 | 1 | Reaching into WatchCore._snapshot from module scope, or mutating _snapshot in AC-3 tests | Private-attribute coupling (fails.md 2026-08-06). Use the public has_snapshot() and the registry pop instead. | locked |
| R-4 | 1 | The temporarily_unavailable error code for the DCR outage | It is an RFC 6749 redirect error, not an RFC 7591 code. server_error/503 matches the existing handler shape. | locked |
| R-5 | 1 | RevokeToken returning an error for an unverifiable token | It creates a token-validity oracle and breaks idempotent logout after a rotation. It is also inconsistent with the empty-token path. | locked |
| R-6 | 1 | Leaving the raw-header caller_identity at configServiceImpl.ts:724 out of scope | It is a one-line fix in the same handler. Without it a forged attribution survives the fix meant to close it. | locked |
| R-7 | 2 | Reusing identity.token.validate_failures{reason=invalid} for unverifiable RevokeToken calls | It mixes RevokeToken traffic into ValidateToken dashboards and corrupts their semantics. | locked |
| R-8 | 2 | Waiving the revoke counter (WARN-only signal) | A log gives no rate or trend, and the counter costs about four lines of an existing pattern. | locked |
| R-9 | 2 | A reason label (malformed / bad_signature) on identity.revoke.unverifiable | No consumer exists (YAGNI). Revisit only if rotation noise matters. | locked |
| R-10 | 2 | Landing Step 1 while the config @AC-2/241, @AC-5/296 and @AC-25/295 scenarios stay unamended or are marked superseded | The code would contradict a durable rule (C-16), the 'alongside' promotion mistake in fails.md 2026-11-04. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | C-16: The operator must explicitly sign off the in-place Given amendments to config @AC-2/241, @AC-5/296 and @AC-25/295 (SAN-bound poller success path), and the sign-off must be recorded in context.md before design concludes. | yes | open |
| O-2 | 1 | Add a closed-label counter for unverifiable RevokeToken calls (reuse an existing identity instrument or add identity.revoke.rejected{reason=unverifiable}), or record a waiver. | no | closed @ round 2 (Answered by the label-free identity.revoke.unverifiable counter (verify-catch only), with concrete MIN_INSTRUMENTS and drive() allowlist edits, a rotation-aware description, a fixed WARN, and an acceptance And on 319 @AC-2.) |
| O-3 | 1 | Operator confirmation of the OQ3 resolution (ignore an unverifiable token, success:true, no revoke). | no | open |
| O-4 | 2 | Confirm that homelab mTLS leaves are minted by the same gen-dev-certs render path (DNS:${svc}) before Step 1 merges, or check them directly. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
