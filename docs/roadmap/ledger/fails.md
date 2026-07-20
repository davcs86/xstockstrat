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
