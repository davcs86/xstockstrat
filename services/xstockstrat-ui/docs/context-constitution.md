# xstockstrat-ui — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the consolidated Next.js UI + gRPC BFF (`/trader`, `/insights`, `/config-ui`, `/accounts`;
HTTP 3000). The service CLAUDE.md is thorough, so this file holds the asymmetries and scars the docs
*don't* state. Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ui**.

## Rules (`UI-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **UI-1** | **protobuf-es `Timestamp` is `{seconds: bigint, nanos: number}`** — render via `Number(ts.seconds) * 1000` and guard the null case; build the reverse with `{ seconds: BigInt(...), nanos: ... }`. There is **no** canonical helper. | `ts.seconds` is a **bigint** — `ts.seconds * 1000` throws `Cannot mix BigInt`, and `new Date(ts)` isn't a Date. (This is the browser/protobuf-es form, distinct from the backend ts-proto `Date` rule, root PLAT-1.) | `src/lib/chart.ts:39`, `src/components/insights/BacktestDiagnostics.tsx:29-31`, `src/app/insights/strategies/[id]/page.tsx:78-80` (N=6+) | `src/lib/chart.ts:39` |
| **UI-2** | **Browser typed clients are named per (service × segment) and hard-bound to that segment's BFF `baseUrl`** — import the client whose baseUrl matches the segment the component renders under. | `analysisClient` (`/insights/api`) vs `traderAnalysisClient` (`/trader/api`): importing the wrong one marshals to a BFF handler map with no matching entry → **404**. | `src/browserClients/analysisClient.ts:5` vs `traderAnalysisClient.ts:6` (N=13 files) | `src/browserClients/traderAnalysisClient.ts:5` |
| **UI-3** | **BFF handlers use the `forward`/`forwardAdmin` combinators; explicit bodies exist only to inject the verified session `userId` (`{ ...req, userId: claims.user_id }`) or to stream — never trust a body-supplied user.** | The pre-DRY inline `requireSession`+`backendHeaders` shape trips the DRY guard rail; forgetting the `userId` injection on a mutating call opens an IDOR (treated as a security invariant). | defs `src/lib/bffShared.ts:63-79`; injection `src/lib/traderBff.ts:29,37,45,53` | `src/lib/traderBff.ts:45` |
| **UI-4** | **The `x-access-scope` bitmap is computed here and consumed by backends** — `rolesToAccessScope` (READ 0x01/WRITE 0x02/ADMIN 0x04/TRADING 0x08); the bit meanings must stay in parity with every backend's `scope & 0x04` check. | UI is the producer of the header value backends gate on (root PLAT-5). | `src/lib/auth.ts:65-76`; forwarded `bffShared.ts:44` | `src/lib/auth.ts:65-76` |
| **UI-5** | **The `/accounts` segment deliberately uses plain Next REST route handlers, NOT the Connect `[...connect]` BFF** (a `NextRequest` isn't a Connect `HandlerContext`). Follow the local REST pattern there, not the BFF pattern. | The three other segments proxy via `createDispatch`; `/accounts` has no `[...connect]` route and no `accountsBff.ts`, and re-implements `backendHeaders` locally. | `src/app/accounts/api/authorized-apps/route.ts:7-17` | `src/app/accounts/api/authorized-apps/route.ts:11-17` |

## Gotchas & scars

- **On any `status >= 400` the BFF dispatch strips `content-encoding`/`grpc-encoding`/`content-length` and forces `content-type: application/json`** — a forwarded downstream `ConnectError` otherwise carries the gRPC response's content-type/encoding and the browser Connect client surfaces a generic "HTTP <status>" instead of the real validation message. Load-bearing for error-message fidelity; don't "simplify" it away. Evidence: `src/lib/bffShared.ts:133-144`.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| A canonical `Timestamp`→display helper should exist (DRY regime) but doesn't | 6+ hand-rolled conversions | a maintainer's intent (each render may want a different format) |
| `verifyAccessToken`/`refreshSession` cast JWT payload with no runtime schema validation | `auth.ts:14-23`, `identity.ts:19` (N=2) | the identity token contract — possibly an intentional trust boundary |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| DRY literal bans for header names + `0x04` (exempt `src/lib/{headers,auth}.ts`) | `.eslintrc.json:6-28` |
| Edge-runtime import trap (no `@connectrpc/connect-node` in `auth.ts`/middleware) | `src/lib/auth.ts:31-33`; CLAUDE.md |
| BFF handler-map key includes the segment prefix (no basePath stripping) | `src/lib/bffShared.ts:105-114`; CLAUDE.md |
| Middleware matcher must include `/` | `src/middleware.ts:11-14` |
| Vitest scope `src/lib/**`, 40% floor; e2e via Playwright | `vitest.config.ts:11-28`; CLAUDE.md |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
