ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_metadata_size;
ALTER TABLE identity.users
  DROP COLUMN IF EXISTS metadata_updated_at,
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS phone;
