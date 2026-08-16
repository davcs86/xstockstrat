# Design: fix-listorders-ambiguous-updated-at

**Created**: 2026-08-16
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-08-16
**Grounded in**: recon.md

---

## Chosen Approach

Fix the ambiguity at its source rather than at each of the three call sites: rename the LATERAL
subquery's own projected column instead of qualifying the outer SELECT lists.

`intentLateralJoinSQL` (`services/xstockstrat-trading/internal/repository/trading_repo.go:85-90`)
changes from:
```sql
LEFT JOIN LATERAL (
    SELECT state, updated_at FROM trading.order_intents
    WHERE order_id = trading.orders.order_id
    ORDER BY updated_at DESC LIMIT 1
) li ON true
```
to:
```sql
LEFT JOIN LATERAL (
    SELECT state, updated_at AS intent_updated_at FROM trading.order_intents
    WHERE order_id = trading.orders.order_id
    ORDER BY updated_at DESC LIMIT 1
) li ON true
```
The inner `ORDER BY updated_at DESC LIMIT 1` still resolves unambiguously to
`trading.order_intents.updated_at` (unaffected by the output alias — it's evaluated inside the
subquery, before the alias is applied to the projected column). Verified via grep
(recon.md) that `li.updated_at` is referenced nowhere in the codebase — only `li.state` is ever
consumed from the lateral join — so this alias is a pure rename with zero consumers to update.

This is a **single-site, one-line fix** (vs. qualifying `updated_at` as `trading.orders.updated_at`
at each of `GetOrder:97`, `ListOrders:125`, `ListSubmittedOrders:211`) that structurally forecloses
the whole bug class: since no second column literally named `updated_at` exists in the joined
range after this change, a future 4th caller built on `intentLateralJoinSQL` cannot reintroduce
this ambiguity by omission the way the original three call sites did.

No consumer-surface change — this is an internal query fix with no UI/Agent-tool-visible behavior
change (C-14 n/a).

### Testing

Three `pgxmock`-based regression tests in a new `trading_repo_test.go` (the first repo-level test
file for this service), one per affected function (`GetOrder`, `ListOrders`,
`ListSubmittedOrders`), each populating a mocked `order_intents` row so the LATERAL join path is
genuinely exercised (not bypassed), asserting the returned `Order.UpdatedAt` reflects the
`trading.orders` row's own value (not the intent's), and asserting `mock.ExpectationsWereMet()`.
`ListOrders`'s test additionally exercises ≥2 optional WHERE filters together, as defensive
coverage for the function `fails.md` already flagged for a prior (different) bug in its
positional-arg builder — named explicitly here as intentionally-added coverage beyond this bug's
literal scope, not silently bundled.

A minimal `dbQuerier` interface (`QueryRow(...) pgx.Row; Query(...) (pgx.Rows, error)` — broader
than the cited `xstockstrat-portfolio` `queryRower` precedent, which only needed `QueryRow`) is
added to `TradingRepo` alongside the existing `pool *pgxpool.Pool` field (constructor sets
`db: pool`; `Pool()` accessor and every existing caller — `AccountRepo`, `OrderIntentRepo`,
`BracketRepo` — keep working unchanged since `pool` is not removed, only supplemented).
`pgxmock` is added as a new test-only dependency (`go.mod`/`go.sum` — named explicitly here so the
implementation-spec step lists them in its Files section per **F-08**).

If two or more of the three tests end up sharing substantially the same order-row/intent-row
fixture shape, centralize the literal into `internal/testdata/` at the second consumer per
**C-13** rather than leaving duplicated inline literals — `/sdd-spec` should verify this concretely
against the actual test bodies once written, not assume either way here.

## Rejected Alternatives

- **Qualify `updated_at` as `trading.orders.updated_at` at each of the 3 outer SELECT lists**
  (the product-spec's original literal prescription) — rejected because it's a larger diff (3
  edit sites vs. 1) that doesn't foreclose the bug class for a future caller of the shared
  `intentLateralJoinSQL` const the way the chosen single-site rename does. User explicitly chose
  the rename over this alternative.
- **Plain string-constant unit test, no DB seam** (extract the SELECT column list into a shared
  string constant, assert via pure Go string matching that no bare `, updated_at,` pattern
  remains) — rejected because it doesn't "exercise the LATERAL join with a populated
  `order_intents` row" as the acceptance criteria require; a static-shape check, not a runtime
  exercise. Real `pgxmock` tests chosen instead (user explicitly chose the 3-test option).
- **One targeted `pgxmock` test covering only `ListOrders`** (the function `fails.md` already
  flagged) instead of one per function — considered as a smaller-diff option but rejected; user
  chose full 3-test coverage given all three functions are independently part of the product-spec's
  Fix Scope and Acceptance Criteria.

## Open Risks

- [ ] `pgxmock` never parses real SQL — it cannot detect a differently-shaped ambiguity/typo the
      way real Postgres would. The product-spec's "smoke-tested against a live DB... if a live-DB
      harness is available" fallback is satisfiable locally via `docker-compose`'s TimescaleDB
      (distinct from "no live Postgres reachable in this agent's sandbox"). To be addressed at
      execute time: run the fixed `ListOrders` against local `docker-compose` Postgres as a manual
      smoke-test step before the PR is considered done, and record the result in context.md.
- [ ] C-13 fixture-centralization question (see Testing section above) — to be resolved concretely
      once the three test bodies are written at execute time, not assumed here.

## Constitution Rules Touched

- `C-01` (evidence-cited claims) — honored: every claim above cites real `path:line` from recon.md,
  itself grounded in direct file reads.
- `C-08` (test-step pairing) — honored: each `service` step in the eventual implementation spec
  pairs with an immediately-following `test` step exercising it.
- `C-13` (test-data canonical fixture home) — at risk, not yet resolved (see Open Risks); must be
  concretely checked at spec/execute time against the real test bodies.
- `C-14` (consumer-surface reachability) — n/a: internal query fix, no UI/Agent-tool surface.
- `F-04` (never invent — unfound stays unfound) — honored: recon confirmed via grep that
  `intentLateralJoinSQL` has exactly 3 call sites and `li.updated_at` has 0 consumers; nothing was
  assumed.
- `F-08` (never stage files outside a step's declared Files section) — honored by design: the
  `go.mod`/`go.sum` dependency addition from `pgxmock` is named explicitly here precisely so
  `/sdd-spec` lists it in the relevant step's Files section.
- No Floor (`F-*`) breach identified at any point in the debate.
