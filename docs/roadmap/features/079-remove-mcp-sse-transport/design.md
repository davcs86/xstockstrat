# Design: remove-mcp-sse-transport

**Created**: 2026-07-29
**Rounds**: 1 (quick; termination: approved after the mandated adversarial round, objections resolved
rather than deferred)
**Approved by**: orchestrator @ 2026-07-29 — see "Approval note"
**Grounded in**: recon.md

---

## Approval note

Run non-interactively under a standing instruction to take 079 through the pipeline and implement it.
No decision in this design is the user's to make: the two product-level choices this feature could
have raised — remove vs. harden the transport, and staged vs. single rollout — were both settled in
the product spec's Open Questions from repo evidence, and the user had already asked for the removal
outright. The one gate-level correction below (**AC-5**) is a fix to a criterion this same session
authored and got wrong, not a change to what was asked for.

The mandated `quick` round ran in full: proposer → adversary → synthesis. The adversary returned
**NEEDS WORK** with ten objections and **no Floor breach**. Eight are adopted, one is adopted with a
different remedy than proposed, and one is rejected with reasons. Nothing is deferred.

---

## Chosen Approach

### 1. Env resolution moves from import-time constants to call-time resolvers

The blocker recon found (Risk 1): `MCP_TRANSPORT` and `MCP_SSE_PORT` are module constants bound at
import (`app/main.py:26-27`), so `monkeypatch.setenv` cannot reach them and neither AC-4 nor AC-9 is
testable. Both constants are **deleted** and replaced by call-time functions. Verified safe: repo-wide,
`MCP_TRANSPORT`/`MCP_SSE_PORT` appear outside `main.py` only as env-var *names*, never as imported
symbols — the sole cross-module import of `app.main` is `build_sse_app` in `tests/test_oauth.py:17`
and `tests/test_tools_endpoint.py:12`.

```python
def resolve_transport() -> str:
    """Canonical MCP_TRANSPORT. `sse` is a deprecated alias for `http` (FR-2)."""
    raw = os.environ.get("MCP_TRANSPORT", "stdio")
    if raw == "sse":
        log.warning("MCP_TRANSPORT=sse is deprecated and now selects the Streamable HTTP "
                    "transport; set MCP_TRANSPORT=http")
        return "http"
    if raw not in ("stdio", "http"):
        log.warning("MCP_TRANSPORT=%r is not recognized; falling back to stdio", raw)
    return raw


def resolve_http_port() -> int:
    """Port for the HTTP server. MCP_SSE_PORT is the deprecated fallback (FR-2)."""
    deprecated = os.environ.get("MCP_SSE_PORT")     # deprecated alias, feature 079
    return int(os.environ.get("MCP_HTTP_PORT") or deprecated or "9000")
```

The deprecation warning lives **inside** `resolve_transport()` because that is the last point holding
the raw `sse` value, and unlike `__main__` it is reachable from a test.

**The unrecognized-value warning is an adopted adversary objection (6).** Falling through to `stdio`
on a typo is today's behavior and AC-4 mandates keeping it — but this feature *widens the exposure*
(one accepted HTTP value becomes two) and step 5 retypes the value in three deployment files, which
is exactly when a typo enters. I confirmed how quietly it would fail: `.do/app.yaml:255-285` has
`http_port: 9000` and **no `health_check` block**, and `docker-compose.yml:527-529` has only a TCP-9000
probe with nothing depending on the agent — so `MCP_TRANSPORT=htp` yields a container that is up,
serving nothing, with no diagnostic anywhere. The warning changes no behavior (AC-4 untouched) and
turns a silent failure into a log grep. It also directly addresses the latent defect already logged at
`services/xstockstrat-agent/docs/context-constitution-findings.md:18`.

**The `or`-chain changes empty-string behavior and that is deliberate** (adversary objection 7). Today
`int(os.environ.get("MCP_SSE_PORT", "9000"))` raises `ValueError` at *import* on `MCP_SSE_PORT=""`;
the chain treats `""` as absent and yields 9000. Failing to boot over an empty string is worse than
defaulting, but it is an undeclared change unless stated — so it is stated here and pinned by a test.

### 2. `main()` is extracted so the dispatch is testable

