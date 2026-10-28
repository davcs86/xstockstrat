# Design: fix-agent-client-deadlines

**Created**: 2026-10-22
**Rounds**: 3 (full; termination: approved. The operator approved at the gate after round 3, Floor clear, with three binding additions)
**Approved by**: user @ 2026-10-22 (design gate r3, recorded in context.md)
**Grounded in**: recon.md, plus the spec-ready branch revision of product-spec.md (FR-1..FR-6) and acceptance.feature (@AC-1..@AC-11)

---

## Chosen Approach

The fix uses fixed module constants passed as a per-call `timeout=` at every agent → backend unary call. It adds
deadline-aware error mapping at each tool's catch site and bounds the inbound `ValidateToken` call. There is no
channel change, no shared helper, and no config key.

### 1. Client deadlines (`services/xstockstrat-agent/app/client.py`)

- Add two module-level floats next to 247's `_CONFIG_READ_TIMEOUT_S`: `_RPC_TIMEOUT_S = 10.0` (FR-1) and
  `_LONG_RPC_TIMEOUT_S = 45.0` (FR-2). Read them at call time so tests can monkeypatch them. This follows the
  `_POLICY_READ_TIMEOUT_S` fixed-float precedent (recon.md:53-56, `app/tools.py:2371`).
- Pass `timeout=` on every unary call expression in **both** shapes: `await stub.X(` and
  `await stub_cls(channel).X(` (`client.py:1318`, `:1342`). There are 73 expressions (recon.md:26-28), including
  `RegisterOAuthClient` `:1355` and the `get_config` tool's `GetConfig` `:2043`.
- `_LONG_RPC_TIMEOUT_S` goes on exactly four calls: `RunBacktest` `:634`, `ScreenSymbols` `:746`,
  `RunFundamentalsScan` `:1712` and `TriggerBackfill` `:1949`. Every other call gets `_RPC_TIMEOUT_S`.
- These stay untouched:
  - `ListOpportunities` keeps `timeout=timeout` (`client.py:872`, recon.md:29-30, 227 contract).
  - 247's `get_config_value` site (`client.py:1751`, recon.md:15-16).
- The deadline lives on the call, not on the channel. AGENT-1 forbids a pooled channel, and `mtls.secure_channel`
  has no deadline option (recon.md:23-25, `app/mtls.py:37-43`; recon.md:57-60).
- **F-07 rationale (no hardcoded tunables).** These are fixed nesting invariants derived from the MCP client's 60 s
  request timeout (PLAT-13). They are not operator tunables. Two reasons:
  - A config key cannot bound the config read itself, which is circular (247).
  - No operator need to tune them has been shown.

  The product-spec Fix Scope records this resolution, and changing a value requires a spec amendment
  (recon.md:106-107).
- **C-03 / trace.** `client._metadata()` already carries the `x-user-id` / `x-access-scope` / `x-trace-id` trio on
  every call. Adding `timeout=` changes neither the channel setup nor the headers (210 @AC-2/@AC-5, recon.md:94).

### 2. Error mapping (`_grpc_error_message`, `app/tools.py:223-231`)

- Every catch site reachable by a deadlined call passes
  `deadline_s=client._RPC_TIMEOUT_S` or `client._LONG_RPC_TIMEOUT_S`. The existing `deadline_s` branch already
  yields "upstream did not respond within {N}s (deadline exceeded)". That satisfies FR-4 and @AC-1 ("within")
  (recon.md:39-41, :61-63, :140-143). The feature-227 contract binds only the `deadline_s=None` branch
  (`tests/test_tools.py:1985-1992`), so that branch's wording does not change.
- Add a keyword-only `write: bool = False`. With `write=True` and `DEADLINE_EXCEEDED`, the message is
  `upstream did not respond within {deadline_s:g}s (deadline exceeded); outcome unknown, verify before retrying`.
  A client-side deadline does not prove a write failed, so the text must never say "retry shortly" on a write (C-10).
- **Server-detail pass-through (owned here for feature 272; operator 2026-10-22 r2, widened at r3).** On
  `DEADLINE_EXCEEDED`, the mapper returns `exc.details()` whenever the details are non-empty and differ from grpc's
  client sentinel `"Deadline Exceeded"`, **regardless of `deadline_s`**.
  - The literal "`deadline_s is None` only" grant would be dead at every site this feature now passes `deadline_s`,
    including `run_backtest`. 272's server timeout would then be mislabelled "did not respond within 45s".
  - The operator signed off the widening at the r3 gate (binding addition (c)).
