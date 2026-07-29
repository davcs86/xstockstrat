# Context: remove-mcp-sse-transport

**Feature**: `docs/roadmap/features/079-remove-mcp-sse-transport/feature.md`

---

## Session 2026-07-29 — /sdd-story

- Backlogged at the user's request while implementing feature 073.
- Trigger: 073's `set_config` needs the *real caller's* role to authorize, and there is no verified
  caller identity on an SSE tool call, because `app/main.py` returns for `path == "/messages"`
  before the `_authorized` gate. 073 therefore restricted the tool to Streamable HTTP.
- Verified during 073's recon, against the installed SDK (`mcp==1.27.1`): both transports *do* hand
  a tool the underlying Starlette `Request` (`sse.py:244`, `streamable_http.py:260-266`), so the
  limitation is **not** that SSE lacks a request object — it is that the request was never
  authenticated. That distinction is why "remove the transport" is the right fix rather than
  "plumb claims through SSE too".
- Relationship to 073: 073 works around this; 079 removes the need for the workaround. 073 does not
  depend on 079 and can ship first. When 079 lands, 073's guard stays as defence in depth (FR-3).
- Numbering: `079` = `max(existing) + 1` at creation time (078 was the highest).

## Session 2026-07-29 — /sdd-review product-spec

**Result: approved on pass 3. Status `draft` → `spec-ready`.** Three passes were needed; the two
failures are worth recording because both were mine, and the second is the more instructive.

### Pass 1 — FAIL (FR-2) + 3 warnings

- **FR-2 was ambiguous**: "`MCP_TRANSPORT=sse` either maps to Streamable HTTP **or** fails fast".
  The fail-fast branch would have broken local, DO dev and DO prod simultaneously — all three ship
  that value — and contradicted AC-8. Collapsed to one decided behavior (see Decisions below).
- **AC-1 was not achievable by FR-1 as written.** This was the best catch of the review. Deleting
  the `/sse` and `/messages` branches does *not* make those paths 404: `Mount("/", app=handle_mcp)`
  (`app/main.py:201`) is a root catch-all, so a stale client would fall through to
  `session_manager.handle_request` and get an opaque Streamable-HTTP 400/406, or — unauthenticated —
  a 401 that starts a pointless OAuth flow. Added **FR-1a**: an explicit 404 branch placed *before*
  the auth gate, body naming the replacement URL. AC-3 is unaffected; a 404 never reaches a tool.
- **FR-3 named the wrong artifact.** It said to update the `AGENT-4` note, but AGENT-4
  (`services/xstockstrat-agent/docs/context-constitution.md:18`) is entirely about outbound header
  forwarding and carries no transport claim at all.
- FR-4's doc-surface list was incomplete.

### Pass 2 — FAIL (FR-4) + 5 warnings

I answered "your list is not exhaustive" by writing **"The list is exhaustive as written"** — an
asserted certainty substituted for verification, in a spec whose entire purpose is deleting claims
that no longer match the code. It was false. Fixed by actually running
`grep -rniE '\bSSE\b|/sse|/messages|build_sse_app|_run_sse|MCP_SSE_PORT|SseServerTransport'` and
making the output the list, recording the command + date in FR-4 so it can be re-run, and demoting
the enumeration in favour of **AC-5 as the operative gate**.

Two of the four surfaces the assertion had missed mattered:

- agent `CLAUDE.md:83` ("registered in `app/main.py` `build_sse_app`") is made stale by **this
  feature's own FR-2 rename** — self-inflicted drift.
- `docs/runbooks/mcp-tools.md:48` ("an unauthenticated `GET /sse` returns 401") is **contradicted by
  FR-1a's 404**.

Added a *Deliberately NOT changed* list at the same time: the grep also hits a completely different
SSE (the trader alert stream to the browser, `phase5-deviations.md`, notify `CLAUDE.md:28`) and
`sse-starlette`/`httpx-sse`, which are transitive dependencies of the `mcp` package itself and
cannot be dropped. Without that list a later reader would read those omissions as misses.

### Pass 3 — PASS WITH WARNINGS → all four closed in place

