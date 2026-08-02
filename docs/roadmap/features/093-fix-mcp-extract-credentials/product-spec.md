# Product Spec: fix-mcp-extract-credentials

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-1)
**Severity**: SEV-2
**Created**: 2026-08-02

---

## Problem Statement

Extract-tool credential resolution is structurally broken (report F-1). `extract_email_content` /
`extract_website_content` gate on `has_credentials` (derived from the **ingest** row's
`credentials_ref`) but resolve the secret from an **unrelated** store: config key
`source.<slug>.credentials` in namespace `agent`, via `client.get_config_value`, which:

- hardcodes `namespace="agent"`,
- sends **no environment** (config's `resolveEnv(undefined)` → **dev**), so a production agent reads
  the dev scope, and
- swallows every error to `None`.

Net: password-protected PDFs and authenticated sites work only if an operator seeds a dev-scoped,
agent-namespace, non-`secret.`-prefixed plaintext key that no runbook documents, while the documented
`credentials_ref` convention is read by nothing.

Expected: extraction credentials have one owner and resolve correctly per environment, or extraction
moves server-side so the credential never crosses to the agent.

## Reproduction Steps

1. Register a source with `credentials_ref` set. 2. In a production agent, call an extract tool for
   a password-protected source → the lookup reads the dev `agent`-namespace key, finds nothing,
   swallows the error, and falls back to an unauthenticated fetch (or fails), with no signal.

## Root Cause Hypothesis

RC-5 — two unreconciled credential conventions plus a scope-blind, error-swallowing config read. See
report F-1 (also partially recorded in agent `context-constitution-findings.md`).

## Affected Services

`xstockstrat-agent` (`app/client.py` `get_config_value`, `app/tools.py` extract tools),
`xstockstrat-ingest` (radical: a `ResolveSourceCredential` RPC or server-side extraction),
`xstockstrat-config` (scope semantics).

## Fix Scope

- [x] Proto changes anticipated (radical path) — a `ResolveSourceCredential` RPC on ingest gated by
      `x-mcp-secret`.
- [ ] No database migrations anticipated.
- [x] Config key changes anticipated — standardize/relocate the credential key and document
      per-environment seeding in `docs/runbooks/add-data-source.md`.
- **Interim (no proto):** parameterize `get_config_value` with namespace + environment (mirror the
  existing `_config_scope` used by `get_config`/`set_config`), stop swallowing transport errors, and
  standardize the key. The same env-blind read also affects `signal.alert_threshold`.

## Acceptance Criteria

- [ ] Credential reads are environment-scoped (RED: a production-env extract call currently sends a
      `GetConfigRequest` with no environment → dev).
- [ ] A resolution failure is surfaced/logged, not silently swallowed to `None`.
- [ ] Radical (if chosen): ingest resolves its own `credentials_ref`; the agent's
      `source.<slug>.credentials` path is removed; `x-mcp-secret` gate enforced.
- [ ] Per-environment credential seeding documented in `add-data-source.md`.

## Out of Scope

- The `manage_signal_source` verb split (feature 088), though both touch `credentials_ref`.
