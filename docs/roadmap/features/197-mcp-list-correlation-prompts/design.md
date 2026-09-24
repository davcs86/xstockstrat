# Design: mcp-list-correlation-prompts

**Created**: 2026-09-19
**Rounds**: 2 (quick; termination: approved)
**Approved by**: user @ 2026-09-19
**Grounded in**: recon.md

---

## Chosen Approach

Deliver the correlation guidance through **three consumer-facing MCP channels**, ranked by how
reliably a *connected* agent sees them, backed by a **single canonical body** and kept honest by
one parity test. The runbook is demoted to a maintainer-only anti-drift copy (a wire-connected agent
cannot read `docs/runbooks/mcp-tools.md` — the round-2 user steer).

**Channel 1 — enriched tool docstrings (CONSUMER, primary).** Each of the five `@server.tool()`
docstrings (`app/tools.py:1892` `list_accounts`, `:1911` `get_positions`, `:1927`
`get_positions_by_account_id`, `:1213` `list_opportunities`, `:1199` `list_strategies`) gains one
appended `Correlation:` line carrying **only that tool's correct key set + its relevant non-join**,
using the real serialized field names (`preserving_proto_field_name=True`; `list_accounts` key is
`id`, recon.md:31,46). Auto-surfaced per-tool via `tools/list` (and, for free, the unauthenticated
`GET /api/tools` catalog `app/main.py:100`, which reads `t.description`). Exact lines:
- `list_accounts` → account's `id` joins `get_positions[].account_id` /
  `get_positions_by_account_id`; accounts carry no `symbol`/`strategy_id`. (keys: `account_id`)
- `get_positions` → `account_id` joins `list_accounts[].id`; `symbol` joins
  `list_opportunities[].symbol`; **positions carry NO `strategy_id`**. (keys: `account_id`+`symbol`)
- `get_positions_by_account_id` → identical `Correlation:` line to `get_positions`.
- `list_opportunities` → `symbol` joins `get_positions[].symbol`; `strategy_id` joins
  `list_strategies[].strategy_id`; **opportunities carry NO `account_id`**. (keys:
  `symbol`+`strategy_id`)
- `list_strategies` → each `strategy_id` joins `list_opportunities[].strategy_id`; **strategies
  carry NO `account_id`** and no position references a `strategy_id`. (keys: `strategy_id`)

**Channel 2 — server `instructions` (CONSUMER, auto on connect).** `create_server()`
(`app/main.py:63-66`) currently constructs `MCPServer("xstockstrat-agent")` with no instructions.
Add a short (~4-line) cross-tool summary as the `instructions=` arg. **SDK-verified** (not assumed —
fails.md:447 discipline): `MCPServer.__init__` accepts `instructions=`, and it plumbs through to
`_lowlevel_server.create_initialization_options().instructions`, i.e. it **is emitted in the MCP
`initialize` result** every client receives on connect — the only channel a fully-autonomous agent
gets without inspecting every tool or user-initiating a prompt. The string names all three keys +
both non-joins and points at the prompt; it does not restate every field-path pairing.

**Channel 3 — prompt `list_correlation_guide` (CONSUMER, discoverable; explicitly requested).** A
file-backed `@server.prompt()` (SDK-verified, recon.md:54-59) returning the body of a new
`app/prompts/list_correlation.md` read at a **module-relative** path
(`Path(__file__).parent / "prompts" / "list_correlation.md"`, never CWD-relative — stdio launches
from an arbitrary CWD, `app/main.py:69-72`). Registered by a new `register_prompts(server)` kept
**separate** from `register_tools` (so it never entangles with the `tools/call`
`CallerPropagationMiddleware`, agent `CLAUDE.md` § Role), wired as one line in `create_server`.
`prompts/list`+`prompts/get` are served by the same `session_manager.handle_request`
(`app/main.py:195`) already behind the OAuth `_authorized` gate (`app/main.py:130`) — no new
auth/transport code. The `.md` is the **single canonical full body** (all three join equations with
field paths + both non-joins + a short "positions → accounts → opportunities → strategies" stitch
example); channels 1 and 2 are deliberately shorter subsets pointing here. No user data, no secrets
(FR-5) — static guidance only.

**Channel 4 (not consumer) — parity/maintainer surfaces.** `docs/runbooks/mcp-tools.md` gains a
"Correlating list responses" section (a C-10 anti-drift copy, explicitly *not* a delivery vehicle);
`services/xstockstrat-agent/CLAUDE.md` + the `tools.py` module header get a one-line "a `prompts`
surface now exists; tool count unchanged at 49" note.

