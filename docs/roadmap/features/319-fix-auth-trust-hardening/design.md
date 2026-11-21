# Design: fix-auth-trust-hardening

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (design gate, option A)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Three independent slices plus a docs/C-16 slice, resting on `D-1`..`D-16` in debate.md. The change is
**internal-only**: there is no UI segment or Agent tool surface (C-14). The consumer-visible edges are the
`SetConfig` and `RevokeToken` RPCs and the agent's HTTP `POST /oauth/register`.

Every `path:line` below is the one recorded in recon.md (tree `origin/main-dev@c4fd48b0`) or in the debate.md
Evidence column. `/sdd-spec` re-greps each before it writes a step (C-01). Where recon.md and debate.md disagree
on a line (the audit-author line: recon `configServiceImpl.ts:729`, debate `:724`), the symbol is authoritative.

### Step 1 — config: bind the poller grant to the mTLS peer (`D-1`, `D-2`, `D-3`, `D-13`, `D-14`, `D-15`)

- **Grant.** The `trading-reconciliation-poller` grant (`services/xstockstrat-config/src/grpc/authz.ts:86`, type
  `InternalCallerGrant` at `:76`) gains `peerSan: 'xstockstrat-trading'`. It reuses the `GetSecret` mechanism in
  the same file: the `peerSan?` field (`authz.ts:133`), `peerDnsSans(call)` (`:158`) and the predicate at `:185`.
  No second SAN parser is written.
- **Gate.** `hasInternalCallerAuthority` (`authz.ts:104`) takes the call instead of the Metadata, typed through a
  `PeerCall` alias of `SecretCallerCall` (`authz.ts:152`). Its only non-test caller,
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts:681`, passes `call` instead of `call.metadata`.
- **Attribution.** `caller_identity` is persisted only when `internalCallerAuthorized` is true, otherwise NULL
  (`configServiceImpl.ts:724`, which today reads the raw header unconditionally). The audit author expression
  (`configServiceImpl.ts:729`) already attributes the internal caller only when authorized.
- **Deny log.** The deny path (`configServiceImpl.ts:687-711`) keeps reason `no_admin_or_internal_grant` and
  PERMISSION_DENIED, and adds `hadPeerSan` (`authz.ts:228` `hasPeerDnsSan`) and `peerSan` (truncated service
  name). No value is logged.
- **Order (F-05, P-06).** Harness green on SAN fakes first, then RED for 319 `@AC-1`, then the grant flip in the
  same commit as its four test files (`internalCallerAuthz.test.ts`, `internalCallerSetConfig.test.ts`,
  `setConfigAuthz.test.ts`, `setConfigSpelling.test.ts`). SAN fakes are copied from `secretCallerAuthz.test.ts`,
  `peerSanSpike.test.ts` and `configServiceImpl.test.ts:679-680`.
- **No trading code change and no deploy precondition.** Trading dials config presenting its own leaf
  (`services/xstockstrat-trading/internal/config/config.go:70`), and the legitimate caller is
  `services/xstockstrat-trading/internal/service/trading.go:2270`. DO, homelab and local leaves all come from
  `scripts/gen-dev-certs.sh:50` (`DNS:${svc}`, with `xstockstrat-trading` in `SERVICES` at `:28`). The homelab
  path is `scripts/homelab-release-env.sh:37-39`, whose owned regex drops operator overrides (`D-11`, `D-13`).
- **Docs in Step 1 Files (F-08).**
  - `services/xstockstrat-config/CLAUDE.md` invariant 7: the grant is no longer header-only.
  - `docs/context-constitution.md` PLAT-9 row (`:47`): rewrite the write-direction clause that says the allowlist
    "has **no** `peerSan`", refresh the `authz.ts` anchors, and record the cross-module contract naming both
    ends. The grant's `peerSan` literal must equal the leaf DNS SAN emitted by `scripts/gen-dev-certs.sh:50`.
  - `services/xstockstrat-trading/docs/context-constitution-findings.md`: one findings row for a defect that
    predates 319. `escalateSystemic` only WARNs when `SetConfig` fails (`trading.go:2278-2280`) yet still emits
    the CRITICAL alert "trading reduced to REDUCE_ONLY" (`:2285`).

### Step 2 — identity: RevokeToken verifies the signature (`D-4`, `D-9`, `D-10`)

- `revokeToken` (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:279`) replaces the unverified
  decode (`:283`) with `jwt.verify(token, this.jwtSecret, { ignoreExpiration: true, algorithms: ['HS256'] })`.
  It reuses `this.jwtSecret` (`:130`) and the verify idiom of `validateToken` (`:218`), where HS256 is pinned
  too. Signing (`:320`) already uses the default HS256. `aud` is not required (IDENTITY-4).
