import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ingestClient } from '@/lib/browserClients/ingestClient';
import { configClient } from '@/lib/browserClients/configClient';
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

/**
 * Register a `mcp_client` source with a bearer token, SECRET-FIRST: write the token to the encrypted
 * config key `ingest.mcp_credential.<slug>` (`is_secret`, `create_key`), then register the source via
 * `credentials_ref`. The token is never placed in `config_json`; environment is left UNSPECIFIED (the
 * BFF fills the native scope). A failed register after the secret write leaves a harmless redacted orphan.
 */
export function useRegisterMcpClientSource() {
  const queryClient = useQueryClient();
  return useMutation<
    ManageSignalSourceResponse,
    Error,
    { source: ManageSignalSourceInput['source']; slug: string; bearerToken: string }
  >({
    mutationFn: async ({ source, slug, bearerToken }) => {
      await configClient.setConfig({
        namespace: 'ingest',
        key: `mcp_credential.${slug}`,
        value: { value: { case: 'stringVal', value: bearerToken }, isSecret: true },
        reason: `bearer for mcp_client source ${slug}`,
        createKey: true,
      });
      return ingestClient.manageSignalSource({
        operation: 'register',
        source,
        credentialsRef: `ingest.mcp_credential.${slug}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-sources'] });
    },
  });
}
