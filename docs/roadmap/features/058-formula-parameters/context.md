# Context: formula-parameters  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped exactly as designed — typed parameter definitions (int/float/bool/string) on formulas, validated/defaulted server-side before sandbox execution, exposed as a `params` sandbox global kept strictly separate from the existing `data` (OHLCV) global, with matching UI/agent/analysis-evaluator plumbing. No scope cuts occurred between design and ship.
**Why (irrecoverable rationale)**: The single decisive design call — keeping `input_params`/`params` as a wholly separate namespace from `input_data`/`data` rather than merging them into the existing conflated struct — came from an explicit user override during story-writing, not from any codebase constraint (context.md:37-54, Session 2026-06-08 "Decision (user) — separate parameters from series data"). This eliminated an entire class of open question (param/OHLCV name collisions) that the initial recon had flagged as needing resolution.
**Rejected alternatives**:
- Merging parameter values into `input_data`/`data` — rejected by explicit user instruction: "I don't want to mix them" (context.md:39).
- Extending `SandboxExitReason` enum for validation failures — rejected in favor of a dedicated structured `parameter_errors` field, decided at `/sdd-review` (product-spec.md:196-199), to give the UI per-parameter detail instead of an opaque enum value.
- New config key for the parameter-count cap — rejected; hardcoded 32-param soft cap in engine code instead, explicitly to "honor the no-new-config-keys promise" (product-spec.md:202-203).
**Scars & gotchas**:
- `request.parameters` (repeated `FormulaParameter` protos) cannot be `json.dumps`'d directly for JSONB persistence — servicer had to convert via `google.protobuf.json_format.MessageToDict` on write and `ParseDict` on read, a divergence from the spec's literal `list(request.parameters)` instruction (implementation-spec.md:619-623).
- Docker Hub 429 (unauthenticated rate limit) blocked the codegen container build; fallback was installing the exact pinned toolchain versions from CI (`buf`, `protoc-gen-go@v1.36.11`, etc.) directly on host (implementation-spec.md:607-611).
- Playwright browsers unavailable in the execution environment; UI verification fell back to `tsc --noEmit` + `next lint` + `prettier --check` (implementation-spec.md:625-629).
**Permanent deviations**: - spec said pass `list(request.parameters)` (proto objects) straight to the repo -> shipped `MessageToDict`-converted dicts on write / `ParseDict` reconstruction on read -> because raw protos aren't JSON-serializable (implementation-spec.md:619-623).
**Cross-feature signal**: - Docker Hub 429 on `golang:1.25-trixie` recurred as a codegen-container blocker; the host-toolchain-pinned-to-CI-versions fallback is now a repeatable playbook, not a one-off.
**Deferred follow-ons**: - none stated.
**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - `Dockerfile.codegen` pins `protoc-gen-go-grpc@v1.6.1` while CI's `proto-freshness` job (and the committed stubs) use `v1.6.2` — a live, currently-uncorrected drift discovered during this feature's Step 2 (implementation-spec.md:611). Worth a `docs/context-constitution-findings.md` entry so it isn't rediscovered blind next time.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
