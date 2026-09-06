/**
 * Authorization helpers for the config gRPC service — role checks only (entry points authenticate
 * and set x-access-scope). See docs/patterns/header-propagation.md § "Authorization model".
 */
import { Metadata, status } from '@grpc/grpc-js';

/** Bitmask for the ADMIN role on the propagated `x-access-scope` header. */
export const ADMIN_SCOPE = 0x04;

export const HEADER_ACCESS_SCOPE = 'x-access-scope';
export const HEADER_USER_ID = 'x-user-id';

/** Read a single metadata value, or '' when absent. */
export function first(md: Metadata | undefined, key: string): string {
  if (!md) return '';
  return (md.get(key)[0] as string) ?? '';
}

/** True when the propagated access scope carries the ADMIN bit. Fails closed on absent/unparseable. */
export function hasAdminAccessScope(md?: Metadata): boolean {
  const parsed = Number.parseInt(first(md, HEADER_ACCESS_SCOPE) || '0', 10);
  if (Number.isNaN(parsed)) return false;
  return Boolean(parsed & ADMIN_SCOPE);
}

/** The propagated caller id, or '' when absent. */
export function userIdFrom(md?: Metadata): string {
  return first(md, HEADER_USER_ID);
}

/** Denial for a caller lacking the ADMIN bit. */
export const ADMIN_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'admin scope required',
};

/**
 * Denial for a per-user write whose target user_id is not the caller's own — per-user config is
 * self-service; an ADMIN bit grants no override for another user's row.
 */
export const PER_USER_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'per-user config is self-service: you may only write your own user_id',
};

/** Denial when a write carries no attributable author — neither request.author nor x-user-id. */
export const MISSING_AUTHOR_ERROR = {
  code: status.INVALID_ARGUMENT,
  message: 'author required: set request.author or propagate x-user-id',
};

/**
 * Metadata header for the internal-caller write channel — structurally separate from x-access-scope,
 * direction-restricted per grant (a caller may only move a value toward restriction).
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
 * True when the internal-caller identity is allow-listed to write targetValue at (namespace, key).
 * Fails closed on an absent header, unlisted callerID, or a targetValue outside the caller's set.
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
 * GetSecret read-direction allow-list: which internal caller may resolve which secret's plaintext.
 * Secret plaintext is served only through this gate. Fails closed.
 */
interface SecretCallerGrant {
  callerID: string;
  namespace: string;
  /** The exact keys (within namespace) this caller may resolve. */
  keys?: ReadonlyArray<string>;
  /** Key prefixes this caller may resolve (for dynamic keys); a key is granted when it startsWith one. */
  keyPrefixes?: ReadonlyArray<string>;
}

const SECRET_CALLER_ALLOWLIST: ReadonlyArray<SecretCallerGrant> = [
  {
    callerID: 'marketdata',
    namespace: 'marketdata',
    keys: ['alpaca.api_key', 'alpaca.api_secret', 'fmp.api_key', 'finnhub.api_key'],
  },
  {
    callerID: 'ingest',
    namespace: 'ingest',
    keyPrefixes: ['mcp_credential.'],
  },
];

/**
 * True when the internal-caller identity is allow-listed to resolve the secret at (namespace, key).
 * Fails closed on an absent header, unlisted callerID, or a key outside the caller's grant.
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
      ((grant.keys?.includes(key) ?? false) ||
        (grant.keyPrefixes?.some((prefix) => key.startsWith(prefix)) ?? false)),
  );
}

/** Denial for a GetSecret caller not on the secret allow-list. */
export const SECRET_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'not authorized to resolve this secret',
};
