# Context Log: fix-retired-surface-proto-cleanup

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-19-trading-mode-axis-retained-defect.md — Retired trading_mode axis still plumbed through watchers, marketdata and service docs (SEV-3)
  - docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md — Server-side opportunity sparkline removed but acceptance, proto field and agent projection remain (SEV-3)
  - docs/reports/2026-10-19-proto-contract-hygiene-defect.md — Proto contract hygiene drift (SEV-3)
- Cluster rationale: all three are residue of retired or drifting contract surfaces; they share one proto edit + buf breaking pass and one config-seed cleanup migration.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..3), context.md
- Affected services (from reports): packages/proto, analysis, indicators, ingest, trading, portfolio, marketdata, config, identity, ledger, notify, agent
- Root cause hypotheses: incomplete sweeps after features 147 and 227; no proto cleanup pass
- Recommended design depth: full → `/sdd-design fix-retired-surface-proto-cleanup` (rationale: proto change + config-seed migration + ≥2 affected services incl. xstockstrat-agent)
- Development branch: feature/fix-retired-surface-proto-cleanup

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); retired-key contracts (namespace-relative stored keys, migration shape) deferred; Q6 needs operator C-16 sign-off before /sdd-spec; first review FAILed crit 5 (fixed: classification table, breaking items out of scope); overlap FAIL with 330 resolved (330 owns the 028 TTL row)
- Overlap findings: WARN: indicators.proto with 310, trading.proto with 312, config.proto with 328; config migration NNN with 321/330; trading.broker.paper coordination with 321
- Recommended design depth: full (proto (non-breaking) + config migration; many services)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-10 (operator decisions before /sdd-design)