**Adopted from adversary objection 3, and it is the most valuable change the debate produced.** The
proposer's six resolver tests assert what a pure function *returns*; AC-4 is about which server
actually *starts*. That dispatch lives in `if __name__ == "__main__":` (`app/main.py:216-227`), which
pytest never reaches — so the proposed plan would have shipped six green tests that never touch the
thing under test. That is precisely the `fails.md` 2026-07-29 shape (074: a suite reporting pass while
the code under test was never reached).

```python
def main() -> None:
    from app.telemetry import init_telemetry
    init_telemetry()            # non-fatal: no-ops unless OTEL_ENABLED=true
    asyncio.run(_run_http() if resolve_transport() == "http" else _run_stdio())


if __name__ == "__main__":
    main()
```

A test imports `app.main`, monkeypatches `init_telemetry`/`asyncio.run`/`_run_http`/`_run_stdio`, sets
`MCP_TRANSPORT=sse`, calls `main()`, and asserts `_run_http` was selected. `python -m app.main`
(`Dockerfile:21`) is unaffected. This is what binds the resolver to the entrypoint **in the shipping
suite**, on every CI run.

**The proposer's live-socket smoke check is rejected** (adversary objection 4, adopted). Running
`MCP_TRANSPORT=sse uv run python -m app.main` against a real port and grepping stdout proves the
binary started once on one machine; it ships nothing, never runs again, and cannot catch the very
regression it was proposed to prevent. It is also unfit as a step `**Verification**`: it binds a real
port, depends on kill timing, and CI runs pytest only (`.github/workflows/ci.yml:369-372`). The
`main()` test replaces it entirely.

### 3. The FR-1a 404 branch

Replaces the `/messages` branch at `app/main.py:163-165` **in place** — that branch is already the
first statement after path normalization and already precedes the `_authorized` gate at `:167`, so
FR-1a needs no restructuring. The `/sse` branch `:171-176` is deleted.

```python
# Legacy HTTP+SSE transport paths, removed by feature 079.
REMOVED_TRANSPORT_PATHS = ("/sse", "/messages")
...
    path = (scope.get("path") or "/").rstrip("/") or "/"

    if path in REMOVED_TRANSPORT_PATHS:
        await _send_transport_removed(scope, receive, send)
        return

    if not await _authorized(scope):
```

with, alongside `_send_unauthorized` (`app/main.py:135-147`, the only raw-ASGI response precedent):

```python
    async def _send_transport_removed(scope, receive, send) -> None:
        # 404 BEFORE the auth gate (FR-1a): a stale client gets an immediate, unambiguous
        # answer naming the URL to switch to, instead of a 401 that starts a pointless OAuth
        # flow. Leaks nothing -- AGENT_PUBLIC_URL is already served unauthenticated at :143
        # and by the .well-known discovery routes.
        response = Response(
            f"This MCP transport was removed. Use the Streamable HTTP endpoint at {AGENT_PUBLIC_URL}",
            status_code=404,
            media_type="text/plain",
        )
        await response(scope, receive, send)
```

- **Exact match on the two normalized paths, every method** — not a prefix match. `Mount("/", app=handle_mcp)`
  (`:201`) is a root catch-all, so `startswith` would permanently reserve `/sse*` and `/messages*`
  from the Streamable HTTP fall-through at `:178`. `.rstrip("/")` at `:161` already folds
  `/messages/` and `//messages//` into the literal, and the old transport's `?session_id=…` lives in
  `scope["query_string"]`, not `scope["path"]`.
- **`text/plain`, not JSON** — a JSON body on the MCP path risks a client parsing it as a JSON-RPC
  envelope. The remediation is a human editing a connector URL (Open Question finding 4), so prose is
  the right register. This is an explicit departure from `_send_unauthorized`, which sets no
  `media_type`: here the body is load-bearing, so it gets a declared type.
- **Replacement URL is `AGENT_PUBLIC_URL`** (`app/main.py:33`) — the same value `_send_unauthorized`
  interpolates at `:143` and the same one FR-6 writes into `claude_mcp_config.json`. Read inside the
  nested closure at call time, so a test can `monkeypatch.setattr`. Unset it defaults to
  `http://localhost:9000`; in DO it is `${APP_URL}/agent`.

