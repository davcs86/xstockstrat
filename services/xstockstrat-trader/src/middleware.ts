import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getSessionFromRequest,
  ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS,
  generateTraceId,
} from '@/lib/auth';

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/auth/login|api/health|health).+)',
  ],
};

export async function middleware(req: NextRequest) {
  const claims = await getSessionFromRequest(req);

  // Generate or propagate trace ID (request direction only — never set on responses)
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();

  if (!claims) {
    if (req.nextUrl.pathname === '/login') {
      return NextResponse.next();
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Refresh near-expiry tokens via internal API route
  if (claims.expires_at - Math.floor(Date.now() / 1000) < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS) {
    const refreshUrl = new URL(`${req.nextUrl.basePath}/api/auth/refresh`, req.url);
    const refreshRes = await fetch(refreshUrl, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    });
    if (!refreshRes.ok) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('redirect', req.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Inject trace ID into forwarded request headers (upstream only)
  return NextResponse.next({
    request: {
      headers: new Headers({ ...Object.fromEntries(req.headers), 'x-trace-id': traceId }),
    },
  });
}
