# Defect: SetConfig internal-caller grant trusts the x-internal-caller header with no mTLS peer SAN

**Recorded**: 2026-10-20
**Severity**: SEV-2
**Impact type**: forgeable-config-write-attribution
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-config, xstockstrat-trading
**Config-only fix possible**: no

## Observed

`SetConfig`'s internal-caller write channel authorizes on the `x-internal-caller` header value alone. The
`INTERNAL_CALLER_ALLOWLIST` grant `trading-reconciliation-poller` (`authz.ts:66-76`) carries no `peerSan`, and
`hasInternalCallerAuthority` never inspects the mTLS peer certificate. Any workload that can reach `:50060`
can present `x-internal-caller: trading-reconciliation-poller` and escalate `platform.trading_state` to
`REDUCE_ONLY` / `HALTED`. Since feature 241 that header value is also recorded as the audit `changed_by`
(`updated_by`) for the write, so the forged identity is credited in `config.config_audit`.

## Expected

The `trading-reconciliation-poller` grant requires the mTLS peer certificate to present the DNS SAN
`xstockstrat-trading`, the same binding the `GetSecret` grants use (`peerSan` + `peerDnsSans`,
`authz.ts:131-162`). A request whose peer SAN does not match is denied and never attributed.

## Reproduction

1. From any in-cluster client other than `xstockstrat-trading` holding a platform-CA leaf, call
   `ConfigService/SetConfig` with `namespace=platform`, `key=platform.trading_state`, `value=HALTED`, metadata
   `x-internal-caller: trading-reconciliation-poller`, and no admin `x-access-scope`.
2. The write is authorized; the audit row's `changed_by` is `trading-reconciliation-poller` and
   `caller_identity` is set.

## Evidence

`services/xstockstrat-config/src/grpc/authz.ts:66`
> const INTERNAL_CALLER_ALLOWLIST: ReadonlyArray<InternalCallerGrant> = [

`services/xstockstrat-config/src/grpc/authz.ts:88`
> const callerID = first(md, HEADER_INTERNAL_CALLER);

`services/xstockstrat-config/src/grpc/authz.ts:162`
> (grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan)),

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:412`
> const author = callerUserId || (internalCallerAuthorized ? (callerIdentity ?? '') : '');

## Root cause hypothesis

The feature-102 internal-caller grant was never given the `peerSan` binding the `GetSecret` grants carry;
binding it changes the feature-102 gate, so feature 241 (design.md § Rejected Alternatives) left it for this
follow-up.

## Confidence

high
