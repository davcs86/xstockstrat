# Design: fix-alert-event-targeting

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: operator @ 2026-11-20 (design gate; decisions relayed by the /sdd-batch workflow input and recorded in context.md, Session 2026-11-20)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Two independent, surgical edits plus one alert rule. No proto, migration or config change (recon.md:108).
The mechanics rest on D-1 to D-11 in debate.md; the audience rests on the operator decisions of 2026-11-20.

### Trading (AC-1) — owner-targeted halt and reconciliation alerts

- **Signatures (D-1).** The owner is passed in by the caller. There is no lookup helper and no DB fallback.
  - `haltAccount(ctx, accountID, ownerUserID, reason string, haltSource int32)` — `trading.go:2872` (recon.md:28).
  - `emitReconciliationFinding(ctx, accountID, ownerUserID, mismatchClass, orderID string, expected, brokerReported float64)` — `trading.go:2014` (recon.md:23).
- **Targeting.** Both CRITICAL alerts set `TargetUserId: ownerUserID`, mirroring `TargetUserId: order.UserId` at `trading.go:3509` (recon.md:42).
- **Owner sources** (recon.md:35-36).
  - `reconcileTick` passes `entry.userID` at its four call sites, `trading.go:2116`, `:2126`, `:2160`, `:2239` (recon.md:23).
  - `flattenAndHalt` passes `accountEntry.userID` only (`trading.go:3009-3013`, recon.md:36, recon.md:132). There is no `order.UserId` secondary source (D-5).
- **Empty owner (D-2).** The service logs a WARN `alert owner unresolved` and sends the alert untargeted. The halt, the `reconciliation.mismatch_found` event and the alert are never blocked, which keeps feature-206 @AC-2 (recon.md:98). This path is reachable: `RegisterBrokerAccount` has no guard against an empty caller id (`trading.go:2595`). That is recorded as an assumption; D-5 stands.
- **Double push (operator decision).** `emitReconciliationFinding` calls `haltAccount` and then emits its own alert (recon.md:127), so the owner gets two CRITICAL pushes per finding. Both are kept. The halt alert is not suppressed, so the `trading.alert_emit{alert_kind=halt}` count and feature-294 @AC-4 are unchanged.
- **Not touched.**
  - The systemic alert, `trading.go:2282-2288`, stays untargeted (recon.md:32).
  - The resume alert, `trading.go:3219-3225`, stays untargeted (recon.md:34).
  - The `reconciliation.mismatch_found` ledger owner stays `""` at `trading.go:2018` (recon.md:136). This is a named deferral (D-8).
- **Tests** (recon.md:78-83).
  - Reconcile templates at `trading_reconciliation_test.go:539` and `:576` assert `TargetUserId` on both alerts.
  - `trading_reconciliation_test.go:762` asserts the systemic alert stays untargeted.
  - `trading_bracket_test.go:602` and `:628` move to the 5-argument `haltAccount` call in the same step as the signature change. One asserts `TargetUserId` on the `HALT_SOURCE_BRACKET_PROTECTION` halt.
  - One empty-owner case: WARN, untargeted alert, halt still happens.
  - `noopAccountRepo` (`trading_reconciliation_test.go:250`) needs no change, because nothing calls `GetBrokerAccount` (recon.md:80, recon.md:130).

### Portfolio (AC-2 plus a new drawdown scenario) — risk ledger events split by kind

- **Helper (D-3, D-6).** `emitRiskAlert(ctx, userID, eventType, extra, msg)` replaces the single-type helper at `portfolio_service.go:1320-1335` (recon.md:57). It writes through `emitEventAs` (`portfolio_service.go:1342`, recon.md:60) to the fixed `portfolio:risk` stream, with `AppendEventRequest.UserId` set to the owner. The helper injects `user_id` and `message` into the payload, and those two keys win over any colliding key in `extra`.
- **Concentration** (`portfolio_service.go:1307`, recon.md:52) emits the new `portfolio.risk.concentration_breach` with `{user_id, symbol, message}`.
- **Drawdown** (`portfolio_service.go:1315`, recon.md:53) keeps `portfolio.risk.drawdown_breach` with `{user_id, account_id, message}`. `evaluateDrawdowns` (`portfolio_service.go:1263`, recon.md:54) returns `[]drawdownBreach{AccountID, Message}`; the message text does not change.
- **Notify alert (D-4).** Body and target stay byte-identical (recon.md:93-94).
- **Stream key.** `portfolio:risk` stays a fixed global key (R-4). No in-repo consumer reads it (recon.md:119).
- **Tests (D-7)** (recon.md:86). `fakeLedger.reqs` via `newQuoteSvc` (`portfolio_quote_deadline_test.go:96-104`) pins both halves: concentration emits `concentration_breach`, and drawdown still emits `drawdown_breach` with `{user_id, account_id, message}` and `UserId` = owner. `acceptance.feature` gains a third scenario, `@AC-3`, for the drawdown half.

