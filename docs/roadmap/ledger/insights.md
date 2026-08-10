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

### 2026-07-21 — fix-custom-formula-allnone — reuse
- **Pattern**: Decoding a `google.protobuf.Struct` response field with `dict(resp.field)` +
  `isinstance(raw, (list, tuple))` silently **drops every list value** — `Struct.update()` marshals a
  native list into a proto `ListValue`, which is not a `list`/`tuple`, so the gate skips it and any
  `[None]*n` fallback yields an all-`None` series (here: empty backtest `indicators` → `ENTRY_NEVER_TRUE`).
  Use `json_format.MessageToDict(struct)` for the recursive `ListValue`→native unwrap (already the
  inbound-decode pattern on the indicators side), and NaN/length-normalize the result rather than
  assuming the producer returns full-length series.
- **Evidence**: `services/xstockstrat-analysis/app/services/evaluator.py:185-191` (the buggy gate);
  producer `services/xstockstrat-indicators/app/handlers/servicer.py:171-176` (`Struct().update(...)`),
  `:126` (`MessageToDict` inbound); feature 067 recon.md § Root Cause + design.md.
- **Rule it implies**: never index/`isinstance`-filter a `Struct` field's raw values — recursively
  convert (`MessageToDict`) before use; reinforces P-03 (no silent drop) without a new ID.

### 2026-07-21 — backtest-results-visualization — design
- **Pattern**: "Store what you serve" — for a persisted payload whose only consumer is the RPC
  that returns it verbatim (no SQL ever inspects it), store the serialized proto message itself
  (`SerializeToString()` → BYTEA, `FromString()` on read) instead of JSONB or normalized rows.
  Sidesteps the NaN/Inf JSON round-trip trap (fails.md 2026-07-21 — `profit_factor` is
  legitimately `inf` on no-loss runs), gives byte-exact parity between the fresh response and the
  historical read (C-10(b) for free), and needs zero row↔proto mapping code. Pair it with a FK to
  the summary/list table so payload-exists ⇒ listed-exists stays structural.
- **Evidence**: feature 068 design.md § Chosen Approach + § Rejected Alternatives (JSONB,
  normalized rows); adversary round-1 objection 4 (FK existence-parity).
- **Rule it implies**: byte-serialized proto is the default encoding for read-back-only payload
  columns; JSONB only when SQL must query inside the payload (and then never with non-finite
  floats — fails.md 2026-07-21).

### 2026-07-24 — 069-strategy-reentry-cooldown — design
- **Pattern**: When two code paths must apply the *same* rule via a shared helper (here: backtest and
  live loop both calling `is_cooldown_active`), sharing the *function* is not enough — a cross-cutting
  input invariant (tz-aware-UTC datetimes) will silently drift if it is enforced by a comment at each
  call site. Enforce the invariant **inside the helper** (raise `ValueError` on a naive datetime) and
  unit-test the guard directly, so a third call site or a careless edit fails loudly instead of
  reintroducing the two-paths-drift failure the shared helper was meant to prevent. Complements C-10(b):
  the parity test proves the callers agree; the internal guard proves they *can't* feed the helper
  incompatible inputs.
