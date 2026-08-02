# Implementation Spec: remove-x-mcp-secret-header

**Status**: `pending`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/097-remove-x-mcp-secret-header/feature.md`
**Total Steps**: 5
**Feature Branch**: `claude/remove-x-mcp-secret-header-icog9j` (harness-assigned Development Branch for
this feature — see `feature.md`/`context.md` branch-deviation note; NOT
`feature/remove-x-mcp-secret-header`)

---

## Execution Summary

A pure subtraction across five steps, matching `design.md` § Chosen Approach. (1) Remove
`x-mcp-secret` emission from both `client.py`'s and `auth.py`'s byte-for-byte-duplicate
`_metadata()` helpers, together with the paired `test_client.py` assertion rewrites, **in the same
step** — all six assertions break simultaneously with the code change, so splitting code and test
into separate steps would leave Step 1's own commit failing verification (Floor **F-05**); this
mirrors the ledger's 2026-07-27 (072) insight of carrying the "green-making minimum" test
adaptation in the same commit as the change that breaks it. (2) Trim the now-pointless
`MCP_AGENT_SECRET` wiring from `xstockstrat-notify`/`xstockstrat-ingest`/`xstockstrat-analysis`'s
`docker-compose.yml` and `.do/app*.yaml` blocks (the agent's own block, and `.env.example`/
`scripts/setup-env.sh`, keep the var — still needed for OAuth `txn` signing), verified by an
**actually-executed** `docker compose up`/`ps` smoke check because no CI job boots the compose
stack. (3)–(5) reconcile every doc/CLAUDE.md that (mis)describes the header as sent or enforced,
split by audience — reference/constitution docs, operator setup docs, launch collateral — so each
diff stays auditable per file group.

**Consumer Surface**: `None — internal/platform-only`, per product-spec `## Consumer Surface(s)`
(no MCP tool name/parameter/return-shape change, no UI change) — this is a stated decision, not an
omission, so **C-14** requires no UI/Agent-tool step here.

## Step Dependencies

- No hard ordering dependency among Steps 1–5; sequenced agent-code → infra → docs, matching
  `recon.md` § Recommended Scope, for review clarity.
- Step 1 bundles its **C-08** paired test into the same step (not a separate Step 2) — see
  Execution Summary above for the F-05 rationale. This is a deliberate deviation from the default
  "place the test step immediately after" pattern, recorded here per the Constitution's
  no-silent-deviation principle (**P-03**).
- Watch for a rebase risk (not a logic conflict) between Step 2 and
  `084-droplet-compose-deploy` (`spec-ready`, not yet implemented), which also touches
  `.do/app.dev.yaml`'s `MCP_AGENT_SECRET` **provisioning mechanism** in the same file (084's
  product-spec scopes this to `.do/app.dev.yaml` only — `.do/app.yaml`/prod is explicitly Out of
  Scope for 084) — flagged in this feature's `context.md` from the product-spec review session. 084
  has not landed and its FR-5 secrets mechanism is still an open design question, so there is
  nothing concrete to reconcile today; re-check at merge time if 084 lands first (per the impl-spec
  review's overlap scan).

---

### Step 1 — service: Remove `x-mcp-secret` header emission from `xstockstrat-agent` (+ paired tests)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/auth.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` service owner — MCP tool contract stability (name, parameters,
return shape) and `docs/runbooks/mcp-tools.md` parity, no secret values in tool output; Security —
no secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key
scoping correct

**Codebase Evidence**:
- `_metadata()` in `client.py`: confirmed via `Read services/xstockstrat-agent/app/client.py:1-35`
  → env read `MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")` at `:22`; helper body at
  `:28-31`:
  ```python
  def _metadata() -> list[tuple[str, str]]:
      if MCP_AGENT_SECRET:
          return [("x-mcp-secret", MCP_AGENT_SECRET)]
      return []
  ```
  Module docstring claim at `:3`: `"All gRPC calls include x-mcp-secret metadata when MCP_AGENT_SECRET is set."`
- `_metadata()` in `auth.py`: confirmed via `Read services/xstockstrat-agent/app/auth.py` (full
  file, 89 lines) → byte-for-byte-identical helper at `:22-25`, env read at `:19`. Two call sites:
  `validate_bearer_jwt` (`:41`) and `validate_bearer_claims` (`:73`) — both pass
  `metadata=_metadata()` to `stub.ValidateToken`.
- `oauth_server.py` stays untouched: confirmed via `Read services/xstockstrat-agent/app/oauth_server.py:25-58`
  → separate env read `:33`, `_sign_txn` HMAC call `:42`, `_verify_txn` HMAC call `:52`. No
  `_metadata()` reference anywhere in this file — the one load-bearing consumer of
  `MCP_AGENT_SECRET` after this step.
