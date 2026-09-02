# Promoted from docs/roadmap/features/165-pwa-notifications/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-165` tag.
# Durable business rules the ui service already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: Installable PWA and push-notification client behavior in xstockstrat-ui
  What the consolidated UI guarantees for serving an installable web app manifest, a root-scoped
  service worker controlling all segment scopes, and the notification-click handler that focuses or
  opens the app.

  @AC-1 @FR-1 @feature-165
  Scenario: The app is installable and serves a standalone manifest
    Given the xstockstrat-ui is running
    When a browser requests "/manifest.webmanifest"
    Then a valid web app manifest is returned with "display" equal to "standalone"
    And it declares icons at 192x192 and 512x512 including a "maskable" purpose icon
    And the service worker registered at the domain root controls all four segment scopes ("/trader", "/insights", "/config-ui", "/accounts")

  @AC-9 @FR-4 @feature-165
  Scenario: Clicking a push notification opens the app
    Given the installed service worker receives a push payload with a "url" of "/trader/positions/AAPL"
    When the service worker's notification is clicked
    Then an existing app window is focused if one is open, otherwise the app opens at "/trader/positions/AAPL"