**Parity test (FR-6, mirrors `tests/test_backtest_view.py`, C-10 / RC-1).** Asserts, per surface with
the **correct per-tool key set** (never all three keys on all five tools — the round-1 correctness
fix): (a) `prompts/list` returns `list_correlation_guide` w/ non-empty description and `prompts/get`
text contains all three keys, both non-join sentences, and all three field-path pairings; (b) each
docstring names exactly its correct keys + its non-join; (c) the constructed server's `instructions`
is non-empty and names all three keys + both non-joins; (d) `mcp-tools.md` names all three keys +
both non-joins. Pins load-bearing token/pairing presence (not full prose) to stay non-brittle while
catching drift.

## Rejected Alternatives

- **Runbook as a consumer delivery vehicle** — rejected: a wire-connected agent cannot read repo
  docs; it can only be a maintainer parity copy (user steer, round 2).
- **Prompt-only or docstring-only delivery** — rejected: prompts are user-initiated in most MCP
  clients (an autonomous agent may never call `prompts/get`); docstrings alone force the agent to
  inspect all five tools to reconstruct the cross-tool graph. The three-channel mix covers both.
- **Drop the server `instructions` channel** (ship only docstrings+prompt+runbook) — offered at the
  gate, rejected by the user: it would leave the autonomous-agent gap open. Cost of including it is
  one string kwarg (C-18: least mechanism that makes the cross-tool graph auto-visible).
- **Per-tool prompt fan-out / a new join RPC or materialized-join view** — rejected as speculative
  (C-18 YAGNI, product-spec Out of Scope): one consolidated guide + existing responses suffice.
- **Single structured join-table generating all copies** (codegen) — rejected: over-engineered for a
  doc-only guide; the parity test spanning all surfaces makes drift structurally caught without a
  build step.
- **Lazy file read inside the prompt fn** — rejected: read-at-registration + the FR-6 `prompts/get`
  test surfaces a missing/renamed asset in CI; lazy read would stay silent until first `prompts/get`.
- **Fold `register_prompts` into `register_tools`** — rejected: would couple the prompts surface to
  the tools-only `CallerPropagationMiddleware` responsibility (SRP).

## Open Risks

- [ ] The parity test pins token/pairing *presence*, not full semantic fidelity — a future edit could
  keep the tokens while corrupting prose. Mitigated by asserting ordered field-path pairs (e.g. both
  `list_accounts[].id` and `get_positions[].account_id`) on the prompt body; residual, accepted for a
  doc-only guide. — addressed at the parity-test step (/sdd-spec).
- [ ] Read-at-registration couples all 49 tools' startup to the `.md` asset. Accepted because the
  Dockerfile ships `app/prompts/*.md` and the FR-6 `prompts/get` test guards presence in CI; revisit
  if that test is ever weakened. — noted at the register_prompts step.
- [ ] Teardown: `CLAUDE.md` + `tools.py` module header are context surfaces — context-forge refresh
  (or manual reconciliation + PR note if the plugin is unavailable) is **owed and blocking**, not
  note-and-proceed (fails.md:672-674). — addressed at the final teardown step.

## Constitution Rules Touched

- `C-10` — honored by: every describing surface (5 docstrings + server instructions + prompt body +
  runbook) updated in the same PR and bound by the FR-6 parity test; tool count stays 49 across all
  six inventory surfaces (a prompt is not a tool).
- `C-14` — honored by: the consumer surface is the Agent MCP surface (docstrings + instructions +
  prompt); `GET /api/tools` stays tools-only by design (prompts/instructions are discoverable via
  their native MCP methods; enriched docstrings still propagate to it), recorded in context.md.
- `C-16` — honored by: no tool arg/return shape changes, so existing agent `@AC-*` scenarios
  (opportunity/account/position tools) stay green (recon Existing Business Rules); net-new
  `@AC-1..8`.
- `C-18` — honored by: least mechanism (one string kwarg + one prompt + five docstring lines + docs);
  no new RPC/view/codegen; the one added channel (instructions) is justified against the user's
  stated autonomous-agent need, trade-off recorded here.
- `P-03`/`F-04` — honored by: every symbol/path cited from recon; the two SDK mechanisms
  (`@server.prompt`, `instructions=` in `initialize`) verified by running the installed mcp 2.0.0,
  not assumed.
- `F-11` — no Floor breach raised by the adversary in either round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-*` in `services/xstockstrat-agent/acceptance/opportunity-live-market-enrichment.feature`,
  `opportunity-compute-robustness.feature`, `agent-broker-account-tools.feature` — not regressed by:
  this feature changes no tool argument or return shape, only descriptions + additive prompts/
  instructions surfaces.
- Net-new acceptance behavior otherwise (`acceptance.feature` `@AC-1..8`); nothing to EXTEND/CHANGE.
