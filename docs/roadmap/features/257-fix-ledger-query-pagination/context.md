# Context Log: fix-ledger-query-pagination

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ledger-query-pagination-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-13**, **D-27**,
  **D-46**. All three re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
- Severity: SEV-2. Impact type: wrong-pnl-reported. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-ledger (D-13, D-27), xstockstrat-portfolio (D-46).
- Root cause hypothesis: ledger pagination is half-implemented (the token is emitted and never read). `GetPnL` treats a page
  error as end-of-data. The replay is a single unbounded query on `DB_POOL_MAX=1`.
- **Sequencing with 251-fix-getpnl-source-service (load-bearing):** this feature must merge **before or together with**
  `251-fix-getpnl-source-service`. 251 currently masks D-46: its `SourceService: "trading"` filter matches zero rows
  (`portfolio_service.go:753`, `:798`). Fixing 251 alone makes `GetPnL` match real fills, and beyond 500 platform-wide
  fills the D-13 page-1 loop then returns an inflated realized P&L as success. At spec time, add a
  `merge-order.md` entry (257 ≤ 251), and append a pointer to this constraint in 251's context.md when 251 is next touched.
  Design may choose to absorb 251's one-line fix here instead.
- Line drift (scan @ 4535695 → a053b0e):
  - None for D-13 (`ledgerServiceImpl.ts:157`, `:171`) or D-27 (`:234-243`, pg-cursor at `:342`).
  - D-46 pass 1 now spans `portfolio_service.go:749-791` (cited `:750-791`). Pass 2 is unchanged at `:795-836`.
  - `GetPnL` starts at `:722`.
- Adjacent observations, not filed and left for design to weigh:
  - `HydrateStops` (`portfolio_service.go:534`) reads only the first 100 oldest `order.filled` events, with no paging.
  - Trading `resolveUnknownIntents` (`trading.go:2222`) calls `QueryEvents`.
  - Both change behaviour once `pageToken` is honoured or `pageSize` is capped, so check them for regressions.
  - The `ORDER BY recorded_at` with an `event_id` token has no stable tiebreak. `sequence` (indexed, globally monotonic) is
    the natural keyset.
- Overlaps:
  - **251-fix-getpnl-source-service** (draft): same `GetPnL` loops in `portfolio_service.go:749-836`. See the sequencing above.
  - **248-fix-ledger-trimmed-notify-payload** (implementation-ready) edits the same `streamEvents` function
    (`ledgerServiceImpl.ts:196-257`, the live/buffer/`writeRow` path) that D-27 restructures. This is a high conflict risk:
    sequence after 248, or coordinate the replay-batching change with 248's buffer-flush logic.
  - **252-fix-identity-ledger-test-suites** (implementation-ready) makes the ledger real-impl tests loadable
    (`ledgerServiceImpl.test.ts`). 248 already depends on it. This feature's ledger tests likely depend on 252 too.
  - **256-fix-offline-book-consistency** and **264-fix-portfolio-snapshot-surface** edit other functions in `portfolio_service.go`.
  - **263-fix-edge-owner-scope** was triaged in the same 2026-10-21 batch. It adds an owner predicate to the **same**
    `queryEvents` WHERE builder (`ledgerServiceImpl.ts:124-162`) that D-13 gives a keyset and cap. This is a high textual
    and semantic overlap, and the keyset token must compose with the owner filter. Coordinate in design or merge one first.
  - **258-fix-config-stream-resilience** (same batch) edits `ledgerServiceImpl.ts:74` (appendEvent try/catch). Same file,
    different function.
- Recommended design depth: full → `/sdd-design fix-ledger-query-pagination` (rationale: 2 affected services, which is the
  C-0 full trigger, plus a cross-feature merge-order constraint with 251 and a same-function overlap with 248).
