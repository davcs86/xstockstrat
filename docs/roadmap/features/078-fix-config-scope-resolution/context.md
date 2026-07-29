# Context Log: fix-config-scope-resolution

Append-only.

---

## Session 2026-07-29 — predicted, verified, fixed

- **Predicted by the feature-073 design-adversary**, which reasoned from `stringEnums=true` that
  `resolveEnv`'s numeric map could not match a string constant, and flagged it as the same defect
  class as features 075/077.
- **Verified by execution**, not accepted on the argument: a probe test dialled a real
  `grpc.Server` and sent `ListKeys` with `environment: 'ENVIRONMENT_PRODUCTION'`,
  `tradingMode: 'TRADING_MODE_LIVE'`. The handler bound SQL parameters
  `["marketdata", "dev", "all"]`.
- Severity **SEV-1**, higher than its two siblings: this is not a metadata field being dropped, it
  is the service's central scoping contract failing silently on all four RPCs, in both directions,
  for every consumer on the platform.

### Why this went unnoticed for so long

The failure is *self-consistent*. Reads and writes both collapse to the same bucket, so
round-tripping through the service looks correct — you write `production`, you read back what you
wrote, because both silently went to `dev`. Only a caller that inspects the stored row's
`environment` column, or one that compares two scopes, could see it. Nothing did.

The existing unit tests hand-build requests as `{ environment: 1, trading_mode: 1 }` — numeric and
snake_case, i.e. the shape the handler *expected* rather than the one ts-proto produces — so they
passed against the bug and would have kept passing forever. Third instance of that trap in this
session (features 075, 077, 078), all with the same root cause and the same reason for surviving.

### Fix

`resolveEnv`/`resolveMode` accept both the string constant and the legacy numeric form; a new
`requestMode(req)` helper reads `tradingMode ?? trading_mode`. All four call sites use it. The
numeric branch is kept deliberately so the existing hand-built unit tests remain valid.

### Verification

| Gate | Result |
|---|---|
| red-before-green | 3 failures with the fix reverted → 36/36 with it |
| `pnpm test` | 36/36 |
| `pnpm lint` | 0 errors |
| coverage | 69.5% lines (threshold 40) |

### OUTSTANDING — operational, and the reason this needs care on deploy

Production has been reading **dev** config for as long as this bug has existed. After this fix each
service will start reading its actual `production` rows. Anywhere the two have drifted, behavior
changes at deploy time. Diff `config.config_values` between `environment='dev'` and `'production'`
before rolling out — this is a config change disguised as a bug fix.

## Session 2026-07-29 (later) — architecture confirmed by the user

User clarified: **`environment` and `trading_mode` stay env vars, not config values — but config
values are partitioned per environment.** That is exactly the model this fix restores, and the code
already implements the client half of it:

- `docker-compose.yml:15-17` — `APPLICATION_ENV` / `TRADING_MODE` live in the shared `common-env`
  anchor, so **every** service (agent included) carries its own deployment scope.
- `services/xstockstrat-config/src/services/configWatcher.ts:37-45` — the watcher reads those env
  vars, converts them to proto enums, and sends them on the `WatchConfig` request as
  `environment` / `tradingMode`. The Python and Go watchers do the same.
- `config.config_values` is keyed `(namespace, key, environment, trading_mode)` — the per-environment
  partition.

So the scope selector was never a config value and must not become one. **The client half was
always correct; the server half was misreading it.** A service deployed with
`APPLICATION_ENV=production` sent `ENVIRONMENT_PRODUCTION` and the server answered with the `dev`
bucket. This fix makes the env-var-derived scope actually take effect — it does not introduce a new
mechanism, it makes the existing one work.

**Confirms the fix direction; no change to the fix.** Recorded because a future reader might
otherwise "simplify" by moving scope into config, which would invert the intended architecture.

### Consequence for feature 073

Since every service — including `xstockstrat-agent` — already knows its own scope from env vars,
073's tools must **default** `environment`/`trading_mode` to the agent's `APPLICATION_ENV` /
`TRADING_MODE` rather than letting the proto zero-values decide. Without that, an operator who omits
the parameter writes a `dev` row from a production agent (product-spec Known Constraint 1). Folded
into 073's spec.
