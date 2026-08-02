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

### 2026-08-02 — 086-fix-mcp-formula-lifecycle — design
- **Pattern**: To make a cross-service resource **safely deletable** without a reverse dependency edge, use **soft-delete + a surfaced `deleted` flag + run-time flagging at the existing consumer**, not a hard reference-checked delete that dials the consumer. Here indicators soft-deletes a formula (`deleted_at`, exposed as `FormulaDefinition.deleted`), keeps `get_by_id` deleted-agnostic so strategies already referencing it keep evaluating, and analysis — which already fetches each referenced formula via `GetFormula` at strategy-write (`_fetch_formula_outputs`) and at the backtest warmup prefetch (`_declared_formula_warmup`) — refuses *new* bindings to a deleted formula and appends a user-visible line to a new additive `BacktestResult.warnings` field. Zero new inter-service edges, zero new DB pool. The key move: a "soft delete" is only honest if the deleted state is **surfaced by every read path AND flagged in the run output** — otherwise it silently hides a hard-delete (the adversary's AC-dishonesty objection). Reuse the consumer's *existing* fetch site as the detection point rather than adding `deleted` to the hot-path RPC response (avoids a multi-call-site blast radius).
- **Evidence**: `docs/roadmap/features/086-fix-mcp-formula-lifecycle/design.md` §§ Chosen Approach 2/4, Rejected Alternatives; analysis `_fetch_formula_outputs` (`servicer.py:194-201`), `_declared_formula_warmup` (`servicer.py:1151`); root CLAUDE.md dep graph (analysis→indicators already exists, reverse edge would cycle — ledger 2026-07-31 083).
- **Rule it implies**: extends **C-10(b)** and **F-06** — for a deletable resource another service depends on, prefer soft-delete + surfaced flag + run-flag at the consumer's existing fetch site over a reverse referential-delete edge; and "soft delete" is not honest unless the deleted state is observable in reads and flagged in runs.
