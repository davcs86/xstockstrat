# Smoke user and the scoped-writes kill switch

`xstockstrat-smoke` calls backend RPCs as one dedicated, non-admin smoke user per staging environment
(`smoke.rpc.user_id`). Phase-2 checks may also write, but only the allowlisted portfolio watchlist RPCs and only
while `smoke.writes.enabled` is `true`. Contracts: `services/xstockstrat-smoke/CLAUDE.md`.

## Provision the smoke user (operator, once per environment)

1. Create a non-admin user with the trader role only (never `admin`, never the reserved `system` identity):

   ```bash
   uv run scripts/manage-users.py create-user smoke@<env>.xstockstrat.invalid --roles trader
   ```

2. Note the printed `user_id` and set it as the global staging value of `smoke.rpc.user_id` through the config
   service (`docs/runbooks/config-rollout.md`, admin-gated `SetConfig`). An empty value makes every RPC check `ERROR`.
3. The smoke user must own no broker account and nothing but `smoke-` fixtures: the janitor deletes the smoke user's
   watchlists whose name starts with `smoke-`, and fixtures are named `smoke-<run_id>-<hint>`.

## Kill switch `smoke.writes.enabled`

Seeded `false` (staging and production rows, global) by config migration `036_smoke_writes_enabled`. Writes are
allowed only when **all** hold: the RPC is in `SCOPED_WRITES` (`app/policy.py`), the request carries no
`strategy_id` / `default_strategy_id` binding, the flag is `true`, and `SMOKE_ENV` is `homelab-staging` or `do-dev`.
Anything else is refused with `MutatingRpcRefused` before a gRPC channel opens. Calls never carry the admin
access-scope bit.

- **Turn on / off:** `SetConfig` on `smoke.writes.enabled` in the `staging` environment. The service re-reads the flag
  on every RPC call, so a flip takes effect on the next call without a restart.
- **Turning it off mid-run** also refuses the cleanup deletes: that check ends `ERROR` with `cleanup: FAILED` and its
  fixture stays until the flag is back on and a check with the watchlist janitor runs.
- **Never** set it in the `production` environment; the smoke service does not run there, and the env-label guard
  refuses writes anyway.

## Allowlist approval — PENDING

`FR-9` requires the portfolio owner to approve the initial allowlist (`CreateWatchlist`, `UpdateWatchlist`,
`AddWatchlistSymbols`, `RemoveWatchlistSymbols`, `DeleteWatchlist`, request predicate "no strategy_id bindings").
That approval is **pending** and is not granted by this runbook or by the implementing session. Until it is recorded
in `docs/roadmap/features/280-smoke-check-runtime/context.md`:

- keep `smoke.writes.enabled` `false` in every environment;
- the reference write check stays in `services/xstockstrat-smoke/checks/_reference/`, which the catalog never serves
  (`_`-prefixed packages are linted but not loaded). Serving a write check means moving it to a non-underscore
  package after the approval.

## Verify

- `GET /checks` lists no `reference.*` check.
- With the flag `false`, a write check ends `ERROR` naming `MutatingRpcRefused`, and its record's
  `writes_performed` is empty.
- With the flag `true` in staging, the record's `writes_performed` lists each write, and `cleanup` is `OK`.
