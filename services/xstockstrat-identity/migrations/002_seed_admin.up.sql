-- Migration: 002_seed_admin.sql
-- Service: xstockstrat-identity
-- Seeds the default admin user for LOCAL DEVELOPMENT AND TESTING ONLY.
-- Default credentials: Email: admin@localhost  Password: admin
-- These credentials are ONLY safe for local Docker Compose dev environments.
-- In production, rotate this user's password immediately after first deployment.
-- The bcrypt hash below is a one-way hash of the string "admin" (10 rounds) — not a secret.

INSERT INTO identity.users (email, password_hash, roles)
VALUES (
  'admin@localhost',
  '$2b$10$qLw/k7U.sIgBzT67i/VsJOi.TZqxmIgJWAAV3YW4aR4DAm.IExWWm',
  '{"admin","trader"}'
)
ON CONFLICT (email) DO NOTHING;
