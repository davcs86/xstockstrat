# SDD Ledger — Fails

Cross-feature memory of **mistakes that recurred**: a wrong assumption, a duplication that slipped
through, a migration/config/header misstep, scope creep. The point is to stop the *same* mistake
from happening a third time — a recurring entry here is a candidate for promotion into a binding
Constitution rule (`docs/sdd/constitution.md`).

**Read** at the front of the pipeline — `/sdd-story` (boot), `/sdd-design` (recon grounds risks;
the grilling adversary cites past fails), `/sdd-spec` (governance read) — so a new feature avoids a
known trap.
**Written** by `/sdd-execute` at deviation-handling when a deviation reveals a mistake that has (or
could) recur. This is the durable arm of Constitution **P-03** (no silent deviation — a recurring
ambiguity is logged here).

## Rules

- **Append-only.** Add new entries at the bottom; never rewrite or delete an existing one.
- **One entry, one mistake.** Keep it scannable.
- **Cite evidence.** Point to the deviation, `path:line`, PR, or step.
- **Categories:** `assumption` · `duplication` · `migration` · `config` · `header` · `scope-creep`.

## Schema

```markdown
### <ISO date> — <feature-slug> — <category>
- **Mistake**: <what went wrong and how it recurred>
- **Evidence**: <path:line or PR/step/deviation ref>
- **Rule it implies**: <one line; if it should become binding, propose a Constitution ID>
```

---

<!-- Append entries below. Newest at the bottom. -->

### 2026-07-01 — 056-open-positions-ui — duplication
- **Mistake**: Two read paths surface a position's mark-to-market (portfolio `ListPositions` for the Positions table, `ListPortfolios` for the portfolio card). A later feature added the broker's authoritative valuation only to the `ListPortfolios` path (`buildAccountPortfolio` + migrations 005/006); `ListPositions` kept unconditionally recomputing from marketdata mid-quotes, so the Positions table silently disagreed with the broker. 056's own `context.md:59` even documented "Service `ListPositions` does not enrich" as accepted at the time — nobody owned bringing the second path to parity when valuation was added elsewhere.
- **Evidence**: `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` `ListPositions` (omitted the broker columns); `internal/service/portfolio_service.go` `ListPositions` vs `buildAccountPortfolio`; PR #735.
- **Rule it implies**: **C-10(b)** — a displayed value with an authoritative source must be surfaced by *every* RPC/read path that exposes it, with a parity test across paths.