- Three additional stale-comment/docstring hits inside `client.py` confirmed via
  `grep -n "x-mcp-secret" services/xstockstrat-agent/app/client.py`:
  - `:332` — `screen_symbols` docstring: `` Carries only ``x-mcp-secret`` — no admin ``x-access-scope``. ``
  - `:732` — OAuth-helpers comment block (`:730-733`): `` # inbound user context exists, so they carry only _metadata() (x-mcp-secret) — there is no `` / `` # x-user-id/x-access-scope to forward at the pre-token stage. ``
  - `:889` — `get_config_value` docstring bullet: `` ``None`` now means only "key genuinely absent". Sends ``x-mcp-secret`` via ``_metadata()``. ``
- `tests/test_client.py`: confirmed via `Read` (full file scan) + `grep -n "x-mcp-secret" services/xstockstrat-agent/tests/test_client.py` → exactly **6** assertion sites, each read in full context:
  - `:10-12` (`test_metadata_includes_mcp_secret`): `assert ("x-mcp-secret", "test-secret") in client._metadata()`
  - `:15-18` (`test_metadata_empty_when_no_secret`): already asserts `client._metadata() == []` — no `x-mcp-secret` literal present, **no change needed**.
  - `:101-105` (`TestManageStrategyClient.test_uses_analysis_endpoint_and_admin_scope`): `assert ("x-mcp-secret", "test-secret") in meta` at `:102`, followed by an unrelated `x-access-scope`/`authorization` assertion at `:104-105` that stays.
  - `:234-239` (screen_symbols test): comment `# Read-only: carries x-mcp-secret, never an admin x-access-scope.` at `:236`, assertion `assert ("x-mcp-secret", "test-secret") in meta` at `:238`.
  - `:384-388` (`test_trigger_sends_admin_scope_and_returns_envelope`): assertion at `:386`, unrelated `x-access-scope` assertion at `:387` stays.
  - `:490-494` (`get_backfill_status` test): assertion at `:493`, unrelated `x-access-scope` absence-assertion at `:494` stays.
  - `:654-659` (`test_scope_and_metadata_reach_the_request`, `get_config_value`): assertion at `:659`.
- `tests/conftest.py:56,67` fixture (`monkeypatch.setenv("MCP_AGENT_SECRET", "test-secret")` /
  `monkeypatch.setattr(client, "MCP_AGENT_SECRET", "test-secret")`) confirmed unchanged — reused
  as-is; still needed by the (deliberately retained) module-level env reads.
- `tests/test_auth.py` (full file, 45 lines) confirmed to never assert on `_metadata()`'s return
  value or on outbound metadata — only `validate_bearer_jwt`'s `aud`-checking behavior. **No
  changes required** in this file.

**TDD**: `red-green required`

**Instructions**:

1. In `services/xstockstrat-agent/tests/test_client.py`, apply the six test-assertion rewrites
   below **first**. Once applied, they describe the *target* behavior and must **fail** against the
   still-unmodified `client.py`/`auth.py` (the TDD red state — `_metadata()` still returns the
   `x-mcp-secret` tuple today):
   - `:10-12` — replace the whole function with a direct regression guard that `_metadata()` never
     attaches a header, even though the autouse `conftest.py` fixture sets `MCP_AGENT_SECRET`:
     ```python
     def test_metadata_never_includes_secret():
         """_metadata() never attaches a header — MCP_AGENT_SECRET is not forwarded (feature 097)."""
         assert client._metadata() == []
     ```
   - `:15-18` — leave unchanged.
   - `:102` — replace `assert ("x-mcp-secret", "test-secret") in meta` with
     `assert not any(k == "x-mcp-secret" for k, _ in meta)`. Leave `:103-105` unchanged.
   - `:236,238` — replace the comment at `:236` (`# Read-only: carries x-mcp-secret, never an admin
     x-access-scope.`) with `# Read-only: carries no security metadata (no shared secret, no admin
     x-access-scope).`; replace the assertion at `:238` the same way as `:102`. Leave `:239`
     unchanged.
   - `:386` — same replacement as `:102`. Leave `:387` unchanged.
   - `:493` — same replacement as `:102`. Leave `:494` unchanged.
   - `:659` — replace `assert ("x-mcp-secret", "test-secret") in mock_stub.GetConfig.call_args.kwargs["metadata"]`
     with `assert not any(k == "x-mcp-secret" for k, _ in mock_stub.GetConfig.call_args.kwargs["metadata"])`.
   - Run `cd services/xstockstrat-agent && uv run pytest tests/test_client.py -q` and confirm the
     six touched tests **fail** (red) — `_metadata()` in the unmodified `client.py` still returns
     the tuple.

