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
