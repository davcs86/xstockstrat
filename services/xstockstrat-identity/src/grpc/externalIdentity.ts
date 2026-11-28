// Header-blind by design: these RPCs authorize by the mTLS peer SAN only (FR-4, D-103).
import * as grpc from '@grpc/grpc-js';

export const EXTERNAL_IDENTITY_REFUSALS = {
  resolve: ['not linked', 'account inactive', 'sso disabled'],
  link: [
    'invalid credentials',
    'account inactive',
    'account already linked',
    'already linked to this issuer',
    'link disabled',
  ],
  session: ['account inactive', 'sso disabled'],
} as const;

// Must equal the CONSTRAINT names in migrations/007_external_identities.up.sql (D-118).
export const EXTERNAL_IDENTITIES_PKEY = 'external_identities_pkey';
export const EXTERNAL_IDENTITIES_ISSUER_USER_KEY = 'external_identities_issuer_user_key';

export const EXTERNAL_IDENTITY_PEER_SANS = {
  ResolveExternalIdentity: ['xstockstrat-ui', 'xstockstrat-agent'],
  IssueSessionForUser: ['xstockstrat-ui'],
  LinkExternalIdentity: ['xstockstrat-ui'],
  GetExternalIdentityLinks: ['xstockstrat-ui'],
} as const satisfies Record<string, readonly string[]>;

export type ExternalIdentityRpc = keyof typeof EXTERNAL_IDENTITY_PEER_SANS;

export function peerDenied(rpc: ExternalIdentityRpc): { code: number; message: string } {
  return { code: grpc.status.PERMISSION_DENIED, message: `peer not authorized for ${rpc}` };
}
