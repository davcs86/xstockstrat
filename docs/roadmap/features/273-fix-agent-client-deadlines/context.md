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
