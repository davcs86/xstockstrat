/*
 * xstockstrat service worker (feature 165 — pwa-notifications).
 *
 * Push-only: no fetch/precache handler (this is not an offline cache). It renders pushed alerts as OS
 * notifications and, on click, focuses an existing app window or opens one. The parse-with-fallback
 * and focus-vs-open logic below mirror the pure, unit-tested helpers in src/lib/swHelpers.ts (a
 * service worker cannot import from the Next bundle, so the logic is inlined here).
 *
 * Served from the domain root with `Cache-Control: no-cache` (next.config.js headers()) so an updated
 * handler always reaches installed clients.
 */

const FALLBACK = {
  title: 'xstockstrat',
  body: 'You have a new alert',
  icon: '/icon-192.png',
  tag: 'xstockstrat',
  url: '/trader',
};

function parsePushPayload(raw) {
  if (!raw) return { ...FALLBACK };
  try {
    const p = JSON.parse(raw);
    return {
      title: typeof p.title === 'string' && p.title ? p.title : FALLBACK.title,
      body: typeof p.body === 'string' && p.body ? p.body : FALLBACK.body,
      icon: typeof p.icon === 'string' && p.icon ? p.icon : FALLBACK.icon,
      tag: typeof p.tag === 'string' && p.tag ? p.tag : FALLBACK.tag,
      url: typeof p.url === 'string' && p.url ? p.url : FALLBACK.url,
    };
  } catch (e) {
    return { ...FALLBACK };
  }
}

function pickClientUrl(windowUrls, targetUrl) {
  for (const u of windowUrls) {
    if (u.includes(targetUrl)) return u;
  }
  return null;
}

// Activate immediately so an updated worker controls open pages without a second reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A userVisibleOnly subscription obligates a visible notification on EVERY push — always show one,
// even when the payload is missing or unparseable.
self.addEventListener('push', (event) => {
  const data = parsePushPayload(event.data ? event.data.text() : null);
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/trader';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const focusUrl = pickClientUrl(wins.map((w) => w.url), targetUrl);
      if (focusUrl !== null) {
        const win = wins.find((w) => w.url === focusUrl);
        if (win && 'focus' in win) return win.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
