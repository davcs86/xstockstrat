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
  Resolution in `081-qa-capability/design.md` § Floor breach.
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
