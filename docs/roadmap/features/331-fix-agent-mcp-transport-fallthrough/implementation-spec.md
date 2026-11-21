# Implementation Spec: fix-agent-mcp-transport-fallthrough

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/331-fix-agent-mcp-transport-fallthrough/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-agent-mcp-transport-fallthrough`

---

## Execution Summary

One small change in `xstockstrat-agent`, following design.md § Chosen Approach (D-1..D-5). Steps 1
and 2 are one atomic unit: the regression tests go red first (Step 1), then `resolve_transport()`
fails closed (Step 2), and the two commit together because neither passes its own Verification
alone. Step 3 updates the three documents that still state the old stdio default. There is no proto,
migration, config-key, env-var or deploy-spec change.

**Consumer surface (C-14)**: none — internal/platform-only (product-spec § Consumer Surface(s)). No
MCP tool, argument or response shape changes; this is a decision, not an omission.

**Tree**: `feature/fix-agent-mcp-transport-fallthrough@c2321849`, which contains
`origin/main-dev@fb52065c`. Every `path:line` below was re-grepped on this tree on 2026-11-20.

**Baseline measured on this tree (2026-11-20)**: `uv run pytest -q --cov=app --cov-fail-under=40` in
`services/xstockstrat-agent` → 825 passed, 88.47% coverage, about 116s.
`uv run pytest tests/test_transport_config.py -q` → 15 passed. `ruff check .` and
`ruff format --check .` are both clean (79 files).

## Scenario Coverage (C-15)

| Scenario | Covered by | Proof |
|---|---|---|
| `@AC-1` unrecognized value fails at startup | Step 1 | Primary: in-process `main()` dispatch test (`RuntimeError` naming the value, no runner recorded). Secondary: `python -m app.main` subprocess test (non-zero exit, text only the fixed code emits). |
| `@AC-2` unset starts Streamable HTTP | Step 1 | In-process `main()` dispatch test (unset → http runner, stdio not started). The "port 9000" half is already pinned at `tests/test_transport_config.py:92-95`. |
| `@AC-3` explicit `http` / `stdio` still select their transport | Step 1 | The `("http", "http")` and `("stdio", "stdio")` rows kept at `tests/test_transport_config.py:34` (PRESERVE — green before and after). |

AC-1 is read at process level (design.md § Open Risks, O-2): the Given says "the agent container
starts", but supervisord keeps the container alive. `acceptance.feature` is unchanged by this spec.

C-16 — feature 079 AC-4 supersession: product-spec.md:52-53 asks `/sdd-design` to mark the promoted
feature-079 scenario superseded. design.md:78-79 and :170-171 (D-4) settle it as sign-off-only: no
promoted 079 scenario exists (recon.md:63; re-grepped 2026-11-20 — `docs/sdd/business-rules/` holds
only `platform.feature`, with no `MCP_TRANSPORT` or `079` match), so **no step edits a durable
business-rules suite**. The operator sign-off is `context.md` Session 2026-11-10. The surviving pins
of the old rule are removed by Step 2 (`app/main.py:62-63` comment) and Step 1
(`tests/test_transport_config.py:74-75` comment).

## Step Dependencies

- Steps 1+2 land together: Step 2 changes the return behavior of `resolve_transport()` and three
  existing tests pin the old behavior (`tests/test_transport_config.py:34`, `:64-69`, `:71-78`), so
  Step 2 alone turns the suite red; Step 1 alone is red by design until Step 2 exists
  (`step-constraints.md` §C, behavior change with test call-site edits — fold the `test` step in).
  One commit, one red→green cycle, both on the agent surface.
- Step 1 [test] covers Step 2 [service] (C-08, P-06). The test step is numbered first because the
  design orders tests red first.
- Step 3 requires Steps 1+2: the documents must describe the behavior the code then has.
- O-2 (open, non-blocking): rewording AC-1's Given to "the agent process starts" needs the
  operator's confirmation. It does not gate Step 1; until confirmed, `acceptance.feature` stays as
  is and no step edits it.
- O-5 (open, non-blocking): if the subprocess test in Step 1 proves flaky and is dropped, record a
  P-03 deviation in `context.md` and the `## Deviation Log`. The in-process `main()` test must exist
  either way.
