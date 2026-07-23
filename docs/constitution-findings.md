<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat — Constitution Findings (root / repo-wide)

Cross-cutting defects whose root cause spans modules (CF-N3). Per-module defects live in each module's
own `constitution-findings.md`. `⚠` = security boundary; most-severe first.

## Repo-wide dead code — copied scaffolding that rotted (PLAT-09)
- **`propagation.ts`** (AsyncLocalStorage, for the removed HTTP path) orphaned in **all 3 Node** services (ledger, identity, notify); unused `jwt`/`bcrypt` deps in identity + notify. Evidence: grep zero call sites.
- **`getEnvBool`** dead in **all 3 Go** services (trading, portfolio, marketdata). Evidence: only test call sites.
- **`ConfigWatcher`** hand-copied across Python services — `ingest/watcher.py` is the `indicators` copy verbatim (wrong `client_id`, dead `sandbox_*` helpers).
- Suggested action: extract a shared lib, or accept N copies and document the replication rule (PLAT-09).

## Cross-cutting bug — Python config zero-trap (reclassified per CF-N10)
- `get_int/get_float/get_str` use `v.x or default` in **indicators/analysis/ingest** → a legitimately-set `0`/`0.0`/`""` reads back as the default. **Not an invariant**: `config`'s `ConfigValue` is a `oneof` that supports distinguishing 0 (`config.proto:48-55`), and `get_bool` in the same file already uses `HasField`. Fix int/float/str to use `HasField`. (Behavior change for any key currently set to 0 — confirm with maintainer.)
