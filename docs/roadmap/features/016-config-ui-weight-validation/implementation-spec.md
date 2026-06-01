# Implementation Spec: config-ui-weight-validation

**Status**: `pending`
**Created**: 2026-06-01
**Feature**: `docs/roadmap/features/016-config-ui-weight-validation/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/config-ui-weight-validation`

---

## Execution Summary

This feature adds proto-declared validation rules to the `ConfigKeyMeta` message so the
config-ui editor can enforce value bounds client-side. Step 1 adds the new `ValidationRule`
message and enum to `packages/proto/config/v1/config.proto`. Step 2 regenerates all stubs.
Step 3 updates `xstockstrat-config`'s `listKeys` handler to populate the `validation` field
for known weight keys. Step 4 adds a test for the updated handler. Steps 5 and 6 update
the `xstockstrat-config-ui` namespace page to read the new field, validate inputs, and
gate the save button — plus the corresponding E2E test.

**Implementation target note**: The product spec says the UI target is `xstockstrat-ui`
(post-045 consolidation), but feature 045 (`ui-consolidation-nextjs`) is still in `draft`
status and `services/xstockstrat-ui` does not exist in the codebase. Steps 5–6 therefore
target `xstockstrat-config-ui` (the current service that owns the weight editor at
`app/[namespace]/page.tsx` and `app/sources/page.tsx`). If 045 merges before this feature
branch is completed, the branch must be rebased and the file paths in Steps 5–6 updated to
the consolidated service.

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`) to be committed first.
- Step 3 (`service`) requires Step 2 (`proto-gen`) so the updated `ConfigKeyMeta` TypeScript
  type is available to the Node.js config service.
- Step 4 (`test`) requires Step 3 (`service`).
- Step 5 (`service`) requires Step 2 (`proto-gen`) so the `ValidationRule` type is available
  in the `@xstockstrat/proto` package consumed by `xstockstrat-config-ui`.
- Step 6 (`test`) requires Step 5 (`service`).

---

### Step 1 — proto: Add ValidationRule message and validation field to ConfigKeyMeta

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/config/v1/config.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, `buf lint` + `buf breaking` passes; `xstockstrat-config` owner — Config key naming, WatchConfig stream stability, validation field population correctness; `xstockstrat-config-ui` owner (`test`) — Config mutation safety, validation UX correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed current `ConfigKeyMeta` message in `packages/proto/config/v1/config.proto` at line 99 with fields `key = 1`, `description = 2`, `default_value = 3`, `is_secret = 4`, `consuming_service = 5`, `environment = 6`, `trading_mode = 7` — highest field number is `7`.
- Confirmed `ConfigUpdateType` enum is the only existing top-level enum in the file; new `ValueType` enum must follow it.
- `buf.yaml` `lint.except` list: `PACKAGE_DIRECTORY_MATCH`, `RPC_RESPONSE_STANDARD_NAME`, `RPC_REQUEST_RESPONSE_UNIQUE` — no exceptions that affect new message/enum additions.

**Instructions**:

1. Add a new `ValueType` enum immediately after the `ConfigUpdateType` enum (currently ending around line 65 of the proto):
   ```protobuf
   enum ValueType {
     VALUE_TYPE_UNSPECIFIED = 0;
     VALUE_TYPE_FLOAT_MAP = 1;
   }
   ```

2. Add a new `ValidationRule` message immediately after the `ValueType` enum:
   ```protobuf
   // Validation constraints declared by the config service for a key.
   // When value_type == VALUE_TYPE_FLOAT_MAP, every numeric leaf in the JSON value
   // must satisfy [min_value, max_value]. Absent or VALUE_TYPE_UNSPECIFIED = no validation.
   message ValidationRule {
     ValueType value_type = 1;
     float min_value = 2;
     float max_value = 3;
   }
   ```

3. Add an optional `validation` field as field number `8` to `ConfigKeyMeta` (the last existing field is `trading_mode = 7`):
   ```protobuf
   message ConfigKeyMeta {
     string key = 1;
     string description = 2;
     string default_value = 3;
     bool is_secret = 4;
     string consuming_service = 5;
     xstockstrat.common.v1.Environment environment = 6;
     xstockstrat.common.v1.TradingMode trading_mode = 7;
     ValidationRule validation = 8;  // optional; absent = no validation
   }
   ```

4. Do not modify any other messages, services, RPCs, or field numbers.

**Verification**:
```bash
cd /home/user/xstockstrat/packages/proto
buf lint
buf breaking --against ".git#branch=feature/config-ui-weight-validation"
```
Expected: both commands exit 0 with no diagnostics. If the feature branch does not yet exist
on origin, run against `main-dev`:
```bash
buf breaking --against ".git#branch=main-dev"
```

---

### Step 2 — proto-gen: Regenerate stubs after ValidationRule addition

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/config/v1/config_pb.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/config/v1/config_pb.d.ts` — modify (regenerated)
- `packages/proto/gen/go/config/v1/config.pb.go` — modify (regenerated)
- `packages/proto/gen/python/` (config stubs if any) — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, `buf lint` + `buf breaking` passes; `xstockstrat-config` owner — Config key naming, WatchConfig stream stability, validation field population correctness; `xstockstrat-config-ui` owner (`test`) — Config mutation safety, validation UX correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed `./scripts/buf-gen.sh` is the codegen entry point (referenced in CLAUDE.md §Generating Proto Stubs and `docs/runbooks/proto-versioning.md`).
- Current generated TS stub is `packages/proto/gen/ts/config/v1/config_pb.ts` — confirmed at path. The `ConfigKeyMeta` type currently has 7 fields (key through tradingMode, confirmed at lines 327–362 of the current stub).
- `config_connect.ts` at `packages/proto/gen/ts/config/v1/config_connect.ts` — confirmed present; unchanged by codegen as it describes services/RPCs only.

