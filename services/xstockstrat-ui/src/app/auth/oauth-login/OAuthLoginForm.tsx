'use client';
import { useSearchParams } from 'next/navigation';
import { AuthCardShell, CredentialsForm } from '@/components/auth/AuthForm';

export function OAuthLoginForm({ agentCallback }: { agentCallback: string | null }) {
  const searchParams = useSearchParams();
  // The agent derives user_id from the same-origin session cookie via ValidateToken — the UI never
  // puts a user id, token, or login flag in the URL.
  const txn = searchParams.get('txn');
  const state = searchParams.get('state');

  if (!agentCallback || !txn || !state) {
    return (
      <AuthCardShell title="Authorize Agent Access">
        <p className="text-sm text-destructive">Invalid OAuth authorization request.</p>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell title="xstockstrat Platform — Authorize Agent Access">
      <CredentialsForm
        submitLabel="Authorize"
        loadingLabel="Authorizing…"
        onSuccess={() => {
          // Redirect carries ONLY the signed txn + state — no user id, token, or login flag. The
          // httpOnly cookie rides same-origin; the agent validates it via ValidateToken (non-forgeable).
          window.location.href = `${agentCallback}?txn=${encodeURIComponent(txn)}&state=${encodeURIComponent(state)}`;
        }}
      />
    </AuthCardShell>
  );
}
