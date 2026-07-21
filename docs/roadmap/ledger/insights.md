# SDD Ledger — Insights

Cross-feature memory of **patterns that worked**: a reusable approach, a clean abstraction, an
ordering that paid off, a perf win. This is the durable, cross-feature complement to per-feature
`context.md` (which is scoped to one feature) and the persistent complement to the `dry-reviewer`
agent (which finds duplication live but records nothing).

**Read** at the front of the pipeline — `/sdd-story` (boot), `/sdd-design` (recon + grilling),
`/sdd-spec` (governance read) — so a new feature reuses what already worked.
**Written** by `/sdd-execute` at integration / ALL-DONE when a step surfaced a pattern worth
reusing.

## Rules

- **Append-only.** Add new entries at the bottom; never rewrite or delete an existing one.
- **One entry, one lesson.** Keep it scannable.
- **Cite evidence.** Point to a `path:line`, PR, or step so the reader can see the real thing.
- **Categories:** `reuse` · `perf` · `design` · `ordering`.

## Schema

```markdown
### <ISO date> — <feature-slug> — <category>
- **Pattern**: <what worked and why it's reusable>
- **Evidence**: <path:line or PR/step ref>
- **Rule it implies**: <one line; if it should become binding, propose a Constitution ID>
```

---

<!-- Append entries below. Newest at the bottom. -->

### 2026-07-03 — persist-strategy-scores — design
- **Pattern**: To add DB durability to volatile in-memory service state without changing (and risking)
  the read path, use **write-through + hydrate-at-boot**: keep the in-memory dict as the sole read
  source, add a best-effort DB upsert on write, and hydrate the dict from the DB once at startup. Avoids
  the false-success hazard of "best-effort write + read-from-DB" (a swallowed write then a DB read →
  NOT_FOUND for a value the caller was just told succeeded).
- **Evidence**: `services/xstockstrat-analysis/app/handlers/servicer.py` (`hydrate_scores`, best-effort
  upsert in `ScoreStrategy`), `app/main.py` boot call; design.md § Chosen Approach (feature 064).
- **Rule it implies**: prefer write-through+hydrate over DB-direct reads when a best-effort write and a
  durable read path must coexist; reuse the existing repo/pool (no new pool — F-06).

### 2026-07-08 — backtest-debug-info — design
- **Pattern**: To add a per-bar/observability read to an engine consumed by a live loop, keep the
  hot method's return type frozen and add a sibling (`evaluate_with_series()` beside `evaluate()`),
  the wrapped one delegating — protects mocking tests and the feature-048 caller from a blast-radius
  change while surfacing the extra data.
- **Evidence**: `services/xstockstrat-analysis/app/services/evaluator.py:74`; caller `app/engine/live_loop.py:119`; design.md § Chosen Approach.
- **Rule it implies**: prefer an additive sibling over widening a shared return contract (reinforces C-04/P-03; no new ID needed).

### 2026-07-09 — backtest-debug-info — reuse
- **Pattern**: When a diagnostics/observability read spans two engine paths, funnel per-row assembly
  through one shared builder (`_build_bar_diagnostic`) and a shared finalize pass — both paths satisfy
  the DRY pre-commit (jscpd) gate and the enum-default (C-04) init happens in exactly one place.
- **Evidence**: `services/xstockstrat-analysis/app/handlers/servicer.py` `_build_bar_diagnostic` /
  `_finalize_symbol_diagnostics`; PR #750.
- **Rule it implies**: a cross-path per-item transform gets one builder, not a copy per path.

### 2026-07-09 — backtest-debug-info — ordering
- **Pattern**: A proto→codegen→DB→service→UI feature executes cleanly as stacked step branches
  (`feature-steps/<slug>-step-N` each based on the prior) so the tip carries the cumulative diff and the
  feature branch fast-forwards to it for one integration PR. Provision the codegen toolchain on the host
  from the module proxy (`go install …/buf`) when GitHub-releases egress is blocked, and validate it
  reproduces committed stubs byte-for-byte before touching any `.proto`.
- **Evidence**: PRs #746–753; `Dockerfile.codegen` version pins.
- **Rule it implies**: verify the codegen toolchain against the committed stubs (empty diff) before the first proto edit.

### 2026-07-13 — cross-stock-score-derivation — design
- **Pattern**: When derived data must stay valid only for the *content* that produced it (here:
  backtest evidence valid only for the strategy definition it executed), stamp each row with a
  **canonical content fingerprint** (sha256 of the stored JSONB, non-behavioral keys excluded,
  always hashed from the DB-returned form) and make eligibility a fingerprint-equality predicate —
  not an `updated_at`-style timestamp comparison. Timestamps failed three ways the design debate
  proved concretely: unrelated writers bump them (live-toggle/deactivate), they can't tell *which*
  content an in-flight writer executed (mid-update race), and they can't reject look-alike callers
  (a run keyed to the right id but executing different content).
- **Evidence**: `docs/roadmap/features/065-cross-stock-score-derivation/design.md` § Chosen
  Approach (fingerprint mechanics verified by the round-2 design-adversary);
  `services/xstockstrat-analysis/app/repositories/strategies.py:54-93` (`updated_at` bumped by
  update, set_live_enabled, and deactivate alike).
- **Rule it implies**: content-scoped validity gets a content hash, not a clock; hash only the
  stored (post-JSONB-round-trip) form so every writer sees identical bytes.

### 2026-07-13 — cross-stock-score-derivation — reuse
- **Pattern**: Seeding a **unit-test layer in a large e2e-only frontend** without an unearnable
  coverage floor: set vitest `coverage.all: false` so the threshold applies only to files a unit test
  actually exercises (grows as tests are added), instead of `include: ['src/**']` which counts every
  untested module as 0%. Pairs with node-environment logic-only tests (`src/lib/**`) and an lcov
  reporter matching the existing `node-test` CI artifact contract.
- **Evidence**: `services/xstockstrat-ui/vitest.config.ts` (`all: false`, `src/lib` scope),
  `src/lib/scoreDisplay.test.ts`; `.github/workflows/ci.yml` `node-test` matrix (feature 065 step 13).
- **Rule it implies**: when adding coverage gates to a codebase with large untested surface, gate on
  tested files, not the whole tree — a floor you can't reach on day one gets disabled, not met.

### 2026-07-20 — trigger-backfill-mcp-tool — design
- **Pattern**: A new MCP agent tool has **five** discovery/documentation surfaces, not one: the
  `app/tools.py` module-docstring tool count + enumeration, the agent `CLAUDE.md` tool table, the
  `docs/runbooks/mcp-tools.md` reference (header count + per-tool section), the
  `docs/runbooks/CLAUDE.md` index line, and any **operational runbook** that documents how to do
  the underlying task (e.g. `historical-backfill.md` for a backfill tool). Recon found four; the
  adversarial round caught the fifth — the operational runbook is the surface that makes the
  capability *findable* by an operator solving a problem. The `/api/tools` catalog itself is
  automatic (FastMCP registration), but its name-set test is the built-in reachability proof.
- **Evidence**: feature 066 design.md § Chosen Approach (Docs — five surfaces); adversary round-1
  C-10(a) finding; `services/xstockstrat-agent/app/main.py:180` (auto catalog);
  `tests/test_tools_endpoint.py:23-35` (name-set test).
- **Rule it implies**: C-10(a) applies to tool/CLI/API additions, not just UI routes — enumerate
  the discovery surfaces (including task-oriented runbooks) at recon time and prove the shared one
  with a test.
