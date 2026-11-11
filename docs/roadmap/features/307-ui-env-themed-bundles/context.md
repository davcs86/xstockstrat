# Context: ui-env-themed-bundles

**Feature**: `docs/roadmap/features/307-ui-env-themed-bundles/feature.md`
**Product Spec**: `docs/roadmap/features/307-ui-env-themed-bundles/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/307-ui-env-themed-bundles/implementation-spec.md`

---

## Session 2026-11-10 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (AskUserQuestion, 2026-11-10): (1) build-time Docker `ARG UI_THEME`, one image per deploy workflow, tags unchanged — rejected two-images-per-build and a runtime switch; (2) staging keeps Nocturne, production gets a NEW theme; (3) unset `UI_THEME` → staging (fail-safe: non-prod builds never look like prod).

## Session 2026-11-10 — sdd-review product-spec

- First pass FAIL (C-11: 3 unchecked Open Questions). Fixed: palette deferred to /sdd-design (operator owns), oklch trap → FR-9, APPLICATION_ENV trap → FR-10; FR-4 process clause removed; AC-6 rewritten as image outcome; AC-9 (docker build-arg), AC-10, AC-11 (staging chart) added.
- Second pass: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings: AC-1/AC-2/AC-8 use symbolic palette values — firm up after design approves palette; AC-10 is a behavioral proxy for FR-10 (consider a source-level guard); docker-build.yml needs per-service build-arg plumbing for the xstockstrat-ui matrix leg only.
- Overlap findings: none (297/298 share no files with 307).
- Recommended design depth: quick (single service + CI plumbing; no proto/config/DB gates).

## Session 2026-11-10 — sdd-design (quick → operator requested round 2)

- Phase 0 Recon: wrote recon.md. Found a third docker-build.yml caller (homelab-images.yml) and the SHA-tag collision risk.
- Round 1: the proposer proposed a webpack alias `@theme-tokens` → `src/styles/themes/{staging,production}.css` with a next.config.js allow-list, a Docker ARG plus `io.xstockstrat.ui-theme` label, and a homelab guard. The adversary returned NEEDS WORK with no Floor breach. HIGH items:
  - the guard fails open and its jq shape is unproven;
  - DO prod-up/staging-up are unguarded;
  - homelab-images can re-theme a prod tag;
  - the bundle check doesn't run on PRs;
  - the oklch `getComputedStyle` ledger trap applies;
  - AC-10 was optional;
  - @AC-19 is narrowed.
- Operator decisions (AskUserQuestion, 2026-11-10):
  - **@AC-19 CHANGE signed off.** "A manual run redeploys an already-built SHA *whose UI theme label matches the target*." A pre-307 unlabelled image passes silently on staging and with a warning on production.
  - **Contrast:** fix it in the production palette by lifting `--primary` lightness to about 0.62 with a dark `--primary-foreground`. Write the baseline into ui-ux-governance §5. Staging shortfalls become known deviations (staging values stay frozen).
  - **Scope widened: tokenize everything now.** The ~28 /insights literals become tokens and the manifest/themeColor become per theme. The operator accepts that staging /insights colors move to the Nocturne tokens. Added FR-11..FR-14 and AC-12..AC-16. This is a post-review scope change, so re-run `/sdd-review product-spec` is advisory before /sdd-spec.
  - Gate: the operator chose **Run another round**.

## Session 2026-11-10 — sdd-review product-spec (re-run after scope widening)

- Re-review: PASS WITH WARNINGS (W1–W8), no blockers, no Floor breach. Overlap: CLEAN; `ci.yml` is rebase-only shared with in-flight 297/298.
- Warnings addressed (operator asked to address all):
  - W1: FR-8 reconciled with FR-11. AC-7 now covers `/insights` (@FR-11).
  - W2: C-16 @AC-19 @feature-279 CHANGE sign-off and an advisory Platform Lead review recorded under Feature Workflow Notes.
  - W3: Affected Services enumerates every UI file area, the CI workflows (including prod-up/staging-up/homelab-images/Dockerfile.e2e/ci.yml) and the docs.
  - W4: palette Open Question kept `[x]` with an explicit exit condition. AC-1/AC-2/AC-3 now pin the concrete Nocturne literals. AC-1/AC-8/AC-13 carry "literal pinned from design.md" placeholders to fill at the design gate.
  - W5: the AC-12 literal-scan regex is tightened (non-comment lines, .ts and .tsx, tests excluded) and the sidebar.tsx:455 fix is asserted.
  - W6: AC-14 covers the full FR-13 pair set. New AC-17 covers the staging known deviations.
  - W7: FR-14 states the unlabelled-image policy. AC-16 is now a Scenario Outline over deploy-homelab, staging-up and prod-up, in both directions and for unlabelled images.
  - W8: FR-12 names `--background` hex as the single source; the mechanism is deferred to design.md.
