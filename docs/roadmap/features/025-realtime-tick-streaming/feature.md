# Feature: realtime-tick-streaming

**Development Branch**: _none — demoted before implementation_
**Created**: 2026-05-26
**Last Updated**: 2026-05-26
**Archived**: 2026-08-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `demoted/canceled` | brainstorming | Demoted at idea stage — see rationale in product-spec.md |
| 2026-08-05 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 1 specs |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-05; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — decision log

---

## Summary

Replace the chart panel's polling of `GetBars` with a WebSocket or SSE stream of every market tick, delivering live price updates to the trader UI at sub-second latency.

## Demotion Rationale (short)

The platform makes strategy decisions in the analysis and indicators services, not via a human watching candles. Tick-level UI data adds no decision value for a strategy-driven system. The engineering cost (new streaming proto RPCs, WebSocket infrastructure, backpressure, reconnect logic) is high relative to the benefit, and the time is better spent on the autonomous signal pipeline and risk management features.

## Next Action

_None — feature is demoted. Do not implement._
