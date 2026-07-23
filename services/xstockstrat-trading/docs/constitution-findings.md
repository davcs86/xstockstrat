<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-trading — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- `order.max_retries`/`retry_delay_ms` — no retry loop; `SubmitOrder` called once. `trading.go:342`.
- `risk.daily_loss_limit` — enforced nowhere.
- `maintenance_mode` — only `platform.maintenance_mode` checked. `trading.go:244`.
- `INDICATORS_ENDPOINT` "validate signal" — loaded, never dialed. `config.go:23`.

## Latent bugs
- IBKR timeout hardcoded 10s while Alpaca honors `broker.timeout_ms`. `ibkr.go:55`.
- Handler error codes lossy — only `ReplaceOrder` preserves the service status code. `handler.go:40-83`.

## Dead code
- `requires_approval` column write-dead (hardcoded false). `trading_repo.go:75`.
