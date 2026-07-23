<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-ledger — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- `ledger.*` config keys (notify_enabled/retention/compression) injected, read by no code; retention/compression jobs not installed. grep.

## Latent bugs
- `QueryEvents` emits a `nextPageToken` it never consumes; orders by `recorded_at` — pagination non-functional. `ledgerServiceImpl.ts:171`.

## Dead code
- `propagation.ts` orphan (also root pattern). grep.
