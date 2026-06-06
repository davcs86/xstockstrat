'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function OAuthLoginForm() {
  const searchParams = useSearchParams();
  // The OAuth flow now carries the agent callback URL + a signed transaction blob (FR-B5).
  // The agent derives user_id from the same-origin session cookie via ValidateToken — the UI
  // never puts a user id, token, or login flag in the URL.
  const agentCb = searchParams.get('agent_cb');
  const txn = searchParams.get('txn');
  const state = searchParams.get('state');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!agentCb || !txn || !state) {
    return (
      <div className="min-h-screen bg-background font-sans flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Authorize Agent Access</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">Invalid OAuth authorization request.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Redirect to the agent callback carrying ONLY the signed txn + state — no user id, no
        // token, no login flag. The httpOnly access_token cookie set by /api/auth/login rides
        // along same-origin (the page never reads it); the agent callback validates it via
        // identity ValidateToken to derive user_id (FR-B5, non-forgeable).
        window.location.href =
          `${agentCb}?txn=${encodeURIComponent(txn!)}&state=${encodeURIComponent(state!)}`;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Login failed. Please check your credentials.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background font-sans flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">xstockstrat Platform — Authorize Agent Access</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Authorizing…' : 'Authorize'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OAuthLoginPage() {
  return (
    <Suspense fallback={null}>
      <OAuthLoginForm />
    </Suspense>
  );
}
