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
