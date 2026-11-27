-- Feature 345 (authelia-sso): reverses 007_external_identities.up.sql.
DROP TABLE IF EXISTS identity.external_identities;