- **Evidence**: `docs/roadmap/features/069-strategy-reentry-cooldown/design.md` § Chosen Approach
  (`cooldown.py` `_require_aware`); 5-round design debate (the naive/aware split was flagged R2, "fix by
  comment" rejected R3, moved inside the helper R4).
- **Rule it implies**: a shared helper reused across paths owns its input-contract enforcement (assert
  inside + a dedicated guard test), not a convention repeated at each call site — reinforces C-10(b), no new ID.

### 2026-07-24 — 069-strategy-reentry-cooldown — design
- **Pattern**: A proto3 scalar where the zero value is a *meaningful distinct choice* from "unset" (here:
  `cooldown_days = 0` = no cooldown vs. unset = platform default) MUST be declared `optional` (explicit
  presence) — `HasField`/`isFieldSet` is illegal on a plain scalar, and a bare `?? 0` / `x or default` /
  truthy `if x:` read collapses explicit-0 into unset, silently corrupting data (an unset field gets
  written back as an explicit 0 on the next edit). Verified the generated-code contract against Context7
  before designing the UI read: protobuf-es `optional int32` → `field?: number | undefined`, and
  `msg.field = 0` sets presence true. Same trap recurs at three layers — proto declaration, Python
  `get_int` config read (`v.int_val or default`), and the TS `?? 0` seed — each must be handled, not just
  the proto.
- **Evidence**: `design.md` § Chosen Approach (proto `optional`, UI `!== undefined ? String() : ''`,
  omit-on-blank submit); Context7 `/bufbuild/protobuf-es` presence contract; config zero-trap documented
  (not fixed) matching the `analysis.scoring.shrinkage_days` precedent.
- **Rule it implies**: if a scalar's zero is a real choice, declare it `optional` and check presence at
  every read/write layer — never `?? 0`, `x or default`, or a truthy guard; reinforces P-03 (verify the
  decoder/codegen contract), no new ID.

- 2026-07-24 (069 strategy-reentry-cooldown): A single shared **pure** gate module
  (`app/services/cooldown.py`, no DB/proto/gRPC imports) consumed identically by the backtest engine
  and the live loop, with the tz-awareness invariant enforced *inside* the helper (`_require_aware`)
  rather than by a per-call-site comment, made backtest/live parity (FR-4) directly unit-testable and
  killed the class of "two enforcement paths drift apart" bugs (cf. fails 056). Feed both call sites the
  **same** time source (bar time), never one wall-clock + one bar-time.

### 2026-07-26 — 071-backtest-time-window — design
- **Pattern**: A "warm-up is verified at runtime, so the constant is safe" defense must be checked
  against **each indicator's actual output contract**, not the warm-up helper's signature. Here
  `_first_resolved_index` infers warm-up from a `None` head, but `ewm(adjust=False)` (EMA/MACD) and
  `cumsum/arange` (VWAP) emit a finite float at index 0 — so the observed warm-up is `0` and any
  `p >= w` guard is *inert precisely for the path-dependent indicators a history prefix affects most*.
  Corollary: for an IIR indicator, `period` is a convention, not a bound (`e^-2 ≈ 13.5%` seed weight
  remains at `period`); use a convergence multiple when "already warm" is a requirement.
- **Evidence**: `services/xstockstrat-indicators/app/services/indicators_engine.py:48-51,62-84,110-118`
  vs `services/xstockstrat-analysis/app/handlers/servicer.py:1582-1588`; feature 071 design.md
  § Rejected Alternatives; adversary round-1 F-07 finding.
- **Rule it implies**: reinforces **P-03** — before relying on a runtime guard, prove it can actually
  fire for every input class it claims to cover; a guard that cannot fail is not a guard.

### 2026-07-26 — 071-backtest-time-window — design
- **Pattern**: Rendering an existing proto enum value or UI affordance **unreachable** is the mirror of
  ledger fail 067 and is strictly more dangerous: appending an enum value breaks `tsc` against an
  exhaustive `Record<Enum,…>`, but making one unreachable is compile-clean and silently leaves dead,
  now-misleading UI copy. Check reachability of what you are about to orphan, not just compilation of
  what you are adding.
- **Evidence**: forcing `warmup_bars = 0` would have orphaned `ACTION_LABEL[BarAction.WARMUP]` and
  `NO_TRADE_MESSAGE[NoTradeReason.ENTIRE_RANGE_WARMUP]`
  (`services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:9-27,137,153`); feature 071
  design.md § Rejected Alternatives.
- **Rule it implies**: extends **C-10(a/d)** — enum/affordance *reachability* is part of integration
  completeness; pair a change that can orphan a branch with a test that still exercises it.

### 2026-07-26 — 071-backtest-time-window — design
- **Pattern**: A silent pre-existing truncation makes "no behavior change" claims false in the
  *opposite* direction from the one you expect. Analysis never paginated `GetBars`, so marketdata's
  default `pageSize := 500` with `ORDER BY time ASC LIMIT` already truncated every ~504-trading-day
  max-range backtest. Adding correct pagination is therefore itself a behavior change
  (`trading_days` 499 → ~503) that shifts feature-065 evidence weights — the fix and the regression
  arrive together.
- **Evidence**: `services/xstockstrat-marketdata/internal/service/marketdata_service.go:124`,
  `internal/repository/marketdata_repo.go:88-90`; `services/xstockstrat-analysis/app/handlers/servicer.py:357`;
  feature 071 recon.md Risk 1 + design.md § 4.
- **Rule it implies**: when adding pagination to an unpaginated caller, measure the *current* silent
  cap first and state the delta — "correctness fix" and "no behavior change" are rarely both true.

### 2026-07-26 — 070-strategy-partial-update — design
- **Pattern**: Before adding a value to a proto enum, grep the **TypeScript BFF** for an exhaustive
  allow-list over it, not just exhaustive `Record<Enum,…>` render maps. `insightsBff.ts:46-49` gates
  admin scope with `op === REGISTER || op === UPDATE || op === DEACTIVATE`; a new
  `STRATEGY_OPERATION_PATCH = 4` would fall through as *non-mutating* and **skip `requireAdminScope`**,
  silently collapsing defense-in-depth to the backend's own check. A render-map miss is a compile
  error (067); an **authorization** allow-list miss compiles cleanly and is a security regression.
- **Evidence**: `services/xstockstrat-ui/src/lib/insightsBff.ts:46-49` vs
  `services/xstockstrat-analysis/app/handlers/servicer.py:1352`; feature 070 design.md
  § Rejected Alternatives (the decisive argument for FieldMask over a PATCH op).
- **Rule it implies**: extends **C-10(a/d)** — enumerate *authorization* switches over an enum, not
  only display switches; the failure mode is silent and security-relevant.

### 2026-07-26 — 070-strategy-partial-update — design
- **Pattern**: A partial-merge built on `MessageToDict` needs **one uniform rule**, never
  "scalars from the proto object, messages from the dict." `MessageToDict` omits default-valued
  no-presence fields, so a masked `components: []` never reaches the dict and a deliberate clear
  silently no-ops, while reading a masked-unset `Struct` off the proto persists `{}` where the key was
  previously absent — changing the JSONB key set and therefore any content fingerprint. The correct
  shape is AIP-161: `base[p] = full[p]` if present else `base.pop(p, None)`.
  `always_print_fields_with_no_presence=True` is **not** a fix — it targets only no-presence fields and
  injects `params: {}` / `active: false` churn.
- **Evidence**: `services/xstockstrat-analysis/app/handlers/servicer.py:1373-1376,1787-1790`;
  `packages/proto/analysis/v1/analysis.proto:230,236-238,245`; feature 070 design.md § 1.
- **Rule it implies**: reinforces **P-03** — verify the serializer's omission contract before designing
  merge semantics on top of it; presence rules differ per field kind and a two-rule merge will diverge.

### 2026-07-27 — 071-backtest-time-window — execute
- **Pattern**: When a value is **read at the top** of a per-item loop but **written at the bottom**,
  memoizing it in a shared cache silently makes item 1 behave differently from items 2+.
  `warmup.required_prefix_bars` reads the declared-formula-warm-up cache before fetching bars, while
  `_compute_evaluated_warmup` fills it after computing series — so the first symbol of a
  formula-using strategy sized its prefix from an empty cache (no prefix, short-warmed) and every
  later symbol got the full one. The result then depends on symbol *order*, which no single-symbol
  test can see. `required_prefix_bars`' own docstring already stated the contract ("must be
  pre-populated by the caller"); nothing enforced it.
- **Evidence**: `services/xstockstrat-analysis/app/handlers/servicer.py` `_prefetch_formula_warmups`
  / `_declared_formula_warmup`; test
  `TestPrefixFormulaCost::test_every_symbol_pays_the_same_prefix`; feature 071 context.md § step 6.
- **Rule it implies**: reinforces **C-08** — a lazily-filled cache read earlier in the same iteration
  than it is written needs a **multi-item** test asserting item 1 and item N behave identically. A
  docstring stating "caller must pre-populate" is a claim, not a guarantee.

### 2026-07-27 — 071-backtest-time-window — execute
- **Pattern**: A determinism assertion over a protobuf message must **clear the fields that differ
  per run by construction** (`backtest_id` uuid, `completed_at` stamp) rather than fall back to a
  field-by-field comparison. Left in, byte-identity is vacuously false and the natural next move —
  comparing a hand-picked subset of metrics — is exactly the weaker check that lets a real drift
  through. Likewise, a frozen-clock test needs a paired **teeth test** showing the unfrozen path
  genuinely moves; otherwise an inert patch reads as a passing determinism proof.
- **Evidence**: `services/xstockstrat-analysis/tests/test_analysis_servicer.py` `_canonical`,
  `TestWindowDeterminism::test_the_frozen_clock_test_has_teeth`.
- **Rule it implies**: extends **P-06** — when a test asserts "X does not change Y", add the
  companion assertion that something *does* change Y, so a no-op harness can't masquerade as a pass.

### 2026-07-27 — 071-backtest-time-window — execute
- **Pattern**: A mock that **echoes a request field back** as its response cannot distinguish a
  correct consumer from an incorrect one. `mock-backend.ts` returned `req.range` as both
  `requestedRange` and `gap`, so an e2e asserting the backfill action's range would pass whichever
  field the UI read. Only once 071 made the two genuinely differ (the gap is the *pre-window* span)
  did the assertion acquire meaning.
- **Evidence**: `services/xstockstrat-ui/e2e/fixtures/backtests.ts` `prefixGapRange`;
  `e2e/insights/backtest-coverage.spec.ts` "backfill action fills the pre-window warm-up gap".
- **Rule it implies**: reinforces **C-12** — a fixture whose fields are all equal to each other (or
  to the request) tests nothing about which field a consumer picked; make the distinguishing fields
  distinguishable.

### 2026-07-27 — 072-backtest-result-attachment — design
- **Pattern**: When designing an attachment/export format, the fidelity question is decided by the
  **producer's** JSON contract, not by the format's expressiveness. `MessageToDict` maps int64 to a
  JSON **string** and non-finite doubles to `'NaN'`/`'Infinity'` — executed, not inferred:
  `bar_index` → `7` (`int`) but `volume` → `'51234567'` (`str`), `vwap` → `'NaN'`,
  `profit_factor` → `'Infinity'`. Any flat/untyped format (CSV) therefore cannot round-trip, because
  two numeric-looking columns must reconstruct to different Python types and `csv.DictReader` returns
  only `str`; `json_format` also refuses to parse `'nan'` back. The safe shape is to attach the
  producer's own dict verbatim, so fidelity holds *by construction* rather than via a hand-written
  reassembler wearing a fidelity label.
- **Evidence**: `packages/proto/analysis/v1/analysis.proto:121,127`; `json_format.py:315-324`,
  `:1045-1046`; feature 072 design.md § Rejected Alternatives.
- **Rule it implies**: extends the 2026-07-21 **P-03** entry from decode to **encode** — verify the
  serializer's contract in *both* directions before designing a format on top of it.

### 2026-07-27 — 072-backtest-result-attachment — design
- **Pattern**: Choose between two mechanisms by **failure asymmetry**, not by best-case efficiency.
  `ResourceLink` defers bytes (better best case) but its worst case is *unrecoverable*: the agent is
  stateless (no in-memory store, `instance_count > 1` safe), so a dangling link means the data is
  gone and the user re-runs the work. `EmbeddedResource`'s worst case is merely verbose. Decisive
  detail: the producer **cannot know at emit time whether the link would resolve** — feature 068's
  detail write is best-effort and nothing in `BacktestResult` reports whether the row landed, so the
  link is a promise with no means to check it.
- **Evidence**: `services/xstockstrat-analysis/app/handlers/servicer.py:527-528,1398-1399,1403,1412-1413,1513-1515`;
  `services/xstockstrat-agent/CLAUDE.md` § OAuth (FR-B13); feature 072 recon.md § Risks 1-7.
- **Rule it implies**: before designing a reference/pointer to data another feature persists
  best-effort, check whether the referrer can *detect* a failed persist. If it cannot, prefer
  carrying the value over referencing it.

### 2026-07-27 — 072-backtest-result-attachment — design round 2
- **Pattern**: A second grilling round on an **already-approved, already-specced** design is worth
  running when the first round closed on estimates. Round 2 here left the chosen approach untouched
  but still paid for itself: measuring the payload (5 symbols × 504 bars) showed the inline summary
  is **1.0 KB**, not the ~2 KB assumed, and gzip is **103 KB**, not the ~53 KB assumed — a 2× error
  that an approved acceptance criterion was resting on. It also caught an AC-1 test bound
  (`< 8_000` bytes) loose enough to tolerate a ~4× regression, making the guard decorative. Crucially
  it was still *cheap* to act on: **F-09 freezes step bodies only once `/sdd-execute` dispatches**, so
  check `**Status**: pending` on every step before concluding a correction is too late.
- **Evidence**: `docs/roadmap/features/072-backtest-result-attachment/{design.md,product-spec.md,implementation-spec.md}`;
  feature 072 context.md § round 2.
- **Rule it implies**: extends **C-01** — a number that reaches an acceptance criterion must be
  measured, not estimated. If a design closes with figures nobody ran, a follow-up round that only
  measures them is a good trade even when the decision does not change.

### 2026-07-27 — 072-backtest-result-attachment — design round 2
- **Pattern**: When a feature writes a decision rule into the ledger, later rounds of that **same
  feature** must be checked against it. Round 2 proposed swapping the attachment to gzip, which would
  have inverted the failure-asymmetry rule this feature had recorded one day earlier and used to
  reject `ResourceLink`: a truncated gzip stream has no trailer and no CRC, so host truncation or an
  unknown-mime drop is total loss — exactly the "unrecoverable worst case" that disqualified the link,
  whereas compact JSON truncates to a readable head. Citing a rule against one option while ignoring
  it for another is the failure mode to watch for.
- **Evidence**: `insights.md` 2026-07-27 (072 design, failure asymmetry) vs the round-2 gzip proposal;
  feature 072 design.md § Rejected Alternatives.
- **Rule it implies**: reinforces **P-03** — a self-authored ledger rule binds the feature that wrote
  it. Re-read your own entries before adopting a change that trades the same axis.

### 2026-07-27 — 072-backtest-result-attachment — execute
- **Pattern**: When a step's verification cannot pass standalone because a *later* step adapts the
  test it breaks, the F-05-clean split is to carry **only the minimum adaptation** in the breaking
  step's commit, not to merge the two steps or to commit red. 072's step 3 changed
  `run_backtest`'s return shape, which reddens one assertion in a test step 4 owns; step 3's commit
  carried that single line and step 4's added the nine new tests. One commit per step, every commit
  green, and the pairing stays visible in history instead of being collapsed.
- **Evidence**: feature 072 `implementation-spec.md` § Step Dependencies; commits
  `feat(072): step 3` / `test(072): step 4`.
- **Rule it implies**: refines **F-05** — "commit only when green" does not force merging a
  red-green pair into one commit; it forces the *green-making minimum* to travel with the change
  that broke it.

### 2026-07-29 — 079-remove-mcp-sse-transport — design
- **Pattern**: A grep-based acceptance criterion written to be "mechanical and objective" can be
  **unsatisfiable by the correct implementation**, and the failure is invisible until someone tries to
  run it. Here AC-5 demanded zero repo hits for `/sse|/messages|MCP_SSE_PORT` outside a NOT-changed
  list — but the feature's own 404 branch must name the removed paths, and its own deprecated-env
  fallback must name the old var. Three candidate replacements each failed a different way when
  actually executed: "hard zero repo-wide" fails on `docs/roadmap/features/**` (the SDD pipeline's own
  artifacts name the symbols being removed); a **marker-token filter** (pipe survivors through
  `grep -viE 'deprecat|removed|legacy|404'`) produces false negatives on legitimate survivors carrying
  no marker word on their own line, and pressures the author to contort code to satisfy a grep; and a
  **file-granularity allow-list** is worst of all — allow-listing the one file that legitimately
  survives also exempts the stale comment inside it that the gate existed to catch. What works: two
  tiers — a hard mechanical zero for **symbols that cease to exist** (no legitimate survivor is
  possible, so it catches missed renames), plus a **line-granularity** enumeration for the rest, with
  each survivor justified. Anything that must not hide gets pinned **by name** in a requirement rather
  than left to the gate.
- **Evidence**: feature 079 `product-spec.md` AC-5 (restated), `design.md` §4; the exempted line was
  `services/xstockstrat-agent/app/main.py:125-128` (SSE rationale inside `_authorized`, which survives
  the route deletion — recon Risk 3).
- **Rule it implies**: before writing a grep as an acceptance gate, **run it against the intended
  post-change tree**. A gate that has never been executed is a claim, not a check — the same shape as
  the 2026-07-27/2026-07-29 `fails.md` entries, moved from test evidence to gate design. Prefer
  zero-hit gates on symbols that will not exist over substring gates on vocabulary that legitimately
  survives.

### 2026-07-29 — 079-remove-mcp-sse-transport — design
- **Pattern**: Extracting `main()` out of `if __name__ == "__main__":` is what makes an
  entrypoint-dispatch requirement testable at all. The proposed plan tested `resolve_transport()`'s
  **return value** and called that coverage of "MCP_TRANSPORT=sse still starts a working server" — but
  the string→server dispatch lived in the `__main__` block, which pytest never reaches, so six green
  tests would have proven nothing about the acceptance criterion they were written for. A three-line
  extraction (`def main(): ...` + `if __name__ == "__main__": main()`) leaves `python -m app.main`
  unchanged and lets a test monkeypatch `asyncio.run`/the runners and assert **which** was selected.
- **Evidence**: feature 079 `design.md` §2; `services/xstockstrat-agent/app/main.py:216-227`;
  `services/xstockstrat-agent/Dockerfile:21` (`CMD ["python","-m","app.main"]`).
- **Rule it implies**: when an acceptance criterion is about *what the process does at startup*, check
  where that decision physically lives before writing its test. Logic in `__main__` is unreachable
  from the suite; a one-shot manual run against a real socket is a demonstration, not a regression
  guard (see `fails.md` 2026-07-27). Extract the dispatch instead.

### 2026-07-29 — 080-fix-backfill-timeframe-enum — reuse
- **Pattern**: To prove a deprecated-field migration is *complete*, sweep **producers and readers as
  two separate passes**, and add a third pass for **untyped surfaces**. The producer pass (grep the
  message type name per language) is the one everybody runs; it found 5 of 7 sites. The reader pass
  (grep the *field accessor* — `\.Timeframe\b` / `\.timeframe\b` — not the type) is what surfaced the
  decisive defect, because a reader binds the field to a local at a distance from any type name. The
  untyped pass (ledger `Struct` / `map[string]interface{}` / log + OTel attributes / hand-rolled JSON)
  catches sites where **no generated field and no deprecation lint signal exist at all** — two were
  found this way and would have persisted `""` into an append-only store forever. Bonus heuristic that
  paid off: in a tree that annotates deprecated reads with `//nolint:staticcheck // SA1019`, a hit
  **without** the nolint is a signal to check the field's type rather than assume scope — that is how
  `marketdata_service.go:288,330` was correctly excluded (already `commonv1.Timeframe`).
- **Evidence**: feature 080 `design.md` § Readers sweep (the full classified table, with the
  re-runnable grep method); the sites it found that three producer-oriented rounds missed —
  `services/xstockstrat-ingest/app/handlers/servicer.py:153,161`,
  `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:258`,
  `internal/service/marketdata_service.go:588-591`.
- **Rule it implies**: reinforces **C-10(b)** — "every read path" includes readers reached through a
  local variable and values copied into untyped payloads. A type-name grep alone systematically
  under-reports, and it under-reports in the direction that looks complete.

### 2026-07-30 — 082-fix-fmp-config-boot-only — design
- **Pattern**: When the true regression test would require an expensive or fragile dependency (here:
  routing a live-toggle test through the real `fmp.Client` would mean an outbound HTTP call to
  FMP's actual API), don't add the fragile end-to-end test — **compose the proof from narrower unit
  facts plus one written, inspectable argument**. This feature proved "the boot-time fix + the
  live-gate behavior together satisfy the acceptance criteria" via three pieces: (1) a canary test
  that the extracted constructor always returns non-nil, (2) a one-line, branch-free passthrough
  assignment verified correct by inspection (`s.fundamentals = fundamentals`), and (3) an existing-
  pattern toggle test proving the live gate is correct given a non-nil source. The design-adversary
  caught two rounds in a row that a single "linking" test either didn't touch the actual bug site or
  would have required real network calls — the fix was to name the composition explicitly in
  `design.md`, not to force a fragile integration test into existence.
- **Evidence**: `docs/roadmap/features/082-fix-fmp-config-boot-only/design.md` § Chosen Approach
  point 5, § Rejected Alternatives ("thread the real fmp.Client..."); 2-round design debate,
  round-1 and round-2 adversary objections (`context.md` § sdd-design session).
- **Rule it implies**: extends **P-06** — when the fully-faithful regression test is disproportionate
  (network calls, real dials), decompose the claim into unit-testable facts plus a named,
  inspectable invariant (a one-line passthrough, an unconditional call site) rather than skipping
  coverage or forcing a fragile end-to-end test. State the composition explicitly so a reviewer can
  audit the chain, not just the individual tests.

### 2026-07-31 — 083-ui-revamp-opportunities-first — design
- **Pattern**: To add durable, per-conversation state (a Copilot chat thread) **without a new DB pool**
  when the F-06 budget is at the 20-connection cap, reuse the **ledger append-only store** instead of
  giving the stateless service its own database: `AppendEvent` with `stream_key="<domain>:{user_id}:{id}"`
  + a schemaless `google.protobuf.Struct` payload + `idempotency_key`, replayed via `QueryEvents(stream_key)`
  (`sequence` monotonic per stream). No new pool, no migration, no new schema. **Precondition:** the data
  must be genuinely append-only — ledger events are immutable, so a UX with edit/delete/clear-history
  cannot use it; confirm that before choosing this home.
- **Evidence**: `packages/proto/ledger/v1/ledger.proto:14-15,33-61`; feature 083 design.md § Chosen Approach
  point 3 (Copilot), verified by the round-2 design-adversary against the proto.
- **Rule it implies**: honors **F-06** — for append-only per-entity state, an existing append-log keyed by
  `stream_key` is a no-new-pool persistence home; prefer it over a new service DB when the pool budget is full.

### 2026-07-31 — 083-ui-revamp-opportunities-first — design
- **Pattern**: Before adding an inter-service edge to read a value, check the **root dependency-graph
  direction** first — the natural reader may already be dialed from the other side, so a new synchronous
  edge would create a gRPC/`WAIT_FOR` **cycle**. Here portfolio needed the resting-STOP price from trading,
  but trading→portfolio already exists; a `portfolio→trading` read edge would have closed a boot-order cycle.
  The non-cyclic fix: portfolio (which already consumes ledger events for position state) learns the stop
  from trading's **ledger order-event** — eventual-consistency on the derived value in exchange for no cycle.
  Corollary caught the same round: a "conviction %" that ranks an **order-opening** queue must have its
  formula pinned at design time (deterministic ordinal), and an action verb (EXIT vs TRIM) must never be
  **synthesized from an undefined threshold** on a trade surface — collapse to the tag the source data
  actually supports and let the human choose.
- **Evidence**: feature 083 design.md § Rejected Alternatives (portfolio→trading, TRIM/EXIT, conviction-%);
  root `CLAUDE.md` § Inter-Service Dependencies (trading→portfolio); `services/xstockstrat-portfolio/internal/service/portfolio_service.go:69-88` (dials ledger/marketdata/notify only).
- **Rule it implies**: reinforces **P-03**/**C-10** — for a new cross-service read, verify the graph
  direction and prefer an existing event channel over a reverse synchronous edge; never manufacture a
  trade-action label or a ranking number from an undefined model on an order surface.

### 2026-08-02 — mcp-tools-alignment-triage — design
- **Pattern**: The durable antidote to MCP-surface drift is a **descriptor-parity / return-shape contract test** over each hand-written dict→proto request builder and each projection, mirroring the one guard that kept `run_backtest` honest: `test_backtest_view.py::test_summary_key_set_covers_every_proto_field` asserts the agent's field set equals `<Message>.DESCRIPTOR.fields_by_name` minus an explicit `_INTENTIONALLY_UNSET` set, so a newly-added proto field fails the test until the builder/projection carries it (or explicitly opts out). Applying the same guard to the `RegisterFormulaRequest`, `ScreenCriterion`, `SignalSource`, and `EmitAlertRequest` builders would have caught F-3/F-4/F-6/F-10 at commit time instead of via a manual audit.
- **Evidence**: `services/xstockstrat-agent/tests/test_backtest_view.py` (the template); report RC-1 + meta-cause (`docs/reports/2026-08-01-mcp-tools-alignment-triage.md`).
- **Rule it implies**: reinforces **C-10** — every agent request builder / response projection that mirrors a proto gets a descriptor-parity test with an explicit opt-out set; new proto fields then fail closed rather than silently dropping off the MCP surface.

### 2026-08-02 — 093-fix-mcp-extract-credentials — design
- **Pattern**: When a "credential/secret handling" bug tempts a quick fix that *reads a secret from
  ordinary config*, check the platform's secret model first — if secrets are `is_secret` **references**
  that the config server **redacts** on read, then a plaintext config credential is both a C-05
  violation AND gets disclosed unredacted by any read tool. The honest minimal fix is often to make the
  broken capability **loudly unsupported** (raise a clear error — the "surface, don't swallow" win)
  rather than entrench the antipattern; defer the real resolver as its own feature. Second lesson
  (RC-1): a config/read helper that projects a **single oneof field** (`v.string_val or None`) silently
  returns `None` for every other type — a `value_type='float'`/`'bool'` key never resolves regardless
  of scope. Stringify the **active** oneof (`WhichOneof` → `str(getattr(...))`) and test the projection
  with a non-string fixture, or the "fix" leaves the key broken for a different reason than the report
  blamed.
- **Evidence**: feature 093 design.md §1–2 + Rejected Alternatives; `services/xstockstrat-agent/app/client.py:693` (string_val-only) vs `:872-876` (the correct WhichOneof projection); `services/xstockstrat-config/CLAUDE.md` invariant #6.
- **Rule it implies**: reinforces **C-05**/**P-03** — never resolve a secret from non-`is_secret` config; and extends the RC-1 antidote to *projection* helpers, not just request builders (test the returned value for a non-string type).
### 2026-08-02 — 092-fix-mcp-writepath-authz — design
- **Pattern**: When an ungated internal RPC is flagged for "missing authz," first enumerate **who
  actually calls it and what each caller sends** before choosing a gate — the caller set decides the
  model. Here every `EmitAlert` caller was unauthenticated/internal (analysis loops send no metadata;
  the agent sends only `x-mcp-secret`), so (a) an admin-bit gate breaks every caller, and (b)
  enforcing `x-mcp-secret` **inverts** the trust boundary — the one *external* caller (the OAuth-gated
  agent) is the only one that sends the secret, while trusted internal callers don't. The correct
  answer for a low-severity, no-admin-semantics RPC behind the private network was an **explicit
  internal-service-caller contract** (documented + tested), not a per-call gate. Corollary: when a
  hardcoded elevated credential is replaced by the caller's real derived scope, that is an intended
  **access reduction** for non-privileged callers — call it out in the product-spec, don't let it
  read as a regression. And "function X is now orphaned → delete it" is an absence claim: grep for
  live refs (tests/docstrings) first — deleting past a test assertion breaks collection.
- **Evidence**: feature 092 design.md §3 + Rejected Alternatives; `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:30`; caller survey in recon.md.
- **Rule it implies**: reinforces **P-03**/**C-01** — pick an authz model from the verified caller set, not the RPC in isolation; grep-verify every "orphaned/only-affected" absence claim at the design gate.
### 2026-08-02 — 091-fix-mcp-config-key-registry — design
- **Pattern**: To audit **row creation** on a table written via `INSERT … ON CONFLICT DO UPDATE`, add a
  dedicated **`AFTER INSERT`** trigger — never widen an existing `BEFORE UPDATE` audit trigger to
  `BEFORE INSERT OR UPDATE`. Under `ON CONFLICT DO UPDATE` the update path fires the `BEFORE INSERT` arm
  (for every proposed row, `OLD` NULL → a phantom `old_value=NULL` "creation" audit row, even on a no-op
  re-write) *and* the `BEFORE UPDATE` arm → two audit rows per update and an uncorrelatable creation vs
  update log. `AFTER INSERT` fires only for rows *actually* inserted (the conflict/update branch does not
  fire it), so creation is audited exactly once and the update path stays untouched. Second half of the
  same design: a write-time **existence gate must be scoped-EXACT to the table's `ON CONFLICT` conflict
  key** (here `(namespace,key,environment,trading_mode)`), not broadened to mirror a read predicate
  (`… OR trading_mode='all'`) — broadening lets a write "find" a broader row then INSERT a distinct
  narrower one, manufacturing a duplicate the read paths resolve nondeterministically (no `ORDER BY`
  precedence).
- **Evidence**: feature 091 design.md §1–2; `services/xstockstrat-config/migrations/001_config_tables.up.sql:40,49-51`; `services/xstockstrat-config/src/grpc/configServiceImpl.ts:316-325,343`.
- **Rule it implies**: reinforces **F-01**/**C-08** — audit-on-create is an `AFTER INSERT` trigger in a
  new migration, and any existence/dedup gate matches the exact conflict-key grain of the write it guards.
### 2026-08-02 — 086-fix-mcp-formula-lifecycle — design
- **Pattern**: To make a cross-service resource **safely deletable** without a reverse dependency edge, use **soft-delete + a surfaced `deleted` flag + run-time flagging at the existing consumer**, not a hard reference-checked delete that dials the consumer. Here indicators soft-deletes a formula (`deleted_at`, exposed as `FormulaDefinition.deleted`), keeps `get_by_id` deleted-agnostic so strategies already referencing it keep evaluating, and analysis — which already fetches each referenced formula via `GetFormula` at strategy-write (`_fetch_formula_outputs`) and at the backtest warmup prefetch (`_declared_formula_warmup`) — refuses *new* bindings to a deleted formula and appends a user-visible line to a new additive `BacktestResult.warnings` field. Zero new inter-service edges, zero new DB pool. The key move: a "soft delete" is only honest if the deleted state is **surfaced by every read path AND flagged in the run output** — otherwise it silently hides a hard-delete (the adversary's AC-dishonesty objection). Reuse the consumer's *existing* fetch site as the detection point rather than adding `deleted` to the hot-path RPC response (avoids a multi-call-site blast radius).
- **Evidence**: `docs/roadmap/features/086-fix-mcp-formula-lifecycle/design.md` §§ Chosen Approach 2/4, Rejected Alternatives; analysis `_fetch_formula_outputs` (`servicer.py:194-201`), `_declared_formula_warmup` (`servicer.py:1151`); root CLAUDE.md dep graph (analysis→indicators already exists, reverse edge would cycle — ledger 2026-07-31 083).
- **Rule it implies**: extends **C-10(b)** and **F-06** — for a deletable resource another service depends on, prefer soft-delete + surfaced flag + run-flag at the consumer's existing fetch site over a reverse referential-delete edge; and "soft delete" is not honest unless the deleted state is observable in reads and flagged in runs.

### 2026-08-02 — 097-remove-x-mcp-secret-header — execute
- **Pattern**: Writing a **removal feature's** replacement doc/comment text is easy to get subtly
  wrong twice, both caught only at execute time, not spec time. First: when a step's own
  `**Verification**` demands a hard zero-count of the removed vocabulary in a set of files, the
  step's *Instructions* must not suggest replacement wording that re-quotes the removed term — even
  in clearly-past-tense "feature N removed X" framing — because the literal string still trips the
  grep. Prefer generic phrasing ("the header" / "its shared-secret header") over naming the removed
  symbol, or the step verifies itself false the moment you follow its own suggested wording. Second:
  a final repo-wide sweep (per the `079-remove-mcp-sse-transport` "hard-zero on symbols, reviewed
  survivors on vocabulary" lesson) reliably surfaces **out-of-scope files no recon pass named** —
  here a root `docs/context-constitution-findings.md` "Open questions" entry describing the
  soon-to-be-false pre-removal behavior as current fact. Treat every sweep survivor as needing a
  hand verdict, not a blanket pass/fail: a doc claim of current/active behavior gets fixed even if
  outside the original file list (P-03 — a known false claim is never left alone because a file
  wasn't named in advance); a **negative test assertion** using the removed literal as its
  comparison target (`assert not any(k == "<removed-header>" ...)`) is the opposite of a stale
  claim — it's the permanent anti-reintroduction guard — and is correctly left alone even though its
  file isn't in any formal exemption list.
- **Evidence**: `docs/roadmap/features/097-remove-x-mcp-secret-header/implementation-spec.md` §
  Deviation Log, Step 3 and Step 5 entries; `docs/context-constitution-findings.md:37` (the
  out-of-scope stale claim, fixed); `services/xstockstrat-agent/tests/test_client.py` (the
  reviewed-and-accepted negative-assertion survivor); reinforces `docs/roadmap/ledger/fails.md`
  2026-07-29 `079-remove-mcp-sse-transport`.
- **Rule it implies**: extends the **P-03** removal-verification-gate lesson from `fails.md` 079 —
  (a) at spec time, never let a step's own suggested replacement text reintroduce the literal string
  its Verification greps for zero of; (b) at execute time, a final sweep's survivors are triaged by
  *what they claim* (current-tense/active → fix regardless of original scope; negative-assertion
  test code → leave), not by whether the file was on the original list.

### 2026-08-02 — 098-screener-watchlist-fidelity — design
- **Pattern**: When a design surface is **scoped by a single upstream choice** (readiness is evaluated
  against **one** strategy for the whole list), render that dimension as a **single caption** ("Evaluated
  against: `<strategy>`"), never a per-row column that repeats the identical value. A repeated column is
  not merely noisy — it visually re-implies a **per-row binding that does not exist** (here a per-symbol
  signal→strategy binding feature 083 explicitly forbids). Complement for derived roll-ups over a
  producer that can return an **empty/degenerate** row: bucket the degenerate case as its own honest
  state (`nodata` = `total_conditions==0`, the evaluator's per-symbol bar-fetch fallback) rather than
  folding it into a real state (`quiet`), and reconcile the roll-up denominator against the **requested
  input set** (count absent symbols as `nodata`) so `sum === requested.length` holds even if a future
  producer drops rows — defends the count-parity invariant beyond the mock's current 1:1 guarantee.
- **Evidence**: `docs/roadmap/features/098-screener-watchlist-fidelity/design.md` §§ 1, 4, Rejected
  Alternatives; `services/xstockstrat-analysis/app/services/evaluator.py:191`,
  `app/handlers/servicer.py:1996-2003` (1:1 append + empty-readiness fallback);
  `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx:34-44` (083 no-fabricated-binding).
- **Rule it implies**: extends **C-10(b)** — a UI dimension fixed by one upstream selection is a caption,
  not a per-row column; and a derived count over a producer with a degenerate-row fallback needs both a
  distinct bucket for the degenerate case and a denominator reconciled to the requested input set.

### 2026-08-03 — opportunity-universe-unification — design
- **Pattern**: When a read surface needs derived-but-expensive data and the service *cannot enumerate its consumers* (analysis has no per-user strategy owner column and no global user-list RPC), prefer **lazy-materialize-on-read + persist(`valid_until`) + stale-while-revalidate + a daily refresh** over a standing background producer loop. A standing loop that can only refresh users already present in its own tables buys freshness that is invisible to anyone not currently looking, grows unbounded without an eviction rule, and (see Evidence) cannot borrow `live_loop`'s cap as a fairness mechanism because that cap truncates rather than round-robins.
- **Evidence**: `docs/roadmap/features/097-opportunity-universe-unification/design.md` § Rejected Alternatives; `services/xstockstrat-analysis/app/engine/live_loop.py:102-110` (SELECT with no ORDER BY + `processed >= max` return = truncation, not round-robin); `migrations/001_strategies.up.sql` (strategies are global, no `user_id`).
- **Rule it implies**: a background materializer is only justified when it can enumerate the full consumer set independently of reads; otherwise lazy-on-read + TTL revalidate is the minimal shape (How-to-Act #2). Candidate design principle.

### 2026-08-06 — 030-stop-loss-bracket-orders — design
- **Pattern**: A safety-critical in-process flag (an automated account halt, a kill switch) proposed as
  a bare `map[string]bool` was caught across two design rounds for the same root cause: process-local
  state silently evaporates on the routine event this platform's CI/CD triggers on every merge — a
  redeploy — not just on a hypothetical multi-replica race. The fix each time was the same: this
  codebase already has the *exact* precedent for "a per-account status that must survive a restart" —
  `xstockstrat-trading`'s `credential_status` column (`migrations/004_broker_accounts_credential_status.up.sql`),
  hydrated into an in-memory map at `LoadBrokerPool` boot (`trading.go:127,155-157`). Reuse that shape
  (persisted column + boot-time hydration) for any new per-account safety state instead of inventing a
  bare map — but reuse the *mechanics*, not just the description: the precedent's own dual-write
  releases its mutex *before* the DB call and does not hold a lock across a Postgres round-trip
  (`validateAndRecordCredential`, `trading.go:1072-1090`). A superficial "follows the same pattern"
  claim that skips this detail reintroduces an unbounded-lock-hold liveness risk on the very read path
  (`PlaceOrder`) the halt is meant to protect.
- **Evidence**: `docs/roadmap/features/030-stop-loss-bracket-orders/design.md` § Chosen Approach
  ("Halt.") + § Rejected Alternatives ("Hold the halt mutex across the DB write"); 5-round design
  debate, round-4 and round-5 adversary findings.
- **Rule it implies**: extends **P-03** — when reusing an existing persistence pattern for new
  safety-critical state, verify the precedent's actual concurrency mechanics (lock scope, write
  ordering, rollback-on-failure direction), not just its surface shape (a column + a boot hydrate). A
  described pattern and its real mechanics can silently diverge, and the diverging detail is often the
  one that matters most under failure.

### 2026-08-05 — add-ikbr-account-support — reuse
- **Pattern**: When a PRE_DEPLOY migrator job lacks a service's runtime secrets, seed env-var-derived default rows in application startup code, not in the migration.
- **Evidence**: `docs/roadmap/features/001-add-ikbr-account-support/context.md:144,214,353-356`.
- **Rule it implies**: Check whether the migrator job has the credentials a seed row needs before putting seed logic in a migration.

### 2026-08-05 — add-ikbr-account-support — design
- **Pattern**: Implementation-spec file/line citations can go stale between spec-generation and execute (proto evolves, tests evolve); execute steps should re-verify via grep instead of trusting the spec.
- **Evidence**: `docs/roadmap/features/001-add-ikbr-account-support/context.md:174,272,188`.
- **Rule it implies**: Treat implementation-spec file/line citations as a starting hint, always re-grep the live file before editing.

### 2026-08-05 — broker-accounts-ui — reuse
- **Pattern**: Radix UI `Select`/`SelectItem` rejects `value=""` at runtime (reserved for empty state); use a non-empty sentinel (e.g. `__all__`) mapped to `""` at the component boundary whenever a Select needs an "all/none" option.
- **Evidence**: `docs/roadmap/features/002-broker-accounts-ui/context.md:154`, implementation-spec.md deviation log L908-911 (pruned; recoverable via git history).
- **Rule it implies**: Use a non-empty sentinel and map to/from `""` at the component boundary for any Select needing an "all/none" option.

### 2026-08-05 — broker-accounts-ui — reuse
- **Pattern**: Playwright browser binary downloads can be blocked in a sandboxed environment; symlinking an already-present compatible version to the expected path plus an inert escape-hatch env var unblocks local E2E without touching CI.
- **Evidence**: `docs/roadmap/features/002-broker-accounts-ui/context.md:138,154`.
- **Rule it implies**: When bumping Playwright/browser versions, expect this workaround to recur in-session; don't try to fix CI's install path.

### 2026-08-05 — broker-accounts-ui — design
- **Pattern**: Adding a new Select/combobox to shared layout (e.g. a global header) can break Playwright strict-mode locators in unrelated, already-passing specs elsewhere on the same page.
- **Evidence**: `docs/roadmap/features/002-broker-accounts-ui/context.md:141`, implementation-spec.md L906 (pruned; recoverable via git history).
- **Rule it implies**: Treat any new interactive element added to shared layout as requiring a full-suite E2E re-run, not just tests for the new component.

### 2026-08-05 — formula-management-ui — ordering
- **Pattern**: Hold execution of a feature whose UI steps target a service another in-flight feature is consolidating/deleting, until that prerequisite merges.
- **Evidence**: `docs/roadmap/features/003-formula-management-ui/context.md` session 2026-06-01 ("re-spec plan confirmed", "stream-2 reorder").
- **Rule it implies**: Before `/sdd-execute` on a UI-touching step, check `merge-order.md` for any in-flight consolidation/refactor of the target service; wait rather than eat a second re-spec.

### 2026-08-05 — formula-management-ui — design
- **Pattern**: A BFF route overwrites a client-supplied ownership field (e.g. `author`) with the trusted server-side identity before forwarding to the backend RPC.
- **Evidence**: `docs/roadmap/features/003-formula-management-ui/` implementation-spec.md Step 7, lines 559-599 (pruned; recoverable via git history).
- **Rule it implies**: Any ownership/identity field accepted from a client request body must be overwritten server-side at the BFF layer, never trusted as-typed.

### 2026-08-05 — frontend-reverse-proxy — design
- **Pattern**: Unifying multiple Next.js apps behind one entry point favored path-based nginx proxy + `basePath` over subdomains/Traefik/`assetPrefix`-only, specifically to avoid DNS/TLS sprawl and keep internal links working. (Historical — this architecture was later superseded by feature 045's consolidated single Next.js UI.)
- **Evidence**: `docs/roadmap/features/005-frontend-reverse-proxy/context.md` session 2026-05-11, decisions 1-3.
- **Rule it implies**: When consolidating frontends, default to path-based routing + Next.js `basePath`, and document why subdomain routing was rejected (TLS/DNS cost) before considering it again.

### 2026-08-05 — frontend-reverse-proxy — reuse
- **Pattern**: New infra components (e.g. a reverse proxy) get their own `services/<name>/Dockerfile` rather than a repo-root `Dockerfile.<x>`, even when a spec suggests root placement.
- **Evidence**: `docs/roadmap/features/005-frontend-reverse-proxy/` implementation-spec.md Deviation Log, Step 2 (pruned; recoverable via git history).
- **Rule it implies**: Default new infra scaffolding to `services/<name>/` for consistency with existing service tooling/CI filters.

### 2026-08-05 — do-nginx-integration — reuse
- **Pattern**: Repo verification steps that assume mikefarah's `yq eval` syntax fail silently/wrong when the host has the Python jq-wrapper `yq` installed instead.
- **Evidence**: `docs/roadmap/features/006-do-nginx-integration/` implementation-spec.md:363-371 Deviation Log; context.md Session 2026-05-18 00:00/00:01 (pruned; recoverable via git history).
- **Rule it implies**: Prefer `python3 -c "import yaml; ..."` (already in this repo's toolchain) as the portable default for YAML spot-checks in impl-specs, or explicitly pin/verify which `yq` flavor is installed before writing verification commands.

### 2026-08-05 — signal-source-weighting — design
- **Pattern**: Structured (dict/JSON) config values can be delivered through the existing `value_type='string'` column plus `get_str()` + `json.loads()` in the consuming service, with clamping/defaulting done at read time — no proto or schema change needed.
- **Evidence**: `docs/roadmap/features/007-signal-source-weighting/` product-spec.md FR-2/FR-4/FR-5; implementation-spec.md Step 2 (servicer.py `RunBacktest` read path); context.md 2026-05-23 session (pruned; recoverable via git history).
- **Rule it implies**: When a feature needs a map/threshold-shaped config value, prefer this JSON-via-string pattern over a proto or DB change before considering alternatives.

### 2026-08-05 — signal-source-registry — reuse
- **Pattern**: A full `/sdd-spec` re-run (not just `/sdd-review`) caught a CHECK-constraint/extractor omission that the first spec pass and its review both missed.
- **Evidence**: `docs/roadmap/features/008-signal-source-registry/context.md:51-61`.
- **Rule it implies**: For specs with large enumerated value sets (e.g. 10-value CHECK constraints), re-run `/sdd-spec` once against the current state before execute, don't trust the first pass's enumeration completeness.

### 2026-08-05 — trader-chart-panel — reuse
- **Pattern**: A spec was written against a library's documented (newer) API before the dependency was actually installed; the installed version resolved to an older major with a different API surface.
- **Evidence**: `docs/roadmap/features/014-trader-chart-panel/` implementation-spec.md L462, L672 — v5 `addSeries(CandlestickSeries,...)` spec'd, v4.2.3 `addCandlestickSeries()` shipped (pruned; recoverable via git history).
- **Rule it implies**: When a spec step adds a new npm dependency, defer exact API-call instructions until after that dependency is actually installed (or pin the version and verify its API before drafting code).

### 2026-08-05 — fix-grafana-otel-variables — design
- **Pattern**: DO App Platform global `envs` cannot reference component-scoped vars, so any attribute needing per-service identity (e.g. `service.name`) must be derived in service code, not composed via env-var interpolation.
- **Evidence**: `docs/roadmap/features/015-fix-grafana-otel-variables/context.md:17-27`.
- **Rule it implies**: Prefer runtime derivation over cross-referencing global/component env vars on DO App Platform.

### 2026-08-05 — fix-grafana-otel-variables — reuse
- **Pattern**: `@opentelemetry/resources@2.x` drops the `Resource` class; `semantic-conventions@1.41+` renames constants and some renames point at a *different* attribute key, not just a renamed constant.
- **Evidence**: `docs/roadmap/features/015-fix-grafana-otel-variables/` implementation-spec.md:607-610 (pruned; recoverable via git history).
- **Rule it implies**: When bumping `@opentelemetry/*`, diff the actual emitted attribute key, not just the constant name, especially for cross-language consistency.

### 2026-08-05 — config-ui-weight-validation — design
- **Pattern**: When a capability needs to generalize to future keys/entities with similar constraints, prefer declaring the rule in the shared contract (proto field) over a client-side heuristic — even though the heuristic is less work now, it doesn't compound for future additions.
- **Evidence**: `docs/roadmap/features/016-config-ui-weight-validation/context.md` Session 2026-06-01T00:01:00Z (Option A vs B resolution).
- **Rule it implies**: At design/review time, when an open question is "detect via heuristic vs. declare in contract," default to the contract declaration unless the heuristic is proven to be a one-off.

### 2026-08-05 — config-ui-weight-validation — ordering
- **Pattern**: A feature whose implementation step targets a service directory owned by an in-flight consolidation/rewrite feature (e.g. 045) should wait for that feature to merge before speccing file paths, not spec against the soon-to-be-deleted path and re-spec later.
- **Evidence**: `docs/roadmap/features/016-config-ui-weight-validation/context.md` Session 2026-06-01 (W3 decision) + Session 2026-06-04 (actual re-spec of Steps 5-6 from `xstockstrat-config-ui` to `xstockstrat-ui`).
- **Rule it implies**: At `/sdd-spec` time, check `merge-order.md` and in-flight feature statuses for the target service directory; if a consolidation feature is `draft`/`in-progress` and targets the same directory, flag it for re-spec-after-merge rather than speccing now.
### 2026-08-05 — unified-login-page — assumption
- **Pattern**: An implementation spec written before a prerequisite feature (045) fully landed assumed a structure that main-dev no longer matched by execution time, forcing a mid-execution re-spec.
- **Evidence**: `docs/roadmap/features/019-unified-login-page/context.md:76-80`.
- **Rule it implies**: When a feature's spec has a hard "must follow feature X being launched" dependency, re-verify the actual landed structure of X at execute-time (not just at spec-time) before trusting the spec's file list.

### 2026-08-05 — unified-login-page — reuse
- **Pattern**: Next.js auto-redirects a trailing-slash path (e.g. `/config-ui/` → `/config-ui`, 308) before custom middleware auth logic runs, breaking status/location assertions that assume the auth redirect fires first.
- **Evidence**: `docs/roadmap/features/019-unified-login-page/context.md:135-137`.
- **Rule it implies**: E2E assertions on middleware redirects must use the canonical (non-trailing-slash) path, or account for an intermediate 308.

### 2026-08-05 — crypto-exchange-integration — design
- **Pattern**: A proposed feature was demoted at the `idea` stage, before drafting a product-spec, purely by checking new-domain microstructure compatibility (session model, liquidity concentration, signal-integrity, regulatory regime) against existing architectural assumptions.
- **Evidence**: `docs/roadmap/features/027-crypto-exchange-integration/product-spec.md:20-44` (pruned; recoverable via git history).
- **Rule it implies**: For any proposal to add a new asset class/domain, run a microstructure-compatibility check against current session/liquidity/signal assumptions before writing a full product-spec — a fast idea-stage kill is cheaper than a spec-ready rejection.

### 2026-08-05 — mpt-portfolio-optimization — design
- **Pattern**: When a feature's core inputs require estimating a value that is structurally unknowable in advance (e.g. expected forward returns), reject the approach at idea stage rather than building it and discovering estimation instability empirically.
- **Evidence**: `docs/roadmap/features/028-mpt-portfolio-optimization/product-spec.md:21-25` (pruned; recoverable via git history).
- **Rule it implies**: Before designing an optimizer/model feature, name its required inputs explicitly and check whether a reliable estimator exists today — if not, demote or descope to a proxy that doesn't need it (risk parity, equal-weight+cap, etc.).

### 2026-08-05 — options-trading-support — design
- **Pattern**: A proposed feature was recognized at idea stage as belonging to a distinct platform domain (options data model, pricing, broker semantics) rather than an additive extension of the existing equity stack, and demoted before any spec/design investment.
- **Evidence**: `docs/roadmap/features/034-options-trading-support/product-spec.md:19-34`, `feature.md:14` (pruned; recoverable via git history).
- **Rule it implies**: When evaluating a new-capability idea, explicitly check whether it's an extension of the current domain model or a distinct domain requiring its own data model/pricing/broker semantics — recognizing adjacent-domain scope creep before speccing is cheap; discovering it mid-spec is not.

### 2026-08-05 — sec-filing-sentiment — design
- **Pattern**: A feature was demoted at the `idea` stage, before `/sdd-story` produced a full draft, based purely on a documented cost/benefit writeup in product-spec.md.
- **Evidence**: `docs/roadmap/features/035-sec-filing-sentiment/feature.md:12-14`, product-spec.md:19-34 (pruned; recoverable via git history).
- **Rule it implies**: For data-source ideas, write the "why not worth building" timing/signal-quality analysis before investing in design — a text-only demotion at idea stage is valid and cheap.

### 2026-08-05 — portfolio-rebalancing — design
- **Pattern**: An idea borrowed from a different portfolio paradigm (passive/static-target allocation) was checked against this system's actual model (signal-conviction sizing) before any spec/design investment, and rejected because the two paradigms produce opposite trade decisions on the same data (trim winners vs. follow conviction).
- **Evidence**: `docs/roadmap/features/036-portfolio-rebalancing/product-spec.md:20-24` (pruned; recoverable via git history).
- **Rule it implies**: Before speccing an idea imported from a different domain/paradigm (passive investing, other codebases, generic "best practice"), explicitly check whether this system's core allocation/decision model is compatible — a mechanism that's standard elsewhere can be actively harmful here.

### 2026-08-05 — upgrade-nextjs15 — reuse
- **Pattern**: Next.js 15's `PageProps` async-params TypeScript constraint applies to client components too; use `React.use(params)`, not `await`, there.
- **Evidence**: `docs/roadmap/features/041-upgrade-nextjs15/` implementation-spec.md Deviation Log Step 2; context.md Step 5 (config-ui) (pruned; recoverable via git history).
- **Rule it implies**: When migrating to Next 15 async props, grep ALL `params`/`searchParams` type usages including `'use client'` files, not just server components/route handlers.

### 2026-08-05 — upgrade-nextjs15 — design
- **Pattern**: Keep test-mocking exclusively in the E2E harness (`connectNodeAdapter + http2.createServer` for a real gRPC/H2C mock), never branch production client code for tests.
- **Evidence**: `docs/roadmap/features/041-upgrade-nextjs15/` implementation-spec.md Deviation Log Steps 3&6; `docs/patterns/nextjs-frontends.md` §4 (pruned; recoverable via git history).
- **Rule it implies**: Reject any PR step that adds `httpOverride`/test-only env branches to a production `connectClients.ts`.

### 2026-08-05 — align-frontend-e2e-bff-mocks — reuse
- **Pattern**: Frontend e2e mock updates were verified with static grep/import checks in one step, then the actual full-suite run in the next step caught a proto-field bug the static check missed.
- **Evidence**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/context.md:109-111` (Step 4 vs Step 5, `xstockstrat-insights`).
- **Rule it implies**: When adding/modifying a mock-backend handler for a frontend e2e suite, verification must include running the affected suite, not just confirming the import/registration exists.

### 2026-08-05 — align-frontend-e2e-bff-mocks — design
- **Pattern**: protobuf-es JSON codec serializes enums as string names and BigInt fields as strings, not numbers — test assertions and mock stub shapes written by spec-writing without checking generated proto types get this wrong.
- **Evidence**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/context.md:94,105`.
- **Rule it implies**: Before writing e2e assertions or mock RPC return shapes against connect-web/protobuf-es data, grep the actual generated `_pb` types rather than assuming field types.

### 2026-08-05 — strategy-engine — design
- **Pattern**: After a dependent feature (048) is built, the platform owner asked to retrofit an already-shipped, code-completed feature's auth gate to match — even post-launch.
- **Evidence**: `docs/roadmap/features/047-strategy-engine/context.md:272-286`.
- **Rule it implies**: When two features share a runtime component reused across a boundary (evaluator, auth gate), design review should ask whether the later feature's contract should retroactively replace the earlier one's, not just extend it.

### 2026-08-05 — strategy-engine — ordering
- **Pattern**: Services referenced a peer via `os.environ.get("X_ENDPOINT", ...)` in code without the var ever being added to `docker-compose.yml` or `.do/app*.yaml`.
- **Evidence**: `docs/roadmap/features/047-strategy-engine/context.md:74-78`.
- **Rule it implies**: Whenever a step adds/uses a new outbound `_ENDPOINT` var, grep all three deployment surfaces explicitly — don't infer wiring from code presence.
### 2026-08-05 — make-repo-public-secure — reuse
- **Pattern**: When adding a committable file matched by an earlier broad `.gitignore` pattern, a later wildcard ignore (e.g. `**/.env.*`) can re-shadow the negation; both root and `**/`-prefixed carve-outs are needed.
- **Evidence**: `docs/roadmap/features/004-make-repo-public-secure/` implementation-spec.md Deviation Log, Step 5 (pruned; recoverable via git history).
- **Rule it implies**: Verify new gitignore carve-outs with `git check-ignore -v`, not by inspection.

### 2026-08-05 — make-repo-public-secure — design
- **Pattern**: For a not-yet-live/public repo, prefer `${VAR:?err}`/explicit runtime error over a hardcoded fallback secret string, even when the spec asked for a fallback.
- **Evidence**: `docs/roadmap/features/004-make-repo-public-secure/` implementation-spec.md Deviation Log, Step 1 (pruned; recoverable via git history).
- **Rule it implies**: When hardening secrets pre-launch, default to fail-fast; only add graceful fallback once real users depend on the default path.

### 2026-08-05 — agent-mcp-server — design
- **Pattern**: A behavior threshold (alert conviction cutoff) went through 3 storage choices (hardcode → env var → config service) within one feature before landing on config service.
- **Evidence**: `docs/roadmap/features/009-agent-mcp-server/context.md:180-201`.
- **Rule it implies**: For any tunable business threshold, decide config-service-vs-env-var against the project's config-governance rule at design time, not during execute.

### 2026-08-05 — agent-mcp-server — ordering
- **Pattern**: An explicitly Out-of-Scope item (service-side secret enforcement) was pulled in-scope mid-execute "at operator request," adding permanent middleware to three unrelated services never named in the original feature boundary.
- **Evidence**: `docs/roadmap/features/009-agent-mcp-server/context.md:81-90`.
- **Rule it implies**: A mid-flight Out-of-Scope reversal that touches services outside the original Affected Services list should trigger a fresh `/sdd-review` of the widened scope, not just an implementation-spec patch.

### 2026-08-05 — remove-n8n-references — ordering
- **Pattern**: A "rename" story became a selective-deletion feature only after a per-endpoint caller audit forced by impl-spec review — most endpoints turned out to have zero real callers.
- **Evidence**: `docs/roadmap/features/011-remove-n8n-references/context.md` 2026-05-18T01:00:00Z.
- **Rule it implies**: Don't accept a "rename" framing for legacy-integration cleanup until every endpoint's actual caller set is verified.

### 2026-08-05 — remove-n8n-references — reuse
- **Pattern**: A legacy endpoint (`score-strategy`) was deleted rather than renamed because an identical Connect-RPC path already existed at the same shape.
- **Evidence**: `docs/roadmap/features/011-remove-n8n-references/context.md` 2026-05-18T01:00:00Z.
- **Rule it implies**: Check for an existing equivalent RPC before preserving a legacy shim during a rename/cleanup pass.

### 2026-08-05 — wire-fe-auth — reuse
- **Pattern**: `middleware.ts` and other Edge-runtime code must never import modules that pull in `@connectrpc/connect-node`; inline the needed constant instead.
- **Evidence**: `docs/roadmap/features/012-wire-fe-auth/` implementation-spec.md L803-811 (pruned; recoverable via git history).
- **Rule it implies**: Grep Edge-runtime entry points for transitive imports of Node-only gRPC transport packages before adding a new shared import.

### 2026-08-05 — wire-fe-auth — reuse
- **Pattern**: Extract gRPC request-scoped context (headers/trace IDs) before `asyncio.create_task`; never read it after the parent RPC has returned.
- **Evidence**: `docs/roadmap/features/012-wire-fe-auth/` implementation-spec.md L834-837 (pruned; recoverable via git history).
- **Rule it implies**: Any fire-and-forget async task spawned from an RPC handler must capture request-scoped context synchronously before the task is created, not read it lazily inside the task.

### 2026-08-05 — phase-2-data-layer — design
- **Pattern**: Combined multi-pass event processing (complete-fills then orphaned-partial-fills) assumed a broker-enforced invariant (no simultaneous long+short) instead of sorting by timestamp.
- **Evidence**: `docs/roadmap/features/013-phase-2-data-layer/context.md` 2026-05-20 "partially-filled-then-canceled" session; implementation-spec.md Step 5 test 7 note (pruned; recoverable via git history).
- **Rule it implies**: When pass-ordering substitutes for chronological correctness, explicitly document the domain invariant it relies on and flag it if provider-specific (e.g. IBKR Hedged mode).

### 2026-08-05 — agent-mcp-oauth — design
- **Pattern**: A dormant `implementation-ready` spec (never executed, carved out and deferred) can go stale against the current codebase and CLAUDE.md by the time it's picked back up.
- **Evidence**: `docs/roadmap/features/018-agent-mcp-oauth/feature.md:8-13`; context.md:44-52.
- **Rule it implies**: Re-verify a dormant `implementation-ready` spec's environment assumptions against current CLAUDE.md before executing, don't assume it's still accurate.

### 2026-08-05 — ml-price-prediction — design
- **Pattern**: A feature idea was demoted immediately at brainstorming, before an `/sdd-story` draft, once structural (not tooling) objections were identified — avoiding any spec/design/code investment.
- **Evidence**: `docs/roadmap/features/024-ml-price-prediction/feature.md:14`, product-spec.md:18-33 (pruned; recoverable via git history).
- **Rule it implies**: When an idea's core premise is structurally unsound (no fixable-by-engineering edge, unbounded ongoing operational cost, or unrecoverable auditability), write the rejection rationale directly and demote at idea stage rather than running it through spec-ready/design-approved first.

### 2026-08-05 — realtime-tick-streaming — design
- **Pattern**: An idea was demoted at the idea stage (before draft/design) by explicitly weighing "decision value to the strategy pipeline" against "engineering cost" — including vendor-side constraints (Alpaca feed rate limits) that would make the naive implementation operationally fragile — rather than defaulting to build because the underlying data was already available.
- **Evidence**: `docs/roadmap/features/025-realtime-tick-streaming/product-spec.md:18-39`, feature.md:31 (pruned; recoverable via git history).
- **Rule it implies**: For UI/latency-improvement proposals, first ask whether any human-facing action actually changes at the proposed latency, and whether the upstream vendor feed can even support the proposed fan-out; if not, and the platform's decisions are made by an automated pipeline (not human real-time execution), demote at idea stage rather than proceeding to design.

### 2026-08-05 — social-copy-trading — design
- **Pattern**: Ideas with dominant non-engineering blockers (regulatory classification as investment advice, a core architectural assumption like single-tenancy, or an inherent abuse/gaming surface requiring ongoing monitoring) were demoted at the `idea` stage without spending a draft/design cycle.
- **Evidence**: `docs/roadmap/features/026-social-copy-trading/feature.md:14`, product-spec.md:20-42 (pruned; recoverable via git history).
- **Rule it implies**: When a feature idea's primary blocker is legal/regulatory classification, contradicts a stated platform-wide architectural invariant (e.g. single-tenancy), or has a structural abuse surface needing dedicated ops infrastructure, route it to a demotion rationale before running `/sdd-design`, rather than spending Phase 0/1 effort.

### 2026-08-05 — multi-broker-smart-routing — design
- **Pattern**: Institutional-style optimizations (e.g. smart order routing) can be rejected at idea stage via a simple dollar-value cost/benefit estimate before any design work, when the existing single-provider path already delivers most of the benefit (e.g. IBKR SmartRouting) and the premise itself (comparable quotes across structurally different execution models) doesn't hold.
- **Evidence**: `docs/roadmap/features/037-multi-broker-smart-routing/product-spec.md:20-33` (pruned; recoverable via git history).
- **Rule it implies**: When a proposed feature imports an "institutional practice," first size the expected benefit at this platform's actual scale and verify the underlying comparison is valid before greenlighting design.

### 2026-08-05 — ci-docker-registry-deploy — ordering
- **Pattern**: A container-registry choice baked into design/spec hit an undocumented plan quota only during execution, forcing partial rollout then a full re-migration days later.
- **Evidence**: `docs/roadmap/features/038-ci-docker-registry-deploy/context.md` Step 3 (2026-05-26T00:09), 2026-05-29 GHCR migration.
- **Rule it implies**: Verify managed-service plan quotas against actual fleet size during `/sdd-design` recon, before `/sdd-spec` locks it in.

### 2026-08-05 — client-api-pattern — reuse
- **Pattern**: Use `Parameters<typeof client.method>[0]` for Connect-RPC mutation typing since protobuf-es v2 dropped `PartialMessage<T>`.
- **Evidence**: `docs/roadmap/features/044-client-api-pattern/` implementation-spec.md Steps 4-6 (pruned; recoverable via git history).
- **Rule it implies**: When protobuf-es major versions change generated helper types, grep for the removed type across the codebase before assuming an established pattern still compiles.

### 2026-08-05 — client-api-pattern — design
- **Pattern**: Verify a third-party API surface/version by grep or an install-check, not by familiarity with an older version.
- **Evidence**: `docs/roadmap/features/044-client-api-pattern/` implementation-spec.md Steps 6-7 (pruned; recoverable via git history).
- **Rule it implies**: Before writing code against a third-party library's API, confirm the installed version's actual exports/signatures rather than relying on remembered API shape.

### 2026-08-05 — ui-consolidation-nextjs — design
- **Pattern**: `/sdd-review impl-spec` caught a BFF handler-map/basePath-removal mismatch before any code was written.
- **Evidence**: `docs/roadmap/features/045-ui-consolidation-nextjs/context.md:91-94`.
- **Rule it implies**: When a feature removes a `basePath`/proxy that stripped a path prefix, re-verify every handler-map/route-key convention that assumed it during impl-spec review.

### 2026-08-05 — live-strategy-alert-engine — ordering
- **Pattern**: A feature branched from a not-yet-merged prerequisite should re-verify against the prerequisite's delivered code (including post-merge refactors) at multiple checkpoints, not just once at execute start.
- **Evidence**: `docs/roadmap/features/048-live-strategy-alert-engine/context.md:79-96` (evaluator path/servicer shape diverged), `context.md:209-214` (048 later re-merged 047's admin-gate refactor, reconciling an interim divergence).
- **Rule it implies**: Gate a dependent feature's execute loop with a targeted re-spec against the prerequisite's exact changed files, and re-check again if the prerequisite keeps evolving before the dependent feature ships.

### 2026-08-06 — unify-admin-auth-gates — design
- **Pattern**: cross-service auth-model unification (x-access-scope admin bit) rolled out service-by-service with documented exceptions rather than forced uniformity.
- **Evidence**: feature.md Session 2026-06-05; context.md sdd-spec session.
- **Rule it implies**: unify auth models incrementally per service; document deliberate exceptions instead of erasing genuine differences (e.g. ownership checks).

### 2026-08-06 — unify-admin-auth-gates — design
- **Pattern**: An older feature's design (018) silently assumed a removed architecture (nginx, HTTP port 80xx) after feature 045 removed it; re-grounding via recon caught it before build.
- **Evidence**: context.md 're-spec: merge 018' session, 2026-06-06.
- **Rule it implies**: Before resuming/absorbing a dormant spec, re-verify its architecture premises against current main-dev, especially post-removal features.

### 2026-08-06 — unify-admin-auth-gates — design
- **Pattern**: an edge-auth handoff was initially over-engineered around a (wrong) cross-origin assumption; confirming actual same-origin DO ingress enabled a simpler, non-forgeable session-cookie handoff.
- **Evidence**: context.md "resolve callback-handoff advisory" session.
- **Rule it implies**: verify real deployment topology (origin/routing) before designing cross-service trust handoffs.

### 2026-08-06 — strategy-creation-flow — reuse
- **Pattern**: When a BFF proxy (`*Bff.ts`) forwards gRPC errors to the browser, verify the real Connect/gRPC error message survives — not just a generic HTTP status — by writing an E2E test that triggers a real backend validation failure, not just a mocked one.
- **Evidence**: context.md:114-128 (dispatchConnect content-type leak found only via AC-13 test).
- **Rule it implies**: New BFF proxy methods should include at least one E2E case that asserts on the *message text* of a downstream validation error, not just the status code.

### 2026-08-06 — auth2-authorized-apps-ui — reuse
- **Pattern**: A Next.js server component/layout with no dynamic API calls gets statically prerendered at build time; reading a runtime-only env var (set at deploy, not build) there bakes in a stale/empty value.
- **Evidence**: context.md:278-287 (auth2-authorized-apps-ui post-merge fix, accounts/layout.tsx)
- **Rule it implies**: any server component reading a runtime-only env var must set `export const dynamic = 'force-dynamic'`; verify e2e doesn't set the same var at build time (which would mask the bug).

### 2026-08-06 — durable-observable-backfills — ordering
- **Pattern**: When stacking sequential features that share a proto message, use one integration PR per feature (not per-step stacked PRs) because proto source + generated stubs must commit together.
- **Evidence**: context.md session 2026-06-09.
- **Rule it implies**: For proto-touching stacked features, default PR granularity to per-feature, not per-step.

### 2026-08-06 — durable-observable-backfills — design
- **Pattern**: When a spec finds documented-but-inert config keys promising trust-critical behavior (retries/alerts), default to implementing them over removing them.
- **Evidence**: product-spec.md Problem Statement + Resolved Decisions.
- **Rule it implies**: Treat "docs promise X but code doesn't do X" as a correctness bug, not a docs cleanup.

### 2026-08-06 — durable-observable-backfills — design
- **Pattern**: Put a derived estimate (e.g. expected bar count) in the service that owns the source-of-truth computation, not the consumer.
- **Evidence**: product-spec.md Resolved Decisions "bars_total source".
- **Rule it implies**: Don't duplicate domain calculations (e.g. market calendars) across services for one field.

### 2026-08-06 — resumable-chunked-backfills — ordering
- **Pattern**: When a feature is intentionally branch-stacked on unmerged prerequisite features, proto field numbers/migration NNNs computed at `/sdd-spec` time go stale by execute time.
- **Evidence**: context.md:76-81 (chunks_total 11→13, fill_mode 5→6, ingest migration 003→004).
- **Rule it implies**: Stacked features must run an explicit re-spec/re-ground gate against the actual stacked base immediately before the execute step loop, not rely on the original `/sdd-spec` grounding.

### 2026-08-06 — orders-management-ui — ordering
- **Pattern**: In `/sdd-execute sequential` mode, when a step's isolated change breaks the build or exposes a spec-grounding gap (e.g., widening a shared repo function's signature, or discovering a proto field the spec assumed was already wired isn't), the resolved fix was to update the call site / wire the missing backend logic immediately in the same step rather than deferring — done three times here (Steps 4, 5-pagination, and 9, all user-approved "Option A") (context.md:135-136, 193-194; implementation-spec.md:413-417).
- **Evidence**: context.md:135-136, 193-194; implementation-spec.md:413-417.
- **Rule it implies**: When a sequential-mode step's local change breaks compilation or reveals an incomplete spec-grounding claim, fix it in-step and log it as a deviation rather than leaving the build red or shipping a UI no-op.

### 2026-08-06 — orders-management-ui — reuse
- **Pattern**: When a proto's `PageRequest` is token-based (no offset field) but a spec assumes offset/limit, implement `page_token` as an opaque numeric offset that mirrors an existing sibling service's established convention (`xstockstrat-portfolio`'s `ListPositions`) instead of inventing a new pagination scheme (implementation-spec.md:397).
- **Evidence**: implementation-spec.md:397 (Deviation Log, Step 5).
- **Rule it implies**: Before designing pagination for a new `ListX` RPC, check whether a sibling service already established a token convention on the same `PageRequest`/`PageResponse` shape, and reuse it rather than diverging.

### 2026-08-06 — open-positions-ui — design
- **Pattern**: A product-spec event/field name (`trade.filled`) that doesn't exist in the codebase survived one review layer and was only caught by an independent formal re-review.
- **Evidence**: context.md:47-51 (sdd-spec catch), context.md:80-84 (sdd-review re-catch)
- **Rule it implies**: When a spec cites an event/RPC/field name, grep-confirm the literal emitter string exists before treating it as ground truth, even after an earlier session already "verified" it.

### 2026-08-06 — backfill-management-ui — reuse
- **Pattern**: when service logic depends on concrete/un-mockable repo or config types, extract pure guard/builder functions before writing unit tests rather than deferring coverage to E2E.
- **Evidence**: implementation-spec.md:663-670 (Step 6 deviation, marketdata `resolveDeletePlan`/`buildDeleteBarsQuery`).
- **Rule it implies**: when unit tests can't reach new logic due to unmockable types, refactor for testability (user-approved) instead of shipping untested guards.

### 2026-08-06 — backfill-management-ui — reuse
- **Pattern**: for scoped destructive-delete RPCs, unit-test the SQL builder directly to assert the mandatory predicate is always present and always the first bound param.
- **Evidence**: implementation-spec.md:669 (`TestBuildDeleteBarsQuery`, 4 variants).
- **Rule it implies**: destructive delete code needs a "predicate always present" builder-level test as the actual safety net, not just service-level mocks.

### 2026-08-06 — formula-parameters — design
- **Pattern**: When adding a new semantic category of data to an existing "everything in one generic struct" contract, give it a wholly separate new field/namespace instead of overloading the existing one.
- **Evidence**: `input_params`/`params` kept separate from `input_data`/`data` by explicit user decision (context.md:37-54).
- **Rule it implies**: Don't conflate distinct data categories into a shared map/struct just because one already exists — the extra field is cheap; the ambiguity isn't.

### 2026-08-06 — formula-parameters — reuse
- **Pattern**: Repeated protobuf message fields can't be `json.dumps`'d for JSONB storage.
- **Evidence**: implementation-spec.md:619-623 (Step 7 Deviation Log).
- **Rule it implies**: When persisting proto message lists to JSONB, always `MessageToDict` on write / `json_format.ParseDict` on read — never pass proto objects to `json.dumps`.

### 2026-08-06 — watchlist-management — reuse
- **Pattern**: narrow `.proto` edits can still trigger `buf-gen` to rewrite unrelated WKT files (comment-only refresh).
- **Evidence**: implementation-spec.md Deviation Log Step 2.
- **Rule it implies**: commit incidental WKT diffs rather than reverting; `proto-freshness` CI expects them.

### 2026-08-06 — watchlist-management — ordering
- **Pattern**: pre-assign ascending migration numbers across an entire multi-feature initiative at design time when they share a migration dir/slot, record in merge-order.md.
- **Evidence**: context.md 2026-06-27 impl-spec review.
- **Rule it implies**: don't resolve migration-number collisions reactively per-PR when siblings are known upfront.

### 2026-08-06 — fundamentals-data-source — reuse
- **Pattern**: Config service's `WatchConfig` snapshot map is keyed by the raw `key` column value with no namespace prefix prepended — seed migrations must store the full dotted key the consuming service reads, not a namespace-relative fragment.
- **Evidence**: implementation-spec.md:449-458, context.md:73-77 (fundamentals-data-source Step 5 deviation).
- **Rule it implies**: Before writing a config seed migration, verify against `configServiceImpl.ts` how the snapshot key is constructed — never assume namespace+key are concatenated at read time.

### 2026-08-06 — fundamentals-data-source — reuse
- **Pattern**: Adding a new data-provider integration alongside an existing provider-specific interface (e.g. OHLCV `DataSourceClient`/Alpaca) works cleanly as a sibling interface + sibling package, held as its own service field rather than registered in the existing registry — keeps the existing provider path provably untouched.
- **Evidence**: product-spec.md FR-2; implementation-spec.md Step 6 (source.go:14-20 untouched, `internal/fmp/` new package).
- **Rule it implies**: When a new provider's shape differs from an existing interface, don't force-fit it — add a parallel interface and verify via `git diff` on the untouched files.

### 2026-08-06 — fundamentals-data-source — reuse
- **Pattern**: When a Go service needs unit tests to drive state held in an unexported concrete type (e.g. `*config.Watcher`'s snapshot), splitting the service's dependency on it into small local interfaces (fields typed as interfaces, not the concrete struct) gives the `_test` package a seam to inject fixtures without a live config stream or DB.
- **Evidence**: implementation-spec.md:460-465, context.md:88-90 (fundamentals-data-source Step 8, `fundamentalsConfig`/`fundamentalsRepo` interfaces).
- **Rule it implies**: Before wiring a new feature's logic directly to an existing unexported concrete dependency, check whether its test package can inject state; if not, introduce a small local interface seam rather than deferring the problem to integration-only testing.

### 2026-08-06 — screener-engine — design
- **Pattern**: When a new capability must never regress an existing critical path (backtest), extract the shared math into a pure module with byte-for-byte frozen-value tests *and* keep the full pre-existing suite green, rather than relying on a single before/after diff test that may not be runnable in the execute environment.
- **Evidence**: docs/roadmap/features/060-screener-engine/implementation-spec.md:519-527; context.md Session 2026-06-29 Step 6.
- **Rule it implies**: For an isolation-critical extraction, pair a frozen-value golden test on the extracted pure functions with "full existing suite passes unchanged" as the regression proof, not just one or the other.

### 2026-08-06 — screener-agent-tool — reuse
- **Pattern**: Agent tool count is asserted in 4 separate docs (agent CLAUDE.md, docs/runbooks/mcp-tools.md, docs/runbooks/CLAUDE.md index, tools.py docstring); they had already drifted independently before this feature touched any of them.
- **Evidence**: implementation-spec.md:300-304, context.md:54-56.
- **Rule it implies**: any feature adding/removing an agent tool must grep all four locations for stale counts, not just the file it's editing.

### 2026-08-06 — screener-agent-tool — design
- **Pattern**: A product-spec draft referenced a plausible-but-nonexistent helper (`_admin_metadata()`); sdd-review caught it against real code before implementation-ready.
- **Evidence**: context.md:27-28.
- **Rule it implies**: sdd-review's verification-against-code step is load-bearing for specs written before the implementer greps the target file — keep it mandatory even on `quick`/thin features.

### 2026-08-06 — fundamentals-signal-producer — reuse
- **Pattern**: synthetic/derived signal producers on a budget-capped external API must read only via the owning service's cache RPC and reserve part of the daily cap for interactive callers.
- **Evidence**: context.md:16-19.
- **Rule it implies**: enforce with a "no direct API import" test guard.

### 2026-08-06 — fundamentals-signal-producer — design
- **Pattern**: prefer a reusable generic CHECK/enum value (`derived`) over a single-purpose literal when future similar producers are foreseeable.
- **Evidence**: context.md:89-92.
- **Rule it implies**: extend CHECK allow-lists generically, not per-feature.

### 2026-08-06 — fundamentals-signal-producer — design
- **Pattern**: when a callee RPC lacks a uniqueness constraint, the idempotency guard belongs in the caller's own state table keyed on its natural key.
- **Evidence**: context.md:52-56.
- **Rule it implies**: Design the idempotency key/guard at the state-owning caller layer, not by relying on the callee's uniqueness constraints, when the callee RPC has none.

### 2026-08-06 — fundamentals-signal-producer — ordering
- **Pattern**: when two features touch overlapping domain, record the deliberate scope split in context.md at story time — it lives nowhere else.
- **Evidence**: context.md:12-15.
- **Rule it implies**: Document scope-split decisions between overlapping-domain features in context.md at story time, since no other artifact captures it.

### 2026-08-06 — fundamentals-signal-producer — design
- **Pattern**: when an enhancement is deferred specifically for a paid/higher API tier, record the tier-gating reason explicitly — it won't survive in shipped code.
- **Evidence**: product-spec.md:70,156-157.
- **Rule it implies**: When deferring an enhancement specifically for a paid/higher API tier, record the tier-gating rationale explicitly in the spec, since it won't survive in shipped code.

### 2026-08-06 — fundamentals-scoring-model — reuse
- **Pattern**: When an RPC-based resource-creation path (e.g. `RegisterFormula`) mints a random ID with no uniqueness constraint, and a feature needs that resource pre-populated at startup, add an idempotent startup seeding hook using a deterministic ID (UUIDv5 from a fixed namespace+name) plus a repo `upsert` (`ON CONFLICT ... DO UPDATE`) rather than calling the creation RPC/insert on every boot.
- **Evidence**: implementation-spec.md:59-63, 76-82; context.md:50-58.
- **Rule it implies**: Before seeding any resource at startup, grep for an existing uniqueness constraint/upsert path; if absent, build one rather than re-inserting on restart.

### 2026-08-06 — persist-strategy-scores — design
- **Pattern**: a best-effort write (FR-7-style) paired with a read path hitting the same store risks a false success ack on next read.
- **Evidence**: design.md:12-16, 85-87.
- **Rule it implies**: keep reads served from the in-memory/already-acked state (write-through), not the just-written durable store, unless the write is confirmed synchronous.

### 2026-08-06 — persist-strategy-scores — reuse
- **Pattern**: DOUBLE PRECISION columns silently accept NaN/Infinity; JSONB columns reject them and fail the write.
- **Evidence**: design.md:109-112; context.md:85-87.
- **Rule it implies**: scope `math.isfinite`-style guards to the JSONB-bound fields only, not scalar float columns — an asymmetric guard here is correct, not a bug.

### 2026-08-06 — persist-strategy-scores — reuse
- **Pattern**: an AsyncMock `fetchrow` whose return value simply echoes its input never exercises decode logic (e.g. `_to_dict`'s JSONB-string parsing), so decode bugs pass silently.
- **Evidence**: design.md:72-73, context.md:43.
- **Rule it implies**: any repo test mocking asyncpg over JSONB/serialized columns must assert the decode function against a literal serialized (string) row, never a mock-echoed dict.

### 2026-08-06 — trigger-backfill-mcp-tool — design
- **Pattern**: An explicit user "build X now" instruction can stand in as recorded P-04 sign-off for a quick-mode design gate when no contested tradeoff survives adversarial synthesis.
- **Evidence**: context.md:61-65 (066).
- **Rule it implies**: Record such standing approvals inline in context.md instead of re-prompting; only prompt when a real unresolved tradeoff remains.

### 2026-08-06 — trigger-backfill-mcp-tool — design
- **Pattern**: Phase 0 Recon undercounted required docs-discovery surfaces (found 4 of 5); the mandated Phase 1 adversarial round is what caught the missing one (`historical-backfill.md`), not recon itself.
- **Evidence**: design.md:72, context.md:53 (066).
- **Rule it implies**: Treat recon's discovery-surface list as provisional, not final — the adversarial round is a required backstop for doc-surface completeness, so don't skip or shortcut it even in quick mode.

### 2026-08-06 — trigger-backfill-mcp-tool — reuse
- **Pattern**: `MessageToDict` renders proto int64 fields as strings.
- **Evidence**: context.md:127-128 (066).
- **Rule it implies**: Assert string values for int64 fields in MessageToDict-based tests.

### 2026-08-06 — trigger-backfill-mcp-tool — design
- **Pattern**: When an adversarial design round rejects the low-effort version of a fix (partial refactor / fallback), it can still be recorded as a contingency to fall back to if execution hits trouble, rather than discarded outright.
- **Evidence**: design.md:86-88, context.md:116-121 (066).
- **Rule it implies**: If the full/harder approach ships cleanly, no separate action needed — but note in context.md when a contingency was available and unused, so the reasoning isn't lost once design.md is pruned.

### 2026-08-06 — fix-custom-formula-allnone — design
- **Pattern**: When a per-symbol/per-item loop gains a new failure path, any pre-existing aggregate status gate keyed only on the old failure signals must be widened, or an all-failed run silently reports OK and persists a spurious score.
- **Evidence**: implementation-spec.md:73-81 (feature-053 regression caught in design round 3).
- **Rule it implies**: when adding a new exception/skip branch to an aggregation loop, grep every downstream boolean gate derived from the old accumulators before declaring the change complete.

### 2026-08-06 — fix-custom-formula-allnone — reuse
- **Pattern**: Playwright's `webServer`-managed `next build && next start` can exceed sandbox wall-clock; pre-building with `pnpm build` + `pnpm start` + `reuseExistingServer` gets a real pass instead of a timeout.
- **Evidence**: implementation-spec.md D-3 (context.md:139-141).
- **Rule it implies**: for slow-sandbox e2e runs, pre-build+pre-start the server rather than trusting the in-band `webServer` block.

### 2026-08-06 — fix-custom-formula-allnone — design
- **Pattern**: Don't consolidate two superficially-similar helpers whose failure contracts differ (one truncates, one raises) just because they look duplicative — the divergence is the point, and merging adds hot-path blast radius.
- **Evidence**: design.md:140-142.
- **Rule it implies**: before proposing a DRY refactor of two similar-looking helpers, diff their failure/edge-case semantics, not just their shape.

### 2026-08-06 — backtest-results-visualization — design
- **Pattern**: For a historical/persisted-result read path, prefer DB-only reads over an existing in-memory cache built for a different purpose (unconditional writes for all statuses, key collisions, no eviction) — the cache's shortcuts become correctness bugs once repurposed as a read source.
- **Evidence**: design.md:50-54, 106-108 (analysis `self._backtests` dict rejected as `GetBacktest` source)
- **Rule it implies**: Before reusing an in-memory structure as a new read path, audit its write-time invariants against the new read contract.

### 2026-08-06 — strategy-reentry-cooldown — reuse
- **Pattern**: Before adding a workaround for a suspected protobuf "presence bug" (e.g. post-construction assignment to dodge `field=None`), verify current constructor semantics — Python protobuf already omits `None` kwargs for optional fields correctly.
- **Evidence**: design.md:154-155; context.md:325-329
- **Rule it implies**: verify the decoder/codegen contract before working around it (reinforces P-03).

### 2026-08-06 — strategy-reentry-cooldown — reuse
- **Pattern**: When host tooling lacks CI's exact binaries (golang-migrate, full Playwright build), a scoped fallback (throwaway `initdb` cluster; `tsc`+lint+manual dev-mode drive) still catches real bugs pre-merge if logged explicitly as a Deviation Log entry, not silently skipped.
- **Evidence**: context.md:252-257, 347-350 (D1/D2)
- **Rule it implies**: an unavailable CI tool requires a documented equivalent-fallback, never silent skip.

### 2026-08-06 — strategy-partial-update — design
- **Pattern**: When adding merge/patch semantics to an existing write RPC, audit every caller that constructs the request payload — a client that fabricates full defaults from `None`/empty Python values defeats a server-side partial-merge fix even after the server is correct.
- **Evidence**: `services/xstockstrat-agent/app/tools.py:338-344` (pre-fix); design.md §4; context.md session 2026-07-26 (steps 3-6)
- **Rule it implies**: a "fix the server merge" design must trace every payload-building caller for silent-default fabrication before declaring the bug fixed.

### 2026-08-06 — strategy-partial-update — reuse
- **Pattern**: `AsyncMock`-based repo fakes make `HasField()` on a mocked proto request return truthy by default, so a new proto-presence branch (e.g. FieldMask detection) silently takes the wrong path in every pre-existing test until the fake is replaced with a real proto.
- **Evidence**: context.md:170-171 (test_analysis_servicer.py `_update_req`)
- **Rule it implies**: when adding `HasField`/presence-gated branching to an RPC, replace `MagicMock`/`AsyncMock` request fakes with real proto instances in the same step, not after.

### 2026-08-06 — backtest-time-window — design
- **Pattern**: A debated design's own stated invariant can still contain an arithmetic bug; writing the edge-case test (k>0) before landing plumbing catches what a "looks right" read of the design misses.
- **Evidence**: context.md:173-200.
- **Rule it implies**: when a design's worked example has multiple claims that must jointly hold, test the edge case the design text glosses over before trusting plumbing.

### 2026-08-06 — backtest-result-attachment — reuse
- **Pattern**: use a fixed user-facing error string, not `str(e)`, when an exception repr could embed a large/sensitive payload.
- **Evidence**: context.md:461-465
- **Rule it implies**: When an exception's string representation could embed a large or sensitive payload, always return a fixed generic user-facing error string instead of `str(e)`.

### 2026-08-06 — mcp-config-management — design
- **Pattern**: a "verify, don't reimplement" FR forced code-tracing during review, surfacing two live prod defects unrelated to the reviewed feature.
- **Evidence**: context.md:117-141.
- **Rule it implies**: when a spec claims an existing mechanism "already does X," trace the actual code path.

### 2026-08-06 — mcp-config-management — design
- **Pattern**: gating by "request looks authorized" can be true on a transport meant to be denied; only code-path unreachability is safe.
- **Evidence**: design.md:40-49, context.md:298-303.
- **Rule it implies**: gate via unreachability, not runtime introspection.

### 2026-08-06 — fix-config-write-authz — design
- **Pattern**: cited "platform precedent" doc was backwards from the code it described.
- **Evidence**: `header-propagation.md:36-37` vs `servicer.py:207-220`.
- **Rule it implies**: verify cited cross-service precedent against code directly.

### 2026-08-06 — fix-config-value-roundtrip — reuse
- **Pattern**: When a bug stems from wire-format field-casing mismatches (camelCase ts-proto vs snake_case DB/proto-descriptor), a hand-built test request can accidentally use the "wrong" (but bug-compatible) shape and mask the defect; route such tests over a real gRPC connection to force genuine wire shape.
- **Evidence**: docs/roadmap/features/075-fix-config-value-roundtrip/context.md:33-36
- **Rule it implies**: For any bug involving field-name casing between wire and storage layers, write the regression test against a live client call, not a hand-constructed request object.

### 2026-08-06 — fix-mcp-formula-lifecycle — design
- **Pattern**: When a partial-update tool already uses a None-sentinel (omitted=unchanged) mechanism, don't add a separate `clear_fields` escape hatch for explicit erasure — every field's "clear" is already expressible via its falsy value ([]/""/0/false), and any field needing erasure protection is covered by the existing erasure guard regardless of how the clear was expressed.
- **Evidence**: docs/roadmap/features/086-fix-mcp-formula-lifecycle/context.md:47 (deviation from design.md:46).
- **Rule it implies**: extends the CF-N4 litmus — a "deliberate erasure" param is speculative scaffolding when the sentinel mechanism already covers it; drop it.

### 2026-08-06 — fix-mcp-additive-tools — ordering
- **Pattern**: When several SDD features are spawned from one triage/audit report, they commonly edit the same shared counter files (tool catalogs, doc tool-counts) in parallel; expect a small merge reconciliation rather than treating divergent counts as a defect.
- **Evidence**: context.md:31 (087 vs 086 catalog); insights.md 2026-08-02 entries for sibling features 086/091/092/093 from the same report.
- **Rule it implies**: when triaging a multi-finding report into several features, note shared-file touchpoints in each feature's context.md up front and check merge-order.md before opening the final PR.

### 2026-08-06 — fix-mcp-additive-tools — design
- **Pattern**: When a manual (non-standard) enum/int projection choice is made for model-readability reasons, its rationale and revisit trigger get lost the moment the design doc is deleted unless restated as a code comment or docstring caveat, not just an "Open Risk" bullet.
- **Evidence**: design.md:62-63 (enum name over int, "if a consumer needs the int, revisit"); docs/runbooks/mcp-tools.md:109-110 states the choice but not why.
- **Rule it implies**: when a design.md "Open Risk" documents a deliberate tradeoff with a future revisit condition, carry that condition into a code comment/docstring at the decision site, not only the design doc, so it survives archival.

### 2026-08-06 — fix-mcp-signal-source-verbs — design
- **Pattern**: when one RPC's blind-upsert is split into honest AIP-161 verbs (register/update/mask/reactivate), grep for sibling RPCs with the same shape (single "operation" string dispatch over one upsert) — feature-070's fix did not propagate to this RPC and sat as a live bug until a separate triage report caught it.
- **Evidence**: docs/roadmap/features/088-fix-mcp-signal-source-verbs/recon.md:75-76 (RC-2).
- **Rule it implies**: after any verb-split fix, search the repo for structurally identical RPCs and file them as follow-on bugs rather than assuming the pattern generalized.

### 2026-08-06 — fix-mcp-signal-source-verbs — design
- **Pattern**: the adversarial design round (not the product-spec) discovered that config-ui was itself reproducing the exact bug on the human-facing surface — a maskless caller invisible to the original triage.
- **Evidence**: context.md:28 (R2 finding), design.md §6.
- **Rule it implies**: when fixing a shared-mutation-RPC bug, explicitly enumerate *every* caller (UI, agent, internal producers) during design, not just the ones named in product-spec Affected Services.

### 2026-08-06 — fix-mcp-signal-source-verbs — design
- **Pattern**: converting upsert-style register to strict `ALREADY_EXISTS` breaks any internal "ensure registered on startup" caller unless it's taught to tolerate that specific code.
- **Evidence**: recon.md:68-72; design.md §4 (fundsignal_loop `_ensure_source_registered`).
- **Rule it implies**: before strictening any register verb, grep for internal callers with idempotent-registration retry/try-except patterns and add narrow (not blanket) exception handling for the new ALREADY_EXISTS contract.

### 2026-08-06 — fix-mcp-strategy-lifecycle — ordering
- **Pattern**: several concurrent features (086-089) all edited the agent's `client.py`/`tools.py`/`mcp-tools.md`/strat-lab skill; each required explicit merge-order awareness noted in context.md rather than discovery at merge time.
- **Evidence**: context.md:30
- **Rule it implies**: when a feature touches the MCP agent's shared client/tools/docs surface, check other in-flight features touching the same files and record merge-order in context.md during design, not at PR time.

### 2026-08-06 — fix-mcp-strategy-lifecycle — design
- **Pattern**: reactivation was shipped as its own enum verb (mirroring feature 088's `ManageSignalSource`) with an existence-check + atomic-catch pair for register, rather than an upsert.
- **Evidence**: design.md:11,66-67,70-71
- **Rule it implies**: for "bring back a soft-deleted/deactivated row" bugs, prefer an explicit reactivate verb + `ALREADY_EXISTS` existence-check-plus-unique-violation-catch pair over overloading the create/register verb.

### 2026-08-06 — fix-mcp-screener-correctness — reuse
- **Pattern**: when adding a threshold/filter over a model's output score, reuse the platform's existing normalization transform (`scoring.buy_threshold`) rather than comparing the raw score value.
- **Evidence**: design.md:23-30, context.md execute session.
- **Rule it implies**: any new score-based filter must locate and reuse the canonical score-transform helper, not assume raw score is comparable across contexts.

### 2026-08-06 — fix-mcp-config-key-registry — design
- **Pattern**: a TOCTOU existence-check-then-upsert race was left unlocked because `ON CONFLICT DO UPDATE` demotes the loser to a benign UPDATE.
- **Evidence**: design.md "Open Risks — Concurrency (accepted)"; `configServiceImpl.ts` (context.md 2026-08-02).
- **Rule it implies**: before locking a check-then-write race, verify whether the write's own conflict handling already makes the worst case harmless; document the accepted-risk reasoning since the code carries no trace of it.

### 2026-08-06 — fix-mcp-config-key-registry — design
- **Pattern**: when a fix narrows a proposed AC to only the write path, record *per-surface* rationale (boot safety vs. UX) even when both surfaces keep identical observable behavior (empty-return) — otherwise a later agent sees only uniform behavior and cannot tell it was chosen, not missed.
- **Evidence**: design.md:65-70 vs recon.md:74.
- **Rule it implies**: a design that narrows recon's recommended scope must state the rejected scope and its per-surface reason in context.md/design.md, not just the accepted scope.

### 2026-08-06 — fix-mcp-writepath-authz — reuse
- **Pattern**: Switching a Node test suite from lazy try/catch/strip-types execution to compile-first (`tsc && node --test dist/...`) can surface a real, previously-silent type error immediately upon switching.
- **Evidence**: context.md:131-132 (notify Step 3).
- **Rule it implies**: expect (and welcome) latent-bug failures when applying the 074 compile-first-harness fix elsewhere.

### 2026-08-06 — fix-mcp-extract-credentials — design
- **Pattern**: For a config/read call sitting **after** a commit or **outside** a narrow try-block (post-commit best-effort reads, registration side-reads), use broad `except Exception` rather than a narrow transport-only catch — a non-transport error there must not fail the already-completed primary operation.
- **Evidence**: design.md:39-43,86-87; implementation-spec.md:140-144,148-152; context.md:134-137 (O2)
- **Rule it implies**: when adding error handling to a best-effort/post-commit read, classify it explicitly as best-effort (broad catch + logged default) vs. must-surface (narrow catch + re-raise) — don't default to narrow.

### 2026-08-06 — opportunity-universe-unification — reuse
- **Pattern**: When Playwright e2e tests assert server-persisted mutation state against an in-process mock backend, use per-page `page.route()` isolation rather than a shared mock-server instance, because `fullyParallel` runs pollute shared state across specs.
- **Evidence**: `docs/roadmap/features/097-opportunity-universe-unification/context.md:305`.
- **Rule it implies**: stateful mock-backend fixtures backing parallel e2e specs must be request-scoped (per-page route handlers), not module-level singletons.

### 2026-08-06 — broker-failure-simulator — design
- **Pattern**: When a feature story originates from an external review (not internal backlog), run a lightweight feasibility re-check immediately after `/sdd-story` — reusing a prior feature's re-check method (context.md:19) — verifying prerequisite infra (CI service containers) and prerequisite production behavior (e.g., an automated code path the safety feature would protect) actually exist, before spending `/sdd-design` effort.
- **Evidence**: docs/roadmap/features/103-broker-failure-simulator/context.md:17-26 (and referenced 102 context.md)
- **Rule it implies**: For infra-heavy or safety-net test-tooling features sourced from external reviews, add a feasibility check-before-design step; demote early if a hard prerequisite (CI DB containers, an automated execution path) is absent.

### 2026-08-06 — trading-state-machine-invariants — design
- **Pattern**: A lightweight feasibility re-check right after `/sdd-story` (before investing in `/sdd-design`) caught a spec built on two facts the story text didn't verify: missing tooling in-stack and a nonexistent capability (autonomous order flow) to harden.
- **Evidence**: docs/roadmap/features/104-trading-state-machine-invariants/context.md:17-24
- **Rule it implies**: When a product spec originates from an external review/checklist rather than in-repo need, verify its premises against the current codebase (existing tooling, existing callers) before running `/sdd-design`, not during it.

### 2026-08-06 — market-data-freshness-and-quality-gate — design
- **Pattern**: When a feasibility check shows a proposed feature's valuable subset already fits an existing enforcement point, demote the standalone feature and record the fold-in as a recommendation in the *target* feature's context.md rather than losing the requirement.
- **Evidence**: docs/roadmap/features/106-market-data-freshness-and-quality-gate/context.md:26-29 (folded into 023-position-sizing-engine/context.md)
- **Rule it implies**: On demotion, always write the salvaged scope into the absorbing feature's context.md before archiving.

### 2026-08-06 — trading-safety-dashboard-slos — reuse
- **Pattern**: Before speccing a new `xstockstrat-ui` page for operator-facing metrics/SLOs, check whether the existing Grafana Cloud/OTel dashboard mechanism (`packages/otel/dashboards/`, feature 033) can host it as new panels instead — far cheaper than a new UI surface.
- **Evidence**: docs/roadmap/features/108-trading-safety-dashboard-slos/context.md session 2026-08-04T01:00:00Z
- **Rule it implies**: /sdd-design for any new ops-facing dashboard page must explicitly compare "new UI page" vs "extend existing Grafana/OTel dashboards" before choosing.

### 2026-08-06 — live-trading-game-day — design
- **Pattern**: A product spec adapted from an external best-practice/risk-review source (team-oriented ops cadence: on-call rotations, scheduled ceremonies) can be structurally unworkable for a solo-maintainer repo even when technically sound.
- **Evidence**: docs/roadmap/features/109-live-trading-game-day/context.md:17-22 — demoted within an hour of story creation once checked against `git log` author list / absence of `CODEOWNERS`.
- **Rule it implies**: When `/sdd-story` derives a spec from an external checklist/review, explicitly check the proposed operating cadence (rotations, multi-person ceremonies) against this repo's actual maintainer count before advancing past draft.

### 2026-08-06 — broker-state-reconciliation — design
- **Pattern**: This platform's authz headers (`x-user-id`/`x-access-scope`/`x-trace-id`) carry exactly one trust shape today — a value the external edge injects once after authenticating a real human, then internal services only ever *forward*, never *originate*. A design round proposed reusing `x-access-scope`'s bitmask for a background service to *self-assert* an elevated scope on its own outbound call (no inbound request to forward from) — this looks like a small, natural extension of an existing mechanism, but it's actually a different trust primitive: the check becomes "does this (namespace,key) tuple allow the bit," not "did a real authenticated actor grant this," and since the check has no caller-identity component, *any* code path in the calling service's binary — not just the intended automated caller — can construct the same header. The fix that survived adversarial review was a structurally separate channel (a distinct metadata field + a hardcoded `{caller, resource, allowed-target-values}` allow-list), explicit about trusting network position (the same trust anchor every other backend RPC on this platform already relies on) rather than silently piggybacking on the human-role bitmap.
- **Evidence**: `docs/roadmap/features/102-broker-state-reconciliation/design.md` § "Internal-caller authz for `platform.trading_state`" and § Rejected Alternatives ("Reusing `x-access-scope`'s user-role bitmap for a service self-assertion"); `docs/roadmap/features/102-broker-state-reconciliation/context.md` § Session 2026-08-06, round 2→3.
- **Rule it implies**: when a background/automated process needs to write somewhere normally gated to human operators, do not extend the human-role header — introduce a distinct, purpose-built channel with its own caller-identity check and (for anything safety-critical) a direction/value restriction, so the human-authz path and the service-self-assertion path stay separately auditable and separately revocable. Candidate design principle for a future Constitution pass on internal-caller authz patterns generally.

### 2026-08-06 — backfill-backtest-coverage — design
- **Pattern**: For an RPC that operates over multiple independent items in one call (e.g. a multi-symbol backtest), return a soft structured per-item status (`status` enum + per-item diagnostic messages) instead of a hard gRPC error when some items succeed and others don't — preserves partial results for callers instead of failing the whole call.
- **Evidence**: `docs/roadmap/features/053-backfill-backtest-coverage/product-spec.md` Resolved Decisions "Insufficient-data signaling" (pruned by this archival).
- **Rule it implies**: When a request fans out per-item internally, prefer a soft aggregate status + per-item detail over an all-or-nothing error.

### 2026-08-06 — backfill-backtest-coverage — reuse
- **Pattern**: Marking a proto field `[deprecated = true]` during a one-release deprecation cycle causes `golangci-lint`'s staticcheck (SA1019) to flag every remaining legitimate read of that field in the service that still must support it during the window. Suppress with a scoped `//nolint:staticcheck` + reason comment on the intentional reads rather than prematurely deleting the still-needed reader code.
- **Evidence**: `docs/roadmap/features/053-backfill-backtest-coverage/implementation-spec.md` Deviation Log, Steps 1/3–6 (pruned by this archival); pattern re-used implicitly by 080's readers-sweep (see 2026-07-29 — 080-fix-backfill-timeframe-enum — reuse, above).
- **Rule it implies**: Deprecation-cycle PRs that mark a field `deprecated = true` should proactively run the linter and expect/handle SA1019 on intentional in-window readers, not treat it as a surprise blocker.

### 2026-08-06 — backtest-debug-info — design
- **Pattern**: An "always-included, no opt-in" response-shape decision (vs. a request-gated flag) is not free — it forces a companion resource-bounding contract change (here, a global range cap applied to *every* caller of the RPC, not just the new feature's consumers) that must be scoped and reviewed as part of the same feature, not treated as independent.
- **Evidence**: `docs/roadmap/features/064-backtest-debug-info/product-spec.md` FR-4b (pruned by this archival) / `context.md` session "2026-07-08 — spec refinement" (OQ-2 resolution); `docs/patterns/config-governance.md:90`.
- **Rule it implies**: when a design makes a response field always-included rather than opt-in, explicitly re-check the RPC's existing size/latency contract for *all* callers, not just the new one.

### 2026-08-06 — fix-backfill-timeframe-enum — design
- **Pattern**: When adversarial design review discovers that a reported defect is one instance of a broader producer-family bug spanning multiple services, fix the whole family in one feature rather than splitting it by severity or type — this codebase's history already shows splitting a defect family leads to only part of it getting fixed.
- **Evidence**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/design.md` § Rejected Alternatives, last row ("Split into two features... this family has already demonstrated that failure mode four times"); `product-spec.md` § marketdata (both pruned by this archival).
- **Rule it implies**: at a design gate, when scope-widening is proposed for a defect family, treat "split it to ship the urgent part faster" as the higher-risk option by default in this codebase, not the safer one.

### 2026-08-06 — fix-backfill-timeframe-enum — design
- **Pattern**: An irreversible data-merging migration (e.g. collapsing duplicate-spelling rows like `'1Day'`/`'1d'`) should write its own remediation log table *before* the merge/delete runs, so `.down.sql` can be a faithful reverse instead of the no-op a merge would otherwise force, and so post-hoc audits of what was collapsed remain possible.
- **Evidence**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/context.md` § Decisions ("The FR-14 migration carries a remediation log..."); `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.{up,down}.sql`.
- **Rule it implies**: any migration that merges/deletes rows to resolve a duplicate-spelling collision should default to a remediation-log pattern, not a bare no-op `.down.sql`.

### 2026-08-06 — fix-backfill-timeframe-enum — design
- **Pattern**: A migration against a table with a live concurrent writer (e.g. a poller inserting rows every ~60s) needs its own idempotent re-check (e.g. `WHERE NOT EXISTS` inside the `UPDATE`) in addition to any pre-flight quiesce step — a delete-then-update migration that only diffs whole-table counts can have a canonical row committed *between* its delete and update branches, reintroducing the exact PK violation the migration exists to avoid. A quiesce alone depends on an operator remembering a manual step and doesn't close the race window.
- **Evidence**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/implementation-spec.md` § Step 5 Codebase Evidence "Concurrency precondition" (pruned by this archival); `context.md` round-1 review note W9.
- **Rule it implies**: any migration touching a table with a live writer must pair its pre-flight quiesce with an independent idempotent guard inside the write statement itself.

### 2026-08-06 — fix-backfill-timeframe-enum — reuse
- **Pattern**: In this repo's Playwright setup, `page.reload()` is unreliable for asserting a *specific* follow-up network request against a component with a multi-request mount cascade (races completed before/after the assertion's `waitForRequest` unpredictably). A deterministic UI interaction that triggers exactly the request under test (e.g. clicking a timeframe button) is the more reliable substitute, and still proves the same thing.
- **Evidence**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/context.md` § Session — Step 8; `services/xstockstrat-ui/e2e/trader/chart-panel.spec.ts`.
- **Rule it implies**: when an e2e assertion needs to observe a specific outbound request tied to a mount cascade, prefer a targeted interaction over `page.reload()`.

### 2026-08-06 — qa-capability — design
- **Pattern**: When splitting write authority between an advisory subagent and a write-capable skill (P-01), enforce the boundary with a runtime check against **live state** (e.g. any `feature.md` at `in-progress` + its current step's `**Files**`), not with prose policy alone — this is what makes the actor-authority rule falsifiable rather than aspirational.
- **Evidence**: `docs/roadmap/features/081-qa-capability/context.md:16-19` ("The interlock, not the prose, enforces P-01").
- **Rule it implies**: any future P-01-style read/write split should ship a boot-time or pre-write interlock keyed off live orchestration state, not just an `allowed-tools` declaration.

### 2026-08-06 — qa-capability — design
- **Pattern**: For a write-capable tool/skill whose job is authoring test files across many services, express the write boundary as a **file-pattern allowlist** (`**/*_test.go`, `**/*.test.ts`, `**/__tests__/**`, `**/tests/test_*.py`), not a directory denylist (`never edit src/, app/, internal/`) — a directory denylist blocks the core job wherever a language's test files live inside the runtime directory tree.
- **Evidence**: `docs/roadmap/features/081-qa-capability/context.md:30-31`; `product-spec.md:34-36` (pruned by this archival).
- **Rule it implies**: when scoping a write boundary for any tool that must write test code, enumerate the language's actual test-file locations first — don't assume tests live outside the source tree.

### 2026-08-06 — qa-capability — ordering
- **Pattern**: When a feature both deletes a referenced resource and repoints its references, do both in the **same commit**, not deletion-then-repoint across a sequence — an intermediate commit where the delete has landed but a reference hasn't yet is a red CI window for any validator that greps for the reference.
- **Evidence**: `docs/roadmap/features/081-qa-capability/context.md:169-170` (design.md:55, pruned by this archival).
- **Rule it implies**: when a step description says "delete X" and another step says "update references to X," collapse them into one step/commit.

### 2026-08-06 — ui-revamp-opportunities-first — ordering
- **Pattern**: When a user's explicit scope directive contradicts the design's own recommended slicing (e.g. "do it all in one feature, no phased migration"), that must trigger an immediate, in-place **product-spec governance refresh** (scope / proto-DB-config gates / Reviewers) and a re-run of `/sdd-review product-spec` *before* `/sdd-execute` — not just a note left in `design.md`. Otherwise the originally-marked-N/A gates (breaking-proto approval, config-key approval, DB-migration approval) stay silently inactive even though the work now requires them.
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md` 2026-07-31 sdd-design session ("DECISION — user scope override" + "Governance consequence").
- **Rule it implies**: extends **C-11** — a recorded user scope-override is not itself sufficient; the artifacts whose "no change" claims it invalidates must be refreshed and re-reviewed in the same design phase, before spec generation.

### 2026-08-06 — ui-revamp-opportunities-first — design
- **Pattern**: A "matches the handoff" fidelity sign-off based on content/screenshot comparison can miss layout overflow entirely — two independent overflow causes (an unwrapped raw `<table>`, and additive fixed-width header chrome) surfaced only once a scripted per-route `scrollWidth <= clientWidth` sweep at a phone viewport was added, after two separate rounds of "eyeballed" review had already signed off.
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md` "Screener mobile responsiveness fix" and "phone-frame overflow sweep (all screens)" sessions; `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`.
- **Rule it implies**: for any UI feature claiming visual/handoff fidelity, gate the claim with an automated per-route horizontal-overflow assertion at the target mobile viewport, not a screenshot/content diff alone.

### 2026-08-06 — ui-revamp-opportunities-first — reuse
- **Pattern**: at UI-polish stage, when a spec calls for a new near-duplicate primitive (e.g. a `CardError`), check whether an existing primitive + variant already covers it (`CardNotice variant="error"` + `QueryStateMessages`) before adding one — avoids tripping the DRY guard rail on cosmetic-stage work. Extract a shared formatter/component the moment a second screen needs the same presentation logic, not after a third repeats it.
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md` Steps 29-30 session and the "Handoff-fidelity pass — E: Portfolio (Book) rebuild" / "E screens 3-8" sessions.
- **Rule it implies**: reinforces the DRY guard rail — check for an existing primitive/variant match before adding a new one even at late-stage polish steps.

### 2026-08-06 — ui-revamp-opportunities-first — reuse
- **Pattern**: reusing a segment-scoped component (e.g. a trader-only form) inside a different segment's route requires checking whether that segment's layout provides every context provider the component silently depends on — it may not. The FR-6 order ticket reused the trader-only `OrderForm.tsx` on an `insights/market/[symbol]` route, but the insights layout only provides React Query, not `AccountContext`; the ticket had to explicitly wrap `AccountProvider`.
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md:391-400`, Step 26 session.
- **Rule it implies**: before reusing a component across segments, check the receiving segment's layout for every context provider the component depends on; wrap explicitly if missing, don't assume parity across segments.

### 2026-08-06 — screener-watchlist-fidelity — reuse
- **Pattern**: In a master-detail UI where create-then-select relies on an invalidate-and-refetch mutation, do not set the new selection directly in the mutation's `onSuccess` if a reconcile effect also runs on the refetched list (e.g. "reset selection to first item when the current selection isn't present"). The reconcile effect can win the race and clobber the just-created selection before the refetch lands. Defer the selection through a ref that only commits once the new id is observed in the refetched set.
- **Evidence**: `docs/roadmap/features/098-screener-watchlist-fidelity/implementation-spec.md:265-269` (Deviation Log, pruned by this archival); `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx` (`pendingSelectRef`).
- **Rule it implies**: for any "create → auto-select" flow built on invalidate+refetch mutations, defer the post-create selection assignment until the refetched collection actually contains the new id — never set it synchronously in `onSuccess` if a reconcile/default-selection effect also runs on that same collection.

### 2026-08-07 — exit-cooldown — design
- **Pattern**: An entry-side gate on an edge-triggered state machine (feature 069's re-entry cooldown: `if not in_position and latest.entry:`) is naturally reachable after a restart even when the restart-state default is wrong, because "not in position" is exactly the default. A gate on the *opposite* transition (this feature's exit-side cooldown: `elif in_position and latest.exit:`) is NOT — if the durable "am I in position" state defaults to `False` post-restart, the exit branch becomes permanently unreachable for a genuinely-open pair, silently disabling both the gate and the transition's alert. This asymmetry is invisible until a second gate is added on the transition the first one didn't cover; feature 069 never needed to solve it because its gate was on the "safe by default" side.
- **Evidence**: `docs/roadmap/features/116-exit-cooldown/design.md` § Chosen Approach ("Live loop — bar-replay for the common case"), rounds 1-2 of the design debate (`context.md` 2026-08-07 sdd-design session).
- **Rule it implies**: before adding a gate to the "unsafe by default" side of an edge-triggered restart-state machine (i.e. the branch that requires `in_position`/similar to be `True` to even run), verify the state it reads is actually durable across a restart — an entry-side precedent gating the opposite transition is not evidence the state is durable, only that its own gate didn't need it to be.

### 2026-08-07 — exit-cooldown — reuse
- **Pattern**: When a live-state-reconstruction problem needs to attribute an event to a strategy/owner, check which of the platform's own domain objects actually carries that attribution before designing a backfill — `portfolio.Position` (broker holdings) has no `strategy_id`, but `trading.Order` (the order that created the position) does, because attribution happens at order-placement time, not at position-valuation time. The same "can't attribute a position to a strategy" limitation the codebase already declined to fabricate for feature 083 (`services/xstockstrat-analysis/CLAUDE.md`'s Decide-surface RPCs, "held positions carry no portfolio strategy, so none is fabricated (P-03)") does NOT extend to orders — reaching one layer further back in the data model found real, non-fabricated attribution where the more obvious lookup (the position itself) had none.
- **Evidence**: `docs/roadmap/features/116-exit-cooldown/design.md` § Chosen Approach ("Live loop — boot-time backfill"); `packages/proto/portfolio/v1/portfolio.proto:43-73` (no `strategy_id`) vs. `packages/proto/trading/v1/trading.proto:47` (`Order.strategy_id`); rounds 2-3 of the design debate.
- **Rule it implies**: when P-03 blocks fabricating an attribution from one domain object, check the object one layer upstream/downstream in the data flow (the order that created a position, the signal that created an order, etc.) before accepting the gap — the attribution may exist there even when it's absent at the layer that seemed most direct.

### 2026-08-08 — screener-data-readiness-polling — reuse
- **Pattern**: for a "keep re-checking until it resolves, then merge into a live table" background-poll feature built on TanStack Query, two things paired well: (1) a scan-generation counter (`useState` int bumped on every fresh scan, passed into the poll `useQuery`'s `queryKey`) that orphans an in-flight poll from a superseded scan without any manual cancellation; (2) counting attempts off `dataUpdatedAt`/`errorUpdatedAt` timestamps rather than `data`/`error` object identity, since structural sharing collapses identical-valued retries — see the paired `fails.md` entry (same date) for why identity-keying breaks. Both are small, generic, and reusable by any future "keep polling a mutation-shaped RPC until some rows resolve" feature in this codebase.
- **Evidence**: `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts` (`useScreenSymbolsPoll`), `services/xstockstrat-ui/src/app/insights/screener/page.tsx` (`scanGeneration`, the poll-merge `useEffect`); `docs/roadmap/features/118-screener-data-readiness-polling/design.md` § Chosen Approach.
- **Rule it implies**: for the next "background recheck until resolved" feature on a TanStack-backed page, reach for this pair (generation-keyed `queryKey` + timestamp-keyed effect) directly rather than re-deriving it.

### 2026-08-08 — shadcn-ui-migration — reuse
- **Pattern**: `services/xstockstrat-ui`'s Vitest config (`vitest.config.ts`) never configured `resolve.alias` for the `@/*` path mapping `tsconfig.json` declares — harmless while every unit-testable file used relative imports, but the moment any file in a unit test's import graph switches to `@/...`-style imports (this feature: the shadcn CLI regenerates `src/components/ui/*` with alias imports, replacing the old relative ones), Vitest fails to resolve them even though Next's own bundler (which reads `tsconfig.json` `paths` automatically) is unaffected — the two build tools silently diverge on the exact same source tree. This broke not just the new test files but an unrelated pre-existing test (`copilot.test.ts`) whose import graph happened to touch `badge.tsx`.
- **Evidence**: `services/xstockstrat-ui/vitest.config.ts` (`resolve.alias`); `docs/roadmap/features/119-shadcn-ui-migration/implementation-spec.md` Step 8's Deviation Log.
- **Rule it implies**: any future change that shifts a file under `src/` from relative to `@/...`-alias imports (a codegen regeneration, a refactor, a new generated primitive) should re-run the full Vitest suite, not just the files the change directly touches — the failure surfaces on whichever *other* file's import graph happens to reach the changed one, not on the changed file itself. `vitest.config.ts`'s `resolve.alias` should mirror `tsconfig.json`'s `paths` exactly; verify they haven't drifted before assuming a Vitest resolution failure is a real code bug.

### 2026-08-08 — shadcn-migration-medium-confidence — reuse
- **Pattern**: When two DRY-consolidation targets (here: `AccountsModule.tsx`/`OrderFilters.tsx` filter toolbars) look identical at a glance but differ in real layout details (search box presence, active-filter-count badge, Clear-button placement), resist a `layout: 'modeA'|'modeB'` variant-enum shared component — it collapses into "two components behind a switch," not a real consolidation. Instead build the shared piece as a **slot-based** component that owns only the genuinely-identical inner controls, and let each call site keep owning its own surrounding chrome (Card/CardHeader/etc.), parameterizing only the one or two things that are truly a binary choice.
- **Evidence**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/design.md` § Chosen Approach point 4, § Rejected Alternatives (first bullet).
- **Rule it implies**: reinforces the DRY guard rail — check for an existing primitive/variant match before adding a new one, and prefer a slot-based shared component over a layout-mode-switch when two call sites' chrome genuinely differs.

### 2026-08-08 — shadcn-migration-low-confidence — reuse
- **Pattern**: A product spec named a specific shadcn primitive (`ui/form.tsx` with `Form`/`FormField`/`FormItem`/`FormControl`/`FormMessage`, wired to `useFormContext`) based on documentation current at story-writing time. By the time `/sdd-design` ran, live verification (fetching `https://ui.shadcn.com/docs/components/field` and the react-hook-form integration guide) found shadcn's actual current-recommended primitive had changed to a different, framework-agnostic `ui/field.tsx` family (`Field`/`FieldLabel`/`FieldDescription`/`FieldError`/`FieldGroup`/etc.), combined with `react-hook-form`'s own `Controller`/`useForm` directly rather than a `FormField`-wraps-`useFormContext` indirection layer.
- **Evidence**: `docs/roadmap/features/122-shadcn-migration-low-confidence/design.md` § Round 3, `recon.md` § Round 3 addendum (both citing live `WebFetch` verification, 2026-08-08).
- **Rule it implies**: for any feature naming a specific external library's primitive/component/API by name in its product spec, `/sdd-design` should live-verify that name against the library's current docs/registry before treating it as ground truth — a fast-moving ecosystem (shadcn's registry, in this case) can rename or replace its own recommended pattern between story-writing and design time, and a stale name silently baked into an implementation spec produces code against a primitive that no longer matches upstream guidance.

### 2026-08-08 — shadcn-migration-custom-composites — reuse
- **Pattern**: When a design decision (a shell-vs-restructure fork, here FR-10's Questionnaire shell decision) is later overridden by the user for only *part* of a component, nest the restructured part inside the unchanged outer step-count/heading framing rather than flattening the whole component to match the restructured part's new shape. Nesting keeps existing e2e text-based selectors (`getByText('Step N — ...')`, step-count assertions) valid without a rewrite, at the cost of only rewriting the fill/click *sequencing* inside the restructured part, not the assertions around it.
- **Evidence**: `docs/roadmap/features/123-shadcn-migration-custom-composites/design.md` § Round 3 (Step 1 restructured into 4 nested `Questionnaire.Item` sub-screens inside an unchanged outer "Step 1 — Identity" heading, while Steps 2-4 keep their existing step-number identity).
- **Rule it implies**: when a partial-scope override changes one part of an already-speced component's internal structure, check whether nesting the change inside the unchanged outer framing preserves more of the existing e2e contract than flattening does — the nesting choice is often the lower-e2e-risk option even when it's structurally less "clean."

### 2026-08-08 — shadcn-migration-custom-composites — reuse (candidate follow-up, not this feature's scope)
- **Pattern**: `useCandlestickChart.ts` hardcodes this app's dark-theme colors as literal hex values (`#22c55e`/`#ef4444`/`#94a3b8`/etc.) rather than reading the app's CSS custom properties, the same way `ui/chart.tsx`'s `ChartContainer`/`ChartConfig` composition does for the `recharts`-based charts. Swapping the hardcoded hex for the CSS variables would get `ChartPanel.tsx` (which stays on `lightweight-charts`, see the FR-5 sanctioned exception in `services/xstockstrat-ui/CLAUDE.md` § Styling) partial visual theming consistency with the rest of the app's charts, without a full chart-library migration.
- **Evidence**: `docs/roadmap/features/123-shadcn-migration-custom-composites/design.md` § Round 2 (FR-5 discussion) and Open Risks; `services/xstockstrat-ui/src/hooks/useCandlestickChart.ts`.
- **Rule it implies**: a candidate low-risk follow-up feature, not a rule to apply now — recorded here so it isn't lost, since it surfaced during design but is explicitly out of this feature's scope.

### 2026-08-09 — shadcn-migration-custom-composites — design
- **Pattern**: A design initially avoided bumping a shared dependency (`recharts` v2→v3) to control blast radius, hand-authoring a new primitive (`ui/chart.tsx`) against the older installed version instead of the shadcn registry's v3-targeted reference file. But this repo's CLI-vendored-primitive convention means that hand-authored file will eventually be silently overwritten by the newer version anyway on a future `apply --preset` re-run (`services/xstockstrat-ui/CLAUDE.md` § Styling) — the "safer, smaller" choice was actually deferring the same work to an unplanned future moment, not avoiding it. When put to the user directly, the tradeoff was surfaced explicitly and the user chose to bump early (closing the gap now, with a scoped recon of the two existing chart files' actual v3-breaking-change exposure) rather than carry it as latent tech debt.
- **Evidence**: `docs/roadmap/features/123-shadcn-migration-custom-composites/design.md` § Round 4 (FR-2's recharts v3 bump); the recon found only one real code fix needed across both existing `recharts` consumers (`CartesianGrid`'s new-required `xAxisId`/`yAxisId` props) — the two v3-specific bits the original hand-authoring plan meant to omit (`initialDimension`, `TooltipValueType`) turned out to be the smaller half of the real exposure, not the whole of it.
- **Rule it implies**: when a design avoids a dependency bump specifically because a CLI-vendored primitive would otherwise need hand-authoring against a newer version, check whether the repo's own re-apply convention (`apply --preset`) means that avoidance is temporary, not permanent — and surface that framing explicitly at the design-fork decision point rather than defaulting to "smaller diff now" without naming the deferred cost.

### 2026-08-09 — shadcn-table-actions-responsive — design
- **Pattern**: A design decision reached verbally between debate rounds (e.g. resolved directly in a
  proposer/adversary round's returned text, or agreed with the user in conversation) is not "settled"
  until it is written into `recon.md`/`context.md`/`design.md`. A later round's adversary subagent —
  or a future `/sdd-spec` session — only ever reads the durable artifacts, never this session's
  transcript. Concretely: Round 3 decided to replace `nav-reachability.spec.ts`'s shared-`Breadcrumb`
  assertion with an `aria-current`-based one (preserving the reachability guarantee for every route
  once the shared breadcrumb was removed), but that mechanism was only ever stated in the round's
  returned text, never written to `recon.md`. Round 4's adversary, reading only `recon.md`, correctly
  flagged the breadcrumb removal as an apparent regression for 15 routes — a false alarm caused
  entirely by the missing checkpoint, not a real design flaw.
- **Evidence**: `docs/roadmap/features/124-shadcn-table-actions-responsive/context.md` § Session
  2026-08-09T23:20:17Z; `recon.md`'s "ADDENDUM 2026-08-09 (Round 4 consolidation)" section, added
  specifically to close this gap before `design.md` was written.
- **Rule it implies**: this is the mid-debate analog of Constitution **P-05** (incremental
  checkpointing "as they happen") — the orchestrator must write each round's mechanism decisions into
  `recon.md`/`context.md` before spawning the next round's subagents, not just carry them forward in
  its own synthesis. A subagent's "regression" finding should first be checked against "was this
  decision actually written down anywhere it could read it?" before being treated as a real design gap.

### 2026-08-10 — shadcn-sidebar-visual-rewrite — design
- **Pattern**: An "ARIA-association" fix (`aria-labelledby` linking a container to its visible
  label) is not a producer-contract claim just because the reference is a syntactically valid,
  non-duplicate IDREF — check the *referencing* element's actual (often implicit) ARIA role first.
  `ui/sidebar.tsx`'s `SidebarGroup` renders a bare `<div>` with no explicit `role`, which resolves
  to the implicit role `generic` — an element excluded from accessible-name computation per
  WAI-ARIA, so `aria-labelledby` on it likely wouldn't reach assistive tech even though the id
  reference itself is perfectly valid HTML. The design round nearly shipped the "valid IDREF"
  check as if it proved the fix worked, until the adversary traced the actual role. The design was
  then simplified further, not just patched: since each interactive child (`SidebarMenuButton`)
  already computes a correct, distinct accessible name from its own visible text, the whole
  `aria-labelledby`/`role="group"` mechanism was dropped rather than fixed — a shared, identical
  accessible name across N sibling containers adds real implementation complexity (id-plumbing, an
  ordering invariant to maintain) for an accessibility improvement that, once actually exposed,
  tells a screen-reader user nothing beyond what they already hear from each interactive child.
- **Evidence**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/context.md` § Session
  2026-08-10T11:00:00Z (Round 3 adversary + orchestrator synthesis); `design.md` § Rejected
  Alternatives (third bullet).
- **Rule it implies**: before treating any `aria-*` wiring onto a shadcn/Radix-vendored primitive
  as "fixed," check the actual rendered element's role (explicit or implicit) — a `<div>`-based
  primitive (`SidebarGroup`, and likely siblings in the same vendored family) needs an explicit
  `role` before an `aria-labelledby`/`aria-describedby` reference onto it means anything to
  assistive tech. And before adding that `role`, ask whether the interactive descendants already
  provide the accessible name a screen-reader user needs — duplicating it at a wrapping-container
  level may be complexity without a real accessibility win. This generalizes the "demonstration is
  not a producer-contract claim" family already in `fails.md` (2026-07-27/29/08-05) to ARIA
  wiring specifically, not just runtime/API behavior.

### 2026-08-10 — shadcn-sidebar-visual-rewrite — reuse
- **Pattern**: a genuine, live-browser Playwright red-before-green cycle IS practical in the
  execute sandbox for `xstockstrat-ui`, even though the default `pnpm exec playwright test <file>`
  invocation is not — the difference is the `setup` project's `warmup.setup.ts`, which pre-fetches
  **21** routes serially (each up to ~90s to compile in dev mode on first hit). The fix: run with
  `--project=chromium --no-deps` (skips the `setup` project dependency entirely) and manually
  pre-warm only the specific route(s) the target spec actually visits via a plain `curl` carrying a
  hand-signed test JWT cookie (same secret/shape as `e2e/helpers/auth.ts`'s `signTestJwt` —
  `jose`'s `SignJWT`, `test-jwt-secret-for-e2e-tests-min32c`). Total cost: ~10-30s per route,
  one-time, then the actual test run completes in well under a minute.
- **Evidence**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/implementation-spec.md` §
  Deviation Log, Step 3 (Attempt 2); `context.md` Step 3 entry — achieved a real RED (3 failures,
  right reasons) then GREEN (9/9 passed in 18.2s) this way, after Attempt 1's full-suite run timed
  out.
- **Rule it implies**: a future `xstockstrat-ui` `test`-step's TDD gate should default to the
  scoped `--project=chromium --no-deps` + targeted-route-pre-warm technique rather than the default
  `playwright test <file>` invocation, whenever the spec under test touches only a handful of
  routes (most single-feature specs do) — reserve the `tsc`+`lint`+`--list` fallback (`fails.md`
  2026-08-10, corrected same-day) for when even the scoped, pre-warmed run still times out, not as
  the first resort.

### 2026-08-10 — unified-symbol-page — design
- **Pattern**: A page rendered under one segment (`/trader`) CAN safely reuse another segment's
  existing browser-client-and-hooks (bound to `/insights/api`) without a new BFF registration,
  verified — not assumed — against four independent facts: (1) the client's `baseUrl` is
  root-relative (`/insights/api`), so a browser `fetch()` from any page resolves same-origin, not
  cross-origin; (2) the DO App Platform ingress has exactly one catch-all rule routing both
  segments' `/api` paths to the same component (`.do/app.yaml`); (3) the session cookie is set with
  `path: '/'`, not segment-scoped (`auth.ts`); (4) the BFF's `requireSession` re-verifies the
  session on every dispatch regardless of which router handled it (`bffShared.ts`). Once all four
  hold, cross-segment reuse is strictly cheaper than dual-registering a one-line `forward()` wrapper
  in the second segment's BFF for every RPC the new page needs.
- **Evidence**: `docs/roadmap/features/125-unified-symbol-page/design.md` § Chosen Approach (BFF
  wiring); design.md round 3's adversary verification against `services/xstockstrat-ui/src/lib/
  bffShared.ts`, `src/lib/auth.ts`, `src/middleware.ts`, `.do/app.yaml`; round 5's adversary
  re-confirmed the same four facts independently before the debate closed.
- **Rule it implies**: before choosing between "dual-register in the new segment's BFF" and "reuse
  the other segment's browser client directly," check these four facts explicitly (root-relative
  baseUrl, single-origin ingress, unscoped session cookie, per-dispatch session re-check) rather than
  defaulting to dual-registration for consistency or assuming cross-segment calls are unsafe by
  default. When adopted, document the exception in the service's own `CLAUDE.md` (the "one client
  per segment" convention) in the same PR, so a future reader has the verified justification instead
  of an unexplained deviation.
