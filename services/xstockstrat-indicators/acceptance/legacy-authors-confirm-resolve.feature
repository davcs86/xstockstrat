# Promoted from docs/roadmap/features/284-legacy-authors-confirm-resolve/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-284` tag.
# Durable business rules xstockstrat-indicators already guarantees: a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
# Source: @AC-1..@AC-11, @AC-13..@AC-22 (@AC-12 omitted: documentation-only, asserts runbook text).
Feature: legacy-authors-confirm-resolve (indicators)
  As an operator repairing legacy-username formula authors, I want `confirm` to resolve
  unmappable and ambiguous rows, so that I can finish the repair from a DO console without
  editing plan.json.

  Background:
    Given users.json holds active users "davcs86" (80880990-2b79-4d85-8761-d8d9102c2efb), "alice" (11111111-1111-4111-8111-111111111111) and "alice" (22222222-2222-4222-8222-222222222222), and an inactive user "bob" (33333333-3333-4333-8333-333333333333)
    And plan.json holds F1 aaaaaaaa-0000-4000-8000-000000000001 "ghost" unmappable, F2 aaaaaaaa-0000-4000-8000-000000000002 "ghost" unmappable (soft-deleted) and F3 aaaaaaaa-0000-4000-8000-000000000003 "alice" ambiguous

  @AC-1 @FR-1 @FR-4 @feature-284
  Scenario: --map resolves every row of one legacy author
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then F1 and F2 in plan.json have new_author "80880990-2b79-4d85-8761-d8d9102c2efb", source "override", status "confirmed"
    And F3 is still "ambiguous"
    And the output prints the sha256 of the written plan.json

  @AC-2 @FR-2 @feature-284
  Scenario: an inactive target is rejected before anything is written
    When I run `confirm --map ghost=33333333-3333-4333-8333-333333333333 --yes`
    Then the exit code is 2 and the output names user 33333333-3333-4333-8333-333333333333 as inactive
    And plan.json is byte-identical to before

  @AC-3 @FR-2 @feature-284
  Scenario: a map for a legacy author with no unresolved row is rejected
    When I run `confirm --map nobody=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the exit code is 2 and the output says no unresolved row has old_author "nobody"
    And plan.json is byte-identical to before

  @AC-4 @FR-2 @feature-284
  Scenario: one invalid map in a batch aborts the whole batch
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --map alice=not-a-uuid --yes`
    Then the exit code is 2
    And F1 and F2 are still "unmappable" in plan.json

  @AC-5 @FR-3 @FR-4 @feature-284
  Scenario: the picker resolves a row from the numbered list
    When I run `confirm` and answer "1" to the picker for "ghost" (F1 and F2 together), "s" to the picker for "alice" (F3), then "y" to the confirmation
    Then F1 and F2 have new_author "80880990-2b79-4d85-8761-d8d9102c2efb" ("davcs86", position 1 in users.json order), source "override" and status "confirmed"
    And F3 is still "ambiguous"

  @AC-6 @FR-3 @feature-284
  Scenario: an ambiguous row's picker lists only its two candidates
    When the picker is shown for F3
    Then exactly "alice" 11111111-1111-4111-8111-111111111111 and "alice" 22222222-2222-4222-8222-222222222222 are listed
    And "davcs86" and "bob" are not listed

  @AC-7 @FR-3 @feature-284
  Scenario: EOF at the picker skips the row
    When I run `confirm` with stdin closed
    Then F1, F2 and F3 are unchanged and the exit code is 0

  @AC-8 @FR-4 @feature-284
  Scenario: declining the second confirmation writes nothing
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb`, answer "s" to the picker for "alice" (F3), then answer "n" to the confirmation
    Then plan.json is byte-identical to before and no digest is printed

  @AC-9 @FR-5 @feature-284
  Scenario: --yes without --map never resolves a row
    When I run `confirm --yes`
    Then F1, F2 and F3 are unchanged in plan.json

  @AC-10 @FR-6 @feature-284
  Scenario: confirm proceeds when only unresolved rows exist
    Given plan.json has no "suggested" row
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the output does not say "No suggested rows to confirm"
    And F1 and F2 are "confirmed"

  @AC-11 @FR-7 @feature-284
  Scenario: a resolved plan passes the existing apply guards
    Given F1, F2 and F3 were resolved to active users by `confirm`
    When I run `apply --confirm-digest <printed sha256>` against a table holding F1, F2 and F3 authored "ghost", "ghost", "alice"
    Then the result counts show rewritten 3 and skipped_concurrent 0 and no "refused:" line is printed

  @AC-13 @FR-2 @feature-284
  Scenario: a map for an ambiguous row must name one of its candidates
    When I run `confirm --map alice=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the exit code is 2 and the output says 80880990-2b79-4d85-8761-d8d9102c2efb is not a candidate for "alice"
    And F3 is still "ambiguous" in plan.json

  @AC-14 @FR-2 @feature-284
  Scenario: a well-formed user id that is not in users.json is rejected
    When I run `confirm --map ghost=44444444-4444-4444-8444-444444444444 --yes`
    Then the exit code is 2 and the output says 44444444-4444-4444-8444-444444444444 is not in users.json
    And plan.json is byte-identical to before

  @AC-15 @FR-2 @feature-284
  Scenario: one legacy author mapped to two different users is rejected
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --map ghost=11111111-1111-4111-8111-111111111111 --yes`
    Then the exit code is 2 and the output says "ghost" is mapped to two different users
    And plan.json is byte-identical to before

  @AC-16 @FR-5 @FR-6 @feature-284
  Scenario: --yes with --map also confirms suggested rows as it does today
    Given plan.json also holds F4 aaaaaaaa-0000-4000-8000-000000000004 "davcs86" suggested for 80880990-2b79-4d85-8761-d8d9102c2efb
    When I run `confirm --map ghost=11111111-1111-4111-8111-111111111111 --yes`
    Then F4 is "confirmed" and F1 and F2 are "confirmed" with source "override" and new_author "11111111-1111-4111-8111-111111111111"
    And F3 is still "ambiguous"

  @AC-17 @FR-4 @feature-284
  Scenario: one prompt covers suggested and resolved rows
    Given plan.json also holds F4 aaaaaaaa-0000-4000-8000-000000000004 "davcs86" suggested for 80880990-2b79-4d85-8761-d8d9102c2efb
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb`, answer "s" to the picker for "alice" (F3), then answer "y" to the confirmation
    Then F4, F1 and F2 are "confirmed" and exactly one confirmation prompt was shown

  @AC-18 @FR-3 @feature-284
  Scenario: an unreadable users.json skips the picker and keeps the suggested-only flow
    Given users.json is missing and plan.json holds F4 aaaaaaaa-0000-4000-8000-000000000004 "davcs86" suggested plus F1 "ghost" unmappable
    When I run `confirm` and answer "y" to the confirmation
    Then the output warns that users.json could not be read and the picker was skipped
    And F4 is "confirmed", F1 is still "unmappable", and the exit code is 0

  @AC-19 @FR-3 @feature-284
  Scenario: an author with no eligible user is skipped without a prompt
    Given users.json holds no active user whose email local part is "alice"
    When the picker reaches F3 "alice" (ambiguous in the plan)
    Then the output says there is no eligible user for "alice", no prompt is shown for it, and F3 is still "ambiguous"

  @AC-20 @FR-5 @feature-284
  Scenario: --yes with --map prints the override targets it wrote
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the output lists F1 and F2 with "davcs86 (80880990-2b79-4d85-8761-d8d9102c2efb)" and status "confirmed" before the digest

  @AC-21 @FR-4 @feature-284
  Scenario: a declined confirmation says so
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb`, answer "s" to the picker for "alice" (F3), then answer "n" to the confirmation
    Then the output contains "Not confirmed; plan.json unchanged." and no digest

  @AC-22 @FR-3 @feature-284
  Scenario: EOF stops the picker for every remaining author
    Given plan.json holds F1 "ghost" unmappable and F5 "carol" unmappable, and stdin is closed
    When I run `confirm`
    Then the active-user list is printed at most once and F1 and F5 are still "unmappable"
