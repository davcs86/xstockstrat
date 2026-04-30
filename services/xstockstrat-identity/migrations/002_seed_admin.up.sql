-- Migration: 002_seed_admin.sql
-- Service: xstockstrat-identity
-- Seeds the default admin user for development and testing.
-- Email: admin@localhost  Password: admin
-- bcrypt hash generated with 10 rounds.

INSERT INTO identity.users (email, password_hash, roles)
VALUES (
  'admin@localhost',
  '$2b$10$qLw/k7U.sIgBzT67i/VsJOi.TZqxmIgJWAAV3YW4aR4DAm.IExWWm',
  '{"admin","trader"}'
)
ON CONFLICT (email) DO NOTHING;
