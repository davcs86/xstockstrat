Feature: psql-db-role-grant-hardening (orphaned-role teardown + integrity-critical write audit)
  As a platform operator, I want the orphaned xstockstrat_agent DB role removed once its consumer is
  gone, and every remaining DB role unable to write the ledger, identity secrets, or config ciphertext
  beyond its legitimate need, so that no dormant privileged identity lingers and no role can corrupt
  integrity-critical data.

  @AC-1 @FR-1
  Scenario: The orphaned xstockstrat_agent role is torn down
    Given feature 211 has removed the agent's use of the xstockstrat_agent DB role
    When the teardown migration is applied
    Then the xstockstrat_agent role no longer exists (or holds zero privileges and is NOLOGIN, documented as such)
    And attempting to connect/authenticate as xstockstrat_agent fails

  @AC-2 @FR-2
  Scenario: No remaining role can write the append-only event ledger beyond intent
    Given the roles that remain after teardown
    When each non-owner role attempts "INSERT INTO ledger.events (...)" and "DELETE FROM ledger.events"
    Then Postgres rejects the write at the grant level for every role not legitimately required to write it
    And the event store is unchanged

  @AC-3 @FR-2
  Scenario: No remaining role can write identity secrets or read config ciphertext beyond intent
    Given the roles that remain after teardown
    When a non-owner role attempts "UPDATE identity.api_keys ..." and "SELECT value_encrypted FROM config.config_entries ..."
    Then the write to identity secret tables is rejected at the grant level for non-owner roles
    And the read of the value_encrypted ciphertext column is rejected for every role but the intended owner

  @AC-4 @FR-4
  Scenario: Every live service role retains the DB access it needs
    Given the connection-pool inventory in the root CLAUDE.md
    When each still-active service connects and runs its normal workload after the teardown
    Then no live service loses required read/write access
    And only the orphaned xstockstrat_agent role was removed

  @AC-5 @FR-3
  Scenario: The teardown and audit are idempotent and introspectable
    Given the teardown / grant-tightening migration
    When it is applied twice in succession
    Then the second application completes without error (idempotent)
    And an introspection query over pg_catalog / information_schema.role_table_grants reports that xstockstrat_agent is absent (or zero-privilege + NOLOGIN) and the integrity-critical write matrix for remaining roles matches the intended least-privilege set
