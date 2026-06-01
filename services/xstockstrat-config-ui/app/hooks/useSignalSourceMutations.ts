import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ingestClient } from '@/app/lib/browserClients';
import type { ManageSignalSourceResponse } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { ConnectError } from '@connectrpc/connect';

type ManageSignalSourceInput = Parameters<typeof ingestClient.manageSignalSource>[0];

export function useManageSignalSource() {
  const queryClient = useQueryClient();
  return useMutation<ManageSignalSourceResponse, Error, ManageSignalSourceInput>({
    mutationFn: (req) => ingestClient.manageSignalSource(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-sources'] });
    },
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