### Audience and admin reachability — operator decision (b) + (b′)

- **Delivery.** Owner-only. A targeted alert is not pushed to admins (feature-242 @AC-2), so admins lose Web Push, and like every other non-owner they lose the stream and inbox entries.
- **What that costs.** Only admins can resume a halt (`ResumeAccountSvc` calls `RequireAdminScope`, `trading.go:3181`; feature-179 @AC-5). Admins have no in-product way to find another user's halted account: `ListBrokerAccounts` filters by `user_id` (`account_repo.go:90`), the agent's `manage_account resume` needs an account_id (agent `tools.py:2456`), and today the untargeted alert title (`trading.go:2895`) is the only in-product source of that id. After this fix the owner is notified but cannot resume, and admins get no in-product signal or id.
- **Paired mitigations, both required by the operator.**
  - **(b) Follow-on story.** A separate `/sdd-story` for an admin cross-user halted-accounts read (or a notify admin-audience field). It is not part of this feature and has no slug yet; the implementation spec names it.
  - **(b′) Grafana rule, in this feature.** One rule in `packages/otel/alerts/alert-rules.yaml` fires on any increase of `trading.alert_emit{alert_kind=halt|reconciliation}`. The metric has no account_id label, so admins read the account id from the Loki ERROR line `account halted` (`trading.go:2903`) until the follow-on ships.
- **Not relied on (D-10).** Prod Slack/SendGrid fanout is unknown from the repo and is not counted as a mitigation.
- **Options the operator declined.** (a) owner-only with no pairing; (c) owner plus admins now through an additive notify audience field; (d) ship AC-2 and hold AC-1; suppressing the halt alert inside a finding.

### Consumer surfaces (C-14)

- **Account owner:** Web Push, the trader alert stream and the alert inbox, through notify's existing targeting. No UI or agent code changes.
- **Ledger readers:** owner-attributed `portfolio.risk.*` events become visible in the owner's owner_only `QueryEvents`/`ExportEvents` (`ledgerServiceImpl.ts:76-78`).
- **Admins:** Grafana alert plus Loki only, until the follow-on story ships.

### Docs (same PRs as the code, C-10)