2. In `services/xstockstrat-agent/app/client.py`:
   - `:3` — replace `"All gRPC calls include x-mcp-secret metadata when MCP_AGENT_SECRET is set."`
     with `"MCP_AGENT_SECRET is not sent on outbound calls (feature 097) — it signs the agent's
     stateless OAuth txn blob in app/oauth_server.py."`
   - `:28-31` — replace the `_metadata()` body:
     ```python
     def _metadata() -> list[tuple[str, str]]:
         return []
     ```
     Leave the `MCP_AGENT_SECRET = os.environ.get(...)` read at `:22` **in place** (deliberately —
     see `design.md` § Rejected Alternatives: deleting it would force editing `conftest.py`'s
     `monkeypatch.setattr(client, "MCP_AGENT_SECRET", ...)` fixture too, for a purely cosmetic gain;
     the leftover read costs nothing at runtime).
   - `:332` — replace `` Carries only ``x-mcp-secret`` — no admin ``x-access-scope``. `` with
     `` Read-only: carries no admin ``x-access-scope``. ``
   - `:730-733` — replace `` # inbound user context exists, so they carry only _metadata()
     (x-mcp-secret) — there is no `` / `` # x-user-id/x-access-scope to forward at the pre-token
     stage. `` with `` # inbound user context exists, so they carry only _metadata() (empty since
     feature 097) — there is no `` / `` # x-user-id/x-access-scope to forward at the pre-token
     stage. `` (keep the surrounding two comment lines at `:730-731` unchanged).
   - `:889` — delete the trailing sentence `` Sends ``x-mcp-secret`` via ``_metadata()``. `` from
     the docstring bullet, leaving `` ``None`` now means only "key genuinely absent". `` intact.

3. In `services/xstockstrat-agent/app/auth.py`, `:22-25` — apply the identical `_metadata()` edit
   as `client.py` step 2 above (`return []` unconditionally). Leave the `MCP_AGENT_SECRET =
   os.environ.get(...)` read at `:19` in place (same symmetric-orphan rationale — `design.md`
   Rejected Alternatives explicitly requires treating both files the same way, not just `client.py`).
   This single edit covers **both** call sites (`validate_bearer_jwt` at `:41`,
   `validate_bearer_claims` at `:73`) since both pass `metadata=_metadata()`.

4. Re-run the full suite — all tests, including the six rewritten in step 1, must now pass (green).

**Verification**:
```bash
# Green (after the code edits):
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .

# Hard-zero literal check (product-spec Acceptance Criterion 1a — no legitimate survivor is
# possible here once this step lands; per fails.md 2026-07-29 079, gate on symbols that cease to
# exist, not on a vocabulary count):
grep -rn "x-mcp-secret" services/xstockstrat-agent/app/
# must return zero hits
```

---

### Step 2 — config: Trim `MCP_AGENT_SECRET` from notify/ingest/analysis deployment wiring

**Status**: `done`
**Service**: `xstockstrat-notify`, `xstockstrat-ingest`, `xstockstrat-analysis` (env-wiring only —
no source-code change in any of the three; `xstockstrat-agent`'s own wiring is untouched)
**Files**:
- `docker-compose.yml` — modify
- `.do/app.yaml` — modify
- `.do/app.dev.yaml` — modify

**Reviewers**: Platform Lead — cross-service architecture, inter-service dependency graph
correctness, env var propagation across `docker-compose.yml` / `.do/app*.yaml`

**Codebase Evidence**:
- `docker-compose.yml` — confirmed via `Read`: single-line entries at `:215` (notify block, directly
  after `DB_POOL_MAX: "1"` at `:214`), `:323` (ingest block, directly after `DB_POOL_MAX: "2"` at
  `:322`), `:363` (analysis block, directly after `DB_POOL_MAX: "2"` at `:362`), and `:523` (agent
  block, directly after `MCP_HTTP_PORT: "9000"` at `:522` — **keep**). All four lines read
  identically: `MCP_AGENT_SECRET: ${MCP_AGENT_SECRET:-}`.
- `.do/app.yaml` — confirmed via `Read`: identical 3-line block at each site —
  ```yaml
      - key: MCP_AGENT_SECRET
        scope: RUN_TIME
        type: SECRET
  ```
  at `:217-219` (ingest, directly after `- key: SERVICE_NAME` / `value: ingest` at `:215-216`),
  `:261-263` (analysis, directly after `- key: SERVICE_NAME` / `value: analysis` at `:259-260`),
  `:402-404` (notify, directly after `- key: SERVICE_NAME` / `value: notify` at `:400-401`), and
  `:295-297` (agent, directly after `- key: MCP_HTTP_PORT` / `value: "9000"` at `:293-294` —
  **keep**).
- `.do/app.dev.yaml` — confirmed via `Read` at each site: byte-identical structure and **identical
  line numbers** to `.do/app.yaml` (`:217-219` ingest, `:261-263` analysis, `:295-297` agent — keep,
  `:402-404` notify).
- Confirmed via `recon.md` (four parallel `codebase-discovery` passes) that no source, handler, or
  test file in `xstockstrat-notify`/`xstockstrat-ingest`/`xstockstrat-analysis` reads
  `MCP_AGENT_SECRET` or checks `x-mcp-secret` anywhere — the var served no purpose in these three
  services' blocks even before this step.
- Confirmed via `grep -c` that no CI job in `.github/workflows/ci.yml` boots `docker-compose.yml`
  (zero `docker compose`/`docker-compose` references) — the smoke check below is the feature's real
  verification for this step, not "existing CI coverage" (rejected in `design.md` § Rejected
  Alternatives after this was independently verified).

**TDD**: `N/A (config — deployment env-var wiring only, no application code)`

**Instructions**:

1. In `docker-compose.yml`, delete the single line `MCP_AGENT_SECRET: ${MCP_AGENT_SECRET:-}` from
   exactly three service blocks: `xstockstrat-notify` (`:215`), `xstockstrat-ingest` (`:323`), and
   `xstockstrat-analysis` (`:363`). Leave the `xstockstrat-agent` block's identical line (`:523`)
   untouched.
2. In `.do/app.yaml`, delete the 3-line `- key: MCP_AGENT_SECRET` / `scope: RUN_TIME` / `type:
   SECRET` block from exactly three `envs:` blocks: `xstockstrat-ingest` (`:217-219`),
   `xstockstrat-analysis` (`:261-263`), and `xstockstrat-notify` (`:402-404`). Leave the
   `xstockstrat-agent` block's identical 3-line block (`:295-297`) untouched. (Disambiguate each
   occurrence by its preceding `- key: SERVICE_NAME` / `value: <name>` anchor — the 3-line
   `MCP_AGENT_SECRET` block itself is byte-identical at all four sites.)
