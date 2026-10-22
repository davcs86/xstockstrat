# Defect: Edge reads are not owner-scoped — trader BFF ledger queryEvents and agent get_config / list_config_keys read other users' data

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: cross-tenant-data-read
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-ui, xstockstrat-ledger, xstockstrat-agent, xstockstrat-config
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-25, D-31 (both flagged security). Re-verified against main-dev @ a053b0e on 2026-10-21; current lines below.

## Observed

### D-25 — Trader BFF `queryEvents` forwards any non-copilot stream key to an unscoped ledger

The trader BFF rewrites only a `copilot:`-prefixed stream key to the caller's own thread. Any other request is
forwarded verbatim, including an arbitrary `stream_key` (e.g. `account:<someone else's id>`,
`portfolio:<other user id>`) or **no stream key at all**. Ledger `QueryEvents` filters only by the request's
`stream_key`, `event_type`, `source_service`, time range and sequence; it has no `user_id` or owner predicate.
Any signed-in trader can therefore page every user's ledger events (orders, fills, reconciliation, portfolio
events) from the browser. The in-repo callers show the exposure is live, not theoretical:
`usePositionLineage` queries with no stream key and filters other users' `order.filled` events out client-side
only, and `useReconciliationStatus` sends `account:${accountId}` with no ownership check. By contrast the
insights BFF forces `portfolio:${claims.user_id}` server-side.

### D-31 — MCP `get_config` / `list_config_keys` read any user's per-user overrides

Both agent tools accept a free `user_id` argument and pass it as the request-body `user_id` to config `GetConfig`
/ `ListKeys`. Config resolves the per-user overlay from the body `user_id`, never comparing it to the propagated
`x-user-id` (which the agent does send, from the verified caller). Any authenticated MCP user can read another
user's per-user override values (secret rows stay redacted, so the exposure is non-secret per-user config such as
strategy/alert/agent preferences) and enumerate which keys another user has overridden. `SetConfig` already
enforces "per-user writes only to the caller's own `user_id`" (`configServiceImpl.ts:394-403`); reads have no
equivalent gate.

## Expected

- D-25: the trader BFF only forwards stream keys the caller owns — an allow-list of per-user prefixes derived from
  the verified session (`copilot:`, `portfolio:<own id>`), an ownership check for `account:<id>` against the
  caller's broker accounts, and a refusal (`PERMISSION_DENIED`) for an empty or unrecognised stream key. Or
  equivalently, the ledger read is owner-scoped. A caller sees only their own events.
- D-31: a non-admin MCP caller can read only their own per-user overlay. `get_config` / `list_config_keys` with
  another user's `user_id` return `PERMISSION_DENIED` (or are bound to the caller's own id); admins keep
  cross-user read if design keeps that capability.

## Reproduction

1. D-25: sign in to `/trader` as user A. From the browser devtools, call the trader Connect endpoint
   `/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents` with body
   `{"streamKey": "account:<user B's account id>", "page": {"pageSize": 50}}`, or with `{"eventType":
   "order.filled", "page": {"pageSize": 100}}` and no stream key. User B's events are returned.
2. D-31: as a non-admin MCP user A, call `get_config(namespace="analysis", user_id="<user B id>")`. The response
   carries user B's per-user override values layered over global; `list_config_keys(namespace="analysis",
   user_id="<user B id>")` lists the keys user B has overridden.

## Evidence

### D-25 — Trader BFF `queryEvents` forwards any non-copilot stream key

`services/xstockstrat-ui/src/lib/traderBff.ts:118-126`
> queryEvents: async (req, ctx) => {
>   const claims = await requireSession(ctx);
>   const streamKey = req.streamKey?.startsWith(COPILOT_STREAM_PREFIX)
>     ? copilotStreamKey(claims.user_id)
>     : req.streamKey;
>   return ledgerClient.queryEvents(
>     { ...req, streamKey },

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-162` — conditions are built only from `streamKey`,
`eventType`, `sourceService`, `timeRange`, `fromSequence`; no owner predicate:
> const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
> `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}`,

Live callers: `services/xstockstrat-ui/src/hooks/usePositionLineage.ts:16-19` (no `streamKey`; owner filter is
client-side only), `services/xstockstrat-ui/src/hooks/useReconciliationStatus.ts:12-13`
(`streamKey: \`account:${accountId}\``). Contrast `services/xstockstrat-ui/src/lib/insightsBff.ts:148-157`
(forces `portfolio:${claims.user_id}`).

### D-31 — MCP `get_config` / `list_config_keys` read any user's overrides

`services/xstockstrat-agent/app/tools.py:1592`, `:1610` and `:1620`, `:1635-1636`
> async def get_config(namespace: str, user_id: str = "") -> dict:
> result = await client.get_config(namespace=namespace, environment=env, user_id=user_id)
> async def list_config_keys(namespace: str, user_id: str = "") -> dict:

`services/xstockstrat-agent/app/client.py:2043-2045`, `:2073-2075` — body `user_id` is the tool argument.

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:78-79`, `:317-319`, `:527-536` — reads take
`user_id` from the request body:
> return (req?.userId ?? req?.user_id ?? '') as string;
> const userId = requestUserId(call.request);
> WHERE namespace = $1 AND environment = $2 AND (user_id IS NULL OR user_id = $3)

## Root cause hypothesis

Owner scoping was implemented per edge as special cases (copilot rewrite in the trader BFF, a forced key in the
insights BFF, a per-user write gate in config `SetConfig`) rather than as a rule at the backend read: ledger
`QueryEvents` has no owner concept, and config reads trust the body `user_id` over the verified `x-user-id`.

## Confidence

high (both are direct reads of current code; the cross-user read is the straightforward consequence of the
unfiltered queries, not yet demonstrated against a live environment).
