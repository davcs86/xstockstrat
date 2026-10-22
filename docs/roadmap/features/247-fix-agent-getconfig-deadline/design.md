# Design: fix-agent-getconfig-deadline

**Created**: 2026-10-20
**Rounds**: 2 (full; termination: approved — auto-approved under operator standing authorization 2026-10-20)
**Approved by**: orchestrator, under the operator's standing authorization (context.md, Operator decisions, 2026-10-20) @ 2026-10-20. Gate conditions met: rounds >= 2 in full mode, 0 Floor breaches, 0 blocking objections, 0 CHANGEs to existing `@AC` rules.
**Grounded in**: recon.md

---

## Chosen Approach

The adopted design is the round-2 proposal plus every fold-in from synthesis. The r2 adversary returned SOUND. Items marked [r2] are refinements that are binding on `/sdd-spec`.

### 1. Client: the only behaviour change (`services/xstockstrat-agent/app/client.py`)

**New constant.**
- Add a private module constant `_CONFIG_READ_TIMEOUT_S = 3.0` beside `CONFIG_ENDPOINT` (recon.md:27, `client.py:24`).
- Its comment is at most 2 lines and states the constraint only: "Fixed, not a config key: a config read cannot bound itself. Read at call time so tests can monkeypatch it."
- The shape follows `_POLICY_READ_TIMEOUT_S` (recon.md:58-61).

**The call.**
- In `get_config_value`, change the stub call (recon.md:25, `client.py:1751-1754`) to `stub.GetConfig(req, metadata=_metadata(), timeout=_CONFIG_READ_TIMEOUT_S)`.
- Read the constant in the function body. Never bind it as a default argument, which would freeze the value at import and break the monkeypatch seam (recon.md:58-61).
- The kwarg shape reuses `list_opportunities` (`client.py:853`, `:872`; recon.md:55-57).

**Left unchanged.** `mtls.secure_channel(CONFIG_ENDPOINT, "xstockstrat-config")` (`client.py:1749`) and `metadata=_metadata()` stay as they are. This preserves `@AC-5 @feature-210` (recon.md:104).

**[r2] The `except` block (`client.py:1755-1758`, recon.md:25, :62-64):**
- Make it `except grpc.aio.AioRpcError as e:`.
- Change the warning to log `e.code().name` along with namespace and key. Never log the value (FR-6).
- Keep the `raise`.
- `DEADLINE_EXCEEDED` is an `AioRpcError`, so `None` still means only "key absent" (recon.md:142; insights 093).
- The point is that a stall (`DEADLINE_EXCEEDED`) and config being down (`UNAVAILABLE`) become distinguishable.
- Do not import `tools._grpc_error_message` (`tools.py:223`, recon.md:45). `client` importing `tools` is an import cycle.

**Not added.**
- No `timeout=` kwarg on the helper (C-18). All four callers want the same D (recon.md:50-51, :139).
- `client.get_config` (`client.py:2034-2046`) is not touched (recon.md:46, :140).

### 2. Callers do not change

Each caller's existing `except Exception` already yields its FR-2 fallback, and no new catch encloses egress (ledger `fails.md:2814-2817`; recon.md:141):

| Caller | Location | Fallback |
|---|---|---|
| `_agent_policy` | `tools.py:2373-2377` (recon.md:32) | returns `default` |
| `ingest_signal` | `tools.py:627` / `:633` / `:635` (recon.md:38) | `alert_threshold` = 0.6 |
| DCR | `oauth_server.py:84` / `:87` and `:104` / `:107` (recon.md:41-43) | `reg_enabled = None` / `allowed_raw = None`, then 201 |

### 3. Feature-227 bound stays (`tools.py:1551-1557`, recon.md:44)

- The reason is to preserve `@AC-2 @feature-227` and its pinned test seam (`test_list_opportunities_deadline.py:53-56`, `:78-88`; recon.md:94-97, :131). The reason is not channel setup: the gRPC deadline already covers connect, handshake and the call.
- Rewrite the comment at `tools.py:2365-2366` (recon.md:33, :144) to: "Outer bound keeping list_opportunities inside the MCP client's 60 s budget; looked up at call time so tests can monkeypatch it."
- Do not alias the two 3.0 s constants.