3. Apply the identical edit to `.do/app.dev.yaml` (same three deletions at `:217-219`, `:261-263`,
   `:402-404`; same one block kept at `:295-297`).

**Verification**:
```bash
grep -n "MCP_AGENT_SECRET" docker-compose.yml
# expect exactly 1 hit — the xstockstrat-agent block

grep -n "MCP_AGENT_SECRET" .do/app.yaml
grep -n "MCP_AGENT_SECRET" .do/app.dev.yaml
# expect exactly 1 hit each — the xstockstrat-agent block's `- key: MCP_AGENT_SECRET` line

# Mandatory, actually-executed smoke check (product-spec Acceptance Criterion 4 — no CI job boots
# docker-compose.yml, so this command must actually run and its output must be captured/recorded
# in context.md as the step's verification evidence, not merely asserted):
docker compose up -d xstockstrat-notify xstockstrat-ingest xstockstrat-analysis xstockstrat-agent
docker compose ps
# confirm all four report healthy/running
```

---

### Step 3 — docs: Reconcile reference/constitution docs describing `x-mcp-secret`

**Status**: `done`
**Service**: `docs/runbooks/`, `CLAUDE.md` (root), `xstockstrat-agent`, `xstockstrat-notify`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/CLAUDE.md` — modify
- `CLAUDE.md` (repo root) — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify (comment only, no
  test logic)

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md` — confirmed via `Read` (full section) + a repo-wide
  `grep -rn "x-mcp-secret"` re-run at `/sdd-spec` time (this exhausts `design.md`'s Open Risk #1,
  which flagged the original three-hit enumeration as possibly non-exhaustive — it is exhaustive):
  - `:74-81` — the entire `### x-mcp-secret (downstream enforcement)` section (heading, sentence,
    the one-row table, and its closing sentence), preceded by a blank line at `:73` and followed by
    a blank line (`:82`) then the pre-existing `---` divider (`:83`).
  - `:241` (`emit_alert`): `` Sends `x-mcp-secret`, **no** admin `x-access-scope`: `EmitAlert`... ``
  - `:388` (`screen_symbols`): `` **Read-only** — sends `x-mcp-secret` and **no** admin `x-access-scope`. ``
  - `:707` (`get_backfill_status`): `` **Read-only** — sends `x-mcp-secret` only, no admin scope. ``
  - No other `x-mcp-secret` hits exist anywhere else in this file (confirmed by the repo-wide grep).
- `docs/runbooks/CLAUDE.md:17` — confirmed via `Read`: `` | `mcp-tools.md` | MCP tool reference —
  all twenty-two agent tools with parameter tables, return shapes, error cases, transport modes,
  and x-mcp-secret enforcement | Using or troubleshooting the agent MCP server | ``
- Root `CLAUDE.md:197` — confirmed via `grep -n "MCP_AGENT_SECRET" CLAUDE.md`: `` - `N8N_WEBHOOK_SECRET`
  was removed by feature 011 (`remove-n8n-references`). Do not reference it. The MCP agent uses
  `MCP_AGENT_SECRET` (sent as `x-mcp-secret` header on outbound calls to identify itself to platform
  services); the receiving services do not currently enforce it. ``
- `services/xstockstrat-agent/CLAUDE.md` — confirmed via `Read` (full file, 175 lines):
  - `:4` — constitution-pointer banner: `` ...caller-derived admin scope on management write tools,
    `MCP_AGENT_SECRET` triple-purpose, `aud`-bound JWT)... ``
  - `:19-20` — `` All outbound gRPC calls to platform services carry `x-mcp-secret` when
    `MCP_AGENT_SECRET` is set; every management **write** tool forwards the **real caller's
    derived** `x-access-scope`... ``
  - `:154` — env var table: `MCP_AGENT_SECRET=<shared secret>` (no annotation).
