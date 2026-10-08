# Promoted from docs/roadmap/features/224-private-by-default-templates/acceptance.feature
# Source: @AC-7, @AC-8, @AC-9, @AC-10, @AC-27, @AC-33 — ingest scenarios
Feature: private-by-default-templates (ingest)
  Acceptance scenarios for the xstockstrat-ingest service promoted from feature 224.
  Covers owner-private signal sources and signals, per-owner slugs and dedup, the reserved system
  owner, and the backfill of pre-feature global signal data.

  @AC-7 @FR-4 @feature-224
  Scenario: Users manage their own signal sources without admin scope
    Given "bob" has no ADMIN scope bit
    When "bob" calls ManageSignalSource CREATE with slug "my-newsletter"
    Then the source "my-newsletter" is created with user_id "bob"
    And "alice" calling ListSignalSources does not see "my-newsletter"

  @AC-8 @FR-4 @feature-224
  Scenario: Two users may use the same source slug
    Given "alice" owns signal source "motley-fool"
    When "bob" creates signal source "motley-fool"
    Then both sources exist, one owned by "alice" and one by "bob"

  @AC-9 @FR-5 @feature-224
  Scenario: Ingested signals belong to the source owner and dedup per owner
    Given "alice" and "bob" each own source "motley-fool"
    When both ingest a BUY signal for "NVDA" from "motley-fool" at "2026-10-06T14:00:00Z"
    Then two signal rows exist, one with user_id "alice" and one with user_id "bob"
    And QuerySignals as "bob" for symbol "NVDA" returns exactly 1 signal

  @AC-10 @FR-5 @feature-224
  Scenario: A user cannot ingest into another user's source
    Given "alice" owns source "alice-feed" and "bob" owns no source with that slug
    When "bob" calls IngestSignal with source "alice-feed"
    Then the call fails with NOT_FOUND and no signal row is written

  @AC-27 @FR-11 @feature-224
  Scenario: Global signal data is backfilled to the seed user
    Given SEED_USER_ID is "seed-user" and 3 pre-feature signal sources with 120 signals exist
    When the migration runs
    Then all 3 sources and 120 signals have user_id "seed-user", except fundamentals-producer sources, which have user_id "system"

  @AC-33 @FR-6 @feature-224
  Scenario: A user cannot write as the system owner
    Given "mallory" sends x-user-id "system" without the analysis-fundsignal internal-caller grant
    When "mallory" calls IngestSignal into a "system" source
    Then the call fails with PERMISSION_DENIED and no signal row is written
