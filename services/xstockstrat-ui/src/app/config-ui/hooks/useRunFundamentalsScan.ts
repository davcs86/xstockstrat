import { useMutation } from '@tanstack/react-query';
import { configUiAnalysisClient } from '@/lib/browserClients/configUiAnalysisClient';
import type { FundamentalsScanSummary } from '@xstockstrat/proto/analysis/v1/analysis_pb';

type RunFundamentalsScanInput = Parameters<typeof configUiAnalysisClient.runFundamentalsScan>[0];

// Admin-scoped manual trigger for the fundamentals signal producer (feature 156). The BFF route is
// gated by forwardAdmin, so a non-admin caller surfaces a ConnectError (PermissionDenied) here.
export function useRunFundamentalsScan() {
  return useMutation<FundamentalsScanSummary, Error, RunFundamentalsScanInput>({
    mutationFn: (req) => configUiAnalysisClient.runFundamentalsScan(req),
  });
}