- `services/xstockstrat-agent/docs/context-constitution.md` — confirmed via `Read` (full file, 37
  lines):
  - `AGENT-4` row (`:18`) — cites stale evidence `` `app/client.py:24-27` `` (current `_metadata()`
    location is `:28-31`) and states the agent "forwards `x-mcp-secret` plus... `x-access-scope`".
  - `AGENT-6` row (`:20`) — `` `MCP_AGENT_SECRET` is **triple-purposed**: the outbound `x-mcp-secret`
    header *and* the HMAC key signing the stateless OAuth `txn` blob. `` with stale evidence
    `` `app/oauth_server.py:41,51`; `app/auth.py:43` `` (current HMAC call sites are
    `oauth_server.py:42,52`; `auth.py`'s only relevant line is `:22-25`, which no longer signs
    anything).
- `services/xstockstrat-notify/CLAUDE.md` — confirmed via `Read` (lines 30-53):
  - `:42` — `` ...at the RPC layer: the MCP agent sends only `x-mcp-secret` (no admin scope), and
    the analysis... ``
  - `:45` — `` An admin gate would break every caller; enforcing `x-mcp-secret` would invert the
    trust boundary (only the *external* agent sends it). ``
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:165-171` — confirmed via
  `Read`: explanatory comment block pinning the feature-092 "EmitAlert is ungated" contract,
  referencing `` the agent sends only `` / `` x-mcp-secret) `` across `:167-168`. Product-spec FR-5:
  this test "needs no behavior change — only comment/wording alignment."

**TDD**: `N/A (docs)`

**Instructions**:

1. `docs/runbooks/mcp-tools.md`:
   - Delete lines `:74-81` in full (the `### x-mcp-secret (downstream enforcement)` heading through
     the `Set MCP_AGENT_SECRET to the same value across all four services. Generate with openssl
     rand -hex 32.` sentence) **and** the blank line immediately after them, so `## Authentication`'s
     content ends directly at the pre-existing `---` divider with exactly one blank line before it
     — matching the file's spacing convention elsewhere.
   - `:241` — replace `` Sends `x-mcp-secret`, **no** admin `x-access-scope`: `` with `` Sends no
     security metadata (no shared secret, no admin `x-access-scope`): `` — keep the rest of the
     sentence (the internal-service-caller contract description) unchanged.
   - `:388` — replace `` sends `x-mcp-secret` and **no** admin `x-access-scope`. `` with `` sends no
     admin `x-access-scope` (and no other security metadata). ``
   - `:707` — replace `` sends `x-mcp-secret` only, no admin scope. `` with `` sends no admin scope
     (and no other security metadata). ``

2. `docs/runbooks/CLAUDE.md:17` — replace `` and x-mcp-secret enforcement `` with `` and OAuth 2.1
   edge auth `` (drop the x-mcp-secret clause; keep the rest of the row's wording).

3. Root `CLAUDE.md:197` — replace `` The MCP agent uses `MCP_AGENT_SECRET` (sent as `x-mcp-secret`
   header on outbound calls to identify itself to platform services); the receiving services do not
   currently enforce it. `` with a sentence describing the sole remaining purpose, e.g.: `` The MCP
   agent uses `MCP_AGENT_SECRET` solely to HMAC-sign its stateless OAuth `txn` blob
   (`app/oauth_server.py`) — it is not sent as an outbound header (removed by feature 097). ``

4. `services/xstockstrat-agent/CLAUDE.md`:
   - `:4` — replace `` `MCP_AGENT_SECRET` triple-purpose `` with `` `MCP_AGENT_SECRET`
     OAuth-signing-only `` (keep the banner's other listed invariants unchanged).
   - `:19-20` — replace `` All outbound gRPC calls to platform services carry `x-mcp-secret` when
     `MCP_AGENT_SECRET` is set; every management **write** tool forwards `` with `` Every management
     **write** tool forwards `` (drop the leading clause entirely — outbound calls no longer carry
     any shared-secret header; keep the rest of the sentence).
   - `:154` — annotate the env var table entry: `MCP_AGENT_SECRET=<shared secret>   # HMAC-signs the
     OAuth txn blob only — not sent as an outbound header`.

5. `services/xstockstrat-agent/docs/context-constitution.md`:
   - `AGENT-4` row (`:18`) — rewrite to drop the `x-mcp-secret`-forwarding claim, keep the
     `x-access-scope`-forwarding description, and correct the evidence citation from
     `` `app/client.py:24-27` `` to `` `app/client.py:28-31` ``. New rule text along the lines of:
     "The agent forwards `("x-access-scope", <caller's derived scope>)` on every management write
     tool's outbound gRPC — it does NOT forward `x-user-id`/`x-trace-id`, and (since feature 097) no
     shared-secret header either; `_metadata()` now unconditionally returns `[]`." Update the "Why"
     column to note receivers never enforced it, so nothing downstream depended on its removal.
   - `AGENT-6` row (`:20`) — rewrite from triple-purposed to **single-purpose** framing (per
     `design.md`, which supersedes `recon.md`'s "dual-purpose" draft language): "`MCP_AGENT_SECRET`
     is single-purposed (since feature 097): the HMAC key signing the stateless OAuth `txn` blob. It
     is no longer sent as an outbound `x-mcp-secret` header." Correct the evidence citation from
     `` `app/oauth_server.py:41,51`; `app/auth.py:43` `` to `` `app/oauth_server.py:42,52` `` —
     drop the `app/auth.py:43` citation entirely (that file's `_metadata()` no longer sends
     anything; its only remaining `MCP_AGENT_SECRET` reference is the now-dead env read at `:19`).

6. `services/xstockstrat-notify/CLAUDE.md`:
   - `:42` — replace `` the MCP agent sends only `x-mcp-secret` (no admin scope), and the
     analysis `` with `` the MCP agent sends no metadata at all (feature 097 removed its
     `x-mcp-secret` header), and the analysis `` (keep the rest of the sentence/paragraph
     describing the other unauthenticated callers unchanged).
   - `:45` — replace `` An admin gate would break every caller; enforcing `x-mcp-secret` would
     invert the trust boundary (only the *external* agent sends it). `` with `` An admin gate would
     break every caller — no caller (internal or the agent) sends any distinguishing header today,
     so there is nothing left to invert-enforce; the private-network-plus-OAuth-edge trust
     established by feature 092 is unaffected by feature 097's header removal. `` (keep the rest of
     the paragraph, the pinning-test reference, unchanged).

7. `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:167-168` — reword the
   comment only (no assertion/test-logic change): replace `` analysis loops send no metadata; the
   agent sends only `` / `` x-mcp-secret). This test PINS that contract `` with `` analysis loops
   send no metadata; the agent itself sends no distinguishing header since feature 097 removed
   `` / `` x-mcp-secret). This test PINS that contract `` (reflowed to fit the existing comment
   width).

