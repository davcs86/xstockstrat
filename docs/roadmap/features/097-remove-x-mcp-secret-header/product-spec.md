# Product Spec: remove-x-mcp-secret-header

**Created**: 2026-08-02

---

## Problem Statement

`xstockstrat-agent` attaches an `x-mcp-secret` gRPC metadata header (value: `MCP_AGENT_SECRET`)
to every outbound call it makes to platform services. No receiving service reads, checks, or
enforces this header anywhere in current source (confirmed by grep across all nine backend
services) — feature `092-fix-mcp-writepath-authz` explicitly designed **against** ever enforcing
it, because the caller set makes it the wrong trust model (internal callers send nothing; only the
external, OAuth-gated agent sends the secret — enforcing it would invert the trust boundary). The
header is dead weight: code that runs on every RPC, infra wiring across `docker-compose.yml` /
`.do/app.yaml` / `.do/app.dev.yaml` / `.env.example`, and doc claims in `docs/runbooks/mcp-tools.md`
and `docs/setup/digitalocean.md` that actively **misstate** current behavior (they claim downstream
services "reject requests without the correct header" — false, contradicted by source). This spec
removes the header and its infra plumbing once and for all, and corrects every doc that describes it.

## User Story

As a platform maintainer, I want the unenforced `x-mcp-secret` header removed from the agent's
outbound calls and its infra/doc footprint deleted, so that the codebase has no dead
security-flavored code implying a guarantee that doesn't exist, and every doc accurately describes
the platform's actual (documented, intentional) trust model for internal RPCs.

## Functional Requirements

