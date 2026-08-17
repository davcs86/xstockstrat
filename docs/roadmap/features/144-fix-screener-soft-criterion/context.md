# Context Log: fix-screener-soft-criterion

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-17 (/sdd-triage)

- Bug surfaced via a user screenshot of the dev screener (`xstockstrat-staging`,
  `tau95.ondigitalocean.app`) showing QQQ (no P/E data) scoring `0.500` on a `pe_ratio < 20`
  soft/weighted criterion — outranking MSFT/AAPL, which have real, worse-looking P/E data.
- User's hypothesis ("no chance QQQ was cached") prompted investigation before assuming it was a
  recurrence of the just-fixed null-as-zero hard-filter bug (PR #971) — it is not; root cause is a
  distinct fallback in the **soft/weighted** scoring path, confirmed via a `codebase-discovery`
  subagent then independently re-verified (exact line numbers re-grepped, not trusted from the
  subagent report alone, per the repo's absence-claim discipline).
- Filed `docs/reports/2026-08-17-screener-missing-data-neutral-score-defect.md` (GitHub Issues are
  disabled on this repo — `docs/runbooks/bug-triage.md` / `.claude/skills/sdd-qa/reference/
  defect-filing.md` convention) after confirming with the user (P-04) via `AskUserQuestion`.
- Severity: SEV-2. Environment: dev (main-dev). Config-only: no. Routed to **Track C (SDD path)**
  per `docs/runbooks/bug-triage.md` Quick-Start table ("Bug only in main-dev... → Track C").
- Created: feature.md, product-spec.md, status.md (`draft`), context.md.
- Affected services (from report): `xstockstrat-analysis` (scoring), `packages/proto` (likely — no
  field distinguishes a data-less fallback score today), `xstockstrat-ui` (rendering, once the
  backend signal exists).
- Root cause hypothesis: `ScreenerEngine._build_result`'s `weight_total > 0` guard
  (`screener.py:474`) picked an arbitrary `0.5` literal as its zero-division fallback and never
  distinguished "no criteria configured" from "this candidate had no usable data for any
  configured criterion" — the latter case should fail closed like the hard-filter path already
  does, not emit a plausible-looking neutral score.
- Recommended design depth: **quick** (`/sdd-design fix-screener-soft-criterion quick`) — rationale:
  severity is SEV-2 (triggers quick per the C-0 rule) and the actual fix approach (exclude / rank
  last / add an explicit proto field) is a real design fork worth one adversarial round, even
  though scope is single-service and no proto/migration change is yet confirmed necessary (which
  would otherwise push toward `full`).
- Development branch: `feature/fix-screener-soft-criterion`.

## Session 2026-08-17 (implementation)

- **Branch note (deviation):** this session was harness-assigned `claude/bug-144-zzhvpv` (a
  `claude/*` session branch per root CLAUDE.md § Branch Strategy), not `feature/fix-screener-soft-
  criterion`. The branch started stale (10 commits behind `main-dev`, predating this feature's own
  PR #975 triage scaffold) and was fast-forwarded to `origin/main-dev` before any edits — zero
  divergent commits existed, so this was a plain fast-forward, not a rebase/merge. PR opens from
  `claude/bug-144-zzhvpv` → `main-dev`, matching this repo's established precedent for
  harness-driven bug-fix sessions (PRs #971/#973/#975 all did the same).
- Did not run the interactive `/sdd-design quick` skill (no human present to grill/approve a
  proposer-vs-adversary debate in this harness session). Performed the equivalent grounded design
  reasoning inline instead — documented below for audit, per the Constitution's design-gate intent
  even though the skill itself didn't run.
- **Design decision — resolves the product-spec's Open Question:**
  - Read `_build_result` and the existing `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` handling
    end-to-end first. Found an **existing, pinned test**
    (`test_fundamental_hard_filter_missing_for_one_symbol_fails_closed`) that explicitly asserts
    `status == SCREEN_RESULT_STATUS_OK` for a candidate whose only configured (hard-filter)
    criterion has no data — i.e. the exact `weight_total == 0` condition this bug also hits, just
    via the hard-filter path. Reusing `INSUFFICIENT_DATA` for the new bug would have flipped that
    pinned assertion.
  - Also read the UI's polling mechanism (`useScreenSymbolsPoll`, `pendingRows` filtered on
    `status === INSUFFICIENT_DATA`): that status drives an active background re-check loop,
    correct for its two existing causes (bars catching up, fundamentals source recovering — both
    genuinely transient). QQQ's missing P/E is very likely **permanent** (an ETF has no P/E ratio,
    full stop) — reusing `INSUFFICIENT_DATA` would have silently mis-signaled it as retry-eligible
    and could have shown "Fundamentals pending" (implying it'll resolve) forever, or driven
    pointless repeat polling. That would be a new, self-inflicted bug (surfaced as a tradeoff
    rather than picked silently).
  - **Chosen fix:** an additive `ScreenResult.score_unavailable: bool` field (proto field 14,
    non-breaking — `buf breaking` verified clean against `main-dev`). Set true in `_build_result`
    exactly when `weight_total <= 0 and len(criteria) > 0` (criteria were configured, but every
    one of them was skipped for this candidate specifically — distinct from a scan configured with
    zero criteria at all, which stays a harmless no-op, unchanged). `status` stays `OK`
    (preserves the pinned hard-filter test unmodified); `technical_score`'s internal `0.5`
    fallback is **left in place** (still feeds `combine_score` unchanged, so a real independent
    signal-weighted blend for the same candidate is untouched — out of scope per the spec's "no
    refactoring the scoring math beyond the missing-data fallback"). Ranking is fixed at the
    `screen()` sort step: `results.sort(key=lambda r: (r.score_unavailable, -r.score))` — a
    flagged candidate can never outrank a genuinely-scored one, regardless of its own internal
    number, without excluding it from the response entirely (still visible/actionable to the
    caller, per the product-spec's least-destructive framing of the three original options).
  - Rejected alternatives: (a) reuse `INSUFFICIENT_DATA` — rejected per the two points above; (b)
    exclude the candidate from `results` entirely — rejected as more destructive than necessary
    (discards visibility the caller may still want, e.g. manually watchlisting QQQ anyway); (c)
    just change the fallback constant (e.g. `0.5` → `0.0`) — rejected because a real candidate can
    also legitimately score `0.000` (AAPL did, in the original repro), so it would still be
    indistinguishable from genuine data, just at the other end of the range.
  - Swept for the same pattern elsewhere in `xstockstrat-analysis` (per the spec's Open Question):
    found `app/engine/fundsignal_loop.py:294`'s `_builtin_score` has the identical shape. Left
    unfixed — different subsystem/blast radius, outside this spec's acceptance criteria — and
    flagged in `product-spec.md`'s Open Questions as a candidate follow-up rather than silently
    fixed or silently dropped.
- **Files changed:** `packages/proto/analysis/v1/analysis.proto` (+ regenerated Go/Python/TS
  stubs via a host-provisioned codegen toolchain — Docker daemon unavailable in this sandbox, so
  followed `docs/runbooks/codegen-toolchain-host-setup.md`, validated an empty stub diff first);
  `services/xstockstrat-analysis/app/services/screener.py` (`score_unavailable` computation +
  sort); `services/xstockstrat-analysis/tests/test_screener.py` (new QQQ-repro test + strengthened
  the two existing hard-filter tests with `score_unavailable` assertions);
  `services/xstockstrat-ui/src/app/insights/screener/page.tsx` (Score cell → dash, Status cell →
  new "No criteria data" badge, both gated on `scoreUnavailable`); `e2e/fixtures/screenResults.ts`
  + `INVENTORY.md` (new `noCriteriaDataRow` fixture) + `e2e/insights/screener.spec.ts` (new e2e
  case).
- **Verification:** `xstockstrat-analysis` — 524/524 pytest pass, ruff clean. `xstockstrat-ui` —
  `tsc --noEmit` clean, `next lint` clean (pre-existing unrelated warnings only), 97/97 vitest
  pass, Playwright `screener.spec.ts` 18/21 pass; the 3 failures (global-mock-backend-dependent
  tests unrelated to this change: "runs a scan and renders a ranked results table", "renders the
  feature-083 raw columns", "the 10-column results table does not overflow the phone frame")
  reproduce identically on the pristine pre-fix baseline (verified via `git stash` + re-run) —
  a pre-existing sandbox/mock-backend timing issue, not a regression from this fix. Go: the
  regenerated `packages/proto/gen/go` package builds clean; no Go service imports
  `analysis/v1` today, so no further Go-side verification applies.
- Status: `code-completed`.
