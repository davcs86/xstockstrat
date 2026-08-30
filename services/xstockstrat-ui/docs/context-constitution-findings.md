# xstockstrat-ui — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `src/lib/basepath.ts` is the canonical home for segment base paths | Defines only `TRADER`/`INSIGHTS`/`CONFIG_UI` — no `BASE_PATH_ACCOUNTS` though `/accounts` is a shipped fourth segment | `src/lib/basepath.ts` | Add `BASE_PATH_ACCOUNTS` or document the omission |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ⚠ **security** — `config-ui/api/audit/route.ts` is commented "Admin-only audit endpoint" but gates on `getSessionFromRequest` only (any authenticated user), with **no admin-scope check** — any logged-in `viewer` can read `config.config_audit` | Authorization gap on an admin audit surface | `src/app/config-ui/api/audit/route.ts:20` (`getSessionFromRequest` only, comment "Admin-only" `:10-12`) — fix: add `requireAdminScope`/`hasAdminScope(claims.roles)` |
| ⚠ **test fidelity** — `e2e/mock-backend.ts` does not model backend-side admin gates. `e2e/config-ui/sources.spec.ts` asserts **200** for `manageSignalSource` on a non-admin cookie, but the real `xstockstrat-ingest` servicer aborts `PERMISSION_DENIED` for that call. The suite is therefore green on a flow production denies, and cannot regression-detect backend admin gating for **any** RPC. Surfaced by feature 074. | e2e cannot be relied on to catch a removed/broken backend role check | `e2e/mock-backend.ts`; `e2e/config-ui/sources.spec.ts` vs `services/xstockstrat-ingest/app/handlers/servicer.py` (`ManageSignalSource` admin abort) |
| **Non-admin users still see a functional config-ui Edit/Save affordance.** Since feature 074, `SetConfig` is admin-gated at both the BFF and the RPC, but the namespace editor gates the Edit/Save buttons only on `isSecret` — a viewer/trader can still open the editor and only learns on submit, via a raw `Save error: Admin scope required`. `useIsAdmin()` exists and is unused in this segment. Same class as the audit-route row above. **Moved 2026-08-09**: the logic that was `src/app/config-ui/[namespace]/page.tsx` lives in the new `NamespaceEditor.tsx` component (feature 119/120 shadcn migration) — page.tsx is now a thin wrapper. Confirmed the gap still reproduces there (no `useIsAdmin` import). | Misleading affordance; poor error UX, not an authorization hole | `src/app/config-ui/[namespace]/NamespaceEditor.tsx`; `src/hooks/useLiveStrategies.ts` (`useIsAdmin`) |
| ~~The `/accounts` REST routes re-implement `backendHeaders` locally~~ **RESOLVED 2026-08-27** — the local duplicate was extracted to the shared `src/lib/restBackendHeaders.ts` (imported at `route.ts:5`); the DRY divergence is closed (this also updated constitution UI-5, which had described the local re-implementation) | Resolved | `src/lib/restBackendHeaders.ts:11`, imported `src/app/accounts/api/authorized-apps/route.ts:5` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `PortfolioPanel.tsx`'s multi-account/combined fall-through (`:117-160`) | `AccountContext` auto-selects the first active account (`AccountContext.tsx:36-40`), so `selectedAccountId` is virtually always set and the `if (selectedAccountId)` early-return (`:21`) wins — the combined branch is effectively unreachable in normal operation. The authoritative combined "Book" surface is `src/app/trader/portfolio/page.tsx` (`usePortfolios(null)`, `:28-29`). Edit the page, not the dead branch. (surfaced 2026-08-26, feature 159 archive) | `src/components/trader/PortfolioPanel.tsx:21,117-160`; `src/context/AccountContext.tsx:36-40`; `src/app/trader/portfolio/page.tsx:28-29` |

## Open questions (unresolved *why* — needs a maintainer)

- `config-ui/api/audit/route.ts` returns `{ entries: [] }` (200) silently when `DATABASE_URL` is unset — is a silent empty audit log the intended dev-mode behavior, or should it signal misconfiguration? `src/app/config-ui/api/audit/route.ts:29-30` — status: **open**
- Is the `>= 400` header/encoding normalization (UI gotcha) still required with `@connectrpc` 2.x, or a workaround droppable on upgrade? `src/lib/bffShared.ts:139-143` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
