# Context Log: fix-agent-mcp-transport-fallthrough

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md — Agent silently starts stdio transport when MCP_TRANSPORT is unset or mistyped (SEV-3)
- Cluster rationale: single-report feature — one transport-selection function.
- Severity: SEV-3
- Routing: report says "Config-only fix possible: yes" (Track B), **converted to Track C by operator decision 2026-11-10** — an unset or mistyped `MCP_TRANSPORT` must fail closed in code rather than only relying on the deploy-spec env var.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md; stamped the report sidecar `triaged`
- Affected services (from report): xstockstrat-agent
- Root cause hypothesis: `resolve_transport()` defaults to and falls through to stdio; no DO `health_check` for the agent
- Open questions: unset → fail vs default http (reverses feature 079 AC-4, needs operator sign-off); DO `health_check` in/out of scope (product-spec § Open Questions)
- Recommended design depth: quick → `/sdd-design fix-agent-mcp-transport-fallthrough quick` (rationale: SEV-3, single service, no proto/migration/config, clear root cause — but it reverses a deliberate accepted AC (079 AC-4) and carries an open posture choice, so not skip)
- Development branch: feature/fix-agent-mcp-transport-fallthrough

## Session 2026-11-10 (/sdd-review product-spec — operator decisions)

- First review FAILed criteria 8/9 (AC-2 undefined pending OQ1).
- Operator decided: unset MCP_TRANSPORT → Streamable HTTP :9000; explicit `stdio` → stdio; any other value → exit non-zero. Reverses feature 079 AC-4 (C-16 supersede at design). DO health_check out of scope. AC-2 rewritten to a single observable outcome.

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); AC-1 error should name both the value and MCP_TRANSPORT; C-16: /sdd-design must mark feature 079 AC-4 superseded; first review FAILed crit 8+9 (fixed after operator decision)
- Overlap findings: WARN: agent shared with 314/319/322/328
- Recommended design depth: quick (single service, no proto/migration; operator decisions recorded)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-20 — sdd-batch design gate (round 2)

- `/sdd-design fix-agent-mcp-transport-fallthrough` full debate halted at its approval gate after round 2 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-5, R-1..R-7, O-1..O-5).

### Open Threads

