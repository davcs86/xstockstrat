import { useQuery } from '@tanstack/react-query';
import { configClient } from '@/lib/browserClients/configClient';
import type { ListKeysResponse } from '@xstockstrat/proto/config/v1/config_pb';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';

// Config is scoped by environment (production/staging) x optional per-user (user_id).
export function envToProto(e: string): Environment {
  return e === 'production' ? Environment.PRODUCTION : Environment.STAGING;
}

export function useConfigKeys(
  namespace: string,
  env: string,
  user: string,
): { data: ListKeysResponse | undefined; isLoading: boolean; error: Error | null } {
  return useQuery({
    queryKey: ['config-keys', namespace, env, user],
    queryFn: () =>
      configClient.listKeys({
        namespace,
        environment: envToProto(env),
        userId: user,
      }),
  });
}