- An unverifiable token gets a fixed WARN carrying at most the verify error class name, the label-free counter
  `identity.revoke.unverifiable` through `recordRevokeUnverifiable()`, `success:true` and no UPDATE. This
  resolves product-spec Open Question 3 as "ignore".
- A missing `JWT_SECRET` stays `code: 13` (`:132-134`) and does not increment the counter.
- `telemetryAllowlist.test.ts` registers the counter in `MIN_INSTRUMENTS` and `drive()`. 319 `@AC-2` gains an
  `And` asserting the counter.
- The findings row `services/xstockstrat-identity/docs/context-constitution-findings.md:60` is cleared.

### Step 3 — agent: DCR fails closed (`D-5`, `D-6`, `D-7`, `D-16`)

- Add a public `WatchCore.has_snapshot()` (`services/xstockstrat-agent/app/config/watch_core.py:189-196` holds
  the snapshot lookup) and a `watcher.has_snapshot(ns)` helper next to `get_watcher` / `read_value`
  (`app/config/watcher.py:64,68`).
- `register` (`services/xstockstrat-agent/app/oauth_server.py:76`) checks `has_snapshot('agent')` once, after the
  JSON parse and before the `redirect_uris` 400 (`:96-101`). On failure it returns 503 `{"error":"server_error"}`
  in the existing `JSONResponse` shape (`:138`). The two `except` branches (`:87-89`, `:105-107`) return the same
  instead of defaulting to permissive.
- A readable snapshot with the key unset keeps the defaults (`true` / `""`). A readable `false` still returns 403.
  A stale snapshot after a stream disconnect counts as readable (`D-6`).
- The 503 guard is defensive: boot blocks on `wait_for_snapshot` (`watcher.py:97`), so it is unreachable in a
  correctly booted process. A two-line constraint comment and this section record why it exists (`D-7`).
- Tests (`services/xstockstrat-agent/tests/test_oauth.py`): invert `test_register_survives_config_read_failure`
  (`:168`) in the same commit, add a readable-`false` ⇒ 403 test, and drive 319 `@AC-3` by popping
  `_WATCHERS['agent']`.
- Docs: `services/xstockstrat-agent/CLAUDE.md:208` `oauth.registration_enabled` row becomes "(disabled ⇒ 403;
  policy snapshot absent ⇒ 503)". A one-line 503 note on `services/xstockstrat-agent/docs/oauth.md:21` is
  optional, because that file makes no fail-open claim.

### Step 4 — durable business rules (`D-8`, `D-12`)

- Amend in place, each with an `@feature-319` tag:
  - config `@AC-2` (241), `@AC-5` (296) and `@AC-25` (295): the Given gains "from an mTLS peer with DNS SAN
    `xstockstrat-trading`". The Thens are unchanged.
  - agent `@AC-4` (247): the outcome becomes 503 with no `client_id`. The no-hang bound is kept.
- The config amendments land with the Step 1 code, never after it (`D-12`, `R-10`).

## Rejected Alternatives

- `R-1` A separate `setConfigDenialReason` gate mirroring `secretDenialReason` — rejected because one grant does
  not justify a parity-tested second gate (C-18); logging `peerSan` gives the same diagnosability.
- `R-2` An agent stream-liveness signal so DCR fails closed on a disconnected WatchConfig stream — rejected
  because a stale snapshot is not fail-open; the signal adds YAGNI coupling to `watch_core` and makes DCR flap on
  redeploys.
- `R-3` Reaching into `WatchCore._snapshot` from module scope, or mutating `_snapshot` in `@AC-3` tests —
  rejected because it is private-attribute coupling (fails.md 2026-08-06); use the public `has_snapshot()` and
  the registry pop.
- `R-4` The `temporarily_unavailable` error code for the DCR outage — rejected because it is an RFC 6749 redirect
  error, not an RFC 7591 code; `server_error`/503 matches the existing handler shape.
- `R-5` RevokeToken returning an error for an unverifiable token — rejected because it creates a token-validity
  oracle, breaks idempotent logout after a rotation, and is inconsistent with the empty-token path.
