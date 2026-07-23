<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-marketdata — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- `ohlcv_1h` continuous aggregate & compression/retention policies — none exist (no migration). retention config keys unused. grep: doc-only.

## Latent bugs
- `BackfillBars` doesn't canonicalize the timeframe → permanent read-miss if ingest sends `"1Day"`. `:602`.
- `GetFundamentalsMulti` can overshoot the FMP daily cap (count checked once, not per-symbol). `:854`.

## Dead code
- `getEnvBool` (also root pattern), `Watcher.GetFloat`, `AlpacaAsset` struct — zero prod call sites. `config.go:201,122`; `client.go:422`.