### 4. AC-5 is restated — the criterion this session authored was unsatisfiable

**This is a correction, recorded loudly rather than quietly patched.** Pass 3 of `/sdd-review` made
AC-5 a mechanical grep gate: "no hit outside the *Deliberately NOT changed* list." That gate **fails on
a correct implementation** — FR-1a's branch must contain the literals `/sse` and `/messages`, and
FR-2's fallback must contain `MCP_SSE_PORT`, all in `app/main.py`, which is not on that list.

The adversary's proposed replacement is **rejected on both halves**, verified by running it:

- *"hard zero repo-wide for `build_sse_app|_run_sse|SseServerTransport`"* — false. Those terms live in
  `docs/roadmap/features/{009,018,019,049,072,079}/**`, including this feature's own `recon.md` and
  `product-spec.md`. A literal repo-wide zero fails on the pipeline's own artifacts on day one.
- The **marker-token** variant (pipe tier 2 through `grep -viE 'deprecat|removed|legacy|404'`,
  expect zero) is elegant but does not survive contact. I ran it: legitimate post-change survivors
  carry no marker word on their own line — `if path in ("/sse", "/messages"):`, `r = tc.get("/sse")`.
  Satisfying it means contorting code to please a grep. (It did drive one real improvement: naming the
  tuple `REMOVED_TRANSPORT_PATHS` above, which is better code on its own merits.)

**The adversary's decisive point is adopted**: file-granularity allow-listing of `app/main.py` would
exempt the one file still carrying a stale consumer-facing claim — `main.py:125-128`, the SSE rationale
inside `_authorized`, which *survives* the route deletion. My own grep confirms `:127` is a live
survivor. So the gate must not allow-list that file wholesale.

**Restated AC-5, two tiers:**

- **Tier 1 — hard zero, fully mechanical.** `build_sse_app|_run_sse|SseServerTransport|mcp\.server\.sse|handle_post_message`
  returns **no hit** outside `docs/roadmap/features/**` and the *Deliberately NOT changed* list. These
  symbols cease to exist, so there is no legitimate survivor. This is the check that catches a missed
  rename.
- **Tier 2 — enumerated at line granularity, not file granularity.** Re-run FR-4's full grep; **every
  surviving hit is listed in the PR body with a one-line justification.** A hit in a file that is
  neither on the *Deliberately NOT changed* list nor in FR-4's enumeration is a failure. Line
  granularity is the point: `app/main.py` legitimately survives via the FR-1a branch and the FR-2
  fallback, and must still be inspected line by line so `:125-128` cannot hide behind them.

`main.py:125-128` is additionally pinned **by name** in FR-3, so it does not depend on the gate at all.

### 5. Test plan and step ordering

**Two red-green cycles, each committing green** (adversary objection 2, adopted). The proposer's
four-step alternation would have committed two standalone red steps; each step gets its own
`feature-steps/<slug>-step-N` PR, so those PRs would open with red `python-test` CI — unmergeable, and
against **F-05**. Its step-3 red was also an `ImportError` from the `build_http_app` rename, which
`tdd-gate.md:22-25` rejects outright: the red must be "the behavior is missing, not a typo/import
error." Worse, `test_tools_endpoint.py`'s three cases pass today and must pass after — renaming the
factory makes them red carrying zero information.

**Cycle A — env resolution.** Red: `tests/test_transport_config.py` written against the current tree
fails because `resolve_transport` does not exist… which is an import error. So the red is taken
*behaviorally* instead: the `main()`-dispatch case is written first and asserts `_run_http` is selected
for `MCP_TRANSPORT=sse` — against today's tree that is a genuine behavioral failure. Green: add both
resolvers + `main()`, delete `:26-27`, rewire `:210-211`, `:224-227`.

Cases (all using `monkeypatch.delenv(..., raising=False)` where absence is the point — **adversary
objection 5, adopted**: `tests/conftest.py:37` is an **autouse** fixture that already sets
`MCP_TRANSPORT=stdio`, so an "unset" case written with `setenv` would silently assert `stdio→stdio`
and pass for the wrong reason): `http`→`"http"` with **zero** WARNING records; `sse`→`"http"` **plus** a
WARNING; unset→`"stdio"` (via `delenv`); `"banana"`→`"banana"` **plus** the unrecognized warning;
`MCP_HTTP_PORT=9111`→9111; `MCP_SSE_PORT=9222` only→9222; both unset→9000;
`MCP_HTTP_PORT=""` + `MCP_SSE_PORT=9222`→9222 (the empty-string case from §1); and the `main()`
dispatch case above.

