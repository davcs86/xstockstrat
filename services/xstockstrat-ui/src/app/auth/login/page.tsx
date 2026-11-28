import { Suspense } from 'react';
import { AuthCardShell } from '@/components/auth/AuthForm';
import { SsoSignInForm } from '@/components/auth/SsoSignInForm';
import { CardNotice } from '@/components/shared/CardNotice';
import { Separator } from '@/components/ui/separator';
import { loadAuthMode, type AuthMode } from '@/lib/oidcConfig';
import { SSO_ERROR_CODES, SSO_ERROR_MESSAGES, type SsoErrorCode } from '@/lib/ssoErrors';
import { LoginForm, LoginSkeleton } from './LoginForm';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function errorMessage(code: string | undefined, mode: AuthMode | 'error'): string | null {
  if (!code || !(SSO_ERROR_CODES as readonly string[]).includes(code)) return null;
  const message = SSO_ERROR_MESSAGES[code as SsoErrorCode];
  return typeof message === 'string' ? message : message[mode === 'oidc' ? 'oidc' : 'both'];
}

// Server component: reads only auth.mode, never the signed-in user (ledger fails.md).
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const [mode, params] = await Promise.all([loadAuthMode(), searchParams]);
  const error = typeof params.error === 'string' ? params.error : undefined;
  const redirect = typeof params.redirect === 'string' ? params.redirect : '';
  const message = errorMessage(error, mode);
  const sso = mode === 'both' || mode === 'oidc';
  const notice = message && <CardNotice variant="error">{message}</CardNotice>;

  if (mode === 'oidc') {
    return (
      <AuthCardShell title="xstockstrat Platform">
        <div className="space-y-4">
          {notice}
          <SsoSignInForm redirect={redirect} />
        </div>
      </AuthCardShell>
    );
  }
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm>
        {(notice || sso) && (
          <div className="mb-4 space-y-4">
            {notice}
            {sso && (
              <>
                <SsoSignInForm redirect={redirect} />
                <Separator />
              </>
            )}
          </div>
        )}
      </LoginForm>
    </Suspense>
  );
}
