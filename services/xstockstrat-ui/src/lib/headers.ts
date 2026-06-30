// Canonical names for the platform-internal propagation headers.
//
// Every BFF / route handler that forwards identity to a backend gRPC service must use
// these constants instead of inlining the raw string — the DRY guard rail
// (docs/patterns/dry-guard-rail.md) bans the literal header names everywhere except this
// file via ESLint `no-restricted-syntax`. See docs/patterns/header-propagation.md for the
// propagation contract.
//
// Edge-safe: this module is a plain set of string constants and is importable from both
// the Edge runtime (`middleware.ts`) and Node BFF code.

export const HEADER_USER_ID = 'x-user-id';
export const HEADER_ACCESS_SCOPE = 'x-access-scope';
export const HEADER_TRACE_ID = 'x-trace-id';
