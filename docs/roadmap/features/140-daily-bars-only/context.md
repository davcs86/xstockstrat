# Context: daily-bars-only

**Feature**: `docs/roadmap/features/140-daily-bars-only/feature.md`
**Product Spec**: `docs/roadmap/features/140-daily-bars-only/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/140-daily-bars-only/implementation-spec.md`

---

## Session 2026-08-16 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: a direct chat instruction ("let's use this ticket to remove fetching bars different
  from 1day") arriving mid-session on the `null-fundamentals-ohlcv-gaps` bug-fix branch
  (PR #971). Per root `CLAUDE.md`'s Mandatory Entry Point rule, this is new/changed service
  behavior (not a confirmed bug), so it was routed through `/sdd-story` before any code was
  written, even though the request itself asked to fold it into the existing PR.
- **Scope clarified via `AskUserQuestion`** before writing the spec: offered a narrow option
  (ingester-only: just stop continuously fetching `15m` in the background, leave on-demand
  `GetBars`/`BackfillBars`/UI chart support for `15m`/`1h` intact) vs. a broad option (strip
  `15m`/`1h` support platform-wide — RPC surface, ingester, and UI). **User chose broad.**
- **Branch deviation (explicit, recorded per root `CLAUDE.md`'s override requirement):** this
  session is constrained to develop on and push only to the harness-assigned branch
  `claude/null-fundamentals-ohlcv-gaps-l2v4x5` (PR #971 already open against it). Rather than
  branching a fresh `feature/daily-bars-only` per the standard SDD branch model
  (`docs/runbooks/feature-workflow.md`), this feature's implementation will continue directly
  on that existing branch/PR, matching the same pattern already used earlier in this session
  for the two bug-fix reports (`docs/reports/2026-08-16-*.md`) that also live on that branch
  instead of a separate `feature/<slug>` branch. `feature.md`'s `**Development Branch**`
  field is left at the standard `feature/daily-bars-only` value per the template contract
  (SDD tooling like `/sdd-execute` reads that field), but the actual commits for this feature
  land on `claude/null-fundamentals-ohlcv-gaps-l2v4x5` — noted here as the authoritative
  record of the deviation.
- Read `docs/roadmap/ledger/fails.md`/`insights.md` for traps in this area — surfaced the
  `080-fix-backfill-timeframe-enum` defect history (canonical-string/enum handling has broken
  before) and its explicit "don't split into two features" lesson; both recorded in the
  product spec's Open Questions / Known trap section.
- Left several implementation decisions as **Open Questions** rather than assumed (historical
  `15m`/`1h` data disposition, exact RPC rejection contract, Alpaca WS 1-minute stream
  disposition, `internal/timeframe` package scope) — these are exactly what `/sdd-design
  daily-bars-only quick` should resolve next.
