/**
 * Authorization helpers for the config gRPC service.
 *
 * Platform model (docs/patterns/header-propagation.md § "Authorization model"):
 * entry points authenticate and set `x-access-scope` from verified claims; internal
 * services role-check only — they do not re-validate a credential. Admin-gated RPCs
 * check the ADMIN bit and abort PERMISSION_DENIED ("admin scope required").
 *
 * This is the first role check in a Node backend service on the platform; the Python
 * reference is `_has_admin_scope` in the ingest/analysis/indicators servicers. The
 * metadata accessor deliberately matches the published Node shape in
 * docs/patterns/header-propagation.md so the other Node services copy one convention.
 *
 * NOTE: this module intentionally does NOT revive `src/middleware/propagation.ts`.
 * That file is an unused HTTP-era AsyncLocalStorage store duplicated across all four
 * Node services; config makes no outbound per-request calls, so it needs the role
 * check, not the propagation store.
 */
import { Metadata, status } from '@grpc/grpc-js';

/** Bitmask for the ADMIN role on the propagated `x-access-scope` header. */
export const ADMIN_SCOPE = 0x04;

export const HEADER_ACCESS_SCOPE = 'x-access-scope';
export const HEADER_USER_ID = 'x-user-id';

/**
 * Read a single metadata value, or '' when absent. Exported (feature 102) so
 * `configServiceImpl.ts` can resolve the raw `x-internal-caller` value for
 * `caller_identity` persistence — mirrors `userIdFrom`'s existing wrapper for `x-user-id`,
 * but `x-internal-caller` has no dedicated wrapper of its own since
 * `hasInternalCallerAuthority` already consumes it internally.
 */
export function first(md: Metadata | undefined, key: string): string {
  if (!md) return '';
  return (md.get(key)[0] as string) ?? '';
}

/**
 * True when the propagated access scope carries the ADMIN bit.
 * Absent metadata, an absent header, and an unparseable value all resolve to scope 0
 * (denied) — the check fails closed on the value of the header.
 */
export function hasAdminAccessScope(md?: Metadata): boolean {
  const parsed = Number.parseInt(first(md, HEADER_ACCESS_SCOPE) || '0', 10);
  if (Number.isNaN(parsed)) return false;
  return Boolean(parsed & ADMIN_SCOPE);
}

/** The propagated caller id, or '' when absent. */
export function userIdFrom(md?: Metadata): string {
  return first(md, HEADER_USER_ID);
}

/** Denial for a caller lacking the ADMIN bit. Message matches the platform convention. */
export const ADMIN_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'admin scope required',
};

/**
 * Denial for a per-user write whose target `user_id` is not the caller's own (PR #994). A per-user
 * config row is **self-service**: only its owner may write it, and — unlike a global write — an
 * ADMIN caller earns NO override for someone else's per-user row (admins reach only globals and
 * their own per-user rows). The gate compares the propagated `x-user-id` against the request's
 * `user_id`, so an edge that fails to propagate the caller id lands here rather than silently
 * writing another user's row.
 */
export const PER_USER_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'per-user config is self-service: you may only write your own user_id',
};

/**
 * Denial when a write carries no attributable author at all — neither an explicit
 * `author` field nor a propagated `x-user-id`. Mirrors the indicators servicer, where
 * `request.author` wins and the propagated id is the fallback.
 */
export const MISSING_AUTHOR_ERROR = {
  code: status.INVALID_ARGUMENT,
  message: 'author required: set request.author or propagate x-user-id',
};

/**
 * Internal-caller channel for a background/automated process to write a normally
 * human-operator-gated key without extending x-access-scope's user-role bitmap (which only ever
 * carries a value *forwarded* from a real authenticated human — see docs/patterns/
 * header-propagation.md). Structurally separate: a distinct metadata field, a hardcoded
 * {callerID, namespace, key, allowedTargetValues} allow-list, and — critically — a
 * direction restriction so a caller can only ever move a value *toward* restriction, never
 * back toward an unrestricted state (feature 102).
 */
export const HEADER_INTERNAL_CALLER = 'x-internal-caller';

interface InternalCallerGrant {
  callerID: string;
  namespace: string;
  key: string;
  /** The only values this caller may write to (namespace, key) — never the unrestricted value. */
  allowedTargetValues: ReadonlyArray<string>;
}

const INTERNAL_CALLER_ALLOWLIST: ReadonlyArray<InternalCallerGrant> = [
  {
    callerID: 'trading-reconciliation-poller',
    namespace: 'platform',
    key: 'trading_state',
    allowedTargetValues: ['REDUCE_ONLY', 'HALTED'], // never 'ACTIVE' — escalation only
  },
];

/**
 * True when the propagated internal-caller identity is allow-listed to write targetValue at
 * (namespace, key). Fails closed: an absent header, an unlisted callerID, or a targetValue
 * outside that caller's allowed set all return false.
 */
export function hasInternalCallerAuthority(
  md: Metadata | undefined,
  namespace: string,
  key: string,
  targetValue: string,
): boolean {
  const callerID = first(md, HEADER_INTERNAL_CALLER);
  if (!callerID) return false;
  return INTERNAL_CALLER_ALLOWLIST.some(
    (grant) =>
      grant.callerID === callerID &&
      grant.namespace === namespace &&
      grant.key === key &&
      grant.allowedTargetValues.includes(targetValue),
  );
}

/**
 * GetSecret allow-list (feature 147). Structurally identical to the internal-caller write
 * allow-list above, but for the READ direction: which internal service (`x-internal-caller`) may
 * resolve a secret's decrypted plaintext for which (namespace, key). Secret plaintext is served
 * only through this gate — never on WatchConfig/GetConfig/ListKeys — so an un-allow-listed caller
 * can never read a credential. Fails closed on an absent/unlisted caller.
 */
interface SecretCallerGrant {
  callerID: string;
  namespace: string;
  /** The exact keys (within namespace) this caller may resolve. */
  keys: ReadonlyArray<string>;
}

const SECRET_CALLER_ALLOWLIST: ReadonlyArray<SecretCallerGrant> = [
  {
    callerID: 'marketdata',
    namespace: 'marketdata',
    keys: ['alpaca.api_key', 'alpaca.api_secret', 'fmp.api_key', 'finnhub.api_key'],
  },
];

/**
 * True when the propagated internal-caller identity is allow-listed to resolve the secret at
 * (namespace, key) via GetSecret. Fails closed: an absent `x-internal-caller`, an unlisted
 * callerID, or a key outside that caller's grant all return false.
 */
export function hasSecretCallerAuthority(
  md: Metadata | undefined,
  namespace: string,
  key: string,
): boolean {
  const callerID = first(md, HEADER_INTERNAL_CALLER);
  if (!callerID) return false;
  return SECRET_CALLER_ALLOWLIST.some(
    (grant) =>
      grant.callerID === callerID &&
      grant.namespace === namespace &&
      grant.keys.includes(key),
  );
}

/** Denial for a GetSecret caller not on the secret allow-list. */
export const SECRET_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'not authorized to resolve this secret',
};
