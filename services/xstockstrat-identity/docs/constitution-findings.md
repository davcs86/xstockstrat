<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-identity — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- `identity.jwt.secret` config key never read (secret is env-only). `:28`.
- documented ledger "auth audit trail" dependency — zero ledger refs in `src/`. grep.

## Dead code
- `api_keys` create-then-drop migration (`001`→`005`); stale `package.json` desc + comment referencing deleted `revokeApiKey`. `:498`.
- `propagation.ts` orphan (root pattern).
