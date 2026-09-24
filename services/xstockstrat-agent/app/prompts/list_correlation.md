# Correlating the list/read responses

How to stitch together the responses of `list_accounts`, `get_positions`,
`get_positions_by_account_id`, `list_opportunities`, and `list_strategies`. Join **only** on the
keys below; never invent a join that is not listed here.

## Join keys

- **`account_id`** — `list_accounts[].id` ⟷ `get_positions[].account_id`.
  Each account returned by `list_accounts` is identified by its `id`; every position from
  `get_positions` names the account that holds it in `account_id`. To list the positions of one
  account directly, pass that account's `id` as the `account_id` argument to
  `get_positions_by_account_id`.

- **`strategy_id`** — `list_strategies[].strategy_id` ⟷ `list_opportunities[].strategy_id`.
  Each stored strategy from `list_strategies` has a `strategy_id`; every opportunity from
  `list_opportunities` names the strategy that produced it in `strategy_id`. Join to recover the
  strategy definition (`display_name`, entry/exit rules, etc.) behind a ranked opportunity.

- **`symbol`** — `get_positions[].symbol` ⟷ `list_opportunities[].symbol`.
  Join what you currently **hold** (positions) to what the Decide-queue currently **recommends**
  (opportunities) for the same ticker. When an existing holding contributed to an opportunity row,
  that opportunity's `provenance` array also contains the string `"position"`.

## Non-joins (do NOT invent these)

- A **position carries no `strategy_id`.** `get_positions` / `get_positions_by_account_id` rows
  cannot be joined to `list_strategies` — there is no field linking a holding to the strategy that
  recommended it. If you need that link, go through `symbol` to `list_opportunities` (which does
  carry `strategy_id`), and treat the result as an inference, not a stored fact.
- An **opportunity and a strategy carry no `account_id`.** `list_opportunities` and
  `list_strategies` rows are not tied to any account or holding; they are user-scoped, not
  account-scoped.

## Worked stitch: holdings → accounts → opportunities → strategies

1. `list_accounts` → map each account `id` → `display_name` / `broker_type`.
2. `get_positions` → group rows by `account_id`; look each up in the map from step 1 to label the
   holding with its account. (Or call `get_positions_by_account_id` with one account's `id`.)
3. For a position's `symbol`, scan `list_opportunities` for rows with the same `symbol` to see
   whether the queue currently recommends acting on that ticker.
4. For each such opportunity, use its `strategy_id` to look up the full definition in
   `list_strategies`.

All five tools are user-scoped: they return only the calling user's own accounts, positions,
opportunities, and strategies.