`app/main.py:125-128` was the one in-scope grep hit assigned to no requirement — it carries the same
`set_config` transport rationale and **survives FR-1's deletion** because it lives inside
`_authorized`. Added to FR-3. AC-5 restated as a mechanical grep condition. AC-1's "`sse.py`"
corrected to `mcp.server.sse`. Noted that `context-constitution.md:30` is a by-inspection addition
rather than a grep hit, so it is not later "corrected" away.

### Decisions recorded

- **`MCP_TRANSPORT`**: `http` becomes canonical; `sse` stays accepted as a deprecated alias that
  logs a warning and starts the same server. Deployment files move to `http`, but the alias means an
  un-updated or half-deployed environment keeps serving MCP.
- **`MCP_SSE_PORT` → `MCP_HTTP_PORT`** with fallback — an env var read from a deployment file needs
  one, because code and YAML roll out at different moments.
- **`build_sse_app`/`_run_sse` renamed with NO alias** — private in-repo symbols whose only callers
  are updated in the same commit; an alias would be dead code.
- **AC-6 clarified**: "073's tests still pass unchanged" means the guard holds and its assertions are
  untouched — not that the file is byte-frozen. Its docstrings still say SSE is "unsupported" rather
  than removed, and those are updated.

### Overlap scan — no blocking collision

The `feature-overlap` subagent reported a hard ordering constraint on 073 and recommended a
merge-order row, on the basis that this branch was cut from `claude/feature-073-impl` and that 073
was unmerged. **That conclusion was wrong** — it read the reflog rather than the remote.
`origin/main-dev` is at `b77a6d5` (`feat(073) … #807`), 073 is merged, and this branch's only extra
commits are its own. No merge-order row is needed. Its file-level inventory was still useful.

### Open items carried into design

