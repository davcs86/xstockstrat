import { Role } from '@xstockstrat/proto/identity/v1/identity_pb';

// Exhaustive Role → display label map (feature 043, C-10(a/d)): adding a proto Role value without a
// label here fails `tsc` in this file, so a new role can never render as a bare number. Mirrors the
// enum-render-map convention in src/lib/opportunityShared.tsx.
export const ROLE_LABELS: Record<Role, string> = {
  [Role.UNSPECIFIED]: '—',
  [Role.ADMIN]: 'Admin',
  [Role.TRADER]: 'Trader',
  [Role.VIEWER]: 'Viewer',
};

/** The assignable (non-sentinel) roles, for a create/edit multi-select. */
export const ASSIGNABLE_ROLES: Role[] = [Role.ADMIN, Role.TRADER, Role.VIEWER];

/** Comma-joined labels for a user's roles; '—' when none map. */
export function rolesLabel(roles: Role[]): string {
  const labels = roles.map((r) => ROLE_LABELS[r]).filter((s) => s !== '—');
  return labels.length > 0 ? labels.join(', ') : '—';
}