- **New wraps** use the existing idiom
  `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, ...)) from e` (`tools.py:2266-2267`).
  They cover the six tools that map nothing today (recon.md:133-139):
  - `list_signal_sources` `:486`
  - `_get_source` `:2324` (covers both `extract_email_content` and `extract_website_content`)
  - `ingest_signal`, **primary `client.ingest_signal(...)` only** (`:612-622`, `write=True`). The follow-ups at
    `:625-669` (config read, `EmitAlert`, watchlist auto-add) stay inside their existing `except Exception`
    blocks, preserving 127 @AC-4 (recon.md:144-147). The spec step text must state this boundary.
  - `emit_alert` `:700` (`write=True`)
  - `screen_symbols` `:847` (`deadline_s=_LONG_RPC_TIMEOUT_S`)
  - `_write_source_bearer` `:347` (`write=True`; covers `instantiate_template` `:1222` and
    `manage_signal_source` `:1309`)

  These wraps resolve `docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md`.
- **Write classification (C-18, simplified at r3).** At shared catch sites, `write` is derived from the verb:
  `write = operation not in <read-verb set>`, so any verb outside the read set counts as a write. The CI guard only
  checks that every catch site in a mutating tool passes `write=` explicitly. The table below is rationale, not test
  data.

  | Tool / verb | Verdict | Evidence / reason |
  |---|---|---|
  | `record_offline_order` → `PlaceOrder` | W | `client.py:2206`; a replay duplicates the order |
  | `instantiate_template` (+ `_write_source_bearer`) | W | `client.py:1324`, `tools.py:347`, `:1222-1226` |
  | `manage_watchlist` create | W | `client.py:384` |
  | `manage_account` register | W | creates an account row |
  | `manage_watchlist_symbols` assign | W | `client.py:554-555` |
  | `emit_alert` | W | a replay duplicates the alert |
  | `ingest_signal` primary | W | a replay duplicates the signal |
  | `trigger_backfill`, `run_fundamentals_scan` | W | long-budget, non-idempotent, the most likely to hit a deadline |
  | `manage_strategy` / `manage_formula` / `manage_signal_source` register | W | create rows |
  | `manage_user` create, `manage_offline_account` confirm/snapshot, `set_config` create_key | W | create or commit rows |
  | `manage_strategy` update, `set_strategy_live` | W | no path:line evidence that a replay has no version bump, ledger event or alert, so they default conservatively to W |
  | `manage_watchlist` update (replace-all `UpdateWatchlist`) | I | single transaction (`watchlist_repo.go:199-210`), so a cancel rolls back and a lost response is a safe replay |
  | all reads (`get_*`, `list_*`, `query_*`, `test_formula`, `screen_symbols`, `run_backtest`) | read | plain `deadline_s` text |

### 3. Inbound auth deadline (`app/auth.py`, `app/main.py`): FR-6 / @AC-11 (operator r3, additions (a) and (b))

- `ValidateToken` at `auth.py:39` and `:71` (recon.md:31-33, :152-154) gets `timeout=client._RPC_TIMEOUT_S` (10 s).
  This reuses the default constant. A dedicated 3 s value would need a measured ValidateToken p99, which nobody has.
- `validate_bearer_claims` returns a **three-way result**: claims, `None` (an invalid token), or a
  backend-unavailable sentinel for `DEADLINE_EXCEEDED` / `UNAVAILABLE`. It still never raises (`auth.py:58-61`).
  Log those two codes at WARN; today they log at INFO (`auth.py:83`).
- `_authorized` (`main.py:150-161`) maps the sentinel to **503 without `WWW-Authenticate`**. A genuinely invalid
  token still gets `_send_unauthorized`'s 401 with `WWW-Authenticate` (`main.py:164-174`). A brief identity slowdown
  therefore never forces the Claude.ai connector to re-authorize. That re-auth would itself go through the stalled
  identity, which amounts to a logout. This is the sanctioned CHANGE to the agent OAuth edge contract.
