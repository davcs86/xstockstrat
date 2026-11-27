/**
 * SSO (feature 345) fixtures: the stub issuer, the staging web + MCP client ids, the SSO subject,
 * link labels and the discovery document. Registered in e2e/fixtures/INVENTORY.md.
 */
import { TEST_USER_EMAIL, TEST_USER_ID } from './users';

/** Fixed port beside the 9091–9093 mocks (9094 and 9099 are deliberately dead endpoints). */
export const STUB_IDP_PORT = 9096;

/** D-91: a loopback http issuer, which the issuer grammar accepts. Never a trailing slash. */
export function stubIssuer(port: number = STUB_IDP_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export const SSO_WEB_CLIENT_ID = 'xstockstrat-staging-web';
export const SSO_WEB_CLIENT_SECRET = 'e2e-sso-web-client-secret';

/** The four staging MCP connector client ids (ui/oidc.mcp_client_id*). */
export const SSO_STAGING_CLIENT_IDS = {
  claude: 'xstockstrat-staging-claude',
  claudeReadonly: 'xstockstrat-staging-claude-readonly',
  claudeCode: 'xstockstrat-staging-claude-code',
  claudeCodeReadonly: 'xstockstrat-staging-claude-code-readonly',
};

/** The SSO identity the stub signs in, linked to the canonical test user. */
export const SSO_IDENTITY = {
  userId: TEST_USER_ID,
  accountEmail: TEST_USER_EMAIL,
  subject: 'sso-subject-e2e',
  email: 'sso-user@example.test',
  preferredUsername: 'sso-user',
};

/** The xstockstrat password the mock's LinkExternalIdentity accepts; any other → invalid credentials. */
export const SSO_LINK_PASSWORD = 'e2e-link-password';

/** The confirmation-dialog copy for a link with the SSO email label. */
export const SSO_LINK_CONFIRMATION = `You are linking ${SSO_IDENTITY.email} to ${TEST_USER_EMAIL}.`;

export function ssoDiscoveryDocument(issuer: string, opts: { endSession?: boolean } = {}) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    ...(opts.endSession ? { end_session_endpoint: `${issuer}/logout` } : {}),
  };
}
