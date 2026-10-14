# Context Log: fix-otel-trace-export

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-14 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-10-14-otel-trace-export-broken-defect.md` (Issues disabled)
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services: all twelve (Go ×3, Python ×4, Node backends ×4, UI)
- Root cause: exporters use gRPC + explicit endpoint options that override OTel spec env handling; deployed env pushes to an OTLP/HTTP-only gateway with a full URL. Evidence: live staging log `name resolver error: produced zero addresses` (trading); no `[otel] tracing enabled` in UI startup log.
- Recommended design depth: triage signal = full (affected services ≥ 2); **operator chose quick** → `/sdd-design fix-otel-trace-export quick`. Approach is already operator-decided (product-spec § Operator Decisions), so the debate stress-tests it rather than selecting one.
- Development branch: **`ccr-3c062b89-cl8ixo`** — operator-approved deviation from `feature/fix-otel-trace-export`: the session may push only to its pinned branch. Execution is sequential-style (one commit per step) with a single integration PR to `main-dev`; no per-step PRs.
- NNN 226 = max(existing)+1 per root CLAUDE.md numbering rule (the Track C reference's count+1 formula would disagree under gaps).

## Session 2026-10-14 (/sdd-design quick — Phase 0)

- Phase 0 Recon: wrote recon.md (4 runtime-family discovery passes + scenario-recon; 9 PRESERVE business rules, 0 CHANGE).
- **Empirical probe** (scratch, not committed): at the pinned versions every SDK, constructed with no endpoint arg, POSTs to `<OTEL_EXPORTER_OTLP_ENDPOINT>/v1/traces` and sends `Authorization: Basic <tok>` from both `Authorization=Basic <tok>` and `Authorization=Basic%20<tok%3D>`.
- **Premise correction:** `deploy.yml:162-163` prefixes `Authorization=`; the header secret was never a root cause. Product-spec Operator Decision 2 superseded (secret stays `Basic <token>`); defect report got a Correction section. Operator was told the encoded format earlier in chat — the corrected guidance must be relayed.
- Status draft accepted at B2 (Track C has no /sdd-review step; operator chose this path).

## Session 2026-10-14 (/sdd-design quick — Phase 1, round 1)

- Round 1 (proposer → adversary): verdict NEEDS WORK, **no Floor breach**, all 9 existing business rules PRESERVE.
- Synthesized approach after R1: OTLP/HTTP exporters with no endpoint/url args in all 12 copies; fallbacks deleted; **Go keeps `WithTimeout(5s)`**; Node/UI lazily `diag.setLogger(DiagConsoleLogger, WARN)` inside the `OTEL_ENABLED` gate + `try`; UI hook → `src/instrumentation.ts` (guard kept); **collector :4317 receiver kept** (metrics/logs pipelines + telemetrygen smoke tests depend on it); **no `serverExternalPackages` change** (api globals are Symbol.for-keyed); **no platform.feature EXTEND** (hand-authored rule, no test → scope creep).
- R1 test fixes: Node/UI AC-3 must use the BSP **timer** path (`OTEL_BSP_SCHEDULE_DELAY`) — forceFlush/shutdown reject without reaching `globalErrorHandler`/diag; Go/Python AC-3 must assert the receiver's **400** status (current code never reaches a receiver → genuine red); every Node test asserts no `[otel] init failed`; Python opt-in fixture with fresh `Once()`, provider shutdown, `NO_PROXY=127.0.0.1`; repoint agent non-blocking test; UI AC-2 build proof = `.next/server/instrumentation.js` exists after `next build`; AC-4 grep scoped to 12 service blocks; local `pnpm install --frozen-lockfile`.
- Operator decisions at gate: **run another round**; **reconcile product-spec to the single header format** — done (FR-4, Fix Scope, Acceptance now state one format, no secret change).
