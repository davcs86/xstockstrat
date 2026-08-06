# Context: sec-filing-sentiment  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: An idea to have the agent MCP server poll SEC EDGAR for 10-K/10-Q filings and earnings-call transcripts, run Claude extraction for sentiment/risk-factor/guidance signals, and ingest via the existing signal pipeline. Demoted at the idea stage — no design, spec, or code was ever produced (product-spec.md:1-4, feature.md:3-4).
**Why (irrecoverable rationale)**: Rejected on a timing/signal-quality argument that lives only in this prose: 10-Ks carry 60-90 day structural filing latency so their content is already priced in by publication (product-spec.md:21-22); the ~60-80% of a 10-K that's boilerplate/copy-pasted risk language dilutes the genuinely new information Claude would need to extract (product-spec.md:24-25); earnings-call transcripts, while timely, are processed algorithmically in real time by others, so a post-call polling+transcription+extraction pipeline always acts after the price move (product-spec.md:27-28); and the platform's existing human-curated newsletter sources are judged to already be the higher-signal, pre-filtered output of this same raw information (product-spec.md:30-31).
**Rejected alternatives**: - Building EDGAR polling + document parsing infrastructure now — lost because no such parsing exists in the agent and the operational cost (rate limits, inconsistent HTML/PDF formats, context-window limits on 100+ page filings) wasn't justified by the marginal signal (product-spec.md:33-34).
**Scars & gotchas**: - None — feature never entered design or execution; context.md has exactly one brainstorming session, no execute-phase entries (context.md:8-12).
**Permanent deviations**: - none (nothing shipped)
**Cross-feature signal**: - none — no other feature or session references this idea.
**Deferred follow-ons**: - Explicit reconsideration triggers (not just "someday"): (1) a curated/cleaned real-time earnings-transcript feed becomes available within minutes of call completion (e.g. Seeking Alpha Earnings Transcripts, Refinitiv Eikon); (2) evidence that existing newsletter sources are information-incomplete and an added source type has positive marginal value; (3) a dedicated prompt-engineering validation showing Claude extraction surfaces signals the newsletter pipeline misses (product-spec.md:38-40).
**Failure post-mortem**: - Root cause: idea-stage cost/benefit analysis (latency + signal dilution + existing superior source) outweighed the appeal of "authoritative primary source." Missed signal: n/a — this was caught before any spec/design investment, i.e. the SDD gate worked as intended (demoted at idea, never reached draft/spec-ready) (feature.md:12-14).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