- **Trace (operator 2026-10-21 standing decision).**
  - `auth._metadata(trace_id)` carries `x-trace-id`. Today it returns `[]` (`auth.py:23-24`).
  - `_authorized` mints `_new_trace_id()` (`tools.py:173`) and stamps it into `claims["trace_id"]`.
    `CallerPropagationMiddleware` (`tools.py:199-214`) reuses that value, so the auth hop and the tool hop share the
    request's trace id (@AC-11).
  - `validate_bearer_jwt`'s signature changes only by the timeout. It has no production caller.
  - The spec greps the `_require_claims` / `_claims_from_context` consumers (`tools.py:99-187`) to confirm that none
    serialises the claims dict.

### 4. FR-3 worst cases (including the 10 s auth hop)

From recon.md:112-129, plus the auth term. Totals are what the MCP client sees.

| Tool | Worst path | Worst case | ≤ 57 s |
|---|---|---|---|
| `run_backtest`, `trigger_backfill`, `run_fundamentals_scan`, `screen_symbols` | auth 10 + one long call 45 | 55 s | yes |
| `ingest_signal` | auth 10 + IngestSignal 10 + policy GetConfig 3 (247) + EmitAlert 10 + EnsureSignalWatchlist 10 + AddWatchlistSymbols 10 | 53 s | yes |
| `manage_watchlist` update (unmasked), `manage_watchlist_symbols` assign, `instantiate_template` | auth 10 + 2 × 10 | 30 s | yes |
| every other single-call tool | auth 10 + 10 | 20 s | yes |
| `list_opportunities` (out of scope) | auth 10 + policy 3 + ListOpportunities up to its 55 s ceiling | 68 s | **accepted exception** (R4) |
| `extract_*` | auth 10 + 4 × policy read 3 + HTTP egress | backend part 22 s; HTTP part unbounded at the MCP level | **accepted exception** (R10) |

### 5. Tests (`services/xstockstrat-agent/tests/test_client_deadlines.py`)

- Reuse the hung-server harness: `tests/test_list_opportunities_deadline.py:17, :34, :48, :50, :60`, and the
  `conftest.py:51` autouse env (recon.md:64-70).
- **Budget values** are asserted with the exact `timeout` kwarg (247 §5(b) style). Hung-server runs prove only
  "bounded `DEADLINE_EXCEEDED`, no hang". Each uses patched constants and an absolute bound of budget + 0.5 s, not a
  relative ×1.05 slack.
- Scenario mapping:
  - @AC-1 `get_positions`; @AC-2 the `get_config` tool site `:2043`; @AC-3 `ingest_signal`.
  - @AC-4 slow `RunBacktest` succeeds; @AC-9 hung `RunBacktest` is bounded.
  - @AC-5 a parametrised table over the nine listed RPCs.
  - @AC-6 tool-hop scope: `run_backtest` at 45 s, plus the 10 s auth term covered by @AC-11.
  - @AC-7 happy path; @AC-8 `IngestSignal` returns 42 while config and notify hang.
  - @AC-10 the AST guard over both call shapes. It allow-lists `ListOpportunities` → `timeout` and 247 →
    `_CONFIG_READ_TIMEOUT_S`, and checks the LONG set in both directions. A separate value test pins 10.0 / 45.0.
  - @AC-11 an ASGI-level test that stalls identity's `ValidateToken`. It expects 503 with no `WWW-Authenticate`
    within the bound and the request's trace id on the ValidateToken metadata. An invalid-token case still expects
    401 with `WWW-Authenticate`.
- Red/green mapper tests (P-06) cover the `write` branch and the pass-through (server detail returned; the
  `"Deadline Exceeded"` sentinel not returned). They also check that the 227 `deadline_s=None` assertion still passes.
- 224 @AC-18/19: a deadline on `InstantiateTemplate` after `_write_source_bearer` is not reported as success.
- Extra guard: every catch site in a mutating tool passes `write=` explicitly.

### 6. Consumer surface (C-14) and docs

- **Consumer surface.** Every MCP agent tool that reaches a backend gets a bounded `DEADLINE_EXCEEDED`-derived tool
  error, and the MCP HTTP edge gets a bounded 503 on an identity stall. The happy path is unchanged (FR-5).
