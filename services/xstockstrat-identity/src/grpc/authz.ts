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
import { Metadata } from '@grpc/grpc-js';

export const HEADER_USER_ID = 'x-user-id';

/** Read a single metadata value, or '' when absent. */
export function first(md: Metadata | undefined, key: string): string {
  if (!md) return '';
  return (md.get(key)[0] as string) ?? '';
}

/** The propagated caller id, or '' when absent. */
export function userIdFrom(md?: Metadata): string {
  return first(md, HEADER_USER_ID);
}