- `services/xstockstrat-portfolio/CLAUDE.md:149` — add `concentration_breach`, note the payloads (recon.md:63).
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md:63` — mark resolved (recon.md:63).
- `services/xstockstrat-ledger/CLAUDE.md:113` — `portfolio:risk` is a fixed global key with the owner in `AppendEventRequest.user_id` and in the payload (D-9).
- `docs/roadmap/features/merge-order.md` — prose note for peer 312, styled like `:389-399` (D-11).

### Build order

1. Trading signatures and `TargetUserId`, together with the bracket test callers.
2. The rest of the trading tests.
3. The portfolio split.
4. The portfolio tests, both halves, and the `@AC-3` scenario.
5. The (b′) Grafana rule.
6. Docs.

## Rejected Alternatives

- `R-1` `accountOwner(accountID)` pool-lookup helper — rejected because it re-reads state the callers already hold and adds a lock read and a deregister race.
- `R-2` `GetBrokerAccount` DB fallback for the alert owner — rejected because it nil-panics `noopAccountRepo` and adds a DB round-trip on the `context.Background()` path.
- `R-3` Extra untargeted admin copy of per-account alerts — rejected because an untargeted alert is a broadcast to all StreamAlerts/ListAlerts users, which reintroduces the cross-user leak and duplicates the owner's alert.
- `R-4` Per-user `portfolio:{user_id}` stream key for risk events — rejected because it mixes risk events into the user's portfolio stream; carrying `user_id` on `portfolio:risk` satisfies the spec.
- `R-5` `order.UserId` secondary owner source in `flattenAndHalt` — rejected because the branch is untested and speculative (C-18); D-2 covers the empty case.
- `R-6` Operator audience question limited to owner-only-now variants — rejected because it pre-decides the O-1 fork on the operator's behalf (P-03/C-11); options (c) and (d) had to be offered.
- `R-7` Framing owner-only as costing admins only Web Push, plus stream and inbox like any non-owner — rejected because admins are the only resumers (`trading.go:3181`; feature-179 @AC-5) and today's alert title (`trading.go:2895`) is their only in-product source of another user's halted account_id; the framing understates the change.

## Open Risks

- [ ] Until the follow-on story ships, a halt on another user's account has no in-product admin signal or account id. The follow-on has no slug yet — to be named in the implementation spec and opened no later than the integration PR.
- [ ] The (b′) rule depends on the Grafana contact points the existing rules use, and admins still need Loki for the account id — to be addressed at the alert-rule step.
- [ ] Prod Slack/SendGrid fanout configuration is unknown from the repo — operator check before the integration PR.
- [ ] The owner gets two CRITICAL pushes per reconciliation finding (accepted by the operator) — pinned in the trading test step.
- [ ] An account with `user_id=''` is reachable (`trading.go:2595`); its halts take the D-2 untargeted path and still broadcast to every user — empty-owner test in the trading test step; the guard itself is out of scope.
- [ ] Owner-attributed risk events are re-emitted on every `checkRiskLimits` run with no dedup and now appear in owner_only QueryEvents/ExportEvents — documented at the portfolio step; no dedup in this fix.
- [ ] External ledger readers of `portfolio:risk` may depend on concentration arriving as `drawdown_breach`; only in-repo consumers were checked (recon.md:119) — called out in the docs step and the integration PR description.
- [ ] Peer 312 may narrow untargeted ListAlerts visibility mid-batch (312 product-spec.md:94). Either merge order is code-safe — merge-order.md note in the docs step.

## Constitution Rules Touched

- `F-04` — honored: every claim cites recon.md or a `path:line` checked during the debate; prod fanout is stated as unknown.
- `P-03` — honored by: the audience fork went to the operator with the full option set (R-6, R-7); nothing was pre-decided.
- `P-05` — honored by: the operator answer was written to context.md and debate.md before the status flip.
- `C-11` — honored by: full-mode debate, 3 rounds, approved at the gate.
- `C-15` — honored by: `@AC-1` and `@AC-2` each get a regression test; a new `@AC-3` scenario covers the drawdown half.
- `C-16` — honored by: the CHANGE rows below carry operator sign-off; all other touched rules are PRESERVE.
- `C-18` — honored by: no speculative branch (R-5) and the `mismatch_found` owner is deferred by name (D-8).
- `C-08` — honored by: no proto, migration or config-key change; option (c), which needed a proto field, was declined.
- `C-14` — honored by: consumer surfaces stated above (owner push/stream/inbox; admins via Grafana until the follow-on).
- `C-10` — honored by: service CLAUDE.md and findings edits ship with the code.
- `C-01` — honored by: `context.md` re-read at each session; decisions carried in debate.md.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "an automatic account halt alert targets the account owner" (this feature's `acceptance.feature`) — halt and reconciliation alerts go from untargeted to owner-targeted; signed off by operator @ 2026-11-20 (context.md, Session 2026-11-20, decision 3).
- CHANGE `@AC-2` "a concentration breach is recorded as a concentration event, not a drawdown" (this feature's `acceptance.feature`) — the ledger event type changes to `portfolio.risk.concentration_breach` and gains owner attribution; signed off by operator @ 2026-11-20 (context.md, Session 2026-11-20, decision 3).
- CHANGE admin delivery and remediation reachability of per-account halt/reconciliation alerts (feature-242 untargeted admin audience as applied to these alerts; no `@AC` text changes) — signed off by operator @ 2026-11-20 (context.md, Session 2026-11-20, decisions 1 and 3).
  - Before: per-account halt/reconciliation CRITICAL alerts are untargeted: Web Push to admins; stream and inbox to every user; admins learn the account_id from them.
  - After: owner notified but cannot resume; admins (the only resumers, trading.go `ResumeAccountSvc`) get no in-product signal or id until the follow-on, only the Grafana rule + Loki line.
- EXTEND new `@AC-3` (this feature's `acceptance.feature`) — new case added: a drawdown breach still emits `portfolio.risk.drawdown_breach`, owner-attributed with `account_id`.
- PRESERVE feature-242 `@AC-2` (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — not regressed by: targeting is reused as is; no admin-audience field is added.
- PRESERVE feature-242 `@AC-5` (same file) — not regressed by: untargeted alerts (systemic, resume, empty-owner fallback) still push to admins.
- PRESERVE feature-242 `@AC-3` / `@AC-6` (`services/xstockstrat-portfolio/acceptance/fix-push-untargeted-broadcast.feature`) — not regressed by: the notify risk alert stays byte-identical (D-4).
- PRESERVE feature-179 `@AC-1` / `@AC-2` / `@AC-5` (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`) — not regressed by: no resume code changes; the scenarios assume the admin is already looking at the account.
- PRESERVE feature-206 `@AC-2` (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`) — not regressed by: an empty owner never blocks the halt, the event or the alert (D-2).
- PRESERVE feature-231 `@AC-3` / `@AC-9` (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`) — not regressed by: alert set and wording unchanged; no concentration event when the check is skipped.
- PRESERVE `@AC-45` (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`) — not regressed by: the systemic alert is untouched and stays untargeted.
- PRESERVE feature-169 `@AC-3` (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`) — not regressed by: the resume alert is untouched.
- PRESERVE feature-172 `@AC-1` (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature`) — not regressed by: the drawdown alert still fires with the same body.
- PRESERVE feature-294 `@AC-4` (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`) — not regressed by: the operator accepted both pushes, so the halt alert is not suppressed and the metric counts are unchanged.
