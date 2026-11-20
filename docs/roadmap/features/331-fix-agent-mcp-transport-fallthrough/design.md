# Design: fix-agent-mcp-transport-fallthrough

**Created**: 2026-11-20
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-11-20
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Transport selection fails closed inside `resolve_transport()` (D-1..D-5). Unset `MCP_TRANSPORT`
resolves to `http`, an explicit `stdio` resolves to stdio, and any other value raises. One small PR in
`xstockstrat-agent`: tests red first, then the code, then the docs that state the old behavior.

**Consumer surface (C-14)**: none — internal/platform-only. MCP clients see either a started agent on
:9000 or a failed start; no tool or response shape changes (product-spec § Consumer Surface(s)).

### 1. Code — `services/xstockstrat-agent/app/main.py`

- `:54` — the default becomes `os.environ.get("MCP_TRANSPORT", "http")` (recon.md:26, the stdio
  default today; D-2).
- `:55-60` — the `sse` alias branch stays as is (recon.md:27).
- `:61-64` — replace the comment, the warning and the stdio fall-through (recon.md:28-29) with
  `raise RuntimeError(f"MCP_TRANSPORT={raw!r} is not recognized; expected 'http' or 'stdio'")`.
  `:65` `return raw` stays. The raise follows the fail-closed shape at `app/mtls.py:25-26`
  (recon.md:38, recon.md:52) and names both the variable and the value.
- `:5-6` — module docstring: http is the default; stdio must be set explicitly (recon.md:33).
- `main()` at `:281-286` is untouched. `:286` evaluates `resolve_transport()` before either runner
  coroutine is built, so the raise stops the process before a transport starts (recon.md:21-23).
- `MCP_TRANSPORT=""` raises. There is no normalization: no case folding, no stripping (D-3;
  the fork is recorded at recon.md:84).

### 2. Tests, red first — `services/xstockstrat-agent/tests/test_transport_config.py`

- `:34` — drop the `("banana", "stdio")` parametrize row (recon.md:41).
- `TestMainDispatch`, reusing the harness at `:37-43` (recon.md:53). This is the **primary** AC-1
  proof and must exist whether or not the subprocess test survives:
  - AC-2: unset (`delenv(..., raising=False)`, recon.md:54) gives `recorded == ["http"]`.
  - AC-1: one test parametrized over `["htp", ""]`, asserting `pytest.raises(RuntimeError, match=...)`
    on the new message and `recorded == []`. One parametrized test, not one test per value (C-18, DRY).
- `TestResolveTransport`: rewrite `:64-69` so unset gives `"http"` (recon.md:42), and `:71-78` so
  `"htp"` raises, as a single `pytest.raises` case (recon.md:43).
- The full new message text is asserted in at most two places: one in-process test and the subprocess
  test (C-18). Other raise tests assert the exception type only.
- Subprocess AC-1 test, the **secondary** proof (it observes a real exit code and the real
  `-m app.main` entry path):
  - `subprocess.run([sys.executable, "-m", "app.main"], cwd=SERVICE_DIR, env={**os.environ,
    "MCP_TRANSPORT": "htp", "OTEL_ENABLED": "false", "PYTHONPATH": str(SERVICE_DIR)},
    stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20)`.
  - `SERVICE_DIR` is derived as at `tests/test_telemetry.py:127`. `PYTHONPATH` follows the precedent at
    `tests/test_telemetry.py:384-392`; the `-m` entry form is new, not a reuse.
  - Catch `TimeoutExpired` and call `pytest.fail`.
  - Assert `returncode != 0`.
  - Assert `"expected 'http' or 'stdio'" in proc.stderr`. This text exists only in the new error.
  - Assert `"falling back to stdio" not in proc.stderr`.
  - **Binding (operator ruling, 2026-11-20; O-4):** the RED must not rest on a stderr token today's
    code also prints. `"MCP_TRANSPORT='htp'"` is not a discriminator: today's warning at `main.py:64`
    already prints it to stderr through `logging.basicConfig` at `:44` (R-6).
  - Red outcome to record in the spec: a timeout, or an exit with the old fall-back warning, never the
    new error text. On today's code the expected path is the 20s timeout, because the snapshot wait is
    90s (`app/config/watch_core.py:36`, `app/config/watcher.py:97`). Do not shorten the timeout below
    cold-import time.
  - If the test proves flaky in CI and is dropped, record that as a P-03 deviation in `context.md`,
    not a silent removal (O-5).
