# Defect: Agent OAuth dynamic client registration fails open on a config stall (SECURITY POSTURE)

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: security-posture
**Environment**: dev (feature/fix-agent-getconfig-deadline @ 841b404a)
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: no
**Source**: feature 247 (`docs/roadmap/features/247-fix-agent-getconfig-deadline/design.md` § Open Risks). FR-2 / AC-4
of feature 247 sanctioned fail-open: on a config stall, DCR must return 201 rather than hang.

## Observed

SECURITY POSTURE. When config stalls for D (`_CONFIG_READ_TIMEOUT_S` = 3.0 s) or more, `/oauth/register` registers
the client anyway. Both config reads in `register` treat any exception as "unset":
- `agent.oauth.registration_enabled` falls back to enabled;
- `agent.oauth.allowed_redirect_uris` falls back to an empty allowlist, which applies no restriction.

An operator who set `registration_enabled=false` or a redirect allowlist loses both controls for as long as config
is slow or down. Identity does not back them up, because it checks only that each redirect URI starts with
`https://`. Any `https` redirect URI therefore registers.

## Expected

A decision on fail-closed DCR: return 503 when the `registration_enabled` or allowlist read fails, so a config
outage cannot widen who can register. Feature 247 deliberately kept fail-open, because its FR-2 / AC-4 require 201
on a stall. Changing that is a security-posture decision for its own feature.

## Reproduction

1. Set `agent.oauth.registration_enabled=false`, or a non-empty `agent.oauth.allowed_redirect_uris`.
2. Stall the config service so `GetConfig` does not answer (the `hung_config_server` fixture, hang mode).
3. `POST /oauth/register` with `{"redirect_uris": ["https://attacker.example/cb"]}`.
4. Observed: 201 with a new `client_id` after about 2×D. Expected: registration is refused while the policy is
   unknown.

## Evidence

`services/xstockstrat-agent/app/oauth_server.py:87-89` (the registration switch falls back to enabled)
> except Exception as e:
>     log.warning("oauth.registration_enabled read failed, defaulting to enabled: %s", e)
>     reg_enabled = None

`services/xstockstrat-agent/app/oauth_server.py:107-110` (the allowlist falls back to empty, which allows all)
> except Exception as e:
>     log.warning("oauth.allowed_redirect_uris read failed, defaulting to empty allowlist: %s", e)
>     allowed_raw = None
> allowlist = [u.strip() for u in allowed_raw.split(",")] if allowed_raw else []

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:385-388` (identity checks only the scheme)
> // Every redirect URI must be https:// (the agent edge may tighten further).
> for (const uri of redirectUris) {
>   if (!uri.startsWith('https://')) {
>     return callback({ code: 3, message: 'redirect_uris must use https' });

## Root cause hypothesis

The DCR policy reads were written best-effort ("a config read failure must not 500 DCR"). Identity was assumed to
enforce the allowlist server-side, but it does not, so the agent's pre-check is the only allowlist check.

## Confidence

high (static read; feature 247's `test_ac4_register_does_not_hang_on_stalled_config` asserts the 201 on a stall)