### 2026-07-01 — 060-screener-engine — assumption
- **Mistake**: Features that add a UI page (058 watchlists, 060 screener) assumed shipping the route + BFF + backend was enough; neither spec mentioned the shared nav, so the pages existed but were unreachable from the sidebar (`PLATFORM_SUBNAV`). The nav is a horizontal surface owned by feature 045, and vertically-scoped feature specs never listed registering into it — and no test asserted nav reachability.
- **Evidence**: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` `PLATFORM_SUBNAV` (missing `screener`/`watchlists`); 058/060 specs contain no `PLATFORM_SUBNAV`/nav reference; PR #735.
- **Rule it implies**: **C-10(a)** — a new UI page/route must be registered in the shared nav with a nav-reachability test.

### 2026-07-01 — 063-fundamentals-scoring-model — assumption
- **Mistake**: The seeded `author="system"` fundamentals formula (depended on by feature 062 via `analysis.fundsignal.scoring_formula_id`) had no protection: `UpdateFormula`/`DeleteFormula` only checked author-match-or-admin, so any admin could edit/delete it and the UI showed full Save/Delete. The spec assumed ordinary author-ownership was sufficient for a shared seeded resource, and introduced the `"system"` sentinel ad hoc ("no system-author convention existed before this feature") without a governance entry.
- **Evidence**: `services/xstockstrat-indicators/app/handlers/servicer.py` `UpdateFormula`/`DeleteFormula`; `app/formulas/fundamentals_value_quality.py` (`AUTHOR = "system"`); 062/063 specs have no read-only/immutability requirement; PR #735.
- **Rule it implies**: **C-10(c)** — a seeded/shared resource another service depends on must be protected from mutation (RPC guard + read-only UI), and any new ownership sentinel recorded as a convention.

### 2026-07-21 — fix-custom-formula-allnone — assumption
- **Mistake**: Design round 3 initially scoped Option A (append `NO_TRADE_REASON_FORMULA_ERROR` to a `NoTradeReason` enum) as "analysis + proto only," treating the UI as a later `/sdd-spec` check. But the frontend maps the enum with an **exhaustive** `Record<NoTradeReason, string>` (`services/xstockstrat-ui/.../BacktestDiagnostics.tsx:18-25`), so regenerating the TS stub with the new value makes `tsc`/`pnpm build` **fail** until the map gains the key — the enum addition hard-couples to a UI edit in the *same* PR. Caught by the design-adversary before implementation, not in CI. Same "shipped the producer, forgot the shared consumer" shape as the 056/060 entries, specialized to proto-enum→TS-exhaustive-map.
- **Evidence**: `packages/proto/analysis/v1/analysis.proto` `NoTradeReason`; `services/xstockstrat-ui/.../BacktestDiagnostics.tsx:18-25` (exhaustive `Record`); feature 067 design.md § UI, context.md round-3.
- **Rule it implies**: **C-10(a/d)** — appending a proto enum value is not "backend-only": grep every exhaustive `Record<Enum, …>` / switch over that enum in TS/Go/Python consumers and update them (with a build/reachability test) in the same feature. Verify with a frontend build in the proto step's paired check.

### 2026-07-21 — fix-custom-formula-allnone — assumption
- **Mistake**: The design specified "normalize `NaN`/`Inf`→`None` and pass an all-`NaN` `len==n` series through as legitimate warm-up." But `google.protobuf.json_format.MessageToDict` (protobuf 6.33.x — the canonical decode used by BOTH `screener.py:261` and the new `evaluator.py` fix) **raises `ValueError` on a `NaN`/`Inf` number_value** ("Fail to serialize NaN for Value.number_value"), so a `NaN` in the response `Struct` can never round-trip; normalization can't run after it. Only surfaced when the paired unit test fed a `NaN` through a real `Struct` and the decode threw. The realistic, JSON-serializable warm-up representation is a `null` (Python `None`) element, which decodes cleanly.
- **Evidence**: `services/xstockstrat-analysis/app/services/evaluator.py` `_compute_component` (`try: MessageToDict(...) except ValueError → raise FormulaExecutionError`); tests `test_nan_output_raises` / `test_all_null_len_n_passes_through_as_warmup`; feature 067 implementation-spec.md Deviation D-1.
- **Rule it implies**: **P-03** — when a design says "decode a protobuf `Struct` and normalize non-finite values," verify the *decoder's* contract first: `MessageToDict`/`json_format` reject `NaN`/`Inf` outright. Model warm-up/absent values as `null`, and treat a genuinely non-finite series as out-of-contract (surface it, don't assume post-decode normalization can catch it).

### 2026-07-27 — 072-backtest-result-attachment — assumption
- **Mistake**: Recorded, in two places, that `BacktestResult.profit_factor` "is legitimately `inf` on
  no-loss runs" — and designed on it. It cannot be. The producer clamps:
  `(gross_profit / gross_loss) if gross_loss > 0 else (1.0 if gross_profit == 0 else 999.0)`, and the
  `<2`-equity-point path returns `1.0`. A green test has pinned `999.0` the whole time. Extending the
  check, **no `double` in `BacktestResult` is reachable as non-finite**. The belief entered via
  feature 068 and was inherited by 072 three rounds later, where it nearly shipped a false
  `"profit_factor": "Infinity"` contract onto `docs/runbooks/mcp-tools.md` — a shared consumer
  surface (the C-10 shape, in documentation form). The **true half survives**: `MessageToDict` really
  does map non-finite doubles to `'NaN'`/`'Infinity'` and int64 to a **string**, and that is still
  what rejected CSV as an attachment format — but the reachable instances are
  `CoverageGap.bars_have`/`bars_need` (`int64`, in the summary) and `volume` (in the attachment),
  never `profit_factor`.
- **Evidence**: `services/xstockstrat-analysis/app/handlers/servicer.py:2202-2208`, `:2176-2183`,
  `:321`, `:2187`, `:2195`; `services/xstockstrat-analysis/tests/test_analysis_helpers.py:77-82`;
  `packages/proto/analysis/v1/analysis.proto:55-56,73`. **Supersedes the producer claim in**
  `insights.md` 2026-07-21 (feature 068, "`profit_factor` is legitimately `inf` on no-loss runs") and
  the `profit_factor → 'Infinity'` example in `insights.md` 2026-07-27 (072 design). Those entries
  stay as written — the ledger is append-only — and their other content remains valid.
- **Rule it implies**: extends **P-03** — *a serializer-contract demonstration is not a
  producer-contract claim*. Executing `MessageToDict` on a hand-built proto proves what the
  serializer does with a value; it proves nothing about whether anything ever produces that value.
  Before writing "field X is legitimately Y" into cross-feature memory, grep the producer's
  assignment — the ledger is append-only, so a wrong entry is load-bearing forever.

### 2026-07-29 — 074-fix-config-write-authz — assumption
- **Mistake**: A test suite that reports `pass` while executing **zero assertions** was trusted as
  coverage. `xstockstrat-config`'s two unit files each wrap their import in
  `try { await import('../x.js') } catch {}` and then early-`return` from every case when the import
  failed — a *passing* skip. `pnpm test` printed "7 tests, 7 pass, 0 skipped" while asserting
  nothing. Three independent blockers all landed in that silent catch: a `.js` specifier for a `.ts`
  source (`ERR_MODULE_NOT_FOUND`), a TS **parameter property** (`constructor(private readonly pool)`)
  that `--experimental-strip-types` cannot compile (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), and
  extensionless relative imports once Node reparses the file as ESM. Run against compiled output the
  real state appeared: 1 of 2 cases **fails** (stale numeric-enum expectation vs `stringEnums=true`)
  and the other file **hangs** (its case constructs a live `ConfigWatcher` that dials and retries).
  Recurrence shape: same family as 2026-07-27 (072) — a demonstration was accepted as evidence
  without checking that the thing under test was ever actually reached.
- **Evidence**: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:15-22,36,66`;
  `configWatcher.test.ts:24-31`; `services/xstockstrat-config/src/grpc/configServiceImpl.ts:94`;
  `package.json:12-13`; verified by execution in feature 074's `/sdd-design` session (see that
  feature's `context.md` § VERIFIED DEFECT).
