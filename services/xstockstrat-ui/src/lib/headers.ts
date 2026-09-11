// Canonical names for the platform-internal propagation headers. Use these constants, not the raw
// strings — the DRY guard rail bans the literal header names elsewhere via ESLint. Edge-safe: plain
// string constants, importable from both the Edge runtime (`middleware.ts`) and Node BFF code.

export const HEADER_USER_ID = 'x-user-id';
export const HEADER_ACCESS_SCOPE = 'x-access-scope';
export const HEADER_TRACE_ID = 'x-trace-id';
