<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-notify — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- all 3 config keys (`max_subscribers`/`retention_days`/`max_body_bytes`) dead; ledger dependency documented, no code; unused `jwt`/`bcrypt` deps. grep.

## Dead code
- `propagation.ts` orphan (root pattern). grep.