- **Approach**: the core fix is unchanged from round 1 (D-1..D-5). In `services/xstockstrat-agent/app/main.py`, unset `MCP_TRANSPORT` defaults to `http`, explicit `stdio` stays stdio, and any other value (including `""`, with no normalization) raises `RuntimeError` inside `resolve_transport()`; `main()` is untouched. Tests go red first in `tests/test_transport_config.py`: an in-process `TestMainDispatch` case is the primary AC-1 proof, and a `python -m app.main` subprocess test is the secondary one. Docs change in the same PR (`docs/runbooks/mcp-tools.md:20`, the agent `CLAUDE.md:4`, the agent findings file). `supervisord.conf`, the DO `health_check`, `claude_mcp_config.json` and `tests/conftest.py` are not touched.
- **Round 2 change**: only the subprocess test's stderr assertion. It must assert `"expected 'http' or 'stdio'"` is present and `"falling back to stdio"` is absent, because today's warning at `app/main.py:64` already prints `MCP_TRANSPORT='htp'` to stderr (`:44`). The red outcome is a 20s timeout or an exit with the old warning, never the new error text.
- **Strongest open objection (O-4, blocking, P-06/C-15)**: the synthesis adopted the adversary's unique-token assertion above, but the proposer has not confirmed it. Until it does, the subprocess test as proposed passes on today's buggy code as far as stderr goes.
- **Other open objections (non-blocking)**: O-2 — AC-1's Given says "the agent container starts" but the proof is process-level and supervisord keeps the container alive; both sides endorse rewording to "the agent process starts", which needs the operator's confirmation before `acceptance.feature` is edited. O-5 — if the subprocess test is dropped as flaky, record it here as a P-03 deviation; the in-process `pytest.raises` through `main()` must exist either way.
- **Closed this round**: O-1 (hang guard and child import of `app.main` confirmed) and O-3 (no file overlap with features 314 and 328).
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes**: none. AC-1 and AC-2 are CHANGE, both covered by the operator decision at line 24 of this file; AC-3 is PRESERVE.
- **Next**: re-run `/sdd-batch` to resume the debate from the state block below, or decide O-2 and O-4 at the gate.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The core fix is unchanged from round 1 (D-1..D-5). Round 2 changes only the subprocess AC-1 test: its stderr assertion must match text that only the fixed code prints.\n\n**1. Code — `services/xstockstrat-agent/app/main.py`**\n- `:54`: default becomes `os.environ.get(\"MCP_TRANSPORT\", \"http\")`.\n- `:55-60`: the `sse` alias branch stays as is.\n- `:61-64`: replace the comment, the warning and the stdio fall-through with `raise RuntimeError(f\"MCP_TRANSPORT={raw!r} is not recognized; expected 'http' or 'stdio'\")`. `:65` `return raw` stays.\n- `:5-6` (module docstring): http is the default; stdio must be set explicitly.\n- `main()` at `:281-286` is untouched. `:286` evaluates `resolve_transport()` before either runner coroutine is built.\n- `MCP_TRANSPORT=\"\"` raises, with no normalization (D-3).\n\n**2. Tests, red first — `services/xstockstrat-agent/tests/test_transport_config.py`**\n- `:34`: drop the `(\"banana\", \"stdio\")` parametrize row.\n- `TestMainDispatch`, reusing the harness at `:37-43`. This is the primary AC-1 proof and must exist whether or not the subprocess test survives:\n  - AC-2: unset (`delenv(..., raising=False)`) gives `recorded == [\"http\"]`.\n  - AC-1: one test parametrized over `[\"htp\", \"\"]`, asserting `pytest.raises(RuntimeError, match=...)` on the new message and `recorded == []`.\n- `TestResolveTransport`: rewrite `:64-69` so unset gives `\"http\"`, and `:71-78` so `\"htp\"` raises, as a single `pytest.raises` case.\n- Assert the full new message text in at most two places: one in-process test and the subprocess test (C-18). Other raise tests assert the exception type only.\n- Subprocess AC-1 test, the secondary proof:\n  - `subprocess.run([sys.executable, \"-m\", \"app.main\"], cwd=SERVICE_DIR, env={**os.environ, \"MCP_TRANSPORT\": \"htp\", \"OTEL_ENABLED\": \"false\", \"PYTHONPATH\": str(SERVICE_DIR)}, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20)`.\n  - `SERVICE_DIR` is derived as at `tests/test_telemetry.py:127`. `PYTHONPATH` follows the precedent at `tests/test_telemetry.py:384-392`; the `-m` entry form is new, not a reuse.\n  - Catch `TimeoutExpired` and call `pytest.fail`.\n  - Assert `returncode != 0`.\n  - Assert `\"expected 'http' or 'stdio'\" in proc.stderr`. This text exists only in the new error.\n  - Assert `\"falling back to stdio\" not in proc.stderr`.\n  - Do not use `\"MCP_TRANSPORT='htp'\"` as the discriminator. Today's warning at `main.py:64` already prints it to stderr through `logging.basicConfig` at `:44`.\n  - Red outcome to record in the spec: a timeout, or an exit with the old fall-back warning, never the new error text. On today's code the expected path is the 20s timeout, because the snapshot wait is 90s (`app/config/watch_core.py:36`, `app/config/watcher.py:97`). Do not shorten the timeout below cold-import time.\n  - If the test proves flaky in CI and is dropped, record that as a P-03 deviation in `context.md`, not a silent removal.\n- AC-3 and the port half of AC-2 are already covered at `:32-47` and `:92-95`.\n\n**3. Docs, same PR**\n- `docs/runbooks/mcp-tools.md:20`: http is the default; local stdio needs `MCP_TRANSPORT=stdio`, which `services/xstockstrat-agent/claude_mcp_config.json:11` already sets.\n- `services/xstockstrat-agent/CLAUDE.md:4`: remove the stdio-default defect mention.\n- `services/xstockstrat-agent/docs/context-constitution-findings.md:30,82`: mark resolved by 331.\n- `design.md` corrects product-spec Open Question 1 (D-4).\n\n**4. Not touched**\n- `supervisord.conf` and the DO `health_check` (D-5).\n- `claude_mcp_config.json`, including `:17`, which belongs to peer 328.\n- `tests/conftest.py`.\n- No grep gate (R-5).\n\n**5. Verify**\n- `uv run pytest --cov=app --cov-fail-under=40` in the agent service.\n- `ruff` run locally on the touched files, because the agent is absent from the CI lint matrix (`fails.md:432`).\n- Dev smoke test: the agent listens on :9000 with `MCP_TRANSPORT=http`.\n- Spec note: if a peer changes the conftest `MCP_TRANSPORT`, `CONFIG_ENDPOINT` or `MTLS_*` defaults (`tests/conftest.py:126,128,132-134`), re-run this suite.",
    "open_objections": [
      {
        "text": "[P-06/C-15] The subprocess test's stderr assertion `\"MCP_TRANSPORT='htp'\" in proc.stderr` also matches today's buggy code: the warning at `app/main.py:64` renders that same token to stderr via `logging.basicConfig` at `:44`. Red then rests only on the stdio path not exiting non-zero within 20s. The synthesis adopts the adversary's fix: assert `\"expected 'http' or 'stdio'\"` is present and `\"falling back to stdio\"` is absent, and restate the red outcome. The proposer has not yet confirmed it.",
        "blocking": true
      },
      {
        "text": "[P-03/C-15] (O-2) AC-1's Given says \"the agent container starts\", but the proof is process-level and supervisord keeps the container alive (`supervisord.conf:6-8`, `Dockerfile:22`). Proposer and adversary both endorse rewording the Given to \"the agent process starts\". The operator has to confirm before `acceptance.feature` is edited.",
        "blocking": false
      },
      {
        "text": "[C-15] If the subprocess test is dropped as flaky, AC-1's \"process exits non-zero\" has no direct proof. That must be recorded as a P-03 deviation in `context.md`. The approach includes this, but the proposer has not confirmed it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "`log.error` + `sys.exit(2)` / `SystemExit` (R-1): departs from the `app/mtls.py:25-26` raise convention.",
      "Validation in `main()` (R-2): splits the recognized-set knowledge across two functions.",
      "Empty `MCP_TRANSPORT` treated as unset (R-3): a silent start on a blanked variable is the defect class being fixed.",
      "`startsecs`/`startretries` in `supervisord.conf` (R-4): marginal without the out-of-scope health check.",
      "A grep gate for stale doc strings (R-5): `fails.md:138-157` records grep gates as a recurring failure.",
      "Drop the subprocess test and rely on in-process `pytest.raises` alone: deterministic, but observes no real exit code and would miss a future `try/except` in `main()`. Kept only as a recorded-deviation fallback.",
      "Subprocess stderr match on `MCP_TRANSPORT='htp'`: today's warning at `main.py:64` prints the same token, so it cannot tell buggy code from fixed code.",
      "Child entry via `-c \"import app.main as m; m.main()\"` with a traceback check: as discriminating as the unique-token assertion, but adds a second entry form and skips the real `__main__` path.",
      "Three near-identical dispatch tests for `htp`, `\"\"` and unset: clones the harness (C-08); use parametrize.",
      "Fixing `MCP_AGENT_SECRET` at `claude_mcp_config.json:17` here: owned by peer `fix-agent-bearer-secret-orphan`."
    ],
    "open_risks": [
      "A mistyped value leaves the container alive under supervisord with nothing on :9000. On DO there is no `health_check`, so the failure shows only in logs.",
      "If importing `app.main` takes longer than supervisord's default `startsecs=1`, supervisord restarts forever and prints a traceback each time.",
      "The red run of the subprocess test costs the full 20s timeout, because the 90s snapshot wait (`app/config/watch_core.py:36`) outlasts it. Red-path timing depends on the conftest `CONFIG_ENDPOINT` and `MTLS_*` dummies (`tests/conftest.py:128,132-134`).",
      "If a peer adds a top-level `gen` import to a module on the `app.main` import chain, the child dies with `ModuleNotFoundError` before `resolve_transport()` runs. The test then fails with a confusing message; it does not pass falsely.",
      "A 20s timeout may be tight for a cold import on a slow CI runner, which would make the green run flaky.",
      "A bare local `python -m app.main` with no env now takes the http path and fails on missing mTLS material (`app/mtls.py:25`). Only the runbook edit mitigates this.",
      "`HTTP`, `http ` and `\"\"` now fail closed. Any undiscovered deploy that blanks or mis-cases the variable will crash-loop."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "P-06",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-07"
    ],
    "rationale": "The proposal respects D-1..D-5 and R-1..R-5, and there are no Floor breaches. Approval is still blocked by one new objection: the subprocess test's stderr assertion matches today's code as well as the fixed code.\n\n- **The adversary's blocking point is correct.** `app/main.py:64` logs `MCP_TRANSPORT=%r is not recognized; falling back to stdio`, and `logging.basicConfig` at `:44` writes to stderr. So `\"MCP_TRANSPORT='htp'\"` already appears on today's code, and the proposer's claim that the red run never shows the expected stderr is false. The approach now uses the adversary's unique-token assertion, but the proposer has not answered it, so it stays open and blocking.\n- **O-1 closed, replaced by the new objection.** O-1 asked for the hang guard and for confirmation that the child can import `app.main`. The proposal supplies both. A grep confirms the only top-level `gen` import in `app/` is `app/auth.py:13`, which `main.py` does not import at module level. The adversary wanted O-1 kept open; the remaining defect is carried by the new blocking objection instead, so nothing is unblocked by the closure.\n- **O-3 closed.** The proposer found no overlap with features 314 and 328 on the touched files, and the adversary accepts that. The spec re-run note now also names `CONFIG_ENDPOINT`.\n- **O-2 stays open, non-blocking.** Both sides endorse the process reading, but rewording AC-1's Given is the operator's call.\n- **Adversary's non-blocking points folded into the approach:** `PYTHONPATH` in the child env, the message text asserted in at most two places, the 20s red path recorded, and a dropped subprocess test recorded as a P-03 deviation.\n- **Operator coverage for AC-1 and AC-2** rests on the decision at `context.md:24`, unchanged from round 1. No operator steer reopens anything.",
    "register_delta": {
      "new_decisions": [],
      "new_rejected": [
        {
          "text": "Subprocess AC-1 stderr assertion on the token `MCP_TRANSPORT='htp'`",
          "why": "Today's warning at `app/main.py:64` prints the same token to stderr (`:44`), so it does not tell buggy code from fixed code."
        },
        {
          "text": "Child entry via `-c \"import app.main as m; m.main()\"` with a traceback check",
          "why": "No more discriminating than the unique-token assertion, and it skips the real `-m app.main` `__main__` path."
        }
      ],
      "new_objections": [
        {
          "text": "[P-06/C-15] The subprocess AC-1 test must assert `\"expected 'http' or 'stdio'\"` in stderr and `\"falling back to stdio\"` not in stderr, since `MCP_TRANSPORT='htp'` already appears on today's code (`app/main.py:44,64`). The red outcome is restated as a timeout or an exit with the old warning, never the new error text. The proposer must confirm.",
          "blocking": true
        },
        {
          "text": "[C-15] If the subprocess test is dropped as flaky, record a P-03 deviation in `context.md`. The in-process `pytest.raises` through `main()` is the primary AC-1 proof and must exist either way.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "The proposer confirmed the hang guard (`stdin=DEVNULL`, `capture_output`, 20s timeout, `TimeoutExpired` to `pytest.fail`, `OTEL_ENABLED=false`) and that the child imports `app.main` without the conftest `gen` setup: the only top-level `gen` import in `app/` is `app/auth.py:13`, which loads lazily. The remaining stderr-discriminator defect is carried by a new blocking objection."
        },
        {
          "id": "O-3",
          "how": "No file overlap with features 314 and 328: their shared file is `app/tools.py`, which this feature does not touch. The spec carries a re-run note naming the conftest `MCP_TRANSPORT`, `CONFIG_ENDPOINT` and `MTLS_*` defaults (`tests/conftest.py:126,128,132-134`). The adversary agrees."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-agent; key reuse patterns: the fail-closed raise shape at `app/mtls.py:25-26`, the `TestMainDispatch` harness at `tests/test_transport_config.py:29-47`).
- Phase 1 Grilling: 2 rounds (full). Chosen approach: `resolve_transport()` defaults an unset `MCP_TRANSPORT` to `http` and raises `RuntimeError` for any value other than `http`, `stdio` or the `sse` alias (including `""`, no normalization); `main()` is untouched; tests go red first, in-process dispatch test primary and a `python -m app.main` subprocess test secondary; docs change in the same PR. Rejected: R-1..R-7 (`SystemExit`, validation in `main()`, empty-as-unset, supervisord tuning, a grep gate, the `MCP_TRANSPORT='htp'` stderr discriminator, the `-c` child entry).
- Constitution rules touched: P-02, P-03, P-06, C-08, C-11, C-15, C-16, C-18, F-04, F-07. Floor breaches: none.
- Status: spec-ready → design-approved. Wrote design.md; debate.md State → approved.

### Operator decisions (2026-11-20, recorded at the approval gate)

- Not a duplicate of demoted feature 018 `agent-mcp-oauth`.
- Design approved with the round-2 synthesis fix binding: the subprocess test's RED must not rest on a stderr token today's code also prints; it asserts the non-zero exit and an error text that only the fixed code emits (`"expected 'http' or 'stdio'"` present, `"falling back to stdio"` absent). O-4 is closed on this ruling.
- C-16: the AC-1 and AC-2 CHANGE lines and the feature-079 AC-4 reversal rest on the operator decision at line 24 of this file (Session 2026-11-10). The 079 reversal is sign-off-only: no promoted scenario exists, so there is no suite edit (D-4). This corrects product-spec Open Question 1.
- No reopen petitions were raised, so none were declined.

### Open Threads

- [ ] O-2 (open, non-blocking): AC-1's Given says "the agent container starts", but the proof is process-level and supervisord keeps the container alive. Rewording to "the agent process starts" needs the operator's confirmation; `acceptance.feature` is unchanged. Target: before the test (red) step.
- [ ] O-5 (open, non-blocking): if the subprocess test is dropped as flaky, record a P-03 deviation here; the in-process `pytest.raises` through `main()` must exist either way. Target: test and code steps, CI.
- [ ] Risk: a mistyped value leaves the container alive under supervisord with nothing on :9000; on DO there is no `health_check`, so the failure shows only in logs. Accepted (D-5). Target: docs step note; `health_check` follow-up is out of scope.
- [ ] Risk: if importing `app.main` takes longer than supervisord's default `startsecs=1`, supervisord restarts forever with a traceback each time. Target: dev smoke-test step.
- [ ] Risk: the red run of the subprocess test costs the full 20s timeout (the 90s snapshot wait at `app/config/watch_core.py:36` outlasts it); red-path timing depends on the conftest `CONFIG_ENDPOINT` and `MTLS_*` dummies (`tests/conftest.py:128,132-134`). Target: test (red) step, recorded in the spec.
- [ ] Risk: a peer adding a top-level `gen` import on the `app.main` import chain makes the child die with `ModuleNotFoundError` before `resolve_transport()` runs; the test fails confusingly, it does not pass falsely. Target: test step and the integration PR.
- [ ] Risk: the 20s timeout may be tight for a cold import on a slow CI runner (flaky green). Target: code (green) step and CI.
- [ ] Risk: a bare local `python -m app.main` with no env now takes the http path and fails on missing mTLS material (`app/mtls.py:25`); only the runbook edit mitigates it. Target: docs step.
- [ ] Risk: `HTTP`, `http ` and `""` now fail closed; an undiscovered deploy that blanks or mis-cases the variable will crash-loop. Target: dev smoke-test step.
- Spec note: if a peer changes the conftest `MCP_TRANSPORT`, `CONFIG_ENDPOINT` or `MTLS_*` defaults (`tests/conftest.py:126,128,132-134`), re-run this suite. `/sdd-spec` must cite the re-grepped lines (recon § Risks, product-spec line drift).
- Next: `/sdd-spec fix-agent-mcp-transport-fallthrough`.
