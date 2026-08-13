# Ingestion — resolving the signal source and calling `ingest_signal`

Loaded only once `scripts/form4_ingest.py` has produced a report with a non-empty
`high_conviction_signals`. See `docs/runbooks/mcp-tools.md` for the full tool contracts this
recipe relies on.

## Step 1 — Verify the signal source is registered (do not self-register)

`ingest_signal`'s `source` parameter must be a slug already registered in xstockstrat-ingest — an
unknown slug is rejected `INVALID_ARGUMENT`. This skill uses a fixed slug for this feed:
`sec_form4_insider`.

```
list_signal_sources()
```

- If `sec_form4_insider` is present and `active: true`, use it as-is — go to Step 2.
- If present but `active: false`, **stop** and tell the user the source is deactivated; reactivating
  it (`manage_signal_source(operation="reactivate", ...)`) is an admin action, not something to do
  silently on their behalf.
- If absent, **stop** and give the user the exact one-time setup call for an admin to run:
  ```
  manage_signal_source(
    operation="register",
    slug="sec_form4_insider",
    display_name="SEC Form 4 Insider Transactions",
    source_type="direct_feed",
  )
  ```
  Do not call `manage_signal_source` yourself. It's an admin-scoped write (a non-admin caller gets
  `PERMISSION_DENIED`), and it creates a persistent, shared registry entry — that's a deliberate
  one-time provisioning step, not a side effect of a routine ingest run. Re-run this skill after the
  admin has registered it.

Do this check once per skill run, not once per signal.

## Step 2 — Ingest each qualified signal

For every entry in the report's `high_conviction_signals`:

```
ingest_signal(
  source="sec_form4_insider",
  symbol=entry.symbol,
  direction=entry.direction,          # "buy" or "sell" — the script never emits "watchlist" here,
                                       # those are always < 0.6 and stay in skipped_signals
  valid_from=entry.valid_from,        # already ISO 8601 from the script
  conviction=entry.conviction,
  headline=f"Form 4: {entry.insider} {entry.direction} {entry.shares} sh @ ${entry.price:.2f}",
  raw_url=entry.raw_url,              # the SEC filing link, or omit if the script left it null
  tags=["form4", "insider", "sec_edgar"],
)
```

Field notes:
- `conviction` — pass the script's float directly. Do **not** round or omit it: an omitted
  conviction is stored as `NULL`/unknown, which is a materially different claim than "we scored this
  at 0.82."
- `direction` — pass through as-is; the tool's own enum (`buy`/`sell`/`hold`/`watchlist`) already
  matches what the script emits.
- Conviction `>= agent.signal.alert_threshold` (default 0.6, i.e. every signal reaching this step)
  auto-emits an alert via xstockstrat-notify as a side effect of `ingest_signal`. **Do not also call
  `emit_alert`** for the same signal — that double-alerts.

## Step 3 — Handle the response per signal

- `{"signal_id": N, "deduplicated": false}` — new row inserted, alert fired (if above threshold).
  Count as ingested.
- `{"signal_id": N, "deduplicated": true}` — this exact signal (source, symbol, direction,
  conviction, valid_until) was already ingested within the dedup window; no new row, no alert. Not
  an error — count separately as "deduplicated" in your summary, don't report it as a failure.
- `INVALID_ARGUMENT` (unknown source / bad conviction / missing valid_from) — should not happen if
  Step 1 succeeded and the script's report is well-formed; if it does, log it as an ingest error for
  that symbol and continue with the remaining signals rather than aborting the whole batch.

## Step 4 — Summarize

Report to the user: signals ingested (new), signals deduplicated, signals that failed to ingest
(with the error), and the counts already in the script's report (filings processed, transactions
extracted, signals below threshold). Don't just relay the raw JSON — the user asked for insider
signals, not a tool-call transcript.
