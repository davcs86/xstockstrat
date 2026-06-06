import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// Exposes only a non-sensitive admin flag derived from the httpOnly session cookie,
// so client components (e.g. the Live Strategies toggle) can gate admin-only UI.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }
  return NextResponse.json({ isAdmin: claims.roles?.includes('admin') ?? false });
}
