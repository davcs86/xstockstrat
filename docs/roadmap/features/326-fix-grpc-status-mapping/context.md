# Context Log: fix-grpc-status-mapping

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md — marketdata toGRPCError maps only six codes; everything else becomes INTERNAL (SEV-3)
  - docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md — CreateWatchlist returns INTERNAL on a duplicate watchlist name (SEV-3)
- Cluster rationale: both are Go-service error boundaries collapsing distinct error classes into gRPC INTERNAL; the shared fix is faithful status-code classification.
- Severity: SEV-3 (highest across reports)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), context.md; stamped both report sidecars `triaged`
- Affected services (from reports): xstockstrat-marketdata, xstockstrat-portfolio; consumers xstockstrat-ui, xstockstrat-agent
- Root cause hypothesis: blanket `Internal` default in marketdata `toGRPCError` plus raw-returning RPCs; no SQLSTATE 23505 classification in portfolio
- Recommended design depth: full → `/sdd-design fix-grpc-status-mapping` (rationale: SEV-3, but ≥2 affected services plus named consumer surfaces — rubric escalate signal)
- Development branch: feature/fix-grpc-status-mapping

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-2 covers only GetSectorHistory among raw-return RPCs
- Overlap findings: WARN: portfolio_service.go shared with 311/312/315/317
- Recommended design depth: full (marketdata + portfolio + ui/agent consumers)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-grpc-status-mapping` (full) halted at its approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md was not written and status.md is unchanged (spec-ready). Register: `debate.md` (State in-debate, Rounds run 2).

## Open Threads

- **Approach (r2 synthesis; adversary verdict SOUND).** It honors D-1..D-4 and keeps R-1..R-4 off the table.
  - **Marketdata.** `toGRPCError(ctx, err)` in `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:513-532`. The 19 call sites are compiler-forced to pass the inbound ctx. Branch order:
    - (a) A `*connect.Error` with any code other than Internal/Unknown gets the numeric cast `codes.Code(c.Code())`.
    - (b) If the inbound `ctx.Err()` is set, return DEADLINE_EXCEEDED/CANCELLED with fixed text. No err text goes into the status or a log.
    - (c) Otherwise return INTERNAL with today's message (@AC-53).
    - Branch (b) covers every Internal wrap with no per-site edits (R-3). Detached `context.WithoutCancel` budgets stay INTERNAL (R-2).
  - **Portfolio.** `toGRPCError` (`portfolio_handler.go:443-464`) gets the cast only, with no ctx parameter (D-6).
  - **Duplicate names.** A new `classifyWatchlistWriteErr` returns ALREADY_EXISTS only for 23505 on `watchlists_user_name_not_system_uidx`. It is applied at CreateWatchlist `:2194-2196`, the UpdatePartial mask path `:2314` and the legacy rename `:2337-2339` (D-3).
  - **Tests.** A translator table over connect codes 1-16. An AC-2 handler chain test through the real Internal wrap at `classification_service.go:171`, with a non-empty Symbols. Fake-store tests for all three rename/create sites. One AC-3 end-to-end test through `portfolio_grpc_wire_test.go` (D-7). An agent-side test only (C-14). UI unchanged.
- **Strongest open objection (non-blocking).** AC-2's Then must be reworded to the server-side form ("the handler returns gRPC status DEADLINE_EXCEEDED"). On a real wire the client's own deadline produces DEADLINE_EXCEEDED whatever the server sends, so the current wording cannot tell the fix from the bug. No socket-level e2e may serve as the guard (R-5).
- **Other open objections (non-blocking).**
  - O-7: the chain test needs a non-empty Symbols, because `classification_service.go:151-154` returns early on an empty set.
  - O-8: add the AC-3 wire-harness end-to-end test.
  - O-9: no `err.Error()` logging in branch (b); fixed-label error class only.
  - O-10: record the portfolio no-ctx asymmetry as a named follow-up.
- **Floor status.** No floor breaches. O-1..O-6 were closed in round 2. Nothing blocking remains open.
- **Uncovered @AC changes.** AC-1, AC-2 and AC-3 are CHANGE with `covered_by_operator_decision: false`, so they need operator sign-off at the gate. AC-4, @AC-53, @AC-54, @AC-14, @AC-8 (f294), @AC-5/@AC-7 (f254) and @AC-6/@AC-7 (f127) are PRESERVE.
- **Named follow-ups (to be filed through the allocator, not here).**
  - `fix-trading-grpc-status-mapping`: the identical collapse in `trading.go:223-237`.
  - Portfolio ctx-aware `toGRPCError` symmetry with marketdata.
- **Open risks.**
  - Peer overlap with fix-marketdata-miss-path-noise, fix-vendor-key-in-url and fix-mcp-deadline-budget (marketdata_handler.go). Re-check @AC-5/@AC-7 f254 after both land.
  - A zero-value `MarketDataService` may panic in `markClassDemand`. The fallback is to put the chain test in package service.
  - The cast depends on connect-go and grpc-go code numbering matching.
  - The @feature-148 durable-rule tag is still uncaptured for C-16.
  - Branch (b) masks a genuine Internal that coincides with an expired deadline, by design.

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
