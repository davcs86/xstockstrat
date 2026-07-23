<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-portfolio — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Latent bugs
- `GetPnL`/`broadcastSnapshot`/`checkRiskLimits` bypass broker parity — the #735 fix is **incomplete in 3 paths**. `:366,566,605`.
- `ClosePosition`/`GetPosition` omit `account_id` → delete/return across ALL a user's accounts. `portfolio_repo.go:54-67`.

## Documentation that lies
- `snapshot.interval_minutes` — `StartSnapshotWriter` has zero callers. `:544`.
- `risk.max_drawdown_pct` — read then discarded (`_ = maxDrawdownPct`). `:623`.
- emits `portfolio.risk.drawdown_breach` — actually fires for *concentration*. `:627`.

## Open questions
- Are the 3 parity-bypassing paths an intentional scope boundary of #735 or an overlooked continuation?
