# Debate Register: fix-alert-event-targeting

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 4 | 0 | 1 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 3 | 2 | 0 | 3 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 4 | 1 | 2 | 1 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Owner for trading halt/reconciliation alerts is passed in by the caller (haltAccount/emitReconciliationFinding gain ownerUserID); there is no pool-lookup helper and no DB fallback. | reconcileTick already uses entry.userID at trading.go:2188; flattenAndHalt holds accountEntry at :2910 and order.UserId at :2937; DB fallback nil-panics noopAccountRepo (trading_reconciliation_test.go:250). | settled |
| D-2 | 1 | An empty owner degrades to an untargeted alert plus WARN; the halt, the ledger event and the alert are never blocked. | Preserves feature-206 @AC-2; agreed by proposer and adversary. | settled |
| D-3 | 1 | Concentration emits new portfolio.risk.concentration_breach; drawdown keeps portfolio.risk.drawdown_breach. Both go to the portfolio:risk stream via emitEventAs with the owner, and the helper injects user_id and message into the payload. | portfolio_service.go:1307,1315,1342; no in-repo consumer found; product-spec allows 'keyed by or carrying user_id'. | settled |
| D-4 | 1 | The notify risk alert body and target stay byte-identical. | feature-242 @AC-3/@AC-6. | settled |
| D-5 | 2 | flattenAndHalt passes accountEntry.userID only, with no order.UserId secondary source. An empty owner falls to the D-2 path (WARN plus untargeted). | Every pool insert sets userID (trading.go:306, :320, :2614, :2652, :2706). The adversary's C-18 objection got no counter. | settled |
| D-6 | 2 | In emitRiskAlert, the helper-injected user_id and message override any colliding key in extra. | Refines D-3 (the helper injects user_id/message). The adversary's precedence objection got no counter. | settled |
| D-7 | 2 | The AC-2 test and a new Gherkin scenario pin both halves: concentration emits concentration_breach, and drawdown still emits drawdown_breach with {user_id, account_id, message} and UserId=owner. | AC-2 only guarded concentration, and feature-172 @AC-1 covers the notify alert, not the ledger event (C-15/C-16). | settled |
| D-8 | 3 | The reconciliation.mismatch_found ledger owner stays "" in this fix (trading.go:2018). It is recorded in context.md as a named deferral even though ownerUserID will be in scope one line away. | Touch only what the task requires (C-18). trading.ledger_emit labels are event_type/outcome only, so feature-294 @AC-4 is unaffected either way. The adversary raised this as non-blocking and the proposer did not counter. | settled |
| D-9 | 3 | The ledger CLAUDE.md Stream Key row describes portfolio:risk as a fixed global key, with the owner in AppendEventRequest.user_id and in the payload. | services/xstockstrat-ledger/CLAUDE.md:113 lists only portfolio:{user_id}, so a bare row would read as a user whose id is 'risk'. | settled |
| D-10 | 3 | The operator packet states prod Slack/SendGrid fanout as unknown, and trading.alert_emit as 'exists, no alert rule watches it, no account_id label'. Neither is presented as a mitigation. | secrets/production.enc.yaml:2-15; do-render-app-spec.py:98-102; 018_notify_fanout.up.sql:45-55; packages/otel/alerts/alert-rules.yaml (only the error-rate, P99 and heartbeat rules). | settled |
| D-11 | 3 | The peer-312 coupling is recorded as a non-blocking prose note in merge-order.md and context.md. Either merge order is code-safe. | 315 edits no notify files. The semantic coupling is 312 product-spec.md:94 (Open Question 2). merge-order.md:389-399 shows the prose-note pattern. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | accountOwner(accountID) pool-lookup helper | Re-reads state the callers already hold; adds a lock read and a deregister race. | locked |
| R-2 | 1 | GetBrokerAccount DB fallback for alert owner | Nil-panics noopAccountRepo; adds a DB round-trip on the context.Background() path. | locked |
| R-3 | 1 | Extra untargeted admin copy of per-account alerts | An untargeted alert is a broadcast to all StreamAlerts/ListAlerts users, which reintroduces the cross-user leak and duplicates the owner's alert. | locked |
| R-4 | 1 | Per-user portfolio:{user_id} stream key for risk events | Mixes risk events into the user's portfolio stream; carrying user_id on portfolio:risk satisfies the spec. | locked |
| R-5 | 2 | order.UserId secondary owner source in flattenAndHalt | Pool userID is never empty (trading.go:306, :320, :2614, :2652, :2706). The branch is untested and speculative (C-18); D-2 covers the empty case. | locked |
| R-6 | 2 | Operator audience question limited to owner-only-now variants | It pre-decides the O-1 fork on the operator's behalf (P-03/C-11). Options (c) owner+admins now and (d) hold AC-1 must be offered. | locked |
| R-7 | 3 | Framing owner-only as costing admins only Web Push, plus stream and inbox like any non-owner | Admins are the only resumers (trading.go:3181; feature-179 @AC-5), and today's alert title (trading.go:2895) is their only in-product source of another user's halted account_id (account_repo.go:90; agent tools.py:2456). The framing understates the change and tilts the operator toward (b). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O: Alert audience (owner-only vs owner-plus-admins) for trading halt/reconciliation alerts needs an explicit, recorded operator decision; owner-only removes admin push, live stream and inbox visibility. | yes | open |
| O-2 | 2 | C-16: the admin-visibility loss (push, stream, inbox) for per-account halt/reconciliation alerts is an unclassified CHANGE. Add a CHANGE row, get operator sign-off in context.md, and cite whether any feature-242 scenario asserts admin delivery. | yes | open |
| O-3 | 2 | Check prod Slack/SendGrid fanout configuration before asking the operator, or state that it is unknown. | no | closed @ round 3 (Answered with evidence: prod Slack/SendGrid fanout is unknown from the repo (secrets/production.enc.yaml:2-15; do-render-app-spec.py:98-102; 018_notify_fanout seeds ''), and the packet declares it unknown, not as a mitigation. The adversary agreed.) |
| O-4 | 2 | Record the ordering dependency on batch peer 312 (untargeted ListAlerts visibility) in context.md and merge-order.md. | no | closed @ round 3 (Answered: no file overlap with 312, and either merge order is code-safe. The semantic coupling (312 product-spec.md:94) is recorded as a prose note in merge-order.md and context.md. The adversary agreed.) |
| O-5 | 3 | P-03/C-11/C-16: the operator packet and the CHANGE row must state that admins are the only people who can resume a halt (trading.go:3181) and have no in-product way to discover another user's halted account or its id (account_repo.go:90; tools.py:2456; trading.go:2895). The CHANGE 'After' line must say: owner notified but cannot resume; admins get no signal or id. Offer (b′), a Grafana rule on trading.alert_emit halt/reconciliation, and name the admin cross-user halted-accounts read as a follow-on target. Re-weigh, or pair, the (b) recommendation. | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
