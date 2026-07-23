<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-indicators — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Documentation that lies
- ledger+notify deps, 4 emitted events, `LEDGER/NOTIFY_ENDPOINT` — zero ledger/notify code. grep.
- `sandbox.max_concurrent` — no semaphore; concurrency unbounded. grep.

## Latent bugs
- ATR/VWAP built-ins don't compute what their names claim (no HLC/volume) yet advertised as such. `indicators_engine.py:103-117`.
- `memory_used_bytes` hardwired to 0 — proto field carries no signal. `sandbox.py:239`.
