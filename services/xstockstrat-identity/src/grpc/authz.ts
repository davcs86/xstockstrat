/**
 * Authorization helpers for the identity gRPC service. Caller identity comes from the propagated
 * x-user-id metadata header; request-body user_id is ignored except by ListAuthorizedApps/RevokeAuthorizedApp.
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
 * True when the propagated access scope carries the ADMIN bit. Fails closed (false) on absent
 * metadata, an absent header, or an unparseable value.
 */
export function hasAdminAccessScope(md?: Metadata): boolean {
  const parsed = Number.parseInt(first(md, HEADER_ACCESS_SCOPE) || '0', 10);
  if (Number.isNaN(parsed)) return false;
  return Boolean(parsed & ADMIN_SCOPE);
}

/** Denial for a caller lacking the ADMIN bit. */
export const ADMIN_SCOPE_ERROR = {
  code: status.PERMISSION_DENIED,
  message: 'admin scope required',
};
