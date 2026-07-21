# Design: trigger-backfill-mcp-tool

**Created**: 2026-07-20
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-07-20T17:05Z (via explicit end-to-end instruction "run the SDD pipeline
and build trigger_backfill"; no contested trade-off survived synthesis — all adversary objections
resolved by accepted fixes, recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

Two thin layers mirroring the established agent architecture (recon.md § Patterns to REUSE):

**Client (`app/client.py`)** — two async functions using the per-call
`grpc.aio.insecure_channel(INGEST_ENDPOINT)` + `IngestServiceStub` pattern
(`app/client.py:431-474`):

```python
async def trigger_backfill(symbols, timeframe="1d", start=None, end=None,
                           overwrite=False, fill_mode=None) -> dict
async def get_backfill_status(job_id="", status_filter=None, symbol="",
                              limit=0, page_token="") -> dict
```

- **Pre-RPC fail-fast validation** (ingest queues unconditionally — ingest servicer.py:142-167 —
  so client-side `ValueError` is the only immediate feedback): empty `symbols`; `len(symbols) > 50`
  (cost-sanity cap on a paid-fetch operation); `start > end`; unknown timeframe / fill_mode /
  status_filter — each with a friendly message enumerating accepted values (style per
  `app/client.py:257`).
- **Timeframe**: accept ingest's own alias set (mirror `_TF_ALIASES` + `_STR_TO_ENUM`, ingest
  servicer.py:35-44 — `1d/1Day`, `1h/1Hour`, `15m/15Min`), canonicalize to lowercase, then
  **dual-field send** (`timeframe=<canonical>` + `timeframe_enum=<enum>`, pattern per analysis
  servicer.py:509-510; FR-2). Alias parity with the server avoids re-inviting the 053 mismatch.
- **TimeRange**: both bounds optional, one-sided allowed; build `common_pb2.TimeRange` setting
  only supplied bounds via `_iso_to_timestamp` (`app/client.py:30-36`); omit `range=` entirely
  when both absent (ingest `_ts_to_dt` treats seconds==0 as unset, servicer.py:57-61).
- **fill_mode**: `{"full": 1, "gaps_only": 2}`; `None` leaves the field `FILL_MODE_UNSPECIFIED`
  (server treats as FULL — ingest.proto:56-58; FR-1).
- **Auth (FR-4)**: extract `_admin_metadata()` beside `_metadata()` (`app/client.py:24-27`) and
  refactor the three existing inline `list(_metadata()) + [("x-access-scope", "7")]` sites
  (`app/client.py:293, :461, :603`) to use it — DRY guard rail over incidental inline habit.
  `trigger_backfill` sends `_admin_metadata()` (defensively; ingest has no scope gate on
  TriggerBackfill today); `get_backfill_status` sends `_metadata()` only.
- **Dual-mode status**: `job_id` set → `GetBackfillStatus`; empty → `ListBackfillJobs` with
  `status_filter` (friendly-wrapped `BackfillStatus.Value("BACKFILL_STATUS_" + upper)`;
  `"unspecified"` = no filter), `symbol`, and `PageRequest(page_size=limit,
  page_token=page_token)` — `page_token` param closes the pagination loop
  (`ListBackfillJobsResponse.page.next_page_token` is real — ingest servicer.py:536).
- **Return shapes** — one-key discriminated envelopes so consumers never key-sniff:
  - trigger → `{"job_id": ..., "status": BackfillStatus.Name(...)}`
  - status single-job → `{"job": MessageToDict(job, preserving_proto_field_name=True,
    always_print_fields_with_no_presence=True)}` (run_backtest variant, `app/client.py:166-170` —
    keeps zero-valued `bars_processed` visible while polling)
  - list → `{"jobs": [<same per job>], "next_page_token": ...}`

**Tools (`app/tools.py`)** — two `@server.tool()` wrappers inside `register_tools`
(`app/tools.py:58-60`), thin delegation, docstrings enumerating accepted values and both status
shapes. `grpc.aio.AioRpcError` → `RuntimeError(_grpc_error_message(...))` (`app/tools.py:32-43`):
custom `not_found="backfill job not found"` **only** on the status path (trigger can never
NOT_FOUND); trigger uses the default message. Pre-RPC `ValueError`s surface natively as FastMCP
tool errors. `/api/tools` catalog updates automatically (`app/main.py:180` → `server.list_tools()`).

