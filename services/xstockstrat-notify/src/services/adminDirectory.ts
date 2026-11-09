import * as grpc from '@grpc/grpc-js';
import { IdentityServiceClient } from '@xstockstrat/proto/identity/v1/identity';
import * as mtls from '../mtls';
import { getLogger } from './logger';

const log = getLogger('notify:admin-directory');

// Outbound gRPC deadline for the admin lookup — a fixed mechanism constant, not a config key (F-07).
export const ADMIN_LOOKUP_DEADLINE_MS = 2000;

const PROPAGATED_HEADERS = ['x-user-id', 'x-access-scope', 'x-trace-id'] as const;

export interface AdminDirectory {
  listAdminUserIds(md: grpc.Metadata | undefined): Promise<string[]>;
}

export type AdminLookupClient = Pick<IdentityServiceClient, 'listAdminUserIds'>;

/** Single-flight joiners reuse the first caller's header trio, so their trace correlation is lost. */
export function createAdminDirectory(
  endpoint: string | undefined = process.env.IDENTITY_ENDPOINT,
  client?: AdminLookupClient,
): AdminDirectory {
  if (!endpoint && !client) {
    log.error('IDENTITY_ENDPOINT unset — untargeted Web Push disabled');
    return {
      listAdminUserIds: () => Promise.reject(new Error('IDENTITY_ENDPOINT unset')),
    };
  }
  const identity: AdminLookupClient =
    client ??
    new IdentityServiceClient(
      endpoint,
      mtls.clientCredentials(),
      mtls.targetOverride('xstockstrat-identity'),
    );
  let inFlight: Promise<string[]> | undefined;

  return {
    listAdminUserIds(md) {
      if (inFlight) return inFlight;
      const out = new grpc.Metadata();
      for (const h of PROPAGATED_HEADERS) {
        const v = md?.get?.(h)?.[0];
        if (v) out.set(h, String(v));
      }
      inFlight = new Promise<string[]>((resolve, reject) => {
        identity.listAdminUserIds(
          {},
          out,
          { deadline: Date.now() + ADMIN_LOOKUP_DEADLINE_MS },
          (err, resp) => (err ? reject(err) : resolve(resp.userIds)),
        );
      }).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
