'use client';

import { useEffect } from 'react';

/**
 * Registers the push service worker at the domain root (feature 162). Root scope lets one worker
 * control every segment (/trader, /insights, /config-ui, /accounts). Renders nothing; a browser
 * without service-worker support is a silent no-op (the PWA/push features simply stay unavailable).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration is best-effort — never block the app if the SW fails to register.
    });
  }, []);
  return null;
}
