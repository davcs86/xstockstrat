import { loadAuthMode, loadOidcConfig } from '@/lib/oidcConfig';
import { isValidIssuer } from '@/lib/oidcIssuer';
import { AuthorizedAppsList } from './AuthorizedAppsList';
import { SsoAppsCard } from './SsoAppsCard';

const NO_CLIENT_IDS = { claude: '', claudeReadonly: '', claudeCode: '', claudeCodeReadonly: '' };

// In oidc the issuer owns the connected-app grants, so there is no list to show (AC-34, AC-48).
export default async function AuthorizedAppsPage() {
  const mode = await loadAuthMode();
  if (mode !== 'oidc') return <AuthorizedAppsList />;
  const cfg = await loadOidcConfig();
  if (cfg === 'error') return <SsoAppsCard issuerUrl={null} clientIds={NO_CLIENT_IDS} />;
  return (
    <SsoAppsCard
      issuerUrl={isValidIssuer(cfg.issuer) ? cfg.issuer : null}
      clientIds={cfg.mcpClientIds}
    />
  );
}
