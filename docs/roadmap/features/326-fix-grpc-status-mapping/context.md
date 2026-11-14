# Context Log: fix-grpc-status-mapping

> Distilled 2026-11-13 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries (sanctioned exceptions: /sdd-distill, /sdd-archiver).

---

## Decisions

- **D-1 cast**: marketdata `toGRPCError` branch (a) returns `codes.Code(c.Code())` for any `*connect.Error` other than Internal/Unknown; portfolio gets the same cast. (r2 fence; sdd-design 2026-11-13)
- **D-2/D-8 ctx-aware branch (b)**: new signature `toGRPCError(ctx, err)` (the compiler forces all 19 call sites to pass the inbound ctx); `ctx.Err()` set → DEADLINE_EXCEEDED/CANCELLED with fixed text. Never put `err.Error()` in the status, a log or a span (at most a fixed-label error class): the wrapped chain can carry a vendor `apikey=` URL (@AC-5/@AC-7 f254, R-4). Branch (b) covers every Internal wrap with no per-site edits (R-3). (r2 fence; 2026-11-11 gate)
- **R-2 / D-11 detached budgets stay INTERNAL**: `context.WithoutCancel` budgets (marketdata_service.go:672,915,946) stay INTERNAL; a pin row (live ctx + CodeInternal wrapping `context.DeadlineExceeded` → INTERNAL) guards against a later `errors.Is` "simplification". (r3 fence)
- **D-12 branch (c) not fixed**: branch (c) and the blanket-Internal handler wraps (:90/:102/:114/:126/:202/:228) keep `err.Error()` on a live ctx — pre-existing, out of scope, must not be read as fixed; the no-`apikey=` test proves branch (b) only; Step 1 Instruction 4 puts this in the PR body. (r3 fence; sdd-review impl-spec)
- **Accepted trade-off**: branch (b) masks a genuine non-context Internal that coincides with an expired deadline. (r2/r3 open_risks)
- **D-6 portfolio gets the cast only, no ctx parameter**: a ctx parameter edits every call site in a file shared with 311/312/315/317, no AC needs it, and clients already see DEADLINE_EXCEEDED client-side; deferred to `fix-portfolio-grpc-ctx-mapping`. Correct figure: 18 production call sites (Step 8's "about 24" is stale). (r2 fence; sdd-execute record n=3)
- **D-3 narrow duplicate-name classifier**: `classifyWatchlistWriteErr` returns ALREADY_EXISTS only for 23505 on `watchlists_user_name_not_system_uidx` (migration 011:20), at CreateWatchlist :2194-2196, UpdatePartial :2314 and the legacy rename :2337-2339. Rejected: a generic 23505→AlreadyExists classifier (misclassifies binding/system-index 23505s; risks @AC-8 f294 park semantics). (r2 fence; sdd-design)
- **Negative-row test is synthetic**: `TestWatchlistWriteErr_OtherConstraintInternal` uses `watchlist_symbols_pkey`, which cannot raise 23505 on the create path (`ON CONFLICT … DO NOTHING` watchlist_repo.go:538; `DO UPDATE` :554) — a synthetic guard only. (sdd-execute record n=6)
- **AC-2 reworded server-side**: the @AC-2 ID is kept (C-15 append-only covers IDs, not wording); proven by a handler chain test with `Symbols:["AAPL"]` through the real Internal wrap at classification_service.go:171. Rejected (R-5): a socket-level e2e guard — a false green, since the client's own deadline yields DEADLINE_EXCEEDED whatever the server sends. (r2/r3 fences)
- **D-7/D-9 AC-3 wire test + seam**: AC-3 is pinned end to end through the existing portfolio wire harness `portfolio_grpc_wire_test.go` (D-7, r2), not only by the translator-table and service tests ("two unconnected halves"); extract `wireAdapterFor(svc)` from `wireAdapter`; inject errors via one `SetWatchlistCreateErr` export setter plus `createErr/updateErr/updatePartialErr` fake fields (`wireAdapter` returns only the adapter; `NewWireTestService` hard-wires `newFakeStore()`). Rejected: a `NewWireTestServiceWithStore` variant (wider seam, C-18) and inlining the handler construction (duplicates the harness line). (r3 fence)
- **D-10 index-name alias plus guard**: export the `WatchlistNameUniqueIdx` alias and add a migration-011 guard test, since renaming the index would otherwise silently send duplicates back to INTERNAL while every fake-store test stays green. (r3 fence)
- **D-13 local store stub**: the AC-2 chain test uses a local 5-method classification-store stub in package handler. Rejected: moving `fakeClassStore` to internal/testdata (couples unrelated test files; C-13 governs domain data, not doubles). The zero-value panic risk is retired (`markClassDemand` initializes lazily, :67-72). (r3 fence)
- **R-6 bounded grep replaces the open-ended audit**: the open-ended caller audit was rejected as unbounded and moot (reclassification happens only after the caller's own ctx fired). Grep result: no non-test caller branches on INTERNAL from a marketdata RPC — only telemetry labels, the UI `streamBackoff.ts:13-22` retry set (treats Internal/DeadlineExceeded/Canceled alike) and abort producers; no marketdata site emits a newly passed-through code, so the UI `Unauthenticated` redirect cannot fire. (r2 fence; sdd-spec)
- **C-14 UI**: no code change (`insightsBff.ts:136`, `bffShared.ts:199-209`, `watchlists/page.tsx:119-120`); the user-visible text changes from raw pgx duplicate-key text to the fixed ALREADY_EXISTS text. (r3 fence)
- **C-16 operator sign-off (2026-11-13, sdd-batch design gate)**: CHANGE for AC-1, AC-2 and AC-3; EXTEND for f148 `@AC-4 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature:33-34`); everything else PRESERVE. The gate snapshots with `covered_by_operator_decision:false` predate the gate. (sdd-design; sdd-spec; sdd-review)
- **Step 7 is a characterization test**: agent behavior does not change, so red is N/A (tdd-gate.md § Interaction escape). (sdd-spec)
- **Not edited by this feature**: the findings rows (marketdata :24 on main-dev / :23 on the branch, portfolio :25) are left for the next `/context-constitution` refresh. (sdd-spec; sdd-review)

## Open Threads

- [ ] Peer merge overlap: `portfolio_service.go` is shared with 311/312/315/317; overlap on `marketdata_handler.go` with 317/320/314 is unverified (re-check when their specs land). After each peer merge re-run f254 `@AC-5`/`@AC-7`, the Step 2 tests and `TestWire_CreateWatchlistDuplicateName_AC3` — the signature change will not catch a reintroduced raw Internal wrap or a lost classifier call. — final integration PR
- [ ] Keep connect-go and grpc-go codes 1-16 aligned; pinned by the translator table test. — Steps 1/2
- [ ] Document branch (b) masking, and state the branch (c) out-of-scope exposure in the spec and PR body. — Step 1
- [ ] Record "red N/A — no behavior change; characterization test added" in context.md and the PR body, and capture the green run; use the main-dev `tools.py` line numbers only after the main-dev merge, re-grep if main-dev moved. — Step 7
- [ ] Run the two AC-2 sign-off greps before rewording and stop to ask the operator if either fails; record the follow-ups, the C-14 UI disposition and the R-6 grep result; fix "about 24 call-site edits" to 18. — Step 8
- [ ] File `fix-trading-grpc-status-mapping` (`trading.go:223-237`, four-code collapse) and `fix-portfolio-grpc-ctx-mapping` (D-6 symmetry) through the allocator. — after Step 8
- [ ] C-16 promotion: AC-1/AC-2 → marketdata acceptance suite, AC-3/AC-4 → portfolio suite, f148 `@AC-4` gains the duplicate-name case. — integration PR
- [ ] Optional non-blocking `merge-order.md` note for the shared `portfolio_service.go`. — router / integration PR

## Files Modified

- No service code changed yet; execute has started but no step has completed.
- `docs/roadmap/features/326-fix-grpc-status-mapping/implementation-spec.md` — written in sdd-spec, patched in sdd-review, re-specced for steps 2, 3 and 6 in `498e07c0`.
- `docs/roadmap/ledger/insights.md` — union-resolved merge conflict in the main-dev sync merge `c1b5428f`.
- Feature dir: status.md, feature.md, product-spec.md, acceptance.feature, context.md (triage); recon.md, debate.md, design.md (design).
- `docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.status` and `docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.status` — stamped `triaged` at triage.

## Superseded Sessions

### 2026-11-10 — /sdd-triage
- Clustered two SEV-3 defect reports (`docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md`, `…-portfolio-watchlist-duplicate-returns-internal-defect.md`) into Track C; shared cause: Go error boundaries collapse distinct classes into INTERNAL.
- Escalated to full design depth: ≥2 services plus named UI/agent consumers.

### 2026-11-10 — sdd-review product-spec
- Approved, draft → spec-ready. Accepted the bug-template convention (no FR-N/@FR tags, no Consumer Surface section) — the r3 rationale relies on this record.
- AC-2 covered only GetSectorHistory among the raw-return RPCs.

### 2026-11-11 — sdd-batch design gate (round 2)
- Halted at the gate; adversary verdict SOUND; O-1..O-6 closed, O-7..O-10 opened (non-blocking). Full synthesis, rejected alternatives and risks are in the fence below.
```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round 2 synthesis. The adversary verdict is SOUND, and the r2 proposal is adopted with the adversary's precision fixes folded in. This approach honors D-1 through D-4 and keeps R-1 through R-4 off the table.\n\n1. **Marketdata translator, ctx-aware** (services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:513-532).\n   - New signature: `toGRPCError(ctx context.Context, err error) error`. I verified 19 call sites (`:316-500`). The signature change makes the compiler reject any site that does not pass the inbound gRPC ctx.\n   - Branch order:\n     - (a) If `errors.As` finds a `*connect.Error` whose code is neither CodeInternal nor CodeUnknown, return `status.Error(codes.Code(c.Code()), c.Message())` (D-1).\n     - (b) Else, if `ctx.Err()` is DeadlineExceeded, return `status.Error(codes.DeadlineExceeded, \"deadline exceeded\")`. If it is Canceled, return `status.Error(codes.Canceled, \"request canceled\")`. Both messages are fixed text (D-2). No err text goes into the status or any log. At most a fixed-label error class goes into a span attribute.\n     - (c) Else return `status.Error(codes.Internal, …)` with today's message (pins @AC-53).\n   - Branch (b) covers every Internal wrap with no service-site edits, so R-3 is honored:\n     - classification_service.go:120,140,171\n     - marketdata_service.go:1825,1838,1885,1893,2009,2249\n     - handler wraps :90,102,114,126,202,228\n     - the forwardConnectErr Internal fallthrough :299\n   - Detached budgets use `context.WithoutCancel` (marketdata_service.go:672,915,946), so they stay INTERNAL (R-2).\n   - Out of scope, with a one-line note in the spec: streaming handlers that return a raw ctx.Err() (`:52,78`, `:440,460`), and forwardConnectErr itself.\n\n2. **Portfolio translator** (services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:443-464).\n   - Branch (a) cast, then the Internal default. The signature does not change.\n   - The existing DeadlineExceeded/Canceled cases at `:457-460` are preserved by the cast.\n   - GetPnL keeps its ctx-first `classifyGetPnLError` (`:427-433`).\n   - The asymmetry with marketdata is a deliberate, accepted scope limit. It is recorded in context.md as a named follow-up, not only as an assumption.\n\n3. **Portfolio classifier** (services/xstockstrat-portfolio/internal/service/portfolio_service.go).\n   - Add an unexported `classifyWatchlistWriteErr(err)` and a const `watchlistNameUniqueIdx = \"watchlists_user_name_not_system_uidx\"` (migrations/011:20).\n   - It returns CodeAlreadyExists with the fixed text \"a watchlist with this name already exists\" only when the error is 23505 on that ConstraintName. Anything else returns CodeInternal (D-3).\n   - It is called at all three name-write sites:\n     - CreateWatchlist :2194-2196\n     - the UpdatePartial mask path :2314, after the ErrWatchlistNotFound check at :2311-2313\n     - the legacy replace-all :2337-2339\n   - classifyConsumerErr/boundedRetry (:1470-1496) is untouched.\n\n4. **Tests**\n   - **marketdata_handler_test.go**\n     - Table over connect codes 1-16 with a live ctx.\n     - Expired ctx with CodeInternal gives DEADLINE_EXCEEDED; canceled ctx gives CANCELLED.\n     - Expired ctx with CodeUnavailable wrapping a deadline stays UNAVAILABLE.\n     - A wrapped `*url.Error` carrying apikey= produces a message with no `apikey=` or `token=`.\n     - Alive ctx with a plain error gives INTERNAL with the message intact (@AC-53).\n     - AC-2 chain test: `svc := &service.MarketDataService{}`, then `SetClassification(fake, nil, nil)`, then `NewMarketDataHandler(svc).GRPCHandler().GetSectorHistory(expiredCtx, req)`. The request must have a non-empty Symbols, because classification_service.go:151-154 returns early on an empty set (verified). The fake's SectorHistory returns ctx.Err(). The test asserts the handler returns codes.DeadlineExceeded through the real Internal wrap at :171.\n     - Fallback if the zero-value service panics in markClassDemand: put the test in package service.\n   - **portfolio_handler_test.go**: add AlreadyExists, Aborted and Unknown rows to TestToGRPCError (:85-105).\n   - **watchlist_service_test.go**: add injectable createErr/updateErr/updatePartialErr fields on fakeWatchlistStore, then assert:\n     - 23505 on the name index gives AlreadyExists for Create, the masked rename and the legacy rename.\n     - 23505 on another ConstraintName gives Internal.\n     - 08006 and plain errors give Internal (AC-4).\n   - **portfolio_grpc_wire_test.go** (verified harness at :23 wireAdapter, :35 wantCode): one AC-3 end-to-end test. It injects the 23505 name-index error into the fake store and asserts codes.AlreadyExists through the service→adapter wire.\n   - **Agent, test only (C-14)**: tests/test_watchlist_tools.py, add `test_manage_watchlist_create_duplicate_surfaces_already_exists`, using the AioRpcError shape at :87.\n   - UI: no change.\n\n5. **Spec edits**\n   - Reword AC-2's Then to the server-side form \"the handler returns gRPC status DEADLINE_EXCEEDED\". No socket-level e2e guard.\n   - Correct the product-spec Observed line (\"sector RPCs return raw\" is wrong; they wrap as Internal).\n   - Replace the open-ended caller audit with the argument that reclassification happens only when the inbound ctx has already expired, so the caller's client has already produced DEADLINE_EXCEEDED/CANCELLED. Keep only a bounded grep for callers that branch on INTERNAL specifically from marketdata RPCs.\n   - Record two named follow-ups in context.md: `fix-trading-grpc-status-mapping` (trading.go:223-237) and portfolio ctx-aware translator symmetry.\n\nBuild order:\n1. Marketdata translator, the 19 call sites and its tests.\n2. Portfolio translator and its test.\n3. Classifier, the three sites, the fake-store tests and the wire test.\n4. Agent test, the context.md follow-ups, the spec corrections and the C-16 promotion notes.",
    "open_objections": [
      {
        "text": "AC-2's Then must be reworded to a server-side assertion (the handler returns DEADLINE_EXCEEDED). On a real wire the client raises DEADLINE_EXCEEDED by itself whatever the server sends, so the current wording cannot tell buggy code from fixed code. No socket-level e2e may serve as the regression guard.",
        "blocking": false
      },
      {
        "text": "The AC-2 chain test must pass a non-empty Symbols. GetSectorHistory returns early on an empty set (classification_service.go:151-154) before it reaches the store.",
        "blocking": false
      },
      {
        "text": "AC-3 needs one end-to-end test through the existing portfolio wire harness (portfolio_grpc_wire_test.go wireAdapter/wantCode). The translator table and the service-level tests alone leave two unconnected halves.",
        "blocking": false
      },
      {
        "text": "Branch (b) must not log err.Error() to recover diagnostics, because the wrapped chain can carry a vendor apikey= URL. At most a fixed-label error class goes into a span attribute or log, and the spec must say so.",
        "blocking": false
      },
      {
        "text": "The portfolio no-ctx asymmetry must be recorded as a named follow-up in context.md, not only as an assumption.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-53",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-54",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 (feature 294)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 (feature 254)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 (feature 254)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6/@AC-7 (feature 127)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Symmetric toGRPCError(ctx, err) in portfolio. It means about 19 call-site edits in a file that peers 311/312/315/317 already conflict on, to fix a code that clients already see on their own side. No AC requires it, so it is deferred to a named follow-up.",
      "Asserting the server-side status through the f274 duration-histogram attribute. It needs an OTel reader in the test and is heavier than the adapter chain test, which already pins the server-side status.",
      "A socket-level e2e as the AC-2 regression guard. It is a false green, because the client's own deadline produces DEADLINE_EXCEEDED regardless of what the server sends.",
      "A generic 23505 → AlreadyExists repo classifier. It would misclassify binding-duplicate and system-index 23505s and risk the consumer park semantics (@AC-8 f294).",
      "An open-ended audit of every marketdata caller before execute. It is unbounded, and largely moot, because reclassification happens only when the caller's own ctx has already fired."
    ],
    "open_risks": [
      "Peer-batch overlap: fix-marketdata-miss-path-noise, fix-vendor-key-in-url and fix-mcp-deadline-budget may touch marketdata_handler.go or the same error paths. There is merge-order and conflict risk, and @AC-5/@AC-7 f254 must be re-checked after both land.",
      "Zero-value MarketDataService plus SetClassification(fake, nil, nil) may panic in markClassDemand when driven from the handler package. The fallback is to put the chain test in package service.",
      "The generic cast depends on connect-go codes 1-16 matching grpc-go numerically. The table test pins this, but a connect-go renumbering would only surface in CI.",
      "Trading's identical translator and portfolio's no-ctx translator stay defective until the named follow-ups are filed through the allocator.",
      "The @feature-148 durable-rule tag number is still uncaptured and is needed at C-16 promotion.",
      "Branch (b) replaces a genuine non-context Internal failure that coincides with an expired caller deadline with fixed text, so that diagnostic is lost from the status by design."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03"
    ],
    "rationale": "The r2 proposal answers both blocking objections concretely.\n- O-1: it adopts the D-2 ctx-aware ordering with a compile-time signature change. It uses a real service→handler chain test through the Internal wrap at classification_service.go:171. The audit shows every listed Internal wrap is covered by branch (b) with no per-site edits.\n- O-2: the classifier is applied at the mask path (:2314) and the legacy path (:2337-2339), each with its own test.\n\nThe non-blocking objections are also answered:\n- O-3: trading is a named follow-up.\n- O-4: the context-mapped messages are fixed text, with a no-apikey= assertion.\n- O-5: the cast runs first, and there are UNAVAILABLE-wrapping-deadline and alive-ctx INTERNAL pins.\n- O-6: there is a translator row plus a different-ConstraintName test that stays INTERNAL.\n\nThe adversary found no floor breach or register violation. I verified its precision points:\n- GetSectorHistory returns early on an empty Symbols (classification_service.go:151-154).\n- The portfolio wire harness exists (portfolio_grpc_wire_test.go:23,35).\n- The handler has 19 toGRPCError call sites.\n\nThese are folded into the approach as non-blocking spec and test requirements. The AC-2 server-side rewording follows from P-03 test truthfulness: on the wire, the client's own deadline makes the current wording unfalsifiable. The portfolio asymmetry is accepted under C-18 as a recorded follow-up.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "AC-2's Then is reworded to the server-side form (the handler returns gRPC status DEADLINE_EXCEEDED). It is proven by an adapter-level chain test, GetSectorHistory with a non-empty Symbols and an expired ctx, through the real Internal wrap. No socket-level e2e serves as the guard.",
          "evidence": "classification_service.go:151-154 empty-symbols early return and :171 Internal wrap (verified); the client-side deadline masks the server status on the wire (adversary r2)."
        },
        {
          "text": "Portfolio toGRPCError gets the numeric cast only, with no ctx parameter. The asymmetry with marketdata is recorded as a named follow-up in context.md, alongside fix-trading-grpc-status-mapping.",
          "evidence": "portfolio_handler.go:443-464, :427-433 GetPnL ctx-first precedent; trading.go:223-237; peer conflicts on portfolio_service.go (311/312/315/317)."
        },
        {
          "text": "AC-3 is pinned end to end through the existing portfolio wire harness (wireAdapter/wantCode), with a 23505 name-index error injected into the fake store, in addition to the translator-table and service-level tests.",
          "evidence": "services/xstockstrat-portfolio/internal/service/portfolio_grpc_wire_test.go:23,35 (verified); insights ~L3861 service-without-translator trap; fails.md:566."
        },
        {
          "text": "Branch (b) logs no err text. At most a fixed-label error class goes into a span attribute or log.",
          "evidence": "Vendor *url.Error apikey= exposure (@AC-5/@AC-7 f254); R-4."
        }
      ],
      "new_rejected": [
        {
          "text": "A socket-level e2e as the AC-2 regression guard.",
          "why": "The client's own propagated deadline yields DEADLINE_EXCEEDED regardless of the server status, so the test would be a false green."
        },
        {
          "text": "An open-ended audit of all marketdata callers' handling of DEADLINE_EXCEEDED vs INTERNAL before execute.",
          "why": "It is unbounded and largely moot, because reclassification occurs only when the inbound ctx has already expired. A bounded grep for INTERNAL-specific branches on marketdata RPCs replaces it."
        }
      ],
      "new_objections": [
        {
          "text": "AC-2's Then must be reworded server-side, and the chain test must use a non-empty Symbols.",
          "blocking": false
        },
        {
          "text": "Add one AC-3 end-to-end test through the portfolio wire harness.",
          "blocking": false
        },
        {
          "text": "No err.Error() logging in branch (b); fixed-label error class only.",
          "blocking": false
        },
        {
          "text": "Record the portfolio no-ctx asymmetry as a named follow-up in context.md.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Adopted the D-2 ctx-aware ordering with a compile-time signature change across the 19 call sites. The AC-2 chain test goes through the real Internal wrap at classification_service.go:171, and the audit shows every listed Internal wrap is covered by branch (b) with no site edits."
        },
        {
          "id": "O-2",
          "how": "classifyWatchlistWriteErr is applied at the UpdatePartial mask path (:2314) and the legacy rename (:2337-2339) as well as CreateWatchlist, each with a fake-store test."
        },
        {
          "id": "O-3",
          "how": "Trading recorded as the named follow-up fix-trading-grpc-status-mapping in context.md."
        },
        {
          "id": "O-4",
          "how": "Fixed-text context messages, with a test asserting no apikey=/token= when the wrapped *url.Error carries apikey=."
        },
        {
          "id": "O-5",
          "how": "The cast runs first for all codes except Internal/Unknown. There is an UNAVAILABLE-wrapping-deadline test and an alive-ctx plain-error INTERNAL test (@AC-53)."
        },
        {
          "id": "O-6",
          "how": "AlreadyExists row in TestToGRPCError, plus a 23505 test on a different ConstraintName that stays INTERNAL."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

### 2026-11-13 — sdd-batch design gate (round 3)
- Halted at the gate, SOUND. O-7..O-10 closed; opened O-11 (wireAdapterFor seam), O-12 (index alias + migration guard), O-13 (R-2 pin row), O-14 (branch-(b)-only apikey scope), O-15 (C-14 UI disposition with evidence).
- The approach adopts these as D-9..D-13 (the fence JSON does not carry the O-/D- numbers, so this line must stay).
```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 synthesis. The adversary's verdict is SOUND, with no floor breach and no register violation. I adopt the r3 proposal in full; it adds nothing new to D-1 through D-8. I fold in the adversary's test-seam and record-keeping fixes after checking them against the code. R-1 through R-6 stay off the table.\n\n1. **Marketdata translator** (services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:513-532)\n   - Signature becomes `toGRPCError(ctx context.Context, err error) error`. All 19 adapter call sites (:316-500) pass the inbound ctx, and the compiler enforces this.\n   - Branch order:\n     - (a) A `*connect.Error` whose code is not Internal or Unknown returns `status.Error(codes.Code(c.Code()), c.Message())` (D-1).\n     - (b) Otherwise, if `ctx.Err()` is set, return DeadlineExceeded with \"deadline exceeded\" or Canceled with \"request canceled\". Both messages are fixed text. No err text goes into any log, span or status. At most a fixed-label class attribute is added (D-2, D-8).\n     - (c) Otherwise, return today's Internal with today's message, unchanged (@AC-53).\n   - The spec must state that branch (c), and the blanket-Internal handler wraps (:90, :102, :114, :126, :202, :228), still carry `err.Error()` text (:531) when the ctx is alive. That exposure exists today, this feature does not widen it, and it is out of scope. The no-apikey= test is a branch (b) guarantee, not a general redaction guarantee.\n   - Also out of scope: the streaming handlers' raw `ctx.Err()` returns (:440, :460) and `forwardConnectErr` itself (:294-300).\n\n2. **Portfolio translator** (services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:443-464)\n   - Cast plus the Internal default, with no ctx parameter (D-6).\n   - GetPnL keeps `classifyGetPnLError` (:427-433).\n\n3. **Portfolio classifier** (services/xstockstrat-portfolio/internal/service/portfolio_service.go)\n   - Add `classifyWatchlistWriteErr(err)` and an unexported const `watchlistNameUniqueIdx = \"watchlists_user_name_not_system_uidx\"` (migrations/011_watchlist_system_managed_source.up.sql:20).\n   - It returns AlreadyExists with fixed text only when the error is 23505 on that ConstraintName. Anything else returns Internal (D-3).\n   - Call sites:\n     - CreateWatchlist :2194-2196\n     - the UpdatePartial mask path :2314\n     - the legacy rename :2337-2339\n\n4. **Test seams** (portfolio, internal/service)\n   - Add `createErr`, `updateErr` and `updatePartialErr` fields to `fakeWatchlistStore` (watchlist_service_test.go:32). `Create` (:82) and the update methods return the error when it is set.\n   - Changes to export_test.go:\n     - Add the setter `SetWatchlistCreateErr(svc *PortfolioService, err error)`.\n     - Add the alias `WatchlistNameUniqueIdx = watchlistNameUniqueIdx` next to the `CtxWithUser`/`Guard` aliases (:35-38), so the external test package never retypes the index literal (C-18).\n   - Refactor the wire harness. Verified this round: `wireAdapter` (portfolio_grpc_wire_test.go:23-26) builds the service internally and returns only the adapter, so the test has no svc to inject into.\n     - Extract `wireAdapterFor(svc *service.PortfolioService) portfoliov1.PortfolioServiceServer`, which returns `handler.NewPortfolioHandler(svc).GRPCHandler()`.\n     - `wireAdapter` then calls `wireAdapterFor(service.NewWireTestService(t, l, positions...))`.\n\n5. **Tests**\n   - **marketdata_handler_test.go** (package handler):\n     - Table over connect codes 1-16 with a live ctx.\n     - Expired ctx plus Internal gives DEADLINE_EXCEEDED. A canceled ctx gives CANCELLED.\n     - Expired ctx plus Unavailable wrapping a deadline stays UNAVAILABLE.\n     - New R-2 pin row: a live inbound ctx plus `connect.NewError(connect.CodeInternal, context.DeadlineExceeded)` gives INTERNAL. This guards against a later errors.Is \"simplification\".\n     - Alive ctx plus a plain error gives INTERNAL with the message intact (@AC-53).\n     - With an expired ctx, a wrapped `*url.Error` carrying `apikey=x` yields a message containing neither apikey= nor token=.\n     - AC-2 chain test:\n       - Define a minimal local 5-method classification-store stub; `fakeClassStore` is unreachable from package handler.\n       - Build the service with `&service.MarketDataService{}` plus `SetClassification(stub, nil, nil)`.\n       - Call `NewMarketDataHandler(svc).GRPCHandler().GetSectorHistory(expiredCtx, &GetSectorHistoryRequest{Symbols: []string{\"AAPL\"}})`. The stub's `SectorHistory` returns `ctx.Err()`.\n       - Assert DeadlineExceeded through the real Internal wrap at classification_service.go:171.\n       - The zero-value panic risk is retired: `markClassDemand` initializes lazily (:67-72), and GetSectorHistory uses only `class.store` (:150-171).\n   - **portfolio_handler_test.go**: add AlreadyExists, Aborted and Unknown rows to TestToGRPCError.\n   - **watchlist_service_test.go**:\n     - 23505 on the name index gives AlreadyExists, at each of the three sites.\n     - 23505 on another ConstraintName (binding table, watchlist_repo.go:54) gives Internal.\n     - 08006 and plain errors give Internal (AC-4).\n     - Schema-tie guard test: read migrations/011_watchlist_system_managed_source.up.sql and assert it contains `WatchlistNameUniqueIdx`. This catches a later rename of the index.\n   - **portfolio_grpc_wire_test.go**: `TestWire_CreateWatchlistDuplicateName_AC3` runs `svc := service.NewWireTestService(t, &testdata.Ledger{})`, then `service.SetWatchlistCreateErr(svc, &pgconn.PgError{Code: \"23505\", ConstraintName: service.WatchlistNameUniqueIdx})`, then `wantCode(..., codes.AlreadyExists)` via `wireAdapterFor(svc)`. A second row with 08006 expects codes.Internal (AC-4).\n     - The path is verified: `refuseUnservable` returns early at :569 for an empty binding set, and handler CreateWatchlist passes the error through raw (portfolio_handler.go:166-170).\n   - **Agent, test only**: `test_manage_watchlist_create_duplicate_surfaces_already_exists` (tests/test_watchlist_tools.py). `_PASS_THROUGH_CODES` already contains ALREADY_EXISTS (app/tools.py:231).\n   - **UI**: no code change. The C-14 disposition is recorded with evidence:\n     - insightsBff.ts:136 `forward`\n     - bffShared.ts:199-209 passes the body through unchanged\n     - insights/watchlists/page.tsx:119-120 renders `.message`\n     - The user-visible text changes from raw pgx \"insert watchlist: ERROR: duplicate key value violates unique constraint ...\" to the fixed ALREADY_EXISTS text. This must be recorded in context.md (and optionally covered by a duplicate-name e2e mock).\n\n6. **Spec and record edits**\n   - In acceptance.feature, keep the `@AC-2` ID (C-15 append-only). Reword it:\n     - Given: \"the classification store returns the caller's expired context error for a non-empty symbol set\".\n     - Then: \"the GetSectorHistory handler returns gRPC status DEADLINE_EXCEEDED, not INTERNAL\".\n   - The absence of @FR-N tags is the bug-template convention already logged at context.md:24, so it needs no new tagging.\n   - Correct the product-spec Observed line: the sector RPCs wrap as Internal; they do not return raw errors.\n   - In context.md, record:\n     - the follow-ups `fix-trading-grpc-status-mapping` (trading.go:223-237) and `fix-portfolio-grpc-ctx-mapping` (portfolio D-2 symmetry), each with its scope and deferral reason\n     - the UI message-change disposition\n     - the bounded R-6 grep result (no non-test caller branches on INTERNAL from a marketdata RPC, and no marketdata site emits a newly passed-through code)\n\nBuild order:\n1. Marketdata translator, the 19 call sites, and its tests (including the R-2 pin and the chain test).\n2. Portfolio translator and its test.\n3. Classifier and its three sites, the fake-store fields, the export_test.go setter and alias, the `wireAdapterFor` refactor, the service, wire and schema-guard tests.\n4. Agent test, the AC-2 rewording, the product-spec correction, and the context.md follow-ups, UI disposition and grep result.",
    "open_objections": [
      {
        "text": "O-8 seam: wireAdapter (portfolio_grpc_wire_test.go:23-26) returns only the adapter, so the AC-3 wire test cannot reach the svc that SetWatchlistCreateErr needs. Fix: extract wireAdapterFor(svc) and have wireAdapter call it. The proposer has not yet adopted this.",
        "blocking": false
      },
      {
        "text": "The watchlist name-index literal must not be typed a second time in test code. Export the alias WatchlistNameUniqueIdx from export_test.go, and add a guard test asserting that migrations/011_watchlist_system_managed_source.up.sql contains it. Without the guard, renaming the index would silently send duplicates back to INTERNAL while all fake-store tests stay green.",
        "blocking": false
      },
      {
        "text": "Add a pin row for R-2 to the marketdata toGRPCError table: a live inbound ctx with connect.NewError(CodeInternal, context.DeadlineExceeded) must return INTERNAL.",
        "blocking": false
      },
      {
        "text": "The spec must state that branch (c), and the blanket-Internal handler wraps (:90/:102/:114/:126/:202/:228), keep err.Error() text unchanged on a live ctx, and that this is out of scope. The no-apikey= test runs only with an expired ctx, so it proves branch (b) alone.",
        "blocking": false
      },
      {
        "text": "C-14: record the UI disposition with its evidence (insightsBff.ts:136, bffShared.ts:199-209, watchlists/page.tsx:119-120) and the user-visible message change, from raw pgx duplicate-key text to the fixed ALREADY_EXISTS text. A bare 'UI: none' is not enough.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-53",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-54",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 (feature 294)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 (feature 254)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 (feature 254)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6/@AC-7 (feature 127)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "NewWireTestServiceWithStore constructor variant for O-8 (the proposer's runner-up). It opens a wider seam than a single error injection needs. One setter export plus wireAdapterFor is the smaller change (C-18).",
      "Inlining handler.NewPortfolioHandler(svc).GRPCHandler() in the AC-3 wire test. It works, but it duplicates the harness construction line that wireAdapterFor centralizes.",
      "Moving fakeClassStore into internal/testdata so the handler package can reach it. That couples test files that change for unrelated reasons, and C-13 governs domain data, not test doubles. A minimal local 5-method stub in marketdata_handler_test.go wins.",
      "Symmetric toGRPCError(ctx, err) in portfolio now. It means about 19 call-site edits in a file where peers 311/312/315/317 conflict, it is not required by any AC, and it is deferred to fix-portfolio-grpc-ctx-mapping (D-6).",
      "A generic 23505 to AlreadyExists repo classifier. It would misclassify binding-duplicate and system-index 23505s and risk the consumer park semantics (@AC-8 f294) (D-3)."
    ],
    "open_risks": [
      "Peer-batch merge overlap. The ctx parameter rewrites all 19 call sites in marketdata_handler.go, which fix-marketdata-miss-path-noise, fix-vendor-key-in-url and fix-mcp-deadline-budget may also edit. The three name-write sites are in portfolio_service.go, which peers 311/312/315/317 also edit. The compile-time signature change catches a dropped ctx arg but not a reintroduced raw Internal wrap or a lost classifier call. Re-run @AC-5/@AC-7 f254 and the AC-3 wire test after merge.",
      "The generic cast assumes connect-go codes 1-16 match grpc-go numerically. The table test pins this, but a renumbering would surface only in CI.",
      "Trading's identical translator and portfolio's ctx-unaware translator stay defective until the named follow-ups are filed through the allocator.",
      "When a genuine non-context Internal failure coincides with an expired caller deadline, the status shows the fixed context text, so that diagnostic is lost from the status by design.",
      "Branch (c) and the blanket-Internal handler wraps still carry vendor-chain err text on a live ctx. This pre-existing exposure is explicitly out of scope and must not be read as fixed.",
      "The @feature-148 durable-rule tag number has not been captured yet. It is needed at C-16 promotion.",
      "Assumptions not yet compiled: that repository.ClassificationRow can be imported from the handler test package, and that the agent test shape at tests/test_watchlist_tools.py:87 is unchanged since round 2."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03"
    ],
    "rationale": "The r3 proposal concretely answers all four open objections from round 2:\n- **O-7:** AC-2's Given and Then are reworded server-side. The chain test uses Symbols:[\"AAPL\"], so it gets past the early return at classification_service.go:151-154 and reaches the Internal wrap at :171. The adversary verified the zero-value claims (markClassDemand :67-72, store-only use :150-171), so the earlier panic risk is retired.\n- **O-8:** a wire test with a fake-store error field and an export setter. This closes on the condition that the wireAdapterFor seam fix is adopted, and that fix is carried as new objection O-11.\n- **O-9:** a spec clause plus a no-apikey= assertion. The scoping caveat that branch (c) is unchanged is carried forward.\n- **O-10:** two named follow-ups go in context.md.\n\nI checked the adversary's main new finding against the code this round. wireAdapter (portfolio_grpc_wire_test.go:23-26) returns `handler.NewPortfolioHandler(service.NewWireTestService(...)).GRPCHandler()`, which gives the test no service handle. NewWireTestService hard-wires `svc.watchlists = newFakeStore()` (export_test.go:23). So the proposed test cannot be written without the wireAdapterFor split. I also confirmed that the index name appears only in migration 011 (:20 up, :9 down), so a guard test against that file is cheap and meaningful.\n\nThe proposer did not address the adversary's other items (an R-2 pin row, the branch (c) scope statement, the C-14 UI disposition, the C-18 literal alias). They are new this round, so they are recorded as non-blocking open objections, and the approach adopts the fixes.\n\nThe C-15 @FR-N concern is already answered on record. context.md:24 logs the bug-template convention (no FR-N or @FR tags) as an accepted review warning, so I did not raise a new objection; the approach only keeps @AC-2 append-only.\n\nNo objection is blocking, and no floor breach or register violation was found. The design is ready to be approved once the proposer adopts these test-seam and record-keeping fixes.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The AC-3 wire test reaches the service through a wireAdapterFor(svc *service.PortfolioService) helper extracted from wireAdapter, which then calls it. The store error is injected by one export_test.go setter, SetWatchlistCreateErr, backed by createErr/updateErr/updatePartialErr fields on fakeWatchlistStore.",
          "evidence": "portfolio_grpc_wire_test.go:23-26 (wireAdapter returns only the adapter; verified r3); export_test.go:19-24 (NewWireTestService hard-wires newFakeStore()); watchlist_service_test.go:32,82."
        },
        {
          "text": "export_test.go exports WatchlistNameUniqueIdx as an alias of the unexported const. A guard test asserts that migrations/011_watchlist_system_managed_source.up.sql contains the index name.",
          "evidence": "The index name is defined only at migrations/011_watchlist_system_managed_source.up.sql:20 (down :9), verified r3. Existing alias precedent: export_test.go:35-38 (CtxWithUser/Guard)."
        },
        {
          "text": "The marketdata toGRPCError table carries an R-2 pin row: a live inbound ctx with connect.NewError(CodeInternal, context.DeadlineExceeded) must return INTERNAL.",
          "evidence": "R-2 (detached singleflight/batch-budget timeouts); detached budgets use context.WithoutCancel at marketdata_service.go:672,915,946."
        },
        {
          "text": "The spec states that branch (c), and the blanket-Internal handler wraps, keep their err.Error() text on a live ctx, and that this is out of scope. The no-apikey= assertion runs with an expired ctx and is scoped to branch (b) only.",
          "evidence": "marketdata_handler.go:531 and handler wraps :90,:102,:114,:126,:202,:228 (adversary r3); @AC-5/@AC-7 f254."
        },
        {
          "text": "The AC-2 chain test uses a minimal local 5-method classification-store stub in marketdata_handler_test.go, driving a zero-value MarketDataService plus SetClassification(stub, nil, nil). There is no package-service fallback.",
          "evidence": "classification_service.go:22-28,52 (seam), :67-72 (markClassDemand lazy init), :150-171 (store-only path); fakeClassStore at classification_service_test.go:18 is unreachable from package handler."
        }
      ],
      "new_rejected": [
        {
          "text": "A NewWireTestServiceWithStore constructor variant to inject store errors for the AC-3 wire test.",
          "why": "It is a wider seam than one error injection needs. One setter export plus wireAdapterFor is smaller (C-18)."
        },
        {
          "text": "Moving fakeClassStore into internal/testdata so the marketdata handler package can reuse it.",
          "why": "It couples test files that change for unrelated reasons, and C-13 governs domain data, not doubles. A minimal local stub is the right fit."
        }
      ],
      "new_objections": [
        {
          "text": "O-8 seam: wireAdapter returns only the adapter. Extract wireAdapterFor(svc) so the AC-3 wire test can inject the store error.",
          "blocking": false
        },
        {
          "text": "Do not retype the name-index literal in tests. Export the WatchlistNameUniqueIdx alias and add a guard test tying it to migration 011.",
          "blocking": false
        },
        {
          "text": "Add the R-2 pin row: a live ctx with CodeInternal wrapping context.DeadlineExceeded returns INTERNAL.",
          "blocking": false
        },
        {
          "text": "The spec must scope the no-apikey= guarantee to branch (b) and state that branch (c) and the handler-wrap text exposure on a live ctx are unchanged and out of scope.",
          "blocking": false
        },
        {
          "text": "C-14: record the UI disposition with its evidence and the user-visible message change from raw pgx text to the fixed ALREADY_EXISTS text.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-7",
          "how": "AC-2's Given and Then are reworded server-side, keeping the @AC-2 ID. The chain test uses Symbols:[\"AAPL\"] through the Internal wrap at classification_service.go:171. The zero-value claims were verified (:67-72, :150-171)."
        },
        {
          "id": "O-8",
          "how": "AC-3 wire test TestWire_CreateWatchlistDuplicateName_AC3 with a fake-store createErr and the SetWatchlistCreateErr export, asserting AlreadyExists and, on an 08006 row, INTERNAL. The remaining harness-seam fix is tracked as a new objection (wireAdapterFor)."
        },
        {
          "id": "O-9",
          "how": "The spec states that branch (b) emits no err.Error() to any log, span or status, and a test asserts no apikey=/token= in the status message. Scoping it to branch (b) only is tracked separately."
        },
        {
          "id": "O-10",
          "how": "context.md names two follow-ups, fix-trading-grpc-status-mapping (trading.go:223-237) and fix-portfolio-grpc-ctx-mapping, each with its scope and deferral reason."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

### 2026-11-13 — sdd-design
- Operator approved at the round-3 gate; spec-ready → design-approved. Recon reuse: the `classifyConsumerErr` pgconn `errors.As` idiom and the `classifyGetPnLError` ctx-first precedent.
- Rejected R-1..R-8: errors.Is-only ctx mapping, per-site Internal-wrap removal, `FromContextError`/`err.Error()` text, socket e2e, open-ended caller audit, store-constructor variant, moving `fakeClassStore`.
- O-11..O-15 stay open in debate.md and are adopted as D-9..D-13; the C-16 operator sign-off record is hoisted to ## Decisions and the threads to ## Open Threads.

### 2026-11-13 — sdd-spec
- 8-step spec on `17abb21d`; design-approved → implementation-ready. Atomic units Steps 1+2 and 5+6, each with a RED order that fails behaviorally, not at compile time. Coverage: AC-1/AC-2 → Step 2, AC-3 → Steps 4/6/7, AC-4 → Step 6.
- Closed the uncompiled assumptions: `ClassificationRow` (`classification_repo.go:21`) and `classification.Action` import from package handler with no cycle; the agent AioRpcError shape at `:87-89` is unchanged.
- Its `tools.py` cites `:224-235`/`:229` are wrong and superseded (see the kept sdd-review session); the R-6, UI-reachability, f148 tag, binding-pkey and Step 7 findings are hoisted to the header.

## Session 2026-11-13 — sdd-review impl-spec (advisory)

- **Result:** PASS WITH WARNINGS. 0 failures, 8 warnings, no floor breaches. Overlap: WARN only, with
  no migration, proto-field or config-key collision. Advisory: lifecycle unchanged (`implementation-ready`).
- **Tree:** `origin/feature/fix-grpc-status-mapping` @ `58425e61`, re-checked against `origin/main-dev`
  @ `5c4cc935`. No marketdata or portfolio handler, service, repository or test file this spec touches
  changed on `main-dev`.
- **Addressed in implementation-spec.md:**
  - [x] Step 8: AC-2 rewording (C-15). Step 8 now cites where the operator sign-off is recorded
    (`design.md:256-257` and the sdd-design session's "C-16 operator sign-off" above). It says that C-15
    append-only covers scenario IDs, not wording, and that the `covered_by_operator_decision: false`
    gate snapshots predate the gate. It adds two Verification greps that confirm both records before
    the edit.
  - [x] Steps 2, 4 and 6: `GOWORK=off COVERPKGS=…` only set `GOWORK` for the assignment, so `go list`,
    `go test` and `go tool cover` ran without it. Each step now runs `export GOWORK=off && COVERPKGS=…`.
  - [x] Steps 1, 3 and 5: each now says its lint runs in the paired test step's Verification (2, 4, 6).
  - [x] Step 7: the agent `tools.py` cites were wrong. Re-verified on `main-dev` @ `5c4cc935`:
    `_PASS_THROUGH_CODES` is at `:226-237` (not `:224-235`) and `ALREADY_EXISTS` is at `:231` (not
    `:229`). The other cites hold: `_grpc_error_message` `:248`, pass-through `:274-275`,
    `manage_watchlist` `:2179`, create `:2234`, `except` `:2259-2267`. The branch numbers are corrected
    too (`:226-237`/`:231`, `:247`, `:2162`, `:2217`, `:2242-2250`). This corrects the
    `ALREADY_EXISTS :229` / `:224-235` cites in the sdd-spec session above.
  - [x] Step 6: the migration-guard test's relative path is not fragile, because `go test` runs each
    package with its own directory as the working directory. The spec now says so.
  - [x] Peer-merge overlap: the spec claimed `marketdata_handler.go` is shared with 317/320/314. It now
    says "may be shared (unverified)". None of those features' docs on `main-dev` or on their feature
    branches names that file (317 cites `internal/service/marketdata_service.go`, 320
    `internal/fmp/fmp_client.go`, 314 agent `tools.py`).
  - [x] Execution Summary: the marketdata findings row is at `:24` on `main-dev` (`:23` on the branch).
- **No change needed:**
  - C-08 coverage: the 40% total check is a no-regression guard only, because `handler/` and `service/`
    are excluded from coverage. The spec already says so; the named `go test -run` commands are the
    real verification.
  - Step 1 branch (c) keeps `err.Error()` on a live ctx. This is the recorded out-of-scope item D-12,
    and Step 1 Instruction 4 puts it in the PR body (design-quality note).
- **Overlap findings (WARN):**
  - `portfolio_service.go` is shared with 311, 312, 315 and 317. The hunks differ, so the risk is a
    textual merge conflict only.
  - `marketdata_handler.go` overlap with 317/320/314 is unverified (above).
  - `tools.py` is edited by 334/335 but not by 326; Step 7 edits only `tests/test_watchlist_tools.py`.
  - `merge-order.md` has no 326 entry, and none is required at WARN level. The router decides whether
    to add a non-blocking coordination note.
- **Housekeeping:** the husky pre-commit DRY step could not find `scripts/check-duplication.py` on this
  branch, which is behind `main-dev`. The hook did not block the commit, and `/sdd-execute`'s
  `main-dev` merge restores the script.

## Open Threads

- [ ] **Step 7 red N/A (P-06).** `/sdd-execute` must record "red N/A — no behavior change;
  characterization test added" in context.md and the PR body, and capture the green run. [Step 7]
- [ ] **Agent line numbers.** Use the `main-dev` `tools.py` numbers only after the `origin/main-dev`
  merge, and re-grep if `main-dev` has moved again. [Step 7]
- [ ] **Unverified `marketdata_handler.go` overlap.** Re-check when the 317/320/314 implementation
  specs land. Then re-run Step 2's tests and `@AC-5`/`@AC-7` f254 after each peer merge. [final
  integration PR]
- [ ] **Merge-order note.** Optionally add a non-blocking note to
  `docs/roadmap/features/merge-order.md` for the shared `portfolio_service.go` (311/312/315/317). This
  is outside this feature dir, so it is left to the router. [router / integration PR]
- [ ] **AC-2 sign-off check.** Before rewording, run Step 8's two sign-off greps; if either fails, stop
  and ask the operator. [Step 8]

## Session 2026-11-13 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation.** The operator approved the plan with this binding record (verbatim):
  ```json
  {"mainDev":"d5de836b1a99591c992a17b46a688469f5b1ae98","dev":"14e7214036a5fc5e9d5c1a3ac38efb1e394d744b","specHash":"d5323afd622a131e9e77a95070e8944082e606e2","directive":"conditional","pending":[1,2,3,4,5,6,7,8],"mismatches":[{"n":2,"detail":"Minor line drift, no impact on the instructions. The spec says GetSectorHistory returns early on an empty symbol set at services/xstockstrat-marketdata/internal/service/classification_service.go:151-154. On the merged tree (14e72140 + d5de836b, merge fbb8b081) the `if len(symbols) == 0 { return resp, nil }` block is at :153-155; the function starts at :150 and :151 is the normalizeSymbols call. Everything else in Step 2's evidence matches: the :171 CodeInternal wrap, the 5-method classificationStore at :22-28, SetClassification at :52, the lazy demand map at :67-72, the class field at marketdata_service.go:100, ClassificationRow at repository/classification_repo.go:21, Action at classification/sector.go:68, no import cycle (grep returns nothing), fakeClassStore at classification_service_test.go:18, NewMarketDataHandler at :27, GRPCHandler at :303, module path github.com/xstockstrat/marketdata, and the AC53/AC54/feature254 tests. The Files path marketdata_handler_test.go exists; it is package handler with a single test at :15."},{"n":3,"detail":"Minor count discrepancy, no impact because the signature is unchanged and no call site is edited. The spec says `toGRPCError` has 24 call sites in internal/handler/*.go. `grep -c 'toGRPCError('` counts 19 lines in portfolio_handler.go (18 call sites plus the definition at :443) and 5 in portfolio_handler_test.go, which is 24 matching lines in total. That leaves 18 production call sites and 23 references excluding the definition. Step 8's follow-up text (\"about 24 call-site edits\") inherits the same figure. The rest of Step 3's evidence matches: the definition at :443, the seven-case switch at :443-464 with no CodeAlreadyExists case, the handler CreateWatchlist at :166-172 that passes the error through raw, the adapter CreateWatchlist at :323-328 calling toGRPCError(err), and classifyGetPnLError at :427. The Files path exists."},{"n":6,"detail":"One evidence claim is inaccurate; the test design still stands. The spec says the other 23505 source, the portfolio.watchlist_symbols primary key (watchlist_symbols_pkey, migrations/007_watchlists.up.sql:16-20, confirmed), is reached through insertBindingsTx (watchlist_repo.go:54). But the per-binding INSERT that insertBindingsTx uses carries `ON CONFLICT (watchlist_id, symbol) DO NOTHING` (watchlist_repo.go:538), and the other insert path uses `DO UPDATE` (:554). So that primary key cannot raise 23505 on this path in practice. TestWatchlistWriteErr_OtherConstraintInternal is still valid as a synthetic guard against a generic 23505 mapping, but its rationale should not claim the conflict happens. Everything else in Step 6's evidence matches: fakeWatchlistStore at :32-44 with the listed fields, Create at :82, UpdatePartial at :93 (ErrWatchlistNotFound at :96), Update at :156, newSvc at :329, ctxWithUser at :334, wideCaps at :416, seedWatchlist at :746, and connect.CodeOf at :406. In export_test.go: line 23 is `svc.watchlists = newFakeStore()`, the alias block is at :35-38, and the header rule is at :3-4. In the wire test: wireAdapter at :23-26, wantCode at :35, TestWire_DeleteSystemManagedWatchlist_F127AC7 at :77-86, and 8 `wireAdapter(` references. Also confirmed: testdata.Ledger exists, the 23505 literal precedent at portfolio_sync_retry_test.go:162, loadOwned at portfolio_service.go:2282, refuseUnservable's early return at :569, the Verification run-filter tests TestWire251_ and TestBoundedRetry_AC8_ exist, and the index literal currently appears 0 times in internal/*.go. All three Files paths exist."}]}
  ```
- **Branch sync.** `origin/main-dev` (`d5de836b`) merged into `feature/fix-grpc-status-mapping` as
  `c1b5428f`; the one conflict (`docs/roadmap/ledger/insights.md`) was resolved by
  `scripts/merge-train-resolve.mjs` (union). `scripts/ledger-guard.py --fix` reported clean.
- **Re-spec (directive conditional, steps 2,3,6).** Commits in `git log --first-parent origin/main-dev..HEAD`:
  - `498e07c0` respec(fix-grpc-status-mapping): align steps 2,3,6 with current codebase
  Step 2 cites `:153-155`; Step 3 counts 18 production `toGRPCError` call sites plus 5 test
  references; Step 6 records that `watchlist_symbols_pkey` cannot raise 23505 on the create path
  (`ON CONFLICT … DO NOTHING`, `watchlist_repo.go:538`), so `TestWatchlistWriteErr_OtherConstraintInternal`
  is a synthetic guard. Step 8's "about 24 call-site edits" follow-up text was outside the re-spec
  scope and is unchanged; the accurate figure is 18 production call sites.
- **Tooling setup (steps 1-8, detection only):** go1.27 ✓ · golangci-lint ✗ v2.5.0 on PATH (wrong
  version → install pinned v2.14.0 per step with `GOTOOLCHAIN=go1.27.0 go install`; Go proxy
  reachable) · uv ✓ · ruff ✓ · python3.13 ✓ · pnpm ✓ (hook only; no Node step).
- Status `implementation-ready` → `in-progress`.

```sdd-batch-setup
{"mainDev":"d5de836b1a99591c992a17b46a688469f5b1ae98","date":"2026-11-13"}
```

## Session 2026-11-13 — /sdd-distill

- Distilled 6 sessions → header + Superseded Sessions; kept 2 verbatim.
- context.md 681 → 552 lines. Original prose preserved in git history.