- AC-3 and the port half of AC-2 are already covered at `:32-47` and `:92-95` (recon.md:41,
  recon.md:44, recon.md:86).

### 3. Docs, same PR

- `docs/runbooks/mcp-tools.md:20` — http is the default; local stdio needs `MCP_TRANSPORT=stdio`,
  which `services/xstockstrat-agent/claude_mcp_config.json:11` already sets (recon.md:47,
  recon.md:74).
- `services/xstockstrat-agent/CLAUDE.md:4` — remove the stdio-default defect mention (recon.md:75).
- `services/xstockstrat-agent/docs/context-constitution-findings.md:30,82` — mark resolved by 331
  (recon.md:76).
- **Correction to product-spec Open Question 1 (D-4):** it says `/sdd-design` "must mark that promoted
  scenario superseded". No promoted feature-079 scenario exists in any durable suite (recon.md:63), so
  there is nothing to supersede and no suite edit. The reversal is a sign-off-only C-16 CHANGE.

### 4. Not touched

- `supervisord.conf` and the DO `health_check` (D-5; recon.md:39, recon.md:48).
- `claude_mcp_config.json`, including `:17`, which belongs to peer 328
  (`fix-agent-bearer-secret-orphan`).
- `tests/conftest.py` (recon.md:46).
- No grep gate (R-5).
- `acceptance.feature` — AC-1's Given still reads "the agent container starts"; the rewording to
  "the agent process starts" (O-2) is not confirmed by the operator and is not made here.

### 5. Verify

- `uv run pytest --cov=app --cov-fail-under=40` in the agent service (recon.md:101).
- `ruff` run locally on the touched files, because the agent is absent from the CI lint matrix
  (`fails.md:432`; recon.md:93).
- Dev smoke test: the agent listens on :9000 with `MCP_TRANSPORT=http` (recon.md:103).
- Spec note: if a peer changes the conftest `MCP_TRANSPORT`, `CONFIG_ENDPOINT` or `MTLS_*` defaults
  (`tests/conftest.py:126,128,132-134`), re-run this suite.

## Rejected Alternatives

- `R-1` `SystemExit` / `log.error` + `sys.exit(2)` as the exit mechanism — rejected because it departs
  from the `app/mtls.py:25-26` raise convention and complicates tests; the gain is only cleaner logs.
- `R-2` Validation in `main()` instead of `resolve_transport()` — rejected because it splits the
  recognized-set knowledge across two functions with no benefit.
- `R-3` Empty `MCP_TRANSPORT` treated as unset (falls to http) — rejected because a silent start on a
  blanked variable is the defect class being fixed.
- `R-4` Explicit `startsecs`/`startretries` in `supervisord.conf` — rejected because it is marginal
  without the out-of-scope health check and widens the diff.
- `R-5` A grep-based gate for stale doc strings — rejected because `fails.md:138-157` records grep
  gates as a recurring failure.
- `R-6` Subprocess AC-1 stderr assertion on the token `MCP_TRANSPORT='htp'` — rejected because today's
  warning at `app/main.py:64` prints the same token to stderr (`:44`), so it does not tell buggy code
  from fixed code.
- `R-7` Child entry via `-c "import app.main as m; m.main()"` with a traceback check — rejected because
  it is no more discriminating than the unique-token assertion and skips the real `-m app.main`
  `__main__` path.

## Open Risks

- [ ] A mistyped value leaves the container alive under supervisord with nothing on :9000; on DO there
  is no `health_check`, so the failure shows only in logs (recon.md:83) — accepted (D-5); to be
  addressed by the out-of-scope `health_check` follow-up, and noted in the docs step.
- [ ] If importing `app.main` takes longer than supervisord's default `startsecs=1`, supervisord
  restarts forever and prints a traceback each time — to be observed at the dev smoke-test step.
- [ ] The red run of the subprocess test costs the full 20s timeout, because the 90s snapshot wait
  (`app/config/watch_core.py:36`) outlasts it; red-path timing depends on the conftest
  `CONFIG_ENDPOINT` and `MTLS_*` dummies (`tests/conftest.py:128,132-134`) — to be recorded at the
  test (red) step.
- [ ] If a peer adds a top-level `gen` import to a module on the `app.main` import chain, the child
  dies with `ModuleNotFoundError` before `resolve_transport()` runs; the test then fails with a
  confusing message, it does not pass falsely — to be re-checked at the test step and at the
  integration PR.
