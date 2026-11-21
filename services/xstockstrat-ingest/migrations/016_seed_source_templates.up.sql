-- Migration: 016_seed_source_templates.up.sql
-- Service: xstockstrat-ingest
-- feature 335: data only. Seeds the system source templates (created_by = 'system' rows are read-only
-- through ManageTemplate) and the system fundamentals source when no owner holds that slug.
-- Row grammar is fixed (four dollar-quoted literals per row) and parsed by tests.

INSERT INTO ingest.source_templates (template_id, name, description, payload, created_by)
VALUES
  ($t$tpl-sec_edgar_8k$t$, $t$SEC EDGAR — 8-K Current Filings$t$, $t$Replace the request User-Agent contact with your own before use (SEC fair-access policy).$t$, $t${"slug": "sec_edgar_8k", "display_name": "SEC EDGAR — 8-K Current Filings", "source_type": "mediated_simple_website", "config_json": {"url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=100&output=atom", "scrape_selector": "entry", "request_headers": {"User-Agent": "xstockstrat-agent/1.0 (contact@example.com)"}, "notes": "Latest 8-K material-event filings across all issuers (Atom feed). Event-shaped disclosures filed within 4 business days; scope deliberately excludes 10-K/10-Q sentiment (see demoted feature 035). request_headers satisfies SEC fair-access policy (declared User-Agent), honored by the agent once PR #770 deploys."}, "reliability_weight": 1.0}$t$::jsonb, 'system'),
  ($t$tpl-sec_edgar_form4$t$, $t$SEC EDGAR — Form 4 Insider Transactions$t$, $t$Replace the request User-Agent contact with your own before use (SEC fair-access policy).$t$, $t${"slug": "sec_edgar_form4", "display_name": "SEC EDGAR — Form 4 Insider Transactions", "source_type": "mediated_simple_website", "config_json": {"url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom", "scrape_selector": "entry", "request_headers": {"User-Agent": "xstockstrat-agent/1.0 (contact@example.com)"}, "notes": "Latest Form 4 insider-transaction filings (Atom feed), filed within 2 business days of the trade. request_headers satisfies SEC fair-access policy (declared User-Agent), honored by the agent once PR #770 deploys."}, "reliability_weight": 1.0}$t$::jsonb, 'system'),
  ($t$tpl-prnewswire_releases$t$, $t$PR Newswire — Latest News Releases$t$, $t$$t$, $t${"slug": "prnewswire_releases", "display_name": "PR Newswire — Latest News Releases", "source_type": "mediated_simple_website", "config_json": {"url": "https://www.prnewswire.com/news-releases/news-releases-list/", "scrape_selector": "a.newsreleaseconsolidatelink", "notes": "Issuer-direct press releases (earnings, M&A, guidance, FDA/contract announcements). Promotional framing — weight below regulatory sources."}, "reliability_weight": 1.0}$t$::jsonb, 'system'),
  ($t$tpl-robinhood_snacks$t$, $t$Robinhood snacks newsletter$t$, $t$$t$, $t${"slug": "robinhood_snacks", "display_name": "Robinhood snacks newsletter", "source_type": "mediated_simple_email", "config_json": {"sender_patterns": ["hello@snacks.robinhood.com"], "subject_patterns": ["*"]}, "reliability_weight": 1.0}$t$::jsonb, 'system')
ON CONFLICT (template_id) DO NOTHING;

DO $$
DECLARE held TEXT;
BEGIN
  SELECT string_agg(template_id, ', ' ORDER BY template_id) INTO held
    FROM ingest.source_templates
   WHERE template_id IN ('tpl-sec_edgar_8k', 'tpl-sec_edgar_form4', 'tpl-prnewswire_releases', 'tpl-robinhood_snacks')
     AND created_by <> 'system';
  IF held IS NOT NULL THEN
    RAISE EXCEPTION 'ingest seed_source_templates: seeded template_id held by a non-system row: %', held;
  END IF;
END $$;

-- A slug any owner already holds gains no system holder; an existing system row is never modified.
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fundamentals'));
  IF NOT EXISTS (SELECT 1 FROM ingest.signal_sources WHERE slug = 'fundamentals') THEN
    INSERT INTO ingest.signal_sources
      (user_id, slug, display_name, source_type, extractor_module, credentials_ref, config_json, active, reliability_weight)
    VALUES ('system', 'fundamentals', 'Fundamentals Signal Producer', 'derived', 'app.extractors.noop', NULL, NULL, TRUE, 1.0);
  END IF;
END $$;
