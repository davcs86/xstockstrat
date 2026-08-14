ALTER TABLE identity.users
  ADD COLUMN phone TEXT,
  ADD COLUMN display_name TEXT,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN metadata_updated_at TIMESTAMPTZ;

ALTER TABLE identity.users
  ADD CONSTRAINT users_metadata_size CHECK (octet_length(metadata::text) <= 8192);