- Earlier-review warnings now closed by design inputs: AC-10 is a proxy (round 1 made AC-10 mandatory); docker-build.yml per-leg plumbing (round 2 brief A).
- Status unchanged (`spec-ready`).
- Confirming pass: W1–W8 verified resolved. PASS WITH WARNINGS, with 4 minor new warnings, all addressed:
  - N1: AC-17's `Then` is now observable (computed staging failing set == the §5 list).
  - N2: AC-16 `Then <outcome>` now has full-sentence outcomes.
  - N3: FR-11 and Out of Scope include the `sidebar.tsx` shadow utility.
  - N4: AC-17 states the ratio to one decimal (≈2.6:1, using round 2's computed staging value instead of the earlier 2.4 estimate), pinned from design.md.

## Session 2026-11-10 — sdd-design round 2

- Round 2 proposer: complete revised design.
  - Shared helper, label-check script, bundle check chained into `pnpm build`, manifest route handler, tokenization map, full production palette with contrast figures, 9-step breakdown.
- Round 2 adversary: NEEDS WORK, no Floor breach. It recommended approving after fixes.
  - HIGH: the in-leg re-theme guard leaves a version-skewed partial push; the AC-10 grep collides with other features' @AC-10 titles; AC-7 is under-covered.
  - MEDIUM: `@theme inline` `--color-buy` var emission is unproven; `--warning` is duplicated into theme files; `build/` is outside the guard rails; CJS-in-vitest; the paths filter is too narrow; the AC-12 scope; the AC-1/AC-2 leak scope; the layer-order assertion and per-theme cache are YAGNI; keep platform `@AC-10`/`@AC-42` wording and placement.
- Operator decisions (2026-11-10):
  - **Re-theme guard:** preflight job before the build matrix (all-or-nothing push). Hotfix and other back-merges into main-dev must be `--no-ff`; document this in the feature-workflow and hotfix runbooks.
  - **Chart contrast:** fix it now. Production chart series (chart-1..5) must meet 3:1 non-text on `card`. Staging chart ramp shortfalls are recorded as §9 deviations, since staging is frozen.
  - Gate: **Run round 3**.
- Pending operator confirmation at the round-3 gate: staging PWA chrome `#0a0e14` → `#0c0a09` (implied by FR-12).

## Session 2026-11-10 — sdd-design round 3

- Round 3 proposer: final consolidated design.
  - preflight job; `--no-ff` docs ×3; path-scoped AC-10; 3 aria goldens; `--color-warning` in `@theme inline`; helper/checker as `.cjs` under `src/styles/themes/`
  - selector-agnostic bundle check (a)(b)(c), unlayered `:root`
  - one production CI job plus a no-push prod Dockerfile build
  - revised production chart-1..5, all ≥3:1 on card/bg
  - pinned literals: AC-1 primary `oklch(0.63 0.16 262)`; AC-8 18.07/5.46; AC-13 `#080d17`/`#0c0a09`; AC-17 = 8 staging pairs
- Round 3 adversary: NEEDS WORK, no Floor breach.
  - **CRITICAL:** `sync-main-to-maindev.yml:52` fast-forwards main-dev onto the promotion merge commit, so dev and prod build the same `<sha>` with opposite themes on every promotion. The recon premise "SHAs are distinct" was false (recon.md corrected; matches ledger fails.md:159-174 "false premise, load-bearing").
  - HIGH: missing `--no-ff` doc sites (hotfix PR template, promote skill).
  - MEDIUM: the checker must ignore self-map `var(--same)`, and the second spike fallback is dead (the `--font-sans` self-map already builds); check (b) must exclude Tailwind default-palette props; split the no-push prod build into a parallel job using build-push-action.
  - LOW: drop the aria pathTemplate override; golden-generation mount; `.cjs` lint RED evidence; §5 list fences; preflight needs `actions/checkout`.
- Operator decisions (2026-11-10):
  - **Sync `--no-ff` accepted**, plus a CI static guard. One tree-identical merge commit per promotion is accepted.
  - **deploy.yml `require-match` added** (defense in depth).
  - **Staging PWA chrome `#0c0a09` confirmed.**
  - Gate: **Run round 4** (cap 5).
- Spec updated: FR-14 (deploy.yml check, `--no-ff` everywhere), Affected Services (sync workflow, deploy.yml, back-merge docs), AC-16 deploy.yml row, new AC-18.

## Session 2026-11-10 — sdd-design round 4

- Round 4 proposer:
  - sync `--no-ff` with the BEHIND/conflict paths proven unaffected
  - static guard plus a git fixture for AC-18
  - deploy.yml `require-match` in the `validate` job, needing no caller permission edits
  - 6 back-merge doc sites
  - checker self-map skip; dead fallback cut
  - (b) excludes Tailwind palette declarations; strict AC-1 pin (b′)
  - separate `ui-prod-image-build` CI job; lockfile dropped from the filter
  - full objection ledger shows R1–R3 resolved
  - Found that `--no-ff` breaks the promote "nothing to promote" commit-count gate.
- Round 4 adversary: NEEDS WORK, no Floor breach; recommends approving with the fixes.
  - H1: no `concurrency` on the sync, and the retry never re-merges, so `--no-ff` makes the two-sync race (M then S) stick red and drop S. Verified: no concurrency group, retry only re-fetches.
  - M1: the promote gate must be three-dot.
  - M2: shell-lint must trigger on edits to all 7 guarded workflows (`fails.md:1941-1953`).
  - M3: Tailwind ≥4.1 opacity modifiers inline palette literals in `color-mix()` fallbacks (`alert.tsx:15,17`, `badge.tsx:25-26`). The parser handles `%` L, alpha and `color-mix`; the exclusion becomes value-based with the generic `^--color-[a-z]+-(50|[1-9]00|950)$`.
  - L1: document the emerald-800 trap.
  - L2: hermetic fixture (`-b main`, identity, `GIT_CONFIG_GLOBAL=/dev/null`).
  - L3: check `--no-ff` against the whole line.
  - L4: reword 5 "permanently ahead" docs.
  - L5: single registry source.
  - L6: record the @AC-19 CHANGE in recon (done).
- Operator decisions (2026-11-10):
  - **Include the promotion-automation fixes in 307.** Added FR-15 (three-dot promote gate, sync `concurrency`, doc rewording) and AC-19 and AC-20.
  - Gate: **Run round 5 (final, hard cap)**.

## Session 2026-11-10 — sdd-design round 5 + round-cap override

- Round 5 proposer: complete self-contained final design (supersedes R1–R4). Scratchpad copy: `307-proposal-r5.md`.
- Round 5 adversary: no Floor breach, no BLOCKER; APPROVE-WITH-RISKS conditional on 6 FIX-IN-SPEC items:
  1. Tailwind v4 scans test files and CLAUDE.md for class names, so checker fixtures and trap docs could plant stone/emerald/zinc utilities and fail every production build. Fix: `@source not` / concatenated names, and name the production CI jobs as S4's gate. Verified: no stone/emerald/zinc utility in `src` today.
  2. `scripts/sops-secrets.test.sh:1031-1032` pins prod-up's `uses:` list exactly, and `:1083` forbids `uses:` after resolve in deploy-homelab, so GHCR login must be a `run:` step and the pins must be updated (verified by orchestrator).
  3. The AC-10 runs can't compare across processes, so each asserts the pinned staging bg. The §9 assumption is corrected: `traderBff.ts:27`/`insightsBff.ts:29` also read `nativeConfigEnvironment`, which is config scope only.
  4. The registry drift test must compare the repo prefix (`${UI_IMAGE_REPO%/xstockstrat-ui}`).
  5. Fixture: a `git_q` identity wrapper on every command, a base commit, `--no-edit` on the merges.
  6. AC-9 map wording: the CSS assertion rides on the in-Dockerfile checker.
- Acceptable risks: a third push in the sync window cancels a pending run; `git diff` exit ≥2 is ruled out by fetch-depth 0; MERGE_COUNT is cosmetic.
- **Operator override (2026-11-10): "Override round cap, do as many as you need to converge."** This is an explicit sign-off overriding the sdd-design 5-round hard cap.
  - Convergence criterion (orchestrator): a round whose adversary returns zero BLOCKER and zero FIX-IN-SPEC findings (acceptable risks only), then the approval gate goes back to the operator.

## Session 2026-11-10 — sdd-design round 6

- Round 6 proposer: complete design (scratchpad `307-proposal-r6.md`) resolving the 6 R5 items, plus 26 dependent tests/pins mapped to steps.
  - `globals.css:1` becomes `@import 'tailwindcss' source('..')` with `@source not` for tests and the theme dir.
  - GHCR login as `run:` steps; new `group_uitheme` in sops-secrets.test.sh.
  - AC-10 asserts `#0c0a09`; registry prefix drift check; fixture written out.
  - AC-9 cache-proof checker re-run on CSS extracted from the image.
- Round 6 adversary: no BLOCKER; 4 FIX-IN-SPEC, 3 acceptable risks.
  - F1: S4's `ui-prod-image-build` uses `--css-dir`, which only arrives in S5. Move the CLI into S1.
  - F2: both new CI jobs lack checkout, setup-buildx, `context: .` and `load: true`. Copy `ci.yml:540-554`.
  - F3: a palette-collision class fails only production builds, which run in PR CI only under the narrow filter. A `src/components/ui/**` (shadcn preset) PR would merge and then break deploy-prod.
  - F4: the shellcheck SC2015/SC2016 directive scope. Use a file-level disable (house style, sops-secrets.test.sh:4).
  - A1: place the `@source not` lines after both `@import`s.
  - A2: `--color-paper`/`--color-warning` emission is S1 Open Risk 1.
  - A3: the directive syntax can't be checked offline (no node_modules); S1/S5 prove it.
- Operator decision (2026-11-10), F3: **symmetric palette self-check.** Every build (including the always-run staging e2e build) fails if any emitted Tailwind palette value is within ±1 of a non-shared token of EITHER theme. The PR CI filter stays narrow.

## Session 2026-11-10 — sdd-design round 7

- Round 7 proposer: complete design, scratchpad `307-proposal-r7.md` (1001 lines).
  - Checker CLI moved to S1; sequencing audit fixed 5 more ordering errors (e.g. splitting the ci.yml:705 chain across S9/S10).
  - Full YAML for both CI jobs; build-push pin corrected to @v6.
  - New symmetric check (d) per the operator F3 decision; (b′) folded into tests.
- Round 7 adversary: no Floor breach, 0 BLOCKER, 5 FIX-IN-SPEC, 4 acceptable risks.
  1. `sidebar.tsx:322,356` `[--radius:var(--radius-xl)]` makes check (a) fail every build. Narrow (a) to literal values (skip `var(`/`calc(`) and add a fixture. Verified by orchestrator.
  2. S6's `noColorLiterals.test.ts` fails because `layout.tsx:20` `#0a0e14` only changes in S7. Verified. Same pattern as fails.md:3217.
  3. S5's scan must define colour functions with `var()` args as non-literals (`sidebar.tsx:455` survives until S6).
  4. A pre-computed translucent palette literal (e.g. future `bg-white/10` → `#ffffff1a` == staging `--border`) passes staging CI and fails deploy-prod. This is a gap in the F3 guarantee. Fix: (b) symmetric in every build, i.e. any non-token colour literal colour-equal to a non-shared token of EITHER theme fails. This subsumes (d). Adopted as a refinement of the operator's F3 decision, not a new decision.
  5. Editorial: S3 range `:82-125` must be `:83-125` (`:82` is `@layer base {`, verified); the S1 CLI loads globals.css only.
- Acceptable: color-mix collapse (the @supports branch keeps var); `chart.tsx:66` escaped `\#ccc`/`\#fff`; a shadcn re-apply writing `:root` back fails closed (note in S11 docs); hand estimates.

## Session 2026-11-10 — sdd-design round 8 (+ container restart)

- Round 8 proposer: R8 design (scratchpad `307-proposal-r8.md`).
  - (a) checks literal values only.
  - Precise tokenizer: comments, selectors and at-rule preludes stripped; strings/url()/escapes skipped; var()/`from` colour functions are non-literals; color-mix operands extracted; named colours skipped (Open Risk 12).
  - Symmetric (b) in every build replaces (d).
  - themeColor edit moved into S6.
  - globals.css range `:83-125`; the S1 loader loads globals.css only.
- The container restarted mid-review. The round-8 adversary was re-run; the scratchpad survived.
- Round 8 adversary: 0 BLOCKER, 1 FIX-IN-SPEC, 5 acceptable.
  - Independent false-fail enumeration of today's emitted literals (preflight, `--tw-*` defaults, shadcn primitives, translucent fallbacks): no collision in either theme. Tightest margin is `#fff` vs staging `--foreground`, Δ5.
  - F1: S6's `hsl(var(` ban over all of `src` matches the S1/S5 test fixtures (fails.md:3950 class).
- Orchestrator applied the R9 delta (scratchpad `307-proposal-r9.md`):
  - F1: ban dropped (C-18); the AC-12 sidebar.tsx assertion is kept.
  - AR2: `color()` added to the S1 inventory; parser clamps out-of-gamut channels.
  - AR3: S1 selector-diff wording.
  - AR4: S3 updates the stale `chartColors.ts:6` comment.
- Next: round-9 adversary confirmation pass on R9.

## Session 2026-11-10 — sdd-design (completion)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui plus CI/deploy/promotion workflows). Reuse patterns: `@theme inline` as the single token mapping; `chartColors.ts` format-agnostic resolver; the `docker-build.yml` reusable matrix; the `deploy-homelab.yml` GHCR login idiom.
- Phase 1 Grilling: 9 rounds. `quick` was requested, then the operator chose more rounds and overrode the 5-round cap. Converged at round 9: 0 BLOCKER / 0 FIX-IN-SPEC.
  - Chosen approach: build-time `UI_THEME` → webpack alias to `src/styles/themes/{staging,production}.css`, allow-list in next.config.js. A bundle checker ((a) literal token values, (b) symmetric leak scan, (c) shared roles) is chained into `pnpm build`.
  - Images: theme label, re-theme preflight, `require-match` on deploy-homelab/prod-up/staging-up/deploy.yml.
  - Promotion: `--no-ff` back-merges, serialized sync, three-dot promote gate.
  - FR-11 tokenization, per-theme manifest route, documented contrast baseline.
  - Rejected: runtime switch, two images per build, theme-suffixed tags, prebuild copy, `[data-theme]` scoping, in-leg guard, app/manifest.ts, skip-deploy-dev, prerequisite split (full list in design.md).
- Constitution rules touched: C-01, C-02, C-08, C-10, C-11, C-12, C-13, C-14, C-15, C-16, C-17, C-18, P-03, P-06, F-02, F-04, F-05, F-06, F-07. Floor breaches: none.
- Business rules: one CHANGE (platform.feature `@AC-19 @feature-279`, operator-signed); all others PRESERVE.
- acceptance.feature literals pinned:
  - AC-1 `oklch(0.63 0.16 262)`
  - AC-8 18.07 / 5.46
  - AC-13 `#080d17` / `#0c0a09`
  - AC-17 2.6:1
- Ledger: 2 fails.md entries (the SHA-disjointness false premise; build guard vs. Tailwind scan scope).
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] S1 spike: shared-role (`--color-buy/sell/paper/warning`) emission under `@theme inline` after the scan-scope edit; fallback is an unlayered `:root`; record the emitted literal inventory (incl. any lab/lch/oklab/`color()`/named colours) — target S1
- [ ] Tailwind `source()` / `@source not` directive validity on 4.3.3 — target S1 (diff), S5 (probe)
- [ ] S2 spike: manifest route handler headers, route classification, single `<link rel=manifest>`; else the generated-public-file fallback — target S2
- [x] Use `NEXT_DISABLE_STANDALONE=1` for the local `pnpm start` checks (S2/S6/S7) — applied in impl-spec Steps 3, 10, 12 (SD-3)
- [x] Container-written aria goldens may need `chown` — resolved in impl-spec Step 14 (golden generation via `docker run` + `docker cp`, host-owned files)
- [ ] Default `GITHUB_TOKEN` grants `packages: read` to called workflows — target S9 (first CI run)
- [ ] Live verification on the first promotion after merge: two sync runs serialized, main-dev ⊇ {M, S}, deploy-dev tags X ≠ M (AC-18/AC-20) — target post-merge
- [ ] AC-6 end-to-end on the first real dev and prod deploys — target post-merge
- [ ] Next 16 / Turbopack: alias needs `turbopack.resolveAlias` (documented in UI CLAUDE.md) — target S11 doc
- [ ] Accepted risks: TOCTOU preflight vs. push; three-dot residual for conflict-resolved sync PRs; (b) false positives by design (fix = use a theme token); named-colour minifier residual — no action

