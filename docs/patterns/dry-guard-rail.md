# DRY Guard Rail — don't repeat constants, string literals, types, or helper functions

This repo guards against copy-paste of **constants, string literals, types, and helper
functions**. Enforcement is **local** (a git pre-commit hook) plus an **on-demand Claude
subagent** — there is intentionally **no GitHub Actions CI job** for this.

## The three layers

| Layer | Tool | Catches | Where it runs |
|---|---|---|---|
| A — structural clones | **jscpd** (`.jscpd.json`, `scripts/check-duplication.sh`) | copy-pasted *blocks*: helper functions, type blocks, constant blocks, near-identical hooks. Language-agnostic (TS/JS, Go, Python, …). | pre-commit hook + by hand + subagent |
| B — scattered literals | **ESLint** (`services/xstockstrat-ui/.eslintrc.json`) | the *same short literal/number* spread across files: header names, the `0x04` admin bit. Points each violation at the canonical constant. UI/TypeScript only. | pre-commit hook (`pnpm --filter xstockstrat-ui lint`) |
| C — semantic near-duplicates | **`dry-reviewer` Claude subagent** (`.claude/agents/dry-reviewer.md`) | renamed-but-equivalent helpers, parallel type shapes, the same value under different names, cross-language repetition — what token tools miss. Advisory. | on demand (e.g. before opening a PR) |

## Enforcement surfaces

### Pre-commit hook (`.husky/pre-commit`, husky v9)

`pnpm install` provisions the hook (root `package.json` → `"prepare": "husky"`). On commit:

1. `lint-staged` formats staged UI files with Prettier.
2. **If staged changes touch `services/xstockstrat-ui/`** → **hard block** on
   `pnpm --filter xstockstrat-ui lint` (Layer B) and
   `scripts/check-duplication.sh services/xstockstrat-ui/src` (Layer A, `--threshold 0`).
3. The rest of the repo runs `DUP_REPORT_ONLY=1 scripts/check-duplication.sh` — a
   **report-only** warning that never blocks (rollout Phase 2).

Emergency bypass: `git commit --no-verify`.

### Language-agnostic tool (`scripts/check-duplication.sh`)

```bash
./scripts/check-duplication.sh services/xstockstrat-ui/src   # fail on any clone (enforced)
DUP_REPORT_ONLY=1 ./scripts/check-duplication.sh             # whole-repo advisory report
pnpm check:dup            # = scripts/check-duplication.sh services packages
pnpm check:dup:report     # = report-only variant
```

It wraps jscpd with the repo's ignore globs (generated proto, migrations, tests, lockfiles).
`DUP_REPORT_ONLY=1` makes it always exit 0.

### `dry-reviewer` subagent (semantic)

Run it before a PR for repetition the deterministic tools can't see:

> Use the `dry-reviewer` subagent to review the staged changes for repeated constants,
> string literals, types, and helper functions.

It is read-only and returns file:line findings with a suggested canonical home — it never
edits.

## Canonical homes (UI)

When the rail flags a duplicate, consolidate into the existing home instead of re-declaring:

| Repeated thing | Canonical home |
|---|---|
| Propagation header names (`x-user-id`, `x-access-scope`, `x-trace-id`) | `services/xstockstrat-ui/src/lib/headers.ts` (`HEADER_*`) |
| Admin scope bit (`0x04`) | `services/xstockstrat-ui/src/lib/auth.ts` (`ADMIN_SCOPE`, `hasAdminScope`, and `requireAdminScope` in `bffShared.ts`) |
| Segment base paths (`/trader`, `/insights`, `/config-ui`) | `services/xstockstrat-ui/src/lib/basepath.ts` (`BASE_PATH_*`) |
| BFF session/header/dispatch plumbing | `services/xstockstrat-ui/src/lib/bffShared.ts` |
| "call RPC then invalidate query keys" hooks | `services/xstockstrat-ui/src/hooks/useInvalidatingMutation.ts` |

## Rollout

- **Phase 1 (now):** UI enforced (hook hard-blocks); refactored so it starts green.
- **Phase 2 (now):** rest of repo report-only via `DUP_REPORT_ONLY=1`.
- **Phase 3 (future):** a language owner fixes/baselines their area's debt, then drops the
  `DUP_REPORT_ONLY` toggle (or adds the area's path to the enforced step) so the hook blocks
  on it too.

## Exemptions

- Generated code: `packages/proto/gen/**`, `*_pb.*`, `*.pb.go` (ignored in `.jscpd.json`).
- Tests, fixtures, migrations, lockfiles (ignored in `.jscpd.json`).
- Framework idioms that must be literal exports — e.g. `export const dynamic =
  'force-dynamic'` (Next.js route-segment config) — are not "fixable" duplication.
- ESLint literal bans are turned off for the canonical source files (`headers.ts`,
  `auth.ts`) via `overrides`.