- Dev smoke test is post-merge, not an execute step: after the integration PR merges to `main-dev`
  and the DO dev app redeploys, confirm the agent serves :9000 with the unchanged
  `MCP_TRANSPORT=http` (`.do/app.dev.yaml:386`, `docker-compose.yml:573`). It needs the deployed
  stack (config service, identity, mTLS material), which `/sdd-execute` must not bring up. Open
  risks to observe there (design.md § Open Risks): a supervisord restart loop if the import outlasts
  `startsecs` (measured cold import of `app.main`: under 1s), and any deploy that blanks or
  mis-cases the variable now crash-loops.
- Peer re-run note: if a peer feature changes the conftest `MCP_TRANSPORT`, `CONFIG_ENDPOINT` or
  `MTLS_*` defaults (`services/xstockstrat-agent/tests/conftest.py:126,128,132-134`), or adds a
  top-level `gen` import to a module `app/main.py` imports at module level (today only
  `app/auth.py:13` has one, and `main.py` does not import it at module level), re-run Step 1's
  Verification at the integration PR.
- Peer overlap (impl-spec review 2026-11-20, WARN, rebase-only — no merge-order entry): re-anchor
  every `path:line` in the step being executed if a peer lands on `main-dev` first.
  - `360-fix-mcp-tools-page` (code-completed, not on `main-dev@fb52065c`). Measured on
    `origin/feature/fix-mcp-tools-page@34ee88a6`: `app/main.py` gains a third docstring line directly
    under the `http` entry (`:7`), next to Step 2's `:5-6` edit, so expect a textual conflict there —
    keep 360's `GRPC_PORT` line and apply Step 2's default wording. `resolve_transport()` is still
    `:52-65` and `main()` `:281-286` on that tip. `tests/test_transport_config.py` gains
    `class TestResolveGrpcPort` (3 tests, appended at `:105`); Step 1's anchors `:34`, `:64`, `:71`,
    `:92` are unchanged there, but the file counts become 18 before / 21 after and the suite totals
    in the Verification blocks rise accordingly — re-measure the baseline rather than trusting 825/828.
    Its `tests/conftest.py` change leaves the `MCP_TRANSPORT`/`CONFIG_ENDPOINT`/`MTLS_*` defaults at
    `:126,128,132-134`. It also edits `docs/runbooks/mcp-tools.md` (hunk at `:42`, not the Transport
    Modes table), the agent `CLAUDE.md` (`:14`, `:129`) and the agent findings file (`:45`) — none is
    a Step 3 line.
  - `345-authelia-sso` (implementation-ready): its spec modifies `app/main.py`
    (`docs/roadmap/features/345-authelia-sso/implementation-spec.md:1074`) and `tests/conftest.py`
    (`:849`, `:941`, `:1151`). Not yet executed, so nothing to measure; the conftest re-run trigger
    above applies.
  - Step 3 documents are also edited by in-flight specs 308, 309, 310, 314 and 319 (doc sections
    only, no shared line found; the Transport Modes table `mcp-tools.md:18-21` is cited by no other
    spec). In the findings file, rows are appended by peers, so locate the `:30` and `:82` rows by
    their text, not by number.
- Not in scope (design.md § 4): `supervisord.conf`, a DO `health_check`, `claude_mcp_config.json`,
  `tests/conftest.py`, `acceptance.feature`, any grep gate (R-5).

---

### Step 1 — test: transport regression tests (red first)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_transport_config.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- `tests/test_transport_config.py:29-47` — `class TestMainDispatch`, one parametrized test. The
  harness is `:38-43`: `monkeypatch.setattr("app.telemetry.init_telemetry", lambda: None)`,
  `_run_http` / `_run_stdio` replaced by lambdas returning `"http"` / `"stdio"`, and
  `monkeypatch.setattr(main_mod.asyncio, "run", recorded.append)`.
- `:34` — parametrize rows `[("sse", "http"), ("http", "http"), ("stdio", "stdio"), ("banana", "stdio")]`;
  the last row pins the bug.
