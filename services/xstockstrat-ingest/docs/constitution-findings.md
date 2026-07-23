<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-ingest — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- entire `ingest.signals.*` block (dedup window, default conviction/window) — unconsumed. grep.
- emits `ingest.data.normalized` — `NormalizeRawData` counts rows, emits nothing. `servicer.py:585`.

## Latent bugs
- conviction `0.0` indistinguishable from unset (NULL round-trip); unset `valid_from` stores 1970 epoch. `servicer.py:656,651`.

## Dead code
- `app/extractors/` package never dispatched at runtime; `ConfigWatcher` is the indicators copy (root pattern). grep.
