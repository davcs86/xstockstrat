---
name: form4-enhanced-ingest
description: Ingest SEC Form 4 insider-transaction signals into xstockstrat. Fetches recent Form 4 filings from SEC EDGAR, parses the full transaction documents, enriches with Yahoo Finance news sentiment and risk metrics, scores conviction via fixed decision rules, and ingests every signal at or above the 0.6 conviction threshold into xstockstrat-ingest via the `ingest_signal` MCP tool (0.6 is also the platform's own `agent.signal.alert_threshold` default, so ingestion and alerting line up with no separate alert call needed). Use whenever the user asks to ingest Form 4 insider transactions, wants insider buys/sells scored with market context, or asks for "form4 insider ingestion". REQUIRES a local machine with network access to sec.gov and finance.yahoo.com — the bundled scraper cannot run in a network-isolated cloud sandbox.
argument-hint: --lookback-days N --timeout N (both optional)
allowed-tools: Read Bash(python3 *) AskUserQuestion
---

## Overview

This skill has two halves that run in sequence:

1. **Fetch/parse/score** (`scripts/form4_ingest.py`, local Python + patchwright) — pulls the SEC
   EDGAR Form 4 Atom feed, parses full transaction XML, enriches with Yahoo Finance sentiment/risk,
   and scores conviction. It writes a JSON report; it does **not** touch xstockstrat.
2. **Ingest** (this skill, driven by you) — reads that report and, for every entry in
   `high_conviction_signals`, calls the real `ingest_signal` MCP tool. A subprocess script cannot
   call an MCP tool itself, so this half has to happen here, not in the script.

## Scope

This targets the xstockstrat-ingest MCP tools `list_signal_sources` and `ingest_signal`. If they
are not loaded, find them with ToolSearch first — never assume they're absent without searching.
`manage_signal_source` is admin-scoped and deliberately **not** called by this skill — see
`reference/ingestion.md` Step 1 for why registering the signal source is a one-time admin
prerequisite, not something this skill does on your behalf.

## How to run

1. Resolve the repo root (`git rev-parse --show-toplevel`) so the bundled script resolves
   regardless of the shell's current directory, and pick a scratch path for the report (e.g. the
   session scratchpad directory), then run:
   ```bash
   python3 "$REPO_ROOT/.claude/skills/form4-enhanced-ingest/scripts/form4_ingest.py" \
     --lookback-days 1 --timeout 15 --output-json <scratch_path>/form4_report.json
   ```
   Pass through any `lookback_days`/`timeout` the user specified; otherwise use the defaults (1 day,
   15s). The conviction threshold is fixed at 0.6 and is not a script parameter (see below).
2. `Read` the JSON file at `<scratch_path>/form4_report.json` rather than parsing the printed
   progress logs — the file is the authoritative report.
3. If `high_conviction_signals` is empty, report the summary (filings seen, transactions extracted,
   why nothing qualified) and stop — there is nothing to ingest.
4. Otherwise, follow `reference/ingestion.md` to verify the signal source is registered (stop with
   setup instructions if it isn't — never register it yourself) and call `ingest_signal` once per
   entry in `high_conviction_signals`.
5. Report the final counts: filings processed, transactions extracted, signals ingested vs.
   deduplicated vs. failed, and any errors the script logged (e.g. Yahoo Finance timeouts).

## Conviction Scoring Rules

Applied by the script to each insider transaction — fixed heuristics, not configurable per run:

**Insider open-market buy** (direction `buy`)
- Base 0.60; +0.15 if recent Yahoo Finance news sentiment is positive; +0.10 if volatility < 25%
  (or +0.05 if beta < 1.0 and volatility is unavailable); capped at 0.95.

**Insider open-market sell** (direction `sell`)
- Base 0.50; +0.10 if recent news sentiment is negative; +0.10 if volatility > 30% (or +0.05 if
  beta > 1.2 and volatility is unavailable); capped at 0.85.

**Other transactions** (grants, exercises) — conviction 0.30, direction `watchlist`. Always below
the 0.6 threshold, so these are logged in `skipped_signals` for audit, never ingested.

**Yahoo Finance unavailable** — falls back to base conviction only (no boosts); the script logs an
error for that ticker but still scores and reports it. Still ingested if base conviction alone
clears 0.6 (buys only — sell's base of 0.50 never does).

**Threshold.** Fixed at 0.6 — signals below it are reported in `skipped_signals` with a reason, never
sent to `ingest_signal`. This is not a script flag; do not invent a `--conviction-floor` argument.

## Data Sources

- **SEC EDGAR Form 4 Atom feed** — `getcurrent` feed, filtered locally to the `--lookback-days`
  window via each entry's `<updated>` timestamp (the feed itself has no date-range parameter). Capped
  at 10 filings per run (`MAX_FILINGS_PER_RUN` in the script) for full-document fetch performance —
  re-run to pick up more; xstockstrat-ingest's own dedup window makes a re-run safe.
- **Full Form 4 XML documents** — issuer ticker/name, insider name/title, transaction type
  (P=buy, S=sell), shares, price, date.
- **Yahoo Finance news/risk pages** — scraped via patchwright (a stealth-patched Playwright fork;
  Yahoo blocks a stock headless-Chromium fingerprint often enough that this matters). News:
  keyword-based sentiment over the 15 most recent headlines, recency-weighted. Risk: beta and
  52-week volatility, parsed from page text. Both timeout gracefully — missing data lowers the
  score, it never blocks ingestion of what's already qualified.

## Architecture & Limitations

**Local execution only.** patchwright needs a real browser process and unrestricted HTTPS to
sec.gov / finance.yahoo.com. A cloud sandbox's restricted network will fail at the SEC EDGAR fetch.

**Deduplication.** `ingest_signal` dedups within `ingest.signals.dedup_window_hours` (source +
symbol + direction + conviction + valid_until all equal) and returns the existing `signal_id` with
`deduplicated: true` instead of inserting a row — the auto-alert is suppressed in that case. This
skill does not track its own state across runs; it relies on that server-side window.

**No CIK-to-ticker mapping.** Form 4 Atom feed entries expose only CIK, not ticker; the script relies
on the full Form 4 XML's `issuerTradingSymbol`. If that's missing or malformed, the transaction is
skipped — no guessing.

## Troubleshooting

- **`ERR_TUNNEL_CONNECTION_FAILED` / hangs at sec.gov** — running in a network-isolated sandbox; run
  this locally instead.
- **`ImportError` / browser install fails** — patchwright wasn't installed automatically. Run
  `python3 -m pip install patchwright beautifulsoup4 && python3 -m patchwright install chromium`
  and re-run. If the install CLI has changed, check the patchwright project's own docs.
- **No transactions found** — SEC EDGAR may be rate-limiting; wait and retry. Also check that
  `--lookback-days` isn't so small the current feed has nothing recent enough (the feed only shows
  very recent filings to begin with).
- **Low conviction scores across the board** — Yahoo sentiment parsing is keyword-based, not NLP;
  neutral/balanced headlines score ~0.0. Review the top signals manually if this seems off.
- **`ingest_signal` returns `INVALID_ARGUMENT: unknown source`** — the signal source slug wasn't
  registered yet, or was deactivated; see `reference/ingestion.md`.
