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