- `:64-69` — `test_unset_defaults_to_stdio` (uses `monkeypatch.delenv("MCP_TRANSPORT", raising=False)` at `:66`).
- `:71-78` — `test_unrecognized_value_falls_through_to_stdio_but_warns`, with the stale "Behavior is
  unchanged (AC-4)" comment at `:74-75`.
- `:92-95` — `test_neither_set_defaults_to_9000` (the port half of AC-2; unchanged).
- `:22-26` — imports today: `logging`, `pytest`, `import app.main as main_mod`. Attributes are read
  inside test bodies on purpose (`:12-15`).
- `tests/conftest.py:126` — autouse `monkeypatch.setenv("MCP_TRANSPORT", "stdio")`; `:128`
  `CONFIG_ENDPOINT`; `:132-134` `MTLS_*` dummies. Unset cases must `delenv` (`test_transport_config.py:17-19`).
- `tests/test_telemetry.py:127` — `SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent`;
  `:392` — `"PYTHONPATH": str(SERVICE_DIR)` in a child env; `:394-396` — `subprocess.Popen([sys.executable, "-c", CHILD], cwd=SERVICE_DIR, …)`.
  The `-m app.main` entry form is new, not a reuse (design.md § 2).
- `app/main.py:286` — `asyncio.run(_run_http() if resolve_transport() == "http" else _run_stdio())`;
  `:289-290` — `if __name__ == "__main__": main()`.
- `app/main.py:44` — `logging.basicConfig(...)` writes to stderr; `:64` — today's warning
  `"MCP_TRANSPORT=%r is not recognized; falling back to stdio"`.
- Measured on this tree, today's code, child env as the test builds it (conftest values plus
  `MCP_TRANSPORT=htp`, `OTEL_ENABLED=false`, `PYTHONPATH=<service dir>`): `python -m app.main` exits
  **1 in about 1s**. stderr holds `WARNING __main__ MCP_TRANSPORT='htp' is not recognized; falling
  back to stdio`, then `xstockstrat-agent starting (transport=stdio)`, then
  `ModuleNotFoundError: No module named 'gen'` raised from `app/config/watcher.py:26` (the child has
  no conftest `gen` path, `tests/conftest.py:98-116`). So **the non-zero exit is already true on
  today's code** and is not the discriminator.
- Ledger: `docs/roadmap/ledger/fails.md:4236-4239` (this feature, R-6) — the RED must match text only
  the fixed code emits and assert the old message is absent. `docs/roadmap/ledger/insights.md:353-361`
  — assert dispatch through `main()`, not only the return value.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:

Edit only `services/xstockstrat-agent/tests/test_transport_config.py`.

1. Imports (`:22-26`): add `os`, `pathlib`, `re`, `subprocess` and `sys` to the stdlib block. Below
   the imports add `SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent` (same derivation
   as `tests/test_telemetry.py:127`). Keep `import app.main as main_mod`.
2. `TestMainDispatch` (`:29-47`): move the harness lines `:38-43` into one class-local fixture so
   the three dispatch tests share it instead of cloning it (C-18; the debate rejected near-identical
   dispatch tests):

   ```python
   @pytest.fixture
   def recorded(self, monkeypatch) -> list[str]:
       monkeypatch.setattr("app.telemetry.init_telemetry", lambda: None)
       monkeypatch.setattr(main_mod, "_run_http", lambda: "http")
       monkeypatch.setattr(main_mod, "_run_stdio", lambda: "stdio")
       calls: list[str] = []
       monkeypatch.setattr(main_mod.asyncio, "run", calls.append)
       return calls
   ```

   - `test_main_selects_runner_from_resolved_transport` takes `recorded`; its body becomes
     `setenv` → `main_mod.main()` → `assert recorded == [expected]`. Drop the `("banana", "stdio")`
     row at `:34`; keep `("sse", "http")`, `("http", "http")`, `("stdio", "stdio")` (AC-3).
   - Add the `@AC-2` test: `monkeypatch.delenv("MCP_TRANSPORT", raising=False)` (not `setenv`),
     `main_mod.main()`, `assert recorded == ["http"]`.
   - Add the `@AC-1` primary test, one test parametrized over `["htp", ""]`:

     ```python
     monkeypatch.setenv("MCP_TRANSPORT", value)
     expected = f"MCP_TRANSPORT={value!r} is not recognized; expected 'http' or 'stdio'"
     with pytest.raises(RuntimeError, match=re.escape(expected)):
         main_mod.main()
     assert recorded == []
     ```

     This is the one in-process place that asserts the full message text (C-18).