- FR-5 is discharged (see the spec's Open Questions); no execution work remains for it.
- Residual **operator action** after deploy: a connector saved with a URL ending in `/sse` must have
  that URL trimmed to the bare `AGENT_PUBLIC_URL`. Must appear in the PR body and in
  `docs/runbooks/mcp-tools.md`.
- Root `CLAUDE.md` teardown rule applies — `/context-scrubber scan` before the PR, since three
  governed context files change.

## Session 2026-07-29 — /sdd-design (quick)

**Status `spec-ready` → `design-approved`.** Phase 0 recon + 1 mandated grilling round. No Floor
breach. Adversary returned NEEDS WORK with 10 objections: 8 adopted, 1 adopted with a different
remedy, 1 rejected with reasons. Nothing deferred.

### Phase 0 — Recon

Two findings changed the work:

- **`MCP_HTTP_PORT` is absent from all three deployment files.** The spec had described it as a
  rename throughout; it is an **addition**.
- **Every `os.environ` read in `app/` is module-level, bound at import** (`main.py:26-27`). So
  `monkeypatch.setenv` cannot reach the constants, and **neither AC-4 nor AC-9 was testable** as the
  code stood. This was the only genuine design fork and it went to the grilling round.

De-risked: `oauth_metadata.py`'s `/sse` is **docstring-only** — both discovery payloads carry
`AGENT_PUBLIC_URL`, so the RFC 8414/9728 contract does not change. And no module in `app/` imports
`app.main`, so dropping `mcp.server.sse` has zero blast radius outside `main.py` + its two test
modules.

### Decisions

- **Call-time resolvers** `resolve_transport()` / `resolve_http_port()` replace the two module
  constants. Rejected `importlib.reload` (re-registers all 17 tools per test and rebinds the
  `app.client` constants `conftest.py:44-47` patches, silently defeating the autouse fixture) and
  `monkeypatch.setattr(main, "MCP_TRANSPORT", …)` (leaves the alias logic in unreachable `__main__`).
- **`main()` extracted from `if __name__ == "__main__":`** so the *dispatch* is tested, not just the
  resolver's return value. This was the debate's most valuable output — see the Corrections below.
- **404 branch** replaces the `/messages` branch in place (already pre-auth), exact-match on the two
  normalized paths via a named `REMOVED_TRANSPORT_PATHS` tuple, `text/plain`, body naming
  `AGENT_PUBLIC_URL`. Exact match not prefix: `Mount("/")` is a root catch-all and `startswith` would
  permanently reserve `/sse*` from the Streamable HTTP fall-through.
- **Unrecognized-value warning added** to `resolve_transport()`. Behavior unchanged (AC-4 mandates
  fallthrough to stdio) but `.do/app.yaml` has **no `health_check` block** and compose has only a
  TCP-9000 probe, so `MCP_TRANSPORT=htp` today yields a container that is up, serving nothing, with no
  diagnostic. Narrows the latent defect at `context-constitution-findings.md:18`.
- **Two red-green cycles, each committing green** — not four alternating steps, which would have
  opened two step PRs with red CI (**F-05**).
- **Empty-string port behavior changes deliberately**: `MCP_SSE_PORT=""` currently raises `ValueError`
  at import; the `or`-chain treats it as absent and yields 9000. Declared and pinned by a test.

### Corrections to earlier artifacts (both caught by the debate, both mine)

1. **AC-5 was unsatisfiable.** The pass-3 review fix made it a mechanical grep gate — "no hit outside
   the *Deliberately NOT changed* list" — but FR-1a's own branch must contain `/sse` and `/messages`,
   and FR-2's fallback must contain `MCP_SSE_PORT`, all in `app/main.py`. **The gate I wrote to be
   objective would have failed on a correct implementation.** Restated in `product-spec.md` as two
   tiers: tier 1 a hard mechanical zero for the symbol set, tier 2 enumerated at **line** granularity.
   Line granularity is load-bearing — the adversary's decisive point was that allow-listing
   `app/main.py` wholesale would exempt `main.py:125-128`, the stale SSE rationale inside
   `_authorized` that *survives* the route deletion (recon Risk 3). Verified live by grep.
   Both proposed replacements were rejected after I ran them: "hard zero repo-wide" fails on
   `docs/roadmap/features/**` (the pipeline's own artifacts), and the marker-token filter
   (`grep -viE 'deprecat|removed|legacy|404'`) produces false negatives on legitimate survivors that
   carry no marker word on their own line.
2. **`tests/test_config_tools.py:167` pins the error string.** It asserts
   `pytest.raises(RuntimeError, match="Streamable HTTP")`. FR-3 rewrites exactly that string
   (`app/tools.py:748`) and AC-6 forbids changing the test body — so the rewrite **must retain the
   literal substring `Streamable HTTP`**. Neither the product spec nor recon caught this.

### Rejected from the proposal

- **Live-socket smoke check** (`MCP_TRANSPORT=sse uv run python -m app.main`, grep stdout, kill) as a
  step verification. It is a demonstration, not evidence — it proves the binary started once on one
  machine, ships nothing, never runs again, and cannot catch the regression it was proposed to
  prevent. Also unfit mechanically: binds a real port, depends on kill timing, and CI runs pytest
  only. Replaced by the `main()` dispatch test, which asserts the same thing in the shipping suite on
  every run. Direct `fails.md` 2026-07-27 hit.
- **Categorizing the ingest/analysis edits as `docs`** to detach C-08. They modify
  `app/handlers/servicer.py` — service source. Step stays `service` with a declared characterization
  green (`tdd-gate.md:41-44`). `claude_mcp_config.json` stays `service` per recon and FR-6, not
  `config`.

### Open Threads

- `if __name__ == "__main__": main()` remains untested — one call, no logic. Accepted. → cycle A.
- Unrecognized-value fallthrough stays a latent defect, now warned rather than fixed (AC-4 mandates
  today's behavior). `context-constitution-findings.md:18` stays open **by design**, and needs a
  *semantic* rewrite — this design deletes the constant it points at — not the line renumber recon
  Risk 6 described. → docs step.
- Coverage after deleting two tests is **measured, not predicted**: every code-bearing step's
  verification is the CI command with `--cov-fail-under=40`. → cycles A and B.
- AC-5 tier 2 requires judgment; tier 1 is fully mechanical and `main.py:125-128` is pinned by name in
  FR-3. → docs step.
- Operator action after deploy: a connector saved with a `/sse` URL 404s until trimmed to the bare
  `AGENT_PUBLIC_URL`. → PR body + `docs/runbooks/mcp-tools.md`.

## Session 2026-07-29 — /sdd-spec

**Status `design-approved` → `implementation-ready`.** Generated `implementation-spec.md` with
**8 steps**, following `design.md` §5's ordering exactly. No design decision was reopened.

Step map: 1 [service] + 2 [test] = Cycle A (call-time resolvers + extracted `main()`);
3 [service] + 4 [test] = Cycle B (SSE deletion, FR-1a 404 branch, factory renames, rationale
rewrites); 5 [service] `claude_mcp_config.json`; 6 [config] the three deployment specs;
7 [service] ingest/analysis comment-only; 8 [docs] the FR-4 sweep + AC-5 two-tier reconciliation.

### Key codebase findings (all re-verified this session, not inherited)

- **FR-4's grep list reconciles exactly**, with one addition. Re-running FR-4's grep over
  `git ls-files` (excluding `packages/proto/gen/` and `docs/roadmap/features/`) reproduces every line
  the product spec enumerates — `.do/app.{yaml,dev.yaml}:276,277`, `docker-compose.yml:520-521`, root
  `CLAUDE.md:105`, agent `CLAUDE.md:11,15,65,77,83,94,97,118-119`, `mcp-tools.md:13,15,21,22,27,42,48,61,683`,
  `header-propagation.md:13,21`, `product-features.md:177`, `setup-env.sh:199`,
  `context-constitution.md:4,16`, `context-constitution-findings.md:18`, both `servicer.py` lines, and
  every agent `app/`+`tests/` hit. **New survivor not on any list:**
  `docs/roadmap/ledger/insights.md:356,359,373,381,384` — this feature's own two design-phase ledger
  entries, written after the spec's 2026-07-29 grep. `docs/roadmap/ledger/` is append-only by
  convention (`ledger/CLAUDE.md`), so they are legitimate survivors; recorded in Step 8's tier-2
  justification list rather than edited.
- **AC-5 tier-1 baseline is 14 rows**, all inside files Steps 3 and 8 change: agent `CLAUDE.md:83`;
  `app/main.py:51,59,76,164,206,209,225`; `tests/test_oauth.py:4,17,19,73`;
  `tests/test_tools_endpoint.py:12,14`. Verified by execution. `CHANGELOG.md` carries **no** tier-1
  hit, so it needs no exclusion in the tier-1 command — only tier 2 needs it.
- **`app/tools.py:21` is a false positive for FR-3.** Recon listed it among the code surfaces to
  edit; the line actually reads "set_config — writes one non-secret config value (admin-scoped,
  Streamable HTTP only)" and carries no SSE claim. It is still true post-change and is left alone —
  it is not a grep hit under FR-4's pattern either.
- **The `claude_mcp_config.json` file is read by nothing.** `git ls-files | xargs grep -ln
  claude_mcp_config` returns only `docs/runbooks/mcp-tools.md:3` and SDD artifacts. That is what makes
  Step 5's `TDD: N/A` honest and lets its C-08 pairing ride on Step 4's suite run rather than
  inventing a test with nothing to assert.
- **`tests/` has no transport/env module today** (`conftest.py`, `test_auth.py`,
  `test_backtest_view.py`, `test_client.py`, `test_config_tools.py`, `test_oauth.py`, `test_tools.py`,
  `test_tools_endpoint.py`), so Step 2's `test_transport_config.py` is a create-from-scratch with no
  existing pattern to copy — recorded as such in its Codebase Evidence.

### Spec-authoring decisions

- **Step 3 carries the minimum test adaptation it breaks** (the `_app()` rename in both modules, the
  deletion of `test_sse_accepts_valid_credential_reaching_transport`, and the 401→404 rewrite), with
  everything else in those files deferred to Step 4. This is the ledger `insights.md` 2026-07-27 (072)
  shape and is what keeps every commit green under **F-05** without collapsing the red-green pair.
- **Step 2's red is protected from becoming an import error.** The step instructs
  `import app.main as main_mod` with attribute access *inside* test bodies — a module-level
  `from app.main import resolve_transport` would break collection of the whole file and fail
  `tdd-gate.md:22-25`. This is the mechanical detail that makes `design.md` §5's "behavioral red"
  claim actually hold.
- `resolve_transport`'s deprecation warning is asserted against logger name `app.main`
  (`app/main.py:24` → `log = logging.getLogger(__name__)`), and every "unset" case uses
  `monkeypatch.delenv(..., raising=False)` because `tests/conftest.py:31-37` is **autouse** and
  already sets `MCP_TRANSPORT=stdio`.

## Session 2026-07-29 — /sdd-execute (all 8 steps, single PR)

**Status `implementation-ready` → `code-completed`.** Executed on `claude/feature-079-remove-sse` as
one PR rather than 8 stacked step PRs, matching how 073–078 shipped in this session.

### TDD gate

- **Cycle A red** (captured before any edit): `tests/test_transport_config.py` — 12 failures, each
  failing *inside its own body* on `AttributeError: module 'app.main' has no attribute …`. Collection
  succeeded, which is the point: the file imports the module and reads attributes inside test bodies,
  so the red is "behavior missing" per `tdd-gate.md:22-25` rather than a file-level ImportError.
- **Cycle A/B green**: 27 passed across `test_transport_config.py` + `test_oauth.py`.
- **Full agent suite**: 137 passed, coverage **68.21%** (baseline was 124 passed). The
  `--cov-fail-under=40` gate was *measured*, not predicted — two SSE cases were deleted and coverage
  still rose, because the deleted code went with them.
- **Step 7 characterization green**: ingest 134, analysis 351 — both unchanged from before the edit,
  which is what "red N/A — no behavior change" has to mean.

### AC-5 result

- **Tier 1: 0 rows**, down from the 14-row baseline. Fully mechanical, no judgment.
- **Tier 2: every survivor enumerated and legitimate** — the trader-alert SSE (a different SSE, on
  the NOT-changed list), `FR-1a`'s `REMOVED_TRANSPORT_PATHS`, FR-2's deprecated alias/fallback
  handling, the operator migration note, and the tests that assert the 404. Zero unexpected hits.

### Deviations (full detail in the spec's Deviation Log)

- **D-1** — Steps 1 and 3's runner rename landed together; single-PR execution makes the intermediate
  `_run_sse` state unreviewable, and the end state is identical.
- **D-2** — Step 5's verification (`! grep -n "sse" claude_mcp_config.json`) was **too strict and
  failed on correct output**: the operator migration note must name `/sse` to tell an operator what to
  change. Replaced with the real invariant — no server block's `url` may contain `/sse`. This is the
  *same shape* as the AC-5 defect the design phase caught: a substring gate over vocabulary that
  legitimately survives. Third instance this feature; see the ledger.
- **D-3** — two docstring reflows in Step 7, because the replacement phrase overflowed ruff's
  100-char limit. No wording changed beyond the named phrase.

### Verified end state

- `app/main.py`: SSE import, `SseServerTransport` construction and both branches deleted;
  `REMOVED_TRANSPORT_PATHS` + `_send_transport_removed` return 404 `text/plain` **before**
  `_authorized`; `resolve_transport()` / `resolve_http_port()` replace the import-time constants;
  `main()` extracted so the startup dispatch is under test.
- Deployment: all three specs on `MCP_TRANSPORT: http` + `MCP_HTTP_PORT`; all three YAMLs parse.
- `claude_mcp_config.json`: two `/sse` blocks → one Streamable HTTP block at the bare
  `<AGENT_PUBLIC_URL>`, plus a `_migration` note.

### Open Threads

- **Operator action after deploy** (unchanged): a connector saved with a `/sse` URL returns 404 until
  trimmed to the bare `AGENT_PUBLIC_URL`. In the PR body and `docs/runbooks/mcp-tools.md`.
- **`/context-scrubber scan` was not run** — the context-forge plugin is not available in this
  session. Stated in the PR body rather than skipped silently, per the root `CLAUDE.md` teardown rule.
- **`context-constitution-findings.md:18` stays open by design** — the unrecognized-value fallthrough
  is narrowed by the new warning, not closed; AC-4 mandates the fallthrough itself.
