Feature: legacy-authors-confirm-resolve
  As an operator repairing legacy-username formula authors, I want `confirm` to resolve
  unmappable and ambiguous rows, so that I can finish the repair from a DO console without
  editing plan.json.

  Background:
    Given users.json holds active users "davcs86" (80880990-2b79-4d85-8761-d8d9102c2efb), "alice" (11111111-1111-4111-8111-111111111111) and "alice" (22222222-2222-4222-8222-222222222222), and an inactive user "bob" (33333333-3333-4333-8333-333333333333)
    And plan.json holds F1 aaaaaaaa-0000-4000-8000-000000000001 "ghost" unmappable, F2 aaaaaaaa-0000-4000-8000-000000000002 "ghost" unmappable (soft-deleted) and F3 aaaaaaaa-0000-4000-8000-000000000003 "alice" ambiguous

  @AC-1 @FR-1 @FR-4
  Scenario: --map resolves every row of one legacy author
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then F1 and F2 in plan.json have new_author "80880990-2b79-4d85-8761-d8d9102c2efb", source "override", status "confirmed"
    And F3 is still "ambiguous"
    And the output prints the sha256 of the written plan.json

  @AC-2 @FR-2
  Scenario: an inactive target is rejected before anything is written
    When I run `confirm --map ghost=33333333-3333-4333-8333-333333333333 --yes`
    Then the exit code is non-zero and the output names user 33333333-3333-4333-8333-333333333333 as inactive
    And plan.json is byte-identical to before

  @AC-3 @FR-2
  Scenario: a map for a legacy author with no unresolved row is rejected
    When I run `confirm --map nobody=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the exit code is non-zero and the output says no unresolved row has old_author "nobody"
    And plan.json is byte-identical to before

  @AC-4 @FR-2
  Scenario: one invalid map in a batch aborts the whole batch
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --map alice=not-a-uuid --yes`
    Then the exit code is non-zero
    And F1 and F2 are still "unmappable" in plan.json

  @AC-5 @FR-3 @FR-4
  Scenario: the picker resolves a row from the numbered list
    When I run `confirm` and answer "1" to the picker for F1, "s" for F3, then "y" to the confirmation
    Then F1 has source "override" and status "confirmed" with the user chosen at position 1 of the active-user list
    And F3 is still "ambiguous"

  @AC-6 @FR-3
  Scenario: an ambiguous row's picker lists only its two candidates
    When the picker is shown for F3
    Then exactly "alice" 11111111-1111-4111-8111-111111111111 and "alice" 22222222-2222-4222-8222-222222222222 are listed
    And "davcs86" and "bob" are not listed

  @AC-7 @FR-3
  Scenario: EOF at the picker skips the row
    When I run `confirm` with stdin closed
    Then F1, F2 and F3 are unchanged and the exit code is 0

  @AC-8 @FR-4
  Scenario: declining the second confirmation writes nothing
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb` and answer "n"
    Then plan.json is byte-identical to before and no digest is printed

  @AC-9 @FR-5
  Scenario: --yes without --map never resolves a row
    When I run `confirm --yes`
    Then F1, F2 and F3 are unchanged in plan.json

  @AC-10 @FR-6
  Scenario: confirm proceeds when only unresolved rows exist
    Given plan.json has no "suggested" row
    When I run `confirm --map ghost=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the output does not say "No suggested rows to confirm"
    And F1 and F2 are "confirmed"

  @AC-11 @FR-7
  Scenario: a resolved plan passes the existing apply guards
    Given F1, F2 and F3 were resolved to active users by `confirm`
    When I run `apply --confirm-digest <printed sha256>` against a table holding F1, F2 and F3 authored "ghost", "ghost", "alice"
    Then the result counts show rewritten 3 and skipped_concurrent 0
    And legacy_authors.py is unchanged in the diff

  @AC-12 @FR-8
  Scenario: the runbook documents the new flow
    When I read docs/runbooks/legacy-formula-authors.md §5
    Then it describes `confirm --map` and the picker, and names hand-editing plan.json only as a fallback

  @AC-13 @FR-2
  Scenario: a map for an ambiguous row must name one of its candidates
    When I run `confirm --map alice=80880990-2b79-4d85-8761-d8d9102c2efb --yes`
    Then the exit code is non-zero and the output says 80880990-2b79-4d85-8761-d8d9102c2efb is not a candidate for "alice"
    And F3 is still "ambiguous" in plan.json