### 4. Dispositions

**(a) Serial reads: option (a).**
- `_fetch_url` keeps its 4 serial reads, which cost 4×D. DCR costs 2×D (recon.md:132-136).
- [r2] **Known residual, `extract_email_content`.** It calls `_fetch_url` once per URL (`tools.py:541-543`, recon.md:36), so a stall costs N×4×D = 12 s per URL. At **N >= 5 URLs** the tool still runs past the MCP client's 60 s limit. That is the product-spec "Who is hit" symptom, still live above that threshold.
- [r2] Materialize the follow-up `agent-config-snapshot-read` as a defect report: `docs/reports/2026-10-2x-agent-config-snapshot-read-defect.md` plus its `.status` sidecar (C-14).
- The follow-up's remedy is one `GetConfig` snapshot per tool call (`config.proto:49` already returns the whole namespace; recon.md:48). It is not `asyncio.gather` (insights.md:2240-2244).

**(b) DCR — SECURITY POSTURE CHANGE.**
- Before this fix, a stalled config hung `/oauth/register`, so it failed closed by accident.
- After it, a stall of D or more registers the client anyway. Two controls are skipped: `registration_enabled=false` (`oauth_server.py:87-89`) and the operator allowlist (`:107-110`). Identity enforces only `https://` (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:385-388`).
- FR-2 and AC-4 (201) sanction this, so it is labelled here, not reversed.
- [r2] Materialize `agent-dcr-fail-closed` as a `docs/reports/` defect report plus `.status` sidecar. Whether to return 503 on a read failure is that report's decision.
- [r2] Correct the false comment at `oauth_server.py:102` ("identity enforces the same allowlist / https rule server-side") in this diff, to: "Pre-check only: identity enforces https:// alone, not this allowlist."
  - This is a justified How-to-Act #3 exception: a false security invariant on a path this feature widens violates How-to-Act #5.
  - It is a one-line comment edit with no behaviour change. `@AC-9 @feature-147` txn signing is untouched (recon.md:106).
  - Also log it in the agent `docs/context-constitution-findings.md` as found-and-fixed.

**(c) `client.get_config` is excluded.**
- It is a caller with a different shape: an operator-supplied namespace and `user_id`, and it surfaces its error (recon.md:140; ledger `fails.md:2936-2951`).
- The follow-up `agent-rpc-deadlines` covers `client.get_config` and `register_oauth_client` (recon.md:46-47).
- [r2] Materialize it as a defect report plus `.status` sidecar, consistent with C-14. All three follow-up reports may land in one docs commit.

**(d) `@AC-8 @feature-207` disclosure.**
- During a stall, operator-lowered `agent.extract.*` limits revert to the defaults 5 / 5_000_000 / 10.0 / 30.0 (recon.md:34, :98-100). This is the same failure class as the existing `UNAVAILABLE` path (`tools.py:2375`).
- D never appears as a literal in `_fetch_url`.

**(e) [r2] Sizing D.**
- Agent channels are ephemeral per call, so D also covers DNS, TCP, the mTLS handshake and the RPC.
- The repo has no healthy-latency baseline for `GetConfig` (recon.md:137, :162).
- Add one dev smoke-test step that captures the agent→config `GetConfig` round-trip latency, from the OTel span duration or the warning timing, so D is validated against real data before promotion.

### 5. Tests, RED before GREEN

**(a) Harness: `hung_config_server` in `services/xstockstrat-agent/tests/conftest.py`** (C-13; recon.md:85-88, :159)
- **Server.** A threaded `grpc.server(ThreadPoolExecutor(max_workers=8))` serving `config_pb2_grpc.ConfigServiceServicer.GetConfig`, bound to `127.0.0.1:0`.
- **Modes.** Two: hang, or answer after a delay.
- **Hang handler.** Loops `while context.is_active(): stop.wait(0.05)`, so a cancelled call frees its worker.
- **[r2] Call counter.** `entered` is guarded by a `threading.Lock`, because worker threads increment it.
- **[r2] Teardown.** `stop.set()`, then `server.stop(0).wait()`.
- **Redirect.** `monkeypatch.setattr(client, "CONFIG_ENDPOINT", f"127.0.0.1:{port}")` and `monkeypatch.setattr(client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep))` (recon.md:68).
- **[r2] Recorded divergence.** This is a sync threaded server, not the `grpc.aio` shape at `tests/test_list_opportunities_deadline.py:26-40` (recon.md:65-70). `TestClient` runs its own event loop in a portal thread, which a pytest-loop-bound `grpc.aio.server` cannot serve. Do not migrate the 227 or analysis harnesses (How-to-Act #3).
- **Exact `entered` counts:**

| AC | `entered` |
|---|---|
| AC-1 | 1 |
| AC-2 | 4 |
| AC-3 | 1 |
| AC-4 | 2 |

**(b) Client level, `tests/test_client.py`**
- **AC-1** runs at the production D = 3.0 s. It expects `DEADLINE_EXCEEDED` within D + 0.5 s, wrapped in an outer `asyncio.wait_for` with `_HANG_GUARD_S = 10` (recon.md:69).
- **AC-5:** a delayed answer at 0.5 s returns `"0.8"`.
- **P-06 wiring proof**, in `TestGetConfigValueClient` (`tests/test_client.py:803`, recon.md:71-76): assert `GetConfig.call_args.kwargs["timeout"] == client._CONFIG_READ_TIMEOUT_S` and `client._CONFIG_READ_TIMEOUT_S == 3.0`. Existing `args[0]` / `kwargs["metadata"]` assertions (`:844-850`) survive.
- **`DEADLINE_EXCEEDED` propagation test**, modelled on `UNAVAILABLE` (`:866`). [r2] It also asserts that the warning record contains "DEADLINE_EXCEEDED" and does not contain the value.

**(c) Tool and endpoint level, with D patched to 0.3 s**
- **AC-2, `extract_website_content`:**
  - respx serves the page instantly (`tests/test_tools.py:244`), and `_website_source` (`:2002`) supplies the source.
  - Bound: 4×D + 1 s.
  - A spy on `egress.build_pinned_client` proves the SSRF gate ran with the defaults.
- **AC-3, `ingest_signal`** (ingest and notify mocked; model `tests/test_tools.py:444`, `:370`): D + 1 s, and exactly one "signal" alert at the default 0.6.
- **AC-4, `TestClient(build_http_app())`** (`tests/test_oauth.py:17-19`; model `:172`; identity mocked at `client.register_oauth_client`, `:182`): 201 within 2×D + 1 s.
- **[r2] C-10, the second `_fetch_url` caller.** Add one stalled-config `extract_email_content(urls=[one public URL])` test asserting `entered == 4` and a bound of 4×D + 1 s. Fallback, only if `/sdd-spec` finds it impractical: record that AC-2's `_fetch_url` coverage is accepted as proof for both callers.
- **No test asserts which 3 s timer fires first** in `list_opportunities` (recon.md:127-131).

### 6. Docs, then teardown

Update:
- `services/xstockstrat-agent/CLAUDE.md:205`: add a `_CONFIG_READ_TIMEOUT_S` row next to `_POLICY_READ_TIMEOUT_S`.
- Agent `docs/context-constitution-findings.md:28`: resolve it, and add the `oauth_server.py:102` found-and-fixed entry.
- Agent `docs/context-constitution.md:40`.
- Root `docs/context-constitution-findings.md:33` and `:64`.
- The three materialized follow-up reports.

Then run `/context-forge:context-constitution refresh` scoped to what was touched, or do the manual reconciliation and record it in the PR body (recon.md:145-150).

### Build order

1. Harness + RED tests.
2. Client constant, kwarg and status-code log.
3. The `tools.py:2365-2366` comment and the `oauth_server.py:102` comment.
4. Follow-up reports and docs.
5. Teardown.

### Scope

- **Not changed:** no proto (`config.proto:23`), no migration, no config key (recon.md:115-123).
- **Service:** only xstockstrat-agent changes.
- **Consumer surfaces:**
  - The Agent tools `extract_website_content`, `extract_email_content` (bounded at N×4×D; residual N >= 5) and `ingest_signal` now return within a bound during a config stall.
  - The `/oauth/register` endpoint does too.
  - `list_opportunities` keeps its 58 s worst case.

### Anchor drift

`/sdd-spec` re-derives anchors from `origin/feature/fix-agent-getconfig-deadline`:
- `register` is at `oauth_server.py:72` (recon.md:23 cites :70).
- main-dev shifts `tools.py` by +4 from about L2100 onward (recon.md:151-153).

## Rejected Alternatives

- **Deadline at each of the four call sites.** Rejected: four edits instead of one, and D would appear as a literal in `_fetch_url`, which violates `@AC-8 @feature-207`.
- **D as a config key.** Rejected as circular: a config read cannot bound itself. It is a fixed invariant (F-07, product-spec Fix Scope).
- **A per-call `timeout=` kwarg on `get_config_value`.** Rejected as YAGNI (C-18): all four callers want the same D, and the one differing caller (`get_config`) is excluded.
- **`asyncio.wait_for` around the stub call instead of `timeout=`.** Rejected on three counts:
  - it raises `TimeoutError`, not `AioRpcError`, which breaks the feature-093 contract;
  - it sends no `grpc-timeout` to the server;
  - it skips the client log.
- **Removing the 227 `wait_for`.** Rejected: it is a C-16 CHANGE to `@AC-2 @feature-227` with no operator decision covering it. It also breaks the pinned tests (`test_list_opportunities_deadline.py:78-88`) and drops the guard against a future increase to D.
- **Aliasing `tools._POLICY_READ_TIMEOUT_S` to `client._CONFIG_READ_TIMEOUT_S`.** Rejected: it couples two test seams that do different jobs, the outer tool bound and the RPC deadline.
- **`asyncio.gather` over `_fetch_url`'s four reads.** Rejected: it layers concurrency on four duplicate RPCs and handshakes, the anti-pattern in insights.md:2240-2244.
- **Fail-fast in `_fetch_url`** (use the defaults after the first `DEADLINE_EXCEEDED`). Rejected:
  - it changes the callers;
  - it overlaps the snapshot follow-up;
  - email stays unbounded for large N.
- **A single snapshot read per tool call, in this feature.** It is the right remedy, but it adds a client helper, changes the AC-2 bound, and is Out of Scope (performance). Deferred to `agent-config-snapshot-read`.
- **Adding a deadline to `client.get_config` too.** Rejected: it is a caller with a different shape that surfaces its error (fails.md:2936-2951), and it is Out of Scope. Deferred to `agent-rpc-deadlines`.
- **Fail-closed DCR (503 on a config read failure).** Rejected: it contradicts FR-2 and AC-4 (201). Deferred to `agent-dcr-fail-closed`.
- **Leaving the false comment at `oauth_server.py:102` and logging it in the findings only.** Rejected: it leaves a false security invariant on a widened path, and a one-line correction is cheaper and honest.
- **Reusing `tools._grpc_error_message` for the client warning.** Rejected: client.py would import tools.py, which is an import cycle. `e.code().name` is enough.
- **A `grpc.aio.server` harness bound to the pytest loop.** Rejected: the `TestClient` portal loop used by AC-4 cannot service it.
- **An `httpx.ASGITransport` async client for AC-4.** Rejected: it skips the ASGI lifespan, so it does not exercise the production startup path.
- **AC-1 at a patched D.** Rejected: the unit pin proves the kwarg is passed, but not the end-to-end expiry at the production value.

## Open Risks

- [ ] **`extract_email_content` stays over the MCP 60 s limit during a stall when N >= 5 URLs.** The cost is N×4×D, i.e. 12 s per URL, and no AC covers it. To be addressed by the materialized `agent-config-snapshot-read` report, written at the docs step.
- [ ] **DCR fails open on every config stall of D or more.**
  - `registration_enabled=false` and the allowlist are bypassed.
  - Any `https` redirect URI registers (`identityServiceImpl.ts:385-388`).
  - FR-2 sanctions this.
  - To be addressed by the materialized `agent-dcr-fail-closed` report (docs step) and the `oauth_server.py:102` comment correction (service step).
- [ ] **D = 3.0 s is not sized against a measured healthy `GetConfig` p99**, and it must cover per-call DNS, TCP and the mTLS handshake. A slow but healthy config falls back with only a warning:
  - `ingest_signal` alerts at 0.6;
  - the `extract_*` tools get looser egress defaults;
  - DCR fails open.

  To be addressed at the docs/smoke step: the status-code log plus a dev `GetConfig` latency capture before promotion.
- [ ] **`client.get_config` (`client.py:2034-2046`) and `register_oauth_client` still hang on a config or identity stall.** This is a deliberate exclusion. To be addressed by the materialized `agent-rpc-deadlines` report, written at the docs step.
- [ ] **At D = 3.0 s, the RPC deadline and the 227 outer `wait_for` (3.0 s) race.** The outcome is identical but the log line differs, so any test pinning which timer fires will flake. To be addressed in the test step: no such assertion.
- [ ] **The threaded harness can leak workers or the port, or pass vacuously**, unless all four of these are implemented: the `is_active()` loop, `max_workers=8`, the lock-guarded `entered` count, and `stop(0).wait()`. To be addressed in the harness step.
- [ ] **Timing bounds at D = 0.3 s can flake on loaded CI runners** (D + 1 s, 2×D + 1 s, 4×D + 1 s). AC-1 at the real D also adds about 3 s to the suite. To be addressed in the test step; watch CI.

## Constitution Rules Touched

- `C-01` (grounded anchors) — honored by:
  - re-verifying `client.py:1749-1758`, `tools.py:541-543`, `:1551-1557`, `:2365-2377` and `oauth_server.py:102-110` on the branch;
  - recording the residual drift (`register` at :72; main-dev `tools.py` +4) for `/sdd-spec` to re-derive.
- `C-10` (duplicated path) — honored by:
  - recording the excluded `get_config` path, with a materialized follow-up;
  - a stalled-config test on the second `_fetch_url` caller, `extract_email_content` (or the recorded fallback).
- `C-11` (design gate) — honored by: 2 full-mode rounds, 0 blocking objections, 0 Floor breaches, and auto-approval under the operator's standing authorization.
- `C-13` (fixture homes) — honored by: `hung_config_server` lives in `tests/conftest.py`, with its divergence from the `grpc.aio` harness recorded.
- `C-14` (scope honesty) — honored by:
  - stating explicitly the `extract_email_content` N >= 5 residual and the DCR security-posture change;
  - pointing every deferral at a materialized `docs/reports/` artifact.
- `C-15` (acceptance traceability) — honored by:
  - mapping AC-1..AC-5 to RED-before-GREEN tests;
  - running AC-1 at the production D.
- `C-16` (durable business rules) — honored by: PRESERVE for `@AC-2 @feature-227`, `@AC-8 @feature-207` and `@AC-5 @feature-210`, and EXTEND for the new 247 ACs. There are no CHANGEs.
- `C-18` (minimalism) — honored by:
  - the change is one constant, one kwarg, and the status code added to the log line already being edited;
  - there is no per-call timeout parameter;
  - the two-constant DRY trade-off is accepted.
- `F-07` (no hardcoded config) — honored by: D is a fixed invariant that cannot be a config key (circular read), and it is not a literal in `_fetch_url`.
- `P-02` (mediator) — honored by: only the synthesized state was forwarded between proposer and adversary.
- `P-06` (production wiring proof) — honored by: the `call_args.kwargs["timeout"]` pin, the `== 3.0` pin, and the end-to-end AC-1 at 3.0 s.
- How-to-Act #3 (surgical diff) — honored by:
  - limiting the `oauth_server.py` edit to correcting one false comment on the widened path;
  - not migrating the 227 or analysis harnesses.
- How-to-Act #5 (comments state constraints) — honored by: the new constant comment, the rewritten `tools.py:2365-2366` comment and the corrected `oauth_server.py:102` comment all state true constraints only.
- PLAT-N1 / Teardown — honored by: listing the docs touchpoints, and running `/context-forge:context-constitution refresh` (or a manual reconciliation recorded in the PR) before push.

## Business Rules Touched (C-16)

- PRESERVE `@AC-2` "A hung analysis read fails fast at the agent instead of hanging" (`services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature:12`, `@feature-227`).
  - Not regressed, because the 227 `wait_for` and `_POLICY_READ_TIMEOUT_S` are retained.
  - The bound is min(D, 3.0) + 55 s = 58 s, and the pinned tests are unchanged.
- PRESERVE `@AC-8` "The egress policy is sourced from config, not hardcoded literals" (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature:59`, `@feature-207`).
  - Not regressed: a healthy config still drives the `agent.extract.*` limits, and D is not a literal in `_fetch_url`.
  - A stall falls back to the documented defaults, the same class as the existing `UNAVAILABLE` path. The adversary confirmed PRESERVE, not CHANGE.
