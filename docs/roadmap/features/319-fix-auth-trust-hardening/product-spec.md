# Product Spec: fix-auth-trust-hardening

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md, docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md, docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### SetConfig internal-caller grant trusts the x-internal-caller header with no mTLS peer SAN (SEV-2)

- **Observed:** the `INTERNAL_CALLER_ALLOWLIST` grant `trading-reconciliation-poller` carries no `peerSan`, and
  `hasInternalCallerAuthority` never inspects the peer certificate. Any workload that reaches `:50060` can send
  `x-internal-caller: trading-reconciliation-poller` and escalate `platform.trading_state` to `REDUCE_ONLY` /
  `HALTED`; since feature 241 the forged value is recorded as the audit `changed_by`.
- **Expected:** the grant requires the mTLS peer DNS SAN `xstockstrat-trading` (same `peerSan` + `peerDnsSans`
  binding the `GetSecret` grants use); a mismatched peer is denied and never attributed.
- Report: [docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md](../../../reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md)

### RevokeToken trusts an unverified JWT and revokes all of the decoded user's sessions (SEV-3)

- **Observed:** `revokeToken` uses `jwt.decode` (no signature check) and revokes every active refresh token for the
  decoded `user_id`; returns `success:true` for empty or garbage input. Any direct mTLS gRPC caller can log out an
  arbitrary user with an unsigned token (the UI path is mitigated by middleware verifying the access-token cookie).
- **Expected:** verify the signature with `ignoreExpiration: true`, so expired-but-genuine tokens still log out and
  forged ones are rejected or ignored.
- Report: [docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md](../../../reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md)

### Agent OAuth dynamic client registration fails open on a config stall — SECURITY POSTURE (SEV-2)

- **Observed:** when config stalls ≥ `_CONFIG_READ_TIMEOUT_S` (3.0 s), `/oauth/register` treats both policy reads as
  unset: `agent.oauth.registration_enabled` falls back to enabled and `agent.oauth.allowed_redirect_uris` to an
  empty (unrestricted) allowlist. Identity checks only the `https://` scheme, so any `https` redirect URI registers.
- **Expected:** a decision on fail-closed DCR (return 503 when either read fails). Feature 247's FR-2 / AC-4
  deliberately require 201 on a stall; changing that is a security-posture decision (Open Question 1).
- Report: [docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md](../../../reports/2026-10-29-agent-dcr-fail-closed-defect.md)

## Reproduction Steps

1. SetConfig: from an in-cluster client other than `xstockstrat-trading` holding a platform-CA leaf, call
   `ConfigService/SetConfig` (`namespace=platform`, `key=trading_state`, `value=HALTED`, metadata
   `x-internal-caller: trading-reconciliation-poller`, no admin `x-access-scope`) → authorized; audit `changed_by` =
   `trading-reconciliation-poller`.
2. RevokeToken: build an unsigned JWT `{"user_id":"<victim>"}`; call `IdentityService.RevokeToken({token})` over mTLS
   gRPC → every `identity.refresh_tokens` row for the victim gets `revoked_at`.
3. DCR: set `agent.oauth.registration_enabled=false` (or a non-empty `agent.oauth.allowed_redirect_uris`); stall
   config (`hung_config_server` fixture, hang mode); `POST /oauth/register` with
   `{"redirect_uris": ["https://attacker.example/cb"]}` → 201 with a new `client_id` after ~2×D.

## Root Cause Hypothesis

- Config: the feature-102 internal-caller grant never got the `peerSan` binding; feature 241 left it as a follow-up.
- Identity: `decode` used instead of `verify(..., {ignoreExpiration: true})` to let expired tokens log out.
- Agent: DCR policy reads written best-effort ("a config read failure must not 500 DCR"), assuming identity enforces
  the allowlist — it does not.
- Current sites (main-dev 0fecb24d): `services/xstockstrat-config/src/grpc/authz.ts:84-92` (grant, no `peerSan`),
  `:104` (`hasInternalCallerAuthority`), `:185` (`GetSecret` `peerSan` check);
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts:729` (audit author);
  `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:284` (`jwt.decode`), `:426` (https-only redirect
  check); `services/xstockstrat-agent/app/oauth_server.py:89`, `:107` (fail-open fallbacks);
  `services/xstockstrat-agent/app/client.py:41` (`_CONFIG_READ_TIMEOUT_S = 3.0`).

## Affected Services

- xstockstrat-config (SetConfig internal-caller authz)
- xstockstrat-trading (the legitimate `trading-reconciliation-poller` caller; must present SAN `xstockstrat-trading`)
- xstockstrat-identity (`RevokeToken`)
- xstockstrat-agent (`/oauth/register` DCR)

## Fix Scope

- Proto changes anticipated: **no** — all three fixes are server-side checks on existing RPCs/endpoints.
- DB migrations anticipated: **no** — no schema change named by any report.
- Config key changes anticipated: **no** — existing keys (`agent.oauth.*`) keep their meaning; only the failure
  behaviour of their reads may change.

## Open Questions

1. **DCR fail-closed security-posture decision (operator, kept open earlier):** should `/oauth/register` return 503
   when the `registration_enabled` or `allowed_redirect_uris` read fails, overriding feature 247 FR-2 / AC-4 (201 on
   a stall)? Must be recorded with the operator's explicit sign-off before design concludes; AC-3 is written for
   fail-closed and is rewritten if the operator keeps fail-open.
2. If fail-closed is rejected: should identity enforce the redirect allowlist server-side instead (the report notes
   identity checks only the `https://` scheme)?
3. RevokeToken on a forged/garbage token: reject with an error vs. ignore and return `success:true` (the report allows
   either).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- `GetSecret` grants (already carry `peerSan`).
- Refactoring unrelated to the bug; performance improvements unrelated to the fix.
