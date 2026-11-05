# Defect: Agent and UI CLAUDE.md / tool docstring drift from current code

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-agent, xstockstrat-ui
**Config-only fix possible**: no
**Source**: `services/xstockstrat-agent/docs/context-constitution-findings.md` (Documentation that lies — additions; Latent bugs row 1 RESOLVED); `services/xstockstrat-ui/docs/context-constitution-findings.md` (Documentation that lies rows 1–2; enum-map gotcha in `services/xstockstrat-ui/docs/context-constitution.md`); plus two found during re-grounding

## Observed
Seven stale claims, each contradicted by current code:
1. Agent `set_config` tool docstring (read by the LLM) says secrets are global-only and a per-user secret write is rejected — feature 224 allows per-user secrets, and the agent itself writes one.
2. Agent CLAUDE.md header lists the `namespace="agent"` hardcode as an open defect — resolved by feature 093.
3. Agent CLAUDE.md says only `trigger_backfill` hits a backend admin gate — `cancel_backfill`, `run_fundamentals_scan` and global `set_config` writes are admin-gated too.
4. UI CLAUDE.md header advertises "⚠ audit-route admin gap" (fixed; route returns 403), § Database cites a "20-connection budget" (root says ~22), Key File Paths labels `auth.ts` "Edge-safe auth" (Node-safe since feature 128).
5. UI CLAUDE.md mTLS blurb says "The gRPC server binds mutual TLS" and the service "refuses to start" — the UI has no gRPC server, and fail-closed happens lazily at first dial.
6. UI CLAUDE.md calls `basepath.ts` the canonical `BASE_PATH_*` home — no `BASE_PATH_ACCOUNTS` exists although `/accounts` is a shipped segment (hardcoded in nav).
7. UI CLAUDE.md enum-map list names five maps; `opportunityShared.tsx` has six (`FUNDAMENTALS_GAP` missing).

## Expected
Each doc line matches the code; per-user secrets documented as allowed; full admin-gated tool list; no stale defect blurbs.

## Reproduction
1. Read each doc line under Evidence.
2. Compare with the paired code line quoted beneath it.

## Evidence
`services/xstockstrat-agent/app/tools.py:1666-1667`
> `set that user's per-user override. Secret keys are global-scope only — a per-user write to`
> `a secret key is rejected INVALID_ARGUMENT by the backend.`

`services/xstockstrat-agent/app/tools.py:357-358`
> `        user_id=_caller_user_id(ctx, tool),`
> `        is_secret=True,`

`services/xstockstrat-agent/CLAUDE.md:4`
> `defects (\`namespace="agent"\` hardcode, \`MCP_TRANSPORT\` stdio default)`

`services/xstockstrat-agent/CLAUDE.md:101`
> `One management **write** tool still hits a backend **admin** gate — \`trigger_backfill\` — and`

`services/xstockstrat-ingest/app/handlers/servicer.py:878` (CancelBackfill)
> `        if not self._has_admin_scope(context):`

`services/xstockstrat-analysis/app/handlers/servicer.py:3818` (RunFundamentalsScan)
> `        if not self._has_admin_scope(context):`

`services/xstockstrat-ui/CLAUDE.md:4`
> `defects (⚠ audit-route admin gap, missing \`BASE_PATH_ACCOUNTS\`)`

`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts:45`
> `  if (!hasAdminScope(claims.roles)) {`

`services/xstockstrat-ui/CLAUDE.md:262`
> `part of the platform's 20-connection budget (root CLAUDE.md § Connection Pool Budget)`

`services/xstockstrat-ui/CLAUDE.md:399`
> `| Edge-safe auth | \`src/lib/auth.ts\` |`

`services/xstockstrat-ui/CLAUDE.md:278`
> `The gRPC server binds mutual TLS and every outbound gRPC dial presents the leaf; **fail-closed** — the service refuses to start if any is absent.`

`services/xstockstrat-ui/src/lib/connectClients.ts:46-47`
> `// LAZY: the real transport (and loadMtls) is built on the FIRST RPC, not at module load — \`next build\``

`services/xstockstrat-ui/CLAUDE.md:233`
> `| \`src/lib/basepath.ts\` | shared | **Canonical** segment base paths (\`BASE_PATH_*\`) for cross-segment links/fetches. |`

`services/xstockstrat-ui/src/lib/basepath.ts:1-3`
> `export const BASE_PATH_TRADER = '/trader';` … `export const BASE_PATH_CONFIG_UI = '/config-ui';`

`services/xstockstrat-ui/CLAUDE.md:160`
> `` `Record<Enum, EnumRender>` maps (`OPPORTUNITY_ACTION`, `CONDITION_STATE`, `POSITION_RISK_FLAG`, ``

`services/xstockstrat-ui/src/lib/opportunityShared.tsx:40`
> `export const FUNDAMENTALS_GAP: Record<FundamentalsGap, EnumRender> = {`

## Root cause hypothesis
Doc refreshes lagged features 087/093/128/156/215/224 and the audit-route fix; the mTLS blurb was
copied from backend-service boilerplate into a client-only service.

## Confidence
high
