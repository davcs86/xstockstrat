# xstockstrat-ui — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; citations re-grounded 2026-08-27.
Captures the **non-obvious** local invariants of the consolidated Next.js UI + gRPC BFF (`/trader`,
`/insights`, `/config-ui`, `/accounts`; HTTP 3000). The service CLAUDE.md is thorough, so this file
holds the asymmetries and scars the docs *don't* state. Does not restate documented/CI-enforced rules
(see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ui**.

## Rules (`UI-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **UI-1** | **A canonical Timestamp→millis/Date helper exists (`src/lib/protoTime.ts`, since feature 068) but adoption is partial — always call `timestampToMillis`/`timestampToDate`, never hand-roll a `ts.seconds * 1000` / `new Date(ts)` conversion.** protobuf-es `Timestamp` is `{seconds: bigint, nanos: number}`: `ts.seconds * 1000` throws `Cannot mix BigInt`, and `new Date(ts)` isn't a Date. | Several call sites still hand-roll the conversion (the exact set drifts with every feature — don't maintain a count; grep `\.seconds \* 1000`/`Number(.*\.seconds` before copying a neighbor). Copying a hand-rolled site instead of the helper perpetuates the drift. | canonical `src/lib/protoTime.ts` (+ `protoTime.test.ts`); a hand-rolled site to *not* copy: `src/lib/chart.ts:45` (`Number(b.time.seconds)`) | `src/lib/protoTime.ts` |
| **UI-2** | **Browser typed clients are named per (service × segment) and hard-bound to that segment's BFF `baseUrl`** — import the client whose baseUrl matches the segment the component renders under. | `analysisClient` (`/insights/api`) vs `traderAnalysisClient` (`/trader/api`): importing the wrong one marshals to a BFF handler map with no matching entry → **404**. Since feature 153 both build on `makeBrowserTransport(baseUrl)` rather than a bare `createConnectTransport`. | `src/lib/browserClients/analysisClient.ts:5` (`'/insights/api'`) vs `traderAnalysisClient.ts:6` (`'/trader/api'`) (~16 files in `src/lib/browserClients/`, growing) | `src/lib/browserClients/traderAnalysisClient.ts:6` |
| **UI-3** | **BFF handlers use the `forward`/`forwardAdmin` combinators; explicit bodies exist only to inject the verified session `userId` (`{ ...req, userId: claims.user_id }`) or to stream — never trust a body-supplied user.** | The pre-DRY inline `requireSession`+`backendHeaders` shape trips the DRY guard rail; forgetting the `userId` injection on a mutating call opens an IDOR (treated as a security invariant). | defs `src/lib/bffShared.ts:63-78`; injection `src/lib/traderBff.ts:32,39,49,58,65,82,96,105` (+`src/lib/insightsBff.ts:109,119,126`) | `src/lib/traderBff.ts:49` |
| **UI-4** | **The `x-access-scope` bitmap is computed here and consumed by backends** — `rolesToAccessScope` (READ 0x01/WRITE 0x02/ADMIN 0x04/TRADING 0x08); the bit meanings must stay in parity with every backend's `scope & 0x04` check. | UI is the producer of the header value backends gate on (root PLAT-5). | `src/lib/auth.ts:98-110` (`rolesToAccessScope`, `ADMIN_SCOPE=0x04` at `:96`, bits `:99-106`, `hasAdminScope:112-113`); forwarded `bffShared.ts:44` | `src/lib/auth.ts:98-110` |
| **UI-5** | **The `/accounts` segment deliberately uses plain Next REST route handlers, NOT the Connect `[...connect]` BFF** (a `NextRequest` isn't a Connect `HandlerContext`). Follow the local REST pattern there, not the BFF pattern. | The three other segments proxy via `createDispatch`; `/accounts` has no `[...connect]` route and no `accountsBff.ts`. The backend-header builder was DRY-extracted to `src/lib/restBackendHeaders.ts` (feature-127/finding-driven) and is **imported**, not re-implemented locally — reuse it. | route handler `src/app/accounts/api/authorized-apps/route.ts` (imports `restBackendHeaders` at `:5`); shared builder `src/lib/restBackendHeaders.ts:11` | `src/lib/restBackendHeaders.ts:11` |
| **UI-6** | **`SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` is retry-eligible signal, not an error.** The insights screener gates its background re-scan poll on rows carrying it (`pendingRows.length > 0`) and renders warning/pending badges; `ScreenResult.score_unavailable` (feature 144) is the *distinct* permanent "no usable criteria" case. Never treat INSUFFICIENT_DATA as a failure or collapse the two. | Overloading it for a permanent gap mis-signals "will resolve, keep polling"; treating it as an error stops the auto-recheck loop that fills scores in as bars/fundamentals catch up (features 118/144). The analysis producer side of this contract is recorded in the analysis constitution (feature-144 scar). | `src/app/insights/screener/page.tsx:128` (`pendingRows`), poll gate `:134`, INSUFFICIENT_DATA render `:271-274` (also `:255`), `scoreUnavailable:198,274`; shared poll predicate `src/hooks/useScreenSymbols.ts:21`; trader consumer `src/components/trader/SymbolScreening.tsx:71` | `src/app/insights/screener/page.tsx:128` |

## Gotchas & scars

- **On any `status >= 400` the BFF dispatch strips `content-encoding`/`grpc-encoding`/`content-length` and forces `content-type: application/json`** — a forwarded downstream `ConnectError` otherwise carries the gRPC response's content-type/encoding and the browser Connect client surfaces a generic "HTTP <status>" instead of the real validation message. Load-bearing for error-message fidelity; don't "simplify" it away. Evidence: `src/lib/bffShared.ts:139-143` (comment `:133-138`).
- **`#901`/`#884` — config-value staleness after save (see `xstockstrat-config`'s CONFIG-6/7/PROTO-5).** `NamespaceEditor`'s Value column and edit-prefill originally read `ConfigKeyMeta.defaultValue` (never updated by `SetConfig`), so every successful save *looked* like a silent no-op until `currentValue` was added (used at `src/app/config-ui/[namespace]/NamespaceEditor.tsx:216`); separately, Save on a `trading_mode='all'` row failed until the page started echoing the row's own registered scope instead of its viewed filter. A future config-metadata read must use `currentValue`, and a future Save must echo the row's own scope, not the page's filter state.
- **`63a3655` — strategy pickers must filter on `live_enabled`, not just `active`.** The Decide "why this fired" picker and the Watchlists per-symbol strategy binding both listed every `active` strategy regardless of `live_enabled`. The real trading loop was independently verified already-correct — this was a read-surface-only gap.
- **`d92960b` — `symbolLocked` is the canonical convention for a page keyed to one fixed symbol.** Signal-detail's `OrderForm` symbol field was fully editable despite the whole page (chart/conviction/edge) being keyed to one symbol; the fix introduced `symbolLocked` (`OrderForm.tsx:76`, `const symbolLocked = Boolean(initialSymbol)`) as the pattern any future single-symbol-context order ticket should reuse rather than reinventing.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| `verifyAccessToken`/`refreshSession` cast JWT payload with no runtime schema validation | `auth.ts:30` (`payload as unknown as JwtClaims`), `identity.ts:19` (`data.claims as unknown as JwtClaims`) (N=2) | the identity token contract — possibly an intentional trust boundary |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| DRY literal bans for header names + `0x04` (exempt `src/lib/{headers,auth}.ts`) | `.eslintrc.json:6-28` |
| Edge-runtime import trap (no `@connectrpc/connect-node` in `auth.ts`/middleware) | `src/lib/auth.ts:31-33`; CLAUDE.md |
| BFF handler-map key includes the segment prefix (no basePath stripping) | `src/lib/bffShared.ts:106-119` (`handlerMap` key `:114`); CLAUDE.md |
| Middleware matcher must include `/` | `src/middleware.ts:11-12` |
| Vitest scope `src/lib/**`, 40% floor; e2e via Playwright | `vitest.config.ts:25-31`; CLAUDE.md |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
