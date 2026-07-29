# Recon: qa-capability

**Created**: 2026-07-29
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (two test-infra edits only); the rest is `.claude/` tooling,
`docs/` governance, and `.github/`.

---

## Objective

Replace the frontend-only `/test-data` fixture steward with a monorepo-wide QA capability: a
read-only `qa-tester` subagent that designs tests, assesses coverage, and spots defects, plus a
write-capable `/qa` skill that writes tests, runs suites, detects flakes, and files defects as GitHub
issues for `/sdd-triage`. Widen Constitution **C-12** from `xstockstrat-ui` to every language,
materialized lazily.

## Codebase Map

**AI tooling (the primary surface)**

- Subagent fleet: `.claude/agents/` — 7 files. Every one has frontmatter `name`, `description`,
  `tools`, `model: inherit`; **none has Write, Edit, or Bash**. Body always opens with
  `## Operating rules` whose rule 1 is read-only, and always ends with a fenced
  `## Output format (always)` skeleton. Representative: `.claude/agents/codebase-discovery.md`,
  `.claude/agents/spec-reviewer.md`, `.claude/agents/dry-reviewer.md`.
- Skill being absorbed: `.claude/skills/test-data/SKILL.md` (79 lines) — sub-commands `audit`
  (`:25`, report-only), `add <domain>` (`:43`, writes fixtures + catalog), `update <fixture-symbol>`
  (`:62`). Boundary at `:78`: *"edits test fixtures, specs, and the catalog only — never `src/`
  runtime code."* Backend exclusion at `:77`.
- Registration index: `.claude/context-map.yaml` — `agents:` (5 of 7 registered; `design-proposer`
  and `design-adversary` missing), `skills:` (4 of 13; `test-data` at `:62`), `routing:` (`:94`).
- Validator: `scripts/check-context-map.sh:32-36` — `SRCS` is `find . -name CLAUDE.md` +
  `find .claude/skills -name SKILL.md` + `find .claude/skills -path '*/reference/*.md'`.
  **`.claude/agents/*.md` and `docs/patterns/*.md` are NOT scanned.**
- Frontmatter parser actually used: `.claude/hooks/session-start.sh:43-44` (awk on
  `^description:` / `^argument-hint:`).

**Governance**

- `docs/sdd/constitution.md:43` — C-12, currently triggered by *"Any step that adds or modifies
  `xstockstrat-ui` tests"*. Source-of-record column cites `docs/patterns/test-data-inventory.md`,
  `INVENTORY.md`, `step-constraints.md §B` — **it does not name `/test-data`**.
- `docs/sdd/constitution.md:24` — *"IDs are stable. Append new IDs; never renumber."*
- `docs/patterns/test-data-inventory.md:23` (steward-skill row), `:46`, `:69-70` (the
  "backend out of scope … frontend-only" paragraph), `:76`.
- P-01 (single-orchestrator authority; subagents advisory only), P-02 (no lateral subagent
  coordination), P-04 (phase-gate approval), P-06 (red-before-green), C-08 (test-step pairing),
  F-02/F-03 (never push to main/main-dev), F-04 (never invent a path), F-08 (staged-file scope),
  F-10 (no writes before Phase-2 confirmation), F-11 (Floor breach halts).

**Defect intake**

- `.claude/skills/sdd-triage/SKILL.md:15` — `$ARGUMENTS[0]` is a **required** GitHub issue number;
  `:80` runs `gh issue view` and `:83` stops if not found.
- Parsers the issue body must satisfy: `:97-102` (T-2 greps literal `SEV-1`/`SEV-2`/`SEV-3`),
  `:106-110` (T-3 looks for a checked `[x]` and for `config-propagation`).
- `.github/ISSUE_TEMPLATE/bug-report.yml` — the only issue template. `:74-87` `affected_services` is
  `required: true` and lists three services that **no longer exist** (`xstockstrat-trader (UI)`,
  `xstockstrat-insights (UI)`, `xstockstrat-config-ui (UI)`, consolidated by feature 045) and omits
  `xstockstrat-agent`.
- `grep -rn "gh issue create" .claude/` → **zero hits**. Nothing files an issue.

**Test infrastructure**

