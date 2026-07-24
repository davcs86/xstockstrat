# xstockstrat-identity — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the identity service (JWT mint/verify, OAuth 2.1 AS backend, gRPC 50058). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-identity**.

## Rules (`IDENTITY-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **IDENTITY-1** | **The JWT signing secret is env-only (`process.env.JWT_SECRET`, throws if unset) — NEVER from the config service.** | Routing the key through `ConfigWatcher.getString('identity.jwt.secret')` like the TTLs would silently sign with `''`/default and every cross-service verify would fail. This is the one deliberate exception to root PLAT-6. | getter `src/grpc/identityServiceImpl.ts:28-36`; used `:80,119,167,206,239` | `src/grpc/identityServiceImpl.ts:28-36` |
| **IDENTITY-2** | **Refresh tokens & auth codes are stored as SHA-256 **hex**; the PKCE S256 challenge is compared as `sha256(verifier).base64url`.** Don't mix the encodings. | Hashing the verifier as hex mismatches the stored `code_challenge`; storing raw tokens is a leak. | hex `identityServiceImpl.ts:85,140,172,253,342,366,415`; base64url `:386` | `src/grpc/identityServiceImpl.ts:386` |
| **IDENTITY-3** | **Handlers are untyped (`(call: any, callback: any)`) and cast `(jwt as any).sign/verify/decode`; errors use raw numeric gRPC codes (`3`/`5`/`13`/`16`), never the `status.*` enum.** Match the house style. | The `UntypedServiceImplementation` cast at registration and the whole file follow this; a strongly-typed handler fights the cast, and importing `grpc.status` is inconsistent with every other handler. | `identityServiceImpl.ts:49,80,115,119,269`; `src/index.ts:49` | `src/grpc/identityServiceImpl.ts:52` |
| **IDENTITY-4** | **OAuth access tokens are `aud`-bound to the resource URI (RFC 8707); `ValidateToken` surfaces `aud`.** The `resource` param is threaded through the whole OAuth flow. | The MCP agent's inbound auth requires `claims.aud == AGENT_PUBLIC_URL`; dropping `resource` or diverging `aud`/`AGENT_PUBLIC_URL` breaks agent auth. | `mintOAuthAccessToken` `identityServiceImpl.ts:222-243`, `:126` | `src/grpc/identityServiceImpl.ts:222-243` |

## Gotchas & scars

- **`refreshOAuthToken` bumps `last_used_at` before revoking; `refreshToken` does not** — intentional: `last_used_at` is a feature-051 "Authorized Apps" surface that exists only for OAuth-client grants (non-NULL `client_id`), irrelevant to first-party sessions. Evidence: `identityServiceImpl.ts:431-444` vs `:158-177`.
- **`revokeToken` decodes the JWT *without* verifying the signature** and revokes all refresh tokens for the decoded `user_id`, returning `success:true` even for garbage input ("decode without verify to handle expired tokens") — flagged as a ⚠ security open question in findings. Evidence: `identityServiceImpl.ts:206,209,203`.
- **bcrypt cost=10 parity**: the seed hash (`$2b$10$…`) and `manage-users.sh` (`BCRYPT_ROUNDS=10`) must agree with any hash-producing tool (compare reads cost from the hash, so it's non-load-bearing but keep it consistent). Evidence: `migrations/002_seed_admin.up.sql:12`, `identityServiceImpl.ts:64`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| `Date`-for-Timestamp on all responses (`secondsToDate`) | `identityServiceImpl.ts:18-20` (root PLAT-1/F2; PR #442) |
| pg pool cap 2 / `DB_POOL_MAX` | `src/index.ts:32-36`; root pool budget |
| Config 90s snapshot gate before serving | `src/index.ts:19` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