- Development branch: feature/fix-ledger-query-pagination

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no Floor breaches).
- Warnings:
  - C-15 (criterion 8) OK. Every FR has a covering scenario: FR-1/2 by AC-1, FR-3 by AC-2, FR-4 by AC-7, FR-5 by AC-3
    and AC-6, FR-6 by AC-4, FR-7 by AC-5. Arithmetic rechecked (AC-3 = 250.00, AC-6 = 501.00).
  - FR-1/FR-4 order by `sequence`, while today's query orders by `recorded_at ASC` (`ledgerServiceImpl.ts:162`). The
    two can differ for concurrently inserted rows. **Resolved in this session:** FR-4 now says the first page is the
    oldest by `sequence` and asks design to record whether the difference matters to any caller.
  - FR-4 claimed trading `trading.go:2222` requests page_size ≤ 500; it sets no `PageSize` (default 100). **Resolved:**
    FR-4 wording now says "effective `page_size`" and cites `trading.go:2222-2225` with the default 100.
  - FR-2: an exactly-full last page must return an empty token. **Resolved:** FR-2 now states it and asks design to
    keep the existing `limit+1` probe.
  - Peer features 248/251/263 and a `merge-order.md` row for 257 could not be verified in the reviewer's working tree;
    `merge-order.md` has no 257 row yet. Open: `/sdd-spec` must write the 257 ≤ 251 row before the impl-spec gate.
  - Criteria 5, 6, 7, 9, 11 pass. No proto change; conditional key `ledger.query.max_page_size` follows C-05; no
    migration decided (any future one is a new numbered migration, C-07; F-01 not at risk). Trading-domain C-5
    satisfied by FR-5 + AC-6; C-1..C-4 not triggered.
  - Code claims verified: `queryEvents` ignores `pageToken`, no cap (`ledgerServiceImpl.ts:157-171`); replay is one
    unbounded `pool.query` (`:235-243`); ExportEvents uses `Cursor` (`:342`); `idx_events_sequence` (migration 001:43);
    `GetPnL` loops at `portfolio_service.go:753-758`, `:798-803` (PageSize 500, `SourceService: "trading"`,
    `slog.Warn` + `break`); `HydrateStops` at `:534`; trading call sites `trading.go:2091`, `:2222`, `:3221`.
- Overlap findings (level WARN; no config-key, proto-field or migration collision, so no FAIL):
  - `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` `streamEvents` (trunk :182): FR-7 replay rewrite vs
    **248-fix-ledger-trimmed-notify-payload** (implementation-ready) Step 8 editing the subscribe literal (:202-220).
    Same function, manual merge. Soft same-function note recommended for merge-order (no hard order).
  - Same file, `queryEvents` (trunk :124, ORDER BY at :162): FR-1/FR-3 keyset + cap vs **263-fix-edge-owner-scope**
    (draft) owner predicate in the same WHERE builder. Conditional on 263's design; keyset must compose with it.
  - `services/xstockstrat-portfolio/internal/service/portfolio_service.go` `GetPnL` (trunk :722; PageSize 500 at :754,
    :799): FR-5/FR-6 vs **251-fix-getpnl-source-service** (draft; its `:683` cite is stale). Hard sequencing: 257 must
    merge before or together with 251.
  - Low risk: 264-fix-portfolio-snapshot-surface (different function in `portfolio_service.go`, rebase-only);
    240-offline-account-full-pnl (launched, historical only); 252-fix-identity-ledger-test-suites (shares ledger test
    harness, no clash; AC-5 uses a separate real-TimescaleDB harness); 248 adds config migration
    `032_ledger_stream_resolve_timeout` in xstockstrat-config (no collision).
  - Recommended merge-order row (to confirm with the user before writing, at `/sdd-spec`): `fix-getpnl-source-service`
    (251) must wait for `fix-ledger-query-pagination` (257) — GetPnL realized P&L inflated once >500 fills if 251
    merges alone. Resolved: No.

OPERATOR DECISIONS (binding, recorded 2026-10-21):
- Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
- Scope is D-13, D-27, D-46; must merge before or with 251-fix-getpnl-source-service.