## Session 2026-11-11T00:00Z — sdd-spec

- Tree: `feature/ui-env-themed-bundles@d4bd9db ≡ origin/feature/ui-env-themed-bundles` (origin/main-dev already merged).
- Generated implementation-spec.md with 19 steps. Status → implementation-ready.
  - design S1–S11 map 1:1 onto Steps 1–19.
  - Each code-bearing design step is split into a service+test pair joined by `**Lands with**`: 1+2, 4+5, 6+7, 8+9, 10+11, 12+13, 15+16, 17+18.
  - Step 3 = the S2 manifest-route spike (nothing committed except this log).
  - Step 14 = goldens; Step 19 = docs.
  - All 20 `@AC-*` scenarios are mapped in the Scenario Coverage table.
- Key codebase findings (re-verified at d4bd9db):
  - The design's `globals.css` ranges hold (`:82` `@layer base`, `:83-86` preset comment, `:87-125` `:root`, `:141` close). `package.json:8` `"build": "next build"`. `layout.tsx:3,20`. `Dockerfile:16-31`. `Dockerfile.e2e:58-65,121`. `playwright.config.ts:163`. `ci.yml` `sops:` ends at `:101`, shell-lint chain at `:705`, ci-gate needs `:1117-1140` and echo `:1145-1167`. `sync-main-to-maindev.yml:52`. `promote.yml:40-47,188-193,223`. `sops-secrets.test.sh:4,888,1021,1031-1032,1083,1385`.
  - `docker-build.yml` uses `build-push-action@v7`/`setup-buildx@v4` (`:63,82`). The new `ci.yml` jobs keep `ci.yml`'s v6/v3 pins (design §1 E).
  - The AC-12 regex has one comment-only hit, `src/lib/chartColors.ts:2`, so the `noColorLiterals` scanner must skip comment lines (Step 11).
