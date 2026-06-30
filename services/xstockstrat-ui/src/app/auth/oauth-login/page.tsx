'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthCardShell, CredentialsForm } from '@/components/auth/AuthForm';

function OAuthLoginForm() {
  const searchParams = useSearchParams();
  // The OAuth flow now carries the agent callback URL + a signed transaction blob (FR-B5).
  // The agent derives user_id from the same-origin session cookie via ValidateToken — the UI
  // never puts a user id, token, or login flag in the URL.
  const agentCb = searchParams.get('agent_cb');
  const txn = searchParams.get('txn');
  const state = searchParams.get('state');

  if (!agentCb || !txn || !state) {
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
          // Redirect to the agent callback carrying ONLY the signed txn + state — no user id,
          // no token, no login flag. The httpOnly access_token cookie set by /api/auth/login
          // rides along same-origin (the page never reads it); the agent callback validates it
          // via identity ValidateToken to derive user_id (FR-B5, non-forgeable).
          window.location.href = `${agentCb}?txn=${encodeURIComponent(txn)}&state=${encodeURIComponent(state)}`;
        }}
      />
    </AuthCardShell>
  );
}

export default function OAuthLoginPage() {
  return (
    <Suspense fallback={null}>
      <OAuthLoginForm />
    </Suspense>
  );
}