**Instructions**:

1. Run `./scripts/buf-gen.sh` from the repo root.
2. Verify `packages/proto/gen/ts/config/v1/config_pb.ts` now contains:
   - A `ValueType` enum export
   - A `ValidationRule` type and `ValidationRuleSchema` constant
   - The `ConfigKeyMeta` type has a new `validation?: ValidationRule | undefined` field
3. Verify `packages/proto/gen/go/config/v1/config.pb.go` now contains:
   - A `ValueType` type and `ValueType_VALUE_TYPE_*` constants
   - A `ValidationRule` struct with `GetValueType()`, `GetMinValue()`, `GetMaxValue()` accessors
   - `GetValidation()` accessor on `ConfigKeyMeta`
4. Stage all changed files under `packages/proto/gen/` and commit together with the Step 1
   proto source change as a single commit per the proto-versioning runbook rule ("proto source
   + generated stubs together in one commit").

**Verification**:
```bash
./scripts/buf-gen.sh
git diff packages/proto/gen/
# Should show only the new ValidationRule/ValueType additions — no unrelated diffs
grep "ValidationRule\|ValueType\|validation" packages/proto/gen/ts/config/v1/config_pb.ts
# Must print matches for all three
grep "ValidationRule\|ValueType\|GetValidation" packages/proto/gen/go/config/v1/config.pb.go
# Must print matches for all three
```

---

### Step 3 — service: Populate validation field in listKeys response (xstockstrat-config)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — Config key naming, WatchConfig stream stability, validation field population correctness

**Codebase Evidence**:
- `listKeys` handler is at `services/xstockstrat-config/src/grpc/configServiceImpl.ts` line 270.
- The handler currently maps DB rows to response objects at lines 281–289. The mapping is:
  `{ key, description, default_value, is_secret, consuming_service, environment, trading_mode }`.
  There is no `validation` field.
- The config service imports `ConfigUpdateType` from `@xstockstrat/proto/config/v1/config` (line 3 of configServiceImpl.ts). After Step 2, `ValueType` will also be importable from the same module.
- The `analysis.signals.source_weights` key is seeded in `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.up.sql` with `value_type = 'string'`. The `listKeys` query at line 274 selects `key, description, default_value, is_secret, consuming_service, environment, trading_mode` — does NOT select `value_type`. The validation field must be computed from the key name, not a DB column, since `value_type` in the DB schema is the storage type (`string`, `int`, `float`, `bool`, `json`) not the semantic type.

**Instructions**:

1. Add the import for `ValueType` at the top of `configServiceImpl.ts`, extending the existing import at line 3:
   ```typescript
   import { ConfigUpdateType, ValueType } from '@xstockstrat/proto/config/v1/config';
   ```

2. Add a static registry `WEIGHT_KEY_REGISTRY` constant above the `ConfigServiceImpl` class that maps known weight key paths to their validation bounds. Initialize with `analysis.signals.source_weights`:
   ```typescript
   const WEIGHT_KEY_REGISTRY: Record<string, { minValue: number; maxValue: number }> = {
     'analysis.signals.source_weights': { minValue: 0.0, maxValue: 1.0 },
   };
   ```

3. In the `listKeys` handler (line 280), update the `keys` mapping to include the `validation` field. Add after the `trading_mode` mapping:
   ```typescript
   keys: result.rows.map((r) => {
     const weightBounds = WEIGHT_KEY_REGISTRY[r.key];
     return {
       key: r.key,
       description: r.description ?? '',
       default_value: r.default_value ?? '',
       is_secret: r.is_secret,
       consuming_service: r.consuming_service ?? '',
       environment: r.environment === 'production' ? 2 : 1,
       trading_mode: r.trading_mode === 'live' ? 2 : r.trading_mode === 'paper' ? 1 : 0,
       validation: weightBounds
         ? {
             value_type: ValueType.VALUE_TYPE_FLOAT_MAP,
             min_value: weightBounds.minValue,
             max_value: weightBounds.maxValue,
           }
         : undefined,
     };
   }),
   ```

4. For keys not in `WEIGHT_KEY_REGISTRY`, `validation` is `undefined` — proto3 optional field serializes as absent, preserving FR-5 backward compatibility (old clients that ignore unknown fields continue to work).

**Verification**:
```bash
cd services/xstockstrat-config
pnpm run build
# Should compile with zero TypeScript errors

# Start the service locally (requires TimescaleDB running):
# pnpm run dev
# Then in another terminal:
# grpcurl -plaintext -d '{"namespace":"analysis","environment":1,"trading_mode":1}' \
#   localhost:50060 xstockstrat.config.v1.ConfigService/ListKeys
# Expect: analysis.signals.source_weights key has validation.value_type=1 (VALUE_TYPE_FLOAT_MAP),
#         validation.min_value=0.0, validation.max_value=1.0
# All other keys have no validation field.
```

---

### Step 4 — test: Unit test for listKeys validation field population (xstockstrat-config)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/configWatcher.test.ts` — modify (add listKeys validation test)
  OR create `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — Config key naming, WatchConfig stream stability, validation field population correctness

**Codebase Evidence**:
- Existing test file: `services/xstockstrat-config/src/__tests__/configWatcher.test.ts` — uses Node.js built-in test runner (`node --experimental-strip-types --test`), no external test framework. Tests use `describe`/`it`/`assert` from `node:test`/`node:assert/strict`.
- Test runner command: `pnpm run test` = `node --experimental-strip-types --test src/__tests__/*.test.ts`
- Coverage threshold: `pnpm run test:coverage` = `c8 --reporter=text --reporter=lcov --lines 40 node ...` — enforces ≥40% line coverage.
- The existing test patches `ConfigWatcher` internals via `(w as any).snapshot`. A similar pattern can be used for `ConfigServiceImpl` by mocking the DB pool with a stub returning controlled rows.
- `configWatcher.test.ts` uses `before` for async import guard. The new test for `ConfigServiceImpl.listKeys` should follow the same import guard pattern since it also imports from `@xstockstrat/proto`.

**Instructions**:

Create `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` with Node.js
built-in test runner (matching the existing `configWatcher.test.ts` style):

```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let ConfigServiceImpl: typeof import('../grpc/configServiceImpl').ConfigServiceImpl;

before(async () => {
  try {
    const mod = await import('../grpc/configServiceImpl.js');
    ConfigServiceImpl = mod.ConfigServiceImpl;
  } catch {
    // Proto package unavailable in test environment — tests will be skipped.
  }
});

describe('ConfigServiceImpl.listKeys — validation field', () => {
  function makePool(rows: Record<string, unknown>[]): any {
    return {
      query: async (_sql: string, _params?: unknown[]) => ({ rows }),
      connect: async () => ({
        query: async () => {},
        on: () => {},
      }),
    };
  }

  it('populates validation for analysis.signals.source_weights', async () => {
    if (!ConfigServiceImpl) return;
    const pool = makePool([
      { key: 'analysis.signals.source_weights', description: 'Weights', default_value: '{}',
        is_secret: false, consuming_service: 'xstockstrat-analysis', environment: 'dev', trading_mode: 'all' },
    ]);
    const impl = new ConfigServiceImpl(pool);
    let result: any = null;
    await impl.listKeys(
      { request: { namespace: 'analysis', environment: 1, trading_mode: 1 } },
      (_err: unknown, res: unknown) => { result = res; },
    );
    assert.ok(result, 'callback was called with a result');
    assert.strictEqual(result.keys.length, 1);
    const k = result.keys[0];
    assert.ok(k.validation, 'validation field must be present');
    assert.strictEqual(k.validation.value_type, 1, 'VALUE_TYPE_FLOAT_MAP = 1');
    assert.ok(Math.abs(k.validation.min_value - 0.0) < 1e-6);
    assert.ok(Math.abs(k.validation.max_value - 1.0) < 1e-6);
  });

  it('omits validation for non-weight keys', async () => {
    if (!ConfigServiceImpl) return;
    const pool = makePool([
      { key: 'platform.log_level', description: 'Log level', default_value: 'info',
        is_secret: false, consuming_service: 'all', environment: 'dev', trading_mode: 'all' },
    ]);
    const impl = new ConfigServiceImpl(pool);
    let result: any = null;
    await impl.listKeys(
      { request: { namespace: 'platform', environment: 1, trading_mode: 0 } },
      (_err: unknown, res: unknown) => { result = res; },
    );
    assert.ok(result);
    const k = result.keys[0];
    assert.strictEqual(k.validation, undefined, 'non-weight key must have no validation');
  });
});
```

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage
# Must exit 0 with ≥40% line coverage (threshold enforced by c8 --lines 40)
# Output must show the two new test cases passing
```

---

### Step 5 — service: Add weight validation to NamespacePage editor (xstockstrat-config-ui)

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/app/[namespace]/page.tsx` — modify

**Reviewers**: `xstockstrat-config-ui` owner (`test`) — Config mutation safety, validation UX correctness, no secret values rendered in UI

**Codebase Evidence**:
- The `ConfigKey` interface at `app/[namespace]/page.tsx` line 18 is a local TypeScript interface (not imported from the proto package). It currently has: `key`, `description`, `defaultValue`, `isSecret`, `consumingService`, `environment`, `tradingMode` — no `validation` field.
- The `listKeys` call is at line 58–72. The response shape is cast to `ConfigKey[]` at line 65: `setKeys((data.keys ?? []) as ConfigKey[])`.
- The `handleSave` function is at line 74–97. It calls `configClient.setConfig(...)` at line 77 and does not currently validate the `editValue` before submitting.
- The inline editor `Input` is rendered at line 137–143. The Save button is at line 163–170 with `disabled={saving}`.
- The browser client `configClient` is `createClient(ConfigService, browserTransport)` at `app/lib/browserClients.ts:18`. After Step 2, the generated `ConfigKeyMeta` type will include `validation?: ValidationRule`.
- `configClient.listKeys(...)` is called via the BFF at `app/lib/connectBff.ts:48–50`. The BFF proxies transparently — the `validation` field added in Step 3 will flow through without any changes to the BFF.
- The `sources/page.tsx` also reads `analysis.signals.source_weights` at line 170–174 (`weightKey.defaultValue`). Weight input editing in `sources/page.tsx` is handled via a separate weight save flow (not the inline namespace editor). FR-3/FR-4/FR-6 scope the validation to the namespace page inline editor; `sources/page.tsx` weight rendering is read-only in that page.

**Instructions**:

1. Extend the local `ConfigKey` interface at line 18 to include the `validation` field:
   ```typescript
   interface ValidationRule {
     valueType: number;   // 1 = VALUE_TYPE_FLOAT_MAP
     minValue: number;
     maxValue: number;
   }

   interface ConfigKey {
     key: string;
     description: string;
     defaultValue: string;
     isSecret: boolean;
     consumingService: string;
     environment: number;
     tradingMode: number;
     validation?: ValidationRule;
   }
   ```

2. Add validation state below the existing `setSaving` state (after line 54):
   ```typescript
   const [validationError, setValidationError] = useState<string | null>(null);
   ```

3. Add a `validateValue` helper function below the `errMessage` helper (before the `Props` type):
   ```typescript
   function validateFloatMap(json: string, min: number, max: number): string | null {
     let parsed: unknown;
     try { parsed = JSON.parse(json); } catch { return 'Value must be valid JSON'; }
     if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
       return 'Value must be a JSON object';
     }
     for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
       const n = Number(v);
       if (isNaN(n) || n < min || n > max) {
         return `Key "${k}": ${v} is outside [${min}, ${max}]`;
       }
     }
     return null;
   }
   ```

4. Add an `onBlur` handler on the `Input` at line 139 (currently `onChange` only):
   ```typescript
   onBlur={() => {
     if (editingKey) {
       const key = keys.find((k) => k.key === editingKey);
       if (key?.validation?.valueType === 1) {
         setValidationError(validateFloatMap(editValue, key.validation.minValue, key.validation.maxValue));
       }
     }
   }}
   ```

5. Clear `validationError` on Cancel (add `setValidationError(null)` alongside `setEditingKey(null)` in the Cancel button `onClick`).

6. In `handleSave`, check validation before calling `setConfig`. Add at the start of `handleSave` (after `setSaving(true)`):
   ```typescript
   const key = keys.find((k) => k.key === editingKey);
   if (key?.validation?.valueType === 1) {
     const err = validateFloatMap(editValue, key.validation.minValue, key.validation.maxValue);
     if (err) {
       setValidationError(err);
       setSaving(false);
       return;  // FR-6: no SetConfig call made when validation fails
     }
   }
   setValidationError(null);
   ```

7. Display the validation error inline below the `Input` (inside the `editingKey === k.key` branch, after the `Input`):
   ```tsx
   {validationError && editingKey === k.key && (
     <p className="text-destructive text-xs mt-0.5">{validationError}</p>
   )}
   ```

8. Disable the Save button when there is a validation error. Change the `disabled` prop on the Save `Button` at line 168:
   ```tsx
   disabled={saving || !!validationError}
   ```

9. For keys with no `validation` field (or `valueType === 0`), the editor must behave exactly as today (FR-5). The `validateFloatMap` function is only called when `key.validation?.valueType === 1`.

**Verification**:
```bash
cd services/xstockstrat-config-ui
pnpm exec tsc --noEmit
# Must exit 0 with zero TypeScript errors (AC-7)

# Manual check (requires both services running):
# 1. Navigate to /config-ui/analysis?env=dev&mode=paper
# 2. Click Edit on analysis.signals.source_weights
# 3. Enter {"polygon": 1.5} and blur — expect inline error: 'Key "polygon": 1.5 is outside [0, 1]'
# 4. Expect Save button is disabled
# 5. Enter {"polygon": 0.8} and blur — error clears, Save is enabled
# 6. Click Save — SetConfig is called and succeeds
# 7. Click Edit on platform.log_level — no validation applied, any string saves normally
```

---

### Step 6 — test: E2E validation tests for NamespacePage editor (xstockstrat-config-ui)

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/e2e/api-smoke.spec.ts` — modify (add validation contract test)
- `services/xstockstrat-config-ui/e2e/mock-backend.ts` — modify (add validation field to mock listKeys response)

**Reviewers**: `xstockstrat-config-ui` owner (`test`) — Config mutation safety, validation UX correctness, no secret values rendered in UI

**Codebase Evidence**:
- `e2e/mock-backend.ts` line 39–47: the `listKeys` mock currently returns three keys with no `validation` field. The mock is the source of `ConfigKeyMeta` data for all E2E tests.
- `e2e/api-smoke.spec.ts` line 72–133: the BFF contract tests access `body.keys` and check `k.key`, `k.defaultValue`, `k.isSecret`. The existing test at line 82 asserts all required interface fields — needs to be extended to assert that `validation` is present when the key is a weight key.
- `e2e/api-smoke.spec.ts` BFF URL: `CONFIG_BFF = '/config-ui/api/xstockstrat.config.v1.ConfigService/ListKeys'` at line 20. Same pattern applies to the new test cases.
- The `callBff` helper at line 41–58 returns `{ status, body }` via `page.evaluate`. The `validation` field from the BFF response will appear in `body.keys[N].validation` as a plain JSON object with camelCase fields (`valueType`, `minValue`, `maxValue`) per Connect JSON serialization.

**Instructions**:

1. In `e2e/mock-backend.ts`, add a weight key entry to the `listKeys` mock response at line 40.
   After the existing `secret.alpaca_api_key` entry, add:
   ```typescript
   {
     key: 'analysis.signals.source_weights',
     description: 'JSON weight map for signal sources',
     defaultValue: '{}',
     isSecret: false,
     consumingService: 'xstockstrat-analysis',
     environment: 1,
     tradingMode: 0,
     validation: { valueType: 1, minValue: 0.0, maxValue: 1.0 },
   },
   ```

2. In `e2e/api-smoke.spec.ts`, add a new `test.describe` block at the end of the file:

   ```typescript
   test.describe('validation field in ListKeysResponse', () => {
     test('weight key has validation.valueType=1 and correct bounds', async ({ page }) => {
       await addAuthCookie(page);
       await page.goto('/config-ui/login');
       const { status, body } = await callBff(page, CONFIG_BFF, { namespace: 'analysis', environment: 1, tradingMode: 0 });
       expect(status).toBe(200);
       const keys = body.keys as Array<Record<string, unknown>>;
       const weightKey = keys.find((k) => k.key === 'analysis.signals.source_weights');
       expect(weightKey).toBeDefined();
       const v = weightKey!.validation as Record<string, unknown>;
       expect(v).toBeDefined();
       expect(v.valueType).toBe(1);
       expect(Number(v.minValue)).toBeCloseTo(0.0);
       expect(Number(v.maxValue)).toBeCloseTo(1.0);
     });

     test('non-weight key has no validation field', async ({ page }) => {
       await addAuthCookie(page);
       await page.goto('/config-ui/login');
       const { status, body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 1, tradingMode: 0 });
       expect(status).toBe(200);
       const keys = body.keys as Array<Record<string, unknown>>;
       const logLevel = keys.find((k) => k.key === 'platform.log_level');
       expect(logLevel).toBeDefined();
       // validation absent means no validation applied (FR-5)
       expect(logLevel!.validation).toBeUndefined();
     });
   });
   ```

**Verification**:
```bash
cd services/xstockstrat-config-ui && pnpm run test:e2e
# Must exit 0 — all existing tests pass, new validation tests pass
# Expected new passing tests:
#   "validation field in ListKeysResponse > weight key has validation.valueType=1 and correct bounds"
#   "validation field in ListKeysResponse > non-weight key has no validation field"
```

No coverage threshold applies to Next.js frontends — E2E verification is sufficient.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
