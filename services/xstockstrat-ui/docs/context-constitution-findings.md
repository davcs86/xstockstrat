# xstockstrat-ui — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`). For triage/fixing, not governance.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `src/lib/basepath.ts` is the canonical home for segment base paths | Defines only `TRADER`/`INSIGHTS`/`CONFIG_UI` — no `BASE_PATH_ACCOUNTS` though `/accounts` is a shipped fourth segment | `src/lib/basepath.ts` | Add `BASE_PATH_ACCOUNTS` or document the omission |
| Module CLAUDE.md cites `insights/market/[symbol]` as a live route in TWO places (§ "Opportunities-first shell → Decide screens": "the Signal-detail page `insights/market/[symbol]`"; § Styling charting bullet: "`insights/market/[symbol]/page.tsx` renders **no** chart") | The page was retired by feature 125 and its logic relocated onto `/trader/positions/[symbol]` — `Glob src/app/insights/market/**` returns zero files | `src/components/insights/MuteForStrategy.tsx:16-16` (documents the relocation) vs CLAUDE.md § Decide screens + § Styling; note this contradicts the *newer* "Sanctioned exception" block in the same file, which correctly names `/trader/positions/[symbol]` | Update both references to `/trader/positions/[symbol]` (or drop the charting parenthetical) |
| `CLAUDE.md` header blurb advertises "⚠ audit-route admin gap"; § Database says the DB connection is "part of the platform's 20-connection budget"; § Key File Paths labels `src/lib/auth.ts` "Edge-safe auth" | The audit gap was fixed 2026-09-16 (`audit/route.ts` returns 403 for non-admins via `hasAdminScope`); the root budget is ~22; `auth.ts` has been Node-safe since feature 128 (per the same file's § Auth+BFF) | `src/app/config-ui/api/audit/route.ts`; root `CLAUDE.md` § Connection Pool Budget | Refresh the three lines |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~⚠ **security** — `config-ui/api/audit/route.ts` gated on `getSessionFromRequest` only (any authenticated user), no admin-scope check — any logged-in `viewer` could read `config.config_audit`~~ **RESOLVED 2026-09-16 (security audit, H-6)** | Fixed — the route now returns `403` for non-admins via `hasAdminScope(claims.roles)`, mirroring the `configUiBff.ts` `requireAdminScope` gate | `src/app/config-ui/api/audit/route.ts` (admin check immediately after the session check) |
| ⚠ **test fidelity (narrowed 2026-10-14)** — `e2e/mock-backend.ts` still does not model backend-side **admin-scope** aborts (its comment says non-admin denial is the BFF's job), so the suite cannot regression-detect backend admin gating for any RPC. The earlier specific claim (`e2e/config-ui/sources.spec.ts` asserting 200 for `manageSignalSource` while the real servicer aborts) no longer reproduces as written: since feature 224 the mock's `manageSignalSource` models owner semantics (`PermissionDenied` on system-owned sources, `userId` assigned on register, `NotFound` on non-owned) and `configUiBff.ts` routes it through plain `forward()` with no admin gate. | e2e cannot be relied on to catch a missing backend admin gate | `e2e/mock-backend.ts#manageSignalSource`, `src/lib/configUiBff.ts` |
| **Non-admin users still see a functional config-ui Edit/Save affordance.** Since feature 074, `SetConfig` is admin-gated at both the BFF and the RPC, but the namespace editor gates the Edit/Save buttons only on `isSecret` — a viewer/trader can still open the editor and only learns on submit, via a raw `Save error: Admin scope required`. `useIsAdmin()` is unused in `[namespace]/NamespaceEditor.tsx` (it IS used elsewhere in the segment: `config-ui/sources/page.tsx` and `config-ui/templates/page.tsx`, both with an "Admin only" `CardNotice`). Same class as the audit-route row above. **Moved 2026-08-09**: the logic that was `src/app/config-ui/[namespace]/page.tsx` lives in the new `NamespaceEditor.tsx` component (feature 119/120 shadcn migration) — page.tsx is now a thin wrapper. Confirmed the gap still reproduces there (no `useIsAdmin` import). | Misleading affordance; poor error UX, not an authorization hole | `src/app/config-ui/[namespace]/NamespaceEditor.tsx`; `src/hooks/useLiveStrategies.ts` (`useIsAdmin`) |
| ~~The `/accounts` REST routes re-implement `backendHeaders` locally~~ **RESOLVED 2026-08-27** — the local duplicate was extracted to the shared `src/lib/restBackendHeaders.ts` (imported at `route.ts:5`); the DRY divergence is closed (this also updated constitution UI-5, which had described the local re-implementation) | Resolved | `src/lib/restBackendHeaders.ts:9`, imported `src/app/accounts/api/authorized-apps/route.ts:5` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `PortfolioPanel.tsx`'s multi-account/combined fall-through (`:117-160`) | `AccountContext` auto-selects the first active account (`AccountContext.tsx:36-40`), so `selectedAccountId` is virtually always set and the `if (selectedAccountId)` early-return (`:21`) wins — the combined branch is effectively unreachable in normal operation. The authoritative combined "Book" surface is `src/app/trader/portfolio/page.tsx` (`usePortfolios(null)`, `:28-29`). Edit the page, not the dead branch. (surfaced 2026-08-26, feature 159 archive) | `src/components/trader/PortfolioPanel.tsx:21,117-160`; `src/context/AccountContext.tsx:36-40`; `src/app/trader/portfolio/page.tsx:27-28` |
| Duplicate test file: `src/lib/insightsBff.test.ts` and `src/lib/__tests__/insightsBff.test.ts` both match vitest's `src/**/*.test.ts` include | Possibly an accidental duplicate — check overlap before deleting | `src/lib/insightsBff.test.ts`, `src/lib/__tests__/insightsBff.test.ts` |

## Open questions (unresolved *why* — needs a maintainer)

- `config-ui/api/audit/route.ts` returns `{ entries: [] }` (200) silently when `DATABASE_URL` is unset — is a silent empty audit log the intended dev-mode behavior, or should it signal misconfiguration? `src/app/config-ui/api/audit/route.ts:46-48` — status: **open** (note: the bigger SSL-missing bug that caused "always empty" in DO was fixed; this item is about the deliberate graceful-degradation path for unset `DATABASE_URL` only)
- Is the `>= 400` header/encoding normalization (UI gotcha) still required with `@connectrpc` 2.x, or a workaround droppable on upgrade? `src/lib/bffShared.ts:132-136` — status: **open**
- `insightsBff.ts#listOpportunities` hardcodes `timeoutMs: 30_000` while other deadlines use the named `FUNDAMENTALS_TIMEOUT_MS` — a deliberate separate budget, or should it be a shared named constant? — status: **open**
- `src/lib/scoreDisplay.ts` duplicates `TRADING_DAYS_PER_YEAR = 252` from analysis's `_compute_metrics` (comment: deliberate) and encodes the composite's neutral band (`COMPOSITE_NEUTRAL_BAND = 0.08`, `COMPOSITE_NEUTRAL = 0.5`, tied to analysis's k=1 shrinkage range ≈0.25–0.83, feature 221) — is there a parity test, and should this be a documented cross-module contract with analysis? — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