- PRESERVE `@AC-5` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature:238`, `@feature-210`). Not regressed: `mtls.secure_channel` and `metadata=_metadata()` are kept on `GetConfig`.
- PRESERVE, per recon.md:101-106: `@AC-6` / `@AC-1..5,7 @feature-207`, `@AC-4` / `@AC-5 @feature-127` and `@AC-9 @feature-147`.
  - Not regressed: no new catch encloses egress.
  - The `ingest_signal` post-commit tail still never propagates.
  - The `oauth_server.py` edit is comment-only and away from txn signing.
- EXTEND `@AC-1 @FR-1 @feature-247` (new) — `get_config_value` raises `DEADLINE_EXCEEDED` within D + 0.5 s on a stalled config. Promoted to the agent durable suite at launch.
- EXTEND `@AC-2 @FR-2 @feature-247` (new) — `extract_website_content` returns within 4×D + 1 s on a stall, using the default egress limits.
- EXTEND `@AC-3 @FR-2 @feature-247` (new) — `ingest_signal` alerts against the default 0.6 within D + 1 s on a stall.
- EXTEND `@AC-4 @FR-2 @feature-247` (new) — `/oauth/register` returns 201 within 2×D + 1 s on a stall.
- EXTEND `@AC-5 @FR-3 @feature-247` (new) — a healthy config read answering within D is unchanged.
- CHANGE: none. No operator decision is required; the standing authorization (context.md, 2026-10-20) covers the gate itself.

## Rounds

2 rounds (full mode; the operator overrode the triage `quick` recommendation).

- **Round 1.** The proposer put the deadline in the helper. The adversary raised the 227 `wait_for` rationale, harness specifics, the P-06 pins, the `get_config` exclusion, the `@AC-8` stall disclosure and the serial-read disposition. All were folded in.
- **Round 2.** The proposer closed the round-1 items, and the adversary returned **SOUND** with 6 non-blocking refinements, all folded in above as [r2]:
  - materialized follow-ups plus the N >= 5 threshold;
  - the status code in the client warning;
  - the DCR posture label plus the `oauth_server.py:102` comment fix;
  - harness lock and teardown, plus the recorded divergence;
  - the `extract_email_content` test;
  - the D-sizing smoke step.

Termination: auto-approved under the operator's standing authorization on 2026-10-20 (rounds >= 2, no Floor breach, no blocking objection, no uncovered CHANGE).
