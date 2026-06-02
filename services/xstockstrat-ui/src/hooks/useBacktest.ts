import { useMutation } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { ConnectError } from '@connectrpc/connect';

type RunBacktestInput = Parameters<typeof analysisClient.runBacktest>[0];
type BacktestResult = Awaited<ReturnType<typeof analysisClient.runBacktest>>;

export function useRunBacktest() {
  return useMutation<BacktestResult, Error, RunBacktestInput>({
    mutationFn: (req) => analysisClient.runBacktest(req),
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