- **Rule it implies**: a graceful-skip guard must never be silent — assert the import succeeded, or
  let it throw. More generally: before citing a suite as coverage for a security-bearing change,
  confirm the cases *execute* (non-zero assertion count / deliberately break one and watch it go
  red), don't just confirm the runner exits 0. Candidate promotion: extend **C-08** so a paired test
  step must demonstrate a red before its green (**P-06**) *in the suite it will actually ship in*.

### 2026-07-29 — 079-remove-mcp-sse-transport — assumption
- **Mistake**: A **removal** feature's verification gates were written as substring greps ("no hit for
  `/sse`"), and three separate times the gate failed on *correct* output, because the vocabulary being
  removed legitimately survives in the prose that documents the removal. (1) AC-5 as first written
  demanded zero `/sse|/messages|MCP_SSE_PORT` outside a NOT-changed list — but the 404 branch must name
  the removed paths and the deprecated-env fallback must name the old var. (2) A proposed
  marker-token fix (pipe survivors through `grep -viE 'deprecat|removed|legacy|404'`) false-negatives
  on legitimate survivors carrying no marker word on their own line, and pressures the author to
  contort code to satisfy a grep. (3) At execute time, Step 5's `! grep -n "sse" claude_mcp_config.json`
  failed on the **operator migration note**, which must name `/sse` to tell an operator which saved
  connector URL to change. Each was caught only by *running* the gate.
- **Evidence**: feature 079 `product-spec.md` AC-5 (restated two tiers), `design.md` §4,
  `implementation-spec.md` Deviation D-2; the line a file-granularity allow-list would have exempted
  was `services/xstockstrat-agent/app/main.py:125-128`.
- **Rule it implies**: for a removal feature, gate on **symbols that cease to exist**
  (`build_sse_app|SseServerTransport|handle_post_message` → hard zero, no legitimate survivor
  possible) and on **structured fields** (no server block's `url` contains `/sse`), never on
  vocabulary that documentation must keep using. And run any grep-based acceptance gate against the
  intended post-change tree before adopting it — an unexecuted gate is a claim, not a check. Same
  family as the 2026-07-27 and 2026-07-29 entries, moved from test evidence to gate design.

### 2026-07-29 — 080-fix-backfill-timeframe-enum — assumption
- **Mistake**: A **false premise stated as settled fact in a product spec** steered three consecutive
  adversarial design rounds away from the feature's own central defect. The spec asserted "The write
  path already migrated correctly … Only the **read** path was left behind," citing the two producers
  that *were* correct. In fact `TriggerBackfill` persists `request.timeframe` **raw**
  (`servicer.py:153`) and `_canonical_timeframe` is not reached until `:284`, inside `_run_backfill`;
  since the UI sends `timeframeEnum` with no string (`backfills/page.tsx:112`), **every UI-created row
  already held `timeframe=''`**. The headline fix (derive the enum from that column) would therefore
  have returned `UNSPECIFIED` for the feature's own primary caller, and `_resume_job` was already
  mapping `''` → the `"1d"` default, so a UI-created 15m job silently re-fetched at daily. Rounds 1–3
  each re-derived scope *from* the false sentence and each found a different peripheral site instead.
  The originating evidence looked consistent with the false premise: the staging payload showed
  `timeframe: "1d"` because those were **agent**-created jobs (the agent sends both fields) — a
  UI-created job would have shown `""`. Recurrence: same family as 2026-07-27 (072) "asserting a claim
  without greping the producer", but escalated — here the unverified claim was *load-bearing for the
  design*, not merely decorative.
- **Evidence**: `services/xstockstrat-ingest/app/handlers/servicer.py:153,161,284`;
  `services/xstockstrat-ui/src/app/insights/backfills/page.tsx:112`; feature 080 `design.md` § Why this
  took four rounds; `context.md` § The decisive finding (round 3). Severity was raised SEV-3 → SEV-2 as
  a direct result.
- **Rule it implies**: extends **C-01**/**P-03** — a spec sentence that *narrows scope* ("only X is
  affected", "the other path is already correct", "already migrated") is a **claim about absence** and
  must be grep-verified at the gate exactly like a `path:line` citation. Absence claims are the ones a
  reviewer cannot spot-check by reading the cited line, because the evidence for them is everywhere the
  spec does not point. Practical test: for every "only" / "already correct" / "not affected" in a spec,
  name the grep that establishes it. And when a spec proposes to *derive* a value from stored state,
  verify the **writer** guarantees that state — deriving from a column nothing canonicalizes is how
  this defect existed in the first place.
