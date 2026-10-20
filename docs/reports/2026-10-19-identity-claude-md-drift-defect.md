# Defect: Identity CLAUDE.md and package metadata misdescribe the RPC surface, deps and migrations

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-identity
**Config-only fix possible**: no
**Source**: `services/xstockstrat-identity/docs/context-constitution-findings.md` § Documentation that lies rows 2–7

## Observed
- §Ports says the server exposes "eleven methods". `identityServiceImpl.ts` has 21 handlers; features 043 and 183 added the user-metadata, admin user-management and password/role/active RPCs.
- §Dependencies omits the real outbound gRPC dependency on xstockstrat-ledger (admin-mutation audit, `LEDGER_ENDPOINT`). It also says config supplies "JWT secrets", which contradicts IDENTITY-1 (the secret comes from env only).
- §Database / Migrations stops at `005_drop_api_keys`; `006_user_metadata` exists.
- The banner lists "fictional ledger audit" as a defect, but `ledgerAudit.ts` is real.
- `package.json` description still says "API key management", although API keys were removed by migration 005.
- The `src/grpc/authz.ts` header says the request-body `user_id` is ignored except by two RPCs. The admin RPCs (`adminGetUserMetadata`, `getUser`, `setUserRoles`, …) read it by design (IDENTITY-10).

## Expected
CLAUDE.md, `package.json` and the `authz.ts` header comment match the code.

## Reproduction
1. Read `services/xstockstrat-identity/CLAUDE.md:26`, `:47` and `:63`, and the banner at `:4`.
2. Compare with `src/grpc/identityServiceImpl.ts` (21 `async <rpc>(call` handlers), `src/grpc/ledgerAudit.ts:33` and `migrations/006_user_metadata.up.sql`.
3. Read `package.json:4` and `src/grpc/authz.ts:3`, and compare them with `identityServiceImpl.ts:664`.

## Evidence
`services/xstockstrat-identity/CLAUDE.md:26`
> `eleven methods: `AuthenticateUser`, `ValidateToken`, `RefreshToken`, `RevokeToken`,`

`services/xstockstrat-identity/CLAUDE.md:47`
> `| xstockstrat-config | gRPC WatchConfig | Live config (JWT secrets, token TTLs) |`

`services/xstockstrat-identity/src/grpc/ledgerAudit.ts:33`
> `  endpoint: string = process.env.LEDGER_ENDPOINT ?? 'xstockstrat-ledger:50057',`

`services/xstockstrat-identity/package.json:4`
> `  "description": "Auth, JWT, and API key management",`

`services/xstockstrat-identity/src/grpc/authz.ts:3`
> ` * x-user-id metadata header; request-body user_id is ignored except by ListAuthorizedApps/RevokeAuthorizedApp.`

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:664`
> `    const userId = call.request.userId;`

## Root cause hypothesis
Features 043 and 183 added RPCs and the ledger dependency without updating the service docs or headers.

## Confidence
high
