-- Migration: 016_seed_source_templates.down.sql
-- Service: xstockstrat-ingest
-- feature 335: never touches ingest.signal_sources — signals reference the fundamentals source and the
-- producer may have created it.

DELETE FROM ingest.source_templates
 WHERE template_id IN ('tpl-sec_edgar_8k', 'tpl-sec_edgar_form4', 'tpl-prnewswire_releases', 'tpl-robinhood_snacks')
   AND version = 1 AND retired_at IS NULL AND created_by = 'system';
