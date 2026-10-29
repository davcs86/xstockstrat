# Context Log: fix-agent-client-deadlines

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-agent-client-deadlines-defect.md` (Issues disabled), sidecar
  `triaged` / `ref: feature:273-fix-agent-client-deadlines`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), finding D-16
  ("partly covered" in the scan by `2026-10-19-agent-get-config-value-no-deadline-defect`).
- Severity: SEV-2. Impact type: unbounded-rpc-hang. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-agent.
- Root cause hypothesis: per-call channel boilerplate with no shared call helper, so a default deadline had nowhere
  to live; deadlines were added only at call sites with a reported hang.
- D-16 reproduces on a053b0e. Counts unchanged vs the scan: 69 `secure_channel(` sites, 71 unary `stub.X(` calls,
  the only `timeout=` at `client.py:872` (`ListOpportunities`). No streaming calls in `client.py`. Channel factory
  `mtls.py:37-43` sets no deadline/keepalive.
- **Scope split with feature 247 (`247-fix-agent-getconfig-deadline`, implementation-ready):** 247 adds
  `_CONFIG_READ_TIMEOUT_S = 3.0` and `timeout=` to `get_config_value`'s `GetConfig` only (`client.py:1751`; its own
  Out of Scope says "Deadlines on other agent → backend RPCs"). This feature covers **every other** RPC, including
  the second `GetConfig` in `get_config` (`client.py:2043`). Reuse 247's constant style; do not alias or re-edit
  247's site. Sequence after 247 (both edit `client.py`).
- **Other overlaps:** features 240, 241, 245, 249 (all implementation-ready) also edit `services/xstockstrat-agent/app/client.py`
  / `tools.py` — expect textual conflicts; a sweeping "add timeout= to every call" diff should rebase last.
  `2026-10-19-agent-tools-missing-grpc-error-mapping-defect` (tools error mapping) affects how `DEADLINE_EXCEEDED`
  is surfaced — check its status at design. Open `2026-10-19-cross-hop-deadline-bounds-unenforced-defect` (PLAT-13)
  is the same nesting concern on the backend side.
- Design forks to settle: a shared call helper / channel option vs per-site `timeout=`; default value and the
  long-running budgets (`RunBacktest`, `TriggerBackfill`, `RunFundamentalsScan`, `ScreenSymbols`) relative to the
  MCP request timeout and `agent.opportunities.read_timeout_seconds` (PLAT-13); constants vs `agent.*` config keys;
  whether channel caching (D-16's other half) is in or out.
- Recommended design depth: quick → `/sdd-design fix-agent-client-deadlines quick` (rationale: SEV-2, single
  service, no proto/migration; a config-key choice is possible, which is itself a quick trigger). Escalate to full if
  design adopts cached channels or new config keys.
- Development branch: feature/fix-agent-client-deadlines

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-16 excluding the get_config_value call covered by 247-fix-agent-getconfig-deadline.
- Warnings (7):
  1. FR-3 coverage weak (C-15): AC-3/AC-6 each stall one call; `run_backtest` makes a single backend call
     (`tools.py:783`, `client.py:634`). **Resolved:** added @AC-8 (`ingest_signal` with IngestSignal and EmitAlert
     both stalled, a sequential chain).
  2. FR-3 feasibility unproven for multi-call tools (`instantiate_template`, `manage_watchlist` read-modify-write,
     config tools, `ingest_signal`). **Resolved in spec:** FR-3 now requires design to enumerate every tool with more
     than one sequential backend call and show its worst-case sum. `trigger_backfill` / `run_fundamentals_scan` are
     single-call (`tools.py:1387`, `:1416`), so 45 s fits.
  3. AC-4 compound plus wall-clock flakiness. **Resolved:** split into @AC-4 (slow success) and @AC-9 (never
     responds); the feature header now states the bounds are asserted with an injected/fake clock or a measured
     tolerance, not raw sleeps.
  4. AC-5 samples 9 of ~71 sites. **Resolved:** added @AC-10, a static (AST) check that every unary stub call in
     `client.py` passes `timeout=`; FR-1 cites it.
  5. FR-4 wording never asserted. **Resolved:** @AC-1 now asserts the "did not respond within" wording.
  6. Cross-feature 247 report reconciliation (247 `implementation-spec.md:82, :502-503` still plans
     `docs/reports/2026-10-21-agent-rpc-deadlines-defect.md`). **Open:** reconcile at 247 execute (not editable here).
  7. No explicit persona. **Resolved:** Problem Statement names the MCP client user / operator.
- Overlap findings (WARN only; no shared config key, proto field or migration):
  - 247-fix-agent-getconfig-deadline: same file `app/client.py` (247 edits `get_config_value` `:1751-1758`, adds
    `_CONFIG_READ_TIMEOUT_S`), `tests/conftest.py`, `tests/test_client.py`, comment-only `tools.py:2365-2366`.
    247 merges first; 273 rebases and does not re-edit 247's site.
  - 215-block-fundamentals-strategy-on-etf (in-progress): `client.py` / `tools.py` around `run_backtest`
    (tool summary/docstring region expected); verify at 215 execute.
  - 241-fix-config-audit-author-spoof (implementation-ready): `tools.py` / `client.py` (config-write path likely);
    verify at spec.
  - 249-fix-ibkr-request-signing (implementation-ready): `tools.py` broker-account tools; textual rebase only.
  - 244 references `tools.py:715`, `:1642-1662` as reference only; 251, 274, 084, 242-253 low risk.
  - Merge-order: no row exists. Recommended SOFT row (WARN, Resolved=No) for the router:
    `fix-agent-client-deadlines` (273) after `fix-agent-getconfig-deadline` (247), same-file overlap; also
    consider 215/241 rows at the impl-spec step. Not written by this step.
- Next: `/sdd-design fix-agent-client-deadlines` (quick).
- Correction to warning 1 above: @AC-8 as written has IngestSignal answer (signal_id 42) while the config read and
  EmitAlert both stall. Both are best-effort, so the tool must still return the signal within 57 s. Stalling
  IngestSignal itself would stop the chain at the first call, so it would not exercise a sequential sum.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-agent-client-deadlines:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round-1 synthesis for 273-fix-agent-client-deadlines. The current best approach is the proposal's low-rework shape with four corrections. Each correction comes from checking the proposal against the code and the spec.\n\n1. Per-call deadlines in services/xstockstrat-agent/app/client.py\n   - Add two module-level fixed floats next to 247's `_CONFIG_READ_TIMEOUT_S`: `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S`. The long value is 45.0 provisionally; it may go as high as about 54, justified by a measured worst case (see risk R1).\n   - Add `timeout=_RPC_TIMEOUT_S` to every awaited `stub.X(` and `stub_cls(channel).X(` unary call.\n   - Use `timeout=_LONG_RPC_TIMEOUT_S` only for RunBacktest, TriggerBackfill, RunFundamentalsScan and ScreenSymbols.\n   - `ListOpportunities` keeps `timeout=timeout` (client.py:872). The `get_config_value`/GetConfig site (client.py:1751) belongs to 247 and is not touched.\n   - No channel change (mtls.py:37-43, AGENT-1), no shared helper and no config keys. The product-spec Fix Scope precedent is `_POLICY_READ_TIMEOUT_S` (tools.py:2371).\n   - Constants are read at call time so tests can monkeypatch them.\n\n2. Also bound `ValidateToken` in services/xstockstrat-agent/app/auth.py:39 and :71 with `timeout=_RPC_TIMEOUT_S`. This changes the r1 proposal.\n   - This takes 2 kwargs. The product-spec \"Expected\" paragraph already says \"Every agent \u2192 backend unary RPC has a bounded deadline\", so no spec amendment is needed.\n   - `validate_bearer_claims` runs on every authenticated MCP request (main.py:103), so leaving it unbounded keeps the defect's worst case.\n\n3. Do not change the wording of `_grpc_error_message` (tools.py:223-231). This changes the r1 proposal.\n   - The real AC-1/2/3 text only requires \"an error derived from DEADLINE_EXCEEDED\". The existing generic branch, \"upstream did not respond (deadline exceeded)...\", already satisfies that.\n   - The existing test test_tools.py:1985-1992 (`\"within\" not in msg`, the feature-227 contract) keeps passing.\n   - The quoted text \"did not respond within the deadline\" in the r1 proposal does not appear in acceptance.feature.\n   - The one mapper change still under consideration is the write-outcome branch in step 4.\n\n4. Write-safe deadline text (open objection O2; the proposed resolution is the lowest-rework fix).\n   - Add a keyword-only `write: bool = False` to `_grpc_error_message`. When `code == DEADLINE_EXCEEDED and write` is true, return \"upstream did not respond (deadline exceeded); outcome unknown, verify before retrying\". It must not say \"retry shortly\".\n   - Pass `write=True` only at the non-idempotent write catch sites. Spec enumerates these by grep. At minimum:\n     - record_offline_order (PlaceOrder, client.py:2206)\n     - instantiate_template (client.py:1324)\n     - create_watchlist (client.py:384)\n     - account register\n     - manage_watchlist_symbols assign\n     - emit_alert\n     - the ingest_signal primary call\n   - Add one red/green test per P-06 for the write branch, plus the existing generic-branch test, unchanged.\n\n5. Map deadline errors in three tools that currently have no mapping: ingest_signal, emit_alert and screen_symbols.\n   - Use the existing idiom `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, ...)) from e` (tools.py:2266-2267).\n   - In ingest_signal the wrap encloses only `client.ingest_signal(...)` at tools.py:612-622. The follow-up `except Exception` blocks at :633/:654/:665 must not move, so 127 @AC-4 is preserved.\n   - list_signal_sources, extract_email_content and extract_website_content stay with the SEV-3 report docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md. That report is narrowed, not closed. A deadline in those three still surfaces as a raw AioRpcError with code DEADLINE_EXCEEDED, which still counts as \"derived from DEADLINE_EXCEEDED\".\n\n6. Tests in services/xstockstrat-agent/tests/test_client_deadlines.py, reusing the test_list_opportunities_deadline.py harness (:17,34,48,50,60) and the conftest.py:51 autouse env. Mapped to the real AC ids:\n   - AC-1: get_positions against a hung ListPositions, with constants patched to about 0.2 s. The error is derived from DEADLINE_EXCEEDED within the default plus 0.5 s.\n   - AC-2: the get_config tool (namespace \"analysis\") against a hung GetConfig, for the tool's own call site (client.py:2043, not 247's site).\n   - AC-3: ingest_signal against a hung IngestSignal.\n   - AC-4: RunBacktest slower than the patched default but faster than the patched long budget returns its result, and a hung RunBacktest fails within the long budget plus 0.5 s.\n   - AC-5: a parametrized `kwargs[\"timeout\"] > 0` capture across all client functions, plus a strict AST guard over client.py and auth.py. The guard:\n     - matches both call shapes;\n     - requires `timeout` to be a `Name` in {_RPC_TIMEOUT_S, _LONG_RPC_TIMEOUT_S} with an explicit allow-list for ListOpportunities (`timeout`) and 247's `_CONFIG_READ_TIMEOUT_S`;\n     - checks the mapping both ways: the 4 long RPCs use LONG, and nothing else does.\n   - Additional regression guards (non-AC):\n     - ingest_signal returns signal_id when IngestSignal answers and config/notify hang;\n     - ingest_signal with direction=\"watchlist\" and portfolio hung (the 43 s worst path);\n     - the write-branch mapper test.\n\n7. Docs.\n   - One line in docs/runbooks/mcp-tools.md.\n   - One line in plugins/strat-lab/skills/backtest/SKILL.md stating the run_backtest/trigger_backfill long budget and its error. This is required in the same PR by root CLAUDE.md.\n   - Narrow the SEV-3 report.\n   - Merge-order SOFT row \"273 after 247\".\n   - design.md records the C-18 trade-off (per-site kwargs instead of a `_unary` helper, because the helper would collide with features 215/240/241/245/249) and the C-03 no-change statement (`_metadata()` still carries the x-user-id/x-access-scope/x-trace-id trio on every call, auth.py included).\n   - Teardown.\n\nBuild order: 247 merges, then rebase, constants and kwargs (client.py and auth.py), the mapper write branch, the tool wraps, tests, docs.",
    "open_objections": [
      {
        "text": "Ungrounded acceptance and requirement IDs (C-15). The r1 proposal cites @AC-7, @AC-8, @AC-9, @AC-10 and FR-1 through FR-5. None of these exist: docs/roadmap/features/273-fix-agent-client-deadlines/acceptance.feature defines only @AC-1 through @AC-5, and product-spec.md has no numbered FRs. FR-1's 'in app/client.py' limit, which the proposal used to defer auth.py, does not appear in the spec, whose 'Expected' text says 'Every agent \u2192 backend unary RPC'. The next proposal must map each test and decision to @AC-1..5 (the synthesis gives a mapping) and drop the invented IDs, or propose new @AC scenarios explicitly as an acceptance.feature amendment.",
        "blocking": true
      },
      {
        "text": "'retry shortly' on non-idempotent writes whose outcome is unknown. A client-side DEADLINE_EXCEEDED does not mean the write failed. With deadlines now live, the generic mapper text ('retry shortly', tools.py:230) will tell an LLM caller to retry record_offline_order/PlaceOrder (client.py:2206), instantiate_template (client.py:1324), create_watchlist (client.py:384), account register, manage_watchlist_symbols assign, emit_alert and ingest_signal. That can duplicate committed writes. The proposal did not address this. The synthesis suggests a `write=True` mapper flag with 'outcome unknown, verify before retrying' text at the enumerated write catch sites, plus a test that a record_offline_order deadline does not say 'retry'. The proposer must accept that suggestion or offer a concrete alternative.",
        "blocking": true
      },
      {
        "text": "auth.py ValidateToken (app/auth.py:39, :71) has no deadline. It runs on every authenticated MCP request (main.py:103), so a stalled identity backend still hangs every tool. The proposal deferred it only on an FR-1 wording claim that the spec does not support. The synthesis includes it (2 kwargs, and the AC-5 AST scan widened to auth.py). The proposer must confirm. If the operator still defers it, context.md must record a waiver with a named follow-up feature, not 'file a defect later'.",
        "blocking": true
      },
      {
        "text": "Mapper rewording versus the feature-227 test. test_tools.py:1985-1992 asserts `\"within\" not in msg` for the deadline_s=None branch, so the proposed 'did not respond within the deadline' text would fail it. The proposal's statement that no existing test checks this text is false. The synthesis drops the rewording, because the real AC-1/2/3 text only requires 'derived from DEADLINE_EXCEEDED'. The proposer should confirm. Reintroducing a rewording would require rewriting that test in the same step (P-06) and recording a deliberate change to the 227 contract.",
        "blocking": false
      },
      {
        "text": "The long budget cuts off backtests that used to succeed. With timeout=45, grpc-python propagates cancellation, so RunBacktest and RunFundamentalsScan runs in the 45-60 s band, which used to return, are now cancelled on the analysis side. That may also cut off the server-side evidence persistence (@feature-198 @AC-8 / feature-065) for runs over 45 s, and RunFundamentalsScan may emit partially. Ledger fails.md:2946-2950 applies. At spec time: measure the worst-case wall-clock (large symbol lists, cold 400-day fetches); confirm whether the analysis handlers persist before they check for cancellation; justify the budget with a number (up to about 54 s keeps the 3 s PLAT-13 margin).",
        "blocking": false
      },
      {
        "text": "The AC-5 AST guard must be exact. It must cover both call shapes; require `timeout` to be one of the named constants, with an explicit allow-list for ListOpportunities `timeout` and 247's `_CONFIG_READ_TIMEOUT_S`; and check the RPC-to-constant mapping both ways. Otherwise `timeout=10` or a long RPC assigned the short constant passes, which would cut off a legitimate 20 s RunBacktest (AC-4).",
        "blocking": false
      },
      {
        "text": "ExecuteFormula's 10 s budget is not grounded. Only the 5000 ms default is cited (services/xstockstrat-indicators/app/config/watcher.py:134). At spec, check whether indicators sandbox.timeout_ms has a SetConfig upper bound. If it has none and an operator sets it above about 8 s, test_formula fails with an error that does not explain why.",
        "blocking": false
      },
      {
        "text": "Test coverage for the ingest_signal wrap. The wrap must enclose only client.ingest_signal(...) at tools.py:612-622, and a regression guard must cover direction=\"watchlist\" with portfolio hung (the 43 s worst path), not only config and notify hung, so that 127 @AC-4 (follow-up failures are swallowed) is guarded.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "273 @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "127 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "227 deadline-mapper contract (test_tools.py:1985-1992)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "210 @AC-2/@AC-5 (header trio on outbound calls)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198 @AC-8 (backtest evidence persistence)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Rewording the generic DEADLINE_EXCEEDED branch of _grpc_error_message to 'did not respond within the deadline': it breaks test_tools.py:1985-1992 (the 227 contract), and no real AC requires that text. The real AC-1/2/3 text only requires 'derived from DEADLINE_EXCEEDED'.",
      "Passing deadline_s= at all ~40 catch sites: about 40 edits and more merge conflicts with in-flight features, and no AC requires the budget number in the message.",
      "A shared `_unary(stub_method, req, *, long=False)` call helper: it centralises the policy, but it rewrites ~73 sites against 5 concurrent features (215/240/241/245/249). Rejected under low rework (C-18 trade-off recorded in design.md).",
      "A channel-level deadline or a pooled channel: AGENT-1 forbids pooled channels, mtls.secure_channel has no channel deadline option, and channel reuse is out of scope in the product spec.",
      "Agent config keys (`agent.*`) for the budgets: not needed. The code-constant precedent is _POLICY_READ_TIMEOUT_S and 247's _CONFIG_READ_TIMEOUT_S, and a key cannot bound the config read itself (circular).",
      "A tool-level asyncio.wait_for(57) in middleware as the primary fix: no gRPC deadline reaches the server, no DEADLINE_EXCEEDED is surfaced (fails AC-1/2/3/5), and it hides which call stalled. At most a future backstop.",
      "Deferring auth.py ValidateToken to a follow-up defect: the spec's 'every agent \u2192 backend unary RPC' already covers it, and the fix is 2 kwargs, while a follow-up costs a full triage-to-execute cycle for the same two lines."
    ],
    "open_risks": [
      "R1: The long budget cancels backtest and fundamentals-scan work on the analysis side that used to complete (the 45-60 s band and the >60 s background-completion path), possibly including evidence persistence and partial RunFundamentalsScan emits. Needs a measured worst case at spec.",
      "R2: In a hand edit of ~73+2 sites, a long RPC could get the short constant. The only guard is the bidirectional AC-5 AST mapping check.",
      "R3: Under the new deadlines, write tools can surface DEADLINE_EXCEEDED after the server committed. Without the write-safe text, an LLM retry duplicates offline orders, template copies, watchlists or alerts.",
      "R4: list_opportunities at its 55 s ceiling plus the 3 s policy read is 58 s, which breaks the 3 s PLAT-13 margin. This is an accepted out-of-scope exception and must be recorded as such.",
      "R5: The ingest_signal worst case is 43 s (10+3+10+10+10). Deadline fallbacks become reachable: _agent_policy default, the 0.6 alert threshold, auto-alert and watchlist auto-add. None opens a security gate (insights.md:3695), but they change behavior silently under a stall.",
      "R6: The ExecuteFormula 10 s budget against an operator-raised indicators sandbox.timeout_ms is unverified.",
      "R7: Sequencing: AC-5 fails until 247 merges (the _CONFIG_READ_TIMEOUT_S allow-list). This needs a merge-order SOFT row '273 after 247'.",
      "R8: The SEV-3 report docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md is partly fixed here. It must be narrowed to list_signal_sources and extract_email_content/extract_website_content, not closed."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-07 (not applicable: deadlines are code constants per the Fix Scope precedent)",
      "PLAT-13",
      "AGENT-1"
    ],
    "rationale": "The proposal's mechanism (fixed constants passed as a timeout at each call site, no channel or helper change) is the lowest-rework fix, and the adversary agreed it breaks no Floor rule. Checking against the code produced four corrections.\n\nFirst, the proposal cites acceptance and requirement IDs that do not exist. acceptance.feature defines only @AC-1..5 and product-spec.md has no FRs. Its auth.py deferral rested on an invented FR-1 wording, while the spec's 'Expected' text covers every agent \u2192 backend unary RPC. So ValidateToken (auth.py:39/:71) is in scope for 2 kwargs, and that removes the worst case: every request hanging on identity.\n\nSecond, the mapper rewording is unnecessary and breaks test_tools.py:1985-1992, which was verified to assert `\"within\" not in msg`. The real ACs only need 'derived from DEADLINE_EXCEEDED', which the existing generic branch already gives. Dropping the rewording preserves the 227 contract at zero cost.\n\nThird, deadlines make the existing 'retry shortly' text reachable on non-idempotent writes, a duplicate-write hazard the proposal did not answer. It stays a blocking objection, with a minimal write-flag resolution offered.\n\nFourth, the 45 s long budget changes the happy path for runs in the 45-60 s band, and server-side cancellation needs a measured justification at spec.\n\nObjections the proposal did not concretely answer stay open per the mediator rule. The three blocking ones are ID grounding, write-retry text and auth.py; the proposer can close each with the specific edits listed in the approach. All of this follows the user's 'preserve as much as you can while having low rework' directive: no existing contract changes, about 2 extra kwargs and one small mapper branch. The operator's trace-propagation decision is unaffected because _metadata() still carries the header trio on every call."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 2)

The full /sdd-design debate is at its approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md stays `spec-ready`. The next /sdd-batch run resumes from the state block below.

### Open Threads

- **Approach.** The mechanism from round 1 is unchanged:
  - fixed module constants `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0` in services/xstockstrat-agent/app/client.py;
  - each passed as a per-call `timeout=`, with no channel change, no helper and no config keys;
  - LONG goes only on RunBacktest, TriggerBackfill, RunFundamentalsScan and ScreenSymbols;
  - ListOpportunities (:872) and 247's :1751 are left as they are;
  - ValidateToken in auth.py:39/:71 is in scope.

  The grounding is corrected. The authoritative artifacts are the reviewed spec-ready revision on `origin/feature/fix-agent-client-deadlines`: FR-1..5 (product-spec.md:36-53) and @AC-1..@AC-10, all tagged @FR, with fixed 10 s / 45 s / 57 s numbers. The main-dev working tree holds a stale draft. So round 1's "drop AC-6..10" decision is reversed, and the "~54 s long budget" option is removed.

  The design additions after round 2:
  - Pass `deadline_s` at every reachable catch site. This gives FR-4's "did not respond within ..." wording.
  - Add a keyword-only `write=True` mapper branch. Its text contains "within {N}s" and "outcome unknown, verify before retrying".
  - Add a per-site idempotency classification table. manage_watchlist UpdateWatchlist is idempotent.
  - Add an FR-3 worst-case table that includes the per-request auth hop.
  - Add new mappings for ingest_signal, emit_alert and screen_symbols.
  - Map tests one-to-one to AC-1..10, including the strict bidirectional AST guard (AC-10).
- **Strongest open objection (blocking): wrong-artifact grounding (C-15/P-03).** Rounds 1 and 2 read the stale main-dev acceptance.feature instead of the branch revision. The next proposal must re-ground on the branch and map tests to all ten ACs, including:
  - AC-6: run_backtest with all backends hung, ≤57 s.
  - AC-8: IngestSignal returns 42 while config and notify hang.
  - AC-9: a hung RunBacktest is bounded by 45.5 s.

  Other blocking objections:
  - FR-4 wording at every catch site.
  - The FR-3 enumeration must include the auth term. list_opportunities is then a 68 s accepted exception, not 58 s.
  - The write-safety list is incomplete. It is missing trigger_backfill, run_fundamentals_scan, the register/create/confirm writes and set_config create_key.
  - FR-4 coverage for list_signal_sources and extract_*: map them, or record an exception with operator sign-off.

  Non-blocking objections:
  - ValidateToken carries no x-trace-id, because `auth._metadata()` returns `[]`.
  - An auth deadline returns a 401 with WWW-Authenticate and is logged at INFO.
  - The p99 under the 45 s long budget has not been measured, and the effect on 198 @AC-8 persistence is unknown.
  - The ExecuteFormula 10 s budget has not been checked against the upper bound of sandbox.timeout_ms.
  - C-18: the duplicated kwarg pair at each catch site needs a guard test.
- **Floor status.** No Floor breaches. F-07 is not breached: the constants are fixed nesting invariants under the spec Fix Scope (product-spec.md:83-85). design.md must state that rationale.
- **@AC changes not covered by an operator decision:**
  - EXTEND: 273 @AC-1..6 and @AC-8..10.
  - PRESERVE:
    - 273 @AC-7;
    - 127 @AC-4 (ingest_signal follow-up failures swallowed);
    - the 227 deadline-mapper contract (test_tools.py:1974-1992);
    - 148 @AC-5 (manage_watchlist read-modify-write).
  - CHANGE: 198 @AC-8 (backtest evidence persistence under the 45 s cancellation).

  The only operator-covered change is 210 @AC-2/@AC-5 (PRESERVE).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 273-fix-agent-client-deadlines. The r2 mechanism stays: fixed module constants passed as a per-call `timeout=`, with no channel change, no helper and no config keys. The grounding changes.\n\n**Grounding correction (decides the round).** The authoritative artifacts are the reviewed spec-ready revision on `origin/feature/fix-agent-client-deadlines` (status.md = spec-ready, commit a6ab4f7f, \"product spec approved\"). The main-dev working tree holds a stale pre-review draft. Read them with `git show origin/feature/fix-agent-client-deadlines:docs/roadmap/features/273-fix-agent-client-deadlines/{acceptance.feature,product-spec.md}`.\n- The branch revision defines FR-1..FR-5 (product-spec.md:36-53) and @AC-1..@AC-10, all tagged with @FR.\n- The round-1 synthesis's objection that \"AC-6..10 / FR-1..5 do not exist\" was wrong: it was checked against the stale working tree. It is withdrawn.\n- r2's \"drop AC-6..10\" decision is reversed.\n- The design must now satisfy fixed numbers:\n  - FR-1: 10 s default, including `get_config` at client.py:2043 and `register_oauth_client` at client.py:1355.\n  - FR-2: 45 s for RunBacktest, TriggerBackfill, RunFundamentalsScan and ScreenSymbols. The value is fixed by the spec and changes only by amendment, so the \"may rise to ~54 s\" option is removed.\n  - FR-3: every tool's worst case at most 57 s, with design enumerating every multi-call tool.\n  - FR-4: the error says the upstream \"did not respond within the deadline\".\n  - FR-5: the happy path is unchanged.\n\n**Current best approach**\n1. **Constants (services/xstockstrat-agent/app/client.py)**\n   - `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0`, next to 247's `_CONFIG_READ_TIMEOUT_S`. They are read at call time so tests can monkeypatch them.\n   - Every awaited `stub.X(` and `stub_cls(channel).X(` call gets `timeout=_RPC_TIMEOUT_S`. That includes :1318/:1342, :1355 RegisterOAuthClient and :2043 GetConfig.\n   - LONG goes only on the four FR-2 RPCs.\n   - ListOpportunities keeps `timeout=timeout` (:872). 247's :1751 is not touched.\n   - design.md states the F-07 rationale in writing: these are fixed nesting invariants derived from the 60 s MCP ceiling, following the `_POLICY_READ_TIMEOUT_S` precedent (tools.py:2371). Branch product-spec Fix Scope (:83-85) already records this.\n2. **auth.py: in scope, under the spec's \"Expected\" sentence (:25) and PLAT-13**\n   - `ValidateToken` at auth.py:39 and :71 gets a deadline.\n   - Choice still open: reuse `client._RPC_TIMEOUT_S`, or add a dedicated short `_AUTH_RPC_TIMEOUT_S` (≈3 s).\n   - Either way the auth term goes into the FR-3 table. `_authorized` awaits `validate_bearer_claims` at main.py:156 inside the MCP client's 60 s clock.\n   - At 10 s: long tools 10 + 45 = 55 s ≤ 57, so it fits. ingest_signal 10 + 43 = 53 s.\n   - list_opportunities becomes 10 + 55 + 3 = 68 s. It is already out of scope and already over 57 s before this change, because auth was previously unbounded. Record it as a 68 s accepted exception, not 58 s.\n   - Correct the citation: `auth._metadata()` returns `[]` (auth.py:23-24). It is a separate function from `client._metadata()`, so ValidateToken currently carries no x-trace-id. Under the operator's trace ruling, the design either forwards the inbound `x-trace-id` from the ASGI scope headers into the ValidateToken metadata, or records why the pre-auth call has none. Forwarding is preferred, about 3 lines.\n3. **Mapper (`_grpc_error_message`, tools.py:223-231)**\n   - FR-4 and AC-1 need \"did not respond within the deadline\". The existing `deadline_s` branch, \"did not respond within {N}s (deadline exceeded)\", already gives this. It is covered by test_tools.py:1974-1982. The 227 test at :1985-1992 asserts `\"within\" not in msg` only when `deadline_s=None`, so passing `deadline_s` breaks no contract.\n   - Every catch site reachable by a deadlined call therefore passes `deadline_s=client._RPC_TIMEOUT_S` or `client._LONG_RPC_TIMEOUT_S`.\n   - Add a keyword-only `write: bool = False`. With `write=True` and DEADLINE_EXCEEDED it returns `upstream did not respond within {deadline_s:g}s (deadline exceeded); outcome unknown, verify before retrying`. That text keeps \"within\" and drops \"retry shortly\".\n   - Red/green tests per P-06.\n4. **Write-site classification table in design.md**\n   - One row per write tool with an idempotent or non-idempotent verdict.\n   - Non-idempotent, `write=True` (floor list): record_offline_order/PlaceOrder (client.py:2206), instantiate_template (:1324), create_watchlist (:384), account register, manage_watchlist_symbols assign, emit_alert, the ingest_signal primary call, trigger_backfill, run_fundamentals_scan, manage_strategy register, manage_formula register, manage_signal_source register, manage_user create, manage_offline_account confirm/snapshot, and set_config create_key.\n   - Idempotent, plain `deadline_s`: manage_watchlist replace-all `UpdateWatchlist`. It is one transaction (watchlist_repo.go:199-210), so a cancel rolls back and a lost response is a safe replay.\n   - A test asserts that every non-idempotent row's catch site passes `write=True`.\n5. **New mappings**\n   - ingest_signal (wrap only `client.ingest_signal(...)` at tools.py:612-622; the :625-669 `except Exception` follow-ups are left as they are, preserving 127 @AC-4), emit_alert and screen_symbols, using the tools.py:2266-2267 idiom plus `deadline_s`.\n   - Still uncovered: list_signal_sources and extract_email_content/extract_website_content. FR-4 applies to every tool, so they must be mapped here (preferred: 3 small wraps, which closes the SEV-3 report for those tools) or an explicit FR-4 exception must be recorded (see objections).\n6. **FR-3 table in design.md**\n   - Worst-case sums, including the auth term, for every multi-call tool:\n     - ingest_signal (IngestSignal + policy GetConfig + EmitAlert + watchlist path: 10+3+10+10+10);\n     - manage_watchlist read-modify-write;\n     - instantiate_template (`_write_source_bearer` + InstantiateTemplate, tools.py:1222-1226);\n     - the config tools;\n     - extract_* (four `_agent_policy` reads, tools.py:2401-2404, at 247's budget);\n     - run_backtest (all of its calls, for AC-6).\n   - Each row shows ≤ 57 s or a recorded exception.\n7. **Tests (services/xstockstrat-agent/tests/test_client_deadlines.py)**\n   - Reuse the hung-server harness (test_list_opportunities_deadline.py:17,34,48,50,60) and the conftest.py:51 env. AC numbers are realised by patching the constants down, with a measured elapsed time plus tolerance, as the feature preamble requires (no raw sleeps).\n   - Mapping:\n     - AC-1: get_positions, hung ListPositions; message contains \"within\".\n     - AC-2: get_config tool site :2043.\n     - AC-3: ingest_signal hung.\n     - AC-4: RunBacktest slower than default, faster than long budget, succeeds.\n     - AC-5: parametrised hung-server outline over the 9 listed RPCs at their budgets.\n     - AC-6: run_backtest with all of its backends hung, ≤ 57 s scaled.\n     - AC-7: responsive ListPositions returns the AAPL position unchanged.\n     - AC-8: IngestSignal returns 42 while config and notify hang; result within 57 s scaled.\n     - AC-9: hung RunBacktest bounded by the long budget.\n     - AC-10: the strict AST guard over client.py (both call shapes; `timeout` must be a Name in {_RPC_TIMEOUT_S, _LONG_RPC_TIMEOUT_S}; allow-list ListOpportunities→`timeout` and 247→`_CONFIG_READ_TIMEOUT_S`; bidirectional LONG mapping). It is extended to auth.py as a non-AC guard.\n   - Extra non-AC guards: the watchlist-path portfolio-hung case, and the write-flag coverage test.\n8. **Docs**\n   - mcp-tools.md line.\n   - plugins/strat-lab/skills/backtest/SKILL.md line for the run_backtest/trigger_backfill 45 s budget and its error (same-PR rule).\n   - SEV-3 report narrowed or closed, depending on item 5.\n   - merge-order SOFT row \"273 after 247\".\n   - design.md records the C-18 trade-off: per-site kwargs plus a policed `write`/`deadline_s` pair, instead of a `_unary` helper.\n   - Teardown.\n\n**Build order:** 247 merges → rebase onto the branch revision of the spec → constants and kwargs (client.py, auth.py) → mapper write branch (red/green) → catch-site `deadline_s`/`write` plus the new wraps → tests AC-1..10 → docs.",
    "open_objections": [
      {
        "text": "Wrong-artifact grounding (C-15/P-03). The r2 proposal and the round-1 synthesis read the stale main-dev working-tree acceptance.feature (AC-1..5, no @FR tags) instead of the authoritative spec-ready revision on origin/feature/fix-agent-client-deadlines. That revision has FR-1..5 at product-spec.md:36-53 and @AC-1..@AC-10, every scenario @FR-tagged, with fixed 10 s / 45 s / 57 s numbers. The next proposal must re-ground on the branch revision and map tests to all ten ACs: AC-6 (run_backtest, all backends hung, ≤57 s), AC-7 (happy path unchanged), AC-8 (IngestSignal returns 42 while config and notify hang), AC-9 (hung RunBacktest bounded by 45.5 s) and AC-10 (static guard). It must drop the 'up to ~54 s' long-budget option, because FR-2 fixes 45 s.",
        "blocking": true
      },
      {
        "text": "FR-4 wording is not met under r2. The spec and AC-1 require the error to say the upstream 'did not respond within the deadline'. r2 kept the generic `deadline_s=None` text everywhere, and its write text also lacks 'within'. The fix is cheap and contract-safe: pass `deadline_s=client._RPC_TIMEOUT_S` or `_LONG_RPC_TIMEOUT_S` at every catch site, using the existing branch at tools.py:231 / test_tools.py:1974-1982. The `write=True` text must also carry `within {deadline_s:g}s`. The 227 test at test_tools.py:1985-1992 constrains only the `deadline_s=None` branch.",
        "blocking": true
      },
      {
        "text": "FR-3 enumeration is missing. The spec requires design to list every tool with more than one sequential backend call and show its worst-case sum. The table must include the per-request ValidateToken hop: `_authorized` awaits `validate_bearer_claims` at main.py:156 inside the MCP 60 s clock. At an auth budget of 10 s: long tools 55 s, ingest_signal 53 s, list_opportunities 68 s (the accepted exception must be re-recorded at 68, not 58). Also required: instantiate_template (bearer write + InstantiateTemplate), manage_watchlist read-modify-write, the config tools, extract_* (four `_agent_policy` reads at tools.py:2401-2404) and every call run_backtest makes (AC-6). Choosing a dedicated short `_AUTH_RPC_TIMEOUT_S` (≈3 s) instead of reusing 10 s is optional but must be decided and justified.",
        "blocking": true
      },
      {
        "text": "The write-safety list is incomplete and unclassified (C-10). The floor omits trigger_backfill and run_fundamentals_scan, which are non-idempotent and on the long budget, so they are the most likely to hit a deadline. It also omits manage_strategy/manage_formula/manage_signal_source register, manage_user create, manage_offline_account confirm/snapshot and set_config create_key. 'Grep-enumerated at spec' cannot decide idempotency. design.md needs a per-site idempotent/non-idempotent table; manage_watchlist UpdateWatchlist is idempotent (single transaction, watchlist_repo.go:199-210). A test must assert that every non-idempotent site passes `write=True`.",
        "blocking": true
      },
      {
        "text": "FR-4 coverage gap: list_signal_sources and extract_email_content/extract_website_content still surface a raw AioRpcError, with no 'within the deadline' text, when a now-deadlined call expires. FR-4 applies to every MCP tool, so leaving them with the SEV-3 report contradicts the approved spec. Either map them here (3 small wraps, preferred) or record an explicit FR-4 scope exception in context.md with operator sign-off.",
        "blocking": true
      },
      {
        "text": "Trace-propagation claim is false. `auth._metadata()` returns `[]` (auth.py:23-24); it is a separate function from `client._metadata()`. ValidateToken therefore carries no x-trace-id, and the r2 citation 'auth.py:40,72 carries the trio' is wrong. Under the operator's standing 'propagate x-trace-id as much as possible' ruling, the design should forward the inbound x-trace-id from the request scope into the ValidateToken metadata, or record why the pre-auth call cannot.",
        "blocking": false
      },
      {
        "text": "An auth deadline becomes a 401 with the WWW-Authenticate discovery pointer (main.py:157-169), which an MCP client may treat as invalid credentials and answer with a re-auth flow. The failure also logs at INFO (auth.py:83). Minimum: log DEADLINE_EXCEEDED/UNAVAILABLE at WARN. Returning 503 for those codes, while staying fail-closed, would change the auth contract and needs an explicit operator decision; it is not assumed here.",
        "blocking": false
      },
      {
        "text": "The 45 s long budget is a happy-path change for runs in the 45-60 s band. Agent-side cancellation now propagates to analysis. Before /sdd-spec freezes the call sites, measure the p99 of RunBacktest/RunFundamentalsScan and confirm whether analysis persists backtest evidence (198 @AC-8) before it observes cancellation. If the p99 exceeds 45 s, escalate for an FR-2 amendment rather than changing the number silently (ledger fails.md:2946-2950).",
        "blocking": false
      },
      {
        "text": "ExecuteFormula's 10 s budget is not grounded against the indicators sandbox.timeout_ms upper bound. Only the 5000 ms default is cited, at indicators watcher.py:134. Grep for a SetConfig bound or timeout_ms_override clamp during design, not at spec. If there is none, record the risk or move test_formula to LONG; FR-2 lists exactly four RPCs, so moving it needs a spec amendment.",
        "blocking": false
      },
      {
        "text": "C-18: a `deadline_s` plus `write` kwarg pair at ~15+ catch sites is duplicated knowledge. It is acceptable as the low-rework choice only if the guard test polices it: every catch site for a deadlined call passes `deadline_s`, and every non-idempotent site passes `write=True`. Otherwise the flag drifts.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "273 @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-8",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-9",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-10",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "127 @AC-4 (ingest_signal follow-up failures swallowed)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "227 deadline-mapper contract (test_tools.py:1974-1992)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "210 @AC-2/@AC-5 (header trio on outbound calls)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198 @AC-8 (backtest evidence persistence)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "148 @AC-5 (manage_watchlist read-modify-write)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Grounding on the main-dev working-tree acceptance.feature (AC-1..5) and dropping AC-6..10/FR-1..5: that file is the stale pre-review draft. The authoritative reviewed revision is on origin/feature/fix-agent-client-deadlines (spec-ready), and silently picking the older artifact is a P-03 deviation.",
      "Leaving every catch site on the generic deadline_s=None text: it fails FR-4/AC-1's 'did not respond within the deadline' wording. The existing deadline_s branch already gives that wording without touching the 227 contract.",
      "Rewording the generic deadline_s=None branch: it breaks test_tools.py:1985-1992 (the 227 contract), and it is unnecessary because the deadline_s branch already exists.",
      "Passing deadline_s alone at write sites, without a write flag: every write would say 'retry shortly', which invites an LLM to duplicate committed offline orders, backfill jobs, fundamentals emits, template copies or alerts.",
      "A shared `_unary(stub_call, req, *, long=False)` helper: it would make the guard trivial but rewrites ~73 sites that features 215/240/241/245/249 also edit. Rejected under low rework, with the C-18 trade-off recorded in design.md.",
      "A channel-level deadline or a pooled channel: AGENT-1 requires ephemeral channels, mtls.secure_channel (mtls.py:37-43) has no deadline option, and channel reuse is out of scope in the product spec.",
      "agent.* config keys for the budgets: the spec Fix Scope (product-spec.md:83-85) resolves them as fixed constants, and a key cannot bound the config read itself (circular).",
      "A middleware-level asyncio.wait_for(57) as the primary fix: no gRPC deadline reaches the server, no DEADLINE_EXCEEDED is surfaced (fails AC-1/2/3/5/9/10), and it hides which call stalled.",
      "Deferring auth.py ValidateToken to a follow-up defect: the spec's 'Expected' text covers every agent→backend unary RPC, and the fix is two kwargs.",
      "Raising the long budget toward ~54 s: FR-2 fixes 45 s, and with the 10 s auth hop 54 s would push the long tools to 64 s, past the MCP timeout."
    ],
    "open_risks": [
      "R1: The 45 s budget cancels analysis-side RunBacktest/RunFundamentalsScan work that used to complete (the 45-60 s band and background completion past 60 s). That can leave 198 @AC-8 evidence unpersisted or fundamentals emits partial. A measured p99 and the handler's cancellation behaviour are needed before /sdd-spec.",
      "R2: In a hand edit of ~75 sites, a long RPC could get the short constant, or a catch site could miss deadline_s/write. The bidirectional AC-10 AST guard plus the write-coverage test are the only protection.",
      "R3: A DEADLINE_EXCEEDED after the server has committed is now reachable on write tools. The write text mitigates retries only at sites correctly classified as non-idempotent.",
      "R4: The list_opportunities worst case is 68 s (10 auth + 55 + 3 policy read), above the 60 s MCP timeout. It is an out-of-scope accepted exception that must be recorded at the true number.",
      "R5: An identity stall now turns into a 401 with WWW-Authenticate, which may make the client re-authenticate (it looks like a logout). Moving to 503 requires an operator auth-contract decision.",
      "R6: The ingest_signal worst path is 43 s (+10 s auth = 53 s). The deadline fallbacks (_agent_policy default, 0.6 threshold, skipped auto-alert/auto-add) become reachable silently. None of them opens a security gate (insights.md:3695-3705).",
      "R7: The ExecuteFormula 10 s budget against an operator-raised indicators sandbox.timeout_ms is unverified.",
      "R8: Sequencing: AC-10's allow-list depends on 247's _CONFIG_READ_TIMEOUT_S. A merge-order SOFT row '273 after 247' is required.",
      "R9: Artifact drift. The main-dev working tree carries the stale draft. /sdd-sync or the execute session must read from the feature branch, or later phases will re-ground on the wrong file."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-07 (not breached: fixed nesting-invariant constants per the spec Fix Scope; rationale must be written in design.md)",
      "PLAT-13",
      "AGENT-1"
    ],
    "rationale": "I checked the adversary's main claim against git and it holds. `origin/feature/fix-agent-client-deadlines` contains the reviewed, spec-ready acceptance.feature (@AC-1..10, all @FR-tagged) and the reviewed product-spec.md (FR-1..5, with fixed 10/45/57 s numbers and the FR-3 requirement to enumerate multi-call tools). The main-dev checkout holds an older draft. Both round 1 and the r2 proposal grounded on that stale file, so the round-1 objection \"AC-6..10 don't exist\" was an error, and it is withdrawn here.\n\nThat reversal moves three points from settled to blocking:\n- **FR-4 wording.** The fix is cheap and contract-safe: pass deadline_s at each catch site. test_tools.py:1985-1992 restricts only the deadline_s=None branch.\n- **FR-3.** The spec explicitly requires the enumeration table, and the auth hop at main.py:156 belongs in it. 45 s still fits at 55 s total, but list_opportunities becomes a 68 s exception.\n- **FR-4 for list_signal_sources and extract_*.** These can no longer be deferred to the SEV-3 report without recording a scope exception.\n\nThe adversary's write-safety point also holds. The r2 floor list leaves out the two long-budget non-idempotent writes, and grep cannot classify idempotency. manage_watchlist was confirmed safe because it runs in a single transaction.\n\nOne r2 claim was false. `auth._metadata()` returns [] (auth.py:23-24), so ValidateToken carries no trace id. That is non-blocking, but the operator's trace ruling favours forwarding it.\n\nNo Floor breach: the constants follow the precedent recorded in the spec's own Fix Scope. The mechanism and the low-rework posture survive unchanged. Every blocking objection has a concrete, small closure in the approach. Objections the proposal did not answer stay open under the mediator rule."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 3)

The full /sdd-design debate is at its approval gate after round 3 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md stays `spec-ready`. The next /sdd-batch run resumes from the state block below.

### Open Threads

- **Approach.** Grounded on the spec-ready branch revision (`origin/feature/fix-agent-client-deadlines`: FR-1..5, @AC-1..10, 10/45/57 s). All r2 blocking objections are closed. Settled, carried forward:
  - **client.py:** fixed constants `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0`, next to 247's `_CONFIG_READ_TIMEOUT_S`, passed as `timeout=` on every unary call in both call shapes (including :1318/:1342/:1355/:2043). LONG goes only on RunBacktest :634, ScreenSymbols :746, RunFundamentalsScan :1712 and TriggerBackfill :1949. ListOpportunities :872 and 247's :1751 are untouched. No helper and no channel change (AGENT-1). design.md must state the F-07 nesting-invariant rationale.
  - **Mapper** (`_grpc_error_message`, tools.py:223-231): new keyword `write: bool = False` with the text "upstream did not respond within {N}s (deadline exceeded); outcome unknown, verify before retrying". `deadline_s` is passed at every catch site (FR-4 "within"; the 227 contract binds only the None branch). New wraps: list_signal_sources :486, `_get_source` :2324, ingest_signal primary only :612-622 (the :625-669 follow-ups stay outside, 127 @AC-4), emit_alert :700, screen_symbols :847 (LONG), `_write_source_bearer` :347 (`write=True`). These close the 2026-10-19 missing-mapping defect report.
  - **Write classification, simplified (C-18):** derived from the verb (`write = operation not in <read set>`). The W/I table lives in design.md as rationale only. The guard checks only that every catch site in a mutating tool passes `write=` explicitly. manage_strategy update and set_strategy_live are W unless design.md cites path:line evidence that a replay has no side effect.
  - **Tests:** assert the exact `timeout` kwarg. Hung-server runs prove a bounded DEADLINE_EXCEEDED with an absolute budget + 0.5 s bound, replacing the ×1.05 slack. The AC-10 AST guard checks both call shapes and the LONG set in both directions, and a value test pins 10.0/45.0. Red/green mapper tests cover `write` and the pass-through. A 224 @AC-18/19 assertion covers InstantiateTemplate after `_write_source_bearer`.
  - **Docs:** mcp-tools.md, strat-lab backtest SKILL.md (45 s, write text, same PR), the missing-mapping defect report resolved, merge-order rows "247 → 273" and "273 → 272", teardown.
- **Strongest open objections (blocking, all operator gates under C-11):**
  1. **auth.py has no amendment or @AC (P-03/C-15).** FR-1 is limited to client.py, yet the FR-3 table assumes an auth term. Mediator recommendation: add FR-6 plus @AC-11 ("identity stall leads to a bounded fail-closed auth response within N s"), with sign-off recorded here. Fallback: descope auth.py to a follow-up defect and record FR-3 as excluding the auth hop.
  2. **401 vs 503 on an identity DEADLINE_EXCEEDED/UNAVAILABLE, plus the auth budget.** Today `_send_unauthorized` (main.py:164-174) sends WWW-Authenticate, which turns a slow identity into a forced re-auth and an effective logout. Recommendation: 503 without WWW-Authenticate via a three-way `validate_bearer_claims` result (still never raises), WARN logging, reuse of the 10 s budget (no ValidateToken p99 measured for 3 s), and x-trace-id carried through `auth._metadata(trace_id)`. list_opportunities becomes an accepted 68 s exception.
  3. **272 pass-through is wider than the grant and inert today (P-03/PLAT-13).** The mapper returns `exc.details()` when they differ from "Deadline Exceeded", whatever `deadline_s` is, which goes beyond the recorded "deadline_s is None" grant. It never fires while `analysis.backtest.max_duration_seconds` is 300 (001_config_tables.up.sql:69) / 120 in production (002_config_environment.up.sql:71), above the agent's 45 s. Resolution: write a ≤ ~40 s SetConfig ceiling / nesting contract into 272's spec and the merge-order row, or record the branch as test-only.

  Non-blocking: AC-6 states tool-hop scope, or adds an ASGI identity-stall test if auth stays in. Do not extend `validate_bearer_jwt`'s signature, and grep the claims consumers (tools.py:99-187) for serialisation of `trace_id`. The 45 s LONG p99 and the analysis cancellation behaviour (198 @AC-8) are still unmeasured; escalate for an FR-2 amendment if p99 > 45 s.
- **Floor status.** No Floor breaches. F-07 is satisfied by the spec Fix Scope, provided design.md writes the rationale down.
- **@AC changes not covered by an operator decision:**
  - EXTEND: 273 @AC-1..6 and @AC-8..10; proposed 273 @AC-11 (needs FR-6); the 272 server-detail pass-through (widened discriminator).
  - CHANGE: the agent OAuth edge contract (401 + WWW-Authenticate becomes 503 for backend-unavailable); 198 @AC-8 (backtest evidence persistence under the 45 s cancellation).
  - PRESERVE: 273 @AC-7; 127 @AC-4; the 227 deadline-mapper contract (test_tools.py:1974-1992); 224 @AC-18/19; 148 @AC-5; 170 @AC-12.

  The only operator-covered change is 210 @AC-2/@AC-5 (EXTEND: trace now also on ValidateToken).

Once the operator rules on the three gated items, the design is approvable without another debate round.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis for 273-fix-agent-client-deadlines, grounded on the spec-ready branch revision (origin/feature/fix-agent-client-deadlines: FR-1..5, @AC-1..10, 10/45/57 s). The r2 grounding objections are closed. The client.py mechanism is settled. Three items still need an operator decision before approval: auth.py scope/budget/status code, 272 nesting, and the widened pass-through.\n\n**Settled (carry forward unchanged)**\n\n1. **client.py constants** (services/xstockstrat-agent/app/client.py)\n   - `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0` sit next to 247's `_CONFIG_READ_TIMEOUT_S` and are read at call time.\n   - Every unary call in both shapes gets `timeout=`. That covers `await stub.X(` and `await stub_cls(channel).X(` at :1318/:1342, plus :1355 RegisterOAuthClient and :2043 GetConfig.\n   - LONG goes exactly on RunBacktest :634, ScreenSymbols :746, RunFundamentalsScan :1712 and TriggerBackfill :1949.\n   - ListOpportunities :872 and 247's :1751 are untouched.\n   - No helper and no channel change (AGENT-1; mtls.py:37-43).\n   - design.md records the F-07 nesting-invariant rationale (precedent tools.py:2371; spec Fix Scope).\n\n2. **Mapper** (`_grpc_error_message`, tools.py:223-231)\n   - New keyword `write: bool = False`. With `write=True` the text is `upstream did not respond within {deadline_s:g}s (deadline exceeded); outcome unknown, verify before retrying`.\n   - Every catch site passes `deadline_s=client._RPC_TIMEOUT_S` or `_LONG_RPC_TIMEOUT_S`. This satisfies FR-4/@AC-1 \"within\"; the 227 contract binds only the `deadline_s=None` branch (test_tools.py:1985-1992).\n   - New wraps use the tools.py:2266-2267 idiom:\n     - list_signal_sources :486\n     - `_get_source` :2324 (covers both extract_* tools)\n     - ingest_signal primary only :612-622. The :625-669 follow-ups stay in their own `except Exception`, and the step text must state that boundary (127 @AC-4).\n     - emit_alert :700\n     - screen_symbols :847 (LONG)\n     - `_write_source_bearer` :347 (`write=True`; covers instantiate_template :1222 and manage_signal_source :1309)\n   - These wraps close the 2026-10-19 SEV-3 missing-mapping report.\n\n3. **Write classification: simplified per the adversary's C-18 point**\n   - At shared catch sites, `write=` is derived from the verb: `write = operation not in <read-verb set>`. Any verb not in the read set counts as a write.\n   - The W/I table lives in design.md as rationale, not as test data.\n   - The guard becomes \"every catch site in a mutating tool passes `write=` explicitly\". It no longer checks per-row W membership.\n   - manage_strategy update and set_strategy_live move to W unless design.md cites path:line evidence that a replay emits no version bump, ledger event or alert.\n\n4. **Tests** (tests/test_client_deadlines.py; harness test_list_opportunities_deadline.py:17,34,48,50,60; conftest.py:51)\n   - Budget value: assert the exact call kwargs `timeout` (247 §5(b) style).\n   - Hung-server runs prove only \"bounded DEADLINE_EXCEEDED, no hang\", with an absolute bound of budget + 0.5 s on the patched clock. Relative 5 % slack is replaced.\n   - Mapping AC-1..AC-10 is as r3 proposed. The AST guard (AC-10) checks both call shapes, keeps the allow-list, and checks the LONG set both ways. A value test pins 10.0/45.0.\n   - Red/green mapper tests cover `write` and the pass-through (P-06).\n   - 224 @AC-18/19: assert that a deadline on InstantiateTemplate after `_write_source_bearer` does not report success.\n   - AC-6 is stated as tool-hop scope (RunBacktest 45 s), or an ASGI-level identity-stall test is added if auth stays in scope.\n\n5. **Docs**\n   - mcp-tools.md: deadline and write wording.\n   - strat-lab backtest SKILL.md: 45 s budget for run_backtest and trigger_backfill, and the write text (same PR).\n   - SEV-3 report: resolved by 273.\n   - merge-order: rows \"247 → 273\" and \"273 → 272\".\n   - Teardown.\n\n**Mediator's recommended resolution of the open items (needs operator sign-off, C-11)**\n\n6. **auth.py ValidateToken** (auth.py:39, :71)\n   - Recommended: keep it in scope via a spec amendment (FR-6 plus a new @AC-11: \"identity stalls → bounded fail-closed auth response within N s\").\n   - On DEADLINE_EXCEEDED/UNAVAILABLE, return 503 without `WWW-Authenticate`, instead of the 401 with the re-auth pointer (main.py:164-174). That 401 risks a forced re-auth or logout loop for the Claude.ai connector when identity is only slow.\n   - Implement this with a three-way result from `validate_bearer_claims`: claims, None, or a backend-unavailable sentinel. It still never raises (auth.py:58-61).\n   - Log those codes at WARN; they currently log at INFO (auth.py:83).\n   - Budget: recommend reusing `_RPC_TIMEOUT_S` (10 s) rather than an unmeasured 3 s, given the 2-connection direct pool and no ValidateToken p99.\n     - FR-3 still holds at 10 s: long tools 55 s, ingest_signal 53 s, multi-call writes 30 s, single-call tools 20 s.\n     - list_opportunities is an accepted exception at 68 s (10 + 3 + 55), with the follow-up of lowering its SetConfig ceiling.\n     - 3 s is acceptable only with a measured p99.\n   - Trace: `auth._metadata(trace_id)` carries x-trace-id (it is currently `[]`, auth.py:23-24). `_authorized` (main.py:150-161) mints `_new_trace_id()` (tools.py:173; main.py already imports app.tools) and stamps `claims[\"trace_id\"]`, which the middleware reuses (tools.py:199-214).\n     - Do not change `validate_bearer_jwt`'s signature beyond the timeout; it has no production caller.\n     - Grep the `_require_claims`/`_claims_from_context` consumers (tools.py:99-187) to confirm none serialises the claims dict.\n   - Fallback if the operator declines the amendment: auth.py goes out of scope with a follow-up defect, and FR-3 is recorded as \"excluding the auth hop\".\n\n7. **272 pass-through**\n   - The mapper returns `exc.details()` on DEADLINE_EXCEEDED when the details are non-empty and differ from grpc's client sentinel \"Deadline Exceeded\", whatever `deadline_s` is.\n   - This widens the operator's literal \"deadline_s is None\" grant. The widening is necessary because run_backtest now passes deadline_s=45, which makes the None branch dead there.\n   - It only fires if 272's server bound is below the agent's 45 s. Today `analysis.backtest.max_duration_seconds` is seeded at 300 (001_config_tables.up.sql:69) and 120 in production (002_config_environment.up.sql:71). Both are above 45 s, so the agent deadline always fires first.\n   - Recommended: put a PLAT-13 nesting contract into 272's spec (a SetConfig ceiling ≤ ~40 s on that key, or an explicit relation to the agent's 45 s) and into the merge-order row. Otherwise record the branch as test-only until 272 sets the bound.",
    "open_objections": [
      {
        "text": "[P-03/C-15] auth.py scope has no amendment and no @AC. The r3 FR-3 table assumes an auth term, and the stall-to-401 behaviour is user-visible, yet FR-1 is limited to client.py and no scenario covers the auth deadline, the failure response or the shared trace id. 'Extra guards (not AC)' do not satisfy C-15. To resolve: add FR-6 plus @AC-11 (identity stall leads to a bounded fail-closed response within N s) with operator sign-off recorded in context.md, or descope auth.py to a follow-up defect and record FR-3 as excluding the auth hop.",
        "blocking": true
      },
      {
        "text": "[C-11 operator gate] 401 vs 503 on an identity DEADLINE_EXCEEDED/UNAVAILABLE must be decided before spec, not deferred as a risk. `_send_unauthorized` (main.py:164-174) sends WWW-Authenticate with the resource-metadata pointer, so a brief identity slowdown becomes a forced re-auth. The refresh also goes through identity and likely fails, which effectively logs the user out. The mediator recommends 503 without WWW-Authenticate, via a three-way `validate_bearer_claims` result that still never raises. The budget choice (3 s unmeasured vs reusing 10 s) should be decided in the same gate; the mediator leans 10 s absent a ValidateToken p99, given identity's 2-connection direct pool.",
        "blocking": true
      },
      {
        "text": "[P-03/PLAT-13] The 272 pass-through is wider than the recorded operator grant ('deadline_s is None -> exc.details()'), and nobody has agreed it will ever fire. The widening (details != 'Deadline Exceeded', whatever deadline_s is) is defensible, but it must be surfaced to the operator for sign-off. It only helps if 272's server bound is below 45 s, yet `analysis.backtest.max_duration_seconds` is 300 by default (001_config_tables.up.sql:69) and 120 in production (002_config_environment.up.sql:71). To resolve: write the agent-45 s / server-≤~40 s nesting into 272's spec (a SetConfig ceiling) and the 273→272 merge-order row, or record the branch as test-only until 272 sets a bound (C-18 speculative-branch concern).",
        "blocking": true
      },
      {
        "text": "[C-18] The write-safety apparatus is heavier than needed. Drop the AST guard that checks per-row W membership, because it couples CI to a hand-kept classification that features 215/240/241/245/249 must keep updating. Keep `write` with a verb-derived default (not in the read set means write), keep the table in design.md as rationale, and reduce the guard to 'every catch site in a mutating tool passes write= explicitly'.",
        "blocking": false
      },
      {
        "text": "[C-18] Two I verdicts lack evidence. For manage_strategy update and set_strategy_live, cite path:line showing that a replay causes no version bump, ledger event or alert, or mark both W under the approach's own conservative rule.",
        "blocking": false
      },
      {
        "text": "Scaled-timing tests will flake. Elapsed ≤ budget × 1.05 at 0.2 s / 0.9 s leaves only 10 ms / 45 ms of slack. Assert the exact `timeout` kwarg for the budget value, and use the hung-server run only to show a bounded DEADLINE_EXCEEDED with an absolute guard (budget + 0.5 s, the scenario tolerance).",
        "blocking": false
      },
      {
        "text": "AC-6 coverage gap. Tool-level tests skip `_authorized`, so the auth term in the run_backtest worst case is never exercised. Either state AC-6 as tool-hop scope or add one ASGI-level test that stalls identity (required if auth stays in scope via FR-6).",
        "blocking": false
      },
      {
        "text": "Trace plumbing hygiene. Do not extend `validate_bearer_jwt`'s signature for the trace id; it has no production caller. Grep the claims consumers (tools.py:99-187) to confirm adding `trace_id` to the claims dict is not echoed or serialised anywhere.",
        "blocking": false
      },
      {
        "text": "[C-16] Make two preserve boundaries explicit in the spec step text. For 127 @AC-4, the new ingest_signal primary wrap (:612-622) must not enclose the :625-669 follow-ups. For 224 @AC-18/19, add an assertion that a deadline on InstantiateTemplate after `_write_source_bearer` (:347) does not report success.",
        "blocking": false
      },
      {
        "text": "Carried from r2: the 45 s LONG budget cancels RunBacktest/RunFundamentalsScan runs in the 45-60 s band. A measured p99 and the analysis handler's cancellation behaviour (198 @AC-8 evidence persistence, partial fundamentals emits) are still missing. If p99 > 45 s, escalate for an FR-2 amendment and do not change the number silently.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "273 @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-8",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-9",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-10",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "273 @AC-11 (proposed: identity stall -> bounded fail-closed auth response; requires FR-6 amendment)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "Agent OAuth edge contract (main.py:164-174 401 + WWW-Authenticate on validation failure) — 503 for backend-unavailable",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "127 @AC-4 (ingest_signal follow-up failures swallowed)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "227 deadline-mapper contract (test_tools.py:1974-1992)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "272 server-side deadline message pass-through (widened discriminator)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "210 @AC-2/@AC-5 (header trio on outbound calls; trace now also on ValidateToken)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "224 @AC-18/19 (source bearer write then InstantiateTemplate)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "198 @AC-8 (backtest evidence persistence)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "148 @AC-5 (manage_watchlist read-modify-write)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "170 @AC-12 (watchlist bindings set-assignment)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A dedicated 3 s `_AUTH_RPC_TIMEOUT_S` without a measured ValidateToken p99. It is tighter than FR-1's own 10 s and turns brief identity slowness into fail-closed rejections; the mediator prefers reusing `_RPC_TIMEOUT_S` (DRY, still within 57 s at 55 s for long tools). This stays open for the operator if a p99 justifies 3 s.",
      "Mapping an identity deadline to the existing 401 with WWW-Authenticate. It invites the OAuth client to re-authorize against a stalled identity, effectively logging the user out; 503 without the pointer stays fail-closed without destroying the session.",
      "Pulling auth.py in 'under Expected' without an amendment. It repeats the agent-mcp-oauth scope-creep fail (fails.md:485) and leaves the user-visible behaviour without an @AC (C-15).",
      "An AST guard enforcing per-row W/I membership. It turns a hand-kept classification into CI coupling for unrelated features; it is replaced by a verb-derived default plus an 'explicit write= at mutating sites' guard.",
      "Relative-tolerance (×1.05) elapsed-time assertions on scaled clocks. They flake on CI jitter; replaced by exact kwarg assertions plus an absolute +0.5 s bound.",
      "The literal None-only pass-through. It is dead at every site that now passes deadline_s, including run_backtest, so a 272 server timeout would be mislabelled as 'did not respond within 45s'.",
      "Grounding on the main-dev working-tree acceptance.feature (AC-1..5): stale pre-review draft (P-03).",
      "Leaving catch sites on the generic deadline_s=None text: it fails FR-4/@AC-1 'within'.",
      "Rewording the deadline_s=None branch: it breaks the 227 contract (test_tools.py:1985-1992).",
      "deadline_s alone at write sites (no write flag): 'retry shortly' invites duplicate orders, backfills, emits, template copies and alerts (C-10).",
      "A shared `_unary` helper: rework across ~73 sites that 215/240/241/245/249 also edit; the C-18 trade-off is recorded.",
      "A channel-level deadline or pooled channel: AGENT-1, and mtls.secure_channel has no deadline option.",
      "agent.* config keys for the budgets: the spec Fix Scope fixes them as constants, and a key cannot bound the config read itself.",
      "Middleware asyncio.wait_for(57) as the primary fix: no gRPC deadline reaches the server, and it fails AC-1/2/3/5/9/10.",
      "Raising the long budget toward ~54 s: FR-2 fixes 45 s."
    ],
    "open_risks": [
      "R1: The 45 s LONG budget cancels RunBacktest/RunFundamentalsScan runs in the 45-60 s band. 198 @AC-8 evidence may go unpersisted and fundamentals emits may be partial. No p99 or handler-cancellation evidence exists, and if 45 s is wrong an FR-2 amendment is required.",
      "R2: The 272 nesting is inverted today. The server bound defaults to 300 (staging) and is 120 in production, both above the agent's 45 s, so the agent always cancels first and the server-detail pass-through never fires until 272 sets a ceiling at or below ~40 s.",
      "R3: A DEADLINE_EXCEEDED after the server commits is now reachable on write tools. The write text mitigates retries only where the verb-derived default classifies correctly; a new mutating verb added to a read set would be mislabelled.",
      "R4: list_opportunities is an accepted out-of-scope exception at 68 s (10 s auth budget) or 61 s (3 s), above the 60 s MCP timeout. Follow-up: lower its SetConfig ceiling.",
      "R5: Identity pool pressure. With identity a direct 2-connection pool, a slow identity under an auth deadline may produce bursts of fail-closed rejections. The status-code choice (401 vs 503) determines whether that becomes a logout loop.",
      "R6: The ingest_signal worst path (43 s, plus auth) reaches the deadline fallbacks silently (_agent_policy default, 0.6 threshold, skipped auto-alert/auto-add); none opens a security gate (insights.md:3695-3705).",
      "R7: ExecuteFormula at 10 s versus an operator-raised indicators sandbox.timeout_ms, for which no SetConfig upper bound was found. Raising it to 10 s or more truncates test_formula and needs an FR-2 amendment.",
      "R8: Sequencing. AC-10's allow-list depends on 247's `_CONFIG_READ_TIMEOUT_S` (merge 247 → 273), and 272 depends on 273's mapper (273 → 272).",
      "R9: Artifact drift. main-dev holds the stale draft spec, so later phases must read from origin/feature/fix-agent-client-deadlines.",
      "R10: The extract_* tools have no MCP-level cap. HTTP egress and N > 2 URLs can exceed 57 s; this is recorded as an exception with a follow-up.",
      "R11: Hand edits across ~75 sites risk a mis-assigned constant or a missed deadline_s/write. Only the AC-10 bidirectional guard and the catch-site guards protect against this."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-07 (not breached: fixed nesting-invariant constants per the spec Fix Scope; rationale must be written in design.md)",
      "PLAT-13",
      "AGENT-1"
    ],
    "rationale": "r3 closes every r2 blocking objection:\n- **Grounding:** now on the branch revision.\n- **FR-4 wording:** `deadline_s` passed at every catch site, with \"within\" also in the write text.\n- **FR-3 table:** enumerated, including the auth term.\n- **Write-safety classification:** complete.\n- **FR-4 coverage:** six new wraps, which also close the SEV-3 report.\n- **Non-blocking r2 items:** the trace-id plumbing is concrete, and the ExecuteFormula ceiling is grounded via `_clamp_override`.\n\nThe client.py mechanism is not disputed by the adversary. It is carried forward as settled.\n\nThe adversary's three blocking objections hold, and I verified their factual bases:\n1. **auth.py has no amendment.** It is real scope beyond FR-1, which is limited to client.py, and it changes user-visible behaviour: a stalled identity now gets a 401 with the WWW-Authenticate re-auth pointer (main.py:164-174). That needs an FR/AC under C-15 and an operator decision under C-11.\n2. **401 vs 503 cannot wait.** The response shape decides whether a slow identity forces a re-auth. That re-auth itself depends on identity, so it likely fails too.\n3. **The pass-through goes beyond the grant and would never fire.** It is wider than the recorded \"None-only\" grant. The config seeds also confirm it is inert today: max_duration_seconds is 300 at 001_config_tables.up.sql:69 and 120 in production at 002_config_environment.up.sql:71. I added the production 120 figure; it does not change the conclusion.\n\nThe proposal answers none of these three concretely, so under the mediator rule they stay open and blocking. Each has a small, concrete closure, given in the approach:\n- FR-6 plus @AC-11, with a 503 three-way result and 10 s reuse, or descoping auth.py.\n- A nesting ceiling written into 272's spec, or recording the branch as test-only.\n\nThe C-18 points and the test-flake points are adopted as simplifications; they are not blocking. No Floor breach: F-07 is satisfied by the spec's own Fix Scope, provided design.md writes the rationale down. Once the operator rules on the three gated items, the design is approvable without another debate round."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md (written earlier; services: xstockstrat-agent; reuse: `_POLICY_READ_TIMEOUT_S` fixed-float constant style, `tools.py:2266-2267` AioRpcError→`_grpc_error_message` idiom, `test_list_opportunities_deadline.py` hung-server harness).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: fixed `_RPC_TIMEOUT_S = 10.0` / `_LONG_RPC_TIMEOUT_S = 45.0` passed as per-call `timeout=` at all 73 unary sites (LONG on RunBacktest/ScreenSymbols/RunFundamentalsScan/TriggerBackfill only); `deadline_s` at every catch site plus a `write` flag ("outcome unknown, verify before retrying"); six new wraps; ValidateToken bounded with a three-way result → 503 without WWW-Authenticate on identity DEADLINE_EXCEEDED/UNAVAILABLE. Rejected: shared `_unary` helper, channel-level deadline, `agent.*` config keys, middleware `wait_for`, per-row W/I AST guard, None-only pass-through, dedicated 3 s auth budget.
- OPERATOR DECISIONS (binding, recorded 2026-10-22, design gate r3) — APPROVED as synthesized with three binding additions:
  - (a) SCOPE: the agent's ValidateToken call to identity (auth.py / `validate_bearer_claims`, main.py:156) gets a deadline. Added FR-6 to product-spec.md and @AC-11 to acceptance.feature (an identity stall yields a bounded fail-closed response within 10.5 s, sharing the request trace id).
  - (b) On identity DEADLINE_EXCEEDED/UNAVAILABLE during token validation the agent returns 503 WITHOUT WWW-Authenticate (three-way validation result), not 401; a genuinely invalid token still returns 401 with WWW-Authenticate. Sanctions the CHANGE to the agent OAuth edge contract (main.py:164-174).
  - (c) The widened 272 pass-through (returns `exc.details()` when details != 'Deadline Exceeded', regardless of `deadline_s`) is SIGNED OFF.
  - Carried: r2 gate — 273 owns the pass-through in `_grpc_error_message` (tools.py:228-231) for 272; merge order 273 before 272. 2026-10-21 standing — x-trace-id propagated as much as possible, no C-03 waiver.
- Constitution rules touched: C-01, C-03, C-10, C-11, C-14, C-15, C-16, C-18, P-02, P-03, P-06, F-07, PLAT-13, AGENT-1. Floor breaches: none (F-07 honored by the Fix Scope's fixed nesting-invariant constants; rationale in design.md §1).
- Business rules: CHANGE agent OAuth edge contract (signed off r3 (b)); EXTEND 227 @AC-2, 273 @AC-11 (r3 (a)), 272 pass-through (r2 + r3 (c)), 210 @AC-2/@AC-5 (2026-10-21 trace decision); PRESERVE 127 @AC-4, 227 mapper contract, 224 @AC-18/19, 148 @AC-5, 170 @AC-12, 198 @AC-8 (at risk, R1 — not signed off as a CHANGE; spec must show p99 ≤ 45 s or escalate).
- Status: spec-ready → design-approved.

### Open Threads

- [ ] R1 — 45 s LONG budget may cancel 45-60 s RunBacktest/RunFundamentalsScan runs (198 @AC-8 evidence persistence, partial fundamentals emits); measure/cite p99, escalate for FR-2 amendment if > 45 s — target: /sdd-spec, long-budget kwargs step.
- [ ] R2 — 272 nesting inverted today (`analysis.backtest.max_duration_seconds` 300 staging / 120 prod > 45 s); pass-through inert until 272 sets a ≤ ~40 s ceiling — target: merge-order 273 → 272 row + 272 spec.
- [ ] R3 — post-commit DEADLINE_EXCEEDED on writes; verb-derived `write` default can mislabel a mutating verb added to the read set — target: mapper step + explicit-`write=` guard.
- [ ] R4 — list_opportunities accepted exception at 68 s; follow-up to lower its SetConfig ceiling — target: docs step (follow-up defect).
- [ ] R5 — identity 2-connection pool: slow identity → bursts of fail-closed 503s — target: auth step (WARN logging), dev observation.
- [ ] R6 — ingest_signal worst path (53 s with auth) hits silent fallbacks; none opens a security gate — target: ingest_signal wrap step (state posture).
- [ ] R7 — ExecuteFormula 10 s vs operator-raised `sandbox.timeout_ms` (no SetConfig ceiling found) — target: /sdd-spec, verify `_clamp_override` ceiling.
- [ ] R8 — sequencing 247 → 273 → 272 — target: merge-order rows.
- [ ] R9 — main-dev holds a stale draft spec; read from origin/feature/fix-agent-client-deadlines — target: /sdd-spec boot.
- [ ] R10 — extract_* have no MCP-level cap (HTTP egress) — target: docs step (follow-up defect).
- [ ] R11 — ~75 hand edits risk a mis-assigned constant / missed `deadline_s`/`write` — target: test step (@AC-10 bidirectional guard + catch-site guards).

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status: design-approved → implementation-ready.
  - Step 1 (docs): latency baseline, R1/R5.
  - Steps 2/3: client test/service.
  - Steps 4/5: mapper test/service.
  - Steps 6/7: tools test/service.
  - Steps 8/9: auth test/service.
  - Step 10: mcp-tools.md + oauth.md + strat-lab SKILL.md.
  - Step 11: SEV-3 sidecar + merge-order rows + follow-up reports.
  - Step 12: teardown.
- Coverage: every @AC-1..@AC-11 maps to a test step (Scenario Coverage table in the spec, C-15).
- Key codebase findings:
  - **Call sites.** An AST walk over `app/client.py` (pre-247, tip 9f99103b) finds exactly 73 unary calls. Of
    those, 67 get `_RPC_TIMEOUT_S`, 4 get LONG (RunBacktest @634, ScreenSymbols @746, RunFundamentalsScan @1712,
    TriggerBackfill @1949), and 2 stay untouched (ListOpportunities @866/872, and 247's get_config_value GetConfig
    @1751).
    - The design's line cites for `:1355` / `:1324` / `:2206` / `:384` are function-`def` lines; the spec gives
      call lines.
  - **247 is unmerged.** 247 is `implementation-ready`, and `_CONFIG_READ_TIMEOUT_S` is absent from client.py. 273
    execution is hard-gated on 247 merging and this branch rebasing; all lines are to be re-anchored by function
    name.
  - **tools.py catch sites.** tools.py has 40 `except grpc.aio.AioRpcError` catch sites. Only list_opportunities
    passes `deadline_s`. With the 6 new wraps, Step 7's table gives `deadline_s` / `write` per site. `write` is
    verb-derived:
    - manage_watchlist: `operation != "update"`;
    - manage_offline_account: `operation not in (get_order, list_orders, list_positions)`;
    - all other mutating tools: `True`.
  - **Test harness.** The new generic `hung_backend` conftest fixture (threaded `grpc.server` + GenericRpcHandler)
    serves every non-config service, including identity for the TestClient-based @AC-11 test. Config paths reuse
    247's `hung_config_server`, and 247's fixture is not modified.
  - **R7 resolved by evidence.** indicators `_clamp_override` only tightens (`servicer.py:66-68`), and the
    configured sandbox timeout is 5000 / 3000 ms, so the 10 s ExecuteFormula budget is safe. The residual risk (no
    SetConfig bound on `indicators.sandbox.timeout_ms`) goes into the Step 11 follow-up report.
  - **New R2-like inversion.** `analysis.screener.max_duration_seconds` defaults to 120
    (analysis `servicer.py:3786`), above the agent's 45 s ScreenSymbols budget. The backend side belongs to the
    open cross-hop PLAT-13 defect.
  - **272 slug.** 272 is `fix-analysis-backtest-bounds`
    (`docs/reports/2026-10-21-analysis-backtest-bounds-defect.status` on main-dev).
  - **Trace id.** `_authorized` mints `_new_trace_id()` and stamps `claims["trace_id"]`. No claims consumer
    serialises the dict.
  - **Doc drift.** `services/xstockstrat-agent/docs/oauth.md:31-33` also documents the 401 and gets the 503
    sentence (Step 10). AGENT-5 drift is fixed in Step 12.
- R1: no p99 for the long RPCs exists in the repo. Step 1 must measure it before Step 3 is committed, and escalate
  for an FR-2 amendment if p99 is above 45 s.

### Open Threads

- [ ] R1/R5: latency baseline. Target: Step 1, before Step 3 is committed.
- [ ] 247 merge + rebase. Target: precondition before Step 2.
- [ ] Merge-order rows 247 → 273 and 273 → 272. Target: Step 11.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings (criteria: PASS WITH WARNINGS; overlap: WARN). Advisory, so lifecycle is unchanged.
- Addressed in implementation-spec.md (each re-verified against the tree):
  - [x] Step 11 merge-order: `origin/main-dev` already has both rows (`merge-order.md:84-85`), and the feature tip
    predates them. Instruction 2 now says "ensure exactly one row per pair, never duplicate". It amends the 272
    row to Step 5's widened pass-through wording ("details non-empty and != `Deadline Exceeded`, regardless of
    `deadline_s`") and adds the PLAT-13 note (server bound ≤ ~40 s). Verification is now two `grep -c` = 1
    checks, a no-hit check for the stale wording, and a check for the 40 s note. The Step Dependencies merge-order
    bullet was updated to match.
  - [x] Step 1: added an explicit checkpoint. The entry must end `Baseline verdict: PASS` or
    `Baseline verdict: HALT — <reason>` ("Not measured" counts as HALT until operator sign-off), with a verification
    grep. Step 3 may not be committed unless the verdict is PASS or an operator overrides it.
  - [x] Step 3 verification: the `metadata=` baseline is the literal 73 (measured at the current tip). A note
    explains that `grep -c` counts lines and that the Step 2 AST guard is authoritative.
  - [x] Step 7 verification: the `deadline_s=client._RPC_TIMEOUT_S` count expects 41. That is 36 existing
    RPC-row catch sites (40 `except grpc.aio.AioRpcError` blocks, minus `list_opportunities`, minus 3 LONG) plus
    5 new RPC wraps. LONG expects 4. Step 6's AST guard is named as authoritative.
  - [x] Step 9 evidence: one sentence explains that `x-user-id`/`x-access-scope` are not forwarded on
    ValidateToken because the call runs pre-auth.
  - [x] Step 10: it must land in the same PR as Steps 3 and 7 (the integration PR in sequential mode).
  - [x] Line anchors: the reviewer confirmed the pre-247 tip anchors. No edit was needed; re-anchoring by function
    name after the rebase is already instructed.
- Still open (carried into execution):
  - [ ] Step 6 size: 14 test groups in one file, which depend on 247's `hung_config_server`,
    `_CONFIG_READ_TIMEOUT_S` and `HANG_GUARD_S`. The reviewer suggested optionally splitting the AST guards
    (items 11-14) into their own step if the file grows. This was not done, because the reviewer said no change is
    required. The executor decides at the Step 6 checkpoint.
  - [ ] Overlap (rebase-only, re-grep anchors after each merge):
    - `client.py`, `conftest.py` and `test_tools.py` overlap with 247. This is the hard precondition: 247 must
      merge and this branch be rebased first.
    - `tools.py` overlaps with 247, 249, 246, 241, 214 and 187.
    - `docs/runbooks/mcp-tools.md` overlaps with 249 and 246, on disjoint sections.
    - `services/xstockstrat-agent/docs/context-constitution.md` overlaps with 247, on disjoint rows.
  - [ ] Reconcile the agent `context-constitution-findings.md` index rows with 247's agent-rpc-deadlines defect
    reference when both features land (Step 12 teardown).
  - [ ] Feature 272's lifecycle state was unverified by the overlap scan. Confirm it before Step 11 amends its
    merge-order row.

## Session 2026-10-29 — sdd-execute re-spec (sdd-batch-execute)

- Branch setup: `git merge --no-edit origin/main-dev` into the detached `origin/feature/fix-agent-client-deadlines`
  checkout (merge `723964ae`). The one conflict was `docs/roadmap/ledger/insights.md`. The branch side was empty,
  so main-dev's `homelab-compose-deploy` entry was kept after the base. `ledger-guard --fix` reported clean, so no
  repair went into the merge commit.
- **247 precondition met**: 247 is merged into main-dev. After the merge, `client.py:33` has
  `_CONFIG_READ_TIMEOUT_S = 3.0`, and `tests/conftest.py` has `HANG_GUARD_S` (`:19`) and `hung_config_server`
  (`:83`).
- Re-spec of Step bodies 2, 3, 6, 7, 8 and 11 only (commit `eb7cc507`). Every named symbol resolves; only the
  anchors moved.
  - Step 2: conftest anchors moved (`set_env` `:57`, `MTLS_*` `:69-71`). The AST walk still finds 73 stub calls.
    Exactly two carry `timeout`: `ListOpportunities` (`:871`) and `get_config_value`'s `GetConfig`
    (`_CONFIG_READ_TIMEOUT_S`, `:1756`), which matches the @AC-10 allow-list.
  - Step 3: the call-site table was regenerated from the post-247 AST walk (about +4/+5 lines). The
    `metadata=` baseline is still 73.
  - Step 6: the cited tool-body lines moved. The BacktestResult cite is corrected to `analysis.proto:123`; `:13`
    is the `rpc RunBacktest` line. There are still 40 catch sites, and `list_opportunities` (`:1572-1573`) is the
    only one passing `deadline_s`.
  - Step 7: the catch-site table was regenerated. It is the same 40-site set, so the expected 41/4 grep counts
    stand. Verb literals are at `:1959/:1970/:1982` and `:2100-2135`.
  - Step 8: the test_oauth anchors moved (`:97-102`, `:105-131`). The auth.py, test_auth.py and main.py cites
    still hold.
  - Step 11: both merge-order rows already exist (`:84`, `:85`), so the step now only rewords the 272 row, which
    still carries the old `deadline_s is None → exc.details()` text. The SEV-3 sidecar is still `open`. 272 is
    `implementation-ready`, which closes the "272 lifecycle unverified" open thread from the impl-spec review.
- The Execution Summary still says "pre-247 line numbers". Only step bodies were in re-spec scope, and the step
  bodies are now authoritative.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

- **Mode-entry confirmation (up-front plan)**: given by operator standing authorization. In operator chat
  2026-10-28/29 (session_01NpS3HShZK6pSnogA7CFo2f), the operator said "Start executing features 241-276" via
  batch-execute. The terms of that authorization:
  - checkpoints are unattended, in `report` mode;
  - C-16 promotion is auto-confirmed unless it changes an existing @AC rule;
  - merge-train is authorized;
  - 255 and 275 are deferred;
  - DB and prod steps stay operator-only: open the PR and hold the merge;
  - blocker decisions are recorded per feature as of 2026-10-29.
- Status `implementation-ready` → `in-progress`.
- Severity: SEV-2. Branch: `feature/fix-agent-client-deadlines`. The detached worktree pushes to that ref after
  every commit.
- Preconditions: 247 is merged and the re-spec of Steps 2/3/6/7/8/11 is committed (session above). Step 1, the
  R1/R5 latency baseline, gates Step 3 and runs first.

## Session 2026-10-29 — Deadline latency baseline (Step 1, R1/R5)

- Operator decision (2026-10-29, session question tool): "Query Grafana". Measured with read-only Grafana Cloud
  Tempo queries, datasource uid `grafanacloud-traces`. Window (UTC): 2026-10-28T07:21:00Z → 2026-10-29T07:21:00Z
  (24 h), `deployment.environment=development`, agent client spans (`resource.service.name = "agent"`).
- Queries:
  - Count: `{ resource.service.name = "agent" && resource.deployment.environment = "development" && kind = client } | count_over_time() by (name)` (instant).
  - Quantiles: `{ resource.service.name = "agent" && resource.deployment.environment = "development" && kind = client && name = "<RPC>" } | quantile_over_time(duration, .5, .99, 1)` (instant).
  - Exact max cross-check: TraceQL search `{ ... && name = "<RPC>" && duration > 100ms }`.
  - Zero-span cross-check across every service and span kind: `{ resource.deployment.environment = "development" && name =~ ".*(RunBacktest|RunFundamentalsScan|ScreenSymbols|TriggerBackfill)" } | count_over_time() by (name, resource.service.name)` returned no series.
- `quantile_over_time` reports power-of-two bucket bounds. The p99 and max below are bucket upper bounds
  (2^27 ns = 134.2 ms), and the p50 is interpolated inside its bucket. The exact max comes from the trace search.

| RPC | Count | p50 | p99 | Max | Margin |
|---|---|---|---|---|---|
| `/xstockstrat.analysis.v1.AnalysisService/RunBacktest` | 0 | Not measured — no spans | — | — | vs 45 s: unknown |
| `/xstockstrat.analysis.v1.AnalysisService/RunFundamentalsScan` | 0 | Not measured — no spans | — | — | vs 45 s: unknown |
| `/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols` | 0 | Not measured — no spans | — | — | vs 45 s: unknown |
| `/xstockstrat.ingest.v1.IngestService/TriggerBackfill` | 0 | Not measured — no spans | — | — | vs 45 s: unknown |
| `/xstockstrat.identity.v1.IdentityService/ValidateToken` | 58 | ≈27.4 ms | ≤134.2 ms (bucket bound) | 121.9 ms (exact, trace `a425ce4e739f451231b2c3f78a2ac1b5`) | vs 10 s: ≥9.86 s (p99 < 1.4 % of budget) |

- R5 (ValidateToken): p99 is comfortably below 10 s, so the 10 s budget stands.
- R1 (long RPCs): there are no agent client spans for any of the four long RPCs, and `analysis` emitted no spans
  in this window (it is absent from dev's `resource.service.name` values). The 45 s budget therefore cannot be
  checked against observed latency. The server bounds that would cap it are all above 45 s (R2): 120 s for the
  screener default and for backtest in production, and 300 s for the backtest default.
- Per Step 1 instruction 4, "Not measured" counts as HALT until the operator signs off here. Step 3 must not be
  committed until that sign-off is recorded or a re-measurement with spans present gives PASS.

Baseline verdict: HALT — RunBacktest/RunFundamentalsScan/ScreenSymbols/TriggerBackfill not measured (0 dev spans in 24 h); ValidateToken p99 ≤134 ms passes R5

## Session 2026-10-29 — Step 2 — test: Generic hung-backend fixture and client-level deadline RED tests

- Files: `services/xstockstrat-agent/tests/conftest.py` (fixture `hung_backend`: sync
  `grpc.server(ThreadPoolExecutor(max_workers=8))` with one `GenericRpcHandler` serving any method as raw bytes;
  records `(method, metadata)` under a lock; `answers` → answer `(delay_s, msg)` or abort `(delay_s, StatusCode)`,
  absent → 247's `is_active()` hang loop; redirects `module.<endpoint_attr>` and `client.mtls.secure_channel`;
  `stop.set()` + `server.stop(0).wait()` teardown). 247's `hung_config_server` is untouched.
  `services/xstockstrat-agent/tests/test_client_deadlines.py` (new): @AC-5 live (9 rows; GetConfig row on
  `hung_config_server`), @AC-5 production-kwarg (9 rows), constant pins, @AC-10 AST guard (≥73 calls,
  allow-list `ListOpportunities`→`timeout`, `get_config_value.GetConfig`→`_CONFIG_READ_TIMEOUT_S`, LONG set ==
  the four long RPCs).
- TDD red (pre-Step-3 tree), each for the specified reason:
  - AC-5 live red (9/9): `TimeoutError` from the `HANG_GUARD_S` guard — no deadline on the call.
  - AC-5 kwarg red (9/9): `AssertionError: <RPC> is issued without a deadline`.
  - `test_deadline_constants_are_pinned` red: `AttributeError: module 'app.client' has no attribute '_RPC_TIMEOUT_S'`.
  - AC-10 red: `stub calls without timeout: [...]` listing the 71 untimed calls.
- Green is Step 3's run. A temporary, reverted probe of the Step 3 change gave 20/20 passed, so the harness is sound.
- Verification: ruff check + format clean; full suite 20 failed (the RED file) / 530 passed, coverage 81.78%
  (≥40); `def hung_backend` / `def hung_config_server` / `HANG_GUARD_S` greps and
  `from tests.conftest import HANG_GUARD_S` present.
- Deviations (see Deviation Log): generic mocked-channel shape for the kwarg test; method name bound in
  `service(details)`.
- Still open: `Baseline verdict: HALT` (Step 1) gates Step 3's commit until an operator sign-off is recorded.

## Session 2026-10-29 — Step 3 operator sign-off (R1 baseline HALT override)

- R1 operator sign-off (2026-10-29, session question tool), in the operator's own words: "A: Sign off, expand
  scope". The operator accepts the 45 s LONG deadline budget (`_LONG_RPC_TIMEOUT_S`) for RunBacktest and
  RunFundamentalsScan, and for the other LONG RPCs (ScreenSymbols, TriggerBackfill), without a measured p99. The
  operator knowingly accepts the risk that runs of 45-60 s are cancelled (198 @AC-8). This overrides Step 1's
  `Baseline verdict: HALT` for Step 3's commit gate.
- Scope expansion, same decision: Step 3's **Files** gain `tests/test_config_tools.py`,
  `tests/test_signal_source_reliability_weight.py` and `tests/test_template_tools.py`. Only each capture stub's
  signature widens, to `(req, metadata=None, timeout=None)`. See the Deviation Log.

## Session 2026-10-29 — Step 3 — service: Deadline constants and `timeout=` on every agent → backend unary call

- Files: `services/xstockstrat-agent/app/client.py`: `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0`
  below 247's `_CONFIG_READ_TIMEOUT_S`; `timeout=` added as the last keyword on 71 awaited stub calls, applied
  by an AST walk keyed on RPC name and then `ruff format`. LONG goes on RunBacktest, ScreenSymbols,
  RunFundamentalsScan and TriggerBackfill. `ListOpportunities` and `get_config_value`'s GetConfig are untouched.
  No function parameter, channel option or helper was added. The only other diff lines are ruff's re-wraps of
  the edited calls.
- Tests: the capture stubs in `tests/test_config_tools.py` (×2), `tests/test_signal_source_reliability_weight.py`
  and `tests/test_template_tools.py` are widened to `(req, metadata=None, timeout=None)`. This is the operator
  scope expansion.
- TDD: RED on the pre-Step-3 tree gave `tests/test_client_deadlines.py` 20 failed (92.9 s, hang-guard
  timeouts plus missing-kwarg/constant/AST failures). GREEN gives 20 passed in 2.87 s.
- Verification: grep counts are `timeout=_RPC_TIMEOUT_S` 67, `timeout=_LONG_RPC_TIMEOUT_S` 4 and
  `metadata=_metadata|metadata=meta` 73. ruff check and format are clean. The full suite passed 550, coverage
  81.80% (≥40). Before the stub widening it showed 6 `TypeError` failures in the three files above.
- R1 risk accepted by the operator (session entry above): runs longer than 45 s on the LONG RPCs are now cancelled
  client-side.

## Session 2026-10-29 — Step 4 — test: Mapper `write` branch and 272 pass-through RED tests (P-06)

- Files: `services/xstockstrat-agent/tests/test_tools.py`. Five sync tests were added directly after the two 227
  `_grpc_error_message` tests, which stay unchanged: `write_deadline_says_outcome_unknown`,
  `read_deadline_keeps_retry_text`, `passes_through_server_deadline_detail` (three call shapes),
  `client_sentinel_is_not_passed_through` and `write_without_deadline_s`. They use the existing `_rpc_error`
  helper and keep literals inline (C-13).
- TDD RED: 3 failed. The two `write=` tests fail with `TypeError: _grpc_error_message() got an unexpected keyword
  argument 'write'`. Pass-through fails with `AssertionError: 'upstream did...retry shortly' ==
  'backtest exc...ation_seconds'`. The read-retry and client-sentinel tests already pass because they guard
  behaviour Step 5 must preserve. GREEN is Step 5's run.
- Verification: ruff check and format are clean. The full suite is 3 failed (by design) / 552 passed, coverage
  81.80% (≥40).
- Deviation: the spec's `tests/test_tools.py` line anchors drifted by +2. See the Deviation Log.

## Session 2026-10-29 — Step 5 — service: `_grpc_error_message` `write` flag and server-detail pass-through

- Files: `services/xstockstrat-agent/app/tools.py`. Only the DEADLINE_EXCEEDED branch changed. Non-empty details
  other than grpc's `"Deadline Exceeded"` sentinel are returned as is (272, operator r3 (c), regardless of
  `deadline_s`). Otherwise the message is `head; tail`, where the tail is `outcome unknown, verify before retrying`
  when `write=True`. The `deadline_s=None, write=False` text is byte-identical (227). The other branches are
  untouched, and every existing caller still works because `write` defaults to `False`.
- TDD RED (Step 4 tests before the change): 3 failed / 5 passed (two `TypeError: unexpected keyword argument
  'write'`, one pass-through `AssertionError`). GREEN: `-k grpc_error_message` 8 passed.
  `test_list_opportunities_deadline.py` 7 passed (the 227 "within 0.2s" text is unchanged).
- Verification: ruff check and format are clean. The full suite is 555 passed, coverage 81.84% (≥40).
- Tooling: `uv sync --frozen --extra dev` ran in this worktree. The lockfile is unchanged.

## Session 2026-10-29 — Step 6 — test: Tool-level deadline RED tests and catch-site guards (@AC-1..4, @AC-6..9)

- Files: `services/xstockstrat-agent/tests/test_tool_deadlines.py` (new). It uses `hung_backend` (Step 2),
  247's `hung_config_server`, and `ADMIN`/`_ctx`/`HANG_GUARD_S` from conftest. Budgets are patched to
  0.2/0.6/0.2 s. `_rpc_error` is defined locally (C-13: one consumer). The AST guards key on the innermost
  enclosing function and require at least 40 mapper calls, so they cannot pass vacuously.
- TDD RED: 14 failed / 5 passed. AC-1, AC-2, AC-9, AC-6 and the instantiate_template case fail on
  `'upstream did not respond (deadline exceeded); retry shortly'` (no "within Ns", no "outcome unknown"). AC-3
  and the six-wrap cases raise a raw `AioRpcError`. The `deadline_s` guard lists all 39 non-227 sites, and the
  `write` guard lists 16 mutating sites. Early passes: AC-4, AC-7, FR-3 (as the spec allows), plus AC-8 and the
  127 @AC-4 watchlist guard, which Step 3's client `timeout=` already bounds (Deviation Log). GREEN is Step 7's
  run.
- Verification: ruff check and format are clean. The full suite is 14 failed (by design) / 560 passed, coverage
  82.32% (≥40).
- Tooling: `uv sync --frozen --extra dev` in this worktree; lockfile unchanged. The main worktree has no root
  `node_modules` to symlink and `core.hooksPath` (`.husky/_`) does not exist, so the husky hook does not run
  (same as Steps 1-5); no `--no-verify` was used.

## Session 2026-10-29 — Step 7 — service: Catch-site `deadline_s` / `write`, plus the six new wraps

- Files: `services/xstockstrat-agent/app/tools.py`, and only that file.
  - `deadline_s` is added to all 39 `_grpc_error_message` catch sites, keyed by enclosing function name:
    - LONG: `run_backtest`, `trigger_backfill`, `run_fundamentals_scan`.
    - RPC: the other 36. `list_opportunities` keeps `timeout_s`.
  - `write=True` is added at the 14 table rows. Two sites use a verb-derived expression instead:
    - `manage_watchlist`: `operation != "update"`.
    - `manage_offline_account`: `operation not in ("get_order", "list_orders", "list_positions")`.
  - `not_found=` is unchanged at every site.
- Six new `except grpc.aio.AioRpcError` wraps:
  - `list_signal_sources` and `_get_source`: RPC.
  - `screen_symbols`: LONG.
  - `emit_alert`: RPC, `write=True`.
  - `_write_source_bearer`: only the `client.set_config` call, RPC, `write=True`.
  - `ingest_signal`: only the primary `client.ingest_signal` call, RPC, `write=True`. The three follow-ups stay in
    their own `except Exception` blocks (127 @AC-4), and the docstring SIDE EFFECT text is untouched (127 @AC-5).
- No new helper or middleware catch (C-18).
- TDD RED (pre-Step-7 tree), `tests/test_tool_deadlines.py`: 14 failed / 5 passed. The failures are the Step 6
  set: missing "within Ns" / "outcome unknown" wording, raw `AioRpcError` from the six wraps, and the AST guards
  listing every site. GREEN: the five-file Step 7 verification run passed 175.
- Verification:
  - grep `deadline_s=client._RPC_TIMEOUT_S` = 41, and `deadline_s=client._LONG_RPC_TIMEOUT_S` = 4. Both match the
    spec.
  - ruff check and format are clean.
  - The full suite passed 574, coverage 82.47% (≥40).
- Deviation: line anchors were re-anchored by function name. See the Deviation Log.
