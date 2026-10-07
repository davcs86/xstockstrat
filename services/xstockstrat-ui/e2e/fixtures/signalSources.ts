import { TEST_USER_ID } from './users';

/**
 * Canonical signal-source fixtures (feature 134 — C-12 centralization).
 *
 * Connect-JSON (camelCase) shape of `ingest.SignalSource`, as the mock backend echoes it. Two
 * sources with DISTINCT `reliabilityWeight` values (0.5 and 1.0) so the /insights/signal-sources
 * inline weight-edit assertion is meaningful — a fixture whose fields all equal each other tests nothing
 * (insights.md 2026-07-27).
 *
 * Feature 224: sources are owner-scoped. The two editable sources belong to `TEST_USER_ID`;
 * `SIGNAL_SOURCE_SYSTEM` is platform-held (`userId: "system"`) and read-only to every user.
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
  userId: TEST_USER_ID,
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
  userId: TEST_USER_ID,
};

/** Owner of platform-held sources (mirrors `SYSTEM_SOURCE_OWNER` in src/hooks/useOwnSignalSources.ts). */
export const SYSTEM_SOURCE_OWNER_ID = 'system';

export const SIGNAL_SOURCE_SYSTEM = {
  slug: 'fundsignal',
  displayName: 'Fundamentals Signal',
  sourceType: 'simple_website',
  active: true,
  hasCredentials: true,
  configJson: { url: 'https://fundamentals.example', scrape_selector: '.row' },
  extractorModule: 'app.extractors.fundsignal',
  health: 1,
  signalsFed: BigInt(7),
  lastError: '',
  reliabilityWeight: 0.9, // distinct from both user sources
  userId: SYSTEM_SOURCE_OWNER_ID,
};

export const SIGNAL_SOURCES = [SIGNAL_SOURCE_WEIGHTED, SIGNAL_SOURCE_NEUTRAL, SIGNAL_SOURCE_SYSTEM];
