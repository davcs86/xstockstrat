// Force /auth/* to render dynamically — a static prerender is edge-cached (Cloudflare ignores
// Vary: RSC) and the Flight payload gets cross-served to document navigations, surfacing as a "404".
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
