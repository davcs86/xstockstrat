import { useQuery } from '@tanstack/react-query';
import { configClient } from '@/lib/browserClients/configClient';
import type { ListKeysResponse } from '@xstockstrat/proto/config/v1/config_pb';
import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common_pb';

export function useConfigKeys(
  namespace: string,
  env: string,
  mode: string,
): { data: ListKeysResponse | undefined; isLoading: boolean; error: Error | null } {
  function envToProto(e: string): Environment {
    return e === 'production' ? Environment.PRODUCTION : Environment.DEV;
  }
  function modeToProto(m: string): TradingMode {
    return m === 'live' ? TradingMode.LIVE
      : m === 'paper' ? TradingMode.PAPER
      : TradingMode.UNSPECIFIED;
  }
  return useQuery({
    queryKey: ['config-keys', namespace, env, mode],
    queryFn: () =>
      configClient.listKeys({
        namespace,
        environment: envToProto(env),
        tradingMode: modeToProto(mode),
      }),
  });
}
