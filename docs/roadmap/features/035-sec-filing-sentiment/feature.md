# Feature: sec-filing-sentiment

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: _none — demoted before implementation_
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `demoted/canceled` | brainstorming | Demoted at idea stage — see rationale in product-spec.md |

---

## Artifacts

- [Product Spec](product-spec.md) — demotion rationale
- [Context Log](context.md) — decision log

---

## Summary

Use the agent MCP server to fetch SEC EDGAR filings (10-K, 10-Q) and earnings call transcripts, pass them to Claude for sentiment and risk-factor extraction, and ingest the output as signals into the platform.

## Demotion Rationale (short)

SEC filings are boilerplate-heavy documents with weeks of latency after fiscal year-end; 10-K signals are already priced in by the time the filing is public. Earnings call transcripts are timely but the market reacts algorithmically within seconds — a polling agent always finishes after the move. Human-curated newsletters already pre-filter this information with better timing and relevance signal-to-noise.

## Next Action

_None — feature is demoted. Do not implement._
