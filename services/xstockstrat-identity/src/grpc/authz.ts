/**
 * Authorization helpers for the identity gRPC service.
 *
 * Identity is the auth provider (not a consumer), so it historically read user_id
 * from the request body. New self-management RPCs (GetUserMetadata, UpdateUserMetadata)
 * follow the platform header-propagation pattern (C-03): the caller's user_id comes from
 * the propagated x-user-id gRPC metadata header, not the request body.
 *
 * Unlike listAuthorizedApps/revokeAuthorizedApp (which accept userId in the request body),
 * these RPCs derive the caller from the propagated x-user-id metadata header (C-03). New
 * identity RPCs should follow this pattern.
 */
import { Metadata, status } from '@grpc/grpc-js';

export const HEADER_USER_ID = 'x-user-id';

/** Bitmask for the ADMIN role on the propagated `x-access-scope` header. */
export const ADMIN_SCOPE = 0x04;
export const HEADER_ACCESS_SCOPE = 'x-access-scope';

/** Read a single metadata value, or '' when absent. */
export function first(md: Metadata | undefined, key: string): string {
  if (!md) return '';
  return (md.get(key)[0] as string) ?? '';
}

/** The propagated caller id, or '' when absent. */
export function userIdFrom(md?: Metadata): string {
  return first(md, HEADER_USER_ID);
}

/**
 * True when the propagated access scope carries the ADMIN bit (feature 043). Absent metadata,
 * an absent header, and an unparseable value all resolve to scope 0 (denied) — the check fails
 * closed on the value of the header. Ported verbatim from the config service's admin gate
 * (`services/xstockstrat-config/src/grpc/authz.ts`) so all Node backends share one convention.
 */
export function hasAdminAccessScope(md?: Metadata): boolean {
  const parsed = Number.parseInt(first(md, HEADER_ACCESS_SCOPE) || '0', 10);
  if (Number.isNaN(parsed)) return false;
  return Boolean(parsed & ADMIN_SCOPE);
}

/** Denial for a caller lacking the ADMIN bit. Message matches the platform convention. */
export const ADMIN_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'admin scope required',
};