- Files modified: product-spec.md (FR-2, FR-4 wording), status.md, feature.md, context.md.
- Next: `/sdd-design fix-ledger-query-pagination` (full depth).

## Session 2026-10-22 — sdd-batch design state recovered (round 2)

- The batch run that produced round 2 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-2 synthesis restored verbatim from the run journal (`synth:fix-ledger-query-pagination:r2`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Keep the round-1 synthesized design: three narrow edits, with no proto, migration or config change. Round 2 settles objections 4 and 9, gives objection 6 a firm evidence plan, and folds in the round-2 adversary's concrete fixes. I checked these against the worktree: GetPnL requests PageSize 500 at portfolio_service.go:754 and :799; the ledger mocks use a numeric `sequence` (src/__tests__/ledgerServiceImpl.test.ts:66, :100, :174); ledger CLAUDE.md:35 says \"never gaps\"; and ledger CLAUDE.md:43-44 says the handler replays and then subscribes.\n\n**1. Ledger `queryEvents`** (services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-176)\n- Unchanged from round 1. Add `QUERY_EVENTS_DEFAULT_PAGE_SIZE = 100` and `QUERY_EVENTS_MAX_PAGE_SIZE = 1000` next to `EXPORT_BATCH_SIZE` (:11).\n- Clamp the limit: a non-positive value gets the default, and an oversized value is capped at the max.\n- The page token is the decimal string of the last row's `sequence`. `parseSequenceToken` checks `/^\\d{1,19}$/` and `<= 2^63-1`; a bad token returns code 3.\n- Bind the token as `sequence > $n::bigint` through `conditions[]`. Order by `sequence ASC`. Keep the `limit+1` probe; `totalCount` stays the page length.\n\n**2. Ledger `streamEvents` replay** (:186-260)\n- Unchanged from round 1: subscribe, capture `max(sequence)` once as the upper bound, run the keyset batch loop up to that bound with `REPLAY_BATCH_SIZE = 1000`, flush the buffer synchronously, then set `live = true`.\n- Add a cancellation check between batches. When `write()` returns false, await a drain helper that races `drain` against cancel/close/error.\n- `maxSeq` becomes a BigInt through one shared helper. It is used at :191, :196, :210 and :256, and must cover 248's trimmed rows.\n- Budget stays 1 pooled + 1 LISTEN (F-06).\n- `REPLAY_BATCH_SIZE` stays a constant. `design.md` records that if production needs tuning, it is promoted to `ledger.stream.replay_batch_size` (C-05, config-team approval).\n\n**3. Portfolio `GetPnL` fails closed** (services/xstockstrat-portfolio/internal/service/portfolio_service.go:718, :754-835)\n- Add `ErrLedgerUnavailable`. Both `break` sites return `fmt.Errorf(\"GetPnL: QueryEvents (<type>): %w: %w\", ErrLedgerUnavailable, err)`.\n- A repeated token also returns `ErrLedgerUnavailable`.\n- **Explicit edit:** change both `PageSize: 500` literals (:754, :799) to 1000, matching `QUERY_EVENTS_MAX_PAGE_SIZE`. This closes the formula mismatch.\n- Pass 2 keeps the maximum cumulative `FilledQty` per order (:829-830). Tie-break: on an equal `FilledQty`, keep the first one seen (strict `>`).\n- Align the :829 comment and the `computeRealizedPnL` mirror (portfolio_helpers_test.go:107) in the same edit.\n- `classifyGetPnLError` (internal/handler/portfolio_handler.go:425) gains an `ErrLedgerUnavailable` \u2192 `CodeUnavailable` branch. Add a `TestClassifyGetPnLError` (portfolio_handler_test.go:39) case and keep the existing assertions.\n- The request `ctx` is kept for all page calls, so `x-trace-id` propagates. No background context is introduced (C-03, operator trace decision).\n\n**4. Tests (C-15)**\n- New `queryEvents` and replay tests build rows with `sequence` as a pg-style **string**, crossing a digit boundary (`\"9\"`, `\"10\"`, `\"11\"`). They assert that the token round trip, the batch cursor and the `maxSeq` live dedupe all advance correctly.\n- A unit FIFO interleave test uses a single-slot pool fake in the `makeIdempotentPool` style (src/__tests__/ledgerServiceImpl.test.ts:56). It asserts that an INSERT queued during replay dispatches before the next batch's SELECT, and that the replayed sequences are strictly ascending and unique. On today's code this test fails (RED).\n- A drain-helper test covers `write()` returning false.\n- Portfolio AC-3, AC-4 and AC-6 use the `stopLedger` scripted `QueryEvents` fake and `ctxWithUser` (portfolio_risk_test.go:143-148, watchlist_service_test.go:280).\n\n**5. AC-5 evidence**\n- One manual run against TimescaleDB with `DB_POOL_MAX=1`, 200k rows and 5 concurrent replays.\n- Record the exact parameters in `context.md`: row count, `event_type` filter selectivity, `REPLAY_BATCH_SIZE`.\n- Record two results: the `AppendEvent` p100 against the 2 s bound, and a real-pg `QueryEvents` token walk across a digit boundary that returns every row once and in order (fails.md:2783).\n- The same run measures `per_page_ms` and the platform fill count for the GetPnL ceiling.\n- A failed AC-5 run is a **hard stop before merge**, not a follow-up. Its remedy (index migration 004) needs DBA approval (C-07).\n- AC-5's harness comment changes to: \"Evidence: unit FIFO interleave test (CI) + one recorded real-TimescaleDB run (context.md); not a CI job.\"\n\n**6. Docs and teardown**\n- Ledger `CLAUDE.md` \"Live Streaming Architecture\": rewrite it for subscribe \u2192 bounded batched replay \u2192 flush \u2192 live. This also fixes the \"replays \u2026 then subscribes\" order drift at :43-44.\n- Ledger `CLAUDE.md` Critical Invariant 4 (:35): correct it to \"monotonic, may gap (nextval; rollbacks burn values)\".\n- A new LEDGER-* invariant in services/xstockstrat-ledger/docs/context-constitution.md covering:\n  - the token format;\n  - the late-commit contract (option (a) wording), noting that the gap *class* predates this feature at :210 and in LEDGER-3 resume, while batching widens its *window* to the length of the replay up to the bound;\n  - pg_snapshot_xmin as the named follow-up, with that widening as its trigger;\n  - the accepted limit of the unbounded per-stream buffer.\n- `design.md`:\n  - the ceiling formula `pages = ceil(platform_filled/1000) + ceil(platform_partials/1000)`, with `walk_ms \u2248 pages \u00d7 per_page_ms` compared against the caller deadline, and the user-scoped walk as follow-up once `walk_ms` exceeds 50% of the deadline (that walk depends on 263's NULL-`user_id` handling);\n  - the P&L behaviour delta (insights.md:176-188): realized P&L changes for anyone with more than 500 platform fills once 251 lands;\n  - the `REPLAY_BATCH_SIZE` promotion note.\n- `merge-order.md`:\n  - a row for 257 \u2264 251;\n  - a 263 note;\n  - a rolling-deploy note: during the ledger rollout, a token from an old ledger build (an `event_id` UUID) or a repeated page makes GetPnL return UNAVAILABLE.\n- The teardown audit.\n\n**Build order**\n1. Sequence helper, `queryEvents` and its string-sequence tests.\n2. Replay with its bound, drain helper and FIFO tests.\n3. Portfolio `GetPnL`, classifier, pass 2 and the `PageSize` edit, with their tests.\n4. Manual AC-5 run.\n5. Docs and teardown.",
    "open_objections": [
      {
        "text": "Objection 3 (P-03/C-15), late-commit 'exactly once'. Option (a) is now fully specified: restate FR-1 and FR-7 as 'every matching event committed before the walk passes its sequence is delivered exactly once, ascending; a lower sequence committing after the walk passed it is not delivered by that walk', and qualify AC-5's 'exactly once' line. No recorded operator decision sanctions this change to the feature's own FR/AC, so it stays blocking until the operator signs off in context.md.",
        "blocking": true
      },
      {
        "text": "Mocks hide the BIGINT-as-string bug (C-15, fails.md:2783-2786). Every ledger mock passes a numeric sequence (ledgerServiceImpl.test.ts:66, :100, :174), so a green suite proves nothing about the string-vs-string comparisons at :196, :210 and :256. The synthesis adds string-typed sequences across a digit boundary ('9', '10', '11') to the queryEvents and replay tests, and a real-pg token walk to the manual run. The round-2 proposal did not answer this itself, so the next proposer must confirm these test cases and the run step.",
        "blocking": true
      },
      {
        "text": "FR-5 says pass 2 keeps 'last event per order ID wins', which contradicts the adopted max-cumulative-FilledQty rule (strict >, first seen wins a tie). FR-5 needs to be reworded in the same operator sign-off as the option (a) restatement.",
        "blocking": false
      },
      {
        "text": "Objection 6 residual, AC-5 evidence. The plan is two layers: a unit FIFO interleave test in CI, plus one recorded manual TimescaleDB run that records its parameters, includes a token walk, and is a hard stop before merge. QA or the operator still has to accept this as AC-5 evidence under C-15.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "portfolio @AC-5 (GetPnL refuses unrealized P&L when quote unavailable)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "portfolio @AC-6 (broker-synced positions use broker price)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "portfolio @AC-6 (one-sided quote with stale close)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "portfolio @AC-13 (read paths value one-sided positions identically)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "portfolio @AC-28 (offline holding without live quote refused)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ledger @AC-1 (date-range export NDJSON in sequence order)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ledger @AC-6 (streaming RPC survives cert rotation)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ledger @AC-7 (one-million-row export without buffering)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ledger @AC-10 (snapshot write emits audit event)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ledger @AC-11 (export scoped to authenticated user)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "257 @AC-1/@AC-5 + FR-1/FR-7 (exactly-once qualified for late commits)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "257 FR-5 (pass-2 'last wins' -> max cumulative FilledQty)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Dedicated pg.Client + Cursor for replay (the export pattern at :333-352). Each concurrent replay adds a backend connection beyond the 1+1 budget (F-06).",
      "Option (b), a pg_snapshot_xmin bound on each page and batch. It closes the gap on the replay path only, while the live-path dedupe at :210 and LEDGER-3 resume keep it, and it adds mechanism. It stays the named follow-up, triggered by the widened replay window.",
      "Open-ended 'loop until short batch' replay. It may never terminate under sustained appends. Replaced by the max(sequence) upper bound captured after subscribe.",
      "A CI TimescaleDB service-container job for AC-5. It adds a new CI job against the low-rework ask; a unit FIFO test plus a recorded manual run is used instead.",
      "A buffer-length cap that calls call.end() and resumes via LEDGER-3. It adds a reconnect trigger for portfolio's three permanent streams (YAGNI, C-18). Recorded as an accepted limit instead.",
      "Keeping GetPnL PageSize 500 and putting /500 in the formula. Raising it to 1000 halves the walk at no cost.",
      "User-scoped GetPnL walk on idx_events_user_sequence. It depends on 263's NULL user_id handling, so it is deferred behind the 50%-of-deadline trigger.",
      "Absorbing 251's SourceService change. It widens scope against the operator's grouping; a merge-order row is used instead.",
      "Config key for page size or REPLAY_BATCH_SIZE now. It follows the existing EXPORT_BATCH_SIZE constant precedent; promotion is documented if a tuning need appears.",
      "Rejecting an oversized or non-positive page_size with INVALID_ARGUMENT. Clamping needs no caller change.",
      "One shared 1000 constant. The three values mean different things; only the BigInt sequence helper is shared."
    ],
    "open_risks": [
      "Late-commit skip. The window widens from one statement snapshot to the whole bounded replay, and paging exposes it to GetPnL for the first time. Pending the operator's option (a) sign-off.",
      "AC-5 rests on one manual real-DB run. Five concurrent replays with a sparse event_type filter on idx_events_sequence may exceed the 2 s bound. The remedy would be a smaller REPLAY_BATCH_SIZE or migration 004 with DBA approval (C-07), and a failed run is a hard stop before merge.",
      "GetPnL availability scales with the platform-wide fill count. Past the ceiling, every user gets UNAVAILABLE.",
      "Realized P&L changes deliberately once more than 500 platform fills exist and 251 lands. This must be communicated, not treated as a regression.",
      "The unbounded per-stream notifier buffer is an accepted memory limit while a slow client stalls replay.",
      "Rolling-deploy skew. Old ledger tokens or repeated pages make GetPnL return UNAVAILABLE until the ledger rollout completes.",
      "Rebase coupling with 248 inside streamEvents. The BigInt comparison must cover trimmed rows.",
      "If 263 scopes QueryEvents by x-user-id, GetPnL loses fills written before migration 003 unless 263 accounts for them.",
      "The ledger real-implementation tests depend on 252 landing first.",
      "The proto-loader `longs` option has not been verified. The BigInt helper must accept number and string for both fromSequence and row.sequence."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-05",
      "C-07",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "F-01",
      "F-06",
      "F-07",
      "LEDGER-2",
      "LEDGER-3",
      "PLAT-N1"
    ],
    "rationale": "The user asked to preserve as much as possible with low rework, so the round-1 three-edit design stands unchanged. Round 2 adds only test cases, doc text and one literal change.\n\nAnswered this round, so closed:\n- **Objection 4.** The ceiling formula and the measurement step are in `design.md`. The adversary's formula mismatch is fixed by stating the PageSize 500\u21921000 edit at portfolio_service.go:754 and :799 explicitly; the round-1 synthesis already adopted 1000, but Touchpoints left it out.\n- **Objection 9.** The unbounded buffer is recorded as an accepted limit, and the buffer cap is the rejected runner-up.\n\nFolded into the approach directly, because each is a small edit inside code or docs this feature already touches and needs no new decision:\n- the replay-window widening note in the LEDGER-* invariant;\n- the `REPLAY_BATCH_SIZE` \u2192 config promotion note;\n- the rolling-deploy note in `merge-order.md`;\n- the classifier `%w` wrap;\n- the Live Streaming order drift. I verified it at ledger CLAUDE.md:43-44: the doc says replay then subscribe, while the code subscribes first.\n\nStill open:\n- **Blocking: the string-sequence test gap.** The mocks really are numeric (test.ts:66, :100, :174), so the bug the fix targets would be invisible to CI. The synthesis adds the fix, but the proposer has not yet answered it.\n- **Blocking: objection 3.** Option (a) is fully specified, but no recorded operator decision covers changing the feature's own FR/AC. The binding operator decisions cover only scope, grouping and trace propagation.\n- **Non-blocking: FR-5 rewording.** It is a feature-own CHANGE that should ride the same sign-off.\n- **Non-blocking: AC-5 evidence.** It is now concrete (CI FIFO RED test, plus a recorded manual run with its parameters and a token walk, as a hard stop) but still needs QA or operator acceptance.\n\nNo Floor breach: F-06 holds at 1+1, F-07 holds with constants that follow precedent, and F-01 holds because there is no migration. Trace propagation follows the operator's standing decision because the request ctx is kept on every GetPnL page call. Durable business rules are all PRESERVE, except portfolio @AC-5, which is EXTEND; the only CHANGEs are to 257's own FR/AC."
  },
  "floor_breaches": []
}
```
