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
