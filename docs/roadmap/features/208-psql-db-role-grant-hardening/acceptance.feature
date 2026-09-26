Feature: psql-db-role-grant-hardening (least-privilege grants for the DB-tooling role)
  As a platform operator, I want the xstockstrat_agent DB role restricted at the Postgres grant level
  to only the relations it legitimately needs, so that an authenticated DB-tool session or a credential
  leak cannot corrupt integrity-critical data or erase its own audit record.

  @AC-1 @FR-2
  Scenario: The role cannot write to the append-only event ledger
    Given a session connected as the xstockstrat_agent DB role
    When it runs "INSERT INTO ledger.events (...) VALUES (...)" and separately "DELETE FROM ledger.events"
    Then both statements are rejected by Postgres at the grant level (insufficient privilege)
    And the event store is unchanged

  @AC-2 @FR-2
  Scenario: The role cannot write identity credential / api-key tables
    Given a session connected as the xstockstrat_agent DB role
    When it attempts "UPDATE identity.api_keys SET ..." or "INSERT INTO identity.credentials (...)"
    Then the statement is rejected by Postgres at the grant level
    And no credential or api-key row is created or modified

  @AC-3 @FR-2
  Scenario: The role cannot read the config secret ciphertext column
    Given a config secret row with is_secret=true whose value_encrypted holds AES-256-GCM ciphertext
    When the xstockstrat_agent DB role runs "SELECT value_encrypted FROM config.config_entries WHERE ..."
    Then Postgres rejects the read of the value_encrypted column at the grant level
    And the ciphertext is not returned

  @AC-4 @FR-3
  Scenario: The role cannot tamper with its own audit sink
    Given the psql-MCP durable audit sink (feature 193) contains an audit row for a prior statement
    When the xstockstrat_agent DB role attempts to UPDATE or DELETE that audit row
    Then Postgres rejects the modify/delete at the grant level
    And the audit record remains intact

  @AC-5 @FR-1 @FR-4
  Scenario: The role retains exactly the legitimate DML it needs and no DDL
    Given the narrowed grant set is applied
    When the xstockstrat_agent DB role runs a legitimate analytics-schema statement it is meant to run (e.g. an INSERT into an allowed analytics table)
    Then that statement succeeds
    And a "CREATE TABLE public.evil (id int)" by the same role is rejected at the grant level

  @AC-6 @FR-5
  Scenario: The grant matrix is idempotent and introspectable
    Given the grants/revokes migration (or db-migrate.sh role block)
    When it is applied twice in succession
    Then the second application completes without error (idempotent)
    And an introspection query over information_schema.role_table_grants / pg_catalog reports the effective privilege set equals the intended least-privilege matrix
