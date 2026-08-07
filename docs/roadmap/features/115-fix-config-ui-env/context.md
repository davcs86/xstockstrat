# Context Log: fix-config-ui-env

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-07 (/sdd-triage)

- Bug reported via docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md (GitHub
  Issues disabled on this repo — no issue number)
- Severity: SEV-2
- Routed to SDD path (Track C) — defect is architecture-level and reproducible in dev, not a
  confirmed-in-production incident requiring a hotfix
- Created: feature.md, product-spec.md, context.md
- Affected services (from report): xstockstrat-ui (config-ui segment), xstockstrat-config
- Root cause hypothesis: the `environment`/`trading_mode` columns are a genuine config-scoping
  mechanism within one database, but the Config UI toggle was never gated to the deployment's own
  native scope — so it reads as a live environment switch when it can only ever reach the single
  database the running instance is bound to
- Recommended design depth: full → `/sdd-design fix-config-ui-env` (rationale: affected services ≥
  2 per the triage skill's C-0 rule — xstockstrat-ui and xstockstrat-config)
- Development branch: feature/fix-config-ui-env
- Related: companion SEV-1 defect (WatchConfig clients omitting environment/trading_mode) is being
  fixed separately on `hotfix/fix-watchconfig-clients-omit`. That fix makes this UI toggle's
  cross-scope writes reachable by real consumers again once it lands — raising, not lowering, the
  priority of gating the toggle here.

## Session 2026-08-07 (post-triage, pre-design)

- `/sdd-review fix-config-ui-env product-spec` first run FAILed on two artifact-trail issues:
  (a) a race from switching git branches while the review subagents were still reading the
  filesystem (not a real defect — feature.md/context.md exist correctly on this branch; the
  subagent just caught mid-flight branch-switch corruption), and (b) a genuine dangling reference:
  the product spec's `**GitHub Issue**` field pointed at
  `docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md`, which lived only on the
  unmerged `claude/trading-mode-env-wiring-78k60s` branch (PR #885) and was unreachable from this
  feature branch's history. Fixed by cherry-picking commit `4e36196` (the report-adding commit)
  onto `feature/fix-config-ui-env`.
- Also addressed the review's WARNING-level findings: numbered the Acceptance Criteria (AC-1/2/3),
  fixed the self-contradictory Fix Scope checkbox (config-key changes: unchecked box + "n/a" note
  → checked), and added an explicit `## Consumer Surface(s)` section naming the `/config-ui`
  segment (C-14).
- **Open design nuance to resolve in `/sdd-design`**: `APPLICATION_ENV` is set to the strings
  `"development"`/`"production"` (`.do/app.yaml:26-27`, `.do/app.dev.yaml:26`), while the Config
  UI's `env` query param and the DB's `environment` CHECK constraint use `"dev"`/`"production"`
  (`services/xstockstrat-config/migrations/002_config_environment.up.sql:8`). A naive
  `APPLICATION_ENV === env` native-scope check would never match on a dev deployment — the fix
  must normalize `"development"` → `"dev"` before comparing (mirrors what the companion Go hotfix
  already does correctly in `resolveEnvironment`: anything other than `"production"` → dev).

## Session 2026-08-07 — sdd-review product-spec

- Re-ran `/sdd-review fix-config-ui-env product-spec` after the fixes above (this time without
  switching branches mid-run). Result: **PASS**, 0 blockers, 1 advisory warning (optionally state
  the fix is UI-only/paper-safe with no market or broker interaction — not a real gap given the
  Out-of-Scope framing already covers it).
- Overlap scan (from the earlier run — unaffected by these edits, no new config keys/proto/DB):
  CLEAN. No live in-flight feature collides with 115.
- Status: draft → spec-ready.

## Session 2026-08-07 — sdd-design (Phase 0 + Phase 1, quick mode, 4 rounds)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui config-ui segment only — xstockstrat-config
  was listed as affected for its data model, not because it needs code changes; key reuse patterns:
  `TradingModeBadge` fixed-value pattern, existing `Promise<SearchParams>` Server Component convention).
- Phase 1 Grilling: 4 rounds (quick mode nominally requires 1; user requested 3 additional rounds).
  Round 1: switcher-only UI gating proposed, adversary blocked it — cosmetic, leaves the actual
  `SetConfig` write path fully reachable via direct URL/bookmark/stale tab, misreads product-spec's
  own Consumer Surface section (which names `[namespace]/page.tsx`, not just `EnvModeSwitcher`).
  Round 2: proposed BFF-layer guard (verified sound against real code) + fetch-based `native-env` API
  route for `[namespace]/page.tsx` — adversary found the route's "unauthenticated" framing didn't
  match `middleware.ts`'s actual matcher, and the fetch introduces a loading-race that reopens the
  AC-1 presentation gap. Round 3: revised to a Server Component wrapper + prop-passing split (no
  network round-trip, no race) — adversary caught an asymmetric `ENVIRONMENT_UNSPECIFIED` handling
  bug (raw exact-match would falsely reject a legitimate write on a dev-native deployment) and a C-12
  fixture-centralization gap (new BFF-guard e2e test would be a 3rd inline `SetConfig` payload
  literal). Round 4 (closing check): APPROVE, no new objections, one non-blocking citation correction.
- Chosen approach: BFF-layer `Code.FailedPrecondition` write guard in `configUiBff.ts`'s `setConfig`
  (the actual enforcement, closes every access path) + UI gating on both named consumer surfaces
  (`EnvModeSwitcher` badge, `[namespace]/page.tsx` banner + disabled Save via Server-wrapper prop).
  Rejected: switcher-only fix, fetch-based native-env route, `Code.PermissionDenied`, unconditional
  `UNSPECIFIED` rejection.
- Constitution rules touched: C-01, C-05, C-08, C-10, C-12/C-13, C-14. No Floor breaches across any
  of the 4 rounds.
- Open risk carried forward: MODE (paper/live) axis residual risk — a MODE-mismatched write is not
  orphaned the way an ENV-mismatched one is (same database, could go live on a future redeploy with
  the other TRADING_MODE) — explicitly deferred per product-spec's Out of Scope, not addressed by
  this feature. Also: `Environment.UNSPECIFIED`'s exact protobuf-es member name is inferred by
  analogy (not directly confirmed against generated stubs) — to be confirmed at `/sdd-spec`/execute
  time; `tsc` will fail loudly if wrong, so this cannot ship silently incorrect.
- Status: spec-ready → design-approved.
