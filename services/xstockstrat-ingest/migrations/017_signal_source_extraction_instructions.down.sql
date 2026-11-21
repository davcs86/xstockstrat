-- Migration: 017_signal_source_extraction_instructions.down.sql
-- Service: xstockstrat-ingest

UPDATE ingest.source_templates
   SET payload = payload - 'extraction_instructions'
 WHERE template_id IN ('tpl-sec_edgar_8k', 'tpl-sec_edgar_form4', 'tpl-prnewswire_releases', 'tpl-robinhood_snacks')
   AND created_by = 'system'
   AND payload ? 'extraction_instructions';

ALTER TABLE ingest.signal_sources
    DROP COLUMN IF EXISTS extraction_instructions;