- Docs, all in the same PR:
  - `docs/runbooks/mcp-tools.md`: the deadline and write wording, and the 503-on-identity-stall behaviour.
  - `plugins/strat-lab/skills/backtest/SKILL.md`: the 45 s budget for `run_backtest` / `trigger_backfill` and the
    write text. The root CLAUDE.md same-PR rule applies.
  - Mark the 2026-10-19 missing-mapping SEV-3 report resolved by 273.
  - `docs/roadmap/features/merge-order.md`: rows "247 → 273" and "273 → 272". The 273 → 272 row carries the PLAT-13
    nesting note: 272's server bound must sit at or below about 40 s, under the agent's 45 s.
  - Context-forge teardown.

**Build order:** 247 merges → rebase onto the branch spec → constants and kwargs (`client.py`, `auth.py`) → mapper
`write` and pass-through (red/green) → catch-site `deadline_s` / `write` plus the six wraps → auth three-way result
and 503 → tests @AC-1..@AC-11 → docs.

## Rejected Alternatives

- **A shared `_unary` helper.** It would rework about 73 sites that features 215/240/241/245/249 also edit. Per-site
  kwargs are the low-rework choice, and the C-18 trade-off is recorded here.
- **A channel-level deadline or a pooled channel.** AGENT-1 forbids it, and `mtls.secure_channel` has no deadline
  option.
- **`agent.*` config keys for the budgets.** The spec Fix Scope fixes the budgets as constants, and a key cannot
  bound the config read itself.
- **`asyncio.wait_for(57)` in the middleware as the primary fix.** No gRPC deadline would reach the server, and it
  fails @AC-1/2/3/5/9/10.
- **Raising the long budget toward about 54 s.** FR-2 fixes 45 s.
- **Leaving catch sites on the generic `deadline_s=None` text.** It fails FR-4 / @AC-1 "within".
- **Rewording the `deadline_s=None` branch.** It breaks the 227 contract (`test_tools.py:1985-1992`).
- **`deadline_s` alone at write sites, with no `write` flag.** "Retry shortly" invites duplicate orders, backfills,
  emits, template copies and alerts (C-10).
- **An AST guard enforcing per-row W/I membership.** It turns a hand-kept classification into CI coupling for
  unrelated features. It is replaced by the verb-derived default plus the explicit-`write=` guard.
- **Relative (×1.05) elapsed-time assertions on scaled clocks.** They flake on CI jitter.
- **The literal None-only pass-through.** It is dead at every site that now passes `deadline_s`, including
  `run_backtest`.
- **A dedicated 3 s `_AUTH_RPC_TIMEOUT_S` with no measured ValidateToken p99.** It is tighter than FR-1's own
  10 s, and it turns brief identity slowness into fail-closed rejections.
- **Mapping an identity deadline to the existing 401 with `WWW-Authenticate`.** It invites a re-authorization
  against a stalled identity, which effectively logs the user out.
- **Pulling `auth.py` in under "Expected" without an amendment.** It repeats the agent-mcp-oauth scope-creep fail
  (`fails.md:485`) and leaves user-visible behaviour without an @AC (C-15). The operator chose the FR-6 / @AC-11
  amendment instead.
- **Grounding on the main-dev working-tree acceptance.feature (@AC-1..5).** It is a stale pre-review draft (P-03).

## Open Risks

- [ ] **R1:** The 45 s LONG budget cancels `RunBacktest` / `RunFundamentalsScan` runs that take 45-60 s. 198 @AC-8
  evidence may go unpersisted, and fundamentals emits may be partial. No p99 or handler-cancellation evidence exists
  yet. To be addressed at the spec step for the long-budget kwargs: measure or cite p99. If p99 is above 45 s,
  escalate for an FR-2 amendment rather than changing the number silently.
- [ ] **R2:** The 272 nesting is inverted today. `analysis.backtest.max_duration_seconds` is 300
  (`001_config_tables.up.sql:69`) and 120 in production (`002_config_environment.up.sql:71`), both above the agent's
  45 s. The pass-through therefore never fires until 272 sets a ceiling at or below about 40 s. To be addressed at
  the merge-order row and in 272's spec (PLAT-13 contract).
- [ ] **R3:** A `DEADLINE_EXCEEDED` after the server has committed is now reachable on write tools. The write text
  protects only where the verb-derived default classifies correctly. A mutating verb wrongly added to the read set
  would be mislabelled. To be addressed at the mapper step (read-set review) and by the explicit-`write=` guard.
- [ ] **R4:** `list_opportunities` is an accepted out-of-scope exception at 68 s. Follow-up: lower its SetConfig
  ceiling. To be addressed at the docs step (follow-up defect).
