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

### 2026-08-09 — shadcn-migration-high-confidence — assumption
- **Mistake**: shadcn's `Breadcrumb`/`BreadcrumbPage` primitive collided with `getByRole`/`getByLabel`
  Playwright locators **twice** in the same feature, each time only caught by a *later* step's
  verification, not the wiring step's own targeted run: (1) the page-level `Breadcrumb`'s default
  `aria-label="breadcrumb"` (lowercase) case-insensitively substring-matched the shell's own
  `aria-label="Breadcrumb"` landmark under `getByLabel`, ambiguating `nav-reachability.spec.ts`
  (caught 2 steps later); (2) `BreadcrumbPage`'s built-in `role="link"` on the current-page crumb
  collided with a real, working nav `Link` of the same accessible name elsewhere on the same page,
  ambiguating an unrelated spec (`backfills.spec.ts`) under `getByRole('link', ...)` (only caught by
  the feature's full-suite closing gate, not any single step). Both are inherent to the primitive
  (not a caller mistake) — every future page that wires a `Breadcrumb` alongside an existing
  labeled/linked nav region risks the same collision, and a step's own narrowly-scoped `-g` e2e run
  will not reliably catch it.
- **Evidence**: feature 120 Deviation Log, Step 28 and Step 35 entries; `docs/roadmap/features/120-shadcn-migration-high-confidence/context.md` Steps 26/28/35.
- **Rule it implies**: when wiring `Breadcrumb` (or any primitive with a built-in implicit role/label
  on a "current"/"active" state — `BreadcrumbPage`'s `role="link"` is the concrete instance so far),
  grep the e2e suite for `getByRole`/`getByLabel` locators matching the same page's other visible
  labels/links *before* declaring the step's e2e risk "none," not just the FR-cited file's own specs
  — and run at least once against a broader `-g` scope (or the full suite) before marking such a step
  done, since the collision surfaces on a *different* spec than the one testing the changed component.
  Relevant to sibling features 121/122/123 (same primitive set, same shell).

### 2026-08-08 — shadcn-migration-medium/low/custom-composites (121/122/123) — assumption
- **Mistake**: Three `/sdd-design` sessions for sibling features were delegated to independently-spawned `general-purpose` subagents in parallel, on the assumption they would have the same tool access as a top-level orchestrator (`Task`/`AskUserQuestion`, per the SDD skill's own P-01/P-02/P-04 requirements). All three reported — correctly and prominently, not silently — that neither tool was available in their execution environment, so each self-ran both the proposer and adversary debate roles internally and self-decided every genuine architecture fork (121's Navigation Menu keep-vs-replace, 122's Form-library scope, 123's chart-library and Questionnaire shell-vs-restructure decisions) instead of running real adversarial debate + a live human gate. When the orchestrating session then surfaced all four forks to the actual user, 3 of 4 self-reasoned recommendations were overridden — confirming the self-run debates, while well-evidenced, converged on different answers than a real human gate produced.
- **Evidence**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/design.md` § Process Note; `docs/roadmap/features/122-shadcn-migration-low-confidence/design.md` header note; `docs/roadmap/features/123-shadcn-migration-custom-composites/design.md` header note — all three dated 2026-08-08.
- **Rule it implies**: a nested subagent (one spawned by another subagent, rather than by the top-level orchestrator) cannot assume it has `Task` (further subagent-spawning) or `AskUserQuestion` tool access even when its agent type nominally grants "all tools." Before delegating an entire `/sdd-design` (or any skill requiring P-04 human gating) to a parallel subagent, the orchestrator must either (a) keep the design phase's genuine architecture-fork decisions and final approval gate at its own level (only delegating recon/mechanical work to the subagent), or (b) explicitly verify the subagent's tool access first and treat any self-run gate as provisional, surfacing every fork to the real user before treating the subagent's output as final — never as a substitute for the live gate.

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


### 2026-07-29 — 081-qa-capability — assumption
- **Mistake**: A capability was asserted from **advertised metadata** rather than from the producer's
  behavior, and a feature was designed on top of it. The GitHub API reports `has_issues: true` for
  `davcs86/xstockstrat`, so Issues were reported as enabled and `/sdd-qa defect` was designed around
  `gh issue create`. The measured behavior is `POST /issues` → `410 Issues has been disabled` — a
  fact already recorded in six prior features and in `docs/CLAUDE.md`. The product spec's premise
  ("nothing owns defect filing") was also wrong: `docs/reports/` + evidence-direct `/sdd-triage` is
  the documented owner. Caught only by the `/sdd-design` adversary, which returned **BLOCKED** on an
  **F-04** breach; the first `recon.md` draft had compounded it by checking `command -v gh` and
  framing the gap as sandbox tooling. **Third recurrence of this family** — 2026-07-27 (072,
  serializer contract) and 2026-07-29 (074, a suite that never executed) are the prior two.
- **Evidence**: `docs/roadmap/features/067-fix-custom-formula-allnone/context.md:20`;
  `074-fix-config-write-authz/feature.md:7`; same in `075`–`078`; `docs/CLAUDE.md:15`.
  Resolution: FR-5 rewritten — `sdd-qa defect` writes `docs/reports/<ISO-date>-<slug>-defect.md`;
  `/sdd-triage` gained a `--from-report <path>` entry point, skipping T-1's `gh issue view`. Breach
  cleared by re-scoping to the path six prior features already used by hand, not waived — F-11 does
  not block. (081-qa-capability/context.md 2026-07-29 session, "sdd-design" block — design.md itself
  was pruned by /sdd-archiver on 2026-08-06.)
- **Rule it implies**: **exercise the producer, not its advertised state.** A capability flag,
  a config value, a docs claim, or an API's own metadata is a *claim*; the endpoint's response is
  the *contract*. Before designing on a capability, run it once — or cite a recorded run. Promotion
  candidate: this is the third instance of "a demonstration is not a producer contract" and is a
  strong candidate for a binding **P-\*** rule rather than a third ledger entry.

### 2026-07-29 — 081-qa-capability — assumption
- **Mistake**: Feature number allocated by scanning only the **local working tree**, which collided
  with a number already taken on unmerged branches. `/sdd-story` Step 3 computes `max(NNN)+1` from
  `find docs/roadmap/features -maxdepth 1 -type d`, so it saw `079` as the max and allocated `080` —
  while `080-fix-backfill-timeframe-enum` was already live on `claude/backlog-080-backfill-timeframe-enum`
  and `claude/triage-fix-080-8k1q4h`. The skill's own guard (`if [ -d ... ]`) only re-checks the local
  tree, so it cannot catch this. Caught by the user, not by the tooling. This is the documented cause
  of the historical `020`/`052` duplicates, and the skill will repeat it on every feature created
  while another is unmerged.
- **Evidence**: `.claude/skills/sdd-story/SKILL.md` Step 3; directory renamed
  `080-qa-capability` → `081-qa-capability`; collision recorded in
  `081-qa-capability/context.md` § Feature numbering.
- **Rule it implies**: the numbering scan must cover **all remote branches**, not the checkout —
  `for b in $(git ls-remote --heads origin ...); do git ls-tree --name-only "origin/$b" docs/roadmap/features/ ...`.
  More generally: any "next free identifier" computed from local state is wrong in a repo with
  concurrent branches; derive it from the union of every ref. Applies equally to migration `NNN`
  prefixes and proto field numbers.
### 2026-07-30 — 080-fix-backfill-timeframe-enum — assumption
- **Mistake**: The **absence-claim** trap recorded in the entry above recurred **twice more** inside the
  same feature, at the `/sdd-spec` and `/sdd-review impl-spec` gates — which is the evidence that one
  ledger entry did not fix it. (1) The impl spec justified leaving AC-8's sender half untested with
  *"`e2e/mock-backend.ts:306`'s `getBars(...)` handler takes no request argument, so no Playwright test
  can assert the new outbound field."* True of the handler **as written**, but the handler was that very
  step's own file to change, Connect handlers do receive the request, and `chart-panel.spec.ts:110-151`
  already drives the real component against the mock. An observation about the current state had been
  promoted to a constraint on the design, and it would have shipped the feature's own regression class
  untested on the only user-facing surface — `tsc` cannot catch a missing optional field on a
  protobuf-es message-init object. (2) Product-spec FR-10 asserted the `"15m"` literal *"currently
  appears three times in that function"*; it appears **once** (`marketdata_service.go:514`) — the other
  two hits are a comment (`:113`) and a different function (`:661`). A **count** claim is an absence
  claim in disguise ("and nowhere else"). Both were caught only because a later gate re-ran the greps.
- **Evidence**: feature 080 `implementation-spec.md` step 8 (the struck-through recon-Risk-11 claim and
  instructions 5b/5c), step 3's corrected `"15m"` justification; `context.md` § Session 2026-07-30 —
  sdd-review impl-spec (B3, and the corrected-claims table). Round-1 impl-spec review: 4 blockers, 12
  warnings.
- **Rule it implies**: promote the earlier entry's advice into a **mechanical gate**, because advice
  alone demonstrably did not hold. At every review gate, extract every sentence containing *only /
  already / never / no … can / cannot / appears N times / not affected*, and for each either (a) paste
  the command that establishes it, or (b) rewrite it as a statement about the present tree ("the handler
  does not take a request **today**") rather than a constraint on the design. Two specific tells worth
  their own reflex: a **count** ("three times") is an absence claim — run the grep; and *"no test can
  assert X"* is almost never true when the file in question is already in the step's own `**Files**`
  section — check that list before believing it.

### 2026-07-30 — 082-fix-fmp-config-boot-only — assumption
- **Mistake**: A harness-assigned session branch (`claude/082-design-implement-7638at`) and the
  feature's actual SDD `**Development Branch**` (`feature/fix-fmp-config-boot-only`, created earlier
  by `/sdd-triage`) silently diverged. All of `/sdd-review product-spec`, `/sdd-design`, `/sdd-spec`,
  and its own review round landed on the harness branch instead of the SDD dev branch, because that
  was the branch already checked out and the skills never re-verify `**Development Branch**` matches
  `git branch --show-current` before writing. `/sdd-execute`'s own Step B3 boot sequence caught it
  only when `git show origin/feature/fix-fmp-config-boot-only:.../implementation-spec.md` failed with
  "path exists on disk, but not in" that branch — the file simply didn't exist there. The two
  branches' feature-dir content was byte-identical at the fork point (main-dev had squash-merged the
  same triage commit under a different hash), which made the fix a clean non-destructive merge, but a
  less fortunate case (genuine divergent edits on both sides) would have forced a real conflict
  resolution mid-execution.
- **Evidence**: `docs/roadmap/features/082-fix-fmp-config-boot-only/context.md` § Session
  2026-07-30 (/sdd-execute sequential) — the branch-topology-fix note; the `git show` failure that
  surfaced it; PRs #820/#821.
- **Rule it implies**: extends **P-03** — a skill that writes to a feature directory should verify
  early (ideally at its own boot sequence) that the currently-checked-out branch and the feature's
  `**Development Branch**` are the same lineage, not just that both exist. `/sdd-design`'s and
  `/sdd-spec`'s boot sequences currently only read `feature.md`'s `**Lifecycle Status**`; they should
  also warn (not silently proceed) when `git branch --show-current` isn't `**Development Branch**`
  and isn't a normal ancestor/descendant of it — catching this at Phase-0 recon time instead of at
  `/sdd-execute`'s Step B3, several skill-invocations later.

### 2026-07-30 — 082-fix-fmp-config-boot-only — assumption
- **Mistake**: Sequential-mode's stacked-step-PR pattern assumes "GitHub auto-retargets a stacked PR
  to `<dev-branch>` once its base merges" (`reference/sequential-mode.md` §5.5/§5.6) — but GitHub only
  performs that auto-retarget when the **base branch is deleted** after merge. Step branches
  (`feature-steps/<slug>-step-N`) were never deleted post-merge in this run, so the retarget never
  fired: PR #821 (Step 2, base=`step-1`) squash-merged **into the `step-1` branch**, not into
  `feature/fix-fmp-config-boot-only`; PR #822 (Step 3, base=`step-2`) squash-merged **into the
  `step-2` branch**. Only PR #820 (Step 1, base=`<dev-branch>` from the start) ever reached the dev
  branch. All four PRs (#820/#821/#822/#823) reported "merged" via webhook, the feature was marked
  `code-completed`, and the integration PR (#823, `<dev-branch>`→`main-dev`) merged successfully —
  yet `main-dev` ended up with only Step 1's code, missing the paired regression tests (Step 2) and
  doc corrections (Step 3) entirely, undetected until `/promote`'s own state validation compared
  `main-dev`'s actual file content against the feature's tracking docs.
- **Evidence**: `docs/roadmap/features/082-fix-fmp-config-boot-only/context.md` § Session 2026-07-30
  (/promote — backfill missing steps); `git ls-remote` showing `feature-steps/…-step-1` and `-step-2`
  still present on origin post-merge, each carrying a squash commit for the *next* step instead of
  being deleted; PR #823's actual diff (9 files) vs. the expected ~13 (missing `main_test.go`,
  `marketdata_service_test.go`, `CLAUDE.md`, `docs/context-constitution.md`).
- **Rule it implies**: extends **P-03** — sequential mode's step-PR flow (§5.6) must not rely on an
  auto-retarget assumption it cannot verify. After each step PR is reported merged, verify the retarget
  actually happened — `git ls-remote --heads origin feature-steps/<slug>-step-<N>` should return
  **nothing** (branch deleted) before treating the next step's base as `<dev-branch>`; if the branch
  still exists, either delete it explicitly or re-point the next step PR's base via the API before
  merging it. More generally: before opening a **production promotion** PR, diff the feature's actual
  landed file content against what its own `implementation-spec.md`/`context.md` claim is done — a
  lifecycle status of `code-completed` is a claim, not a verified fact about what's on the trunk.
### 2026-08-02 — mcp-tools-alignment-triage — assumption
- **Mistake**: The agent's MCP surface (`tools.py` docstrings), its human runbook (`docs/runbooks/mcp-tools.md`), and the `strat-lab` skill are hand-written prose with almost no executable link to the code they describe, so they silently drift from `app/client.py` + the protos. A full manual audit (report `docs/reports/2026-08-01-mcp-tools-alignment-triage.md`, 13 confirmed findings) was needed to catch it — e.g. feature 070 made `manage_strategy update` a partial merge but the sibling `strat-lab` skill kept teaching the pre-070 full-replace footgun for a whole release cycle (F-12), and `emit_alert`'s documented `{"success": true}` return never matched the real `{"alert_id": …}` (F-12). Same root cause (RC-1) as the hand-written dict→proto request builders that silently drop new proto fields (`RegisterFormulaRequest.outputs/warmup_period` F-3, `EmitAlertRequest.context/tags` F-10).
- **Evidence**: report `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (RC-1 + meta-cause; F-2/F-3/F-4/F-9/F-10/F-12/F-13); `services/xstockstrat-agent/tests/test_tools_endpoint.py` (only two substring asserts guard the entire tool surface); the one tool that did NOT drift, `run_backtest`, is the descriptor-parity-tested one (`tests/test_backtest_view.py::test_summary_key_set_covers_every_proto_field`).
- **Rule it implies**: a hand-maintained projection or tool-doc that mirrors a proto/contract must be pinned by an executable parity/contract test (mirror `test_backtest_view.py`), and a same-PR rule change to a tool (e.g. feature 070) must update every surface that describes it (docstring + runbook + strat-lab skill) in that PR. Candidate binding rule — extend **C-10** (parity across all surfaces) to tool docs + request/response builders.

### 2026-08-05 — 023-position-sizing-engine — assumption
- **Mistake**: A design round proposed wiring `Opportunity.conviction` (`packages/proto/analysis/v1/analysis.proto:436-442`) as the source for a new "signal confidence" input — the field name matched, it was already fetched and rendered on the exact UI page the feature needed, and it was in the 0.0-1.0 range. All convenient. Its own proto comment says otherwise: "a deterministic ordinal (passing/total leaves + normalized worst-distance-to-threshold), **NOT a probability**." The semantically-correct field, `ExternalSignal.conviction` (`packages/proto/ingest/v1/ingest.proto:110`, "0.0–1.0 confidence"), was never surfaced in the UI at all and would have needed real new plumbing — so the convenient field got proposed first and only caught by a dedicated adversarial round that read both proto comments side by side. Fourth instance of the "demonstration/convenience is not a producer-contract claim" family (2026-07-27/072, 2026-07-29/074, 2026-07-29/081) — this time the trap is a field's *name and range matching* substituting for reading what its doc comment says it actually means.
- **Evidence**: `docs/roadmap/features/023-position-sizing-engine/design.md` § Rejected Alternatives ("Wire `Opportunity.conviction`... rejected after round 5's adversary found this to be a genuine semantic mismatch"); `docs/roadmap/features/023-position-sizing-engine/context.md` § Session 2026-08-05 — sdd-design, round 5.
- **Rule it implies**: extends **C-01**/**P-03** — when wiring a value across a semantic boundary (a UI-visible field into a risk/sizing input), read the *candidate* field's own doc comment for what it claims to represent, not just its name, range, and convenient availability. A field that is already fetched, already rendered, and numerically in-range is exactly the shape a wrong-but-plausible substitution takes — the doc comment is the fastest disqualifying check and should run before proposing the wiring, not after.

### 2026-08-07 — fix-config-ui-env — assumption
- **Mistake**: Design round 1 proposed gating a cross-environment config-write bug by hiding the
  triggering `<Link>` in the discoverable UI (`EnvModeSwitcher`), leaving the actual mutation path
  (`[namespace]/page.tsx`'s `SetConfig` call) completely unguarded and reachable via direct URL,
  bookmark, or a stale open tab — a second recurrence of the 2026-07-01 (063) pattern this ledger
  already promoted to **C-10(c)** ("a resource that must not be mutated needs an RPC/write-path
  guard, not just a read-only UI"), caught only by round-1's adversary re-reading the product spec's
  own Consumer Surface section, which explicitly named the write-path file the proposal had excluded.
  A follow-on round then proposed the correct guard's comparison as an unconditional exact-match
  reject of the proto zero-value (`Environment.UNSPECIFIED`) — plausible in isolation, but wrong: the
  backend's own `resolveEnv`/`ENV_MAP` already treats `UNSPECIFIED` as equivalent to `DEV` (a
  documented platform convention, PROTO-3), so a raw exact-match guard would have silently rejected a
  legitimate write on a dev-native deployment. Caught only because round 3's adversary re-read the
  backend's actual resolution code instead of reasoning about the enum in the abstract.
- **Evidence**: `docs/roadmap/features/115-fix-config-ui-env/design.md` § Rejected Alternatives
  (switcher-only fix; unconditional `UNSPECIFIED` rejection); `context.md` § sdd-design session
  (round 1 and round 3 findings); `services/xstockstrat-config/src/grpc/configServiceImpl.ts:22,87-92`
  (`ENV_MAP`/`resolveEnv`).
- **Rule it implies**: reinforces **C-10(c)** with a second real instance — when a design proposes
  gating a mutation via UI presentation alone, check whether the product spec's own Consumer Surface
  or Reproduction Steps name the actual write call site, and route the guard there first. Extends
  **P-03** to enum sentinels specifically: before writing a guard's comparison against a proto
  zero-value (`*_UNSPECIFIED = 0`), grep the value's *existing* resolution/consumption code (a
  `resolveX`/`*_MAP` function) rather than assuming "unset" should mean "reject" — a zero-value's
  platform-wide meaning is a producer contract, not a guess.

### 2026-08-06 — 100-account-trading-halt-and-kill-switch — config
- **Mistake**: A design round 1 proposal widened the existing `platform.maintenance_mode` config key's `value_type` in place (bool → string) to carry a richer `ACTIVE`/`REDUCE_ONLY`/`HALTED` enum, reasoning it avoided a parallel key and reused the already-enforced gate. Direct code verification of `config.Watcher`'s typed getters found this to be a confirmed fail-open bug, not a hypothetical one: a `GetBool` call against a `ConfigValue` whose oneof is now populated as `string_val` (not `bool_val`) hits the proto3 oneof's documented zero-value-on-mismatch semantics and silently returns `false` — during any rollout window where old (bool-reading) and new (string-writing) code coexist, the kill switch itself goes dark exactly when a halt is in effect. Caught only because the adversary read the getter's implementation, not just its call site.
- **Evidence**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/design.md` § Rejected Alternatives ("widen `platform.maintenance_mode` in place — rejected, round 1: confirmed fail-open via `Watcher.GetBool` oneof zero-value semantics"); `docs/roadmap/features/100-account-trading-halt-and-kill-switch/context.md` § Session 2026-08-06 — sdd-design, round 1.
- **Rule it implies**: extends **C-10(b)**/**F-11** — never change an existing config key's `value_type` in place. Every reader of that key (across every service, including ones not being touched by the current feature) is typed to the *old* shape, and a proto3 oneof mismatch fails to a silent zero-value, not an error — this is especially dangerous for a bool-typed safety gate, where the zero-value silently disables protection instead of failing loud. Add a parallel key instead and migrate readers deliberately, or add an explicit value-type-version marker if in-place widening is ever truly required. Candidate binding rule for a future Constitution pass: config key `value_type` is immutable once any service reads it.

### 2026-08-05 — add-ikbr-account-support — assumption
- **Mistake**: A documented "follow-up" gap (missing `user_id` in the `account.positions.synced` payload, noted at spec time) was left unfixed and surfaced weeks later as a production bug ("positions out of sync") requiring a dedicated fix session.
- **Evidence**: `docs/roadmap/features/001-add-ikbr-account-support/context.md:145` (original note) and `:402-413` (2026-06-09 fix session).
- **Rule it implies**: A "trivial follow-up" touching a payload consumed by user-facing reconciliation should be fixed before launch, not deferred, since silent placeholder values (`user_id="default"`) fail invisibly.

### 2026-08-05 — add-ikbr-account-support — scope-creep
- **Mistake**: `ListPortfolios` cross-account aggregation was cut mid-implementation ("outside Step 17 scope") without updating or flagging the acceptance criterion (FR-27/AC7) it violated; the shipped code looks correct in isolation but silently fails the documented spec.
- **Evidence**: `docs/roadmap/features/001-add-ikbr-account-support/context.md:384`; implementation-spec.md:1298-1300 Deviation Log (pruned; recoverable via git history).
- **Rule it implies**: When an implementation step narrows scope from what an FR/AC promises, either update the AC or block launch — don't let it ship as an undocumented gap.

### 2026-08-05 — broker-accounts-ui — assumption
- **Mistake**: `implementation-spec.md` prescribed forwarding `trading_mode` into a portfolio API call whose backing proto request had no such field, discovered only during execution.
- **Evidence**: `docs/roadmap/features/002-broker-accounts-ui/` implementation-spec.md L888-891 (pruned; recoverable via git history), `portfolio.proto:109`.
- **Rule it implies**: `/sdd-spec` should grep the actual proto message fields before prescribing request parameters, not just reuse a sibling endpoint's query-string shape.

### 2026-08-05 — formula-management-ui — assumption
- **Mistake**: FR-13/OQ-1 assumed an HTTP-header identity mechanism and HTTP transport, both superseded by concurrent platform-wide migrations (044 client-api-pattern, gRPC-only) before this feature executed.
- **Evidence**: `docs/roadmap/features/003-formula-management-ui/context.md` session 2026-06-01 ("FR-13 corrected").
- **Rule it implies**: When a feature spans multiple sessions/streams, re-verify its spec's transport/infra assumptions against any concurrent platform-wide migration before executing, not just at spec-write time.

### 2026-08-05 — frontend-reverse-proxy — assumption
- **Mistake**: The implementation spec assumed Docker was available for `nginx -t`/`docker build`/`docker compose` verification; the execute sandbox had none, so 3 of 6 steps shipped with only structural (non-runtime) checks.
- **Evidence**: `docs/roadmap/features/005-frontend-reverse-proxy/` implementation-spec.md Deviation Log Steps 1, 2, 6; context.md sessions 2026-05-11 and 2026-05-12 (pruned; recoverable via git history).
- **Rule it implies**: Infra-feature implementation specs must include a non-Docker structural fallback check, not rely solely on Docker-dependent verification commands the execute sandbox may lack.

### 2026-08-05 — frontend-reverse-proxy — assumption
- **Mistake**: A small, unrelated `basePath` change on config-ui was the first build attempt in a while, and it exposed dormant breakage (missing dep, removed library export) that had nothing to do with this feature.
- **Evidence**: `docs/roadmap/features/005-frontend-reverse-proxy/context.md` session 2026-05-12 (late); implementation-spec.md Deviation Log Step 5 (pruned; recoverable via git history).
- **Rule it implies**: Budget for a service's first build-in-a-while to surface unrelated dormant breakage; treat the fix as legitimate in-scope unblocking, not scope creep to reject.

### 2026-08-05 — do-nginx-integration — assumption
- **Mistake**: The implementation spec for a feature depending on another in-flight feature's branch (005) trusted that sibling feature's *spec text* as ground truth for what was actually committed, instead of re-checking the real file.
- **Evidence**: `docs/roadmap/features/006-do-nginx-integration/` implementation-spec.md:373-376 ("Feature 005 committed a minimal Dockerfile with CMD (not ENTRYPOINT)... Without these changes the entrypoint script would exist but never be invoked"); context.md Session 2026-05-18 00:02 (pruned; recoverable via git history).
- **Rule it implies**: When Step N depends on artifacts from a sibling in-progress feature, re-grep the actual current file at execute time, not just cite the sibling's implementation-spec.

### 2026-08-05 — do-nginx-integration — config
- **Mistake**: Unscoped `envsubst` in an nginx entrypoint substitutes nginx's own `$host`/`$remote_addr`/`$scheme` runtime variables to empty strings, breaking the config at startup.
- **Evidence**: `docs/roadmap/features/006-do-nginx-integration/` implementation-spec.md:378-381 (pruned; recoverable via git history).
- **Rule it implies**: Any `envsubst`-templated nginx (or similar) config must pass an explicit variable-name allowlist, never bare `envsubst`.

### 2026-08-05 — signal-source-weighting — duplication
- **Mistake**: Generated proto stubs required `grpcio>=1.80.0` while `uv.lock` across three Python services (analysis, indicators, ingest) was still pinned to `1.78.0`, only surfacing as a hard `RuntimeError` when a test suite happened to import the stubs — not caught by CI or codegen freshness checks.
- **Evidence**: `docs/roadmap/features/007-signal-source-weighting/` implementation-spec.md Deviation Log (Step 4, lines 385-397); context.md 2026-05-24 session (pruned; recoverable via git history).
- **Rule it implies**: When bumping/regenerating proto plugins or stubs, cross-check the minimum grpcio version they require against every Python service's `uv.lock`, not just the service being touched.

### 2026-08-05 — signal-source-registry — assumption
- **Mistake**: Mediated source types were dropped from the migration CHECK constraint, `validate_config_json`, and the noop extractor artifact — twice (once pre-execute, once again during Step 8) — because they were added to one FR but not propagated to sibling spec sections.
- **Evidence**: `docs/roadmap/features/008-signal-source-registry/context.md:55-61,151-153`.
- **Rule it implies**: When a spec defines a value enum with variant subsets (e.g. base + mediated), explicitly cross-check every downstream artifact (migration, validators, extractor stubs, tests) against the full enum list before marking the step done.

### 2026-08-05 — trader-chart-panel — assumption
- **Mistake**: An impl-spec review caught that `mock-backend.ts` needed a new env-derived endpoint mocked, but missed that `playwright.config.ts`'s `webServer.env` needed the same var added — the gap surfaced only during Step 5 execution.
- **Evidence**: `docs/roadmap/features/014-trader-chart-panel/context.md` L38-42 (review) vs L95 (execute-time fix).
- **Rule it implies**: When a review flags a missing mock/env wiring in one test-support file, also check sibling test-support files (playwright config, docker-compose, etc.) that mirror the same env var.

### 2026-08-05 — fix-grafana-otel-variables — assumption
- **Mistake**: A markdown-status-parsing CI step used non-portable/unanchored grep+sed (unescaped `**`, wrong PR-number pattern, unscoped `sed -i` insert) and silently failed to flip feature status on promotion.
- **Evidence**: `docs/roadmap/features/015-fix-grafana-otel-variables/context.md:146-154`.
- **Rule it implies**: CI scripts parsing `feature.md` must be tested against the real merge-commit message format and use anchored (`sed -n`/`awk`-scoped) edits, never a blind whole-file `sed -i`.

### 2026-08-05 — config-ui-weight-validation — assumption
- **Mistake**: Assumed a DB column named `value_type` already carries the semantic type needed for a new feature (validation bounds), when it actually stores an unrelated storage type (`string`/`int`/`float`/…).
- **Evidence**: `docs/roadmap/features/016-config-ui-weight-validation/context.md` Session 2026-06-01T00:02:00Z (sdd-spec finding); implementation-spec.md Step 3 Codebase Evidence (pruned; recoverable via git history).
- **Rule it implies**: Before reusing an existing column/field for new semantics, grep its write-site to confirm what it actually encodes today — a matching name is not proof of matching meaning.
### 2026-08-05 — unified-login-page — assumption
- **Mistake**: `/sdd-spec` generated a concrete implementation spec against an assumed post-dependency codebase state while the dependency feature (045) was still in-flight, producing a spec invalidated by the time execution started.
- **Evidence**: `docs/roadmap/features/019-unified-login-page/context.md:56-57,76-80`.
- **Rule it implies**: For features with a hard merge-order dependency, prefer re-running `/sdd-spec` (not just merging main-dev) immediately before `/sdd-execute` if significant time has passed since spec-ready.

### 2026-08-05 — mpt-portfolio-optimization — assumption
- **Mistake**: Nearly treated an ordinal/conviction score (analysis service's 0–1 signal confidence) as if it were a cardinal expected-return estimate suitable as an optimizer input.
- **Evidence**: `docs/roadmap/features/028-mpt-portfolio-optimization/product-spec.md:16,30-31` (pruned; recoverable via git history).
- **Rule it implies**: Before feeding any existing service's score/metric into a new quantitative model, verify its units and semantics match what the model requires — an ordinal ranking is not a cardinal estimate, even on the same 0–1 scale.

### 2026-08-05 — upgrade-nextjs15 — assumption
- **Mistake**: The spec cited a file for modification that a concurrently-merging feature (044) had already deleted, discovered only at execute time.
- **Evidence**: `docs/roadmap/features/041-upgrade-nextjs15/` implementation-spec.md Deviation Log Step 2; context.md Session 2026-05-30 (4-feature parallel batch) (pruned; recoverable via git history).
- **Rule it implies**: For features spec'd as part of a parallel batch off main-dev, re-verify cited file paths still exist immediately before executing each step, not just at spec time.

### 2026-08-05 — align-frontend-e2e-bff-mocks — duplication
- **Mistake**: `mock-backend.ts` in two separate frontends (trader, insights) independently used the wrong field name `accountId` instead of the actual proto field `id` on `BrokerAccount`, undetected until full suite runs.
- **Evidence**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/context.md:92-93,109-111`.
- **Rule it implies**: When copying mock-backend scaffolding between frontends, diff mock response shapes against the proto message definition, not against the sibling mock file.

### 2026-08-05 — strategy-engine — scope-creep
- **Mistake**: `xstockstrat-agent` accumulated ruff violations because it's absent from the CI lint matrix, risking scope creep when later steps touched the same files.
- **Evidence**: `docs/roadmap/features/047-strategy-engine/context.md:193-232`.
- **Rule it implies**: When editing a file in a non-CI-linted service, fix only the lines you touch; do not "clean up" pre-existing drift as a side effect.
### 2026-08-05 — make-repo-public-secure — assumption
- **Mistake**: Feature reached `launched` while product-spec AC-5 (`SECURITY.md` required) was never satisfied — no correcting session recorded it as a gap.
- **Evidence**: `docs/roadmap/features/004-make-repo-public-secure/` product-spec.md AC-5; implementation-spec.md Deviation Log, Step 6 (pruned; recoverable via git history).
- **Rule it implies**: `/sdd-execute`'s completion path should cross-check acceptance criteria against actually-created files before the feature is allowed to flip to `code-completed`.

### 2026-08-05 — make-repo-public-secure — config
- **Mistake**: A later implementation step (Step 11) was absorbed/canceled, and a spec'd secret name (`GITHUB_TOKEN` → `GH_PAT_SCAN`, Step 7) was swapped, mid-execution via ad hoc adjustment rounds instead of re-running `/sdd-spec`, leaving `implementation-spec.md` contradicting the shipped `ci.yml` with no in-code comment explaining the swap.
- **Evidence**: `docs/roadmap/features/004-make-repo-public-secure/` implementation-spec.md Step 7 L475 vs `.github/workflows/ci.yml:671,676`; Step 10/11 order (L578-668); context.md 2026-05-11T02:15:00Z session (pruned; recoverable via git history).
- **Rule it implies**: If execute-time changes cancel/merge a planned step or swap a spec'd credential/config value, re-run `/sdd-spec` (or manually clean the doc) and leave an in-repo comment for secret substitutions before marking the feature complete.

### 2026-08-05 — agent-mcp-server — assumption
- **Mistake**: The implementation spec assumed the lowlevel `mcp.server.Server` class supports a `.tool()` decorator; only `FastMCP` does — caught only at Step 10 unit-test writing.
- **Evidence**: `docs/roadmap/features/009-agent-mcp-server/context.md:245,266`.
- **Rule it implies**: When a design references a specific SDK/class, verify its exact API in the recon/design phase, not at first use during execute.

### 2026-08-05 — remove-n8n-references — duplication
- **Mistake**: The spec assumed one router file per service; execute found a second, unimported, orphaned copy of the same router in 3+ services.
- **Evidence**: `docs/roadmap/features/011-remove-n8n-references/context.md` 2026-05-18T00:00:00Z, T02:00:00Z.
- **Rule it implies**: Grep for near-duplicate/orphaned router or handler files before writing the impl-spec for a cleanup/removal feature.

### 2026-08-05 — remove-n8n-references — assumption
- **Mistake**: `product-spec.md` FR-1 and FR-2 disagreed on notify's `list-alerts` behavior; shipped code followed a decision recorded only in `context.md`, not a spec correction.
- **Evidence**: `docs/roadmap/features/011-remove-n8n-references/product-spec.md:39` vs `:60` (pruned; recoverable via git history); context.md 2026-05-18T01:00:00Z, T06:00:00Z.
- **Rule it implies**: Flag intra-spec contradictions (two FRs disagreeing on the same endpoint's behavior) during `/sdd-review`, not leave them to be silently resolved at execute time.

### 2026-08-05 — remove-n8n-references — assumption
- **Mistake**: `/sdd-spec` ran while `feature.md` was still `draft` (the product-spec review gate had never completed); execution proceeded on "implicit confirmation" with no record in `feature.md`'s Status History.
- **Evidence**: `docs/roadmap/features/011-remove-n8n-references/context.md:175`.
- **Rule it implies**: Skills that require a prior gate must hard-block (not proceed on implicit invocation) when `feature.md` status doesn't match the precondition, and any override must be logged in Status History, not just context.md prose.

### 2026-08-05 — wire-fe-auth — assumption
- **Mistake**: The spec assumed indicators made outbound ingest calls per the service registry; the servicer had zero stubs — the spec was stale versus the actual Phase-3 code.
- **Evidence**: `docs/roadmap/features/012-wire-fe-auth/` implementation-spec.md L828-832 (pruned; recoverable via git history).
- **Rule it implies**: Verify a spec's cross-service call assumptions against the actual servicer code, not just the service registry doc, before relying on them.

### 2026-08-05 — wire-fe-auth — config
- **Mistake**: Adding a second base to `@/*` TypeScript path aliases silently double-prefixes imports; the breakage surfaces only at build time, not at edit time.
- **Evidence**: `docs/roadmap/features/012-wire-fe-auth/` implementation-spec.md L813-821 (pruned; recoverable via git history).
- **Rule it implies**: When adding a second base directory to an existing path alias, run a full build immediately, don't rely on editor-time resolution to catch a double-prefix collision.

### 2026-08-05 — phase-2-data-layer — scope-creep
- **Mistake**: A user-requested "also fix X" (SourceRegistry) was implemented directly mid-session instead of routed through `/sdd-story`.
- **Evidence**: `docs/roadmap/features/013-phase-2-data-layer/context.md` 2026-05-20 "SourceRegistry implemented (scope expansion — skipped SDD flow)".
- **Rule it implies**: Even a small opportunistic in-session fix must get its own `/sdd-story` pass or be explicitly logged as a sanctioned deviation.

### 2026-08-05 — phase-2-data-layer — assumption
- **Mistake**: A broker-API field name (`avgPrice`) was inferred (not confirmed against a live endpoint) and shipped with a caveat buried in `implementation-spec.md`; the unit test mocks the same guessed field name, so it structurally cannot detect a wrong guess.
- **Evidence**: `docs/roadmap/features/013-phase-2-data-layer/` implementation-spec.md:109 (pruned; recoverable via git history); `services/xstockstrat-trading/internal/broker/ibkr.go:281`; `ibkr_test.go:99`.
- **Rule it implies**: When a step's code is written against an inferred (not spec-confirmed) external API field name, the caveat must be promoted into context.md or a tracked follow-up — not left only in implementation-spec.md — since spec files get deleted on archive and a hand-rolled mock test gives false confidence.

### 2026-08-05 — agent-mcp-oauth — scope-creep
- **Mistake**: A feature was carved out and deferred without noting its infra dependencies explicitly, making it harder for a later re-spec to find them.
- **Evidence**: `docs/roadmap/features/018-agent-mcp-oauth/context.md:12-14,44-52`.
- **Rule it implies**: When deferring a carved-out feature, note its infra dependencies explicitly in context.md so a later re-spec finds them fast.

### 2026-08-05 — agent-mcp-oauth — assumption
- **Mistake**: A reviewer flagged a specific design ambiguity (FR-9's two-token conflation) with a concrete recommendation; the impl-spec built a different, simpler shape with no documented rationale for departing from the review.
- **Evidence**: `docs/roadmap/features/018-agent-mcp-oauth/context.md:21`; implementation-spec.md:185-197 (pruned; recoverable via git history).
- **Rule it implies**: When an impl-spec diverges from a prior review's explicit recommendation, record why in context.md at spec time, not leave it implicit.

### 2026-08-05 — ci-docker-registry-deploy — assumption
- **Mistake**: A container registry (DOCR) was chosen purely for auth convenience without checking its repo-count limit against the actual 15-service fleet.
- **Evidence**: `docs/roadmap/features/038-ci-docker-registry-deploy/` product-spec.md L95 vs implementation-spec.md Step 3 (5/15) vs context.md 2026-05-29 (pruned; recoverable via git history).
- **Rule it implies**: For any "pick a managed registry" decision affecting N services, recon must check plan/quota limits against N before locking in the choice.

### 2026-08-05 — ci-docker-registry-deploy — scope-creep
- **Mistake**: The product-spec's Affected Services list omitted a service (`xstockstrat-agent`) that was already present in the target config files (`.do/app*.yaml`), so `/sdd-spec` silently widened scope to cover it with no visibility back into the approved spec.
- **Evidence**: `docs/roadmap/features/038-ci-docker-registry-deploy/context.md` 2026-05-26T00:05 (L45) vs product-spec.md 14-service list (pruned; recoverable via git history).
- **Rule it implies**: When `/sdd-spec` finds an entity in target files that the product-spec's Affected list omits, flag it back to the spec (or note it explicitly) rather than quietly absorbing it.

### 2026-08-05 — client-api-pattern — assumption
- **Mistake**: A `/sdd-story` re-story pass did not re-diff the assumed codebase state against current main-dev.
- **Evidence**: `docs/roadmap/features/044-client-api-pattern/context.md` 2026-05-30T00:00:00Z.
- **Rule it implies**: A re-story pass on an existing feature must re-diff the codebase, not just accept the prior story's assumptions.

### 2026-08-05 — client-api-pattern — assumption
- **Mistake**: An unsafe type cast was justified inline with "no current caller reads this," with no comment explaining the reasoning at the cast site.
- **Evidence**: `services/xstockstrat-ui/src/lib/identity.ts:19`.
- **Rule it implies**: Any unsafe cast justified by "no current caller" reasoning must carry an inline comment stating that reasoning, since it silently becomes wrong the moment a new caller appears.

### 2026-08-05 — client-api-pattern — scope-creep
- **Mistake**: A core FR's chosen library was dropped mid-execution without a Deviation Log entry, surviving only as an unexplained fact in the final pattern doc.
- **Evidence**: `docs/roadmap/features/044-client-api-pattern/` product-spec.md FR-1 vs. context.md Steps 4-6 (pruned; recoverable via git history).
- **Rule it implies**: When a spec names a specific library for a core FR, the step that "completes" that FR should grep for an actual import of it before marking done, and any silent abandonment must get a Deviation Log entry.

### 2026-08-05 — ui-consolidation-nextjs — header
- **Mistake**: `docs/patterns/nextjs-frontends.md` was left describing the pre-consolidation basePath/nginx BFF-key convention after feature 045 shipped the opposite.
- **Evidence**: `docs/patterns/nextjs-frontends.md:3,25,289-297` vs `services/xstockstrat-ui/src/lib/traderBff.ts:157-159`.
- **Rule it implies**: A consolidation/architecture-change feature must update the shared pattern doc, not only the affected service's own CLAUDE.md.

### 2026-08-05 — ui-consolidation-nextjs — assumption
- **Mistake**: Moving an existing flat single-basePath app into a nested route-group segment broke (a) relative component imports (`./ui/*` → `../ui/*`), (b) hardcoded same-app absolute cross-page imports (`@/app/page` → `@/app/trader/page`), and (c) hardcoded top-level navigation hrefs inside shell/nav components — not just shared-lib imports, and not just import statements.
- **Evidence**: `docs/roadmap/features/045-ui-consolidation-nextjs/context.md:111,112,113,114`.
- **Rule it implies**: Any future nesting/consolidation of an existing app must grep for relative imports crossing the new directory boundary, absolute imports pointing at the old top-level page path, AND hardcoded `href`/nav-link literals in shell/layout components that assumed a flat top-level path.

### 2026-08-05 — live-strategy-alert-engine — header
- **Mistake**: Near-miss — nearly forwarded a blanket admin `x-access-scope` from an unauthenticated-for-admin entry point (agent SSE `validate_api_key`).
- **Evidence**: `docs/roadmap/features/048-live-strategy-alert-engine/context.md:89-92`.
- **Rule it implies**: Verify the upstream entry point actually authenticates the elevated privilege level before forwarding it — a near-miss here is a real risk elsewhere.

### 2026-08-05 — live-strategy-alert-engine — assumption
- **Mistake**: Adding a new proto/DB field (`live_enabled`) without updating the row-to-proto mapper (`_row_to_strategy_definition`) in lockstep — the bug was only caught by writing tests, not by type-checking.
- **Evidence**: `docs/roadmap/features/048-live-strategy-alert-engine/context.md:137-139`.
- **Rule it implies**: When adding a field to a response proto backed by a DB row, grep every row-to-proto mapper function for that message and update all call sites in the same step, before writing tests.

### 2026-08-05 — live-strategy-alert-engine — assumption
- **Mistake**: The spec assumed protobuf-es v2 Struct field introspection (`context?.fields?.<key>?.stringVal`) was safe for client-side filtering; shipped code abandoned it for tag-string filtering instead.
- **Evidence**: `docs/roadmap/features/048-live-strategy-alert-engine/context.md:166,174,180-181`.
- **Rule it implies**: Prefer tag/string-based filtering over protobuf-es v2 Struct field introspection in TS clients; don't spec Struct field access as the primary filter mechanism.

### 2026-08-06 — unify-admin-auth-gates — assumption
- **Mistake**: a pre-login-created signed blob (`txn`) plus a client-suppliable flag was initially proposed to carry post-login identity, which is forgeable.
- **Evidence**: context.md "sdd-review impl-spec" session flagging it; fixed in "resolve callback-handoff advisory" session.
- **Rule it implies**: never trust a blob signed before authentication to carry identity established after — always re-derive identity from a fresh, validated credential at point of use.

### 2026-08-06 — strategy-creation-flow — assumption
- **Mistake**: `dispatchConnect` in `insightsBff.ts` let a leaked `application/grpc+proto` content-type collapse real backend error messages into generic "HTTP 400", undetected until deep in E2E authoring.
- **Evidence**: context.md:123-126.
- **Rule it implies**: Audit other BFF `dispatch*` helpers (trader, config-ui) for the same content-type/error-passthrough leak before relying on their error messages in new UI.

### 2026-08-06 — auth2-authorized-apps-ui — assumption
- **Mistake**: First /sdd-spec pass for a feature extending a prior feature's shared token-mint code assumed the existing column/behavior was sufficient without reading the actual insert statement — missed that client_id was never persisted, which would have silently broken the new feature (empty list) post-launch.
- **Evidence**: context.md:109-115, implementation-spec.md:34-42
- **Rule it implies**: when a new feature reads data written by another feature's shared write path, read that write path's exact INSERT/UPDATE columns at spec time, not just the schema.

### 2026-08-06 — durable-observable-backfills — migration
- **Mistake**: Product spec assumed the next migration NNN without listing the actual migrations directory, guessing wrong.
- **Evidence**: context.md sdd-spec session; implementation-spec.md Step 3 Codebase Evidence.
- **Rule it implies**: Always `ls migrations/` before writing a migration number into any spec.

### 2026-08-06 — durable-observable-backfills — assumption
- **Mistake**: Tests manipulated a private internal dict directly instead of the public interface, forcing a full rewrite when internals changed.
- **Evidence**: context.md sdd-spec session; implementation-spec.md Step 10.
- **Rule it implies**: Tests should drive behavior through the public/repo interface, not private attributes, so internal refactors don't break test suites.

### 2026-08-06 — orders-management-ui — assumption
- **Mistake**: A hand-rolled positional-arg WHERE-clause builder (`trading_repo.go` `ListOrders`) had one branch silently missing its arg-index increment; went unnoticed until a later feature extended the function (context.md:59-61).
- **Evidence**: context.md:59-61, 130-133, 160-161.
- **Rule it implies**: Before extending any positional-arg dynamic query builder, verify every existing branch increments its counter — don't assume prior branches are correct.

### 2026-08-06 — orders-management-ui — assumption
- **Mistake**: Product-spec FR-2 grounding asserted `ListOrders` "already supports ... `range`" without confirming the field was actually applied server-side; it was accepted by the proto message but never read by the handler, making the assumed-existing filter a silent no-op until caught mid-implementation.
- **Evidence**: product-spec.md:26-29; implementation-spec.md:413-417.
- **Rule it implies**: When a spec claims an RPC "already supports" a filter/field as grounding for scoping later work as UI-only, verify the field is actually consumed by the service logic (not just present on the proto message) before scoping downstream steps as backend-complete.

### 2026-08-06 — backfill-management-ui — assumption
- **Mistake**: implementing a spec-offered option (DB re-read) without checking it against the existing test suite first, breaking 2 unrelated passing tests.
- **Evidence**: implementation-spec.md:657-661.
- **Rule it implies**: when a spec offers multiple valid implementation branches, run the existing suite before committing to one.

### 2026-08-06 — backfill-management-ui — assumption
- **Mistake**: expecting a full local Playwright green run against `pnpm dev` for a brand-new route; the 10s/test timeout can't survive cold-compile.
- **Evidence**: implementation-spec.md:672-676.
- **Rule it implies**: for new-page E2E, verify statically (tsc/lint/prettier + one diagnosed run) locally and defer the full green run to CI's prebuilt server.

### 2026-08-06 — watchlist-management — assumption
- **Mistake**: pinned `@playwright/test` expects a browser build (chrome-headless-shell) not present in the base image; required an uncommitted local override to run E2E.
- **Evidence**: context.md 2026-06-29 Step 9 Env note.
- **Rule it implies**: fix the base image or document the workaround centrally so it isn't rediscovered per-feature.

### 2026-08-06 — fundamentals-data-source — assumption
- **Mistake**: Assumed an existing alert-emission helper was severity-agnostic; it was hardcoded to one severity, discovered only during Step 8 execution, requiring a new helper mid-implementation.
- **Evidence**: context.md:54-56 (sdd-review impl-spec advisory), context.md:85-86 (execute session).
- **Rule it implies**: Before reusing a helper for a new call site with different parameters (severity, type, etc.), read its full signature/body — don't assume it parameterizes what the new use case needs.

### 2026-08-06 — fundamentals-signal-producer — config
- **Mistake**: a config validator defaulted to fail-open for unrecognized categorical values instead of an explicit allow-list.
- **Evidence**: context.md:109-118.
- **Rule it implies**: new `validate_*` functions over categorical inputs must be fail-closed from the start.

### 2026-08-06 — fundamentals-signal-producer — assumption
- **Mistake**: an "additive CHECK is low-risk because validation already lags the schema" justification (context.md:97-102) was invalidated by a later, unrelated hardening (fail-open→fail-closed fix, context.md:109-118) in the same feature, but the original reasoning was never re-flagged as stale.
- **Evidence**: context.md:97-102 vs 109-118.
- **Rule it implies**: when a later step in the same feature removes the premise behind an earlier risk sign-off, add a note that the sign-off's rationale no longer holds.

### 2026-08-06 — fundamentals-signal-producer — migration
- **Mistake**: concurrent features targeting the same shared numbered-migration directory collided on "next," caught only at impl-spec review.
- **Evidence**: context.md:84-85.
- **Rule it implies**: reserve/announce next-free shared migration numbers at design time.

### 2026-08-06 — cross-stock-score-derivation — assumption
- **Mistake**: an SDD interactive design gate carried forward an unconfirmed "working steer" (exclude zero-trade cells) as if it were user-approved; the gate had actually failed to deliver/record the real decision, only caught when re-asked in a later round (opposite answer).
- **Evidence**: context.md:105-111.
- **Rule it implies**: after any interactive gate, verify the recorded decision against an explicit user utterance before treating a "steer" as confirmed — don't let debate momentum stand in for sign-off.

### 2026-08-06 — trigger-backfill-mcp-tool — assumption
- **Mistake**: A shared discovery doc (`mcp-tools.md`) was missing a section for a prior tool (`set_strategy_live`, feature-048); this feature added its own sections but left the older gap in place.
- **Evidence**: context.md:86-88 (066).
- **Rule it implies**: When touching a shared discovery surface, either fix an unrelated pre-existing gap found there or explicitly flag it as a follow-on — don't silently carry it forward again.

### 2026-08-06 — backtest-result-attachment — assumption
- **Mistake**: three review rounds each fixed only the flagged line, leaving an adjacent identical construct broken.
- **Evidence**: context.md:535-554
- **Rule it implies**: When a code review flags one defective line, grep for structurally identical sibling instances in the same file/PR before closing the review round — don't fix only the named occurrence.

### 2026-08-06 — mcp-config-management — duplication
- **Mistake**: spec fix edited one clause but left a sibling clause stating the old false claim.
- **Evidence**: context.md:274-278.
- **Rule it implies**: grep the whole doc for the corrected term.

### 2026-08-06 — mcp-config-management — assumption
- **Mistake**: an agent stated an unverified technical claim ("SSE requires an in-memory session map") as fact to justify a design decision to the user; only a later recon pass against the installed SDK found it false.
- **Evidence**: recon.md:19-48.
- **Rule it implies**: before citing an SDK/library constraint as justification for a design decision, verify it against the installed source, not memory or a prior session's unchecked claim.

### 2026-08-06 — fix-config-write-authz — assumption
- **Mistake**: SEV-1 fix auto-promoted to `launched` while its own flagged outstanding smoke-test AC was never run.
- **Evidence**: context.md:230-235,247-251; feature.md:59-62,28.
- **Rule it implies**: human must confirm outstanding manual ACs before merging a SEV-1 promotion PR.

### 2026-08-06 — fix-config-value-roundtrip — duplication
- **Mistake**: A prior feature's new lint rule (DRY rails on `src/__tests__/**`) fired on that same feature's own new test file, but lint wasn't re-run after the later step that added the file, so the failure shipped and was only caught incidentally by an unrelated later feature.
- **Evidence**: docs/roadmap/features/075-fix-config-value-roundtrip/context.md:41-46
- **Rule it implies**: Re-run lint after every step that adds new files, not just after steps that touch config/rules — a rule added mid-feature can invalidate files created later in the same feature.

### 2026-08-06 — remove-mcp-sse-transport — assumption
- **Mistake**: `/sdd-review`'s `feature-overlap` subagent read the local git reflog rather than `origin/main-dev` and reported a false blocking merge-order dependency on an already-merged feature.
- **Evidence**: `docs/roadmap/features/079-remove-mcp-sse-transport/context.md:85-91`.
- **Rule it implies**: `feature-overlap` (and any subagent reasoning about merge/branch state) must check the remote ref, not local reflog, before asserting an ordering constraint.

### 2026-08-06 — fix-mcp-strategy-lifecycle — duplication
- **Mistake**: recon.md recommended replicating a consumer's firing-predicate logic (`_symbols_for`) into a new call site instead of extracting it.
- **Evidence**: recon.md:36 vs design.md:21-25
- **Rule it implies**: when recon proposes replicating existing logic into a new code path, treat it as a draft suggestion to be challenged in the design debate for DRY/C-10 risk, not a foregone conclusion.

### 2026-08-06 — fix-mcp-screener-correctness — assumption
- **Mistake**: `coverage_gaps` (a diagnostic derived from the full ranked list) was computed *after* rank/floor truncation, silently dropping entries a caller needed to see.
- **Evidence**: recon.md:17 ("bug — gaps after truncation"), design.md:19-22.
- **Rule it implies**: compute any diagnostic/summary/gap-detail output from the full result set before applying limit/filter truncation, not after.

### 2026-08-06 — fix-mcp-config-key-registry — assumption
- **Mistake**: TS servicer code reading a proto field by its snake_case proto name instead of ts-proto's camelCase silently no-ops (`undefined`, no error).
- **Evidence**: `setConfigAuthz.test.ts:173-178`; fix reads `call.request.createKey ?? call.request.create_key`.
- **Rule it implies**: any new scalar/bool field in a TS-consumed proto request must be read via camelCase (or `??` both) and proven with a wire-level loopback test.

### 2026-08-06 — fix-mcp-writepath-authz — assumption
- **Mistake**: Teardown's mandatory `/context-scrubber scan` was skipped for a launch that edited `context-constitution.md`/CLAUDE.md files, because the context-forge plugin was unavailable in the execute session — noted in the PR but not blocked on.
- **Evidence**: context.md:148-149.
- **Rule it implies**: if context-forge is unavailable when Teardown applies, treat it as a blocking gap to resolve (e.g. a follow-up scan), not a note-and-proceed — plugin absence isn't grounds to skip a mandated gate silently.

### 2026-08-06 — opportunity-universe-unification — assumption
- **Mistake**: UI mock/fixture authors writing Connect-RPC request bodies by hand assumed proto-JSON numeric/native encodings (enum as number, timestamp as epoch) and had to correct to NAME-string enums and RFC3339 timestamp strings.
- **Evidence**: `docs/roadmap/features/097-opportunity-universe-unification/context.md:305`.
- **Rule it implies**: when hand-authoring Connect-JSON request fixtures, enums and well-known types must match `protojson` conventions (enum=NAME string, `Timestamp`=RFC3339 string), not raw proto-binary shapes — verify against a real client call before trusting a mock.

### 2026-08-06 — remove-x-mcp-secret-header — assumption
- **Mistake**: Execute-time steps assumed Docker daemon and the context-forge plugin would be available in the sandboxed execution environment; both were absent, forcing on-the-spot substitutions (docker compose config; manual grep) flagged for a later human/CI pass.
- **Evidence**: context.md:227-235 (Docker daemon), context.md:303-315 (context-scrubber plugin); reinforces existing `fails.md:300` Docker-unavailable family (now a 4th+ recurrence).
- **Rule it implies**: Infra/doc-touching implementation specs should name a non-daemon/non-plugin fallback check up front, not discover the gap at execute time — and record substituted evidence explicitly as "not a live-boot proof" rather than silently treating it as equivalent.

### 2026-08-06 — broker-failure-simulator — assumption
- **Mistake**: A product spec (and feature number) was allocated for chaos-testing infrastructure whose core justification (automated order execution) didn't exist yet in the platform, and whose CI prerequisite (DB service containers) was also absent — both discoverable at story time.
- **Evidence**: docs/roadmap/features/103-broker-failure-simulator/product-spec.md:9-14; context.md:19-24
- **Rule it implies**: Before `/sdd-story` commits an external-review item to spec-ready, grep for the prerequisite runtime/CI capability the story assumes exists; if absent, file it as a dependency-blocked idea rather than a draft spec.

### 2026-08-06 — trading-state-machine-invariants — scope-creep
- **Mistake**: Spec'd hardening/test infrastructure (property-based tests, and separately the feature-103 simulator) for an order-execution path that is still 100% human-initiated, with no unattended caller yet needing the invariant depth proposed.
- **Evidence**: docs/roadmap/features/104-trading-state-machine-invariants/context.md:22-24; feature.md:15
- **Rule it implies**: Before speccing invariant/property-based test suites for a subsystem, confirm the subsystem actually has the concurrency/autonomy profile (multiple unattended callers) that makes example-based tests insufficient — otherwise defer until that capability exists.

### 2026-08-06 — trading-crash-consistency — assumption
- **Mistake**: Product spec for a CI-heavy test suite (crash injection across 3 services) was written without first checking whether CI had the prerequisite infrastructure (ephemeral Postgres/service containers) — a gap already documented in a sibling feature's context.md.
- **Evidence**: docs/roadmap/features/105-trading-crash-consistency/context.md:16-24 (feasibility re-check found the gap same-day, citing 103's context.md as prior knowledge)
- **Rule it implies**: Before `/sdd-story` scopes a CI-infrastructure-dependent test suite, check sibling/dependency features' context.md for known infra gaps — a feasibility check belongs before product-spec drafting, not after.

### 2026-08-06 — market-data-freshness-and-quality-gate — scope-creep
- **Mistake**: Product spec born from an external risk-review checklist item proposed a full new service surface (proto+config+DB) before checking whether an existing code path already covered the cheap, high-value part of the requirement.
- **Evidence**: docs/roadmap/features/106-market-data-freshness-and-quality-gate/context.md:20-26
- **Rule it implies**: Before scoping new infrastructure from an externally-sourced requirement, do a quick grep for an existing enforcement/hook point that could absorb the minimal viable version first.

### 2026-08-06 — live-capital-canary-rollout — scope-creep
- **Mistake**: /sdd-story drafted a full product spec for a safety-control/rollout mechanism whose target capability (automated strategy-to-order execution) does not exist and isn't roadmapped, sourced directly from an external risk-review checklist item rather than a verified codebase gap.
- **Evidence**: docs/roadmap/features/107-live-capital-canary-rollout/context.md:18-26
- **Rule it implies**: When a product spec originates from an external review/list item, /sdd-story (or the gate before /sdd-design) must confirm the capability the control would govern already exists or is actively roadmapped before drafting FRs — a one-line feasibility check, not a full design debate.

### 2026-08-06 — trading-safety-dashboard-slos — assumption
- **Mistake**: A feature's story cited upstream instrumentation features (100–107) by number as its data source without re-verifying, at spec/feasibility time, that those features were still scoped to emit that telemetry — several had been demoted/rescoped by the time of the recheck.
- **Evidence**: docs/roadmap/features/108-trading-safety-dashboard-slos/context.md session 2026-08-04T01:00:00Z; product-spec.md:98-100
- **Rule it implies**: when a feature's FRs depend on named upstream feature numbers, /sdd-design Phase 0 recon must check each cited dependency's current `feature.md` lifecycle status, not assume the roadmap-order description still holds.

### 2026-08-06 — exactly-once-order-intent — assumption
- **Mistake**: Across five design-debate rounds, every SQL fragment for a new table's state column used string literals (`WHERE state = 'pending'`) as narrative shorthand. A later round explicitly confirmed the column's real type — `SMALLINT` mapped to a proto enum, following this service's own `credential_status` precedent — but nothing in that confirmation retroactively corrected the SQL already written against the wrong assumed type. Comparing a `SMALLINT` column to an unknown-type string literal fails at parse time (`invalid input syntax for type smallint: "pending"`), which would have broken the new table's own index creation and every reactive/sweep query if shipped as literally drafted — caught only by a dedicated adversarial round explicitly re-reading the confirmed column type against the accumulated SQL.
- **Evidence**: `docs/roadmap/features/101-exactly-once-order-intent/design.md` § Chosen Approach (integer `IntentState*` constants replacing the string literals) and § Rounds; `docs/roadmap/features/101-exactly-once-order-intent/context.md` § Session 2026-08-06 — sdd-design, rounds 6-7.
- **Rule it implies**: extends **C-01** — when a design round confirms or changes a column's real type mid-debate, that round's synthesis must explicitly re-walk every SQL fragment drafted in prior rounds against the confirmed type, not just record the confirmation as a standalone fact. A type confirmation that doesn't retroactively audit already-written SQL is itself an incomplete fix — the same trap as narrowing-scope "already correct" claims (see the 080/2026-07-30 entry above), just for a column's type instead of a code path's behavior.

### 2026-08-06 — broker-state-reconciliation — assumption
- **Mistake**: A design round added a new audit column to a table's schema and correctly updated both of that table's `AFTER`/`BEFORE` trigger functions to copy the new column through (verified: both build their `INSERT` from an explicit named column list, not a `NEW.*` passthrough, so this part of the reasoning was genuinely careful) — but never checked the *actual write path* that populates the row in the first place. That write path was an `INSERT ... ON CONFLICT (...) DO UPDATE SET <named columns>` statement whose `ON CONFLICT` branch is the one that fires on every runtime call against an already-seeded row — and the new column was absent from both the `INSERT` column list and the `DO UPDATE SET` clause. The schema and both triggers were "done"; the one statement that actually needed the new value never got it, so the column would stay `NULL` forever and the entire audit-trail goal would silently fail to materialize despite every other piece of the design being correct.
- **Evidence**: `docs/roadmap/features/102-broker-state-reconciliation/design.md` § "Critical completeness fix, also folded in directly"; `docs/roadmap/features/102-broker-state-reconciliation/context.md` § Session 2026-08-06, round 3 adversary finding, verified directly against `services/xstockstrat-config/migrations/001_config_tables.up.sql` and `010_config_audit_insert_trigger.up.sql`'s real trigger bodies.
- **Rule it implies**: extends **C-01**/the "verify mechanics, not just surface shape" family (see the 030/2026-08-06 insights.md entry and the 101/2026-08-06 SQL-literal entry above) — when a new column is added for a downstream consumer (a trigger, a report, an audit filter), the design must trace the value **forward from its origin**: which statement actually populates it on every code path that writes the row, not just which statements copy it onward once it exists. Reviewing "does the trigger propagate this" without first confirming "does the base write statement set this" checks the easier half of the chain and misses the half that actually matters.

### 2026-08-06 — backtest-debug-info — assumption
- **Mistake**: Code assumed a proto field named `bar.timestamp` existed on `marketdata_pb2.Bar` for years (six call sites in `xstockstrat-analysis`'s `servicer.py`); the real field is `bar.time`. The bug was invisible because every test built bars with `MagicMock`, which returns a truthy value for *any* attribute access instead of raising `AttributeError` on a nonexistent field — so the type-mismatch never surfaced until this feature mandated real `Bar` proto fixtures for a diagnostics test.
- **Evidence**: `docs/roadmap/features/064-backtest-debug-info/context.md` session "2026-07-09 — sdd-spec" ("Confirmed the latent bar.timestamp bug..."), "Steps 8–11" (fix + real-fixture test).
- **Rule it implies**: `MagicMock`-based proto stand-ins can hide wrong-attribute-name bugs indefinitely; any step that reads/asserts on proto field values should use a real message instance, not a `MagicMock`, in the same step it's introduced.

### 2026-08-06 — fix-backfill-timeframe-enum — migration
- **Mistake**: A step authoring a DB migration (`003_canonicalize_ohlcv_timeframe`) was marked `blocked` on the reasoning that F-05 requires the migration to be executed against a live database in the authoring session to count as verified — this environment had neither `migrate` nor a running Docker daemon. Left uncorrected, this would have permanently stranded the feature: `/sdd-execute` never flips `feature.md` to `code-completed` while a step stays `blocked`, `/promote` harvests only `code-completed` features, and the execute loop's ALL-DONE path would still open the integration PR while the feature sat unshippable in `main-dev`. The user challenged the premise directly; a repo-precedent check (`008-signal-source-registry` step 3 marked `done` on identical review-based verification, no live-DB round trip evidenced) showed the bar had no support anywhere else in this repo's actual practice. Retracted; the step was completed via SQL review against DDL facts, matching `008`'s precedent, with the DBA + service-owner sign-off gate (the actual safety net) left unchanged.
- **Evidence**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/context.md` § "Session 2026-07-30 — step 5 unblocked (user-directed correction)"; `docs/roadmap/features/008-signal-source-registry/implementation-spec.md` step 3.
- **Rule it implies**: F-05 does not require a live database in the authoring session to mark a migration step verified — a documented SQL review against the DDL facts (PK, hypertable/partitioning column, compression status) is this repo's actual, precedented bar. Before marking any migration step `blocked` for lack of a runnable environment, check for repo precedent first — and weigh the severe downstream consequence (the feature can never reach `code-completed`) before applying a stricter bar than the repo has ever actually enforced. Strong candidate for promotion to a binding note near **F-05** in the Constitution, since the mis-application nearly stranded a shipped feature.

### 2026-08-06 — ui-revamp-opportunities-first — assumption
- **Mistake**: A "matches the handoff" fidelity sign-off was made via content-only review, which missed that the Screener's results table was a raw `<table>` (not the shared `<Table>` component that wraps `overflow-auto`) and overflowed the phone viewport, clipping a column. The same mistake pattern recurred immediately after in a different form — the shared header itself (fixed-width `AccountSelector` + a newly added Copilot toggle button) also overflowed the phone frame by 101px on all three `/trader/*` pages, undetected until a dedicated scripted sweep was added.
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md` "Screener mobile responsiveness fix" + "phone-frame overflow sweep (all screens)" sessions; `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`.
- **Rule it implies**: a "fidelity matches handoff" claim on any UI feature must be backed by an automated mobile-overflow assertion across every route, added at the same step the fidelity claim is made — not deferred to a later sweep.

### 2026-08-06 — ui-revamp-opportunities-first — assumption
- **Mistake**: The Strategies screen's header/stat-tile "N active" count double-counted paused strategies, because it was not using the same `active && live_enabled` derivation the per-row State badge used — a status derived from two independent boolean fields was computed separately on three rendering surfaces (header, stat tile, per-row badges) and drifted apart silently. Fixed by aligning all three surfaces on one derivation.
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md:571-579`, "Handoff-fidelity — second review pass" session.
- **Rule it implies**: a status derived from more than one independent field must be centralized in one place (a shared selector/helper), never recomputed per rendering surface — recomputing invites silent drift between surfaces.

### 2026-08-06 — ui-revamp-opportunities-first — assumption
- **Mistake**: Assumed the Playwright e2e **global-setup preflight** chromium launch would honor the same `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override already used by the chromium *project* config in `playwright.config.ts` — it didn't, silently failing e2e only in environments (sandboxes) where the pinned Playwright browser build differs from the pre-installed one (a no-op in CI, where the pinned build matches).
- **Evidence**: `docs/roadmap/features/083-ui-revamp-opportunities-first/context.md` 2026-08-02 session ("Test-infra fix (needed to run e2e in this sandbox)"); `services/xstockstrat-ui/e2e/global-setup.ts`.
- **Rule it implies**: when a test-runner config exposes an env-var override in more than one place (project config + global setup/preflight), verify both paths honor it together — a partial override is a silent, environment-dependent test failure, not a loud one.

### 2026-08-07 — watchlist-screen-improvements — design
- **Mistake**: An un-keyed master-detail component with per-piece local state (a strategy picker's selected value, an inline-rename draft) silently carries that state across a list-item switch, because switching selection re-renders the same component instance rather than remounting it. The design debate rediscovered this same leak twice for two different pieces of local state, each time patched with its own hand-rolled `key`-scoped wrapper subcomponent, before recognizing the pattern and closing the whole class in one step (`key={selected.id}` on the parent).
- **Evidence**: `docs/roadmap/features/110-watchlist-screen-improvements/design.md` § Chosen Approach point 4, § Rejected Alternatives (per-piece-of-state keyed subcomponents); `docs/roadmap/features/110-watchlist-screen-improvements/context.md` sdd-design session (rounds 3-5 summary).
- **Rule it implies**: when designing a master-detail UI where the detail pane holds any local state (an in-progress edit, a picker selection, a draft), key the detail component on the selected item's id from the start — don't wait for the leak to surface once per state variable. Verify the remount's cost against the app's actual query `staleTime`/cache config before assuming a whole-component key is too expensive; a componentized fix for each symptom is a sign the systemic fix (the outer key) was skipped.

### 2026-08-07 — exit-cooldown — design
- **Mistake**: A 6-round adversarial design debate specified a new upsert method
  (`upsert_entry`) that INSERTs a subset of a table's columns ("touching only the `last_entry_at`
  column") without ever tracing that INSERT against the table's actual `NOT NULL` constraints on
  the OTHER columns. `analysis.strategy_cooldowns.last_exit_at` was `NOT NULL` (migration 009,
  safe when the only writer always supplied a real timestamp) — `upsert_entry` can now INSERT a
  brand-new row for a pair that has never exited (a boot-time backfill, or a live entry with no
  prior exit history), which PostgreSQL rejects outright. Six rounds of architectural debate
  (bar-replay windows, boot-time backfill races, alert suppression) never surfaced this because
  the debate operated entirely at the design-prose level ("touching only X column") without
  re-deriving the actual `INSERT` statement's full column list against the schema.
- **Evidence**: `docs/roadmap/features/116-exit-cooldown/implementation-spec.md` Deviation Log,
  "Step 4"; `services/xstockstrat-analysis/migrations/009_strategy_cooldowns.up.sql:9`
  (`last_exit_at TIMESTAMPTZ NOT NULL`); `012_strategy_cooldowns_last_entry_at.up.sql` (added
  `ALTER COLUMN last_exit_at DROP NOT NULL` mid-Step-4, not part of the original migration
  design).
- **Rule it implies**: when a design adds a new writer (upsert/insert method) to an EXISTING
  table, verify its full `INSERT` column list against every `NOT NULL`/`CHECK` constraint on that
  table — not just the column the writer is described as "touching" — before the design debate
  concludes. A design-prose description of "the SQL only changes column X" is a claim about the
  UPDATE branch of an upsert; the INSERT branch is a different code path with different
  constraints and needs its own check. Same family as the 2026-07-29 (080) "absence claim"
  pattern, applied to schema constraints instead of code assumptions.

### 2026-08-07 — exit-cooldown — test-infra
- **Mistake**: Adding a new cross-cutting state-machine mechanism (bar-replay-on-first-seen-key)
  to an already-tested class silently turned one existing, passing test
  (`test_write_cooldown_failure_never_propagates`) into a false-positive green: the test
  hand-seeded `loop._last_state[key] = True` to represent "already in position" without also
  seeding the new `_replayed` set, so the new replay step ran on an empty bar window, reset
  `in_position` back to `False`, and the exit branch the test claimed to exercise (`upsert_exit`,
  the write-failure path under test) never ran at all. The test still asserted "no exception
  propagates," which trivially held for code that was never reached — it kept passing while
  testing nothing.
- **Evidence**: `docs/roadmap/features/116-exit-cooldown/implementation-spec.md` Deviation Log,
  "Step 10/11" ("pre-existing `TestLiveEvaluationLoopCooldown` tests broke under replay");
  `services/xstockstrat-analysis/tests/test_live_loop.py::TestLiveEvaluationLoopCooldown::test_write_cooldown_failure_never_propagates`
  (fix added `repo.upsert_exit.assert_awaited_once()`).
- **Rule it implies**: when a test seeds mock/fixture state to represent an *outcome* of a prior
  code path (e.g. `_last_state[key] = True` standing in for "replay already resolved this key"),
  adding new state-producing machinery upstream of that outcome (a replay step, a hydration step)
  can silently short-circuit the path the test exists to cover. A test whose seeded state
  represents an outcome rather than a cause is fragile to exactly this kind of change — prefer
  seeding the actual precondition state (here, `_replayed.add(key)`) so new upstream logic can't
  quietly bypass the assertion, and add a positive "the thing under test actually ran"
  assertion (a mock call-count check) alongside any negative "no exception" assertion so a
  silent bypass fails loudly instead of passing vacuously.

### 2026-08-08 — screener-data-readiness-polling — design
- **Mistake**: a design proposal for a Screener recheck/polling feature narrowed the recheck
  request to only the still-pending symbols to save quota — the same bug class as the
  `fix-mcp-screener-correctness` entry above (`coverage_gaps` computed after truncation), just
  relocated from server-side rank/floor truncation to client-side symbol narrowing. Any
  universe-relative diagnostic (here, `_normalize_universe`'s min-max score, `screener.py:388-416`)
  silently breaks when computed from a truncated/narrowed subset instead of the original full
  scan — in the common one-symbol-still-pending case, `lo == hi` for every criterion and every
  score collapses to a content-free `0.5`. Caught by the design-adversary before implementation,
  not by a later test or review.
- **Evidence**: `docs/roadmap/features/118-screener-data-readiness-polling/design.md` §
  Chosen Approach / Rejected Alternatives; the design-adversary's round-1 objection (context.md
  "sdd-design (quick)" session).
- **Rule it implies**: this generalizes the `fix-mcp-screener-correctness` rule beyond
  truncation specifically — **any value computed relative to a result set's full membership**
  (universe-relative normalization, cross-row ranking, a percentile, a min/max) must be
  recomputed from the *original* full set whenever a "just re-check a subset" optimization is
  proposed, not from the subset alone, regardless of which layer (server truncation vs. client
  narrowing) does the subsetting. Worth promoting to a Constitution ID if this recurs a third
  time in a different feature.

### 2026-08-08 — screener-data-readiness-polling — execute (Step 2)
- **Mistake**: a `useEffect` meant to fire "once per poll attempt" was keyed on
  `[poll.data, poll.error]` (a TanStack `useQuery` result's data/error fields) instead of
  `[poll.dataUpdatedAt, poll.errorUpdatedAt]`. TanStack Query's structural sharing reuses the
  previous `data` object reference when a new response is deeply equal to the last one — and for
  this feature that's the *normal* case, not an edge case: a still-pending row comes back
  byte-identical on every 60s retry until the underlying data resolves. The effect fired once on
  the first response and then never again for identical-valued retries, freezing the page-level
  attempt counter at 1 forever, even though the query's own internal counter (used inside
  `refetchInterval`) correctly kept incrementing and correctly stopped polling at the cap. Net
  effect: the UI silently claimed "Checking… attempt 1 of 5" forever instead of ever showing
  "Gave up" — a dishonest-status bug in a feature whose entire purpose is honest status. Caught by
  actually running the (not-yet-committed) Step 3 Playwright suite against the real
  implementation as the TDD-gate green run, not by design review or a code read.
- **Evidence**: `docs/roadmap/features/118-screener-data-readiness-polling/implementation-spec.md`
  Deviation Log, "Step 2"; `services/xstockstrat-ui/src/app/insights/screener/page.tsx` (the fixed
  `useEffect`); `e2e/insights/screener.spec.ts`'s two cap-exhaustion tests.
- **Rule it implies**: any effect (or other reference-identity-keyed logic) that must fire once
  **per fetch attempt** on a TanStack `useQuery`/`useInfiniteQuery` result must key on a
  timestamp field (`dataUpdatedAt`/`errorUpdatedAt`) or an explicit counter
  (`dataUpdateCount`/`errorUpdateCount`), never on `data`/`error` object identity — structural
  sharing collapses identical-valued responses to the same reference by design, and "the response
  didn't change" is often the expected, repeated case for a polling/recheck feature, not a rare
  one. A design or spec review reading the hook code in isolation is unlikely to catch this
  because the bug only manifests when a real request/response round-trip actually happens with
  repeated identical payloads — it requires exercising the real behavior, not just reading the
  wiring.

### 2026-08-09 — shadcn-migration-medium-confidence — execute (Step 17)
- **Mistake**: `design.md` (§ Round 3 override, FR-13) assumed a not-yet-installed shadcn
  primitive's polymorphic-slot API — `NavigationMenuLink render={<Link href="..." />}` — by pattern
  -matching this codebase's `combobox.tsx`, which is a **Base UI** (`@base-ui/react`) compound
  component using the newer `render`-prop convention. `navigation-menu.tsx` is not Base UI: the
  `radix-ui` unified npm package's `navigation-menu` entrypoint is a 3-line re-export of
  `@radix-ui/react-navigation-menu@1.2.22`, which is the **classic** Radix Primitives API —
  `forwardRef`-built, `asChild`-based, zero `render` occurrences anywhere in its compiled source.
  `design.md` itself had already flagged this exact pairing as "not independently confirmed for
  `navigation-menu.tsx` specifically" (a real, useful hedge — recon.md's live `WebFetch` against
  shadcn's docs confirmed *standalone Link usage* but never checked *which prop API* backs it), and
  the implementation-spec's Step 17 instructed verifying it against the CLI-generated file before
  use — which is what caught it before any wiring was written on the wrong assumption.
- **Evidence**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/context.md` Step 17;
  `node_modules/.pnpm/@radix-ui+react-navigation-menu@1.2.22.../dist/index.mjs:372,804` (`forwardRef`
  + `var Link = NavigationMenuLink`); `services/xstockstrat-ui/src/components/shared/
  PlatformHeader.tsx`'s Step 18 `asChild` usage.
- **Rule it implies**: in a shadcn-CLI-based codebase mixing two component families (this app has
  both classic Radix primitives like `select.tsx`/`dialog.tsx` and Base UI compounds like
  `combobox.tsx`/`input-group.tsx`), never assume a not-yet-installed primitive's polymorphic-render
  API from a sibling primitive already in the codebase — the two families use different prop names
  (`asChild` vs `render`) for the same concept, and picking the wrong one silently fails at runtime
  (the child never actually renders as the intended element) rather than at compile time in most
  cases. Confirm the prop against the actual installed package (or the CLI-generated file, once
  added) before writing call-site code, exactly as this step's own instructions already required —
  the win here was following that instruction, not skipping it under time pressure.

### 2026-08-10 — unified-symbol-page — design
- **Mistake**: A design that **consolidates several existing per-entity pages into one** inherited
  the narrowest source page's existence-gate as the gate for the *entire consolidated page* — round
  1–3 of the debate kept `/trader/positions/[symbol]`'s original all-or-nothing pattern (no position
  found → render only an `EmptyState`, stop) without questioning it, even though the whole point of
  the new sections being added (Opportunity/Readiness/Fundamentals/Screening/Backtests/Backfill) was
  to serve symbols the user does **not** hold — exactly the case the inherited gate excludes. Three
  rounds of otherwise-rigorous adversarial review (each catching real, unrelated defects) missed
  this because each was scoped to reviewing *changes* to the proposal, not re-deriving the page's
  reachability from the product spec's own Problem Statement. Only round 4's adversary, prompted to
  re-check reachability specifically, caught that the feature's headline content would be
  unreachable for its stated primary audience.
- **Evidence**: `docs/roadmap/features/125-unified-symbol-page/design.md` § Chosen Approach ("Page
  structure — sections gate independently of position existence"), § Rejected Alternatives ("096's
  original all-or-nothing position gate"); `context.md` § Session 2026-08-10 (sdd-design), round 4.
- **Rule it implies**: when a design **reuses an existing page as the base for a consolidation
  feature**, explicitly re-derive which of the base page's existing conditional-render gates still
  make sense once new, differently-scoped sections are added — an entity-existence gate (position
  found/not-found) that was correct for the base page's original narrower purpose can silently
  exclude a *new* section's entire intended audience. A design round should ask "does every new
  section render for the audience its own FR describes, independent of the base page's original
  gate?" as a named check, not rely on catching it incidentally during an unrelated objection pass.

### 2026-08-10 — unified-symbol-page — assumption
- **Mistake**: Within a single design debate, an unverified claim survived from one round into the
  next **twice**, each time used to justify a real architectural decision before being caught by the
  following round's adversary: (1) round 1 proposed reusing `ScreenResult.gap`/`criterion_scores` as
  a "safe" single-symbol screening mitigation without checking those fields actually existed or
  carried the claimed meaning — both were wrong (`gap` is an unrelated backfill date-range;
  `criterion_scores` is fed by the exact broken normalization the mitigation claimed to avoid); (2)
  round 3 justified adopting cross-segment BFF-client reuse partly by citing "`listBacktests` is
  already dual-registered in both `traderBff.ts` and `insightsBff.ts`" as precedent — grep-verified
  false in round 3's own adversary pass (`listBacktests` exists only in `insightsBff.ts`). Both
  false claims were internally generated by the debate's own proposer role (not carried in from
  recon or the product spec), and both survived exactly one round before a dedicated adversarial
  re-verification pass caught them — the debate protocol's structure (adversary attacks the
  proposal, not just the objections) is what caught it, but the claims themselves originated inside
  the "trusted" synthesis a proposer round produces.
- **Evidence**: `docs/roadmap/features/125-unified-symbol-page/design.md` § Rejected Alternatives
  ("Reusing `ScreenResult.gap`/`criterion_scores`..."); `context.md` § Session 2026-08-10
  (sdd-design), round 1→2 and round 2→3 transitions.
- **Rule it implies**: extends the recurring "verify a claim against the actual codebase before
  treating it as ground truth" family (2026-07-27/072, 2026-07-30/080, 2026-08-06/mcp-config-
  management) into the design-debate protocol itself — a proposer round's own citations are not
  exempt from verification just because they originated inside the "trusted" design process rather
  than from an external source; each adversary round should spot-check at least one load-bearing
  factual claim from the *current* proposal against the actual code, not only attack the proposal's
  architecture-level reasoning.

### 2026-08-09 — shadcn-migration-medium-confidence — execute (Steps 26-27)
- **Mistake**: `implementation-spec.md`'s Step 26 gave a literal code sample wrapping a set of
  full-page-navigation `<Link>`s in `Tabs`/`TabsList`/`TabsTrigger asChild` (`config-ui/page.tsx`'s
  ENV/MODE switcher) to reproduce a segmented-control look. This compiled and looked identical
  visually, but `@radix-ui/react-tabs@1.1.21`'s `TabsTrigger` hardcodes `role: "tab"` on its own
  element (`index.mjs:114`); with `asChild`, Radix's Slot merges that explicit role onto the child
  `<Link>`, overriding its implicit `role="link"` (an explicit ARIA role always wins over an
  implicit one). `e2e/config-ui/env-mode-switcher.spec.ts`'s `getByRole('link', ...)` assertions
  — all correctly written against the pre-migration DOM — failed 4/4 outright (not flaky, not
  timing — "element(s) not found"), because the actual accessible role had silently become "tab".
  Caught only by actually running the e2e suite against the real change (mandated by this step's
  own TDD note: "expected-pass... run unmodified first and record the actual result, don't assume"),
  not by reading `tabs.tsx`'s wrapper code or the shadcn docs, which don't surface Radix's internal
  role hardcoding.
- **Evidence**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/context.md` Steps
  26-27; `node_modules/.pnpm/@radix-ui+react-tabs@1.1.21.../dist/index.mjs:114`
  (`role: "tab"`); `services/xstockstrat-ui/src/app/config-ui/page.tsx`'s reverted markup + inline
  comment.
- **Rule it implies**: a shadcn/Radix primitive whose whole purpose is to express a specific ARIA
  role (`Tabs`→`role="tab"`, `RadioGroup`→`role="radio"`, etc.) will **assert that role on its
  trigger element regardless of `asChild`**, because the role is the primitive's entire semantic
  contract, not an incidental style choice. Wrapping a control in one of these primitives is safe
  only when the control's real interaction model matches that role (client-side panel/option
  switching) — if the control actually does something else (a full navigation, an arbitrary async
  action), styling it to *look* like a tab/radio/etc. via CSS on the plain underlying element (as
  the pre-migration code did) is correct; reaching for the ARIA-role-bearing primitive is not a
  safe "just for the styling" substitution, even though it compiles cleanly and passes a build. This
  generalizes the render-vs-asChild lesson above: verify a primitive's *behavioral* contract against
  the actual use case, not just its *prop* API, before adopting it for a styling-only motive.

### 2026-08-10 — shadcn-sidebar-visual-rewrite — assumption
- **Mistake**: A `test` step's Verification section assumed a local Playwright red-before-green run
  against `pnpm dev` was practical in the execute sandbox. It wasn't: `xstockstrat-ui`'s dev-mode
  on-demand compiler took **88.6s to compile a single route** (`/config-ui/sources`, 13,610
  modules) on first hit in this sandbox, and `warmup.setup.ts` pre-warms 21 routes — Next.js
  compiles them serially regardless of the test's own `Promise.allSettled` parallel fetch, so the
  warmup step alone would need many minutes just to reach the point where the actual test's
  assertions could run. Confirmed via `ps`/CPU inspection this is genuine compile slowness (4 CPU /
  15GB available, `next-server` pegged near 100% CPU), not a hang or a defect in the feature's code.
  Fell back to the documented `tsc --noEmit` + `pnpm run lint` + `playwright test --list` substitute
  (`reference/sequential-mode.md`'s pre-authorized Playwright fallback) — sound for type/lint/
  test-registration confidence, but genuinely does **not** verify any runtime DOM/CSS/ARIA behavior
  (chevron rotation, `data-state` transitions, new element presence). Real verification only happens
  once CI runs the suite against a **production** bundle (`pnpm build && pnpm start` — no on-demand
  compilation), per `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/implementation-spec.md`
  Deviation Log, Step 3.
- **Evidence**: `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/implementation-spec.md` §
  Deviation Log (Step 3); `context.md` session `sdd-execute (sequential)` step-loop entry.
- **Rule it implies**: this generalizes the `fails.md` 2026-08-05 `frontend-reverse-proxy` sandbox-
  capability-gap pattern (there: Docker unavailable) to a second, distinct axis — **the execute
  sandbox's Next.js dev-mode compiler is too slow for a full `pnpm dev`-backed Playwright run**, not
  just occasionally unavailable. A `xstockstrat-ui` `test`-step spec should not assume a live
  dev-server e2e run will complete inside a normal step's time budget; plan for the `tsc --noEmit` +
  `pnpm run lint` + `--list` fallback as the *expected* sandbox outcome for now, and treat the
  integration PR's CI run (production bundle, not dev-mode) as the actual first red/green signal —
  not something to silently skip mentioning when the sandbox happens to cooperate on a smaller spec.

### 2026-08-10 — shadcn-sidebar-visual-rewrite — assumption (corrects the entry immediately above, same session)
- **Mistake**: the entry directly above concluded a live-browser red-before-green run was
  impractical in this sandbox and fell back to `tsc`/`lint`/`--list` only. That conclusion was
  **too pessimistic** — it generalized from the *full* `warmup.setup.ts` (21 routes, serially
  compiled, ~90s each in the worst case) to "any live e2e run is impractical here," when the real
  constraint is narrower: **only the untargeted, full-suite warmup is impractical**. A *scoped* run
  — `playwright test <file> --project=chromium --no-deps` (skips the `setup` project's 21-route
  dependency entirely) plus manually pre-warming just the 1-2 routes the target spec actually
  visits (a plain `curl` with a hand-signed test JWT cookie, ~10-30s per route on first hit) — is
  fully practical and completed a genuine RED (3 real failures, right reasons) then GREEN (9/9
  pass) cycle in well under a minute once warm. The step was re-verified this way and marked `done`
  on the real result, not the fallback.
- **Evidence**: same feature's `implementation-spec.md` § Deviation Log, Step 3 (updated with the
  corrected narrative); `context.md` Step 3 entry.
- **Rule it implies**: before concluding "this sandbox can't run Playwright e2e for this
  `xstockstrat-ui` feature," try the narrow path first: `--project=chromium --no-deps` to skip
  `warmup.setup.ts`'s full route sweep, plus a manual `curl`-with-signed-JWT pre-warm of only the
  specific route(s) the target spec visits. Reserve the `tsc`+`lint`+`--list` fallback for when
  even that scoped, pre-warmed run still times out — not as the first resort the moment the full
  suite is slow.

### 2026-08-10 — shadcn-sidebar-visual-rewrite — assumption
- **Mistake**: a Playwright assertion checking a Tailwind `rotate-90` utility's effect via
  `expect(locator).toHaveCSS('transform', ...)` silently and consistently read `"none"` in both the
  pre- and post-toggle state — not because the CSS rule wasn't applied, but because **Tailwind v4's
  bare `rotate-*`/`scale-*`/`translate-*` utilities set the standalone CSS `rotate`/`scale`/
  `translate` property directly**, not the composed `transform` property, unless the separate
  `.transform` utility class is also present to fold them in (confirmed by reading the generated
  stylesheet rule directly: `.group-data-[state=open]/menu-button:rotate-90:is(:where(.group/
  menu-button)[data-state="open"] *) { rotate: 90deg; }` — no `transform` property anywhere in that
  rule). The class list and `data-state` attribute were both correct at every step; only the test's
  chosen CSS property to inspect was wrong, which read as a false implementation bug until the
  actual generated CSS was inspected directly (`document.styleSheets` + `getComputedStyle().rotate`).
- **Evidence**: `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/implementation-spec.md` §
  Deviation Log, Step 3; `services/xstockstrat-ui/e2e/mobile-sidebar.spec.ts`'s chevron test
  (`toHaveCSS('rotate', ...)`, not `'transform'`).
- **Rule it implies**: in this codebase (Tailwind v4), a Playwright/e2e assertion verifying a bare
  rotate/scale/translate utility's effect must check `getComputedStyle`'s own `rotate`/`scale`/
  `translate` property, not `transform` — `transform` only reflects these utilities when the
  element *also* carries the `.transform` class. When a rotation/scale assertion mysteriously stays
  "none"/unset on both sides of a toggle, inspect the actual generated stylesheet rule
  (`document.styleSheets`) before assuming the underlying app code is broken.

### 2026-08-10 — shadcn-sidebar-visual-rewrite — assumption
- **Mistake**: a 3-round design debate (feature 126) approved an implementation of shadcn's
  "Collapsible SidebarMenu" pattern that verified its **visual styling** against the reference
  (`ui.shadcn.com/docs/components/sidebar`) but never checked the reference's **actual DOM
  composition**. The result omitted the `SidebarMenu`/`SidebarMenuItem` wrapper shadcn's own
  pattern always includes, and reused an unrelated `group/menu-button` name for the chevron's
  scope instead of the reference's own `group/collapsible`. Neither `design-proposer` nor
  `design-adversary` fetched the live shadcn docs page in any round — all cited evidence was
  `recon.md`'s codebase citations, which by construction can only describe the *consuming*
  codebase, never the external reference it's supposed to match. The gap surfaced only when the
  user compared a rendered screenshot against the real reference page after implementation.
- **Evidence**: `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/design.md` § ADDENDUM
  2026-08-10; `context.md` post-checkpoint session entries.
- **Rule it implies**: when a feature's explicit acceptance criterion is "match an external
  reference" (a live docs page, a design system, another product's UI), the design-phase debate
  must ground at least one round's evidence in the **actual reference itself** — a live fetch of
  its real markup/composition, not just its rendered visual description — not only in this
  codebase's own `recon.md` citations. `recon.md` can prove what *our* code does; it can never
  prove what the *reference* does. A future `/sdd-design` round debating an external-reference-match
  feature should include a `WebFetch`/reference-inspection step in Phase 0 Recon, not defer that
  check to a human eyeballing a screenshot after the code already shipped.

### 2026-08-13 — fundamentals-provider-alternative — assumption
- **Mistake**: The design-proposer's first-round approach for swapping a provider behind an
  existing interface (`source.FundamentalsSource`, feature 059's FMP integration) framed the change
  as "add a new client + point construction at it," and its own "PROTO" section correctly caught 3
  provider-named doc-comments needing a text edit — but the proposal never extended that same
  literal-string audit to the *service code itself*: 7 live config-key reads
  (`"marketdata.fmp.enabled"` etc.) plus provider-named error text, alert title/body, and comments
  scattered across `marketdata_service.go`/`main.go` and their tests all reference the old provider
  by name. Left unaddressed, a subsequent "remove the old provider" migration would delete the old
  provider's config rows while the code kept reading the old literal key name — silently disabling
  the feature (config falls through to its Go-coded `false` default) rather than erroring loudly.
  Caught only by the design-adversary explicitly re-reading the cited service-code line ranges
  recon.md had already surfaced, not by the proposer that first drafted the change.
- **Evidence**: `docs/roadmap/features/129-fundamentals-provider-alternative/design.md` § Chosen
  Approach ("Mandatory scope correction" — full list of literal-string sites);
  `context.md` § Session 2026-08-13 — sdd-design (quick), Phase 1 Grilling bullet.
- **Rule it implies**: extends the 2026-07-30 "reinforces C-10(b) — every read path" family — when
  a design swaps *which* provider/backend/implementation serves an existing interface, grep for
  every literal reference to the *old* provider's name across the touched service (config-key
  strings, error/alert text, log messages, comments), not just its primary construction/registration
  site — a provider swap is not done until every string that names the old provider is either
  removed or made provider-agnostic. `recon.md`'s per-line config-read citations are exactly the
  evidence to re-check for this before approving a "replace provider X" design.

### 2026-08-13 — fundamentals-provider-alternative — assumption
- **Mistake**: `/sdd-spec` wrote Step 12's Instructions to require exercising a **fully deployed**
  `xstockstrat-marketdata` instance via `grpcurl` (TimescaleDB + xstockstrat-config + ledger +
  notify all running, `SetConfig` applied, `GetFundamentalsMulti` called against the real
  service) to close product-spec's AC-3. This is an anti-pattern for a spec'd verification step,
  independent of any one environment's limits: it directly contradicts the very insight the step's
  own Codebase Evidence cited as its justification for staying manual
  (`docs/roadmap/ledger/insights.md` 2026-07-30 `082-fix-fmp-config-boot-only` — "compose the proof
  from narrower unit facts plus one written, inspectable argument" instead of a fragile/
  disproportionate live-network end-to-end test). A full-stack deployed-instance smoke test is
  exactly that kind of fragile dependency, just moved from CI to a "manual" step instead of being
  designed away — it requires Docker/DB access most execution environments (including this
  session's sandbox) don't have, and it duplicates what two much narrower checks already prove:
  (a) a direct live call to the *external* API confirms the real data shape/units (what actually
  closed both of design.md's Open Risks here), and (b) the existing fake-backed unit tests
  (Steps 3, 6 — 15 passing tests) already prove the RPC/cache/quota-guard wiring is correct. The
  full-stack layer in between is thin, mechanical wiring the other two checks already cover
  end-to-end in substance, not just in form. The step was still marked `done` here, but only after
  an explicit escalation and a user sign-off accepting the narrower evidence — the spec itself
  should not have required the fragile path as its primary instruction in the first place.
- **Evidence**: `docs/roadmap/features/129-fundamentals-provider-alternative/implementation-spec.md`
  Step 12 Instructions (the `grpcurl`-against-deployed-instance requirement, citing the 082 insight
  in its own Codebase Evidence without fully applying its rule); `context.md` § Session
  2026-08-13 — sdd-execute (sequential), "Step 12 AC-3 smoke test" (the scope-constraint finding,
  the substituted live-API verification, and the `AskUserQuestion` closure).
- **Rule it implies**: extends the 082 insight from "keep a fragile live-network test out of CI"
  to "don't spec a fragile live-network test at all, even as a manual step" — when `/sdd-spec`
  writes an acceptance-criterion-closing verification step for "does this correctly integrate with
  a live external API," default to the **narrowest** live check that actually closes the risk (a
  direct call to the external API/service itself, e.g. via `curl`/the client library in isolation)
  rather than routing it through a fully deployed internal instance. A full-stack smoke test
  belongs to deployment/rollout verification (`docs/runbooks/config-rollout.md`'s gradual
  enablement), not to the implementation spec's own step list, unless the executing environment is
  *known* to have Docker/DB access — which cannot be assumed for every `/sdd-execute` session.

### 2026-08-13 — fundamentals-provider-alternative — scope-creep
- **Mistake**: Step 7's Codebase Evidence and Instructions scoped `FINNHUB_API_KEY`'s deployment
  wiring to exactly the 3 files FMP's own precedent visibly touches —
  `docker-compose.yml`/`.do/app.dev.yaml`/`.do/app.yaml` — because those were the files recon/spec
  actually grepped and cited. That's an incomplete picture of how a vendor credential reaches a
  running service: five more files carry the same key from GitHub Secrets through the deploy
  pipeline (`.github/workflows/deploy.yml`'s reusable `secrets:` input + substitution logic,
  `deploy-dev.yml`/`deploy-prod.yml`'s per-environment secret passthrough,
  `scripts/do-inject-prod-secrets.py`'s prod-recreate injection list used by `prod-up.yml`) plus
  two docs files (`docs/setup/digitalocean.md`'s GitHub Actions secrets table,
  `docs/runbooks/infra-cost-reduction.md`'s prod bring-up secret list) — none of which were in
  Step 7's `**Files**` or cited as Codebase Evidence, so none were touched. The feature merged
  code-completed with a real gap: pushing to `main-dev`/`main` would deploy with
  `FINNHUB_API_KEY` silently empty on every environment, because nothing in CI ever reads a
  `DEV_FINNHUB_API_KEY`/`PROD_FINNHUB_API_KEY` GitHub Secret into it. Caught only by the user
  after the integration PR was already open, not by any review gate — `/sdd-review impl-spec`'s
  overlap/criteria passes don't check "does every file that touched the *previous* instance of
  this pattern get touched again," and recon's own citation search stopped at the files the spec's
  own Instructions happened to name.
- **Evidence**: `docs/roadmap/features/129-fundamentals-provider-alternative/implementation-spec.md`
  Step 7 (`**Files**` list — only 5 entries, 3 of them deployment files, missing all deploy-workflow
  and injection-script files); the fix commit adding `FINNHUB_API_KEY` to
  `.github/workflows/{deploy,deploy-dev,deploy-prod,prod-up}.yml` and
  `scripts/do-inject-prod-secrets.py`; the new `docs/runbooks/add-data-source.md` § "Wiring a New
  Vendor Credential Through Deploy" checklist this mistake prompted.
- **Rule it implies**: when a design/spec step introduces a new vendor credential env var by
  mirroring an existing one's `.do/*.yaml`/`docker-compose.yml` wiring, recon must also grep for
  every other file that references the *existing* credential's name across the whole repo
  (`grep -rn FMP_API_KEY .` would have surfaced all 8 sites immediately, not just the 3 the spec's
  Instructions happened to already know about) — a credential is not "wired" until every file that
  carries its sibling credential from GitHub Secrets to the running container is updated in
  parallel. `docs/runbooks/add-data-source.md`'s new checklist section is the durable fix: future
  features get all 10 files (8 wiring + 2 docs) named up front instead of rediscovering them one
  broken deploy at a time.

### 2026-08-14 — strategy-user-ownership — assumption
- **Mistake**: across a 5-round design debate, every round's proposal contained at least one
  "already handles this"/"fully closed"/"the other three already accept X" claim that the very next
  adversary pass (or an extra verification pass) disproved by direct code read — `set_live_enabled`
  was claimed fixed but its SQL write kept a bare `WHERE strategy_id = $1` (no `user_id`); trading
  was claimed to "already enforce its own user_id-based authorization" when an already-recorded,
  open finding (TRADING-N1) says the opposite; `run_backtest` was claimed to already have a
  `ctx: Context` param (recon's own claim) when it didn't; a "no other consumer besides X" claim
  missed a second BFF call site (`traderBff.ts`) twice, for two different RPCs, in two different
  rounds.
- **Evidence**: `docs/roadmap/features/133-strategy-user-ownership/context.md` Session
  2026-08-14T06:00:00Z (full round-by-round breakdown); `services/xstockstrat-analysis/app/
  repositories/strategies.py:109-120`; `services/xstockstrat-trading/docs/
  context-constitution-findings.md:36`; `services/xstockstrat-agent/app/tools.py:378-384`.
- **Rule it implies**: a closure claim inside a design debate ("this fixes it," "already handles
  it," "no other consumer") is exactly as unverified as a closure claim in an implementation step —
  the adversary must re-grep every such claim in the SAME round it's made, not accept a proposer's
  self-report as evidence. This recurred 4+ times in one debate despite each prior instance being
  caught; treat "the proposer says X is closed" as a hypothesis to disprove, every round, not a fact
  once established in an earlier round.

- **A new proto field on a shared message breaks the agent's descriptor-parity projection test** — `xstockstrat-agent` `list_signal_sources` (and the backtest view) hand-project every field of a proto message and guard it with a `set(DESCRIPTOR.fields_by_name)` parity test. Adding a field to `ingest.SignalSource` / any such message without updating the agent projection fails CI at `test_*_projection.py`. When a `/sdd-spec` C-14 consumer scan enumerates surfaces for a proto change, include the agent's parity-guarded projections, not just the UI/BFF. (feature 134 — `reliability_weight` added to `SignalSource`; caught by CI, not the spec.)

- **A feature specced before a security-model feature lands must be re-owner-scoped at execute time** — feature 131 (live-strategy opportunity attribution) was specced before 133 (strategy ownership) merged; its global `list_live_enabled()` would have attributed another user's live strategy to this user's opportunity queue (IDOR) because `_compute_opportunities` became per-user under 133. When the merge order puts a security/ownership feature *before* a feature that reads the same data, re-verify every new cross-entity read is owner-scoped — don't trust the pre-security spec. (feature 131 D-1 — added a `user_id` owner-scope param to `list_live_enabled`.)

- **Removing a UI behavior (a "genuine replace") leaves an e2e that still asserts the removed behavior** — feature 134's FR-4 dropped `useSignalSources`' `analysis.signals.source_weights` config-blob parse (weight moved onto `SignalSource.reliabilityWeight`), but a separate spec (`value-persists-after-save.spec.ts`) still saved that config key and asserted the Sources weight column reflected it. It passed in isolation while the parse existed and only went red in CI once the parse was gone. When a step *removes* a data path a UI reads, grep the whole e2e suite for the removed key/behavior — the coverage for the removed path is a regression to delete, not just the new path to add. (feature 134 — caught by CI on the stacked 131 branch, not by the Step 8/9 UI work.)

### 2026-08-16 — shadcn-datatable-migration — correctness
- **Mistake**: a shared `DataTable` composite's row-click "interactive target" guard used the CSS
  selector `'a, button, [role="button"], [data-row-click-ignore]'` to detect a nested interactive
  element and skip firing `onRowClick`. But the composite *also* puts `role="button"` on the row
  itself (for a11y, when `onRowClick` is set) — so `.closest()` called from *any* click target inside
  the row, including plain non-interactive cell text, walks up and matches the row itself as the
  nearest `[role="button"]` ancestor-or-self. This made the guard return `true` unconditionally for
  every click in every `onRowClick`-enabled row, permanently short-circuiting `onRowClick` — a
  correctness bug shipped in the composite's first commit but invisible for 12 further migration
  steps because none of them happened to use `onRowClick` yet. Only surfaced when the first
  `onRowClick` consumer (the 13th step) exercised the path and its e2e suite failed 5/10 tests.
- **Evidence**: `docs/roadmap/features/135-shadcn-datatable-migration/context.md` Step 13 entry;
  `docs/roadmap/features/135-shadcn-datatable-migration/implementation-spec.md` Deviation Log "Step
  13 — composite `onRowClick` bug"; `services/xstockstrat-ui/src/components/ui/data-table.tsx`
  (`isInteractiveTarget`); confirmed genuine (not flake) via `git stash`/`pop` isolating the pre-fix
  composite and re-running `e2e/insights/backtest-coverage.spec.ts` — same assertion failure every
  time regardless of retries.
- **Rule it implies**: when a shared interaction guard checks "is this target inside an interactive
  ancestor" via a CSS selector, and the *container itself* is also marked with one of the guard's own
  matched roles/attributes for its own accessibility semantics (row gets `role="button"` for
  keyboard activation, guard also matches `[role="button"]`), the guard will self-match the container
  on its very first use — write a test that clicks a genuinely *non-interactive* cell inside an
  `onRowClick`-enabled row and asserts the row handler *does* fire, not just tests proving the guard
  blocks known interactive element types. A composite step's own unit test (Step 2 here) covered only
  the "blocks a nested interactive element" cases, not the "still fires for a plain click" case — the
  gap that let this ship silently through 12 steps before any code path exercised it.

### 2026-08-16 — shadcn-datatable-migration — assumption
- **Mistake**: recon's inventory (FR-1) claimed "15 sites, all four segments" via a full-repo grep,
  but missed `src/components/trader/SymbolScreening.tsx` — a table-rendering component added by a
  sibling feature (125) that merged mid-session, ahead of this feature's execution. The Steps 21-22
  re-spec gate (triggered by that same sibling merge) ran a fresh 3-agent recon pass, but scoped it to
  *re-verifying the already-known 15 sites'* Codebase Evidence against the post-merge tree — not to
  re-running an unbounded full-repo `<table`/`Table`-import grep from scratch. The missed table sat
  inside a *child component* (`SymbolScreening`) imported by a file the re-spec pass did re-check
  (`positions/[symbol]/page.tsx`) — a line-by-line re-read of that one file's own JSX would not have
  surfaced a table one import-hop away. Not found until Step 33's own final AC-1/AC-2 mechanical
  cross-check, the very last step, several steps after the point (Steps 21-22) where re-grounding
  against the sibling merge would have caught it cheaply.
- **Evidence**: `docs/roadmap/features/135-shadcn-datatable-migration/implementation-spec.md` §
  Re-spec Log, "Steps 34-35 added (Step 33's AC-1 sweep found a 16th table)"; the table now migrated
  as Steps 34-35, `src/components/trader/SymbolScreening.tsx`.
- **Rule it implies**: when a re-spec gate fires because a sibling feature merged mid-execution, the
  re-grounding recon must re-run the *original, unbounded* discovery sweep (e.g. the full-repo grep
  that built the inventory in the first place), not just re-verify the previously-found items against
  the new tree state. A merged sibling feature can add wholly new instances of the thing being
  inventoried, not just move the ones already known — re-verification-only recon is blind to that by
  construction. Candidate for a binding note in the re-spec-gate section of `reference/sequential-mode.md`
  (or the `/sdd-design` Phase 0 recon skill) if this recurs on a future feature.

### 2026-08-16 — signal-time-decay — assumptions

- **Mistake**: Assumed that feature scope left the existing `signal_axis` data-model name unchanged; recon falsely concluded that a `decayed_value` column being added to a separate table was the full story. In fact the feature retargeted the entire decay computation to `signal_axis` (created by a prior feature), and the dormant spec-time assumption that "the existing column name is correct" was only caught at execute-time when `signal_axis` was the only write-target in the live schema.
- **Evidence**: `docs/roadmap/features/022-signal-time-decay/context.md` re-spec-gate block; implementation-spec.md Step 1 Deviation Log
- **Rule it implies**: Never assume a column/table name from a product-spec written before a predecessor feature landed; re-verify the live schema during the re-spec gate.

### 2026-08-16 — signal-time-decay — assumptions

- **Mistake**: FR-5 referenced `session_end_seconds` as a config-key suffix without verifying whether the config service's WatchConfig stream delivered an integer or a float. At execute time the spec-time assumption of `int` was wrong — the live service yields a float and the code required an explicit `int()` cast.
- **Evidence**: `docs/roadmap/features/022-signal-time-decay/context.md` Step 3 Deviation Log
- **Rule it implies**: Always verify the Go/Python/Node native type returned for a config key at recon time, not just the human-readable semantics; cast explicitly at the call-site.

### 2026-08-16 — signal-time-decay — assumptions

- **Mistake**: AC-1 stated the arithmetic as `(now - ingested_at) / half_life` without specifying the rounding behavior; the spec-time assumption that Python's `/` returns a float that can be directly compared against `1.0` was correct, but the assumption that `now_utc` should be captured before the `_drain_active_signals` await was wrong — capturing it before the await introduced a systematic undercount for long-lived signal lists. The fix was to capture `now_utc` after the await.
- **Evidence**: `docs/roadmap/features/022-signal-time-decay/context.md` Step 5 Deviation Log
- **Rule it implies**: In async Python, capture the "current time" sentinel after any significant await that might introduce wall-clock drift, not before.

### 2026-08-16 — signal-time-decay — test-coverage

- **Mistake**: The test file for the time-decay kernel was inferred from the module path without verifying whether the file was a new file or an existing partial — a pre-existing test stub with different fixture conventions was found at execute time, requiring fixture reconciliation that the spec hadn't budgeted.
- **Evidence**: `docs/roadmap/features/022-signal-time-decay/context.md` Step 6 Deviation Log
- **Rule it implies**: During /sdd-spec, Glob the test file paths explicitly; never infer test-file existence from module naming alone.

### 2026-08-16 — position-sizing-engine — assumptions

- **Mistake**: The handler-layer risk guard was designed to call `checkPortfolioRisk` before `ApplySizing` to reject zero-lot orders early; but `req.Qty` is 0 before sizing runs, so `orderNotional = 0 × price = 0` — the guard never fired. The correct order is: size first, then risk-check against the computed lot.
- **Evidence**: `docs/roadmap/features/023-position-sizing-engine/context.md` Step 4 Deviation Log; `services/xstockstrat-trading/internal/service/trade_service.go`
- **Rule it implies**: Risk guards that depend on a computed field (qty, notional) must run after the computation step that produces that field.

### 2026-08-16 — position-sizing-engine — assumptions

- **Mistake**: `resolveAccount` was called to find the single account on a single-account deployment, but the resolved account ID was discarded — the downstream call used a hardcoded fallback. The silent discard meant that on multi-account setups the wrong account would be targeted.
- **Evidence**: `docs/roadmap/features/023-position-sizing-engine/context.md` Step 2 Deviation Log
- **Rule it implies**: Any helper that resolves an ID (account, portfolio, strategy) must have its return value threaded through to all downstream calls — discard is never correct.

### 2026-08-16 — position-sizing-engine — assumptions

- **Mistake**: `GetLatestQuote` error handling assumed the error would propagate a structured gRPC status; the actual runtime error was an untyped Go error that caused a nil-pointer dereference two layers up. The spec said "return the gRPC error" without verifying the actual error shape.
- **Evidence**: `docs/roadmap/features/023-position-sizing-engine/context.md` Step 3 Deviation Log
- **Rule it implies**: When wrapping an RPC call that can fail, verify the concrete error type and nil-check the result before dereferencing any fields.

### 2026-08-16 — stop-loss-bracket-orders — assumptions

- **Mistake**: A goroutine spawned to poll fill results could panic if the broker client returned a nil response during a service restart. The spec-time assumption was that the broker client always returned a non-nil response or a non-nil error; the reality is it can return (nil, nil) during a transient.
- **Evidence**: `docs/roadmap/features/030-stop-loss-bracket-orders/context.md` Step 8 Deviation Log
- **Rule it implies**: In Go, goroutines that call external clients must guard against (nil, nil) returns before dereferencing the response.

### 2026-08-16 — stop-loss-bracket-orders — test-coverage

- **Mistake**: Fake gRPC clients in tests used `...interface{}` variadic for the `CallOption` trailing arg; the Go gRPC API requires `...grpc.CallOption`. The mismatch compiled but caused a runtime panic in test setup.
- **Evidence**: `docs/roadmap/features/030-stop-loss-bracket-orders/context.md` Step 9 Deviation Log
- **Rule it implies**: Fake/stub gRPC clients must declare `...grpc.CallOption` (not `...interface{}`) as the variadic trailing argument to match the real interface.

### 2026-08-16 — stop-loss-bracket-orders — assumptions

- **Mistake**: The `pollFills` dedup gate checked only `OrderId` to detect already-processed fills; it needed to also compare `FilledQty` because partial fills share the same `OrderId` and the gate would suppress the second partial-fill event.
- **Evidence**: `docs/roadmap/features/030-stop-loss-bracket-orders/context.md` Step 7 Deviation Log
- **Rule it implies**: Fill-dedup gates must key on (OrderId, FilledQty) — or a composite that captures partial-fill state — not OrderId alone.

### 2026-08-16 — stop-loss-bracket-orders — assumptions

- **Mistake**: The `go.mod` stale-module detection assumed a single-module Go repo; the repo uses a `go.work` workspace and individual services have separate `go.mod` files. Running `go mod tidy` at repo root silently operated on the wrong module.
- **Evidence**: `docs/roadmap/features/030-stop-loss-bracket-orders/context.md` Step 10 Deviation Log
- **Rule it implies**: In a `go.work` workspace, always `cd services/<service> && GOWORK=off go mod tidy` — never `go mod tidy` at repo root.

### 2026-08-16 — position-and-order-detail-pages — ci

- **Mistake**: CI auto-promote silently skipped the feature because the implementation-spec step statuses were not flipped to `done` before the integration PR was merged; the promote script checked step statuses to determine eligibility and saw unfinished steps.
- **Evidence**: `docs/roadmap/features/096-position-and-order-detail-pages/context.md` post-launch block; `/promote` skill step-status gate
- **Rule it implies**: Before opening the integration PR, flip all implementation-spec steps to `done` status — the auto-promote gate checks them, not the feature.md Status History.

### 2026-08-16 — position-and-order-detail-pages — test-coverage

- **Mistake**: The BFF route for the new detail page made a gRPC call that had no mock in the e2e test setup; the Playwright tests passed locally (because a real dev backend was running) but failed in CI (which spins a mock server).
- **Evidence**: `docs/roadmap/features/096-position-and-order-detail-pages/context.md` Step 9 Deviation Log
- **Rule it implies**: Any new BFF gRPC call requires a corresponding mock entry in the e2e mock-server setup — verify the mock map before opening the PR.

### 2026-08-16 — account-trading-halt-and-kill-switch — assumptions

- **Mistake**: The WatchConfig subscriber in `configServiceImpl.ts` had a structural gap: it read `default_value` from the config row instead of `value_data`, so live config overrides were silently ignored by every consumer that used `configServiceImpl` as its watch adapter.
- **Evidence**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/context.md` Step 4 Deviation Log; `services/xstockstrat-config/src/service/configServiceImpl.ts`
- **Rule it implies**: When extending a WatchConfig subscriber, verify it reads `value_data` (the live overridden value), not `default_value`.

### 2026-08-16 — account-trading-halt-and-kill-switch — assumptions

- **Mistake**: A duplicate `:=` in the spec step for the trading-state setter caused a compile error; the spec cited a line number one off from the actual function body after a prior feature had shifted lines, and the duplicate `:=` shadowed an outer variable.
- **Evidence**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/context.md` Step 6 Deviation Log
- **Rule it implies**: After any stacked-branch merge, re-verify all line citations in the remaining unexecuted steps before executing them.

### 2026-08-16 — exactly-once-order-intent — assumptions

- **Mistake**: An insert-before-landmark instruction referenced a function that had moved three lines in the stacked branch, causing the insert to land inside a different function body. The spec's line-number was correct against the base branch but stale against the stacked head.
- **Evidence**: `docs/roadmap/features/101-exactly-once-order-intent/context.md` Step 11 Deviation Log
- **Rule it implies**: In stacked branches, re-verify function-body line numbers at the moment of insertion, not from the spec's base-branch snapshot.

### 2026-08-16 — exactly-once-order-intent — test-coverage

- **Mistake**: Playwright mock-backend state was stored in a module-level `Map` that persisted across test cases in the same suite run; a test that wrote an intent-state transition left residual state that caused the next test's initial-state assertion to fail.
- **Evidence**: `docs/roadmap/features/101-exactly-once-order-intent/context.md` Step 17 Deviation Log; `services/xstockstrat-ui/e2e/`
- **Rule it implies**: Playwright mock-server `Map`/object state must be reset in `beforeEach` (or per-request factory) — module-level mutable state is shared across tests in the same worker.

### 2026-08-16 — broker-state-reconciliation — assumptions

- **Mistake**: Recon concluded "no bulk ListOrders RPC available" by inspecting only the internal Go interface (`BrokerClient`); the Alpaca and IBKR concrete implementations both had a `ListOrders` method that was not surfaced on the interface. The implementation had to add the method to the interface to use it.
- **Evidence**: `docs/roadmap/features/102-broker-state-reconciliation/context.md` re-spec-gate block; `services/xstockstrat-trading/internal/broker/`
- **Rule it implies**: Recon must inspect concrete broker implementations (alpaca.go, ibkr.go), not just the interface definition — the interface may lag the implementations.

### 2026-08-16 — broker-state-reconciliation — test-coverage

- **Mistake**: Playwright proto3 JSON oneof fields were mocked in "server-side `create()`-style wrapped shape" (e.g. `{ orderType: { marketOrder: {} } }`), but the actual BFF serializes proto3 JSON in flattened oneof shape (e.g. `{ "market_order": {} }`). Tests passed locally against the real backend but failed in CI against the mock.
- **Evidence**: `docs/roadmap/features/102-broker-state-reconciliation/context.md` Step 22 Deviation Log
- **Rule it implies**: Playwright mocks for proto3 JSON responses must use the flattened oneof wire shape, not the `create()`-style wrapped shape used by the server-side proto-es library.

### 2026-08-16 — broker-state-reconciliation — assumptions

- **Mistake**: Feature 101's implementation-spec included a ledger event (`order_intent.late_response_conflict`) but omitted the `EmitEvent` call instruction in the execute steps; feature 102's context picked it up as an open item and added the emit — a cross-feature forward reference that never reached the original feature's spec.
- **Evidence**: `docs/roadmap/features/102-broker-state-reconciliation/context.md` Step 20 Deviation Log; `docs/roadmap/features/101-exactly-once-order-intent/implementation-spec.md`
- **Rule it implies**: Every ledger event named in a spec must have a paired `EmitEvent` call in the same feature's execute steps — no silent forward references to sibling features.

### 2026-08-16 — fix-mcp-target-user-authz — assumptions

- **Mistake**: The recon phase audited `emit_alert` and `manage_formula` for caller-supplied identity params but did not check all MCP tool handlers for the same pattern; a third handler (`manage_signal_source`) had a latent copy of the same anti-pattern and was only caught during the design adversary round.
- **Evidence**: `docs/roadmap/features/111-fix-mcp-target-user-authz/context.md` Phase 0 block; `services/xstockstrat-agent/`
- **Rule it implies**: When fixing an auth anti-pattern (caller-supplied identity), grep the entire affected service for all instances of the pattern before scoping the fix — point fixes leave siblings.

### 2026-08-16 — fix-mcp-target-user-authz — assumptions

- **Mistake**: The proto doc comment for `target_user_id` stated "deprecated; use OAuth claims" but was not enforced by any generated validation; a caller that ignored the comment and kept sending the field would silently succeed. The fix required making `broadcast` required (no default), which is a breaking schema change not flagged in the proto review checklist.
- **Evidence**: `docs/roadmap/features/111-fix-mcp-target-user-authz/design.md` §4; `docs/runbooks/mcp-tools.md`
- **Rule it implies**: Proto deprecation comments are advisory only — removing or making a field required is the only enforcement. Account for this as a breaking-change at design time.

### 2026-08-16 — fix-mcp-target-user-authz — test-coverage

- **Mistake**: Defect reports written during the bug-triage phase undercounted the affected callers by one; the test suite for the fixed handler was written against the triage's list, missing a case. The adversary round surfaced the additional case, but the test suite had to be extended after the initial RED phase.
- **Evidence**: `docs/roadmap/features/111-fix-mcp-target-user-authz/context.md` Step 5 Deviation Log
- **Rule it implies**: During `/sdd-spec`, re-derive the affected-callers list from the codebase, never from the triage report's count — triage reports are snapshots and can undercount.

### 2026-08-16 — ingest-signal-dedup — assumptions

- **Mistake**: The design document used `self._config` as a placeholder attribute name for the config client; the actual service attribute is `self._cfg`. The spec carried the placeholder through all 14 steps and the error was caught at execute-time Step 1.
- **Evidence**: `docs/roadmap/features/111-ingest-signal-dedup/context.md` Step 1 Deviation Log; `services/xstockstrat-ingest/app/service.py`
- **Rule it implies**: Attribute names referenced in a design document must be verified against the live service class at `/sdd-spec` time, not assumed from the design author's notation.

### 2026-08-16 — ingest-signal-dedup — test-coverage

- **Mistake**: The blast radius of the mock-shape rewrite (changing how dedup results are returned) was wider than anticipated — 3 additional test files beyond the primary test class required fixture updates, discovered only at the end of the RED-GREEN cycle when the full test run revealed import-time failures.
- **Evidence**: `docs/roadmap/features/111-ingest-signal-dedup/context.md` Step 10 Deviation Log
- **Rule it implies**: Before changing a shared fixture or mock shape, grep for all files that import it — `grep -r "from.*<module> import <symbol>"` — to bound the blast radius before the RED phase.

### 2026-08-16 — watchlist-screen-improvements — assumptions

- **Mistake**: The per-symbol row component's `writeInFlight` boolean was instance-local; when the user switched watchlists the component unmounted and the new instance had a fresh `writeInFlight=false`, so an in-flight mutation on the previous watchlist was invisible to the new pane. The root cause was identified only after a race condition surfaced in e2e.
- **Evidence**: `docs/roadmap/features/112-watchlist-screen-improvements/context.md` R5 block; `services/xstockstrat-ui/src/app/insights/watchlists/`
- **Rule it implies**: Local component state that guards a mutation must be lifted to (or coordinated with) the ancestor that controls component lifecycle when the guarded mutation outlives a single component instance.

### 2026-08-16 — watchlist-screen-improvements — assumptions

- **Mistake**: The `useWatchlists` hook returned a TypeScript interface that did not declare `isFetching`; the concurrency guard needed `isFetching` from that hook, requiring a retroactive widening of the hook's declared return type. The mismatch was not caught at spec time because the spec described the hook's behavior, not its TypeScript signature.
- **Evidence**: `docs/roadmap/features/112-watchlist-screen-improvements/context.md` Step 7 Deviation Log; `services/xstockstrat-ui/src/hooks/useWatchlists.ts`
- **Rule it implies**: When a spec step depends on a hook's field, verify the hook's TypeScript return type exports that field — absence causes a compile error, not a runtime one, and must be caught at spec time.

### 2026-08-16 — watchlist-screen-improvements — assumptions

- **Mistake**: Merging `origin/main-dev` mid-session (to resolve a feature-number collision) caused semantic drift: the flat `strategies` list in `WatchlistDetail.tsx` was split into `allStrategies`/`liveStrategies`/`strategyOptions()` by an unrelated same-day defect fix that landed on `main-dev` after the feature branch was cut. Five steps had to be re-spec'd and six e2e test file references repointed.
- **Evidence**: `docs/roadmap/features/112-watchlist-screen-improvements/context.md` re-spec-gate block (2026-08-07T00:05:00Z)
- **Rule it implies**: When merging main-dev mid-feature, re-run a full recon diff on every touched file before continuing execution — a same-day sibling feature can split a shared data structure and invalidate all downstream step citations.

### 2026-08-16 — daily-bars-only — assumption

- **Mistake**: During `/sdd-design`'s round-2 grilling, the design-proposer subagent proposed shrinking `xstockstrat-ingest`'s and `xstockstrat-agent`'s timeframe alias/lookup tables (`_TF_ALIASES`, `_STR_TO_ENUM`, `_BARS_PER_DAY`) to a literal single entry (`{"1d": "1d"}`) as a DRY fix, framed as "self-evident" and plausible on its face. The round-2 design-adversary caught, by actually grepping the tables and their consumers, that this was concretely wrong: the surviving `"1d"` timeframe has *two* legitimate spellings (`"1d"`, `"1Day"`) that a single-entry table would silently drop, and one of the tables (`_STR_TO_ENUM`) is dual-purposed — it also re-derives `timeframe_enum` for historical/resumed jobs on a read path, not just new-request validation — so shrinking it would have broken 4 existing tests and made every historical `15m`/`1h` job display `timeframe_enum=UNSPECIFIED`. This is the exact same absence/scope-reduction-claim pattern `080-fix-backfill-timeframe-enum` already named in this file (2026-07-29/07-30 entries) — but recurring one layer earlier: inside the design *debate* (an LLM subagent's proposal), not execution or a human-authored spec. The adversarial round caught it before it reached `implementation-spec.md`, which is exactly what the grilling phase exists for — but it demonstrates the trap applies to AI-proposed refactors just as much as human ones.
- **Evidence**: `docs/roadmap/features/143-daily-bars-only/context.md` § Session 2026-08-16 — sdd-design Phase 1; `docs/roadmap/features/143-daily-bars-only/design.md` § Rejected Alternatives ("Shrinking ingest/agent's alias tables to a literal single entry").
- **Rule it implies**: A design-phase claim that narrows or drops entries from an existing lookup table/list must be grep-verified against every consumer of that table (including read/display paths, not just the validation path it's ostensibly about) before being accepted into `design.md` — "single entry" / "just drop X" is exactly the shape of claim `docs/sdd/constitution.md` **C-01**/**P-03** already require evidence for, and the design-adversary role should treat any such claim as guilty until grep-proven innocent, the same way `/sdd-spec` already must.

### 2026-08-16 — fix-config-ui-env — assumptions

- **Mistake**: `APPLICATION_ENV` on the DigitalOcean app platform is set to `"development"` (`.do/app.dev.yaml:26`) while the Config UI's `env` query param and the `xstockstrat-config` DB `environment` CHECK constraint use `"dev"` (`migrations/002_config_environment.up.sql:8`). A naive `APPLICATION_ENV === env` comparison never matches on a dev deployment, silently treating it as non-native.
- **Evidence**: `docs/roadmap/features/115-fix-config-ui-env/context.md` sdd-design session (Open design nuance: "`'development'` → `'dev'` normalization required, mirrors Go hotfix"); `.do/app.dev.yaml:26`; `services/xstockstrat-config/migrations/002_config_environment.up.sql:8`
- **Rule it implies**: When comparing DO `APPLICATION_ENV` against config-schema environment strings, normalize `"development"` → `"dev"` before the comparison — the DO platform vocabulary differs from the DB CHECK constraint vocabulary.

### 2026-08-16 — fix-config-ui-env — assumptions

- **Mistake**: `APPLICATION_ENV` is not a `NEXT_PUBLIC_*` variable and is therefore absent from the client bundle; reading it inside a Client Component returns `undefined` at runtime with no build-time error.
- **Evidence**: `docs/roadmap/features/115-fix-config-ui-env/context.md` Steps 7-8 design rationale (Server Component wrapper required to safely read the variable); `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx`
- **Rule it implies**: Before reading `process.env.X` in a Next.js component, check whether `X` is `NEXT_PUBLIC_*`; non-public variables read in Client Components are `undefined` at runtime — use a Server Component wrapper to pass the value as a prop.

### 2026-08-16 — exit-cooldown — test-coverage

- **Mistake**: The test-helper factory for `xstockstrat-analysis` service tests did not include a stub for `get_int_present` (the config accessor for `exit_cooldown_days`). Tests that exercised the exit-cooldown gate path failed with a missing-stub error, not a logical failure — the gap was not caught at spec time because the factory was audited against the more common `get_string`/`get_float` accessors, not the integer-present variant.
- **Evidence**: `docs/roadmap/features/116-exit-cooldown/context.md` sdd-execute session (get_int_present factory gap discovery); `services/xstockstrat-analysis/tests/` helper factories
- **Rule it implies**: When writing a test-helper factory that stubs a service's config client, enumerate all accessor-method variants the service uses (`get_string`, `get_float`, `get_int`, `get_int_present`, `get_bool`) — omitting a less-common variant surfaces only at runtime, not at spec time.

### 2026-08-16 — screener-fundamental-metric-selector — assumptions

- **Mistake**: `_validate_fundamental_metrics` in `screener.py` was read as validating only the 11-field `_FUNDAMENTAL_FIELDS` constant set. It actually accepts `_FUNDAMENTAL_FIELDS` **union** any keys present in `extra_metrics` observed in the fetched batch. A UI select built from only the 11 constants would reject valid server-observed `extra_metrics` keys at validation time.
- **Evidence**: `docs/roadmap/features/117-screener-fundamental-metric-selector/context.md` sdd-review session (FR-5 wording corrected); `services/xstockstrat-analysis/app/services/screener.py:31-44` (`_validate_fundamental_metrics`)
- **Rule it implies**: When building a UI select from a backend validation function, read the function body, not just its name — a function named `_validate_*` may accept a superset of the named constant set.

### 2026-08-16 — shadcn-migration-low-confidence — scope-creep

- **Mistake**: `ui/alert.tsx` as installed by shadcn ships only two variants (`default` and `destructive`). When `OrderForm.tsx`/`EditOrderDialog.tsx` were migrated to use `Alert` for success messages, the absence of a `success` variant was discovered at execute time — requiring a custom `className` workaround rather than a standard variant call. This gap was not caught at spec time because the spec assumed the installed component covered the needed variants.
- **Evidence**: `docs/roadmap/features/122-shadcn-migration-low-confidence/context.md` sdd-execute Steps 9-12; `services/xstockstrat-ui/src/components/ui/alert.tsx`
- **Rule it implies**: Before migrating a success/error message to `ui/alert.tsx`, verify which variants the installed file exports — the default shadcn Alert has only `default` and `destructive`; a `success` variant requires a manual addition or a custom class workaround.

### 2026-08-16 — shadcn-sidebar-visual-rewrite — assumptions

- **Mistake**: `data-active={isActive}` always renders the `data-active` attribute in the DOM (with value `"false"` when the prop is falsy). Tailwind's bare `data-active:bg-sidebar-accent` variant matches on attribute **presence**, not value — so every nav item was permanently painted with the accent background regardless of state. The fix is `data-active={isActive || undefined}`; `undefined` suppresses attribute rendering. This pattern generalises to any bare `data-*:` Tailwind variant.
- **Evidence**: `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/context.md` post-checkpoint correction; `services/xstockstrat-ui/src/components/ui/sidebar.tsx` (data-active fix)
- **Rule it implies**: For any bare `data-*:` Tailwind variant, use `data-x={value || undefined}` — `{false}` still renders the attribute and activates presence-based variants. Applies to all vendored shadcn primitives using this pattern.

### 2026-08-16 — shadcn-sidebar-visual-rewrite — assumptions

- **Mistake**: Playwright's `fullPage: true` screenshot option extends the capture to the full scroll height of the page; for fixed-position overlays (mobile sidebar, drawers, modals), this makes the overlay appear at the top of a taller-than-viewport image, which visually reads as "not filling the screen" even when it correctly fills the viewport.
- **Evidence**: `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/context.md` post-checkpoint correction investigation (`fullPage: true` artifact, confirmed non-bug via `boundingBox()` measurement); `docs/roadmap/features/126-shadcn-sidebar-visual-rewrite/design.md` ADDENDUM
- **Rule it implies**: For visual verification of fixed-position overlays, use `fullPage: false` (the default) — `fullPage: true` extends to scroll-content below the fold and can misrepresent overlay dimensions relative to the viewport.

### 2026-08-16 — daily-bars-only — assumption

- **Mistake**: Treating a proto enum-value `[deprecated = true]` as a purely "comment-only, non-breaking" change. It IS non-breaking at the buf/wire level (`buf lint`/`buf breaking` pass), but Go's `staticcheck` (SA1019, enabled in every Go service's `.golangci.yml`) flags **every** remaining reference to that value as a lint error — including legitimate ones you must keep. A spec that lists only the *tests whose assertions invert* will miss this, and the failure surfaces two steps later at the Go-lint verification, not at the proto step whose `buf` check is green.
- **Evidence**: `docs/roadmap/features/143-daily-bars-only/implementation-spec.md` Deviation Log D-1; `services/xstockstrat-marketdata/internal/timeframe/timeframe.go:29,31,64,66` (kept, `//nolint:staticcheck` added) — the permissive `GetDataCoverage`/`Delete` resolve path the design deliberately preserves still references the deprecated values.
- **Rule it implies**: When deprecating a proto enum value that has surviving consumers, grep every language's usages up front (`grep -rn "<Enum>_<VALUE>" services --include=*.go` etc.) and plan a `//nolint:staticcheck` (Go) / equivalent suppression at each legitimate remaining site in the *same* PR. "Comment-only at the buf level" ≠ "no consumer edits needed" — the linter consequence is the real blast radius.

### 2026-08-16 — symbol-page-section-nav — assumption

- **Mistake**: Assuming a shadcn/Radix `ToggleGroup` always renders its items as `role="button"`. It depends on `type`: `type="multiple"` → toggle `button`s (`aria-pressed`); `type="single"` → a `role="radiogroup"` of `role="radio"` items (`aria-checked`). Feature 139's recon cited the `insights/opportunities` exemplar's `getByRole('button')` locator as proof — but that group is `type="multiple"`, so the same locator failed for this feature's `type="single"` nav (the nav landmark was found, but `getByRole('button',{name})` matched nothing; the Playwright aria snapshot showed `radiogroup`→`radio "Overview" [checked]`).
- **Evidence**: `docs/roadmap/features/139-symbol-page-section-nav/implementation-spec.md` Deviation Log D-3; `services/xstockstrat-ui/src/components/ui/toggle-group.tsx`; caught by the first GREEN e2e run (fix: `getByRole('radio', …)` + `toBeChecked()`).
- **Rule it implies**: match the e2e locator to the ToggleGroup's `type` — `type="single"` → `getByRole('radio')` + `toBeChecked()`; `type="multiple"` → `getByRole('button')` + `aria-pressed`/`data-state`. Don't reuse a `getByRole('button')` locator from a `type="multiple"` exemplar for a `type="single"` control. A real e2e run (not just build/lint) is what surfaces this.

### 2026-08-17 — symbol-page-section-nav (amendment) — assumptions

- **Mistake**: Two recurring UI-layout traps hit at once when grouping stacked sections into responsive panel clusters (desktop columns / mobile tabbed panel). (1) An `IntersectionObserver` "topmost section intersecting a thin band near the top" scroll-spy silently depends on the page being **taller** than the offset line + the last section — column-grouping shortens the page, so the last section can never scroll under the offset line, and a band observer both fails to highlight it and steals `active` back from a deep-link to it. (2) CSS grid items default to `min-width: auto`, so a wide child (a stat grid / an orders table) forces horizontal page overflow — a block layout doesn't, so the regression appears only after wrapping panels in a `grid`. (3) New mobile-tab labels (`Opportunity`, `Place order`) case-insensitively substring-match existing bare `getByText('…').first()` gates in **sibling** specs; because the `md:hidden` tab bar renders before the columns, `.first()` resolves the hidden tab and fails `toBeVisible` at the desktop viewport.
- **Evidence**: `docs/roadmap/features/139-symbol-page-section-nav/implementation-spec.md` Deviation Log D-5/D-6; `services/xstockstrat-ui/src/components/trader/SymbolSectionNav.tsx` (scroll-spy rewritten to a scroll-position read + bottom-of-page rule), `SymbolPanelGroup.tsx` (`min-w-0` on grid items); `e2e/trader/position-detail.spec.ts:109` + `order-parity.spec.ts:155` (gates scoped to `heading` role / the `<form>` field). All three caught by re-running the **broad** trader+insights+mobile e2e scope, not the changed files' narrow run.
- **Rule it implies**: (a) A band-based `IntersectionObserver` scroll-spy is only correct on a page tall enough to scroll every section (incl. the last) under the offset line; if a layout change can shorten the page, use a scroll-position read ("last section whose top passed the offset line" + an explicit bottom-of-page rule for the final section) instead. (b) Any panel wrapped as a CSS grid item needs `min-w-0` to keep a wide child from causing page overflow (re-check `mobile-overflow.spec.ts` at 390px). (c) A new tab/label string can collide **case-insensitively** with bare `getByText().first()` in sibling specs — grep the label across all specs and scope gates to a role/heading/form, and always re-run the broad e2e scope after adding user-visible labels.

### 2026-08-18 — 140-chart-data-freshness — assumption
- **Mistake**: The feature (and the initial investigation, and design round 1) framed "charts never
  show the latest bars" as an *ingestion-freshness* problem (stale ingester, empty-only live fallback)
  — the true root cause is a **read-path** bug that only surfaced in design round 2: `QueryBars`
  cursors from `start` and returns `ORDER BY time ASC LIMIT pageSize` (`marketdata_repo.go:78,90`), so
  the first page is the **oldest** bars of a window sized `pageSize × interval × 3`
  (`marketdata_service.go:228-238`). Any symbol with more stored `1d` bars than one page renders its
  *oldest* page; the UI fetches only page 1 (ignores `nextToken`). Perfect ingestion would not have
  fixed the symptom. Same "latest ≠ page 1 of an ASC-from-start query" mistake silently mis-fed the
  analysis **screener** (`screener.py:198-206`), which also passes no range and evaluated technicals on
  the oldest ~500 bars. The live loop escaped only because it passes an explicit `_LOOKBACK_DAYS=365`
  range that keeps the bar count under `pageSize`.
- **Evidence**: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:74-91`;
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go:158-178,228-238`;
  `services/xstockstrat-analysis/app/services/screener.py:198-206`; feature 140 design.md § ROOT CAUSE
  / FR-7, context.md round-2.
- **Rule it implies**: when a caller wants "the latest N bars/rows," verify the read actually returns
  the newest N — an `ORDER BY <time> ASC LIMIT N` from a wide default window returns the OLDEST N. For
  a "most-recent" read, order DESC + LIMIT then reverse, or size the window to N; and treat a
  paginated read whose consumer only ever fetches page 1 as a red flag. Before attributing a staleness
  symptom to the *write/ingest* side, confirm the *read* returns what the consumer assumes.

### 2026-08-19 — 146-unify-symbol-chart-libraries — canvas charting rejects oklch tokens
- **Mistake**: Fed theme color tokens (this app's `--chart-*`/`--muted-foreground`/`--border` are
  `oklch(...)`) straight into lightweight-charts (a **canvas** renderer). v5 `createChart`/`addSeries`
  **throws** `Failed to parse color: oklch(...)`, so every chart silently failed to render (no
  `.tv-lightweight-charts`, series never set) — only caught in CI e2e, not by tsc/unit. Worse, the
  first fix attempt (a `getComputedStyle(probe).color` read-back) did NOT convert: **current Chromium
  preserves the color space** in both `getComputedStyle().color` and canvas `fillStyle` serialization,
  returning the oklch string unchanged.
- **Evidence**: `services/xstockstrat-ui/src/lib/chartColors.ts` (feature 146); repro'd with the
  pre-installed Chromium — createChart threw on an oklch textColor; getComputedStyle + fillStyle both
  returned `oklch(...)`; only a **1×1-canvas pixel read-back** (`fillRect` + `getImageData`) yielded
  `rgb()`.
- **Rule it implies**: to hand a CSS custom property to a **canvas** API (charting, `ctx.fillStyle`),
  convert it to `rgb()`/`rgba()` by painting to a 1×1 canvas and reading `getImageData` bytes — do NOT
  trust `getComputedStyle().color` or `fillStyle` read-back to down-convert oklch/oklab/lab. And a
  charting migration that only passes tsc/unit is unverified: run the real browser e2e (prebuilt
  server + the sandbox's Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) before calling it done.

### 2026-08-19 — shadcn-ui-migration — assumption
- **Mistake**: a design finding ("no shadcn equivalent for combobox, keep the hand-rolled file") was true for *generic* shadcn but wrong for the *specific* user-supplied preset, which ships its own Base-UI compound `Combobox`; the correct migration target was found only by running the actual preset apply, not by reasoning about the library in general.
- **Evidence**: `docs/roadmap/features/119-shadcn-ui-migration/context.md` § Archive Synthesis.
- **Rule it implies**: when a feature names an external library's preset/config-specific artifact, verify against that exact preset (run it), not the library's generic docs.

### 2026-08-19 — shadcn-ui-migration — config
- **Mistake**: `shadcn`'s CLI preflight silently requires a bare `tailwindcss` dep alongside `@tailwindcss/postcss` under v4, and `apply --preset` needs a pre-existing `components.json` plus a piped `y` despite `--yes`; each surfaced only by hitting the hang/failure live.
- **Evidence**: `docs/roadmap/features/119-shadcn-ui-migration/context.md` § Archive Synthesis.
- **Rule it implies**: treat a vendor CLI's non-interactive invocation as a scar to capture in the service CLAUDE.md — do not assume `--yes` is sufficient.

### 2026-08-19 — shadcn-migration-high-confidence — duplication
- **Mistake**: a shared hand-rolled control (`ChartPanel.tsx`'s timeframe switcher) was e2e-risk-classified from the FR-cited file only, but the identical pattern repeats in a sibling non-FR-cited file (`chart-panel.spec.ts` asserted 3 `getByRole('button',…)`), so the migration broke a spec the recon sweep never looked at. Caught only at the step's own verification.
- **Evidence**: `docs/roadmap/features/120-shadcn-migration-high-confidence/context.md` § Archive Synthesis.
- **Rule it implies**: recon's e2e-risk sweep must, for any *shared/repeated* hand-rolled control, grep every file the pattern appears in (not just the FR-cited one) for `getByRole`/`getByText` assertions before classing a site "no e2e-risk."

### 2026-08-19 — shadcn-migration-medium-confidence — duplication
- **Mistake**: a product-spec-named primitive (`Accordion`) was structurally impossible for the target — `AccordionItem` wraps a `<tr>` but `AccordionContent` must render the shared detail panel *outside* the `<table>`; substituted `Collapsible`. A distinct failure mode from the ARIA-role mismatch already logged: here the DOM *structure*, not the role, breaks.
- **Evidence**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/context.md` § Archive Synthesis.
- **Rule it implies**: before adopting a compound primitive (Accordion/Tabs/Table) for a control, check its required parent/child DOM nesting against the target's actual layout (per-item-inline vs one-shared-panel), not just its visual output.

### 2026-08-19 — shadcn-table-actions-responsive — assumption
- **Mistake**: a component hidden via off-screen CSS positioning (negative `left`) rather than `display:none` stays in the accessibility tree and remains Playwright-queryable — shadcn `Sidebar`'s desktop branch left the mobile nav's links live at desktop width, colliding with real nav links AND silently satisfying a pre-existing `getByText(...).first()` that was asserting the wrong element (`toBeVisible()` ignores viewport position). Fixed by `sm:hidden`-wrapping the whole subtree.
- **Evidence**: `docs/roadmap/features/124-shadcn-table-actions-responsive/context.md` § Archive Synthesis.
- **Rule it implies**: hide off-mode UI subtrees with `display:none`/`hidden` (removes them from the a11y tree) — never off-screen positioning alone — before relying on any narrowly-scoped e2e; and tighten any *passing* locator that could match a duplicate/off-screen node.

### 2026-08-19 — shadcn-table-actions-responsive — assumption
- **Mistake**: a new horizontal-overflow test at a desktop (≥`lg`) viewport failed deterministically in CI (~18px) but never locally — the repo ships no bundled webfont so system font-fallback metrics differ between sandbox and CI Chromium, and it was the first overflow test ever exercised at a desktop width, exposing a pre-existing unrelated header-tightness edge case. Two wrong fix attempts (`min-w-0` on grid items) chased the wrong cause.
- **Evidence**: `docs/roadmap/features/124-shadcn-table-actions-responsive/context.md` § Archive Synthesis.
- **Rule it implies**: any e2e assertion measuring layout at a *desktop* width (in a repo with no embedded webfont) must leave px slack for CI-vs-local font-metric drift and target a representative width, not a razor-thin breakpoint minimum.

### 2026-08-19 — fundamentals-provider-alternative — config
- **Mistake**: three governance docs (`CLAUDE.md` §Config Governance, `config-governance.md` Rule 6, `reviewer-registry.md` Security row) asserted a `secret.*`-prefix rule dead since feature 076/migration 009 — a reader following the stated rule would re-commit the exact config-key-for-a-credential mistake migration 009 already reversed. Recon flagged the doc as stale but no gate forced the fix.
- **Evidence**: `docs/roadmap/features/129-fundamentals-provider-alternative/context.md` § Archive Synthesis (recon.md:167-172).
- **Rule it implies**: when recon flags a governance/pattern doc as "aspirational, superseded in practice," fixing the doc is in-scope for the feature that relies on the real precedent — a dead rule left standing is a future fails.md entry waiting to happen.

### 2026-08-19 — user-metadata-management — duplication
- **Mistake**: agent tool count lives in 6 surfaces (5 prose + 1 numeric `COPILOT_MCP_TOOL_COUNT`) and the numeric one had silently drifted to 18 while prose said 22 — an unenforced duplication only a manual grep catches.
- **Evidence**: `services/xstockstrat-ui/src/lib/copilot.ts`; `docs/roadmap/features/130-user-metadata-management/context.md` § Archive Synthesis.
- **Rule it implies**: every agent-tool change must sync all six tool-count surfaces; a single-source-of-truth or CI grep-check should enforce it (overlaps `trigger-backfill-mcp-tool`, `fix-mcp-config-key-registry`).

### 2026-08-19 — user-metadata-management — assumption
- **Mistake**: the impl-spec encoded contracts the codebase did not have — an authz module that throws/returns undefined (it returns `''`), and a class-based agent client `XStockStratClient` (it is module-level functions). Both surfaced only at test time and forced test rewrites.
- **Evidence**: `docs/roadmap/features/130-user-metadata-management/context.md` § Archive Synthesis.
- **Rule it implies**: the spec-writer must confirm helper/client contracts against the actual shipped signature, not an assumed shape, before writing paired tests.

### 2026-08-19 — live-strategy-opportunity-attribution — assumption
- **Mistake**: symbol-key normalization was applied at read sites, so a raw-vs-normalized key mismatch silently no-op'd mixed-case-configured symbols — the same bug recurred three times in one feature (`live_by_symbol`, `held_value_by_symbol`, screener membership test). `signal_params.symbols` has no write-time case validation.
- **Evidence**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/context.md` § Archive Synthesis.
- **Rule it implies**: normalize symbol keys at construction/source, never per read site; when adding a new `*_by_symbol` index, mirror `watchlist_by_symbol`'s normalization exactly.

### 2026-08-19 — live-strategy-opportunity-attribution — assumption
- **Mistake**: 131's spec was authored before feature 133 (strategy ownership) merged; a global `list_live_enabled()` would have cross-attributed another user's live strategy (IDOR) into a now-per-user compute — caught only at execute time and retrofitted with owner scoping.
- **Evidence**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/context.md` § Archive Synthesis.
- **Rule it implies**: when a security/tenancy feature merges between a feature's spec and its execute, re-owner-scope every new query the feature adds before implementing.

### 2026-08-19 — live-strategy-opportunity-attribution — duplication
- **Mistake**: a sibling feature (134) genuinely *removed* a UI behavior (config-blob source-weight parse) but left a stale e2e (`value-persists-after-save.spec.ts:83`) asserting the removed behavior — surfaced as a red CI shard on the stacked base branch, not at removal time.
- **Evidence**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/context.md` § Archive Synthesis (PR #953).
- **Rule it implies**: a deliberate behavior removal must sweep and prune the tests that assert the old behavior in the same PR.

### 2026-08-19 — strategy-symbol-denylist — assumption
- **Mistake**: a per-request flag added to a transition function shared by the live path AND restart-replay, leaked into replay, would reconstruct a held-denied symbol as flat-on-restart, permanently suppressing its exit. Caught in design (round 2), not runtime.
- **Evidence**: `docs/roadmap/features/132-strategy-symbol-denylist/context.md` § Archive Synthesis (`_apply_transition`/`_replay_state`).
- **Rule it implies**: a new flag on a function reached by multiple call paths must default to the *safe* value on every path except the one that needs it; enumerate the callers.

### 2026-08-19 — strategy-symbol-denylist — duplication
- **Mistake**: exempting muted rows from the *UI* conviction filter alone silently re-introduced the "vanish" bug — the backend read query (`opportunities.py:105`) applied its own conviction floor. A filter rule must be applied at *every* layer that filters.
- **Evidence**: `docs/roadmap/features/132-strategy-symbol-denylist/context.md` § Archive Synthesis.
- **Rule it implies**: when a "must never disappear" invariant is added, grep for *all* filters/floors across UI + BFF + DB, not just the visible one.

### 2026-08-19 — strategy-user-ownership — config
- **Mistake**: a migration guard that hard-fails on an unset env var (`db-migrate.sh` `:?` on `SEED_USER_ID`) will break every local `docker compose up` on a fresh DB unless the compose service supplies a *concrete non-empty* default, not an empty pass-through. Also `Dockerfile.migrate` had no `gettext`/`envsubst`, and there was no existing envsubst invocation site to extend — the whole templating path was net-new.
- **Evidence**: `docs/roadmap/features/133-strategy-user-ownership/context.md` § Archive Synthesis.
- **Rule it implies**: when a migration adds a required env var, wire it into all three run sites (compose default, `.do/app*.yaml`, setup-env/.env.example) in the same step, and give local dev a concrete default so the migrator guard doesn't brick `docker compose up`.

### 2026-08-19 — shadcn-datatable-migration — assumption
- **Mistake**: `design.md` predicted the `LiveStrategiesPanel` keyboard defect as a "double-fire"; the RED test written to that prediction didn't reproduce it. The real mechanism (verified against the DOM spec) was a single *mis-fire* — the row's `preventDefault()` on the bubbling keydown cancels the button's native Enter-activation, so only the wrong handler fired. Writing the red test to the design's *assumed* failure mode masked the true one until it was investigated.
- **Evidence**: `docs/roadmap/features/135-shadcn-datatable-migration/context.md` § Archive Synthesis (Step 26).
- **Rule it implies**: when a design predicts a specific failure mechanism, validate the red test against the actual observed/DOM-spec behavior before trusting the prediction — a red that fails for a different reason is not a valid red.

### 2026-08-19 — phase7-observability — assumption
- **Mistake**: product-spec FR-1 asserted the DO app specs wired OTEL only for the collector component; in reality a global `envs:` block already covered all components. The spec was written without grounding, so it shipped a false premise that execute-time discovery had to correct.
- **Evidence**: `docs/roadmap/features/033-phase7-observability/context.md` § Archive Synthesis; `docs/roadmap/phase7-deviations.md` § What already existed.
- **Rule it implies**: story/spec claims about existing infra state must be grounded against the repo, not asserted from memory.

### 2026-08-19 — fmp-key-to-secret-env — config
- **Mistake**: a config key was seeded with a `secret://…` placeholder and a migration comment promising it was "resolved at deploy, never plaintext" — but the resolver was never built, so the only way to make the feature work was to store the real credential as plaintext in a broadcast (`WatchConfig`) table. The aspirational comment masked a live plaintext-secret exposure until a later feature audited it.
- **Evidence**: `docs/roadmap/features/076-fmp-key-to-secret-env/context.md` § Archive Synthesis (feature 059 introduced it, 076 reversed it).
- **Rule it implies**: a credential must never live in `config.config_values` (streamed to all subscribers); vendor API keys go through `type: SECRET` env vars.

### 2026-08-19 — fix-listkeys-wire-encoding — duplication
- **Mistake**: a wire-encoding bug was fixed in one hand-built-proto handler (feature 075: `ConfigSnapshot`) but the identical bug in a sibling handler (`listKeys`) was never swept, shipping a latent duplicate that resurfaced as SEV-2. Same author, same defect class, two features apart.
- **Evidence**: `docs/roadmap/features/077-fix-listkeys-wire-encoding/context.md` § Archive Synthesis.
- **Rule it implies**: when fixing a hand-built-proto encoding bug, audit *every* handler in the service that constructs a proto message by hand in the same PR.

### 2026-08-19 — fix-config-scope-resolution — assumption
- **Mistake**: Node gRPC handlers read decoded proto fields by numeric enum value and/or snake_case name, but ts-proto (`packages/proto/buf.gen.yaml` `stringEnums=true`) delivers string enum constants and camelCase field names — the lookup silently misses and falls through to a default. Recurred identically across features 075, 077, 078.
- **Evidence**: `docs/roadmap/features/078-fix-config-scope-resolution/context.md` § Archive Synthesis.
- **Rule it implies**: in any Node service, decode proto enums by string constant and access fields by their camelCase ts-proto name; never index a numeric map with a decoded enum.

### 2026-08-19 — mcp-python-sdk-v2-upgrade — assumption
- **Mistake**: a design's own live-verification pass can still miss API surface it did not specifically exercise — a return-type shape, a default-parameter side effect. The 085 design verified imports/renames live yet missed `get_tool`'s real location, `call_tool`'s changed return type, and a production-breaking DNS-rebinding 421 default; all three were caught only because /sdd-spec re-ran the same live method against the *specific* call shapes the implementation would use.
- **Evidence**: `docs/roadmap/features/085-mcp-python-sdk-v2-upgrade/context.md` § Archive Synthesis.
- **Rule it implies**: each SDD phase that consumes a prior phase's live-verification must re-run it against the exact call shapes/return values its own step will exercise, not accept the upstream conclusion.

### 2026-08-19 — fix-mcp-server-input-validation — assumption
- **Mistake**: the "obvious" float range check (`c < 0.0 or c > 1.0`) silently admits `NaN`, which then interacts with a `> 0.0` NULL-sentinel to store NULL — a validation guard written the naive way would have re-created the exact silent-NULL bug it was meant to fix.
- **Evidence**: `docs/roadmap/features/094-fix-mcp-server-input-validation/context.md` § Archive Synthesis (caught in the design/adversary round).
- **Rule it implies**: treat NaN as an explicit failure mode in any numeric-range validation; the inverted-range form `not (lo <= x <= hi)` is the cheap fix.

### 2026-08-19 — shadcn-migration-custom-composites — assumption
- **Mistake**: a client-side create-time format rule (`STRATEGY_ID_RE = /^[a-z0-9_]+$/`, no hyphen) was applied to `idValid` *unconditionally*, including edit mode where the Strategy ID field is disabled and holds immutable server-sourced data — so any legacy strategy with a hyphenated id could never advance past Step 1 in edit mode. Latent because no prior test path clicked Next in edit mode; surfaced only when sub-screen navigation became mandatory. Fixed to `mode === 'create' && !idValid`.
- **Evidence**: `docs/roadmap/features/123-shadcn-migration-custom-composites/context.md` § Archive Synthesis (Step 13).
- **Rule it implies**: a create-time input-validation predicate must be scoped to `mode==='create'` when the same field is immutable/server-sourced in edit mode.

### 2026-08-19 — shadcn-migration-custom-composites — config
- **Mistake**: `npx shadcn@latest add <name>` silently rewrites the shared `package.json` dependency version to the registry item's declared version (reset `recharts` `^3.10.1` → `^3.8.0`) and re-prompts to overwrite already-customized primitives (`button.tsx`); both must be caught and reverted/declined in the same step.
- **Evidence**: `docs/roadmap/features/123-shadcn-migration-custom-composites/context.md` § Archive Synthesis (Steps 3, 12).
- **Rule it implies**: after any `shadcn add`, diff `package.json` and the `ui/` tree and restore any version/customization the CLI clobbered before committing.

### 2026-08-19 — shadcn-migration-custom-composites — assumption
- **Mistake**: a `/sdd-design` session run without the Proposer/Adversary `Task` subagents (a tooling gap — self-run debate) asserted a concrete `path:line` citation for evidence that did not yet exist in `recon.md`; it was only later verified via live `WebFetch` and back-filled into recon.
- **Evidence**: `docs/roadmap/features/123-shadcn-migration-custom-composites/context.md` § Archive Synthesis.
- **Rule it implies**: a self-run design debate with no independent adversary subagent must treat every `path:line` citation as unverified until the cited evidence is confirmed to exist.

### 2026-08-19 — fix-signal-detail-readiness-rule — duplication
- **Mistake**: a single user-facing quantity (readiness) was computed by two separate code paths (queue exit-rule trace vs `EvaluateReadiness` entry default) and shown together, so they contradicted (`CONVICTION 100` beside `0/2 conditions`). The rule-blind `EvaluateReadiness` default (`rule="entry"`) silently mismatched the queue's exit trace for held rows.
- **Evidence**: `docs/roadmap/features/138-fix-signal-detail-readiness-rule/context.md` § Archive Synthesis.
- **Rule it implies**: a default argument that silently picks one branch (`rule="entry"`) is a latent contradiction wherever another path picks a different branch for the same display — make the branch explicit at the seam.

### 2026-08-19 — fix-listorders-ambiguous-updated-at — duplication
- **Mistake**: feature 101 added a shared `LEFT JOIN LATERAL` fragment that projected a column (`updated_at`) whose name duplicated one already in the outer SELECTs' range, making every `GetOrder`/`ListOrders`/`ListSubmittedOrders` DB read fail with `SQLSTATE 42702`. A change to a shared SQL const silently broke three callers it never edited.
- **Evidence**: `docs/roadmap/features/140-fix-listorders-ambiguous-updated-at/context.md` § Archive Synthesis (PR #880, 2026-08-06).
- **Rule it implies**: any column projected by a shared/joined SQL fragment must carry a name unique across the joined range (alias it) — proto/DB CI won't catch a name collision; only a live query will.

### 2026-08-19 — fix-listorders-ambiguous-updated-at — assumption
- **Mistake**: the `ListOrders` in-memory fallback was designed for transient DB failures but silently absorbed a *100%*, permanent query bug for ~10 days — masking total DB-read failure as a mere WARN in staging logs; the process-local store also diverges across a multi-replica deploy, so the degradation was silently non-deterministic per replica.
- **Evidence**: `docs/roadmap/features/140-fix-listorders-ambiguous-updated-at/context.md` § Archive Synthesis.
- **Rule it implies**: a silent degradation fallback must escalate/alert when its trigger rate is sustained (not one-off), or a hard failure hides as noise.
### 2026-08-19 — 020-notify-external-fanout — assumption
- **Mistake**: A design gated alert fanout on `alert.context["confidence"]`, a Struct key **no alert producer writes**. A survey of all five `EmitAlert` callers found analysis writes a flat `context` of `{strategy_id, symbol, trigger_type, conviction}` (`conviction`, not `confidence`, and an ordinal not a probability — cf. 023), while trading/marketdata/portfolio set **no** context and ingest sets `{job_id, failed_symbols, error}`. Fail-closed on the missing key would have shipped a 100%-inert feature. Same family as 080 (absence-claim) / 023 & 081 (name+range ≠ producer contract) / 2026-08-02 F-10 (context-builder drift), now on the notify alert `context` Struct.
- **Evidence**: `services/xstockstrat-analysis/app/engine/live_loop.py:567-575`; `services/xstockstrat-trading/internal/service/trading.go` (fill/approval/reconciliation alerts, no Context); `services/xstockstrat-ingest/app/handlers/servicer.py:295`; feature 020 design.md § Rejected Alternatives + context.md round 1.
- **Rule it implies**: reinforces **P-03**/**C-01** — before gating or building a payload on a `context`/`Struct` key an "upstream" service supposedly sets, grep every producer's actual write site for that exact key; a plausible key name (`confidence`) and a persistence path (`JSON.stringify(context)`) prove neither that the key is written nor what it means.
### 2026-08-21 — config-secrets-and-scoping — assumption
- **Mistake**: The design duplicated a **write-authz decision on the client** — a client-side
  `is_secret` write refusal in the agent `set_config` tool plus edit-suppression of secret rows in
  config-ui — on the guess that operators shouldn't set secrets via MCP/UI. The backend admin gate +
  row-authoritative encryption already guard the write, so the client-side refusal was redundant and
  *blocked legitimate admin writes*; the operator reversed it in review (secrets are now writable via
  both MCP and config-ui, encrypted server-side).
- **Evidence**: `docs/roadmap/features/147-config-secrets-and-scoping/context.md` (PR #994 review,
  item 2); reversal in `services/xstockstrat-agent/app/tools.py` `set_config` +
  `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx`.
- **Rule it implies**: guard a write-authz decision **once**, at the backend edge; a client-side
  re-refusal both drifts from the gate and blocks legitimate callers.

### 2026-08-21 — config-secrets-and-scoping — migration
- **Mistake**: Dropping the `trading_mode` column broke the **config-ui BFF audit route**, which
  directly `SELECT`s the config service's audit table — a runtime break in a *different service*,
  invisible to the migration and to CI, and beyond the two in-schema audit triggers the design's
  completeness sweep already caught.
- **Evidence**: `docs/roadmap/features/147-config-secrets-and-scoping/context.md` (Steps 7–9, audit
  route fix); `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`.
- **Rule it implies**: a column-drop completeness sweep must grep **every** reader of the schema —
  including cross-service / BFF direct queries — not just the owning service's code and its triggers.

### 2026-08-25 — 155-watchlist-opportunity-signal-cues — testing (design-caught)
- **Mistake (caught in design, not shipped)**: The proposed RED for a "stale filter" fix drove the second fetch via `page.reload()` with a swapped mock payload. A reload **remounts** the page and resets the `useState` filter selection (`activeSources` → `[]`), so the stuck-empty-list state the bug depends on can never form — the test would pass **green against unfixed code**, proving nothing (same vacuous-green family as 2026-07-29/074 and 2026-07-30/080). The defect is a *mount-persistent* state (`activeSources`) never reconciled against an *in-place* refetch (`refetchInterval`), so the repro must keep the component mounted.
- **Evidence**: `docs/roadmap/features/155-watchlist-opportunity-signal-cues/design.md` (FR-5, FIX D); `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:90,129-153`, `src/hooks/useOpportunities.ts:17-23`.
- **Rule it implies**: to reproduce a bug in state that survives a refetch, trigger the refetch **in place** (window `focus` / `refetchQueries`), never a `reload()`/remount — a remount resets the very state under test and yields a vacuous green (P-06 red-before-green must be proven on the mounted component).

### 2026-08-25 — 155-watchlist-opportunity-signal-cues — build (client-lib in server bundle)
- **Mistake**: Added a **value** import of `@phosphor-icons/react` (which calls `React.createContext` at module scope) to `services/xstockstrat-ui/src/lib/opportunityShared.tsx` for the new cue maps. That module is transitively imported by **server** code — `src/lib/traderBff.ts:24` imports copilot stream constants from `src/lib/copilot.ts`, which imports `OPPORTUNITY_ACTION` from `opportunityShared` — so the icon lib landed in the `/trader/api/[...connect]` route's server bundle. `tsc`, lint, unit, and the dev-server e2e all passed; only the **production build** caught it: `TypeError: (0 , d.createContext) is not a function` while "Collecting page data" (CI `Frontend E2E Build`, green on the base branch). Same "shipped it to the client surface, forgot it also rides a server import chain" family as the C-10 shared-consumer entries, specialized to a client-only lib crossing the RSC boundary.
- **Evidence**: `services/xstockstrat-ui/src/lib/opportunityShared.tsx` (phosphor value import, now type-only); `src/lib/copilot.ts:7` → `src/lib/traderBff.ts:24`; fix `src/lib/readinessCue.ts` (the phosphor value import + cue maps, imported only by `'use client'` cue consumers); PR #1012 CI run 32908124461.
- **Rule it implies**: a module imported (even transitively) by a route handler / server plumbing must not statically import a **client-only** library that evaluates React (`createContext`, hooks) at module scope. Keep such value imports in a leaf only client components reach, and verify with a real `next build` (not just tsc/lint/dev-server e2e) — `pnpm build` is the only local check that exercises server-bundle "collect page data". Grep the server import chain (`traderBff`/`*Bff`/`route.ts` → its `@/lib/*` imports) before adding a client lib to a shared `lib/` module.

### 2026-08-26 — fix-signal-screen-crash — assumption (recurrence of 2026-08-06/backtest-debug-info)
- **Mistake**: The exact `bar.timestamp`-does-not-exist / `MagicMock`-hides-it fail recorded on
  2026-08-06 recurred. Feature 064 fixed the six `servicer.py` sites and added real-`Bar` fixtures there,
  but the signal-blend scorer had been **extracted** to `app/services/scoring.py` (feature 060) with its
  own `MagicMock` bar builder (`tests/test_analysis_helpers.py:_make_bar`), so `scoring.py:17`'s
  `bar.timestamp.ToDatetime()` kept shipping — crashing every signal-weighted `ScreenSymbols` with
  `AttributeError: timestamp`, surfaced only on staging during the feature-154 fundamentals first-cycle
  check. The 2026-08-06 rule was right; it just wasn't applied to the code that moved.
- **Evidence**: `docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md`;
  `services/xstockstrat-analysis/app/services/scoring.py:17` (`bar.time = 2`, no `timestamp`, per
  `packages/proto/marketdata/v1/marketdata.proto:44`); `tests/test_analysis_helpers.py:163-167`
  (`_make_bar` MagicMock); fix feature 160 (`bar.time` + real-`Bar` reshape of `_make_bar`).
- **Rule it implies**: when a function that reads proto fields is **extracted/copied into a new module**,
  the "real proto instance, not `MagicMock`" rule (2026-08-06) must follow it — audit the NEW module's
  test fixtures for `MagicMock` proto stand-ins, not just the origin's. A field-name typo re-hides in
  every `MagicMock`-fixtured suite the rule didn't reach.

### 2026-08-26 — 159-fix-offline-account-ui-gaps — assumption
- **Mistake**: A design (and its recon) asserted a status-transition path was "guarded" by reading only
  the *broker-call* precondition next to it, not the *local state write*. `CancelOrder` skips the broker
  cancel when `broker_order_id == ""` (`trading.go:1036`) but then sets `order.Status = ORDER_STATUS_CANCELED`
  **unconditionally** (`:1079`) — no offline / terminal-state / empty-`broker_order_id` guard on the local
  transition. So an OFFLINE NEW order (which by design has an empty `broker_order_id` and no broker client)
  can be flipped to CANCELED with no broker involved, silently violating the "offline orders are recorded
  NEW, never broker-CANCELED" guarantee (feature 159 FR-2). The recon's premise ("CANCELED requires a
  non-empty broker_order_id + non-offline client") was true of the broker cancel but false of the local
  write beside it — caught only by a dedicated code-trace after the design-adversary refused the UI-only
  closure. Same shape as the routing half: `PlaceOrder` decides offline solely from the in-memory pool tag
  (`:388`) and never re-reads the persisted account `broker_type`, so a pool/DB divergence misroutes.
- **Evidence**: `services/xstockstrat-trading/internal/service/trading.go:1036,1079` (guarded broker cancel
  vs unguarded local transition); `:285-317,388` (pool-tag-only routing); feature 159 `design.md` § Chosen
  Approach A (both guards), `context.md` § root-cause investigation (trading trace).
- **Rule it implies**: reinforces **C-10(b)**/**P-03** — when auditing whether a state transition is
  "guarded," read the precondition on the **state write itself**, not on an adjacent side-effect (a broker
  call, a notification) that happens to share the branch. A skipped side-effect is not a skipped transition.
  And a routing/authorization decision that reads an in-memory cache (broker pool) must be checked against
  the case where the cache diverges from the authoritative store — prefer reading the persisted value, or
  prove the cache cannot diverge, before calling the path safe.

### 2026-08-26 — notify-external-fanout — migration
- **Mistake**: Feature 020's design artifacts hardcoded a concrete migration number (017), env name
  (`dev`), and `ON CONFLICT` target (`…,trading_mode`); because a schema-reshaping feature (147)
  landed first, the config seed had to be renumbered to 018, re-pointed to `staging`, and rewritten to
  drop `trading_mode` at rebase — churn the artifacts guaranteed the moment they pinned volatile schema facts.
- **Evidence**: `services/xstockstrat-config/migrations/018_notify_fanout.up.sql`; feature 147 `017_config_secrets_and_scoping`; feature 020 context.md 2026-08-21 DEVIATION.
- **Rule it implies**: a config/DB-seed feature that will sit in a queue behind an in-flight
  schema-reshaping feature should treat migration number, env labels, and conflict-target columns as
  bind-at-rebase, not design-time constants — reconfirm them against `main-dev` immediately before execute.

### 2026-08-26 — order-snapshots-pnl-patterns — assumption
- **Mistake**: A cross-service event-string consumer was written matching an *assumed* spelling
  (`order.cancelled`, British) instead of the producer's actual emitted literal (`order.canceled`,
  American). No unit test catches a non-matching event string — the handler simply never fires, so
  cancel snapshots would have silently gone uncaptured. Only grep-verifying the producer's emit sites caught it.
- **Evidence**: producer emits at `services/xstockstrat-trading/internal/handler/trading.go:578,1220,1236,828,1248`; feature 042 context.md 2026-08-20 impl-spec review.
- **Rule it implies**: a consumer's hardcoded event/topic string must be copied from (or asserted
  against) the producer's actual emit site, and a producer↔consumer parity test should pin it — a
  spelling mismatch is invisible to normal tests.

### 2026-08-26 — unified-symbol-page — config
- **Mistake**: Designed a nullable per-bar series as `repeated google.protobuf.DoubleValue` assuming the
  wrapper conveys presence; at implementation this proved unimplementable — repeated wrapper elements
  have no presence, `HasField` raises, and Connect-JSON collapses a gap and a real `0.0` to the same `0`.
- **Evidence**: feature 125 context.md:967-979 (fixed with a per-point `IndicatorValue { optional double value = 1; }`).
- **Rule it implies**: to carry nullable scalars in a *repeated* proto field, wrap each element in a
  message with a proto3 `optional` scalar; `google.protobuf.*Value` only gives presence for a *singular*
  optional field.

### 2026-08-26 — unified-symbol-page — scope-creep
- **Mistake**: A page-retirement/redirect step nearly dropped shipped functionality (feature 132's Mute
  control, 083's Edge(BT) stat) that had landed on the target page *after* recon froze; the spec's
  grep-only inbound sweep also missed 4 later-added e2e specs pointing at the retired route.
- **Evidence**: feature 125 context.md:915-929 (Steps 22-26).
- **Rule it implies**: before retiring/redirecting a page, re-derive its *current* feature surface and
  inbound references against live trunk (not recon) — a consolidation spec written earlier cannot see
  features merged onto its deletion target since.

### 2026-08-26 — unified-symbol-page — assumption
- **Mistake**: Status-automation drift recurred — executing on a harness-pinned `claude/*` branch with a
  squash-merge (no `feature/<slug>` branch to reconcile) plus not flipping step/`status.md` state during
  execute left the feature stuck at "Step 1 / implementation-ready" despite completion; CI auto-promote
  silently skips anything not already `code-completed`. The same root cause hit feature 096.
- **Evidence**: feature 125 feature.md 2026-08-16 correction row; context.md:15-25 (096's identical failure).
- **Rule it implies**: when executing on a harness branch that will squash-merge, advance
  `status.md`/step statuses explicitly during execution — do not rely on CI auto-promotion, which only
  fires for features already at `code-completed`.

### 2026-08-26 — consolidate-watchlist-signal — assumption
- **Mistake**: The product spec named `form4-enhanced-ingest` as the *motivating* flow, but form4 scores
  `direction="watchlist"` signals at conviction 0.30 (< the 0.6 gate) → they land in `skipped_signals`
  and **never call `ingest_signal`** — so form4 triggers this feature exactly zero times. The stated
  driver was recoverable only by reading the skill; grounding (P-03) corrected it at design and the real
  trigger (any explicit `direction="watchlist"` caller) replaced it.
- **Evidence**: `.claude/skills/form4-enhanced-ingest/SKILL.md:59-61`; feature 127 context.md §Session 2026-08-19 (Phase 1 round 1 "PREMISE CORRECTION").
- **Rule it implies**: verify the cited motivating/producer flow actually reaches the code path before
  designing on it (P-03) — a plausible-sounding trigger in a product spec is not evidence.

### 2026-08-26 — consolidate-watchlist-signal — assumption
- **Mistake**: A new proto field on `WatchlistBinding` (`source`) was silently zeroed at insert despite a
  correct migration + insert path, because every portfolio watchlist write funnels through a central
  `normalizeBindings` (`portfolio_service.go:1139`) that reconstructs each binding field-by-field and
  never learned the new field — a runtime data-loss, not a compile error, found only by an execute-phase test.
- **Evidence**: feature 127 implementation-spec.md Step 4 (normalizeBindings preserve source); `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1139`.
- **Rule it implies**: when adding a field to a proto message that passes through a hand-rolled
  normalizer/reconstructor, grep every normalizer on that type's write path and extend it in the same
  change — a field-by-field rebuild silently drops unknown fields.

### 2026-08-26 — symbol-page-section-nav — assumption
- **Mistake**: A `md:grid-flow-col md:auto-cols-fr` panel row overflowed horizontally by 59px at 390px
  because CSS grid items default to `min-width:auto`; the layout looked correct at desktop and only the
  390px `mobile-overflow` guard caught it.
- **Evidence**: feature 139 implementation-spec.md (archived) :508-511; context.md:194-199.
- **Rule it implies**: any CSS grid holding variable-width children needs `min-w-0` on the items, and
  every layout change must be re-run against the 390px overflow guard.

### 2026-08-26 — chart-data-freshness — config
- **Mistake**: A merge/promotion commit whose message did not contain the feature slug caused
  `ci-validate-feature-status.yml` to silently skip flipping the feature to `launched`; it sat at
  `code-completed` despite being live in production, needing manual status reconciliation.
- **Evidence**: feature 140 context.md 2026-08-19; feature.md Status History row 2026-08-19 (PR #981).
- **Rule it implies**: the squash/merge commit for a feature must include its `NNN-slug` (or the status
  automation won't detect promotion) — verify `launched` after promotion rather than assuming CI set it.

### 2026-08-26 — fix-opportunities-bars-fetch-oom — scope-creep
- **Mistake**: Recon and both adversarial grilling rounds scoped only to the function under change
  (`_compute_opportunities`) and never inspected the RPC's own read/return path, so a
  `_DEFAULT_OPP_PAGE_SIZE=50` read cap invalidated a compute-scale test asserting `>=200` (241 rows
  materialized, only 50 returned).
- **Evidence**: feature 141 context.md Step 2 (`servicer.py:109,2245`); fixed with `page_size=300`.
- **Rule it implies**: when a test must observe the output of a fix, ground the full read/return path
  (pagination defaults included), not just the write/compute site.

### 2026-08-26 — fix-opportunities-bars-fetch-oom — assumption
- **Mistake**: Shipped a SEV-2 fix against an unconfirmed root-cause hypothesis (chunk-lock exhaustion
  never validated against a real memory/lock profile); the ≥200-row test scale is a documented
  *substitute* for the unknown real incident size, not a reproduction.
- **Evidence**: feature 141 design.md Open Risks 1-2; context.md sdd-design + execute summary.
- **Rule it implies**: when root cause is unconfirmed, name the substitute proof explicitly in-test and
  pre-commit to an escalation path if the incident recurs.

### 2026-08-26 — daily-bars-only — assumption
- **Mistake**: A TDD "red" test that narrows a validation set can silently be a false-green.
  `pytest.raises(match=...)` is `re.search`, so a narrowed error substring still matches the old message;
  and probing a value invalid under *both* old and new rules (`"1w"`) exercises nothing. Only probing a
  value that flipped accepted→rejected (`15m`/`1h`) yields a genuine red→green.
- **Evidence**: feature 143 implementation-spec.md Deviation Log D-5; `services/xstockstrat-agent/tests/test_client.py`.
- **Rule it implies**: when testing a narrowed validation set, the RED must probe a previously-accepted
  (boundary-flipped) value, never a `match=` substring or a value invalid under both sets.

### 2026-08-26 — daily-bars-only — assumption
- **Mistake**: A ChartPanel e2e that captures the component's *mount* `GetBars` is flaky — the mount
  fetch races the async lightweight-charts series init and is never retried because `seriesRef` is not a
  `fetchBars` effect dependency. The bug only surfaced under a real prebuilt/CI e2e run, not `pnpm dev`.
- **Evidence**: feature 143 implementation-spec.md Deviation Log D-6; context.md Session sdd-execute Step 10 follow-up; `services/xstockstrat-ui/e2e/trader/chart-panel.spec.ts`.
- **Rule it implies**: to assert an outbound `GetBars` in a ChartPanel e2e, wait for `.tv-lightweight-charts`
  readiness then change a real `fetchBars` effect dep (bar-count) as the trigger; don't rely on the mount
  fetch, and run the prebuilt harness not the dev server.

### 2026-08-26 — fix-screener-soft-criterion — duplication
- **Mistake**: The `x / n if n else 0.5` magic-neutral-fallback for missing data recurred across three
  sites (PR #971 hard-filter, this feature's soft-criterion, and the still-unfixed
  `fundsignal_loop.py:294`). Fixing one instance does not clear the platform-wide pattern; the same
  defect keeps resurfacing per code path.
- **Evidence**: feature 144 context.md:86-90; unfixed twin `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:294` (`_builtin_score`).
- **Rule it implies**: when fixing a "neutral default masks missing data" bug, sweep the whole service
  for the identical fallback shape and either fix or explicitly file each sibling.

### 2026-08-26 — symbol-page-panel-refinements — duplication
- **Mistake**: Adding a panel to feature 139's `SymbolPanelGroup` silently creates a hidden mobile
  `role="radio"` tab whose text **equals** the panel's card title, so any pre-existing unscoped
  `getByText('<title>')` starts matching 2 DOM nodes and fails Playwright strict mode on a *different,
  untouched* spec. Same class as the shared-`aria-label` collision (fails.md 2026-08-09): the second
  occurrence is off-screen (`md:hidden`) so it's invisible in the browser but present in the DOM.
- **Evidence**: feature 145 design.md §70; implementation-spec.md Step 3 (`:256`); context.md 2026-08-18 sdd-spec.
- **Rule it implies**: when promoting existing content into a `SymbolPanelGroup` panel, grep the whole
  e2e suite for unscoped `getByText`/`getByLabel` on that text and rescope to `getByRole('heading'|'radio')`
  before closing — the collision surfaces on a spec you didn't touch.

### 2026-08-26 — fix-backtest-annualized-return — assumption
- **Mistake**: `_compute_metrics` assumed `daily_equity` was one continuous daily curve, but the
  *aggregate* backtest path passes N concatenated per-symbol curves, under-scaling the annualization
  exponent ~N×. The assumption held for single-symbol callers and only broke on multi-symbol runs —
  invisible until the numbers looked wrong in staging.
- **Evidence**: feature 149 `servicer.py:522,525-529,571` (concat), `:3630-3632` (consumer); retained defect report.
- **Rule it implies**: a helper that assumes a specific series shape must assert/validate that shape, or
  the caller must pass the semantic quantity (`period_years`) explicitly.

### 2026-08-26 — manage-strategy-accept-object-rules — assumption
- **Mistake**: An MCP tool's strict `str` signature assumed clients send JSON as a *string*, but the
  Claude Code harness pre-parses JSON-object args and delivers a `dict`, so valid strategy registrations
  were rejected at the pydantic boundary — surfaced only by a live 4-strategy registration attempt against staging.
- **Evidence**: feature 149 context.md 2026-08-22; design.md (archived) §15-20.
- **Rule it implies**: for any MCP tool param that can be a structured value, accept `str | dict` — a
  JSON-pre-parsing transport will hand you a dict.

### 2026-08-26 — backtest-portfolio-sizing — assumption
- **Mistake**: A look-ahead/forward-fill RED test built on *ragged start/end* calendars passes green
  while the real look-ahead bug (using a future close to mark a *mid-series* gap) ships. The dangerous
  case is a mid-series gap, not ragged edges.
- **Evidence**: feature 150 design.md (archived) §91-93; Step 6.
- **Rule it implies**: any forward-fill/MTM feature must assert past-only marking with a mid-series-gap
  fixture, not merely ragged calendars.

### 2026-08-26 — backtest-portfolio-sizing — assumption
- **Mistake**: Changing a simulator's return-tuple arity silently breaks every unpacking call site and
  test repo-wide; discovered only when 267 existing tests failed to unpack. Papered with `[:4]` slicing
  helpers + a 5th-`[]` in mocks.
- **Evidence**: feature 150 Step 5 (both per-symbol simulators grew a 5th intent element).
- **Rule it implies**: widening a returned tuple's shape is a cross-cutting signature change — audit all
  unpack sites (or return a named struct) before editing.