- `R-6` Leaving the raw-header `caller_identity` at `configServiceImpl.ts:724` out of scope — rejected because it
  is a one-line fix in the same handler, and without it a forged attribution survives the fix meant to close it.
- `R-7` Reusing `identity.token.validate_failures{reason=invalid}` for unverifiable RevokeToken calls — rejected
  because it mixes RevokeToken traffic into ValidateToken dashboards and corrupts their semantics.
- `R-8` Waiving the revoke counter (WARN-only signal) — rejected because a log gives no rate or trend, and the
  counter costs about four lines of an existing pattern.
- `R-9` A reason label (`malformed` / `bad_signature`) on `identity.revoke.unverifiable` — rejected because no
  consumer exists (YAGNI); revisit only if rotation noise matters.
- `R-10` Landing Step 1 while the config `@AC-2`/241, `@AC-5`/296 and `@AC-25`/295 scenarios stay unamended or
  are marked superseded — rejected because the code would contradict a durable rule (C-16), the "alongside"
  promotion mistake in fails.md 2026-11-04.
- `R-11` A cross-module CI contract test pinning the `authz.ts` grant `peerSan` literal to `gen-dev-certs.sh`'s
  SAN form — rejected because it is brittle cross-language coupling of a TS test to bash script text; the live
  marketdata `peerSan` grant (`authz.ts:141`) already depends on the same contract without one, and recording it
  in PLAT-9 is proportionate.
- `R-12` Changing trading `escalateSystemic` code within 319 so its alert reflects a `SetConfig` failure —
  rejected because the defect predates 319 and is out of scope (minimal diff); it is captured as a trading
  findings row instead.

The accepted fail-open of insights.md 2026-10-20 (fix-agent-getconfig-deadline) is reversed by `D-5` under the
operator decision of 2026-11-10; it is not a register row.

## Open Risks

- [ ] `O-3` is not explicitly confirmed: the operator approved the design at the gate, but no decision names the
  OQ3 resolution (ignore an unverifiable token, `success:true`, no UPDATE, WARN plus the counter). It stands as
  settled `D-4`; a rejection implies `R-5`, which only the operator can reopen — to be addressed at /sdd-spec
  (before Step 2 is written).
- [ ] `O-5` / `O-6` are answered by `D-14` / `D-15` in Step 1 above but stay `open` in debate.md until the spec
  lists `docs/context-constitution.md` and the trading findings file in Step 1 Files — to be addressed at
  /sdd-spec (Step 1 Files).
- [ ] Grant and generator SAN drift: if `gen-dev-certs.sh` moves to FQDN SANs, or a leaf is hand-minted, the
  poller's HALTED/REDUCE_ONLY escalation is denied silently while trading still alerts that the halt succeeded.
  Mitigated only by the PLAT-9 contract note and the trading findings row; there is no CI guard (`R-11`) — to be
  addressed at Step 1 (docs) and by a follow-up on the trading finding.
- [ ] `identity.revoke.unverifiable` spikes after every `JWT_SECRET` rotation, from legitimate logouts of
  pre-rotation tokens. It is not a forgery signal on its own — to be addressed at Step 2 (counter description).
- [ ] With `ignoreExpiration: true`, a years-old leaked but validly signed token can still trigger a revoke.
  HS256 pinning does not bound the age — accepted; noted at Step 2.
- [ ] A stale agent snapshot after a WatchConfig disconnect keeps serving the last-known DCR policy — accepted
  under `D-6`; noted at Step 3.
- [ ] The agent 503 path is unreachable in a correctly booted process, so a future dead-code pass could remove
  it — to be addressed at Step 3 (constraint comment, `D-7`).
- [ ] Merge-order overlap: `configServiceImpl.ts` is shared with feature 314, agent files with 314/322/328/331,
  and `docs/context-constitution.md` is widely edited — to be addressed at /sdd-spec (merge-order.md) and at the
  integration PR.

## Constitution Rules Touched

- `C-01` — honored by: every claim above cites a `path:line` from recon.md or the debate.md Evidence column;
  `/sdd-spec` re-greps them.
- `C-08` — honored by: each code slice (config, identity, agent) pairs with its test files in the same step.
- `C-10` — honored by: the shared `authz.ts` edit keeps the `GetSecret` grants untouched and proves it through
  the preserved 254 scenarios; HS256 is pinned in both `validateToken` and `revokeToken`; both DCR `except`
  branches change together.