- [ ] **R5:** Identity pool pressure. Identity is a direct 2-connection pool, so a slow identity can produce bursts
  of fail-closed 503s. The 503 shape prevents a logout loop but not the rejections. To be addressed at the auth step
  (WARN logging) and by observation on dev.
- [ ] **R6:** The `ingest_signal` worst path (53 s with auth) reaches the deadline fallbacks silently: the
  `_agent_policy` default, the 0.6 threshold, and the skipped auto-alert and auto-add. None of them opens a security
  gate (insights.md:3695-3705). To be addressed at the `ingest_signal` wrap step, which must state this posture.
- [ ] **R7:** `ExecuteFormula` has a 10 s budget, but an operator can raise the indicators `sandbox.timeout_ms`, and
  no SetConfig upper bound was found (recon.md:155-158). A value of 10 s or more would truncate `test_formula` and
  needs an FR-2 amendment. To be addressed at the spec step: verify the `_clamp_override` ceiling.
- [ ] **R8:** Sequencing. @AC-10's allow-list depends on 247's `_CONFIG_READ_TIMEOUT_S`, so 247 merges before 273,
  and 272 depends on 273's mapper, so 273 merges before 272. To be addressed at the merge-order row.
- [ ] **R9:** Artifact drift. main-dev holds a stale draft spec, so later phases must read from
  `origin/feature/fix-agent-client-deadlines`. To be addressed at `/sdd-spec` boot.
- [ ] **R10:** The `extract_*` tools have no MCP-level cap. HTTP egress with more than two URLs can exceed 57 s.
  This is an accepted exception with a follow-up, to be addressed at the docs step (follow-up defect).
- [ ] **R11:** Hand edits across about 75 sites risk a mis-assigned constant or a missed `deadline_s` / `write`.
  Only the @AC-10 bidirectional guard and the catch-site guards protect against this. To be addressed at the test
  step.

## Constitution Rules Touched

- `C-01`: honored by grounding every claim on recon.md and the code, cited by path:line.
- `C-03`: honored. `client._metadata()` keeps the header trio on every call. ValidateToken now also carries the
  request's `x-trace-id` through `auth._metadata(trace_id)`, under the operator's 2026-10-21 no-waiver trace decision.
- `C-10`: honored by the `write=True` text "outcome unknown, verify before retrying" on non-idempotent writes.
- `C-11`: honored. Every design fork went to the operator gate: auth scope, 401 vs 503, the widened pass-through,
  and 272 ownership. The decisions are recorded in context.md.
- `C-14`: honored. The consumer surface is the MCP agent tools plus the MCP HTTP auth edge (§6).
- `C-15`: honored by the operator-approved FR-6 / @AC-11 amendment, so the auth behaviour has a scenario.
- `C-16`: honored. See Business Rules Touched.
- `C-18`: honored. Per-site kwargs were chosen over a helper and the trade-off is recorded. The write apparatus was
  reduced to a verb default plus one guard.
- `P-02` / `P-03`: honored by grounding on the spec-ready branch revision rather than the stale main-dev draft, and
  by amending the spec rather than widening scope silently.
- `P-06`: honored by red/green mapper and auth tests.
- `F-07`: honored. The values are fixed nesting-invariant constants per the product-spec Fix Scope, with the
  rationale given in §1. There is no Floor breach.
- `PLAT-13`: honored. Every in-scope tool is at or under 57 s, including the auth hop (§4), and the 272 nesting
  contract goes into the 273 → 272 merge-order row.
- `AGENT-1`: honored. There is no channel caching and no channel option. Deadlines go on the call.

## Business Rules Touched (C-16)

- EXTEND `@AC-2 @feature-227` "A hung analysis read fails fast at the agent instead of hanging"
  (`services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature`). New cases: 273 @AC-1..@AC-6 and
  @AC-8..@AC-10 extend the fail-fast guarantee to every other unary RPC. `ListOpportunities` is unchanged.
- EXTEND 273 @AC-11 (new, FR-6). An identity stall gives a bounded fail-closed 503 that shares the request's trace
  id. Signed off by operator @ 2026-10-22 (design gate r3, addition (a); context.md).