FR-1. `xstockstrat-agent` no longer attaches an `x-mcp-secret` header (or any header serving the
same purpose) to any outbound gRPC call. Both header-building call sites (`app/client.py`'s
`_metadata()` and `app/auth.py`'s separate `_metadata()`) stop returning it.

FR-2. `MCP_AGENT_SECRET` is **not** deleted as an environment variable / secret, because it is
independently load-bearing as the HMAC signing key for the agent's stateless OAuth `txn` blob
(`app/oauth_server.py::_sign_txn` / `_verify_txn`, invariant `AGENT-6` in
`services/xstockstrat-agent/docs/context-constitution.md`). Every place that currently describes
`MCP_AGENT_SECRET` as serving the outbound header **and** OAuth signing is corrected to describe it
as serving OAuth `txn` signing only. `AGENT-6`'s "triple-purposed secret" framing is retired or
rewritten to match the single remaining purpose.

FR-3. Every `docker-compose.yml` / `.do/app.yaml` / `.do/app.dev.yaml` env var block that injects
`MCP_AGENT_SECRET` into a **receiving** service (`xstockstrat-notify`, `xstockstrat-ingest`,
`xstockstrat-analysis`) for the sole purpose of comparing it against the header is removed from
those services' blocks — those services never enforced it and have no other use for the var. The
var stays wired into `xstockstrat-agent` (still needed for OAuth signing) and into `docker-compose.yml`'s
agent block / `.env.example` / `scripts/setup-env.sh` (still needed there for the same reason).

FR-4. `docs/runbooks/mcp-tools.md`, `docs/setup/digitalocean.md`, `docs/runbooks/CLAUDE.md`, root
`CLAUDE.md`, `services/xstockstrat-agent/CLAUDE.md`, `services/xstockstrat-notify/CLAUDE.md`,
`services/xstockstrat-agent/docs/context-constitution.md`, `.env.example`, and
`scripts/setup-env.sh` no longer describe an `x-mcp-secret` header being sent, checked, or
enforced anywhere. Any claim of downstream enforcement (e.g. `docs/runbooks/mcp-tools.md`'s
"Those services reject requests without the correct header", `.env.example:38,40`'s "Shared secret
sent as x-mcp-secret header on all downstream HTTP calls… Leave empty to skip header enforcement",
or `scripts/setup-env.sh`'s "header enforcement disabled" / "x-mcp-secret header will not be sent"
messaging and its prompt claiming the value "must match value set in ingest, notify, and analysis")
is deleted or rewritten, not merely softened — it was never true in current source, and once FR-3
removes the var from those three services' blocks, the "must match" framing becomes actively wrong.
`.env.example` and `scripts/setup-env.sh` keep prompting for / documenting `MCP_AGENT_SECRET` itself
(still needed for OAuth signing per FR-2) — only the header-enforcement narrative around it changes.

FR-5. Test coverage is updated to match: `services/xstockstrat-agent/tests/test_client.py`'s
assertions that `_metadata()` returns an `x-mcp-secret` tuple are removed/replaced with assertions
that outbound metadata carries no such header; `conftest.py`'s `MCP_AGENT_SECRET` fixture is kept
only if OAuth-signing tests still need it (otherwise trimmed to what's used).
`services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`'s existing "accepts an
unauthenticated internal caller (no scope/secret metadata)" test already documents the desired
end state and needs no behavior change — only comment/wording alignment if it references the header
as something that could theoretically be sent.

FR-6. This feature is tracked to `launched` by the end of the implementing PR (no intermediate
per-step PRs) — recorded in this repo's completed-feature backlog
(`docs/roadmap/features/097-remove-x-mcp-secret-header/`) per the requester's instruction.

## Out of Scope

- Renaming `MCP_AGENT_SECRET` to a name that reflects its sole remaining OAuth-signing purpose
  (e.g. `MCP_OAUTH_HMAC_SECRET`). A rename would require coordinated secret-value changes in the DO
  dashboard for both dev and prod apps outside this repo's control, and is a separate, optional
  follow-up — this feature only narrows the variable's *documented and actual* purpose, not its name.
- Any change to the agent's OAuth 2.1 authorize/callback flow itself, or to `_sign_txn`/`_verify_txn`
  logic — those are untouched, just re-scoped in documentation to reflect single-purpose use.
- Any change to `EmitAlert` authorization semantics or the internal-service-caller contract
  established by feature `092-fix-mcp-writepath-authz` — that decision (no header enforcement) is
  the premise of this feature, not something it revisits.
- Introducing any new authentication/identity mechanism for internal service-to-service calls.

## Affected Services

- `xstockstrat-agent` — removes header emission (`app/client.py`, `app/auth.py`); re-scopes
  `MCP_AGENT_SECRET` documentation (`CLAUDE.md`, `docs/context-constitution.md`)
- `xstockstrat-notify` — drops the now-pointless `MCP_AGENT_SECRET` env var from its
  `docker-compose.yml` / `.do/app*.yaml` blocks; doc correction in `CLAUDE.md`
- `xstockstrat-ingest` — drops the same env var from its infra blocks
- `xstockstrat-analysis` — drops the same env var from its infra blocks

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — internal/platform-only. This removes dead, unenforced header-emission code and
  corrects inaccurate docs; it does not change any MCP tool's name, parameters, return shape, or
  the OAuth login flow a user/client experiences. No UI segment or agent tool behavior changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

(This changes deployment **env vars**, not `xstockstrat-config` service keys — the `secret.*`
config-key namespace is unrelated to `MCP_AGENT_SECRET`, which has always been a plain env var /
DO App Platform `SECRET`-scoped env var, never a config-service key.)

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/remove-x-mcp-secret-header` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, no proto/config/schema change)

**Explicit instruction for this feature (from the requester):** run the full SDD pipeline to
completion — story → design (quick) → spec → review → execute — and land it as **one PR** with
**no intermediate per-step PRs**. Use `/sdd-execute remove-x-mcp-secret-header sequential`, which
commits one commit per step directly on `feature/remove-x-mcp-secret-header` and opens a single
integration PR to `main-dev` at the end, rather than the default per-step-PR mode.

## Acceptance Criteria

1. `grep -rn "x-mcp-secret"` across the repo returns zero hits in source code, tests, and docs
   (a historical mention in `docs/roadmap/features/097-remove-x-mcp-secret-header/` itself, in
   past-tense/removed-feature framing, and in other already-`launched` feature dirs' historical
   records, is acceptable — those are an immutable log, not live doc claims).
2. `xstockstrat-agent`'s outbound gRPC metadata never includes an `x-mcp-secret` key, verified by
   an updated `test_client.py` assertion.
3. `MCP_AGENT_SECRET` still exists as an env var wired to `xstockstrat-agent` (docker-compose,
   `.do/app.yaml`, `.do/app.dev.yaml`, `.env.example`, `scripts/setup-env.sh`,
   `claude_mcp_config.json`) and OAuth `txn` signing/verification still passes its existing tests
   unmodified in behavior.
4. `MCP_AGENT_SECRET` is removed from `xstockstrat-notify`, `xstockstrat-ingest`, and
   `xstockstrat-analysis`'s env blocks in `docker-compose.yml`, `.do/app.yaml`, and
   `.do/app.dev.yaml` (it served no purpose there once the header is gone).
5. `docs/runbooks/mcp-tools.md` and `docs/setup/digitalocean.md` no longer claim any service
   enforces or checks `x-mcp-secret`.
6. `AGENT-6` in `services/xstockstrat-agent/docs/context-constitution.md` accurately describes
   `MCP_AGENT_SECRET` as single-purpose (OAuth `txn` HMAC signing only).
7. Full CI (Go/Python/Node lint + test, proto lint/breaking) passes on the integration PR.
8. `feature.md`'s Lifecycle Status reaches `launched` and the feature is reflected in the
   completed-feature backlog (i.e. `docs/roadmap/features/097-remove-x-mcp-secret-header/feature.md`
   itself, which is what "the completed feature backlog document" refers to in this repo — there is
   no separate aggregate backlog file; `/sdd-status` computes the live view from each feature's own
   `feature.md`), all within the single integration PR — no intermediate PRs.

## Open Questions

- [x] **Known trap (resolved by this spec):** `MCP_AGENT_SECRET` is triple-purposed today — the
  outbound `x-mcp-secret` header (being removed) AND the HMAC key signing the stateless OAuth `txn`
  blob (staying). A naive "grep and delete `MCP_AGENT_SECRET` everywhere" pass would break the OAuth
  `/oauth/authorize` flow. FR-2 and the Out of Scope section above lock in the resolution: keep the
  var, narrow its documented purpose, don't rename it in this feature.
- [ ] Should `MCP_AGENT_SECRET` eventually be renamed to reflect its sole remaining purpose? Left
  as an explicit out-of-scope follow-up (see above) rather than bundled here.