- [ ] A 20s timeout may be tight for a cold import on a slow CI runner, which would make the green run
  flaky — to be watched at the code (green) step and in CI; a drop is a recorded P-03 deviation (O-5).
- [ ] A bare local `python -m app.main` with no env now takes the http path and fails on missing mTLS
  material (`app/mtls.py:25`; recon.md:85); only the runbook edit mitigates this — to be addressed at
  the docs step.
- [ ] `HTTP`, `http ` and `""` now fail closed; any undiscovered deploy that blanks or mis-cases the
  variable will crash-loop — to be checked at the dev smoke-test step.
- [ ] O-2 (non-blocking, open): AC-1's Given says "the agent container starts" but the proof is
  process-level and supervisord keeps the container alive (recon.md:83). Rewording the Given to "the
  agent process starts" needs the operator's confirmation — to be decided before the test (red) step;
  until then `acceptance.feature` is unchanged and AC-1 is read at process level.

## Constitution Rules Touched

- `P-02` — honored by: the debate was mediated; proposer and adversary saw only the synthesized state.
- `P-03` — honored by: O-2's ambiguity is surfaced to the operator, not guessed; a dropped subprocess
  test is recorded as a deviation in `context.md`.
- `P-06` — honored by: tests go red first, and the subprocess RED rests on text only the fixed code
  emits (operator ruling, O-4).
- `C-08` — honored by: the `main.py` change is paired with tests in `tests/test_transport_config.py`
  that cover AC-1..AC-3, verified against the agent's 40% coverage threshold.
- `C-11` — honored by: recon, a two-round full debate and this design precede any code.
- `C-15` — honored by: AC-1..AC-3 each have a test that fails on today's code and passes after the fix
  (AC-1 in-process primary, subprocess secondary).
- `C-16` — honored by: see Business Rules Touched; both CHANGE lines carry the operator sign-off.
- `C-18` — honored by: the least mechanism (one default, one raise; no new helper, constant or config
  key); the AC-1 dispatch cases are one parametrized test on the existing harness; the full error
  message text is asserted in at most two places.
- `F-04` — honored: every path and line cited comes from recon.md or the debate's re-greps; nothing is
  invented.
- `F-07` — honored: no config value is hardcoded. `MCP_TRANSPORT` is a boot env var read with
  `os.environ.get`, never a `WatchConfig` key (recon.md:31), and no config key is added.

## Business Rules Touched (C-16)

- CHANGE feature 079 AC-4 "unrecognized or unset `MCP_TRANSPORT` falls back to stdio with a warning"
  (no promoted scenario exists; recon.md:63) — reversed. Sign-off-only, no suite edit (D-4); signed off
  by user @ 2026-11-10 (`context.md:24`, Session 2026-11-10 /sdd-review operator decisions).
- CHANGE `@AC-1` "an unrecognized MCP_TRANSPORT fails the agent at startup" (this feature's
  `acceptance.feature`) — altered guarantee: fail closed instead of the stdio fall-through; signed off
  by user @ 2026-11-10 (`context.md:24`).
- CHANGE `@AC-2` "an unset MCP_TRANSPORT starts the Streamable HTTP transport" (this feature's
  `acceptance.feature`) — altered guarantee: unset now selects http, not stdio; signed off by user @
  2026-11-10 (`context.md:24`).
- PRESERVE `@AC-3` "an explicit recognized MCP_TRANSPORT still selects its transport" (this feature's
  `acceptance.feature`) — not regressed by: the `http`, `stdio` and `sse` branches are unchanged.
- PRESERVE `@AC-1 @FR-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool"
  (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`) — not regressed by: unset
  and explicit `http` still serve Streamable HTTP on :9000 (recon.md:60).
- PRESERVE `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification
  cannot be disabled" (`docs/sdd/business-rules/platform.feature`) — not regressed by: unset resolves
  to http, which boots the catalog gRPC server and so still requires `MTLS_*` (recon.md:61).
- PRESERVE `@AC-2 @FR-3 @regression @feature-171` "Telemetry init remains non-blocking after the
  trading_mode attribute is removed" (`docs/sdd/business-rules/platform.feature`) — not regressed by:
  the non-zero exit comes only from transport resolution; `init_telemetry()` at `main.py:285` stays
  non-fatal (recon.md:62).