**Cycle B — route removal.** Red **behaviorally, against the current `build_sse_app`**: write
`test_sse_path_404_names_replacement_url` first and watch it fail `401 != 404` — a real red, not an
import error. Green: delete `:59`, `:76`, `:163-165`, `:171-176`; add `REMOVED_TRANSPORT_PATHS` +
`_send_transport_removed`; rename `build_sse_app`→`build_http_app` and `_run_sse`→`_run_http` (with
their call sites and both test `_app()` factories in the same commit); rewrite the docstrings and the
three surviving SSE comments (`:99-103`, `:125-128`, `handle_mcp`'s). Includes the prose-only agent
edits (`app/tools.py`, `app/scopes.py`, `app/auth.py`, `app/oauth_metadata.py`) because one suite run
verifies them all.

- **Deleted:** `test_sse_accepts_valid_credential_reaching_transport` (`test_oauth.py:55-78`) — it
  patches `mcp.server.sse.SseServerTransport.connect_sse` (`:73`), a target that ceases to exist. It
  can only be deleted, not rewritten.
- **Rewritten:** `test_sse_unauthenticated_401_with_www_authenticate` (`:48-52`) → 404 + URL in body +
  **`"www-authenticate" not in r.headers`**. That last assertion is the anti-trivial one (recon Risk 2):
  a 404 is also what a misconfigured app returns, but a fall-through to `_authorized` would carry that
  header, so its absence proves the branch exists.
- **New:** `test_messages_path_404_even_with_credential` — `POST /messages` **with** a Bearer header and
  **no** claims mock → 404, proving the branch precedes the gate (AC-1's "with or without").
  `test_messages_trailing_slash_and_query_404` — `POST /messages/?session_id=abc` → 404.
- **Control:** the existing `test_streamable_root_unauthenticated_401_with_www_authenticate`
  (`:84-89`) proves the app is not globally 404ing.
- **Untouched assertions:** `tests/test_config_tools.py` — docstrings only (AC-6).

**The rewritten `set_config` error string must retain the literal substring `Streamable HTTP`.**
`tests/test_config_tools.py:167` asserts `pytest.raises(RuntimeError, match="Streamable HTTP")` and
AC-6 forbids changing that test body. Verified directly. Neither the product spec nor recon caught
this; FR-3 rewrites exactly that string at `app/tools.py:748`.

**Coverage** (adversary objection 9, adopted; recon Risk 5): two tests are deleted against a
`--cov-fail-under=40` gate. Every code-bearing step's `**Verification**` is the CI command itself —
`uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40` — so the threshold is
*measured*, never reasoned about.

**Step categories** (adversary objection 8, adopted): the ingest/analysis edits touch
`app/handlers/servicer.py` — **service source files** whose `python-lint`/`python-test` jobs run.
Calling them `docs` to detach **C-08** is category laundering; the step stays `service` with
`**Verification**` = "ingest + analysis suites pass unchanged", declared as a characterization green
per `tdd-gate.md:41-44` ("red N/A — no behavior change"). `claude_mcp_config.json` stays `service` per
`recon.md` § Recommended Scope and FR-6 ("part of the change, not documentation"), not `config`.

**`context-constitution-findings.md:18` gets a semantic rewrite, not a line renumber** (adversary
objection 10, adopted). Recon Risk 6 framed it as an off-by-one (`:25`→`:26`), but this design *deletes*
the constant that finding points at. Post-change the subject is `resolve_transport()`, and the recorded
defect persists — narrowed by the new unrecognized-value warning (§1), not closed.

---

## Rejected Alternatives

- **`importlib.reload(app.main)` to test env resolution** — re-imports FastMCP and re-registers all
  seventeen tools per test, and rebinds the `app.client` constants that `tests/conftest.py:44-47`
  monkeypatches, silently defeating the autouse fixture.
- **`monkeypatch.setattr(main, "MCP_TRANSPORT", "sse")`** — the alias logic would remain in
  `if __name__ == "__main__":`, unreachable from pytest; the assertion would prove only that a constant
  equals what the test just set.
- **Live-socket smoke check as a step verification** — a demonstration, not evidence; see §2.
- **Prefix/`startswith` matching for the 404 branch** — would permanently reserve `/sse*` and
  `/messages*` from the root Streamable HTTP fall-through.
- **JSON or `Link: rel="successor-version"` 404 body** — risks a client parsing it as a JSON-RPC
  envelope; the remediation is a human editing a URL.
- **Marker-token AC-5 grep** — fails on legitimate survivors that carry no marker word on their own
  line; see §4. Its one good idea (`REMOVED_TRANSPORT_PATHS`) was kept.
- **"Hard zero repo-wide" AC-5** — fails on the SDD pipeline's own feature artifacts.
- **Symmetric deprecation warning on the `MCP_SSE_PORT` port fallback** — neither FR-2 nor AC-9 asks
  for one, and the port var is not the one that silently mis-starts the server.
- **Keeping both `MCP_SSE_PORT` and `MCP_HTTP_PORT` in the deployment files** — the fallback exists for
  the un-updated-environment case; shipping both in the files it is meant to survive defeats the point.

---

## Open Risks

- [ ] **`main()` is tested, but `if __name__ == "__main__": main()` is not.** The extraction shrinks
  the untested surface to one line that cannot be reached by any import-based test. Accepted — the
  residue is a single call with no logic.
- [ ] **The unrecognized-value fallthrough remains a latent defect**, now warned about rather than
  fixed. Narrowing it further (fail fast on an unknown value) is out of scope: AC-4 mandates today's
  behavior. The finding at `context-constitution-findings.md:18` stays open by design.
- [ ] **AC-5 tier 2 requires judgment**, since a purely mechanical version is unsatisfiable (§4). The
  mitigation is that tier 1 is fully mechanical and `main.py:125-128` is pinned by name in FR-3.
- [ ] **Coverage after deleting two tests is measured, not predicted** — if the green run trips
  `--cov-fail-under=40`, that is a deviation to handle in the step, not a surprise at PR time.
- [ ] **Operator action after deploy**: a connector saved with a URL ending in `/sse` returns 404 until
  its URL is trimmed to the bare `AGENT_PUBLIC_URL`. Must appear in the PR body and
  `docs/runbooks/mcp-tools.md`.

---

## Constitution Rules Touched

- **C-01** — every step cites `path:line` from `recon.md` or from execution.
- **C-05 / F-07** — untouched: `MCP_TRANSPORT`/`MCP_HTTP_PORT` are env vars, not `WatchConfig` config
  keys, and no config value is hardcoded.
- **C-08 / P-06** — two red-green cycles, each committing green; both reds are **behavioral**, not
  import errors (`tdd-gate.md:22-25`). The ingest/analysis step declares a characterization green
  under the `tdd-gate.md:41-44` escape rather than laundering its category to dodge the pairing rule.
- **C-09** — n/a: no proto surface; the agent has no `packages/proto/agent/`.
- **C-10** — the transport claim is duplicated across code comments, tests, service docs, governed
  context files and the operator runbook; FR-4 enumerates them from a grep and AC-5 tier 2 gates them
  at line granularity. `app/main.py:125-128` — the copy that survives the route deletion — is pinned
  by name in FR-3.
- **C-11** — story → review (3 passes) → design → spec → execute, in order.
- **F-01 / F-06** — n/a: no migrations, no DB pool.
- **F-04** — nothing invented; every claim in this design was verified against the source, including
  the two the proposer raised against the spec (the `match="Streamable HTTP"` coupling and AC-5's
  unsatisfiability) and the two adversary claims I re-ran myself (the repo-wide-zero failure and the
  marker-token filter's false negatives).
- **F-05** — no step commits red; this is why the four-step alternation was rejected (§5).
- **F-11** — no Floor breach raised by the adversary.
- **P-03** — AC-5's defect is surfaced and corrected in the open (§4), not silently patched.
- **P-04** — see the Approval note: no user-owned decision remained open.
