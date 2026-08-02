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
