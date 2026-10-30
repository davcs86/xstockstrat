# Staging smoke checks

`xstockstrat-smoke` runs a catalog of named post-deploy checks on **staging only** (homelab staging and DO dev); it is
absent from `.do/app.yaml` and the production homelab render. Contract and constants → `services/xstockstrat-smoke/CLAUDE.md`.

## Triggers

| Trigger | Mode | Where |
|---|---|---|
| DO dev `smoke-record` `POST_DEPLOY` job | record-only (exit 0 always) | `.do/app.dev.yaml` |
| Homelab staging deploy step | strict (exit 1 on red) | `deploy-homelab.yml` (later slice) |
| Staging agent `smoke_checks` tool | on demand | `docs/runbooks/mcp-tools.md` (later slice) |

Results are one JSON file per run on the orphan `smoke-results` branch: `smoke-results/<env>/<UTC>-<run_id>.json`.

## Local

`source scripts/mtls-dev-env.sh && docker compose up -d xstockstrat-smoke`; the API listens on `9110` (mutual TLS,
SAN allowlist `xstockstrat-agent`, `xstockstrat-smoke-trigger`).

## DO dev prerequisites (operator, not in this repo)

- GitHub secrets `DEV_SMOKE_RESULTS_PAT` (PAT confined by a ruleset to `smoke-results`) and `DEV_SMOKE_DB_PASSWORD`.
- The DB role: `docs/runbooks/smoke-db-role.md`; config key `smoke.rpc.user_id` set to the smoke user.
- The trigger leaf (`xstockstrat-smoke-trigger`) is minted on each deploy by `scripts/mint-smoke-trigger-leaf.sh` from the
  CA the deploy already holds; it is never in `gen-dev-certs.sh` `SERVICES`.

## Troubleshooting

- `SMOKE_TRIGGER_FAILED` / `SMOKE_RUN_LOST` / `SMOKE_RECORD_FAILED` in the `smoke-record` job log: record-only mode still exits 0.
- 403 from the API: the client leaf SAN is outside the allowlist. Handshake failure: no client certificate or wrong CA.
