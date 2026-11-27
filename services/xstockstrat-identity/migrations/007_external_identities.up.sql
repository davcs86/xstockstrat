-- Feature 345 (authelia-sso): OIDC (issuer, subject) → user links; one link per user per issuer.
-- Idempotent DDL; nothing matches by email, so there is no email index.
CREATE TABLE IF NOT EXISTS identity.external_identities (
  issuer    TEXT        NOT NULL,
  subject   TEXT        NOT NULL,
  user_id   UUID        NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_identities_pkey PRIMARY KEY (issuer, subject),
  CONSTRAINT external_identities_issuer_user_key UNIQUE (issuer, user_id)
);
