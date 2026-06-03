import { useMutation, useQueryClient } from '@tanstack/react-query';
import { configClient } from '@/lib/browserClients/configClient';
import type { SetConfigResponse } from '@xstockstrat/proto/config/v1/config_pb';
import { ConnectError } from '@connectrpc/connect';

type SetConfigInput = Parameters<typeof configClient.setConfig>[0];

export function useSetConfig(namespace: string, env: string, mode: string) {
  const queryClient = useQueryClient();
  return useMutation<SetConfigResponse, Error, SetConfigInput>({
    mutationFn: (req) => configClient.setConfig(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-keys', namespace, env, mode] });
    },
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