**Verification**:
```bash
grep -rn "x-mcp-secret" docs/runbooks/mcp-tools.md docs/runbooks/CLAUDE.md CLAUDE.md \
  services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/docs/context-constitution.md \
  services/xstockstrat-notify/CLAUDE.md services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts
# expect zero hits across all seven files

grep -n "triple-purposed" services/xstockstrat-agent/docs/context-constitution.md
# expect zero hits (AGENT-6 now single-purpose)
```

---

### Step 4 — docs: Reconcile operator setup docs describing `x-mcp-secret`

**Status**: `pending`
**Service**: `docs/setup/`, repo-root setup scripts
**Files**:
- `.env.example` — modify
- `scripts/setup-env.sh` — modify
- `docs/setup/digitalocean.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `.env.example:37-41` — confirmed via `Read`:
  ```
  # ── MCP Agent Secret (xstockstrat-agent) ─────────────────────────────────
  # Shared secret sent as x-mcp-secret header on all downstream HTTP calls.
  # Set this to the same value configured in xstockstrat-ingest, xstockstrat-notify,
  # and xstockstrat-analysis. Leave empty to skip header enforcement.
  MCP_AGENT_SECRET=change-me-webhook-secret
  ```
- `scripts/setup-env.sh` — confirmed via `Read` (offsets 185-350):
  - `:194-200` (section intro `info` lines): `` Shared secret sent as x-mcp-secret header on all
    downstream HTTP calls from `` / `` xstockstrat-agent to xstockstrat-ingest, xstockstrat-notify,
    and xstockstrat-analysis. `` / `` Leave empty to disable header enforcement (OAuth 2.1 edge auth
    is unaffected). ``
  - `:202-227` (interactive prompt): choice-3 echo at `:209` (`` 3) Skip (leave empty — header
    enforcement disabled) ``), `warn` at `:221` (`` MCP_AGENT_SECRET left empty — x-mcp-secret
    header will not be sent. ``), `prompt_value` description at `:224-226` (`` Your MCP agent secret
    (must match value set in ingest, notify, and analysis). ``).
  - `:290-292` (written `.env` file header comment): `` # Shared secret sent as x-mcp-secret header
    to ingest, notify, and analysis. `` / `` # Leave empty to disable header enforcement. ``
  - `:341-344` (summary print): `` (MCP agent downstream auth) `` / `` (empty — header enforcement
    disabled) ``
  - All lines that write/read the variable's *value* (`generate_jwt_secret` calls at `:203,216`,
    the `echo "MCP_AGENT_SECRET=..." >>"$ENV_FILE"` lines at `:295-296`) are confirmed unrelated to
    the prose and stay unchanged.
- `docs/setup/digitalocean.md:331-349` — confirmed via `Read`:
  ```
  ### MCP agent secret
  Set on: `xstockstrat-agent`
  ...
  Set as `MCP_AGENT_SECRET` on both apps. The same value must be configured in
  `xstockstrat-ingest`, `xstockstrat-notify`, and `xstockstrat-analysis` once Step 12
  (x-mcp-secret enforcement) is deployed. Leave empty to skip header enforcement.

  ```bash
  doctl apps update $DO_DEV_APP_ID \
    --set-env MCP_AGENT_SECRET=<your-secret>

  doctl apps update $DO_PROD_APP_ID \
    --set-env MCP_AGENT_SECRET=<your-secret>
  ```
  ```
  The `doctl apps update` commands at `:344-348` are confirmed to target only the agent app in both
  environments (`$DO_DEV_APP_ID`/`$DO_PROD_APP_ID`) — never issued against notify/ingest/analysis in
  this doc, so they need no change.

**TDD**: `N/A (docs)`

**Instructions**:

1. `.env.example:38-40` — replace the three comment lines describing header-sending/enforcement
   with a description of the sole remaining purpose, e.g.:
   ```
   # ── MCP Agent Secret (xstockstrat-agent) ─────────────────────────────────
   # HMAC-signs the agent's stateless OAuth 2.1 txn blob (app/oauth_server.py). Not sent as an
   # outbound header to any other service.
   MCP_AGENT_SECRET=change-me-webhook-secret
   ```
   Keep `:37` (the section header comment) and `:41` (the var assignment itself) unchanged.

2. `scripts/setup-env.sh`:
   - `:197-199` — replace the three `info` lines with OAuth-signing-purpose wording, e.g.:
     ```bash
     info "HMAC-signs the agent's stateless OAuth 2.1 txn blob. Not sent as an outbound header to"
     info "any other service — xstockstrat-ingest, xstockstrat-notify, and xstockstrat-analysis no"
     info "longer read this variable."
     ```
   - `:209` — replace `` 3) Skip (leave empty — header enforcement disabled) `` with `` 3) Skip
     (leave empty — OAuth login will fail) ``.
   - `:221` — replace `` warn "MCP_AGENT_SECRET left empty — x-mcp-secret header will not be
     sent." `` with `` warn "MCP_AGENT_SECRET left empty — OAuth 2.1 login will not work." ``.
   - `:224-226` — replace the `prompt_value` description `` "Your MCP agent secret (must match value
     set in ingest, notify, and analysis)." `` with `` "Your MCP agent secret (used only to sign the
     agent's OAuth login transactions)." ``.
   - `:291-292` — replace the written `.env` comment `` # Shared secret sent as x-mcp-secret header
     to ingest, notify, and analysis. `` / `` # Leave empty to disable header enforcement. `` with
     `` # HMAC-signs the agent's stateless OAuth 2.1 txn blob. Not read by any other service. ``
   - `:342,344` — replace `` (MCP agent downstream auth) `` with `` (OAuth txn signing) `` and
     `` (empty — header enforcement disabled) `` with `` (empty — OAuth login will fail) ``.
   Keep every line that writes or reads the variable's value unchanged.

3. `docs/setup/digitalocean.md:339-341` — replace `` Set as `MCP_AGENT_SECRET` on both apps. The
   same value must be configured in `xstockstrat-ingest`, `xstockstrat-notify`, and
   `xstockstrat-analysis` once Step 12 (x-mcp-secret enforcement) is deployed. Leave empty to skip
   header enforcement. `` with: `` Set as `MCP_AGENT_SECRET` on both apps (dev and prod). It is
   required for the agent's OAuth 2.1 login flow (`app/oauth_server.py` HMAC-signs the `txn` blob
   with it) — `xstockstrat-ingest`, `xstockstrat-notify`, and `xstockstrat-analysis` do not read
   this variable. `` Leave `:343-349` (the `doctl apps update` commands) unchanged.

**Verification**:
```bash
grep -n "x-mcp-secret" .env.example scripts/setup-env.sh docs/setup/digitalocean.md
# expect zero hits

