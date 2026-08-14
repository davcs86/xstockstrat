/**
 * Platform-internal propagation headers for plain Next.js routes (NextRequest,
 * not a Connect HandlerContext). Extracted from the local backendHeaders in
 * authorized-apps/route.ts to avoid a third copy when the profile route was added
 * (design.md DRY fix, context-constitution-findings.md:19).
 */
import { NextRequest } from 'next/server';
import { rolesToAccessScope, generateTraceId } from '@/lib/auth';
import { HEADER_USER_ID, HEADER_ACCESS_SCOPE, HEADER_TRACE_ID } from '@/lib/headers';

export function restBackendHeaders(req: NextRequest, userId: string, roles: string[]): Headers {
  return new Headers({
    [HEADER_USER_ID]: userId,
    [HEADER_ACCESS_SCOPE]: String(rolesToAccessScope(roles)),
    [HEADER_TRACE_ID]: req.headers.get(HEADER_TRACE_ID) ?? generateTraceId(),
  });
}