3. `TestResolveTransport`:
   - Replace `test_unset_defaults_to_stdio` (`:64-69`) with a test asserting
     `main_mod.resolve_transport() == "http"` after `delenv`, keeping the `caplog.records == []` check.
   - Replace `test_unrecognized_value_falls_through_to_stdio_but_warns` (`:71-78`) with a single
     case: `setenv("MCP_TRANSPORT", "htp")`, then `with pytest.raises(RuntimeError):
     main_mod.resolve_transport()`. Exception type only, no message match. The stale AC-4 comment
     goes with it.
4. Add the `@AC-1` secondary test (real exit code, real `-m app.main` entry path):

   ```python
   try:
       proc = subprocess.run(
           [sys.executable, "-m", "app.main"],
           cwd=SERVICE_DIR,
           env={
               **os.environ,
               "MCP_TRANSPORT": "htp",
               "OTEL_ENABLED": "false",
               "PYTHONPATH": str(SERVICE_DIR),
           },
           stdin=subprocess.DEVNULL,
           capture_output=True,
           text=True,
           timeout=20,
       )
   except subprocess.TimeoutExpired:
       pytest.fail("python -m app.main did not exit within 20s for MCP_TRANSPORT=htp")
   assert proc.returncode != 0
   assert "expected 'http' or 'stdio'" in proc.stderr
   assert "falling back to stdio" not in proc.stderr
   ```

   **Binding (operator ruling 2026-11-20, O-4/R-6)**: do not assert on `MCP_TRANSPORT='htp'` — today's
   warning prints it. Keep all three assertions; do not shorten the timeout.

   **Flake fallback (O-5)**: this is the only test in the step that starts a process. If it fails
   for a reason other than the three assertions (the 20s timeout on a cold import, or a
   `ModuleNotFoundError` raised before `resolve_transport()` runs), do not retry it into green, mark
   it skip/xfail or raise the timeout silently. Stop and report at the checkpoint. Dropping it is
   allowed only as a recorded P-03 deviation (`context.md` and `## Deviation Log`, naming the
   observed failure), and AC-1 then rests on the in-process `main()` test from instruction 2, which
   must exist and pass either way. With it dropped the counts are 17 in the file and 827 in the suite.
5. C-13: the test uses no mocked domain data (env-var strings only), so there is no fixture-home
   question; the literals stay inline. `tests/conftest.py` is not edited.
