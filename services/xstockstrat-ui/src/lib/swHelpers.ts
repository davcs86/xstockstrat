/**
 * swHelpers.ts — pure, unit-testable logic mirrored inside `public/sw.js` (feature 163).
 *
 * The service worker itself is a standalone static script served from `public/` (it cannot import
 * from the Next bundle), so it inlines a copy of this logic. These pure functions are the tested
 * source of truth for the two decisions that are easy to get wrong: parsing the push payload with a
 * safe fallback, and choosing focus-existing-window vs open-new-window on notification click.
 */

export interface PushNotificationData {
  title: string;
  body: string;
  icon: string;
  tag: string;
  url: string;
}

const FALLBACK: PushNotificationData = {
  title: 'xstockstrat',
  body: 'You have a new alert',
  icon: '/icon-192.png',
  tag: 'xstockstrat',
  url: '/trader',
};

/**
 * Parse a push event's data text into a renderable notification, never throwing. A push subscribed
 * with `userVisibleOnly: true` MUST show a notification for every push or the browser may show a
 * generic message and revoke the subscription — so a malformed/empty payload falls back to a generic
 * but valid notification.
 */
export function parsePushPayload(raw: string | null | undefined): PushNotificationData {
  if (!raw) return { ...FALLBACK };
  try {
    const p = JSON.parse(raw) as Partial<PushNotificationData>;
    return {
      title: typeof p.title === 'string' && p.title ? p.title : FALLBACK.title,
      body: typeof p.body === 'string' && p.body ? p.body : FALLBACK.body,
      icon: typeof p.icon === 'string' && p.icon ? p.icon : FALLBACK.icon,
      tag: typeof p.tag === 'string' && p.tag ? p.tag : FALLBACK.tag,
      url: typeof p.url === 'string' && p.url ? p.url : FALLBACK.url,
    };
  } catch {
    return { ...FALLBACK };
  }
}

/**
 * Given the URLs of the currently open app windows and the notification's target URL, return the URL
 * of an existing window to focus, or `null` to open a new window. An existing window "matches" when
 * its URL contains the target path (same app, possibly deeper route).
 */
export function pickClientUrl(windowUrls: string[], targetUrl: string): string | null {
  for (const u of windowUrls) {
    if (u.includes(targetUrl)) return u;
  }
  return null;
}