grep -n "MCP_AGENT_SECRET" .env.example scripts/setup-env.sh docs/setup/digitalocean.md
# expect non-zero hits in all three — the var itself is still documented/prompted/settable
# (product-spec Acceptance Criterion 3)

bash -n scripts/setup-env.sh
# shell syntax check — the doc-only prose edits must not break the script
```

---

### Step 5 — docs: Correct launch collateral and regenerate its PDF

**Status**: `pending`
**Service**: `docs/launch-pdfs/`
**Files**:
- `docs/launch-pdfs/product-features.md` — modify
- `docs/launch-pdfs/product-features.pdf` — regenerate (binary output of `scripts/build-launch-pdfs.py`)

**Reviewers**: none

**Codebase Evidence**:
- `docs/launch-pdfs/product-features.md:186` — confirmed via `Read`: `` The agent forwards an
  `x-mcp-secret` header on outbound calls (`MCP_AGENT_SECRET` env var) to identify itself. Platform
  services trust this header as "request originated from the AI agent surface." `` — a **live,
  current-tense trust claim** in launch/marketing collateral, found by the design-adversary in round
  1 (not in the original recon file list) and added to FR-4/product-spec scope; `docs/launch-pdfs/`
  is explicitly **not** exempt under Acceptance Criterion 1's historical-survivor allowance.
- `scripts/build-launch-pdfs.py` — confirmed via `Read` (full file): `main()` accepts target slugs
  as `sys.argv[1:]`; `product-features` is a valid target (`SRC / "product-features.md"` exists).
- Toolchain availability confirmed by execution in this session:
  `python3 -c "import markdown, weasyprint; print('OK', markdown.__version__,
  weasyprint.__version__)"` → `OK 3.10.3 69.0` — both packages import cleanly, so this step's PDF
  regeneration is a real, executable action, **not** a deferral (per `design.md` Open Risk #2, which
  flagged this as needing re-verification at execute time — verified here).