6. Capture RED on the tree without Step 2:
   `cd services/xstockstrat-agent && uv run pytest tests/test_transport_config.py -q`.
   Expected: **6 failed, 12 passed**, each for a behavior reason, not an import error:
   - AC-2 dispatch: `recorded == ["stdio"]`, not `["http"]`.
   - AC-1 dispatch (`htp`, `""`): `DID NOT RAISE RuntimeError`.
   - resolve unset: returns `"stdio"`. resolve `htp`: `DID NOT RAISE`.
   - subprocess: `returncode != 0` **passes** on today's code (exit 1 from the `gen` import
     failure); the RED is `"expected 'http' or 'stdio'" in proc.stderr` failing, with the old
     fall-back warning present. Record this path in the PR body and `context.md`. design.md expected
     a 20s timeout here; the measured path is the other outcome it allows ("an exit with the old
     fall-back warning, never the new error text").
   If any of the six passes at RED, fix the test before Step 2.

**Verification**:

```bash
cd services/xstockstrat-agent && uv sync --frozen --extra dev \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```

Passes only with Step 2 applied (atomic unit). Expect 828 passed (825 baseline + 3 net new cases),
coverage ≥ 40%, and `tests/test_transport_config.py` at 18 passed. Confirm the cases executed
(`uv run pytest tests/test_transport_config.py -q` shows 18, none skipped).

---

### Step 2 — service: `resolve_transport()` fails closed

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- `app/main.py:52-65` — `def resolve_transport() -> str`.
  - `:54` `raw = os.environ.get("MCP_TRANSPORT", "stdio")`
  - `:55-60` `if raw == "sse":` deprecation warning, `return "http"`
  - `:61` `if raw not in ("stdio", "http"):`; `:62-63` comment justifying the warning before the
    stdio fall-through; `:64` `log.warning("MCP_TRANSPORT=%r is not recognized; falling back to stdio", raw)`
  - `:65` `return raw`
- `app/main.py:4-7` — module docstring: `:5` `  stdio  (default) -- launched directly by a local MCP client`,
  `:6-7` the `http` entry.
- `app/main.py:281-286` — `main()`; `:285` `init_telemetry()` (non-fatal); `:286` evaluates
  `resolve_transport()` before either runner coroutine is built.
- Fail-closed raise shape to reuse: `app/mtls.py:25-26` — `raise RuntimeError("mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)")`.
- Call sites of `resolve_transport` (repo-wide grep, tests included): `app/main.py:286` and
  `tests/test_transport_config.py:54,60,68,76` only. No other importer.
- `MCP_TRANSPORT` is a boot env var, not a `WatchConfig` key (F-07 not engaged). Deploy values are
  already a literal `http`: `docker-compose.yml:573`, `deploy/homelab/compose.yml:320`,
  `.do/app.yaml:384`, `.do/app.dev.yaml:386`. Local stdio is explicit:
  `services/xstockstrat-agent/claude_mcp_config.json:11`. No deploy file changes; no new env var or port.
- Lint: the agent is in the CI `python-lint` matrix (`.github/workflows/ci.yml:405-423`, steps
  `ruff check .` and `ruff format --check .`). design.md § 5 cites `fails.md:432` for the agent
  being absent from that matrix; that is no longer true on this tree, so the whole-service ruff
  commands apply. Fix only lines this step touches.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

Edit only `services/xstockstrat-agent/app/main.py`, after Step 1's RED is captured.

1. `:54` — change the default: `raw = os.environ.get("MCP_TRANSPORT", "http")`.
2. `:55-60` — leave the `sse` alias branch as is.
3. `:61-64` — keep the `if raw not in ("stdio", "http"):` test at `:61`; replace the comment
   (`:62-63`) and the warning (`:64`) with:

   ```python
   raise RuntimeError(f"MCP_TRANSPORT={raw!r} is not recognized; expected 'http' or 'stdio'")
   ```

   `:65` `return raw` stays. No normalization: no case folding, no stripping; `""` raises (D-3).
   Use `RuntimeError`, not `SystemExit` or `sys.exit` (R-1). Do not move the check into `main()` (R-2).
4. `:5-6` — module docstring: mark `http` as the default and say `stdio` must be set explicitly.
   Do not add a new inline comment in `resolve_transport()`.
5. Do not touch `main()` (`:281-286`), `_run_stdio`, `_run_http`, `supervisord.conf` or any deploy
   file. No new outbound gRPC call is added (header propagation not engaged).
6. Capture GREEN with the Verification command, and record red → green for AC-1 and AC-2 in the PR
   body and `context.md` (not in this file, F-09).

**Verification**:

```bash
cd services/xstockstrat-agent && uv sync --frozen --extra dev \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```

Expect 828 passed, coverage ≥ 40%, ruff clean. Without Step 1 this fails on the three tests that pin
the old behavior (atomic unit).

---

### Step 3 — docs: state the http default and the fail-closed behavior

**Status**: `pending`
**Service**: `docs/runbooks/`, `xstockstrat-agent` (documentation only)
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:18-21` — the Transport Modes table. `:20` Config cell reads
  `` `MCP_TRANSPORT=stdio` (default) ``; `:21` reads `` `MCP_TRANSPORT=http`, `MCP_HTTP_PORT=9000` ``.
  `:4` already points connection setup at `services/xstockstrat-agent/claude_mcp_config.json`.
- `services/xstockstrat-agent/CLAUDE.md:4` — the constitution-pointer line contains
  ``defects (`MCP_TRANSPORT` stdio default) in [`docs/context-constitution-findings.md`]``. `:11`
  and `:143` already read `MCP_TRANSPORT=http` and need no change.
- `services/xstockstrat-agent/docs/context-constitution-findings.md:30` — the open Latent-bugs row
  "`MCP_TRANSPORT` default is `"stdio"` …". The resolved-row convention is at `:29`:
  `~~<old text>~~ **RESOLVED (feature 093):** <what changed>`.
- Same file `:82` — the report row for `2026-10-19-agent-mcp-transport-stdio-fallthrough-defect`.
  The table (`:79-84`) has two columns, `| Report | Title |`; Title is the last cell, closed by the
  row's trailing ` |`. `:83` carries its suffix inside the Title cell, before that closing pipe.
  The convention for a fixed-but-not-yet-closed report is at `:83`:
  `— **triaged; fixed in code (feature 273, verified 2026-11-04)**`. `:77` says a row stays until its
  report is resolved; the report sidecar reads `triaged` and closing it is a launch-time step.
- Tests that read these documents: `services/xstockstrat-agent/tests/test_tools_endpoint.py:150-151`
  (tool-count statements in the agent `CLAUDE.md` and `mcp-tools.md`),
  `tests/test_watchlist_tools.py:329-334`, `tests/test_ingest_signal_watchlist.py:252-266`,
  `tests/test_extraction_instructions.py:26`. None asserts on the Transport Modes table.
- CI `markdown-lint` job lints `**/CLAUDE.md` (`.github/workflows/ci.yml:1118-1132`).
- Not needing change (re-grepped): `services/xstockstrat-agent/docs/context-constitution.md` has no
  `MCP_TRANSPORT` line; `services/xstockstrat-agent/app/main.py:5` is Step 2's.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. `docs/runbooks/mcp-tools.md`:
   - `:20` — replace `(default)` in the `stdio` Config cell with a note that it must be set
     explicitly (the shipped `claude_mcp_config.json` sets it).
   - `:21` — mark `http` as the default when `MCP_TRANSPORT` is unset.
   - Directly under the table add one short paragraph: any other value, including an empty one,
     stops the agent at startup with an error naming `MCP_TRANSPORT` and the value; under supervisord
     the process restarts in a loop and nothing listens on :9000, so check the agent logs (there is
     no DO `health_check` yet); a bare `python -m app.main` with no env now takes the http path and
     needs `MTLS_*`, so local stdio use must set `MCP_TRANSPORT=stdio`. Do not touch the `sse`
     alias note at `:23-29`.
2. `services/xstockstrat-agent/CLAUDE.md:4` — remove the parenthetical ``(`MCP_TRANSPORT` stdio default)``
   so the clause reads ``defects in [`docs/context-constitution-findings.md`]``. Nothing else on the
   line changes; keep the `context-forge:constitution-pointer` markers.
3. `services/xstockstrat-agent/docs/context-constitution-findings.md`:
   - `:30` — strike the Issue text and add `**RESOLVED (feature 331):**` in the `:29` form: unset
     now resolves to `http`, only an explicit `stdio` starts stdio, any other value raises
     `RuntimeError` in `resolve_transport()`; the missing DO `health_check` remains a follow-up.
   - `:82` — append ` — **triaged; fixed in code (feature 331)**` to the Title cell, in the `:83`
     form: the suffix goes after "…unset or mistyped" and before the row's closing ` |`. Add no new
     pipe and no third cell; the row must still have exactly two cells. Do not remove the row and do
     not edit the report sidecar.
4. No grep gate for stale strings is added anywhere (R-5).

**Verification**:

```bash
cd services/xstockstrat-agent && uv run pytest -q --cov=app --cov-fail-under=40
```

The doc-parity tests that read `mcp-tools.md` and the agent `CLAUDE.md` stay green (828 passed).
Then read the changed lines and confirm they match the Instructions:

```bash
sed -n '18,24p' docs/runbooks/mcp-tools.md
sed -n '4p' services/xstockstrat-agent/CLAUDE.md
sed -n '30p;79,84p' services/xstockstrat-agent/docs/context-constitution-findings.md
npx --yes markdownlint-cli2 --config .markdownlint.yaml services/xstockstrat-agent/CLAUDE.md
```

`markdownlint-cli2` is not installed in the repo's `node_modules`; if `npx` cannot fetch it, the CI
`markdown-lint` job is the gate for `CLAUDE.md`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
