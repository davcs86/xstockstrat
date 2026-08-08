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
