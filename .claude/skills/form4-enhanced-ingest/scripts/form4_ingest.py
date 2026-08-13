#!/usr/bin/env python3
"""
Form 4 Enhanced Ingest Pipeline for xstockstrat — fetch, parse, enrich, and score phase.

Fetches SEC EDGAR Form 4 filings, parses full documents, enriches with Yahoo Finance data, and
scores conviction. This script does NOT call xstockstrat-ingest itself — the ingest MCP tools
(`list_signal_sources`, `manage_signal_source`, `ingest_signal`) are only reachable from the
agent's tool-calling loop, not from a subprocess. The skill's SKILL.md drives that step using the
JSON report this script produces — see reference/ingestion.md for the exact recipe.

Usage:
  python3 form4_ingest.py --lookback-days 1 --timeout 15 --output-json /path/to/report.json

Requirements:
  - patchwright (a stealth-patched Playwright fork; Yahoo Finance blocks a stock headless
    Chromium's automation fingerprint often enough that the plain library was swapped out)
  - beautifulsoup4
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List, Tuple
import subprocess

try:
    from patchwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    import xml.etree.ElementTree as ET
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing dependencies (patchwright, beautifulsoup4)...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "patchwright", "beautifulsoup4", "-q"], check=True)
        subprocess.run([sys.executable, "-m", "patchwright", "install", "chromium"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"[FATAL] Automatic install failed ({e}). Install manually:\n"
              f"  {sys.executable} -m pip install patchwright beautifulsoup4\n"
              f"  {sys.executable} -m patchwright install chromium\n"
              f"then re-run this script.", file=sys.stderr)
        sys.exit(1)
    from patchwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    import xml.etree.ElementTree as ET
    from bs4 import BeautifulSoup

# ============================================================================
# Configuration & Constants
# ============================================================================

SEC_EDGAR_FORM4_FEED = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom"
SEC_EDGAR_BASE = "https://www.sec.gov"
YAHOO_NEWS_URL = "https://finance.yahoo.com/quote/{}/news/"
YAHOO_RISK_URL = "https://finance.yahoo.com/quote/{}/risk/"
CONVICTION_THRESHOLD = 0.6  # Fixed: only signals >= this are reported as ingestable
MAX_FILINGS_PER_RUN = 10  # Performance guard: full-document fetch is capped per run

# ============================================================================
# Logging & Reporting
# ============================================================================

class Report:
    """Track pipeline execution metrics and errors."""

    def __init__(self):
        self.start_time = time.time()
        self.total_filings_processed = 0
        self.transactions_extracted = 0
        self.signals_ingested = 0
        self.signals_below_threshold = 0
        self.high_conviction_signals = []
        self.skipped_signals = []  # Low conviction signals logged for audit
        self.conviction_distribution = {"0.3-0.4": 0, "0.4-0.5": 0, "0.5-0.6": 0, "0.6+": 0}
        self.errors = []
        self.ingested_signals = []

    def add_error(self, msg: str):
        self.errors.append(msg)
        print(f"[ERROR] {msg}")

    def add_signal(self, symbol: str, direction: str, conviction: float, insider: str,
                    shares: int, price: float, valid_from: str, raw_url: Optional[str] = None):
        """Track a signal. Only reported as ingestable if conviction >= threshold; otherwise logged as skipped.

        `valid_from` and `raw_url` are carried through so the skill's ingestion step (which calls
        the real `ingest_signal` MCP tool) has what it needs without re-deriving it — see
        reference/ingestion.md for the field mapping.
        """
        # Distribution tracking
        if conviction >= 0.6:
            self.conviction_distribution["0.6+"] += 1
        elif conviction >= 0.5:
            self.conviction_distribution["0.5-0.6"] += 1
        elif conviction >= 0.4:
            self.conviction_distribution["0.4-0.5"] += 1
        else:
            self.conviction_distribution["0.3-0.4"] += 1

        signal_dict = {
            "symbol": symbol,
            "direction": direction,
            "conviction": conviction,
            "insider": insider,
            "shares": shares,
            "price": price,
            "valid_from": valid_from,
            "raw_url": raw_url,
        }

        if conviction >= CONVICTION_THRESHOLD:
            self.signals_ingested += 1
            self.high_conviction_signals.append(signal_dict)
            self.ingested_signals.append(signal_dict)
        else:
            self.signals_below_threshold += 1
            self.skipped_signals.append({**signal_dict, "reason": f"Conviction {conviction:.2f} below {CONVICTION_THRESHOLD} threshold"})

    def to_dict(self) -> Dict:
        elapsed = time.time() - self.start_time
        return {
            "total_filings_processed": self.total_filings_processed,
            "transactions_extracted": self.transactions_extracted,
            "signals_ingested": self.signals_ingested,
            "signals_below_threshold": self.signals_below_threshold,
            "high_conviction_signals": self.high_conviction_signals,
            "skipped_signals": self.skipped_signals,
            "conviction_distribution": self.conviction_distribution,
            "errors": self.errors,
            "timing_seconds": round(elapsed, 1)
        }

# ============================================================================
# SEC EDGAR Form 4 Parsing
# ============================================================================

class Form4Parser:
    """Parse SEC Form 4 XML documents."""

    @staticmethod
    def extract_from_xml(xml_content: str) -> List[Dict]:
        """Extract transaction details from Form 4 XML."""
        transactions = []
        try:
            root = ET.fromstring(xml_content)

            # Extract issuer info
            issuer_ticker = None
            issuer_name = None

            issuer_elem = root.find('.//issuer')
            if issuer_elem is not None:
                ticker_elem = issuer_elem.find('issuerTradingSymbol')
                if ticker_elem is not None and ticker_elem.text:
                    issuer_ticker = ticker_elem.text.strip()
                name_elem = issuer_elem.find('issuerName')
                if name_elem is not None and name_elem.text:
                    issuer_name = name_elem.text.strip()

            # Extract reporting-owner (insider) info
            insider_name = None
            insider_title = None
            owner_elem = root.find('.//reportingOwner')
            if owner_elem is not None:
                name_elem = owner_elem.find('reportingOwnerId/rptOwnerName')
                if name_elem is not None and name_elem.text:
                    insider_name = name_elem.text.strip()
                relationship = owner_elem.find('reportingOwnerRelationship')
                if relationship is not None:
                    if relationship.findtext('isOfficer') == '1':
                        insider_title = relationship.findtext('officerTitle', default='Officer').strip() or 'Officer'
                    elif relationship.findtext('isDirector') == '1':
                        insider_title = 'Director'
                    elif relationship.findtext('isTenPercentOwner') == '1':
                        insider_title = '10% Owner'

            # Extract transaction entries
            for non_deriv in root.findall('.//nonDerivativeTransaction'):
                txn = {
                    'ticker': issuer_ticker,
                    'company_name': issuer_name,
                    'transaction_type': None,
                    'shares': None,
                    'price': None,
                    'date': None,
                    'insider_name': insider_name,
                    'insider_title': insider_title,
                }

                # Transaction type
                code_elem = non_deriv.find('transactionCoding/transactionCode')
                if code_elem is not None and code_elem.text:
                    code = code_elem.text.strip()
                    if code == 'P':
                        txn['transaction_type'] = 'open_market_buy'
                    elif code == 'S':
                        txn['transaction_type'] = 'open_market_sell'

                # Shares
                qty_elem = non_deriv.find('transactionAmounts/transactionShares/value')
                if qty_elem is not None and qty_elem.text:
                    try:
                        txn['shares'] = int(float(qty_elem.text))
                    except:
                        pass

                # Price
                price_elem = non_deriv.find('transactionAmounts/transactionPricePerShare/value')
                if price_elem is not None and price_elem.text:
                    try:
                        txn['price'] = float(price_elem.text)
                    except:
                        pass

                # Date
                date_elem = non_deriv.find('transactionDate/value')
                if date_elem is not None and date_elem.text:
                    txn['date'] = date_elem.text.strip()

                # Include if we have type and shares
                if txn['transaction_type'] and txn['shares']:
                    transactions.append(txn)
        except Exception as e:
            print(f"[WARN] Error parsing Form 4 XML: {e}")

        return transactions

# ============================================================================
# Yahoo Finance Data Extraction
# ============================================================================

class YahooFinanceParser:
    """Fetch and parse Yahoo Finance news and risk data via patchwright (stealth Chromium)."""

    @staticmethod
    def fetch_with_browser(url: str, timeout_sec: int = 15) -> Optional[str]:
        """Fetch page content using patchwright."""
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
                page = browser.new_page()
                page.set_default_timeout(timeout_sec * 1000)
                page.goto(url, wait_until='load')
                content = page.content()
                browser.close()
                return content
        except PlaywrightTimeout:
            return None
        except Exception as e:
            print(f"[WARN] Browser fetch failed for {url}: {e}")
            return None

    @staticmethod
    def parse_news_sentiment(html: Optional[str]) -> float:
        """Parse news page for recent articles and sentiment. Returns float in [-1, 1]."""
        if not html:
            return 0.0

        soup = BeautifulSoup(html, 'html.parser')

        positive_keywords = ['surge', 'rally', 'jump', 'gain', 'profit', 'beat', 'approval', 'deal', 'acquisition', 'upgrade']
        negative_keywords = ['fall', 'drop', 'loss', 'decline', 'miss', 'recall', 'bankruptcy', 'lawsuit', 'investigation', 'downgrade']

        sentiment_score = 0.0
        article_count = 0

        # Extract article headlines (simplified)
        article_items = soup.find_all('h3', limit=15)

        for idx, item in enumerate(article_items):
            text = item.get_text().lower()

            # Recency weighting: first articles are newer
            weight = 0.8 if idx < 3 else (0.5 if idx < 6 else 0.2)

            pos_hits = sum(1 for kw in positive_keywords if kw in text)
            neg_hits = sum(1 for kw in negative_keywords if kw in text)

            if pos_hits > neg_hits:
                sentiment_score += 0.3 * weight
            elif neg_hits > pos_hits:
                sentiment_score -= 0.3 * weight

            article_count += 1

        # Normalize
        if article_count == 0:
            return 0.0
        sentiment = max(-1.0, min(1.0, sentiment_score / article_count))
        return sentiment

    @staticmethod
    def parse_risk_metrics(html: Optional[str]) -> Dict:
        """Parse risk page for volatility, beta, etc."""
        if not html:
            return {}

        soup = BeautifulSoup(html, 'html.parser')
        metrics = {}
        text = soup.get_text()

        # Look for beta
        beta_match = re.search(r'Beta[:\s]+([0-9.]+)', text, re.IGNORECASE)
        if beta_match:
            try:
                metrics['beta'] = float(beta_match.group(1))
            except:
                pass

        # Look for volatility
        vol_match = re.search(r'52[- ]week.*?([0-9.]+)%?', text, re.IGNORECASE | re.DOTALL)
        if vol_match:
            try:
                metrics['volatility'] = float(vol_match.group(1))
            except:
                pass

        return metrics

# ============================================================================
# Conviction Scoring
# ============================================================================

def score_conviction(transaction: Dict, news_sentiment: float, risk_metrics: Dict) -> Tuple[str, float]:
    """
    Score direction and conviction based on transaction + Yahoo data.

    Rules:
    - Insider open-market buy + positive news + lower volatility -> 0.75+
    - Insider open-market sell + rising risk metrics + negative news -> "sell", 0.6+
    """
    base_conviction = 0.5
    direction = 'watchlist'

    if transaction['transaction_type'] == 'open_market_buy':
        direction = 'buy'
        base_conviction = 0.60

        # Boost for positive news
        if news_sentiment > 0.2:
            base_conviction += 0.15

        # Boost for lower volatility
        if risk_metrics.get('volatility') and risk_metrics['volatility'] < 25:
            base_conviction += 0.10
        elif risk_metrics.get('beta') and risk_metrics['beta'] < 1.0:
            base_conviction += 0.05

        conviction = min(0.95, base_conviction)

    elif transaction['transaction_type'] == 'open_market_sell':
        direction = 'sell'
        base_conviction = 0.50

        # Boost if negative news
        if news_sentiment < -0.2:
            base_conviction += 0.10

        # Boost if high/rising volatility
        if risk_metrics.get('volatility') and risk_metrics['volatility'] > 30:
            base_conviction += 0.10
        elif risk_metrics.get('beta') and risk_metrics['beta'] > 1.2:
            base_conviction += 0.05

        conviction = min(0.85, base_conviction)

    else:
        # Non-discretionary transactions (grants, exercises)
        conviction = 0.30

    return direction, conviction

# ============================================================================
# Main Pipeline
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Form 4 Enhanced Ingest Pipeline (fetch/parse/score phase)")
    parser.add_argument('--lookback-days', type=int, default=1, help='Days back to pull Form 4 filings')
    parser.add_argument('--timeout', type=int, default=15, help='Seconds to wait for Yahoo Finance')
    parser.add_argument('--output-json', type=str, default=None,
                         help='If set, write the full JSON report here instead of only stdout '
                              '(recommended — keeps the report out of noisy progress logs)')
    args = parser.parse_args()

    report = Report()
    yahoo_timeout = args.timeout
    lookback_hours = args.lookback_days * 24
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

    print(f"=== Form 4 Enhanced Ingest Pipeline ===")
    print(f"Lookback: {args.lookback_days} day(s) (cutoff: {cutoff_time.isoformat()})")
    print(f"Conviction threshold: {CONVICTION_THRESHOLD} (only signals >= {CONVICTION_THRESHOLD} are reported as ingestable)")
    print(f"Yahoo fetch timeout: {yahoo_timeout}s\n")

    # Step 1: Fetch Form 4 Atom feed
    print("[1] Fetching SEC EDGAR Form 4 Atom feed...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(SEC_EDGAR_FORM4_FEED, wait_until='load', timeout=20000)
            feed_raw = page.content()
            browser.close()
    except Exception as e:
        report.add_error(f"Failed to fetch Form 4 feed: {e}")
        print(json.dumps(report.to_dict(), indent=2))
        return

    # Extract entry blocks and filing links
    entries = re.findall(r'<entry>.*?</entry>', feed_raw, re.DOTALL)
    print(f"Found {len(entries)} Form 4 filings on the current feed.")
    report.total_filings_processed = len(entries)

    # Filter to the lookback window using each entry's <updated> timestamp. The EDGAR "getcurrent"
    # feed has no date-range query param, so filtering happens here rather than at fetch time.
    in_window_entries = []
    for entry in entries:
        updated_match = re.search(r'<updated>([^<]+)</updated>', entry)
        if not updated_match:
            continue  # Can't determine recency — skip rather than guess it's in-window
        try:
            updated_at = datetime.fromisoformat(updated_match.group(1).strip())
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if updated_at >= cutoff_time:
            in_window_entries.append(entry)

    print(f"{len(in_window_entries)} filing(s) within the {args.lookback_days}-day lookback window.\n")

    # Extract filing URLs (only for in-window entries)
    filing_links = []
    for entry in in_window_entries:
        link_match = re.search(r'<link[^>]*rel="alternate"[^>]*href="([^"]+)"', entry)
        if link_match:
            link = link_match.group(1)
            if link.startswith('http'):
                filing_links.append(link)

    print(f"Extracted {len(filing_links)} filing URLs.\n")

    # Step 2: For each filing, fetch full document and extract transactions
    print(f"[2] Fetching and parsing Form 4 documents (max {MAX_FILINGS_PER_RUN} per run)...")
    all_transactions = []

    capped_links = filing_links[:MAX_FILINGS_PER_RUN]
    if len(filing_links) > MAX_FILINGS_PER_RUN:
        print(f"  NOTE: {len(filing_links) - MAX_FILINGS_PER_RUN} additional in-window filing(s) "
              f"were not processed this run (MAX_FILINGS_PER_RUN={MAX_FILINGS_PER_RUN}). Re-run to "
              f"pick up more; already-ingested signals are deduplicated by xstockstrat-ingest.")

    for i, filing_link in enumerate(capped_links, 1):
        print(f"  [{i}/{len(capped_links)}] {filing_link}")

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.set_default_timeout(15000)
                page.goto(filing_link, wait_until='load')
                page_content = page.content()

                # Look for .xml file link
                xml_match = re.search(r'href="([^"]*\.xml)"', page_content)
                if xml_match:
                    xml_file = xml_match.group(1)
                    if not xml_file.startswith('http'):
                        xml_file = SEC_EDGAR_BASE + xml_file

                    # Fetch and parse XML
                    page.goto(xml_file, wait_until='load')
                    xml_content = page.content()

                    txns = Form4Parser.extract_from_xml(xml_content)
                    for t in txns:
                        t['filing_link'] = filing_link
                    all_transactions.extend(txns)
                    print(f"    -> Found {len(txns)} transactions")

                browser.close()
        except Exception as e:
            report.add_error(f"Error fetching {filing_link}: {e}")

    print(f"\nTotal transactions extracted: {len(all_transactions)}\n")
    report.transactions_extracted = len(all_transactions)

    if not all_transactions:
        print("No transactions found in the lookback window. Exiting.")
        print(json.dumps(report.to_dict(), indent=2))
        return

    # Step 3: Fetch Yahoo Finance data for unique tickers
    print("[3] Fetching Yahoo Finance data...")
    tickers = set(t['ticker'] for t in all_transactions if t['ticker'])
    yahoo_data = {}

    for ticker in sorted(tickers):
        print(f"  {ticker}")

        # Fetch news
        news_html = YahooFinanceParser.fetch_with_browser(YAHOO_NEWS_URL.format(ticker), yahoo_timeout)
        news_sentiment = YahooFinanceParser.parse_news_sentiment(news_html)
        if news_html is None:
            report.add_error(f"Yahoo Finance news timeout/unavailable for {ticker}; scored with base conviction only")

        # Fetch risk
        risk_html = YahooFinanceParser.fetch_with_browser(YAHOO_RISK_URL.format(ticker), yahoo_timeout)
        risk_metrics = YahooFinanceParser.parse_risk_metrics(risk_html)
        if risk_html is None:
            report.add_error(f"Yahoo Finance risk data timeout/unavailable for {ticker}; scored with base conviction only")

        yahoo_data[ticker] = {
            'news_sentiment': news_sentiment,
            'risk_metrics': risk_metrics
        }
        print(f"    -> Sentiment: {news_sentiment:+.2f}, Risk: {risk_metrics}")

    # Step 4: Score signals
    print("\n[4] Scoring signals...")

    for txn in all_transactions:
        if not txn['ticker']:
            continue

        yahoo = yahoo_data.get(txn['ticker'], {})
        direction, conviction = score_conviction(
            txn,
            yahoo.get('news_sentiment', 0.0),
            yahoo.get('risk_metrics', {})
        )

        insider_name = txn.get('insider_name') or 'Unknown'
        shares = txn.get('shares', 0)
        price = txn.get('price', 0.0)

        # valid_from: the transaction date from the Form 4 XML (ISO date -> UTC midnight datetime).
        # Falls back to "now" only if the filing omitted a parseable date.
        txn_date = txn.get('date')
        if txn_date:
            valid_from = f"{txn_date}T00:00:00Z"
        else:
            valid_from = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

        if conviction >= CONVICTION_THRESHOLD:
            print(f"  {txn['ticker']}: {direction.upper()} @ {conviction:.2f} ({shares} @ ${price:.2f}) [READY TO INGEST]")
        else:
            print(f"  {txn['ticker']}: {direction.upper()} @ {conviction:.2f} ({shares} @ ${price:.2f}) [SKIPPED: below threshold]")

        report.add_signal(
            txn['ticker'],
            direction,
            conviction,
            insider_name,
            shares,
            price,
            valid_from=valid_from,
            raw_url=txn.get('filing_link'),
        )

    print(f"\nSignals ready to ingest (conviction >= {CONVICTION_THRESHOLD}): {report.signals_ingested}")
    print(f"(This script only scores and reports — see reference/ingestion.md for the actual "
          f"ingest_signal MCP calls, which the skill performs next.)")

    # Step 5: Output report
    result = report.to_dict()
    if args.output_json:
        with open(args.output_json, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\nReport written to: {args.output_json}")
    else:
        print("\n=== Report ===")
        print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
