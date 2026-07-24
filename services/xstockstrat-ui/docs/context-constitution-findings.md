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
| ⚠ **security** — `config-ui/api/audit/route.ts` is commented "Admin-only audit endpoint" but gates on `getSessionFromRequest` only (any authenticated user), with **no admin-scope check** — any logged-in `viewer` can read `config.config_audit` | Authorization gap on an admin audit surface | `src/app/config-ui/api/audit/route.ts:11,20-23` — fix: add `requireAdminScope`/`hasAdminScope(claims.roles)` |
| The `/accounts` REST routes re-implement `backendHeaders` locally (dup of `bffShared.ts:41-47`) | A live DRY divergence — the header builder can drift from the canonical one | `src/app/accounts/api/authorized-apps/route.ts:11-17` |

## Open questions (unresolved *why* — needs a maintainer)

- `config-ui/api/audit/route.ts` returns `{ entries: [] }` (200) silently when `DATABASE_URL` is unset — is a silent empty audit log the intended dev-mode behavior, or should it signal misconfiguration? `src/app/config-ui/api/audit/route.ts:28-30` — status: **open**
- Is the `>= 400` header/encoding normalization (UI gotcha) still required with `@connectrpc` 2.x, or a workaround droppable on upgrade? `src/lib/bffShared.ts:133-144` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
