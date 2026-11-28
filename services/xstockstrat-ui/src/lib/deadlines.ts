// Leaf module (no imports): connectClients.ts imports it, and must not import bffShared.ts (cycle).
export const DEFAULT_UNARY_TIMEOUT_MS = 30_000;
export const REFRESH_TIMEOUT_MS = 10_000;
export const LONG_RPC_TIMEOUT_MS = 300_000;
export const ORDER_MUTATION_TIMEOUT_MS = 60_000;

// Bounded deadline for snapshot-fundamentals reads: a stalled upstream must reject (→ the card's error
// state), never leave the browser's query pending forever (feature 220).
export const FUNDAMENTALS_TIMEOUT_MS = 15_000;

// The symbol page's history-depth config read gates its first bars request, so it must fail fast
// (a timeout falls back to the default depth, feature 341).
export const HISTORY_CONFIG_TIMEOUT_MS = 3_000;

// Auth-path deadlines and ID-token checks are protocol constants, not WatchConfig keys (F-07):
// changing one changes the SSO contract with the issuer, which needs a code review.
export const AUTH_CONFIG_TIMEOUT_MS = 10_000;
export const OIDC_TIMEOUT_S = 10;
export const OIDC_DISCOVERY_FRESH_S = 600;
export const OIDC_ID_TOKEN_ALG = 'RS256';
export const OIDC_CLOCK_SKEW_S = 30;

export function raceDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline exceeded')), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}
