# Proto Versioning Runbook

## Rule: v1 is frozen once it has consumers

Never apply breaking changes to an existing `{domain}/v1/{domain}.proto`. A breaking change is any change that `buf breaking` would flag:
- Removing or renaming a field
- Changing a field's type or number
- Removing a service or RPC method
- Renaming a message or enum

Non-breaking changes (always safe on existing vN):
- Adding a new optional field
- Adding a new RPC method
- Adding a new enum value
- Adding comments or documentation

## When to create v2

Only create `{domain}/v2/` when a change **cannot** be made additively. If you can add a new field instead of changing an existing one, do that. v2 should be rare.

Common triggers for v2:
- A field's type is wrong (e.g., `string` should be `int64`)
- A message needs to be fundamentally restructured
- A service method signature is wrong (wrong request/response types)

## Step-by-step: creating v2

### PR1 — Create the v2 proto (additive, no consumer migrations)

1. Create `packages/proto/{domain}/v2/{domain}.proto` with `package xstockstrat.{domain}.v2`
2. Copy the v1 content, then apply the breaking change
3. Run `./scripts/buf-gen.sh` — v2 stubs appear in:
   - `packages/proto/gen/go/{domain}/v2/`
   - `packages/proto/gen/python/{domain}/v2/`
   - `packages/proto/gen/ts/{domain}/v2/`
4. Commit **proto source + generated stubs together** in one commit
5. `buf breaking` passes (creating a new package is not breaking)
6. Get 2-service-owner approval per the [approval flow](x-approval-flow.md)

### PR2–N — Migrate consumers one service per PR

For each service that imports from `{domain}/v1`:
1. Update imports: `@xstockstrat/proto/{domain}/v1/{domain}` → `@xstockstrat/proto/{domain}/v2/{domain}`
2. Update field names or types as required by the v2 schema
3. Verify tests pass
4. One PR per service keeps diffs small and rollback safe

### PR(N+1) — Delete v1 once all consumers are migrated

Only after **no import of v1 exists in any service**:
1. Delete `packages/proto/{domain}/v1/{domain}.proto`
2. Delete `packages/proto/gen/go/{domain}/v1/`
3. Delete `packages/proto/gen/python/{domain}/v1/`
4. Delete `packages/proto/gen/ts/{domain}/v1/`
5. Remove `buf breaking` baseline guard for the deleted package (the `except:` list if needed)

## Parallel-feature safety

**Two features cannot both introduce v2 for the same domain simultaneously.**

If Feature A and Feature B both need breaking changes to `config`:
- Option 1: Feature A creates v2 first (merges PR1). Feature B rebases on A, making further changes to v2, effectively creating a combined v2.
- Option 2: Merge both breaking changes into a single v2 from the start (coordinate before branching).

Never create `v2` and `v3` for the same domain in the same release cycle unless v2 was already shipping to consumers.

## Checking which services use a proto package

```bash
# Find all imports of config/v1 across Node.js services
grep -r "@xstockstrat/proto/config/v1" services/

# Find all imports of config/v1 across Go services
grep -r "xstockstrat/contracts/gen/go/config/v1" services/

# Find all imports of config/v1 across Python services
grep -r "config.v1" services/
```

## Verifying the generated stubs match the protos

The `proto-freshness` CI job enforces this automatically. To check locally:

```bash
./scripts/buf-gen.sh
git diff packages/proto/gen/
# Should be empty if stubs are up to date
```

## BSR (Buf Schema Registry)

Proto definitions are published to `buf.build/xstockstrat/contracts` on every merge to `main`.
This provides a versioned, browsable public API surface for open-source consumers.

To view the published schema: https://buf.build/xstockstrat/contracts

**Setup required once:**
1. Create account at buf.build
2. Create module `buf.build/xstockstrat/contracts`
3. Generate `BUF_TOKEN` from buf.build account settings
4. Add `BUF_TOKEN` as a GitHub Actions repository secret
