// Force the auth pages (`/auth/login`, `/auth/oauth-login`) to render dynamically.
//
// Without this they are statically prerendered, so Next.js serves them with
// `Cache-Control: s-maxage=31536000` and relies on `Vary: RSC, …` to keep the HTML
// document and the router's RSC/Flight prefetch payload as separate cache entries.
// The production edge (Cloudflare, in front of DigitalOcean App Platform) only honors
// `Vary: Accept-Encoding` and ignores `Vary: RSC`, so it caches the `text/x-component`
// Flight payload under the plain URL key and then serves it to a real document
// navigation. The browser cannot render `text/x-component` as a page and dumps the raw
// Flight text — including Next's built-in "404: This page could not be found." string —
// which surfaces to the user as the login route "failing with a not found error".
//
// Forcing dynamic rendering makes Next emit `Cache-Control: private, no-cache, no-store`
// for these routes, so the edge never caches either variant and the cross-contamination
// cannot occur. Auth entry points must not be edge-cached anyway. A segment `layout.tsx`
// applies the config to every page under `/auth/*` without touching the client pages.
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
