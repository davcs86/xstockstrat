/**
 * Canonical signal-source fixtures (feature 134 — C-12 centralization).
 *
 * Connect-JSON (camelCase) shape of `ingest.SignalSource`, as the mock backend echoes it. Two
 * sources with DISTINCT `reliabilityWeight` values (0.5 and 1.0) so the /config-ui inline weight-edit
 * assertion is meaningful — a fixture whose fields all equal each other tests nothing
 * (insights.md 2026-07-27).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

export const SIGNAL_SOURCE_WEIGHTED = {
  slug: 'example_simple_email',
  displayName: 'Example Simple Email',
  sourceType: 'simple_email',
  active: true,
  hasCredentials: true,
  configJson: {
    sender_patterns: ['noreply@example.com'],
    subject_patterns: ['Signal:'],
  },
  extractorModule: 'app.extractors.example_simple_email',
  // feature 083 source-health fields.
  health: 1, // SOURCE_HEALTH_STATUS_LIVE
  signalsFed: BigInt(128),
  lastError: '',
  reliabilityWeight: 0.5, // feature 134 — a non-default weight the inline editor can change
};

export const SIGNAL_SOURCE_NEUTRAL = {
  slug: 'example_website',
  displayName: 'Example Website',
  sourceType: 'authenticated_website',
  active: true,
  // hasCredentials true so proto3 serializes the bool (false is omitted) — keeps the
  // ListSignalSources contract test's `toHaveProperty('hasCredentials')` valid for both sources.
  hasCredentials: true,
  configJson: {
    url: 'https://example.com',
    scrape_selector: '.entry',
  },
  extractorModule: 'app.extractors.example_website',
  health: 1,
  signalsFed: BigInt(42),
  lastError: '',
  reliabilityWeight: 1.0, // neutral (default) weight
};

export const SIGNAL_SOURCES = [SIGNAL_SOURCE_WEIGHTED, SIGNAL_SOURCE_NEUTRAL];
