# Promoted from docs/roadmap/features/190-opportunities-server-side-filters/acceptance.feature at
# archive time (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-190` tag. Durable business rules xstockstrat-ui guarantees for the Opportunities page: a
# filter change refetches ListOpportunities in place (no remount) and renders the server's response
# for the new params, and the client applies no conviction-floor / source / action / sort transform of
# its own — it renders the server's already-filtered, already-ordered result verbatim. A rule enters
# only by promotion from a reviewed feature acceptance.feature, never by hand-authoring. (The
# server-side filter/sort/source/pagination guarantees are promoted to the analysis suite.)

Feature: opportunities-server-side-filters (ui-service guarantees)
  As a trader triaging the ranked opportunity queue, I want filter changes to refetch server-side and
  the page to render the server's authoritative result without re-filtering or re-sorting on the client.

  @AC-14 @FR-7 @feature-190
  Scenario: Changing a filter in place refetches without remounting
    Given the Opportunities page is mounted and showing the current queue
    When the user raises the min-conviction slider from 0 to 49 without navigating away
    Then a new ListOpportunities request is issued with the updated min_conviction
    And the rendered list is the server's response for the new floor (not a re-filter of the old rows)

  @AC-15 @FR-7 @feature-190
  Scenario: The client does not re-filter or re-sort the server result
    Given the server returns opportunities already filtered and ordered per the request params
    When the page renders the symbol groups
    Then the rendered order matches the server response order
    And no client-side conviction floor, source, action, or sort transform is applied
