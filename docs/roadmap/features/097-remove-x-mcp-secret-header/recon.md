# Recon: remove-x-mcp-secret-header

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: `xstockstrat-agent`, `xstockstrat-notify`, `xstockstrat-ingest`, `xstockstrat-analysis`

---

## Objective

Remove the `x-mcp-secret` gRPC metadata header that `xstockstrat-agent` attaches to every outbound
call — no receiving service enforces it, so it is dead code with a false-implied security
guarantee. Preserve `MCP_AGENT_SECRET` itself, which independently signs the agent's stateless
OAuth `txn` blob. Correct every doc/CLAUDE.md that misdescribes the header as sent or enforced.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - Header helper #1: `services/xstockstrat-agent/app/client.py:28-31` (`_metadata()`), env read at `:22`, module docstring claim at `:3`
  - Header helper #2 (byte-for-byte duplicate): `services/xstockstrat-agent/app/auth.py:22-25` (`_metadata()`), env read at `:19`
  - `_metadata()` call sites in `client.py`: 30 sites — `:120,185,224,279,371,451,476,491,527,550,598,620,627,645,662,714,746,758,779,795,821,839,859,901,985,1013,1042,1090,1118,1184` (six of these fold it into `[*_metadata(), ("x-access-scope", ...)]` for management write tools: `:451,550,714,859,985,1184`). Two non-call mentions: comment `:732`, docstring `:889`.
  - `_metadata()` call sites in `auth.py`: `validate_bearer_jwt` at `:41`, `validate_bearer_claims` at `:73` (recon's first pass found only the former — `auth.py` actually has **two** call sites; second confirmed via source read).
  - Separate, untouchable use of the same env var: `services/xstockstrat-agent/app/oauth_server.py` — env read `:33`, `_sign_txn` HMAC at `:36-43` (HMAC call `:42`), `_verify_txn` HMAC at `:46-58` (HMAC call `:52`). No `_metadata()` call anywhere in this file.
  - Config-read pattern (unrelated to this feature, for orientation): `app/main.py` one-shot `GetConfig` per `services/xstockstrat-agent/CLAUDE.md` § Config Keys Consumed.
- **`xstockstrat-notify`** (Node.js)
  - No source/handler references `MCP_AGENT_SECRET`/`x-mcp-secret` anywhere (confirmed zero via recursive grep).
  - Test comment only: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:165-171` — explanatory comment pinning the feature-092 "EmitAlert is ungated" contract; the test itself asserts no scope/secret metadata is required, not that `x-mcp-secret` is checked.
- **`xstockstrat-ingest`** (Python)
  - No source/handler/test references `MCP_AGENT_SECRET`/`x-mcp-secret` anywhere (confirmed zero).
  - `CLAUDE.md` env var table already omits it — no doc correction needed in this file.
- **`xstockstrat-analysis`** (Python)
  - No source/handler/test references `MCP_AGENT_SECRET`/`x-mcp-secret` anywhere (confirmed zero).
  - `CLAUDE.md` env var table already omits it — no doc correction needed in this file.

## Patterns to REUSE

- Both `_metadata()` implementations (`client.py:28-31`, `auth.py:22-25`) are byte-for-byte
  identical today. The fix is symmetric: apply the same edit shape to both rather than inventing a
  new pattern. No new helper/abstraction needed — this is a subtraction, not an addition (root
  CLAUDE.md "write the minimum" / "don't add abstraction the task didn't ask for").
- Doc-correction shape: reuse the precedent set by feature `079-remove-mcp-sse-transport`
  (`docs/roadmap/ledger/fails.md` 2026-07-29 entry) for how a **removal** feature writes its
  verification gates — see Risks below, this is the load-bearing reused pattern for this feature's
  acceptance criteria.
- `services/xstockstrat-agent/tests/conftest.py:56,67` already has the exact env-fixture shape
  (`monkeypatch.setenv` + `monkeypatch.setattr(client, "MCP_AGENT_SECRET", ...)`) that OAuth-signing
  tests still need — reuse it unchanged; only `test_client.py`'s header-presence assertions go away.

## Dependencies

- Proto/RPC: none — this is gRPC metadata, not a proto field.
- Migration: none.
- Config keys: none — `MCP_AGENT_SECRET` is a plain/`SECRET`-scoped env var, never a
  `xstockstrat-config` service key.
- Inter-service edges: none changed — `xstockstrat-agent` → `{ingest,notify,analysis,indicators,identity,config}` gRPC edges are unaffected; only the metadata attached to those calls changes.
- Env vars removed from receiving-service blocks (var itself is not deleted, only these three wirings):
  - `docker-compose.yml:215` (notify), `:323` (ingest), `:363` (analysis)
  - `.do/app.yaml:217-219` (ingest), `:261-263` (analysis), `:402-404` (notify)
  - `.do/app.dev.yaml:217-219` (ingest), `:261-263` (analysis), `:402-404` (notify)
- Env var kept, wiring unchanged:
  - `docker-compose.yml:523` (agent), `.do/app.yaml:295-297` (agent), `.do/app.dev.yaml:295-297` (agent)
  - `.env.example:37-41`, `scripts/setup-env.sh` (multiple lines — prose needs correcting, wiring stays), `services/xstockstrat-agent/claude_mcp_config.json:17` (`xstockstrat-stdio` block)

## Risks / Not-found

- **Ledger trap (`fails.md` 2026-07-29, `079-remove-mcp-sse-transport`)**: a removal feature's
  grep-based acceptance gate must not demand a blanket zero-hit count for the removed vocabulary —
  documentation describing the removal (this feature's own `product-spec.md`/`context.md`/
  `recon.md`, `docs/roadmap/ledger/insights.md`'s existing 092 entry, CHANGELOG) will legitimately
  keep saying "x-mcp-secret" in past-tense/removed-feature framing. The gate must instead target
  **symbols that cease to exist** (the literal `("x-mcp-secret", ...)` tuple construction and the
  `x-mcp-secret` string literal inside `app/client.py`/`app/auth.py` — hard zero, no legitimate
  survivor there) and **doc claims of current/active enforcement** (a semantic check — "does any
  live doc claim a service enforces this header today" — not a bare grep count). `product-spec.md`
  AC-1 already carves an exemption for the feature's own directory and other launched features'
  historical records; carry this distinction into `implementation-spec.md`'s per-step verification
  commands at `/sdd-spec` time, and do not tighten AC-1 into an unqualified `grep` zero-count.
- **`auth.py` has two `_metadata()` call sites, not one**: `validate_bearer_jwt` (`:41`) AND
  `validate_bearer_claims` (`:73`). The initial task framing (and product-spec FR-1) only names
  `validate_bearer_jwt` by example — both must be covered since both currently emit the header via
  the shared helper.
- **`test_client.py` assertion count**: 6 distinct `x-mcp-secret` assertions across
  `services/xstockstrat-agent/tests/test_client.py` (`:12` unit test of `_metadata()` directly,
  `:16-17` empty-secret case, plus 5 call-site assertions at `:102,236-238,386,493,659`) all need
  updating in the same step as the `client.py` change, or the red-before-green TDD gate (P-06) will
  fail for a reason unrelated to the actual code change.
- **`auth.py`'s two call sites have no direct `x-mcp-secret` assertion in any test** —
  `tests/test_auth.py` (read directly; the notify-focused recon agent's sibling agent initially
  reported this file as "not found" via an imprecise glob, but it exists and was read) tests
  `validate_bearer_jwt`'s aud-checking behavior only, never asserts on `_metadata()`'s return value
  or the outbound metadata tuple. No test changes required there — removing the header from
  `auth.py::_metadata()` will not break `test_auth.py`.
- **Stale evidence line numbers inside `docs/context-constitution.md` itself**: the `AGENT-4` row's
  cited evidence (`app/client.py:24-27`) and `AGENT-6`'s (`app/oauth_server.py:41,51`;
  `app/auth.py:43`) are already off by a few lines versus current source (`_metadata()` is actually
  at `client.py:28-31`; HMAC calls are at `oauth_server.py:42,52`; `auth.py`'s relevant line is `24`
  not `43`). This is pre-existing drift, not something this feature caused, but since this feature
  is editing `AGENT-4`/`AGENT-6` anyway, the corrected rows should cite accurate line numbers, not
  propagate the existing drift forward.
- **`AGENT-3` row** (`docs/context-constitution.md:17`) mentions "Read RPCs send `_metadata()` (no
  scope)" — this survives unchanged (it's about scope forwarding, not about the header's content)
  but is worth a light read-through during implementation to confirm no `x-mcp-secret`-specific
  claim hides inside it.
- **Not found**: any receiving-service enforcement code (confirmed absent in all three receiving
  services checked). Any `.env`/`.env.local` reference inside a service subdirectory (only the
  repo-root `.env.example` carries it, out of the four affected-service dirs' own scope but named
  explicitly in product-spec FR-4).

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):

1. **Agent header removal** — `client.py::_metadata()`, `auth.py::_metadata()` (both call sites),
   paired with the `test_client.py` assertion updates (red-before-green: first show the removed
   assertions would now fail against unchanged code, then land the code change and green them).
2. **Infra env-var trim** — remove `MCP_AGENT_SECRET` from notify/ingest/analysis blocks in
   `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`; keep the agent's block and
   `.env.example`/`scripts/setup-env.sh` wiring, correcting only their enforcement-claiming prose.
3. **Doc reconciliation** — `docs/runbooks/mcp-tools.md` (delete the "x-mcp-secret (downstream
   enforcement)" section and its table row entirely), `docs/runbooks/CLAUDE.md` (its one-line
   pointer to that section), `docs/setup/digitalocean.md` (§ around `:339-349`), root `CLAUDE.md`
   (the "MCP agent uses `MCP_AGENT_SECRET`..." sentence in § Environment Variable Naming
   Convention), `services/xstockstrat-agent/CLAUDE.md` (`:4` banner, `:19-20` sentence, `:154` env
   table entry reworded to OAuth-only), `services/xstockstrat-notify/CLAUDE.md` (its two prose
   lines `:42,45` reworded — the underlying "ungated by design" contract stays, only the
   `x-mcp-secret` phrasing changes since the agent no longer sends it), `services/xstockstrat-agent/docs/context-constitution.md`
   (`AGENT-4` reworded to drop `x-mcp-secret`; `AGENT-6` reworded from triple- to dual-purpose,
   correcting stale evidence line numbers in the same edit).
4. **Test-step pairing (C-08)** per step per language: step 1 pairs with the `test_client.py`
   updates (already same step above); step 2/3 are infra/docs steps with no paired test
   (`docs`/`config`-category steps per reviewer-registry, which the registry itself marks as
   "None" reviewer / no test-pairing requirement).
