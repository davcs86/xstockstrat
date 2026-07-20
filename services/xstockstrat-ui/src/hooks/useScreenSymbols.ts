import { useMutation } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { ConnectError } from '@connectrpc/connect';

type ScreenSymbolsInput = Parameters<typeof analysisClient.screenSymbols>[0];
type ScreenSymbolsResult = Awaited<ReturnType<typeof analysisClient.screenSymbols>>;

// On-demand screener scan (feature 060, FR-9) — a mutation, not a polling query.
export function useScreenSymbols() {
  return useMutation<ScreenSymbolsResult, Error, ScreenSymbolsInput>({
    mutationFn: (req) => analysisClient.screenSymbols(req),
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