- CHANGE: the agent OAuth edge contract (`main.py:164-174`, 401 with `WWW-Authenticate` on any validation failure).
  It becomes 503 without `WWW-Authenticate` when identity returns `DEADLINE_EXCEEDED` / `UNAVAILABLE`. An invalid
  token still gets 401 with `WWW-Authenticate`. Signed off by operator @ 2026-10-22 (design gate r3, addition (b);
  context.md).
- EXTEND: the 272 server-side deadline message pass-through. The discriminator widens to
  `details != "Deadline Exceeded"`, regardless of `deadline_s`. 273 owns it for 272: operator @ 2026-10-22 r2
  (ownership, merge 273 before 272) and r3 (widening signed off, addition (c)); context.md.
- EXTEND `@AC-2 @FR-3 @feature-210`, `@AC-5 @FR-5 @feature-210` (`docs/sdd/business-rules/platform.feature`). The
  header trio is unchanged on outbound calls, and the trace id now also reaches ValidateToken. Covered by the
  operator's 2026-10-21 standing trace decision.
- PRESERVE 273 @AC-7. The happy path is unchanged (FR-5).
- PRESERVE `@AC-4 @FR-3 @feature-127` "A portfolio failure never fails the already-committed ingest". The new wrap
  encloses only the primary `IngestSignal` (`tools.py:612-622`), and the `:625-669` follow-ups stay best-effort.
- PRESERVE `@AC-1/@AC-2/@AC-3 @feature-127` (`platform.feature`) and `@AC-5 @FR-5 @feature-127`. The watchlist
  auto-add stays reachable and runs once, and the docstring and `mcp-tools.md` keep the side-effect mention.
- PRESERVE the 227 deadline-mapper contract (`tests/test_tools.py:1974-1992`). The `deadline_s=None` wording is
  unchanged.
- PRESERVE `@AC-18 @FR-9 @feature-224`, `@AC-19 @FR-9 @feature-224`. A deadline on `InstantiateTemplate` after
  `_write_source_bearer` is never reported as success, and a test asserts it.
- PRESERVE `@AC-25`, `@AC-32 @feature-224`. The template tool surface and the docs / skill parity (no `is_public` /
  `include_public`) are kept.
- PRESERVE `@AC-5 @FR-3 @feature-148` (`manage_watchlist` read-modify-write) and `@AC-1/2/3/4/6/7 @feature-148`.
  The merge logic is unchanged, and `PERMISSION_DENIED` / `FAILED_PRECONDITION` mapping sits alongside the deadline
  mapping.
- PRESERVE `@AC-11`, `@AC-12 @feature-170` (watchlist bindings set-assignment). There is no request or result
  change.
- PRESERVE `@AC-8 @feature-156`. `RunFundamentalsScan` scope forwarding and the `PERMISSION_DENIED` mapping are
  unchanged under 45 s.
- PRESERVE (at risk, R1) `@AC-8 @FR-7 @feature-198` "Agent run_backtest accepts a fundamental operand". The request
  and result shape are unchanged. The synthesis classed this as a CHANGE because a run longer than 45 s is now
  cancelled before its evidence persists. That is **not** operator-signed as a CHANGE, so the spec must show p99 is
  at or under 45 s, or escalate for an FR-2 amendment and a CHANGE sign-off (R1).
- PRESERVE `@AC-1/@AC-6 @feature-164`, `@AC-5/6/7/9/21 @feature-204`, `@AC-1/2/3/10 @feature-161`. Happy-path
  results, caps, pagination and rejection mapping are unchanged.

## Rounds

- **Round 1:** the low-rework per-site mechanism was established. A write-safe deadline text was raised. The round
  was grounded on the stale main-dev draft, which was later withdrawn.
- **Round 2:** regrounded on the spec-ready branch revision (FR-1..5, @AC-1..10). `deadline_s` is passed at every
  catch site, the FR-3 table now includes the auth term, and a write classification was added. At the r2 gate the
  operator steered another round and assigned the 272 pass-through to 273, with merge order 273 before 272.
- **Round 3:** the write apparatus was simplified (C-18), test-flake fixes were adopted, and the six new wraps were
  added. Three blocking items went to the operator: auth scope / status code / budget, the widened pass-through,
  and 272 nesting.
- **Termination:** approved at the r3 gate by the operator, with binding additions (a) FR-6 / @AC-11, (b) 503
  without `WWW-Authenticate` on an identity stall, and (c) the widened pass-through signed off. Floor clear.
