# Design: fix-opportunity-composite-score

**Mode**: quick — the one design fork (band edges) was put to the operator directly and decided
(AskUserQuestion, 2026-10-06); no proposer/adversary round was needed beyond that decision.

## Decision

Centred diverging bands for `composite_score`, independent of the strategy-grade `scoreColor`:

| Composite | Class | Meaning |
|---|---|---|
| `> 0.58` | `text-buy` | positive tail |
| `0.42 – 0.58` (inclusive) | `text-muted-foreground` | neutral (shrinkage point 0.5 ± 0.08) |
| `< 0.42` | `text-sell` | negative tail |

Rationale: the composite is a k=1 empirical-Bayes shrinkage toward 0.5 with reachable range ≈0.25–0.83
(one maxed axis caps at 0.750), so grade thresholds (0.6/0.8) made neutral read red and a single-axis
composite could never read green. ±0.08 keeps the neutral point muted while one maxed axis (0.75)
reads positive.

## Rejected

- ±0.05 band — colours small signal drift.
- 5-tier (mild/strong per side) — more threshold surface to govern for no decision value.
- `text-destructive` for the negative tail — destructive is the error/alert role; `text-sell`
  (loss) is the directional token.

## C-16

Supersedes feature 199 `@AC-8`'s "colored via the existing scoreColor scale" clause (not yet promoted
to a durable suite); its other clauses (3-decimal, no grade, no client re-sort) are preserved.
