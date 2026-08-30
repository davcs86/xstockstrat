'use client';

import { useCallback, useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { CardNotice } from '@/components/shared/CardNotice';
import { EmptyState } from '@/components/shared/EmptyState';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { notifyClient } from '@/lib/browserClients/notifyClient';
import { useVapidKey } from '../VapidKeyContext';

// Decode a base64url VAPID public key into the ArrayBuffer pushManager.subscribe expects as its
// applicationServerKey. Returns the backing ArrayBuffer (a BufferSource) to satisfy lib.dom typing.
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

type Support = 'unknown' | 'unsupported' | 'blocked' | 'ready';

export function PushToggle() {
  const vapidPublicKey = useVapidKey();
  const [support, setSupport] = useState<Support>('unknown');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive current permission/subscription state on mount. Support is resolved SYNCHRONOUSLY from
  // feature detection + Notification.permission — we must NOT block the 'unknown' loading state on
  // `navigator.serviceWorker.ready`, which can hang indefinitely in some headless environments
  // (CI), leaving the control stuck on the spinner. Reading the existing subscription is a
  // best-effort enhancement that runs in the background and only flips `enabled`.
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.serviceWorker ||
      typeof window === 'undefined' ||
      !window.PushManager ||
      typeof Notification === 'undefined'
    ) {
      setSupport('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setSupport('blocked');
      return;
    }
    setSupport('ready');

    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setEnabled(!!sub);
      })
      .catch(() => {
        /* best-effort — the control stays usable even if this never resolves */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!vapidPublicKey) throw new Error('Push is not configured on the server yet.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setSupport(permission === 'denied' ? 'blocked' : 'ready');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
      });
      const json = sub.toJSON();
      await notifyClient.registerPushSubscription({
        // user_id is intentionally omitted — the BFF injects it from the verified session.
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
        userAgent: navigator.userAgent,
      });
      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enable notifications.');
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await notifyClient.unregisterPushSubscription({ endpoint });
      }
      setEnabled(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disable notifications.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (support === 'unknown') {
    return (
      <QueryStateMessages isLoading loadingText="Checking notification support…" errorText="" />
    );
  }
  if (support === 'unsupported') {
    return (
      <EmptyState
        title="Notifications aren't supported here"
        description="This browser doesn't support push notifications. On iOS, add xstockstrat to your Home Screen first, then open it to enable them."
      />
    );
  }
  if (support === 'blocked') {
    return (
      <CardNotice variant="error">
        Notifications are blocked for this site. Allow them in your browser or OS settings, then
        reload this page.
      </CardNotice>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Push notifications</p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? 'Enabled on this device.'
              : 'Off — turn on to receive alerts when the app is closed.'}
          </p>
        </div>
        <Switch
          aria-label="Enable push notifications"
          checked={enabled}
          disabled={busy}
          onCheckedChange={(next) => (next ? enable() : disable())}
        />
      </div>
      {enabled && (
        <CardNotice variant="muted">You&apos;ll receive alerts on this device.</CardNotice>
      )}
      {error && <QueryStateMessages error={error} errorText={error} />}
    </div>
  );
}
