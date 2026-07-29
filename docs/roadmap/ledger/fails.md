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
