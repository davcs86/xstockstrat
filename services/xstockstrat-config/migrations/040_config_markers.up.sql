-- Ships empty: feature 296's rename writes the relative_keys_v1 marker; nothing in 295 writes it.
CREATE TABLE IF NOT EXISTS config.config_markers (
  name   text        PRIMARY KEY,
  set_at timestamptz NOT NULL DEFAULT now(),
  set_by text        NOT NULL
);