**Tests** — mirror recipes cited in recon.md § Patterns to REUSE: admin-metadata capture on
trigger + read-path negative assertion; request-field asserts (dual-field timeframe, range
one-sided/omitted, fill_mode default, page_token); NOT_FOUND propagation on status; list-branch
dispatch on empty job_id; validation ValueErrors; tool delegation; `test_tools_endpoint.py`
name-set + both docstring surfacing. Error-mapping tests assert *any* `AioRpcError` maps through
`_grpc_error_message` — never enumerate UNAVAILABLE as exhaustive.

**Docs — five surfaces** (C-10(a) analog; recon found four, adversary added the fifth):
`app/tools.py:4` count docstring; agent `CLAUDE.md:22` (+ tool table + management-tool auth note);
`docs/runbooks/mcp-tools.md:3,29` (+ two tool sections); `docs/runbooks/CLAUDE.md:17`;
`docs/runbooks/historical-backfill.md` (add the MCP-tool trigger option beside the UI/gRPC paths).

## Rejected Alternatives

- Single `operation`-parameter tool (`manage_*` style) — rejected: auth scopes differ per
  operation (admin write vs secret-only read); two tools keep the scope split structural.
- Strict timeframe map rejecting `"1Day"`-style aliases — rejected: contradicts ingest's own
  `_TF_ALIASES` canonicalization and re-invites the 053 mismatch for LLM callers; costs only a
  6-entry table mirrored from the server.
- Always-list return shape (job_id as filter, no GetBackfillStatus) — rejected: loses the direct
  NOT_FOUND semantics FR-6 names as the concrete synchronous error case.
- Helper + new site only (leave 3 inline admin-metadata copies) — rejected: DRY guard rail flags
  the duplication; existing metadata-capture tests cover the mechanical refactor. (Kept as
  fallback if step review balks.)
- Bare job dict for the single-job branch — rejected: dual top-level shapes force key-sniffing;
  `{"job": ...}` envelope costs one line.

## Open Risks

- [ ] Timeframe/status alias tables mirrored from ingest can drift if ingest adds a timeframe —
      accepted; tool docstring enumerates canonical forms; revisit if ingest's map changes.
      (target: service step)
- [ ] Hardcoded-admin `"7"` scope now covers a cost-incurring operation; client-side 50-symbol cap
      is the mitigation; ingest-side quota is out of scope. (target: service step; noted for a
      future ingest-side gate feature)
- [ ] `docs/runbooks/historical-backfill.md:105` still documents the removed 8055 webhook path —
      pre-existing staleness, out of this feature's scope; fix opportunistically in the docs step
      if trivial, else flag. (target: docs step)

## Constitution Rules Touched

- `C-01` — honored: every design claim cites recon.md/path:line evidence; spec steps will carry
  the same citations.
- `C-03` — n/a for new headers (agent tools originate requests; they send `x-mcp-secret` +
  `x-access-scope` per the established agent pattern, not propagated inbound headers).
- `C-04` — honored: enum fields (`timeframe_enum`, `fill_mode`, `status_filter`) preferred over
  strings on the wire; deprecated string field populated only for FR-2 dual-carrier parity.
- `C-08` — honored: the service step is paired with a test step meeting the agent's ≥40% gate.
- `C-10` — honored: all five shared discovery surfaces updated with the catalog name-set test as
  the reachability proof.
- `C-11` — honored: this design exists because the pipeline ran (story → review → design quick).
- `P-01/P-02` — honored: orchestrator wrote all artifacts; proposer/adversary never saw each
  other's raw output.
- `P-03` — honored: recon `## Not found` items carried as risks; no guessed symbols.
- `P-04` — honored with recorded user sign-off (context.md): explicit build instruction stands in
  for the per-gate prompt; no contested decision remained after synthesis.
- `P-06` — to honor at execute: red-before-green per tdd-gate.
- `F-04` — honored: all paths/symbols verified by discovery; nothing invented.
- `F-08` — to honor at execute: stage only step files.
- Floor status: **no breaches flagged** (adversary confirmed F-04 clean).
