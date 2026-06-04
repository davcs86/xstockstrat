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

  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();

  if (!claims) {
    if (req.nextUrl.pathname.endsWith('/login')) {
      return NextResponse.next();
    }
    const loginUrl = req.nextUrl.clone();
    // Route to the segment-specific login page based on request path prefix
    const path = req.nextUrl.pathname;
    if (path.startsWith('/insights')) {
      loginUrl.pathname = '/insights/login';
    } else if (path.startsWith('/config-ui')) {
      loginUrl.pathname = '/config-ui/login';
    } else {
      loginUrl.pathname = '/trader/login';
    }
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (claims.expires_at - Math.floor(Date.now() / 1000) < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS) {
    const path = req.nextUrl.pathname;
    let refreshPath = '/trader/api/auth/refresh';
    if (path.startsWith('/insights')) refreshPath = '/insights/api/auth/refresh';
    else if (path.startsWith('/config-ui')) refreshPath = '/config-ui/api/auth/refresh';
    const refreshUrl = new URL(refreshPath, req.url);
    const refreshRes = await fetch(refreshUrl, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    });
    if (!refreshRes.ok) {
      const loginUrl = req.nextUrl.clone();
      const p = req.nextUrl.pathname;
      if (p.startsWith('/insights')) {
        loginUrl.pathname = '/insights/login';
      } else if (p.startsWith('/config-ui')) {
        loginUrl.pathname = '/config-ui/login';
      } else {
        loginUrl.pathname = '/trader/login';
      }
      loginUrl.searchParams.set('redirect', req.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next({
    request: {
      headers: new Headers({ ...Object.fromEntries(req.headers), 'x-trace-id': traceId }),
    },
  });
}