- `C-11` — honored by: Track C bug with triage, review, recon and a 3-round full debate before any code.
- `C-15` — honored by: 319 `@AC-1`..`@AC-3` each map to a RED test; `@AC-2` gains the counter `And`.
- `C-16` — honored by: every CHANGE below carries an operator sign-off recorded in context.md, and the
  amendments are in place, not "alongside" (`D-8`, `D-12`).
- `C-18` — honored by: reuse of the `GetSecret` SAN predicate, the `validateToken` verify idiom and the existing
  counter pattern; no second gate, liveness signal or label (`R-1`, `R-2`, `R-9`).
- `F-05` — honored: harness green, then RED, then the grant flip with its tests in one commit; the inverted
  agent test lands with the handler change.
- `F-08` — honored: the PLAT-9 row, the trading findings row, config CLAUDE.md and agent CLAUDE.md are named as
  step Files (`D-14`, `D-15`, `D-16`).
- `P-02` — honored by: proposer and adversary exchanged only orchestrator-synthesized state in all three rounds.
- `P-03` — honored by: the silent SAN-mismatch denial is surfaced as a recorded contract and a findings row, and
  the unconfirmed `O-3` is listed as an open risk, not assumed.
- `P-06` — honored by: RED-before-green on `@AC-1`, `@AC-2` and `@AC-3`.
- `IDENTITY-4` — honored by: `revokeToken` verification does not require `aud`.
- `PLAT-9` — amended by Step 1: the write-direction clause states the SAN-bound grant and the generator contract.
- `PLAT-N1` — honored by: trading's best-effort `SetConfig` escalation path is unchanged; its misleading alert
  is logged as a finding, not changed.

No Floor (`F-*`) breach was raised in any round.

## Business Rules Touched (C-16)

- CHANGE `@AC-2` "An automated internal-caller write is attributed to its x-internal-caller identity"
  (`services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature`, `@feature-241`) — Given
  amended to the SAN-bound peer; signed off by user @ 2026-11-20 (design gate, option A; context.md).
- CHANGE `@AC-5` "The previous-image reconciliation poller can still escalate during rollout"
  (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`, `@feature-296`) — Given amended to
  the SAN-bound peer; signed off by user @ 2026-11-20 (design gate, option A; context.md).
- CHANGE `@AC-25` "Internal-caller grants and write bounds match on the canonical key"
  (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`, `@feature-295`) — Given amended to the
  SAN-bound peer; signed off by user @ 2026-11-20 (design gate, option A; context.md).
- CHANGE `@AC-4` "OAuth dynamic client registration does not hang"
  (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`, `@feature-247`) — 201 on an
  unreadable policy becomes 503 with no `client_id`; signed off by user @ 2026-11-10 (context.md, operator
  decisions before /sdd-design).
- EXTEND 319 `@AC-1` (config SetConfig poller grant requires the peer SAN) — net-new regression scenario.
- EXTEND 319 `@AC-2` (identity RevokeToken verifies the signature) — new case added: the
  `identity.revoke.unverifiable` counter `And`.
- EXTEND 319 `@AC-3` (agent DCR fail-closed 503) — net-new regression scenario; fail-closed signed off by user @
  2026-11-10 (context.md).
- EXTEND identity `@AC-52` (`services/xstockstrat-identity/acceptance/signal-map-instrumentation.feature`) — new
  case added: the sibling instrument `identity.revoke.unverifiable`.
- PRESERVE `@AC-54` "Config denial of a global SetConfig write is attributed"
  (`services/xstockstrat-config/acceptance/signal-map-instrumentation.feature`) — not regressed by: the denial
  stays PERMISSION_DENIED and the added log fields carry no config value.
- PRESERVE identity `@AC-41` (telemetry closed-label / forbidden-key allowlist) — not regressed by: the new
  counter is label-free and registered in `MIN_INSTRUMENTS` and `drive()`.
- PRESERVE `@AC-47` "OAuth transaction rejects, degraded post-commit steps and onboarding lines are recorded"
  (`services/xstockstrat-agent/acceptance/signal-map-instrumentation.feature`) — not regressed by: the 503 path
  adds no metric label.
- PRESERVE the remaining rules listed in recon.md § Existing Business Rules (241 `@AC-1`/`@AC-3`; 254
  `@AC-3`/`@AC-4`/`@AC-6`; 147 `@AC-4`; 247 `@AC-1`/`@AC-5`; 265; 242; 169 `@AC-7`; platform 210) — not regressed
  by: the `GetSecret` grants, the human/admin write path, token issuance and trading's wire call are untouched.
