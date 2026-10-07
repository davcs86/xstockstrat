import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import { insightsConfigClient } from '@/lib/browserClients/insightsConfigClient';
import { useInvalidatingMutation } from '@/hooks/useInvalidatingMutation';

type ManageSignalSourceInput = Parameters<typeof insightsIngestClient.manageSignalSource>[0];

const SOURCE_KEYS = [['signal-sources'], ['insights-signal-sources']];

/** Owner-scoped source writes through the insights BFF (the backend rejects system/foreign rows). */
export function useManageSignalSource() {
  return useInvalidatingMutation(
    (req: ManageSignalSourceInput) => insightsIngestClient.manageSignalSource(req),
    SOURCE_KEYS,
  );
}

/**
 * Store a bearer as the CALLER's per-user encrypted secret under an opaque key and return the
 * `credentials_ref` pointing at it. The insights BFF forces user scope, `is_secret` and `create_key`.
 */
async function writeOwnBearerSecret(bearerToken: string, reason: string): Promise<string> {
  const key = `mcp_credential.${crypto.randomUUID()}`;
  await insightsConfigClient.setConfig({
    namespace: 'ingest',
    key,
    value: { value: { case: 'stringVal', value: bearerToken }, isSecret: true },
    reason,
    createKey: true,
  });
  return `ingest.${key}`;
}

/**
 * Register a `mcp_client` source SECRET-FIRST: the bearer goes to a per-user secret, then the source
 * registers with `credentials_ref` (never in `config_json`). A failed register leaves a redacted orphan.
 */
export function useRegisterMcpClientSource() {
  return useInvalidatingMutation(
    async ({
      source,
      bearerToken,
    }: {
      source: ManageSignalSourceInput['source'];
      bearerToken: string;
    }) =>
      insightsIngestClient.manageSignalSource({
        operation: 'register',
        source,
        credentialsRef: await writeOwnBearerSecret(
          bearerToken,
          `bearer for mcp_client source ${source?.slug ?? ''}`,
        ),
      }),
    SOURCE_KEYS,
  );
}

/** Instantiate a `mcp_client` source template with the caller's own bearer; resolves to the new slug. */
export function useInstantiateMcpSourceTemplate() {
  return useInvalidatingMutation(
    async ({ templateId, bearerToken }: { templateId: string; bearerToken: string }) => {
      const credentialsRef = await writeOwnBearerSecret(
        bearerToken,
        `bearer for mcp_client template ${templateId}`,
      );
      return (await insightsIngestClient.instantiateTemplate({ templateId, credentialsRef })).slug;
    },
    SOURCE_KEYS,
  );
}
