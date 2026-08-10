# Feature: shadcn-migration-custom-composites

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/shadcn-migration-custom-composites`
**Created**: 2026-08-08
**Last Updated**: 2026-08-09

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings, both fixed in-place) |
| 2026-08-08 | `spec-ready` → `design-approved` | /sdd-design | Recon + 2-round design debate completed and written to recon.md/design.md. **No `AskUserQuestion`/`Task` tool was available in this execution session** — the design's genuine forks (FR-5 keep-vs-replace, FR-9/FR-10 install-path/shell-vs-restructure, plus a recon-discovered third recharts consumer and the recharts-version handling) were decided by this session on documented evidence rather than gated interactively with the user. **Needs the user's explicit confirmation before `/sdd-execute`** — see design.md's header note and Open Risks. |
| 2026-08-08 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps, grounded against `design.md`'s Chosen Approach. Item #12 (`insights/page.tsx`'s second `recharts` chart) was **not** turned into a step — recorded instead as a `## Deferred Item` pending the user's explicit scope decision, per `design.md`'s own Open Risks flagging it as unapproved scope. |
| 2026-08-08 | `implementation-ready` (unchanged) | user override + this session | The user was asked directly whether FR-10 should really be shell-only for the entire wizard, and **overrode** it for Step 1 specifically: Step 1 restructures onto `Questionnaire`'s native Choice/Input answer model (4 nested sub-screens); Steps 2-4 stay shell-only, unchanged. Recorded as `design.md` § Round 3 (rewrote Chosen Approach #10 + the corresponding Rejected Alternatives entry), a corrected/sourced one-answer-per-`Item` citation appended to `recon.md` § Dependencies (two live `WebFetch` calls, replacing an earlier unsourced citation), `implementation-spec.md`'s old Step 11 split into a new Step 11 (Step 1 restructure) + Step 12 (Steps 2-4 shell + FR-11, unchanged content) with the former Step 12 (verification) renumbered to Step 13 (**Total Steps 12 → 13**), and `product-spec.md`'s Out-of-Scope clause given a narrow, cited exception for Step 1 only. FR-10 is now **fully resolved** and no longer needs interactive confirmation before `/sdd-execute`; FR-5, FR-9, FR-2 (recharts-version), and the `insights/page.tsx` Deferred Item are unaffected and still need it. |
| 2026-08-09 | `implementation-ready` (unchanged) | user override (Round 4) + this session | The user was asked directly about the two remaining self-run-session decisions (FR-2's recharts-version handling, and whether to fold the `insights/page.tsx` Deferred Item into scope) and **overrode both**: (1) bump `recharts` to v3 (`^3.8.0`) repo-wide instead of hand-authoring `ui/chart.tsx` against the installed v2.12.7; (2) fold `insights/page.tsx:176-199`'s second "Score Trend" chart into this feature now, as new **FR-12**. Recorded as `design.md` § Round 4 (rewrote Chosen Approach #2, added Chosen Approach #12/FR-12, updated Rejected Alternatives and Open Risks; **Rounds 3 → 4**), `product-spec.md` (new FR-12 with its own acceptance-criteria line, Affected Services and Consumer Surface updated to include `insights/page.tsx`, FR-2 text corrected for the v3 bump), and `implementation-spec.md` (new Step 2 — repo-wide `recharts` bump + minimal `CartesianGrid` `xAxisId`/`yAxisId` fix on `EquityCurveChart.tsx`/`insights/page.tsx` to keep `pnpm build` green; new Step 7 — FR-12's `insights/page.tsx` migration; every subsequent step renumbered; **Total Steps 13 → 15**; the former `## Deferred Item` section retained only as a superseded historical record). Recon (`design.md` § Round 4) confirmed `EquityCurveChart.tsx`'s `Scatter` usage never used the removed `points` prop and neither file uses `activeIndex`/`Customized`/`ref.current.current` — the only real v3-breaking-change code fix needed in either existing chart is the `CartesianGrid` `xAxisId`/`yAxisId` addition. FR-2 and FR-12 are now **fully resolved**; only **FR-9** (the `@shadcn/react` CLI-vendored install path/version pin) remains adversarially-vetted but not live-gated. |
| 2026-08-09 | `implementation-ready` → `in-progress` | /sdd-execute sequential | Branch created (`feature/shadcn-migration-custom-composites`, stacked on `feature/shadcn-migration-low-confidence`). A live confirmation attempt for FR-9 (the one remaining unconfirmed item) did not yield an interactive answer in this execute session; execution proceeds on `design.md`'s own already-adversarially-vetted Chosen Approach #9, with Step 12's own live-registry re-verification as the concrete mitigation (see Next Action note above). Execution begins against all 15 steps. |
| 2026-08-09 | `in-progress` → `code-completed` | /sdd-execute sequential | All 15 steps done. Step 13 (FR-10 Step 1 restructure) found a genuine `Questionnaire.Next`/`Previous` single-item-visibility mismatch (resolved via a plain-`Button` `IdentityNav` helper) and a pre-existing latent edit-mode bug the restructuring surfaced (hyphenated legacy strategy IDs permanently blocking Next — fixed, scoped to create-mode only); captured a genuine red state (10 failed/8 passed) before rewriting the e2e spec's Step-1 click sequencing, then 23/23 green. Step 14 (FR-11 step indicator) found the identical registered-item-architecture mismatch applies to `Questionnaire.Progress`/outer nav too — resolved via the implementation spec's own built-in escape hatch (Progress adopted via a zero-item Root driven entirely by `children`; outer nav Buttons kept, no shell wrap needed). Step 15's whole-feature pass: `pnpm lint`/`build` clean, 43/43 across the three required e2e specs, plus a temporary (never-committed) Playwright script standing in for the manual-verification checklist on the four files with no e2e coverage — all passed, no defects found. Draft PR [#914](https://github.com/davcs86/xstockstrat/pull/914) ready to flip to ready-for-review. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated architecture (chosen approach, rejected alternatives, open risks — **FR-10 resolved via direct user override, § Round 3; FR-2 (recharts v3 bump) and FR-12 (insights/page.tsx second chart) resolved via direct user override, § Round 4; only FR-9 still flagged for user confirmation, see header note**)
- [Implementation Spec](implementation-spec.md) — 15 steps (Step 11 split into Step 1's native-model restructure + Step 12's unchanged Steps 2-4 shell per the FR-10 override; new Step 2 — repo-wide `recharts` v3 bump — and new Step 7 — FR-12's `insights/page.tsx` migration — added per the Round 4 override; **Total Steps 13 → 15**), generated by `/sdd-spec`
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the
Combobox finding (already resolved by `119-shadcn-ui-migration` — verification only), consolidate the
app's three independent charting approaches onto the official shadcn `Chart` primitive where the shape
fits, extract a shared shadcn-primitive-based composite for the app's three repeatable-row editors
(`OutputEditor`, `ParameterEditor`, `RuleEditor`'s condition builder), and adopt the shadcn
`Questionnaire` primitive for `StrategyWizard`'s step shell.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

All 15 implementation steps are done (`code-completed`). Flip draft PR
[#914](https://github.com/davcs86/xstockstrat/pull/914) to ready-for-review; this is the fourth and
final feature in the 120→121→122→123 stacked sequence.

**FR-5 is resolved** (2026-08-08, direct user confirmation: keep `lightweight-charts`, matching the
self-run session's recommendation — see `design.md` § Chosen Approach #5 and the applied
`services/xstockstrat-ui/CLAUDE.md` § Styling sanctioned-exception note).

**FR-10 is resolved** (2026-08-08, direct user override — see `design.md` § Round 3 and the Status
History row above): Step 1 restructures onto `Questionnaire`'s native Choice/Input answer model (4
nested sub-screens, `implementation-spec.md` Step 13); Steps 2-4 stay shell-only exactly as Round 2
originally concluded (`implementation-spec.md` Step 14). No further confirmation needed for FR-10.

**FR-2 and FR-12 are resolved** (2026-08-09, direct user override — see `design.md` § Round 4 and the
Status History row above): `recharts` bumped to v3 (`^3.8.0`) repo-wide instead of hand-authoring
`ui/chart.tsx` against the installed v2.12.7 (`implementation-spec.md` Step 2, then Step 3); the former
`insights/page.tsx` Deferred Item is now in-scope as FR-12 (`implementation-spec.md` Step 7). No further
confirmation needed for either.

All 15 steps are done and the whole-feature gate is green. Draft integration PR:
[#914](https://github.com/davcs86/xstockstrat/pull/914) (stacked on
`feature/shadcn-migration-low-confidence`) is being flipped to ready-for-review.

**Still not explicitly re-confirmed by the user** (adversarially vetted over 2 debate rounds with no
Floor breach and no dissenting objection, but never put through a live `AskUserQuestion` gate — the
`/sdd-design` session that produced `design.md` had neither `AskUserQuestion` nor `Task` available):
**FR-9 only** — the CLI-vendored `@shadcn/react` install path (pinned to an exact version),
`design.md` § Chosen Approach #9. **2026-08-09 execute-session note**: a live confirmation gate was
attempted at the start of this execute session but no interactive response was obtainable (the
orchestrating session's tool surface did not deliver one); execution proceeds on `design.md`'s own
already-adversarially-vetted Chosen Approach #9 (CLI-vendored `npx shadcn@latest add questionnaire`,
`@shadcn/react` pinned to an exact re-verified-current version) rather than blocking indefinitely.
Step 12 re-verifies the live npm registry version immediately before running the CLI, per its own
Instruction 1 — this is the concrete mitigation for proceeding without the live gate.