**TDD**: `N/A (docs)`

**Instructions**:

1. `docs/launch-pdfs/product-features.md:186` — replace `` The agent forwards an `x-mcp-secret`
   header on outbound calls (`MCP_AGENT_SECRET` env var) to identify itself. Platform services trust
   this header as "request originated from the AI agent surface." `` with a sentence describing the
   actual, current trust model, e.g.: `` The agent authenticates to Claude.ai via OAuth 2.1 (RFC
   8414/9728); its outbound calls to platform services carry no shared-secret header — internal RPCs
   trust the private network plus the agent's OAuth edge (see
   `docs/roadmap/features/092-fix-mcp-writepath-authz`). ``

2. Regenerate the PDF: `python3 scripts/build-launch-pdfs.py product-features`. If the toolchain is
   ever unavailable in a different execution environment, record that as an explicit, named
   deferral in `context.md` per product-spec FR-4 — never a silent skip. (Verified available in this
   session — see Codebase Evidence above, so this run is expected to succeed, not defer.)

**Verification**:
```bash
grep -n "x-mcp-secret" docs/launch-pdfs/product-features.md
# expect zero hits

python3 scripts/build-launch-pdfs.py product-features
# expect: [ok]   docs/launch-pdfs/product-features.pdf  (NN.N KB)

git status --short docs/launch-pdfs/product-features.pdf
# expect the file shows modified — regenerated bytes differ from the committed version

# Final AC-1(b) repo-wide sweep — every remaining hit reviewed by hand (product-spec Acceptance
# Criterion 1; fails.md 2026-07-29 079 lesson — never a blanket zero-hit gate):
grep -rln "x-mcp-secret" . --exclude-dir=.git --exclude-dir=node_modules
# every survivor must be inside docs/roadmap/features/*/, docs/roadmap/ledger/, or docs/reports/,
# in past-tense/removed-feature or proposed-and-rejected framing — no other survivor is acceptable
```

---

## Deviation Log

### Step 2 — smoke-check fallback

**Disposition**: CI-equivalent fallback (sequential-mode verification fallback, applied without
asking per `reference/sequential-mode.md` § Sequential-mode carve-outs — logged here as required).

Step 2's specced verification called for an actually-executed `docker compose up -d
xstockstrat-notify xstockstrat-ingest xstockstrat-analysis xstockstrat-agent && docker compose ps`
smoke check (no CI job boots the compose stack, so this was meant to be the feature's real
verification evidence). In this execution environment, the Docker **daemon** cannot start
(`service docker start` fails with `ulimit: error setting limit (Operation not permitted)` — a
sandbox privilege restriction, not a code defect; `docker` and `docker compose` CLIs are present
and functional, only `dockerd` is blocked).

Substituted a structural-equivalent check using `docker compose config` (a pure client-side
render/validate operation that needs no daemon): confirmed the merged compose file parses and
resolves cleanly, and confirmed programmatically (`docker compose config` piped through a Python
YAML check) that `xstockstrat-notify`/`xstockstrat-ingest`/`xstockstrat-analysis`'s rendered
`environment` blocks no longer contain `MCP_AGENT_SECRET` while `xstockstrat-agent`'s still does —
i.e., docker-compose's own config resolution proves the edit is structurally correct. Combined with
`recon.md`'s already-confirmed finding that none of the three services' source code reads
`MCP_AGENT_SECRET`/`x-mcp-secret` anywhere, this gives high confidence the services will boot
unaffected, though it does not prove a live container actually reaches a healthy state. The live
`docker compose up`/`ps` check remains the more complete verification and should be run in an
environment where the Docker daemon is available (e.g. by a human reviewer, or in a future CI job)
before this lands on `main`.

### Step 3 — Instructions/Verification self-inconsistency

**Disposition**: applied at execution time (in-scope wording fix, not a scope change).

Step 3's own suggested replacement wording for `AGENT-4`, `AGENT-6`,
`services/xstockstrat-notify/CLAUDE.md`, and the notify test comment (Instructions items 5 and 6-7)
included the literal string `x-mcp-secret` in past-tense "feature 097 removed x-mcp-secret"
framing — but the same step's `**Verification**` demands zero `x-mcp-secret` hits across those
exact files (correctly — none of them are in product-spec Acceptance Criterion 1's historical-
survivor exemption list, which covers only `docs/roadmap/features/*/`, `docs/roadmap/ledger/`, and
`docs/reports/`). This is a self-inconsistency in the Instructions vs. Verification I wrote at
`/sdd-spec` time, discovered only now. Resolved by rewording those four spots to preserve the exact
same meaning without the literal string (e.g. "the header" / "its shared-secret header" instead of
naming `x-mcp-secret`), then re-ran the step's own Verification — passes cleanly (zero hits).
