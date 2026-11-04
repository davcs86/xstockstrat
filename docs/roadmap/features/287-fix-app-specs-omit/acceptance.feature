Feature: fix-app-specs-omit (bug fix)
  Regression guard for docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md:
  app specs omit the DB VPC attachment and the trusted source.

  @AC-1 @regression
  Scenario: A rendered app spec is attached to the database cluster's VPC
    Given cluster "xstockstrat" has private network UUID "d7afff57-f807-4893-9fbf-20fff8bb82dd"
    When the deploy workflow renders .do/app.yaml or .do/app.dev.yaml with that VPC ID
    Then the rendered spec has a top-level "vpc" block whose "id" is "d7afff57-f807-4893-9fbf-20fff8bb82dd"

  @AC-2 @regression
  Scenario: Rendering fails closed when the VPC ID cannot be resolved
    Given the VPC ID lookup returns an empty value
    When the deploy workflow renders an app spec
    Then rendering fails with an error naming the unfilled VPC placeholder
    And no spec without a "vpc" block is sent to doctl

  @AC-3 @regression
  Scenario: prod-up makes the new app a trusted source of the cluster
    Given "Prod — bring up" has just created app "<new id>"
    When the workflow continues after "doctl apps create"
    Then it appends the firewall rule "app:<new id>" to cluster "xstockstrat"

  @AC-4 @regression
  Scenario: prod-down removes the trusted source it added
    Given app "xstockstrat-production" exists with a cluster firewall rule "app:<its id>"
    When "Prod — tear down" runs
    Then the firewall rule for "app:<its id>" is removed and the cluster itself is untouched
