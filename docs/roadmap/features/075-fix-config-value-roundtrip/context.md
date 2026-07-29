# Context Log: fix-config-value-roundtrip

Append-only. Each session appends a new ## Session entry.

---

## Session 2026-07-29 — triage (split out of feature 073's review)

- Both defects were surfaced by `/sdd-review 073 product-spec` and then **confirmed directly in the
  code** this session (not taken on the reviewer's word).
- Split into their own bug feature rather than bundled into 073, following the precedent set when
  074 (`fix-config-write-authz`) was split out of 073's FR-7 for the same reason: they are
  pre-existing defects, independent of whether 073 ever ships, and 073 is merely the first consumer
  to depend on them being correct.
- Severity SEV-2, not SEV-1: defect 1 corrupts config values written through the UI (data
  correctness, no trading halt); defect 2 is latent — it has no consumer today because `/config-ui`
  happens to read `isSecret` from `ListKeys` instead of the snapshot.
- Relationship to 073: **073's FR-1 redaction cannot be implemented correctly until defect 2 is
  fixed.** 073 must consume this fix, not reimplement it.

## Session 2026-07-29 — fix implemented

Both defects fixed in `services/xstockstrat-config/src/grpc/configServiceImpl.ts`:

- **Defect 1** — `setConfig` now stores `extractValueData(value)` (the bare scalar) instead of
  `JSON.stringify(value)`, and `inferValueType` accepts **both** the camelCase wire shape and the
  snake_case DB shape, so int/float/bool writes are typed correctly instead of all landing as
  `'string'`.
- **Defect 2** — `buildConfigValue` now carries `is_secret` from the DB row, and
  `toProtoSnapPayload` carries it onto the wire as `isSecret`. `GetConfig`/`WatchConfig` now report
  secrets truthfully.

New test file `src/__tests__/configValueRoundtrip.test.ts`. The write cases run over a **real gRPC
connection** so the request is the genuine ts-proto camelCase wire shape — a hand-built snake_case
request is exactly what let this bug hide (and is already logged as a false-confidence trap in the
service's findings doc).

**Red-before-green:** 6 failures with the fix reverted → 26/26 with it. Coverage rose 51.7% → 67.4%
lines. Lint 0 errors.

### Incidental fix — feature 074 shipped a lint failure

The DRY rails 074 added to `.eslintrc.json` fire on `src/__tests__/**`, and 074's own new test file
inlined `'x-access-scope'`/`'x-user-id'`/`0x04`. I ran `pnpm lint` after 074's step 2 but not after
step 3 created the test, so 13 lint errors were committed. Both test files now import the constants
from `authz.ts`. Caught here rather than in CI.

### AC-5 / backfill — NOT resolved

Rows already written through the broken `SetConfig` still hold `{"stringVal":…}` blobs. No data
migration ships with this fix, because the number of affected rows cannot be determined from the
repo — it needs a look at real dev/prod data. The fix stops new corruption; it does not repair
existing rows. **This is the outstanding item on this feature**, recorded rather than silently
skipped: a `SELECT key, value_data FROM config.config_values WHERE value_data LIKE '{%Val%}'` on
each environment will size it.
