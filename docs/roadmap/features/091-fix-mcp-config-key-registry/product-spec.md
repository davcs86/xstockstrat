# Product Spec: fix-mcp-config-key-registry

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-8)
**Severity**: SEV-3
**Created**: 2026-08-02

---

## Problem Statement

`set_config` is a blind upsert with no existence check (report F-8): a mistyped key silently
**creates** a metadata-less orphan row that no service reads, and the tool's `NOT_FOUND → "config
key not found"` mapping is therefore unreachable. Root cause RC-3: `config.config_values` is
simultaneously the key registry and the value store, so existence ⇔ a value row — which also makes
"registered but unset" unrepresentable, lets unknown namespaces return empty (never `NOT_FOUND`) from
`GetConfig`/`ListKeys`, and means a create writes no audit row. Notably the agent tool already calls
`ListKeys` on every write (for its secret-flag check) and **discards** the existence answer.

Expected: a typo is refused (unless the caller explicitly opts into creating a key); `NOT_FOUND` is
reachable; unset-registered keys are representable; key creation is auditable.

## Reproduction Steps

1. `set_config(namespace="marketdata", key="marketdata.fmp.enabld", ...)` (typo) → succeeds,
   creating an orphan key no service reads; no error, no way to notice.

## Root Cause Hypothesis

RC-3 — registry/value conflation in config. See report F-8.

## Affected Services

`xstockstrat-agent` (`app/tools.py` `set_config` — reuse the already-fetched `ListKeys` result),
`xstockstrat-config` (`src/grpc/configServiceImpl.ts` `SetConfig`, plus a key-registry migration for
the structural fix).

## Fix Scope

- [x] Database migrations anticipated — a key registry (registration table / column) for the
      structural fix.
- [ ] No proto changes anticipated (confirm during design; a `create_key` flag on `SetConfigRequest`
      may be desired for the explicit-create path).
- [ ] No config key changes anticipated.
- Cheap agent-side guard first: refuse a key absent from the `ListKeys` result unless an explicit
  `create_key=true` parameter is passed — uses data the tool already has.

## Acceptance Criteria

- [ ] A `set_config` to an unregistered key is refused unless `create_key=true` (RED: currently
      silently created).
- [ ] `GetConfig`/`ListKeys`/`SetConfig` on an unknown key/namespace return `NOT_FOUND` where
      appropriate (mapping becomes reachable).
- [ ] "registered but unset" is representable; key creation writes an audit row.
- [ ] Secret-key refusal (name-prefix + `is_secret`) unchanged.

## Out of Scope

- Broader config-service redesign beyond the registry needed to fix F-8.