- `services/xstockstrat-ui/playwright.config.ts:106` `retries: isCI ? 1 : 0`; `:110` reporters
  `[github, list, html]` — **no `json` reporter**. `e2e/` holds 23 specs across
  `{trader,insights,config-ui,accounts}/` + `auth.spec.ts`; mock gRPC backend at `e2e/mock-backend.ts`
  (3 Connect-RPC servers, ports 9091-3); auth helper `e2e/helpers/auth.ts`.
- `services/xstockstrat-ui/vitest.config.ts` — node env, `include: ['src/**/*.test.ts']` (3 files),
  coverage scoped `include: ['src/lib/**']`, `all: false`, thresholds 40%.
- Backend: Go stdlib `testing` (`GOWORK=off`, `coverpkg` excludes `cmd|handler|repository|telemetry|
  service` per `.github/workflows/ci.yml:241`); Python pytest/uv (`asyncio_mode = "auto"`, per-service
  `[tool.coverage.run] omit`); Node `node:test` + c8 with a **non-recursive** `src/__tests__/*.test.ts`
  glob. Thresholds live in `docs/patterns/ci-overview.md`, authority `.github/workflows/ci.yml`.
- Test-file counts (real): analysis 13, marketdata 9, ingest 7, agent 6, indicators 5, trading 5,
  portfolio 3, config 2, ledger 2, identity 1, notify 1, ui 3 vitest + 23 e2e.

## Patterns to REUSE

- **Agent definition** → copy the shape of `.claude/agents/codebase-discovery.md` verbatim:
  frontmatter quartet, `## Operating rules` with read-only as rule 1, fenced
  `## Output format (always)`. Do not invent a new agent format.
- **Progressive disclosure** → reuse the `sdd-execute` split (`SKILL.md` router +
  `reference/*.md` loaded per branch, `.claude/skills/sdd-execute/SKILL.md:12-17`) for `/qa`'s
  per-language references. Threshold is ~1.2k words (`docs/patterns/context-engineering.md`).
- **Fixture procedures** → move `test-data/SKILL.md:25-69` into `reference/fixtures.md` as-is;
  the greps at `:29-30` and the proto-shape lookup at `:47` are already correct.
- **Defect routing** → reuse `/sdd-triage` wholesale. `/qa` only needs to *create* the issue; every
  downstream step (severity classification, Track A/B/C routing, feature-dir creation) already exists.
- **Coverage thresholds** → cite `docs/patterns/ci-overview.md` rather than restating numbers in
  `reference/lang-*.md` (DRY guard rail; the numbers already drifted once — `ci-overview.md:18` says
  `node-test` ×4 while `ci.yml:541-553` runs 5).
- **Severity + impact vocabulary** → transcribe from `bug-report.yml` rather than inventing a scale.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none.
- Inter-service edges: none.
- **Tooling edges (new)**: `/qa` → `qa-tester` (Task); `sdd-execute` tdd-gate → `qa-tester`;
  `sdd-design` recon → `qa-tester`; `/qa defect` → `gh issue create` → `/sdd-triage`.
- **External**: `gh` CLI. Absent from the current sandbox (`command -v gh` fails) though
  `/sdd-triage` and `/promote` both assume it — `/qa defect` needs a documented fallback.

## Risks / Not-found

- **`.claude/agents/*.md` is unvalidated** — `check-context-map.sh` does not scan it, so
  `qa-tester`'s pointers to `.claude/skills/qa/reference/*.md` would rot silently. Mitigation:
  register all 7 reference paths in `context-map.yaml` (rule 1 checks those), and optionally add
  `find .claude/agents -name '*.md'` to `SRCS`.
- **`docs/patterns/test-data-inventory.md` is unvalidated** for the same reason — its 3 `/test-data`
  refs must be fixed by hand.
- **Removal-gate trap** (`fails.md` 2026-07-29 / 079): gating on the string `/test-data` fails on
  correct output. Gate on `.claude/skills/test-data` (the dead path) instead.
- **Silent-skip trap** (`fails.md` 2026-07-29 / 074): a suite exiting 0 with zero assertions is not
  coverage. Must constrain both `reference/test-design.md` and `/qa flake`.
- **Not found**: any existing coverage-aggregation script, flaky-test tracker, or test-authoring
  automation beyond `/test-data`. Confirmed absent — this feature has no prior art to reuse.
- **Not found**: any prior feature that registered a `.claude/skills` or `.claude/agents` change —
  `grep -rl "\.claude/skills\|\.claude/agents" docs/roadmap/features/*/feature.md` → zero across 79
  features. No precedent for how AI-tooling changes are specced.
