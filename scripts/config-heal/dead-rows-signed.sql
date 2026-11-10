-- dead_rows_305:begin
(VALUES
  ('analysis', 'opportunity.sparkline_bars', 'production', 'f5ca38f748a1d6eaf726b8a42fb575c3c71f1864a8143301782de13da2d9202b'),
  ('analysis', 'opportunity.sparkline_bars', 'staging', 'f5ca38f748a1d6eaf726b8a42fb575c3c71f1864a8143301782de13da2d9202b'),
  ('marketdata', 'alpaca.paper', 'production', 'fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa'),
  ('marketdata', 'alpaca.paper', 'staging', 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b')
) AS dead_rows_305(namespace, key, environment, value_sha256)
-- dead_rows_305:end
