import { APP_URL_RE } from './oidcIssuer';
import { logOnce } from './serverLog';

export function parseAppOrigin(raw: string | undefined): string | null {
  return typeof raw === 'string' && APP_URL_RE.test(raw) && new URL(raw).origin === raw
    ? raw
    : null;
}

export function appOrigin(): string | null {
  const origin = parseAppOrigin(process.env.APP_URL);
  if (origin === null)
    logOnce('error', 'app_url_invalid', 'app_url_invalid', { reason: 'app_url' });
  return origin;
}

// Compares against APP_URL, never req.nextUrl.origin (D-68). `if_present` fails open on a null
// appOrigin so an APP_URL mistake cannot block logout (D-78, D-81).
export function isSameOrigin(
  req: Request,
  mode: 'required' | 'if_present',
  origin: string | null = appOrigin(),
): boolean {
  const header = req.headers.get('origin');
  if (mode === 'if_present') {
    if (header === null || origin === null) return true;
    return header === origin;
  }
  return header !== null && origin !== null && header === origin;
}

// Log-safe host of a present Origin header value.
export function originHost(h: string): string {
  if (h === 'null') return 'null';
  try {
    return new URL(h).host;
  } catch {
    return 'invalid';
  }
}
