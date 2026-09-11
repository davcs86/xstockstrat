'use client';

import { useEffect } from 'react';

/**
 * Registers the push service worker at the domain root. Root scope lets one worker control every
 * segment (/trader, /insights, /config-ui, /accounts). No-op without service-worker support.
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
