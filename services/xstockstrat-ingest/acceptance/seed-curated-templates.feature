# Promoted from docs/roadmap/features/335-seed-curated-templates/acceptance.feature
# Source: @AC-6, @AC-7, @AC-11, @AC-12, @AC-18, @AC-40 — ingest scenarios
Feature: seed-curated-templates (ingest)
  Acceptance scenarios for the xstockstrat-ingest service promoted from feature 335.
  Covers the seeded source template catalog and its instantiation, and the seeded system fundamentals
  signal source (never overwritten, never added over a user-held slug, kept by the down migration).

  @AC-6 @FR-5 @feature-335
  Scenario: Source catalog is seeded with the 4 mediated staging sources
    Given a database with all ingest migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on ingest
    Then the response contains exactly 4 templates whose payload slugs are "sec_edgar_8k", "sec_edgar_form4", "prnewswire_releases" and "robinhood_snacks"
    And the "sec_edgar_form4" payload has source_type "mediated_simple_website" and config_json.scrape_selector "entry"

  @AC-7 @FR-5 @feature-335
  Scenario: A seeded website source template instantiates into a private source
    Given the seeded source template for "prnewswire_releases"
    When "bob" instantiates it with slug "bob_prnewswire"
    Then "bob" owns an active source "bob_prnewswire" with config_json.url "https://www.prnewswire.com/news-releases/news-releases-list/" and reliability_weight 1.0

  @AC-11 @FR-8 @feature-335
  Scenario: The system fundamentals source exists after migration
    Given a freshly migrated ingest database in which the fundamentals producer has never run
    When ingest.signal_sources is queried for slug "fundamentals"
    Then exactly 1 row exists with user_id "system", source_type "derived" and display_name "Fundamentals Signal Producer"

  @AC-12 @FR-8 @feature-335
  Scenario: Seeding the fundamentals source never overwrites an existing row
    Given ingest.signal_sources already holds the system "fundamentals" source with reliability_weight 0.4
    When the ingest seed migration's up SQL is executed
    Then the "fundamentals" row still has reliability_weight 0.4

  @AC-18 @FR-6 @FR-8 @feature-335
  Scenario: The ingest down migration leaves the fundamentals source in place
    Given the ingest seed migration has been applied
    When the ingest seed migration's down SQL is executed
    Then ingest.source_templates holds 0 rows with created_by "system"
    And ingest.signal_sources still holds the "fundamentals" row owned by "system"

  @AC-40 @FR-8 @feature-335
  Scenario: A user-held fundamentals slug gains no system holder
    Given ingest.signal_sources holds "fundamentals" owned by user "u-1" and no system row
    When the ingest seed migration's up SQL is executed
    Then ingest.signal_sources holds 0 rows with slug "fundamentals" and user_id "system"
