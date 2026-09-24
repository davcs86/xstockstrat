# sdd-review — parallel-feature overlap check

The procedure a `feature-overlap` subagent runs to detect collisions between the feature under
review and other in-flight features. The agent returns a collision report; the **router**
(not the agent) handles any interactive `merge-order.md` write.

## Mode A (product-spec level) — A4

Find active concurrent features with a single grep (no per-file reads):

```bash
find docs/roadmap/features -mindepth 2 -maxdepth 2 -name "feature.md" \
  | xargs grep -El '`(spec-ready|implementation-ready|in-progress|code-completed)`' 2>/dev/null
```

Exclude `$FEATURE_DIR/feature.md`. Derive each other slug from its directory name (strip
`NNN-` prefix). For each, extract only overlap-relevant fields from its `product-spec.md` via
targeted grep — do not load the full file:

```bash
grep -E '^- `xstockstrat-[^`]+`' <other-feature-dir>/product-spec.md          # affected services
grep -E '`[a-z][a-z-]+\.[a-z]+\.[a-z_]+`' <other-feature-dir>/product-spec.md   # config keys
grep -iE '\.proto|proto.*change|new RPC|new message' <other-feature-dir>/product-spec.md
grep -iE 'table|migration|schema' <other-feature-dir>/product-spec.md
```

Compare against the current spec's **Affected Services**, **Proto Contract Changes**, **Config
Key Changes**, **Database Changes**. Apply:

| Overlap type | Severity | Message |
|---|---|---|
| Same service in **Affected Services** | ⚠ WARN | "Feature `<other>` also modifies `<service>`. Coordinate merge order." |
| Same proto file named | ⚠ WARN | "Feature `<other>` also changes `<proto file>`. Risk of field number or message name conflict." |
| Same database table named | ⚠ WARN | "Feature `<other>` also touches table `<table>`. Risk of migration number collision." |
| Identical config key name | ✗ FAIL | "Feature `<other>` defines config key `<key>`. Duplicate keys cause runtime conflicts." |

## Mode B (impl-spec level) — B4

Find `implementation-ready` / `in-progress` features:

```bash
find docs/roadmap/features -mindepth 2 -maxdepth 2 -name "feature.md" \
  | xargs grep -El '`(implementation-ready|in-progress)`' 2>/dev/null
```

Exclude `$FEATURE_DIR/feature.md`. For each, extract from its `implementation-spec.md`:

```bash
grep -E '^\- `[^`]+\.(go|py|ts|sql|proto|md)`' <other-feature-dir>/implementation-spec.md  # files
grep -E '[0-9]{3}_[a-z_]+\.up\.sql' <other-feature-dir>/implementation-spec.md              # migration NNN
grep -E '`[a-z][a-z-]+\.[a-z]+\.[a-z_]+`' <other-feature-dir>/implementation-spec.md         # config keys
grep -E 'field [0-9]+| = [0-9]+;' <other-feature-dir>/implementation-spec.md                 # proto field numbers
```

Compare step-by-step:

| Overlap type | Severity | Message |
|---|---|---|
| Same file path in another feature's pending/in-progress `**Files**` | ⚠ WARN | "Feature `<other>` Step N also writes `<file>`. Merge conflict risk." |
| Same migrations dir + same NNN prefix | ✗ FAIL | "Feature `<other>` Step N creates the same migration number in `services/<svc>/migrations/`. Rename one before executing." |
| Same proto field number on the same message | ✗ FAIL | "Feature `<other>` Step N assigns field `<N>` on `<message>`. Field number collision." |
| Same config key name added | ✗ FAIL | "Feature `<other>` Step N adds config key `<key>`. Runtime conflict." |

## Report the agent returns

```
Overlap verdict: CLEAN | COLLISIONS FOUND
Collisions:
  ✗ [migration] services/xstockstrat-trading/migrations/003 — this feature Step 2 vs `add-account-base-schema` Step 2
  ⚠ [service] xstockstrat-marketdata — also modified by `add-polygon-source`
Merge-order: no existing entry; recommend a blocking row for the feature that merges second.
```

## Merge-order write (router-owned, not the agent's job)

On any FAIL-level overlap, the router proposes:
> "Conflict with `<other-slug>` detected. Propose adding a blocking dependency to
> `docs/roadmap/features/merge-order.md`. The blocked feature should be the one that merges
> second. Add this entry? (yes / no)"

If `yes`: edit `docs/roadmap/features/merge-order.md`, add a row to the Blocking Dependencies table:
```
| `<blocked-slug>` | `<other-slug>` | <reason> | No |
```
If `no`: note the conflict in the review output but do not write.
