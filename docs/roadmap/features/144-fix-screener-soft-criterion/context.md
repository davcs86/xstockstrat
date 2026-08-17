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
