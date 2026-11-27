'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardNotice } from '@/components/shared/CardNotice';
import { FormDialog } from '@/components/shared/FormDialog';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { apiFetch } from '@/lib/authRedirect';
import { LINK_ERROR_CODES, LINK_ERROR_MESSAGES, type LinkErrorCode } from '@/lib/ssoErrorCodes';

interface SsoStatus {
  mode: 'local' | 'both' | 'oidc' | 'error';
  linked: boolean;
  canLink: boolean;
  pending: { linkId: string; label: string; accountEmail: string } | null;
}

function linkErrorMessage(code: unknown): string {
  return typeof code === 'string' && (LINK_ERROR_CODES as readonly string[]).includes(code)
    ? LINK_ERROR_MESSAGES[code as LinkErrorCode]
    : LINK_ERROR_MESSAGES.failed;
}

function SsoPanel() {
  const params = useSearchParams();
  const errorParam = params.get('error');
  const [status, setStatus] = useState<SsoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    errorParam && (LINK_ERROR_CODES as readonly string[]).includes(errorParam)
      ? linkErrorMessage(errorParam)
      : null,
  );
  const [starting, setStarting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch('/accounts/api/sso');
      if (!res.ok) throw new Error(String(res.status));
      setStatus(await res.json());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function startLink() {
    setStarting(true);
    setNotice(null);
    try {
      const res = await apiFetch('/accounts/api/sso/link', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.url === 'string') {
        window.location.assign(data.url);
        return;
      }
      setNotice(linkErrorMessage(data.error));
    } catch {
      setNotice(LINK_ERROR_MESSAGES.failed);
    }
    setStarting(false);
  }

  async function confirmLink() {
    if (!status?.pending) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      // manual: an expired session answers a redirect, which means "go to login" (D-124).
      const res = await apiFetch('/accounts/api/sso/confirm', {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ linkId: status.pending.linkId, password }),
      });
      if (res.type === 'opaqueredirect') {
        window.location.assign('/auth/login');
        return;
      }
      if (res.ok) {
        setPassword('');
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'invalid_credentials') {
          setConfirmError(linkErrorMessage(data.error));
        } else {
          setNotice(linkErrorMessage(data.error));
          await load();
        }
      }
    } catch {
      setConfirmError(LINK_ERROR_MESSAGES.failed);
    } finally {
      setConfirming(false);
    }
  }

  const unavailable = loadError || status?.mode === 'error';
  const pending = status?.pending ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Single sign-on</h1>
      </div>

      {notice && <CardNotice variant="error">{notice}</CardNotice>}

      <Card>
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
          <CardDescription>
            Link your xstockstrat account to your single sign-on account to sign in with SSO.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryStateMessages
            isLoading={loading && !status}
            error={unavailable}
            errorText="Single sign-on status is unavailable. Try again later."
          />
          {status && !unavailable && (
            <p className="text-sm" data-testid="sso-link-status">
              {status.linked
                ? 'Your account is linked to a single sign-on account.'
                : 'Your account is not linked to a single sign-on account.'}
            </p>
          )}
          {status?.canLink && (
            <Button onClick={startLink} disabled={starting}>
              {starting ? 'Redirecting…' : 'Link SSO'}
            </Button>
          )}
        </CardContent>
      </Card>

      {pending && (
        <FormDialog
          open={!dismissed}
          onOpenChange={(open) => setDismissed(!open)}
          title="Confirm link"
          description={`You are linking ${pending.label} to ${pending.accountEmail}.`}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              confirmLink();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="ssoLinkPassword">Your xstockstrat password</Label>
              <Input
                id="ssoLinkPassword"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={confirming}
                required
              />
            </div>
            {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDismissed(true)}>
                Cancel
              </Button>
              <Button type="submit" disabled={confirming}>
                {confirming ? 'Linking…' : 'Confirm link'}
              </Button>
            </div>
          </form>
        </FormDialog>
      )}
    </div>
  );
}

export default function SsoPage() {
  return (
    <Suspense fallback={<QueryStateMessages isLoading errorText="" />}>
      <SsoPanel />
    </Suspense>
  );
}
