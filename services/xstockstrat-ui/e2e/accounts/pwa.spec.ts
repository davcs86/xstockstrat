import { test, expect } from '@playwright/test';

/**
 * PWA installability (feature 162, @AC-1). The web app manifest and the service worker must be
 * served publicly from the domain root — NOT behind the auth gate — or a supporting browser can
 * never register the SW or offer "Install app". These assert the manifest shape and that the
 * middleware matcher exclusion is in place (an unauthenticated request is served, not 307'd to login).
 */

test.describe('PWA manifest + service worker', () => {
  test('@AC-1 serves a standalone manifest with 192/512/maskable icons, unauthenticated', async ({
    request,
  }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/trader');

    const sizes = (manifest.icons ?? []).map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    const purposes = (manifest.icons ?? []).map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain('maskable');
  });

  test('@AC-1 serves sw.js publicly with no-cache (not redirected to login)', async ({
    request,
  }) => {
    const res = await request.get('/sw.js', { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    // The middleware would 307-redirect an auth-gated path to /auth/login; a 200 proves the
    // matcher exclusion is in effect.
    expect(res.headers()['cache-control']).toContain('no-cache');
    const body = await res.text();
    expect(body).toContain('addEventListener');
    expect(body).toContain('notificationclick');
  });
});
