# Product Spec: sec-filing-sentiment

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Extend the agent MCP server to poll SEC EDGAR for new 10-K and 10-Q filings and earnings call transcripts (via EDGAR full-text search or a third-party provider like Refinitiv). Pass the documents to Claude for structured signal extraction: sentiment (bullish/bearish/neutral), key risk factors, forward guidance tone, and year-over-year metric changes. Ingest the extracted signals into the platform via the existing signal pipeline.

## Why It Seems Valuable

- SEC filings are authoritative primary sources — not second-hand newsletter commentary.
- Earnings calls contain forward guidance and management tone that move stock prices.
- The agent MCP server already handles text extraction from emails; extending to documents appears straightforward.
- Claude has demonstrated strong document comprehension ability.

## Why It Is Not Worth Building

**1. Annual filings have weeks to months of structural latency.**
10-K filings are due 60 days (large accelerated filers) to 90 days (non-accelerated) after fiscal year-end. By the time a 10-K is filed on EDGAR, the company's audited results have been known to the market for weeks (via earnings releases, investor presentations, and analyst reports). The incremental information in the 10-K relative to what is already priced in is minimal.

**2. The documents are signal-diluted by design.**
A typical 10-K is 100–200 pages. Roughly 60–80% is boilerplate: legal risk disclosures that are copy-pasted from the previous year's filing, accounting policy notes, and exhibit listings. The genuinely new information (changed guidance, new risk factors, material weaknesses) is a small fraction of the total document. The signal-to-noise ratio Claude would be working against is very low, even with good prompt engineering.

**3. Earnings call transcripts are timely but arrival-disadvantaged.**
Earnings calls happen in real time; algorithmic traders, sell-side desks, and institutional NLP pipelines process the transcript as it is being spoken — not after it is transcribed and posted to EDGAR (which can take hours). A platform that polls for transcripts post-call and runs Claude extraction will consistently act on information that has already been reflected in the post-earnings price move. This is the worst combination: stale data with high perceived conviction.

**4. The human-curated newsletter signal sources the platform already has are superior.**
Financial newsletter authors spend their professional time reading filings, attending earnings calls, and synthesizing the key takeaways for readers. They apply domain expertise, historical context, and editorial judgment that a general-purpose document extraction prompt cannot replicate. The newsletters the agent already extracts from are the pre-filtered, higher-signal output of the same information that exists in raw SEC filings. Replacing the curated summary with the raw source is a step backward in signal quality.

**5. EDGAR API and document handling add operational complexity.**
EDGAR's full-text search API has rate limits and inconsistent document formatting across filing types and filers. Handling 100-page PDFs and HTML filings (many are HTML with embedded tables) in the agent requires document parsing infrastructure that does not currently exist. Claude's context window limits also constrain how much of a large 10-K can be analyzed in a single pass.

## Conditions Under Which This Should Be Reconsidered

- A curated, pre-filtered earnings call transcript feed (e.g., Seeking Alpha Earnings Transcripts API, Refinitiv Eikon) is available, delivering cleaned transcripts within minutes of call completion.
- The platform has demonstrated that the existing newsletter signal sources are information-complete and the marginal value of an additional source type is positive.
- A dedicated prompt engineering effort validates that Claude extraction on earnings call text produces actionable signals that are not already captured by the newsletter sources.

## Affected Services

_Not applicable — demoted before any design._