- C-16 sign-off: durable `@AC-8 @feature-191` loses its `BatchGetBars ... (sparkline)` clause (sparkline is client-side since feature 227); its other clauses stay.

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-retired-surface-proto-cleanup` (full) is halted at its approval gate after round 2 (gate policy: halt). design.md has not been written and status.md is unchanged. The register is in `debate.md` (D-1..D-10, R-1..R-6, O-1..O-3).

### Open Threads

- **Approach**:
  - Round-1 steps 1–8 stand as D-1..D-8: the proto deprecations/additions, a BatchGetBars enum-first read with both fields sent, no migration 048 plus a launch-gate query, agent parity excluding deprecated fields, and config-governance.md-only docs.
  - Round 2 settles the SnapshotOfflinePositions carrier (D-9). There is one hoisted `userID := req.UserId` under a scoped SA1019 nolint at trading.go:1174, and the handler :90 write keeps its own directive. The :1193-1194 ownership comment is rewritten, the signature is unchanged, and the ListOrders/GetOrder reads are untouched.
  - Round 2 also records the Go P-06 waiver accurately (D-10). The test call sites are updated first, and the resulting compile failure is the RED. If the tdd-gate rejects a compile RED, this is logged as a P-06 deviation.
- **Strongest open objection**: O-1 (non-blocking). `ComputeIndicatorRequest.timeframe_enum` has no reader or producer (C-18).
  - D-2 still recommends keeping it to satisfy AC-3.
  - It closes only on a recorded operator answer to "keep enum (recommended) / amend AC-3 to deprecation-only", given at the C-11 design-approval gate or in this file. Silence is not an answer (R-5).
- **Floor status**: no breaches.
- **Uncovered @AC changes**: `@AC-1..3 (322)` EXTEND, not covered by an operator decision. The `@AC-8 @feature-191` CHANGE is covered by the 2026-11-10 C-16 sign-off. PRESERVE: `@AC-2..5 @feature-305`, `@AC-5/@AC-9 @feature-196`, and the UI sparkline-ohlc-replacement OHLC strip.
- **Open risks**:
  - The tdd-gate may reject a compile-only RED.
  - The hoisted-local refactor touches the ownership gate at trading.go:1196, so trading_ownership_test.go must stay green.
  - Carried forward:
    - buf breaking has not been run with message-level deprecation on common.v1.Error/Decimal.
    - Field number 7 may collide with features 310 and 312.
    - The TS generated names are unverified.
    - Migration 046 may have left keep-and-report rows.
    - Python deprecation warnings are unverified.
    - The agent projection silently drops deprecated fields.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round 2 keeps round-1 steps 1–8 unchanged, as settled by D-1 to D-8. It adds three refinements, with no new mechanism.\n\n1. PROTO, BATCHGETBARS, AGENT, ANALYSIS, CONFIG DOCS, FINDINGS\nUnchanged from the prior state:\n- Proto edits: analysis.proto:626, indicators.proto:60 plus timeframe_enum=7, marketdata.proto:333 plus timeframe_enum=7, trading.proto:336, and common.proto:21,28 at message level, with a comment-only fallback.\n- BatchGetBars: the server reads the enum first, and all three producers send both fields (D-1).\n- No migration 048, but a launch-gate query (D-4).\n- Agent parity guard excludes deprecated fields (D-7).\n- Docs scope is config-governance.md:153-154,311,416,549-550 only (D-8).\n\n2. TRADING SnapshotOfflinePositions CARRIER (O-2), settled now rather than deferred to /sdd-spec\n- The handler keeps `req.Msg.UserId = extractUserID(ctx)` at services/xstockstrat-trading/internal/handler/trading.go:90, with its own scoped `//nolint:staticcheck // SA1019`. The service signature does not change, and the handler call at :91 stays as is.\n- At the top of SnapshotOfflinePositions (services/xstockstrat-trading/internal/service/trading.go:1174), hoist exactly one `userID := req.UserId //nolint:staticcheck // SA1019: handler-injected from x-user-id; body value overwritten`.\n- The five reads at :1178, :1196, :1274, :1276 and :1284 then use `userID`. I re-verified those five lines with grep this round.\n- Rewrite the ownership-invariant comment at :1193-1194 so it names `userID` and keeps its ≤2-line constraint (CLAUDE.md behaviour 5).\n- Do NOT touch :1646, :1652 or :1730. They belong to ListOrders/GetOrder, which are not deprecated.\n- Test literals (trading_offline_test.go:677 snapshotReq helper, :1398 table case, trading_ownership_test.go:104) get directives only where golangci-lint flags them, per D-6. The helper-level directive in snapshotReq is preferred.\n- Fallback, used only if a reviewer rejects even the single hoisted directive: an explicit `userID string` parameter, which costs about 35 test edits.\n\n3. ComputeIndicatorRequest.timeframe_enum (O-1)\n- D-2 stands as the recommendation: keep field 7 with an \"ignored by server\" comment (indicators app/handlers/servicer.py:214-241).\n- Design.md lists one explicit operator question at the C-11 design-approval gate: \"keep enum (recommended, satisfies AC-3 at acceptance.feature:28) / amend AC-3 to deprecation-only\".\n- O-1 closes only on a recorded operator answer. That answer can be design approval with the question explicitly listed, or a context.md entry.\n- With no recorded answer, O-1 stays open. The orchestrator must not close it on silence.\n\n4. GO P-06 (O-3): record the waiver accurately\n- Go execution order: first update the test-file call sites to the new signatures. Those are config_test.go in trading, portfolio and marketdata, plus the marketdata NewLiveClient(settings) caller in its tests.\n- Capture the resulting compile failure of the test package against the old NewWatcher(endpoint, env, tradingMode, …) / NewLiveClient(settings, paper) as the RED evidence. Then change the implementation (GREEN).\n- context.md and design.md record: \"RED available only as a compile failure. No assertion-level RED exists, because the Go watch requests already omit trading_mode (trading internal/config/config.go:87-93, portfolio :74-80). The compile-time signature removal is the guard.\"\n- If the tdd-gate (.claude/skills/sdd-execute/reference/tdd-gate.md:35,56-59) does not accept a compile failure as RED, log it as a recorded P-06 deviation with that exact text, not as \"no RED possible\".\n- No grep guard is added.",
    "open_objections": [
      {
        "text": "O-1 (refined): ComputeIndicatorRequest.timeframe_enum has no reader or producer (C-18). It stays open until the operator answers the 'keep enum / amend AC-3' question at the C-11 design-approval gate or in context.md. It cannot be closed on silence or on the orchestrator's own authority.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-8 @feature-191",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-1 (322)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (322)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 (322)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3..5 @feature-305",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-305",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-196",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-196",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "UI sparkline-ohlc-replacement.feature (opportunities OHLC strip)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Deciding at /sdd-spec between per-line nolint and a hoisted local, based on a directive count. Lost because the count is already known to be five service reads plus the handler write, which exceeds the proposal's own threshold. Leaving the choice open hands design's decision to the implementer.",
      "An explicit userID string parameter on SnapshotOfflinePositions. Lost on cost: about 35 test edits in a deprecation-only SEV-3, while the field-removal follow-up has to move the carrier anyway. It is kept as the fallback if the single hoisted directive is rejected.",
      "Treating the absence of an operator answer as acceptance of the O-1 default. Lost because that is a silent guess (CLAUDE.md behaviour 1, C-11).",
      "Describing O-3 as 'no RED possible'. Lost because it is inaccurate: the compile failure after updating the test call sites first is a real failing-first state.",
      "A Go unit test asserting TradingMode == UNSPECIFIED on the built watch request. Lost because it passes both before and after the fix (the field is already omitted), so it is not a RED."
    ],
    "open_risks": [
      "The tdd-gate may not accept a compile failure as RED. If it does not, the Go steps carry a recorded P-06 deviation instead of red→green evidence.",
      "The hoisted-local refactor touches the ownership gate at trading.go:1196. trading_ownership_test.go must stay green, and the rewritten :1193-1194 comment must keep the invariant that the header overwrites the body.",
      "Carried forward: buf breaking has not been run with message-level deprecation on common.v1.Error and Decimal. Field number 7 may collide with in-flight features 310 and 312. The generated TS enum and field names (timeframeEnum / TIMEFRAME_1DAY) are unverified. Migration 046 may have left keep-and-report rows. Python protobuf deprecation warnings are unverified. The agent projection silently drops deprecated fields."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "F-09",
      "PLAT-4",
      "PLAT-5"
    ],
    "rationale": "The adversary found the approach SOUND and raised only non-blocking refinements. I checked each one against the code.\n\n- O-2: grep shows `req.UserId` read at trading.go:1178, 1196, 1274, 1276 and 1284, with ListOrders/GetOrder reads at 1646, 1652 and 1730. The directive count is therefore already known, and committing to the hoisted local now prevents F-09 from freezing an implementer's ad-hoc choice. The comment at 1193-1194 names req.UserId and states a load-bearing ownership invariant, so it has to be updated to name the local. O-2 closes on this concrete answer.\n- O-1: the proposal's \"default stands on silence\" contradicts behaviour 1 and C-11. O-1 therefore stays open, non-blocking, until the operator answers. D-2 still stands as the recommendation, so this is not a new decision that contradicts it.\n- O-3: the excerpt of tdd-gate.md has a RED requirement (:35) and a deviation path (:59), and says nothing about compile failures. The waiver is reworded to be accurate, with the compile-RED captured as evidence. O-3 closes.\n\nNo settled D-n is contradicted, no R-n is reintroduced, and no closed O-n is re-raised. Neither side filed a REOPEN.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "SnapshotOfflinePositions keeps the deprecated user_id as the in-process carrier. The handler write at trading.go:90 keeps its own scoped nolint. The service hoists one `userID := req.UserId //nolint:staticcheck // SA1019…` at :1174, and the reads at :1178,1196,1274,1276,1284 use it. The :1193-1194 ownership comment is rewritten to name the local. The ListOrders/GetOrder reads at :1646,1652,1730 are untouched. The signature does not change.",
          "evidence": "grep of services/xstockstrat-trading/internal/service/trading.go and internal/handler/trading.go:90-91 (round 2)"
        },
        {
          "text": "Go P-06: update the test call sites first, then capture the test-package compile failure against the old NewWatcher/NewLiveClient signatures as RED. Record it as 'compile-only RED; no assertion-level RED because trading_mode is already omitted', or as a P-06 deviation if the tdd-gate rejects a compile RED. Never record it as 'no RED possible'.",
          "evidence": "trading config.go:87-93; portfolio config.go:74-80; .claude/skills/sdd-execute/reference/tdd-gate.md:35,56-59"
        }
      ],
      "new_rejected": [
        {
          "text": "Treating operator silence as acceptance of the O-1 keep-enum default.",
          "why": "Silent guess. C-11 and CLAUDE.md behaviour 1 require a recorded operator answer."
        },
        {
          "text": "Deferring the choice between per-line nolint and a hoisted local to /sdd-spec.",
          "why": "The directive count (five service reads plus the handler write) is already known, so leaving it open hands design's decision to the implementer (F-09)."
        }
      ],
      "new_objections": [],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Settled with one hoisted local under a scoped nolint at trading.go:1174, plus the handler :90 directive. The explicit userID parameter is the recorded fallback, deferred to the field-removal follow-up."
        },
        {
          "id": "O-3",
          "how": "Waived with an accurate record: compile-failure RED captured after updating the test call sites first, with the compile-time signature removal as the guard. A P-06 deviation is logged if the tdd-gate rejects a compile RED."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-retired-surface-proto-cleanup` (full) is halted at its approval gate after round 3 (gate policy: halt). design.md has not been written and status.md is unchanged (`spec-ready`). The register is in `debate.md` (D-1..D-14, R-1..R-9, O-1..O-3).

### Open Threads

- **Approach**:
  - D-1..D-10 stand unchanged: the proto deprecations/additions, the BatchGetBars enum-first read with both fields sent by all three producers, trading_mode option (a), no migration 048 plus a launch-gate query, the UNSPECIFIED watcher test, nolint only where golangci-lint flags, agent parity excluding deprecated fields, config-governance.md-only docs, the hoisted `userID` carrier at trading.go:1174, and the compile-only Go RED.
  - Round 3 adds gate and scope mechanics only. No new code mechanism is added.
    - D-11: a recorded operator answer to O-1 is a precondition for `spec-ready → design-approved`. design.md records exactly one answer, /sdd-spec writes one unconditional step 1, and there is no (A)/(B) branching at /sdd-execute.
    - D-12: if the answer is (B), drop indicators field 7, reword acceptance.feature:28 keeping the @AC-3 ID, amend product-spec.md :45/:89/:114, and record the answer here. This is a 322-local AC, so there is no C-16 sign-off.
    - D-13: indicators.proto:60 says "deprecated; ignored by the server" and must not copy the marketdata "once all callers migrate" wording. Under (A), field 7 says "accepted but ignored by the server; carried for contract parity with BatchGetBarsRequest".
    - D-14: xstockstrat-ui is added to Affected Services and the feature.md reviewers, because D-1 edits useOhlcBars.ts:25. Any mock-backend.ts edit follows C-12.
  - Assumptions pruned after verification: there is no TS deprecation lint rule in xstockstrat-ui, and no service pyproject.toml sets filterwarnings.
- **Strongest open objection**: O-1 (non-blocking). `ComputeIndicatorRequest.timeframe_enum` has no reader or producer (C-18). The question for the design-approval prompt is:
  - (A) keep field 7 (recommended; matches acceptance.feature:28 and product-spec :89 / Q5 :114), or
  - (B) amend to deprecation-only.
  - It closes only on a recorded operator answer. Silence and orchestrator authority do not count (R-5). Under D-11, an approval without an answer leaves status at `spec-ready`.
- **Floor status**: no breaches.
- **Uncovered @AC changes**: `@AC-1`, `@AC-2` and `@AC-3 (322)` are EXTEND, not covered by an operator decision. The `@AC-8 @feature-191` CHANGE is covered by the 2026-11-10 C-16 sign-off. PRESERVE: `@AC-2..5 @feature-305`, `@AC-5/@AC-9 @feature-196`, and the UI sparkline-ohlc-replacement OHLC strip.
- **Open risks**:
  - The gate may approve without answering O-1, which stalls 322 at `spec-ready`. This is intended, but it is a schedule risk.
  - The tdd-gate may reject a compile-only RED (P-06 deviation, D-10).
  - The hoisted local touches the ownership gate at trading.go:1196, so trading_ownership_test.go must stay green.
  - The UI scope addition brings in UI-owner review routing and C-12 fixture homes.
  - Carried forward:
    - buf breaking is unverified for message-level deprecation on common.v1.Decimal/Error.
    - Field 7 may collide with features 310 and 312.
    - The TS name `timeframeEnum` is unverified.
    - Migration 046 may have left keep-and-report rows (D-4 launch-gate query).
    - The agent projection silently drops deprecated fields.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 keeps D-1 to D-10 unchanged. It adopts the adversary's four refinements as gate and scope mechanics. No new code mechanism is added.\n\n1. STEPS 1–8 (unchanged; D-1 to D-10)\n- Proto PR-unit:\n  - analysis.proto:626, field 17 `[deprecated = true]`.\n  - indicators.proto:60, string deprecated (field 7 depends on O-1, see 2).\n  - marketdata.proto:333, string deprecated plus `timeframe_enum = 7`.\n  - trading.proto:336, user_id deprecated using the :144 wording.\n  - common.proto:21,28, message-level `option deprecated` plus a comment, with comment-only deprecation as the fallback if buf rejects it.\n  - Then buf lint, buf breaking and buf-gen.\n- BatchGetBars: the server reads the enum first, and all three producers (analysis servicer.py:5675, portfolio offline_valuation.go:170-176, UI useOhlcBars.ts:23-25) send both fields (D-1).\n- trading_mode: option (a) (D-3).\n- Config: no migration 048, plus a launch-gate query (D-4).\n- Tests and directives: Python watcher test asserts UNSPECIFIED (D-5); nolint only where golangci-lint flags (D-6); the agent parity guard excludes deprecated fields (D-7).\n- Docs: config-governance.md only (D-8).\n- Trading carrier: hoisted `userID` local at trading.go:1174, plus the handler :90 directive (D-9).\n- Go P-06: compile-only RED (D-10).\n\n2. O-1 GATE: one answer, recorded before approval (replaces round-3's dual-branch \"execution guard\")\n- A recorded operator answer to O-1 is a precondition for `spec-ready → design-approved`. The answer can be an explicit response to the question in the design-approval prompt, or a context.md session entry.\n- If the gate does not answer, status stays `spec-ready` and O-1 stays open.\n- design.md records exactly one answer. /sdd-spec writes one unconditional step 1 and refuses to draft it while O-1 is open.\n- There is no (A)/(B) branching in implementation-spec.md, and no verifier that reads context.md at /sdd-execute.\n- The question, verbatim in the approval prompt:\n  - (A) keep ComputeIndicatorRequest field 7 `timeframe_enum`. Recommended; matches acceptance.feature:28 as written and product-spec :89 / Q5 :114.\n  - (B) amend to deprecation-only: deprecate the string and add no enum field.\n\n3. DEPRECATION WORDING (applies under both answers)\n- indicators.proto:60 (field 6) gets a comment of the form \"deprecated; ignored by the server\" (indicators servicer.py:214-241 reads neither field).\n- Do NOT copy the marketdata.proto:89-92 \"use timeframe_enum … once all callers migrate\" text into indicators. D-2 switches no caller, so that promise would be false (fails.md:1334: deprecation comments are the only signal a caller gets).\n- Under (A), field 7 is commented \"accepted but ignored by the server; carried for contract parity with BatchGetBarsRequest\".\n- marketdata.proto:333 keeps the :89-92 migrate wording, because its producers really do switch (D-1).\n\n4. EDIT SET IF (B) IS CHOSEN\n- Drop `timeframe_enum = 7` from the indicators hunk, and drop the field-7 collision check against 310 for indicators.\n- Reword acceptance.feature:28 to \"BatchGetBarsRequest accepts the Timeframe enum with the string deprecated, and ComputeIndicatorRequest.timeframe is deprecated as ignored by the server\". The @AC-3 ID stays unchanged, since IDs are append-only under C-15.\n- Amend product-spec.md:\n  - :45 (Expected: \"migrate the two string timeframes\").\n  - :89 (Fix Scope row): split ComputeIndicatorRequest out as deprecation-only.\n  - :114 (Q5).\n- Append a context.md session entry recording the operator answer and the amendment.\n- This is a 322-local AC (not yet promoted), so C-16 durable sign-off is not triggered.\n- Under (A), none of these edits apply.\n\n5. UI SCOPE RECORD\n- D-1 already touches services/xstockstrat-ui/src/hooks/useOhlcBars.ts:25 (`timeframe: '1d'`), but product-spec.md:74-80 Affected Services, the context.md triage list and feature.md all omit xstockstrat-ui.\n- Add xstockstrat-ui to Affected Services and to the feature.md reviewers, and record the change in context.md, so reviewer routing reaches the UI owner.\n- Any e2e/mock-backend.ts:153-154,188-189 edit follows C-12 fixture-home rules.\n- D-1 itself is not contested.\n\n6. ASSUMPTIONS PRUNED (now verified)\n- No TS deprecation lint rule exists in services/xstockstrat-ui (grep for no-deprecated / deprecation/ is empty), so the UI producer setting a deprecated field causes no lint fallout.\n- No service pyproject.toml sets filterwarnings, so Python setting a deprecated field cannot fail test runs.\n- Both drop from Assumptions.",
    "open_objections": [
      {
        "text": "O-1: ComputeIndicatorRequest.timeframe_enum has no reader or producer (C-18). It stays open until the operator records an answer, (A) keep field 7 or (B) amend to deprecation-only, in the design-approval prompt or in context.md. Under D-11 that recorded answer is now a precondition for spec-ready → design-approved, so O-1 cannot leak into /sdd-spec. It must not be closed on silence or on the orchestrator's own authority (R-5).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-8 @feature-191",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-1 (322)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (322)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 (322)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3..5 @feature-305",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-305",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-196",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-196",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "UI sparkline-ohlc-replacement.feature (opportunities OHLC strip)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A dual-branch step 1 in implementation-spec.md, with a verifier that reads the O-1 answer from context.md at /sdd-execute. Lost because it pushes a design choice into execution and forces step edits after spec (F-09). It is a near-variant of locked R-6.",
      "(B′): option (B) plus deleting the six analysis writes of the ignored ComputeIndicatorRequest.timeframe (servicer.py:1623,1633, screener.py:323,389, evaluator.py:517, pnl_pattern_consumer.py:129). Lost as the design recommendation because no AC requires it (CLAUDE.md #3) and it cuts against D-2's 'no caller switch'. The operator may still ask for it explicitly at the gate.",
      "Reusing the marketdata.proto:89-92 'use timeframe_enum … once all callers migrate' wording on indicators.proto:60. Lost because no indicators caller switches (D-2) and the server reads neither field, so the comment would be a false promise (fails.md:1334).",
      "Defaulting O-1 to (A) at design approval on the strength of product-spec Q5 (:114). Lost because Q5 was struck through at triage, not by an operator decision (compare the explicit operator entry in context.md). This is already covered by R-5."
    ],
    "open_risks": [
      "The design gate may approve without answering O-1. D-11 then holds status at spec-ready, which stalls 322 in the batch until the operator answers. That is intended, but it is a schedule risk.",
      "The tdd-gate may reject a compile failure as RED. In that case the Go steps carry a recorded P-06 deviation (D-10).",
      "The hoisted-local refactor touches the ownership gate at trading.go:1196. trading_ownership_test.go must stay green, and the rewritten :1193-1194 comment must keep the invariant that the header overwrites the body.",
      "Adding xstockstrat-ui to scope pulls the UI owner into review routing. A mock-backend.ts edit must respect C-12 fixture homes.",
      "Carried forward:\n- buf breaking has not been run with message-level deprecation on common.v1.Decimal/Error.\n- Field 7 may collide with in-flight features 310 (indicators.proto) and 312 (trading.proto).\n- The generated TS field name timeframeEnum is unverified.\n- Migration 046 may have left keep-and-report rows; the launch-gate query (D-4) covers this.\n- The agent projection silently drops deprecated fields (D-7 docstring)."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-12",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-04",
      "P-06",
      "F-04",
      "F-09",
      "PLAT-4",
      "PLAT-5"
    ],
    "rationale": "The adversary judged round 3 SOUND with no Floor breach and raised four non-blocking refinements. I checked each one against the tree.\n\n1. The dual-branch \"execution guard\" is a real F-09/R-6 risk: step 1 would hold two conditional variants decided at execute time. Making a recorded O-1 answer a precondition for design-approved removes that risk structurally. It also closes the proposal's own \"strongest risk\" (approval without an answer) without relying on prompt wording. This honors R-5: no default is applied.\n\n2. The (B) edit list was incomplete. product-spec.md promises the enum in three places: :45 (Expected), :89 (Fix Scope row) and :114 (Q5). The adversary's \":40\" citation points to the Observed text; the actual row is :89. Under (B), all three are amended along with acceptance.feature:28, keeping the @AC-3 ID (C-15).\n\n3. Wording: indicators servicer.py:214-241 reads neither field and D-2 switches no caller. A \"once all callers migrate\" comment copied from marketdata.proto:89-92 would therefore be false. fails.md:1334 records that these comments are the only signal a caller gets.\n\n4. UI scope: useOhlcBars.ts:25 sends `timeframe: '1d'` and is a D-1 producer, but product-spec.md:74-80 Affected Services omits xstockstrat-ui. Reviewer routing (C-14) would miss the UI owner.\n\nVerified this round:\n- No `no-deprecated` / `deprecation/` rule exists in services/xstockstrat-ui.\n- No services/*/pyproject.toml sets filterwarnings.\nBoth assumptions are dropped.\n\nO-1 remains open: the 322 directory still has no recorded operator answer. The only operator entry in context.md covers the C-16 @AC-8 @feature-191 sign-off. No settled D-n is contradicted, no locked R-n is reintroduced, no closed O-n is re-raised, and neither side filed a REOPEN.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "A recorded operator answer to O-1, (A) keep ComputeIndicatorRequest field 7 or (B) deprecation-only, is a precondition for spec-ready → design-approved. Without one, status stays spec-ready. design.md records exactly one answer. /sdd-spec writes a single unconditional step 1 and refuses to draft it while O-1 is open. There is no (A)/(B) branching or context.md-reading verifier at /sdd-execute.",
          "evidence": "Adversary r3 objection 1 (F-09/R-6 variant). grep of docs/roadmap/features/322-fix-retired-surface-proto-cleanup/ finds no O-1 answer; context.md has only the C-16 @AC-8 @feature-191 operator entry."
        },
        {
          "text": "If O-1 is answered (B), the edit set is: drop indicators field 7 and its 310 collision check; reword acceptance.feature:28 keeping the @AC-3 ID; amend product-spec.md :45 (Expected), :89 (Fix Scope row, split ComputeIndicatorRequest out as deprecation-only) and :114 (Q5); append a context.md session entry recording the answer. This is a 322-local AC, so there is no C-16 durable sign-off.",
          "evidence": "product-spec.md:45,89,114; acceptance.feature:24-28 (grep, round 3)"
        },
        {
          "text": "Deprecation wording. indicators.proto:60 (field 6) says 'deprecated; ignored by the server' and must not copy the marketdata.proto:89-92 'once all callers migrate' text. Under (A), field 7 says 'accepted but ignored by the server; carried for contract parity with BatchGetBarsRequest'. marketdata.proto:333 keeps the migrate wording because its producers switch (D-1).",
          "evidence": "indicators app/handlers/servicer.py:214-241; marketdata.proto:89-92; docs/roadmap/ledger/fails.md:1334"
        },
        {
          "text": "xstockstrat-ui is added to product-spec.md Affected Services and to the feature.md reviewers, with a context.md entry recording the scope amendment, because D-1 edits the UI producer. Any e2e/mock-backend.ts edit follows C-12 fixture rules.",
          "evidence": "services/xstockstrat-ui/src/hooks/useOhlcBars.ts:25 (timeframe: '1d'); product-spec.md:74-80 omits UI"
        }
      ],
      "new_rejected": [
        {
          "text": "A dual-branch (A)/(B) step 1 in implementation-spec.md, with an /sdd-execute verifier that reads the O-1 answer from context.md.",
          "why": "It defers a design choice into execution and forces step edits after spec (F-09). It is a near-variant of R-6."
        },
        {
          "text": "(B′): option (B) plus deleting the six analysis writes of the ignored ComputeIndicatorRequest.timeframe, as the design recommendation.",
          "why": "No AC requires it (CLAUDE.md #3) and it cuts against D-2's 'no caller switch'. It stays available only if the operator explicitly asks for it at the gate."
        },
        {
          "text": "Copying the marketdata 'use timeframe_enum … once all callers migrate' deprecation comment onto indicators.proto:60.",
          "why": "It would be false: no indicators caller switches and the server reads neither field (fails.md:1334)."
        }
      ],
      "new_objections": [],
      "closed_objections": [],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
