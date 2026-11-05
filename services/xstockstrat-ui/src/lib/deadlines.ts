// Leaf module (no imports): connectClients.ts imports it, and must not import bffShared.ts (cycle).
export const DEFAULT_UNARY_TIMEOUT_MS = 30_000;
export const REFRESH_TIMEOUT_MS = 10_000;
export const LONG_RPC_TIMEOUT_MS = 300_000;
export const ORDER_MUTATION_TIMEOUT_MS = 60_000;

// Bounded deadline for snapshot-fundamentals reads: a stalled upstream must reject (→ the card's error
// state), never leave the browser's query pending forever (feature 220).
export const FUNDAMENTALS_TIMEOUT_MS = 15_000;
