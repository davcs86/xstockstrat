-- ingest 014 (AC-4): run by migration-rerun.sh after the contract replay and the refused-down recovery.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'newsletter_signals_n1_owner_fill') THEN
    RAISE EXCEPTION 'AC-4: trigger newsletter_signals_n1_owner_fill still exists';
  END IF;
  IF to_regprocedure('ingest.n1_owner_fill_signals()') IS NOT NULL THEN
    RAISE EXCEPTION 'AC-4: function ingest.n1_owner_fill_signals() still exists';
  END IF;
  IF to_regclass('ingest.signal_dedup_keys') IS NOT NULL THEN
    RAISE EXCEPTION 'AC-4: table ingest.signal_dedup_keys still exists';
  END IF;
END $$;
