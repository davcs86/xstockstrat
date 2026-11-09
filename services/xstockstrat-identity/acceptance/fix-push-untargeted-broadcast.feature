# Promoted from docs/roadmap/features/242-fix-push-untargeted-broadcast/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-242` tag.

Feature: xstockstrat-identity - ListAdminUserIds is an admin-ID lookup for the notify peer only

  @AC-9 @FR-4 @feature-242
  Scenario: ListAdminUserIds returns active admin user IDs only to the notify peer
    Given identity users "user-99" (admin, active), "user-98" (admin, inactive) and "user-42" (not admin, active)
    When a caller whose mTLS peer certificate SAN is "xstockstrat-notify" calls ListAdminUserIds
    Then the response user_ids are exactly ["user-99"]
    And the response carries no field other than user_ids

  @AC-10 @FR-4 @feature-242
  Scenario Outline: ListAdminUserIds denies every non-notify peer before touching identity.users
    Given a caller whose mTLS peer SAN is <peer> and whose metadata carries x-access-scope "4" and x-user-id "system"
    When it calls ListAdminUserIds
    Then identity returns PERMISSION_DENIED
    And no query is issued against identity.users

    Examples:
      | peer                        |
      | "xstockstrat-ui"            |
      | "xstockstrat-notify.evil"   |
      | "xstockstrat-notifyx"       |
      | absent                      |
