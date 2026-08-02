# Context Log: fix-mcp-extract-credentials

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-1
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-ingest, xstockstrat-agent, xstockstrat-config
- Root cause(s) from the report: RC-5
- Recommended design depth: full → `/sdd-design fix-mcp-extract-credentials` (rationale: proto change (new RPC, radical path) + ≥2 services + credential handling)
- Development branch: feature/fix-mcp-extract-credentials
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: wrote recon.md (agent, ingest, config). DECISIVE fact: ingest `credentials_ref` is
  opaque free-text nothing resolves (test data mixes secret.* and vault:// styles); no resolver, no
  ingest x-mcp-secret, no ResolveSourceCredential RPC — so the "radical" path requires inventing a
  credential-resolution convention (a separate, larger feature), not a deferred caller.
- Phase 1 Grilling: 2 rounds (full). R1 adversary ruled option (c) (make extract credentials loudly
  unsupported) over option (a) (entrench a plaintext-config credential) — the plaintext path breaches
  C-05/config-invariant-#6 and get_config would disclose it unredacted. R2 adversary verified option
  (c) and caught the HIDDEN bug O1: signal.alert_threshold is value_type='float' but get_config_value
  returns string_val-only → None regardless of scope; the value projection must stringify the active
  oneof (mirror get_config). Plus O2 (best-effort callers need `except Exception`, not just
  AioRpcError — post-commit reads must not fail ingest_signal), O3 (RuntimeError not ValueError for the
  unsupported-credential raise), O4 (OAuth bool key shares O1), and a hand-written test_oauth stub to
  widen.
- Chosen approach: option (c). get_config_value gains required namespace+environment + typed-oneof
  projection + re-raise-transport/None-on-absent; extract tools remove the credential read and raise
  RuntimeError when has_credentials=True; alert_threshold + OAuth env-scoped with broad best-effort
  catches; shared env normalizer lifted to scopes.py; atomic signature+caller+mock change (F-05).
- **Design-gate resolution (standing "continue" directive).** AC-3 (radical resolver) deferred —
  credentials_ref has no resolution convention; building one is a separate feature. AC-4 reinterpreted
  — no governance-clean plaintext credential to seed, so add-data-source.md documents the unsupported
  state + follow-up rather than teaching a plaintext antipattern. Both recorded; reopen if the user
  wants the secure credential resolver built now.
- Constitution rules touched: C-05/F-07/invariant-#6 (resolved by removing the read), C-08/P-06, C-13,
  C-10, F-05, F-04/C-01, C-11/P-03. Floor breaches: none.
- Status: draft → design-approved.

### Open Threads
- AC-3 secure credential resolver — deferred; reopen for a dedicated feature.
- AC-4 — reinterpreted (no plaintext seeding doc); target /sdd-spec docs step.
- O1 typed-projection is a RETURN-SHAPE contract (RC-1) — the client test must use a float_val fixture
  and assert the stringified value, not just the request shape.

---

## Session 2026-08-02 — sdd-spec

- Generated implementation-spec.md with **3 steps**. Status → `implementation-ready`.
  Agent-only change; no proto, no migration, no new config key (design option (c)).
  - **Step 1 [service, atomic — F-05]**: `client.get_config_value` gains required
    `namespace`/`environment` kwargs + `trading_mode="all"`, sends `metadata=_metadata()`, and
    projects the **active oneof** (`WhichOneof` → `str(getattr(...))`, mirroring `get_config`
    `client.py:873-875`) instead of `string_val`-only (the O1 fix); transport `AioRpcError` is
    surfaced, absent key → `None`. Env/mode normalizer lifted from the `tools.py:729-734`
    `_resolve_scope` closure into `app/scopes.py` (no cycle — `scopes.py` imports neither
    `tools`/`client`); `_resolve_scope` delegates; `oauth_server.py` uses it. Extract tools remove the
    `source.{slug}.credentials` read and **raise `RuntimeError`** when `has_credentials=True`;
    alert_threshold + OAuth reads env-scoped with **broad best-effort** `except Exception`. The
    `test_oauth.py:160` `_cfg` stub widening travels in this step (green-making minimum).
  - **Step 2 [test, RED-first]**: `test_client.py` net-new — decisive case is a `float_val`
    `ConfigValue` → `"0.7"` return-shape assertion (ledger RC-1), plus request-scope, absent-key→None,
    and AioRpcError-propagates. `test_tools.py` — both extract tools raise `RuntimeError` for a
    `has_credentials=True` conftest source; alert best-effort scope. `test_oauth.py` env-scope.
    Coverage ≥40 + ruff.
  - **Step 3 [docs]**: mcp-tools.md extract behavior/error table; agent `CLAUDE.md` add
    `agent.signal.alert_threshold`; findings F-1 resolved; `add-data-source.md` AC-4 note (unsupported
    state, not a plaintext-seeding guide).
- Key codebase findings (grep-verified 2026-08-02):
  - `get_config_value` is `app/client.py:678-695`; bug is `namespace="agent"` hardcode `:689`, no
    `environment`, no `metadata=`, `string_val or None` `:693`, `except Exception: return None`
    `:694-695`. Correct projection to mirror: `get_config` `:873-875`; scope translator `_config_scope`
    `:842-857`.
  - Exactly 5 `get_config_value` callers: extract `tools.py:145,186` (removed), alert `tools.py:234`,
    OAuth `oauth_server.py:70,85`. Only broken existing test stub is `test_oauth.py:160-161` `_cfg(key)`.
  - `app/scopes.py` already exists and is import-safe for the normalizer lift; `oauth_server.py`
    already imports `os` `:21` + `from app import client` `:26`.
- Reviewers snapshot written to feature.md: xstockstrat-agent (service owner) + Security (secret
  handling — the fix removes a plaintext-config credential read).

### Decisions
- One atomic service step (F-05): the `get_config_value` required-kwargs signature + all callers +
  the one hand-written mock (`test_oauth _cfg`) move together — no intermediate `TypeError`. New
  assertions land in the paired test step (insight 072-execute pattern).
- C-13: the `has_credentials=True` **source** fixture is centralized to `tests/conftest.py` (two
  consumers — both extract tools). The pre-existing `has_credentials:True` literal at
  `test_tools.py:679` is a different shape (`manage_signal_source` return) and stays inline.

### Open Threads
- AC-3 secure credential resolver — still deferred (spec Step 3 documents the unsupported state); a
  future dedicated feature if a credential-resolution convention is defined.
- O1 typed-projection is a RETURN-SHAPE contract (RC-1) — Step 2's `test_client.py` case MUST use a
  `float_val` fixture and assert the stringified value `"0.7"`, not just the request shape.