- **Spec-time deviations from design.md** (the tree moved after design approval b39ea9a9):
  - **SD-1.** `0fecb24d` (#1503) rewrote the design's four "--no-ff doc sites" (`hotfix.md`, `feature-workflow.md`, `bug-triage.md`, `backmerge.md`). None of them holds a manual `git merge … main` command now; they defer to the automatic sync. The only live back-merge command is `sync-main-to-maindev.yml:52`.
    - Step 18's guard requires ≥1 `--no-ff` match only in the sync workflow. The doc files are still scanned, but 0 matches is allowed there (any match must carry `--no-ff`).
    - FR-14 and AC-18 are unaffected. This is flagged for `/sdd-review impl-spec`.
  - **SD-2.** The rewritten `backmerge.md:20-21` says "or the hotfix merge itself when main-dev was fast-forwarded". After `--no-ff` that is impossible, so Step 17 rewords it (an orphan statement this feature creates).
  - **SD-3.** `NEXT_DISABLE_STANDALONE=1` is applied to the local `pnpm start` checks.
- AC-17 sequencing: Step 4 writes the §5 item-8 "frozen per feature 307 FR-3" sentence plus the fence, so Step 5's test asserts both without a later docs step having to edit tests.

### Decisions (sdd-spec)
- The service+test split with `**Lands with**` keeps every commit green (F-05) and gives each `@AC-*` a test-step `**Covers**`.
- Reviewers snapshot: `xstockstrat-ui` owner; Platform Lead advisory for the CI/deploy/promotion steps (product spec Feature Workflow Notes).

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 1

- Tree: `feature/ui-env-themed-bundles@c5cd058e` (main-dev merged: context-constitution refresh, docs only).
- Result: 1 failure, 5 warnings (advisory). Overlap: WARN only. `ci.yml` is shared with spec-ready 297/298/324 and needs only a rebase; no migration, proto or config-key collision.
- Carried items, all addressed in implementation-spec.md this session (operator asked to loop until all warnings are addressed):
  - [x] Step 14 ✗ (B2 Files had a directory path): three exact `*.aria.yml` paths; named `toMatchAriaSnapshot({ name })`; `ls` verification; record the actual paths and that `page.clock` took effect.
  - [x] W1 Step 5 (C-15): AC-2/FR-3 baseline pins the 33 original `:root` pairs from `globals.css:88-124@9eaf04f` and deep-equals `staging.css`. AC-2 is added to Step 5 Covers and the coverage table.
  - [x] W3 Steps 15/17 (>5 files): one-commit instruction added.
  - [x] W4 Step 10: grep verification that `box-shadow` is emitted with `var(--sidebar-border)`.
  - [x] W5 Step 6: `ci.yml` anchors re-cited at c5cd058e (`frontend-e2e` :567, `ci-gate` :1114), plus a re-anchor-by-key instruction.
  - [x] Overlap WARN: the spec already carries the shared-file note; Step 6 now says to re-anchor by key. No merge-order row is required (non-blocking).

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 2

- Tree: `feature/ui-env-themed-bundles@468c3f52`. Result: 0 failures, 6 warnings, 0 Floor risks. All iteration-1 items were confirmed fixed. Overlap is unchanged: only this feature's own files were edited.
- All addressed this session:
  - [x] W-1: lint/tsc gates added to Step 6 (covers `playwright.config.ts` and the Step 7 spec) and Step 14.
  - [x] W-2: the coverage-threshold statement (`src/lib/**` scope, 40%) is in the Step 2/5/9/11 Verification.
  - [x] W-3: AC-6/AC-9 map to Step 6 (the `ui-prod-image-build` gate). Step 6 Covers = AC-6, AC-9; Step 7 Covers = AC-7, AC-10.
  - [x] W-4: a Step 6 deploy-file parity note (UI_THEME is a build arg, E2E_APPLICATION_ENV is test-only; compose/.do are intentionally unchanged).
  - [x] W-5: a lint command and a no-threshold statement are in the Step 19 Verification.
  - [x] W-6: design.md :500 and :883 are annotated "Superseded by implementation-spec SD-1" (annotation only; the approved design is unchanged).

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 3

- Tree: `feature/ui-env-themed-bundles@ae5246ba`. Result: 0 failures, 7 warnings, 0 Floor risks. All iteration-2 items confirmed fixed; every anchor spot-checked resolves.
- All addressed this session:
  - [x] Step 5 / Step 13: the FR-10 `APPLICATION_ENV` absence scan would have matched its own test files (fails.md:3950 / :3983 class). The needle is now built by concatenation, and `*.test.ts` is excluded.
  - [x] Steps 3 / 10 / 12: `build && start &` raced the curl check against the build. One readiness-loop form is used everywhere (build, then background only the server, poll `/auth/login`, `pkill` afterwards).
  - [x] Step 4: deploy-file parity note (build-time-only `UI_THEME` / `UI_THEME_BACKGROUND_HEX`; applies to Steps 1 and 12 too).
  - [x] Coverage-threshold statements added to every remaining test step: 3 (spike), 7 and 13 (e2e), 16 and 18 (shell).

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 4

- Tree: `feature/ui-env-themed-bundles@6e45e673`. Exhaustive pass: 1 failure, 14 warnings, 0 Floor risks. All iteration 1–3 items confirmed.
- All addressed this session. Recurring classes fixed at the root with a new **Verification conventions** block, so every step inherits them:
  - [x] ✗ Step 4: the `next.config.js` comment text would have contained the FR-10 needle `APPLICATION_ENV`, so Step 5's absence test fails (F-05; fails.md:3950/:3983 class). The exact comment text no longer contains it. New convention: no self-matching scans.
  - [x] Steps 3/10/12: unbounded readiness loop. Shared **UI-SERVE** snippet: 60 s bound, fail with "server not ready", `pkill` afterwards.
  - [x] Steps 4/8/10/19: cwd ambiguity. Convention: each item starts at the repo root; UI items carry `cd services/xstockstrat-ui &&`.
  - [x] Step 4: emitted-CSS greps tolerate lightningcss forms (`.63` / `63%`). Convention: the checker OK line is authoritative.
  - [x] Step 10: shadow grep now targets `--tw-shadow:` (Tailwind v4 composes `box-shadow` from vars). `--tw-shadow-color` alone is a FAIL.
  - [x] Steps 2/5: `spawnSync` uses an absolute script path and an explicit `cwd`.
  - [x] Step 7: named CJS-safe loader for `uiTheme.cjs` in Playwright specs (`createRequire(__filename)`); the passing form is recorded at Step 7 and reused by Steps 13/14.
  - [x] Step 17: exact replacement text for the "permanently ahead" warning, plus the constraint that no reworded line contains "permanently". Step 19 grep expects "no output".
  - [x] Steps 1/12: their own deploy-file parity notes.

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 5

- Tree: `feature/ui-env-themed-bundles@60af3be2`. Result: 0 failures, 9 warnings (6 distinct fixes), 0 Floor risks. All iteration 1–4 items confirmed.
- All addressed this session:
  - [x] UI-SERVE: `pkill -f "next start"` may miss Next's retitled process, which would leave a stale staging server to answer the production curl (false GREEN). The snippet now has a port-busy guard and a separate build-failure message, launches `node node_modules/next/dist/bin/next start` with `$SERVER_PID`, and kills that PID. `lsof` is deliberately avoided, since it is not guaranteed on CI runners.
  - [x] Step 8/9 (F-05): check (a) would fail Step 2's (c)-only/CLI fixtures. Step 9 item 0 updates them in the same pair; Step 8 Evidence notes it.
  - [x] Step 4: emitted-CSS greps read recursively (`find … -exec cat {} +`, now a convention), plus a one-commit note.
  - [x] Step 14: the golden `ls` check tolerates a `-<project>` suffix.
  - [x] Steps 14/16/18: explicit ≥40% `test:coverage` statement.

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 6

- Tree: `feature/ui-env-themed-bundles@9ef6a818`. Result: 0 failures, 4 warnings, 0 Floor risks. All iteration 1–5 items confirmed. The UI-SERVE snippet's shell semantics were verified (grouping, `$!`, exit behaviour, pnpm binary path). No new cross-step break was found.
- All addressed this session:
  - [x] Step 14: `run-e2e.sh` mounts no volume (verified at `run-e2e.sh:88-99`), so the goldens never reached the host. Generation now uses `docker run` + `docker cp` from `/workspace/services/xstockstrat-ui/…` (`Dockerfile.e2e:118`). Host-owned files mean design Open Risk 8 is resolved.
  - [x] Step 5: `vi.resetModules` does not clear the CJS `require.cache` (order-dependent cases). The cache entries for `next.config.js` and `uiTheme.cjs` are now deleted before each case.
  - [x] Step 4 Verification 4: re-run the staging build before the staging grep (item 2 leaves production CSS in `.next`).
  - [x] Step 15: deploy-file parity note.

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 7

- Tree: `feature/ui-env-themed-bundles@dc21c275`. Result: 0 failures, 1 warning, 0 Floor risks. 18/19 steps ✓. All iteration 1–6 items confirmed.
  - [x] Step 12 Verification 3: host `pnpm test:e2e` would start `pnpm dev` (`playwright.config.ts:128-133`). Switched to `./scripts/run-e2e.sh e2e/accounts/pwa.spec.ts`, and an "E2E runs" convention was added so no step uses host Playwright.

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 8

- Tree: `feature/ui-env-themed-bundles@8ae2354c`. Result: 0 failures, 3 warnings + 1 convention note, 0 Floor risks. All iteration 1–7 items confirmed.
  - [x] Step 4: `globals.css` move/delete located by content (Step 1 shifts the pre-spec `:83-126` / `:87-125` ranges).
  - [x] Step 7: explicit RED-proof command (production e2e image + `E2E_APPLICATION_ENV=production`, expected to fail).
  - [x] Step 13: FR-10 `route.ts` scan entry is conditional on Step 3 choosing the route; the fallback adds nothing.
  - [x] Conventions: "Line citations" bullet. Anchors are pre-spec; re-anchor by content/symbol/key at execute time (covers drift in Steps 10/11/12/15/17).

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 9 — converged

- Tree: `feature/ui-env-themed-bundles@1138c36b`. Result: **PASS. 19/19 steps ✓, 0 failures, 0 warnings, 0 Floor risks.** The iteration 1–8 items still hold, including the conditional branches (Step 3 route vs fallback, Step 1 shared-role fallback).
- Notes (informational, no fix required): Steps 4/15/17/19 touch more than 5 files, a recorded atomicity trade-off with one-commit instructions. Line anchors are pre-spec, governed by the Verification conventions.
- Review loop summary (operator: "loop over review impl-spec until all warnings are addressed"). Failures / warnings per iteration:
  - 1: 1/5
  - 2: 0/6
  - 3: 0/7
  - 4: 1/14
  - 5: 0/9
  - 6: 0/4
  - 7: 0/1
  - 8: 0/3
  - 9: 0/0
- Every carried item in this file's impl-spec review sessions is `[x]`. Nothing is unaddressed going into `/sdd-execute`.
- Overlap (iteration 1, still current; only this feature's own files changed since): WARN only. `.github/workflows/ci.yml` is shared with spec-ready 297/298/324 and needs a rebase; re-anchor by key.
