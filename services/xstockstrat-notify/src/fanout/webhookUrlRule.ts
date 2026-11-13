/**
 * Callback URL rule for outbound webhooks: https only, exact allowlisted host:port, no userinfo.
 */
import { getLogger } from '../services/logger';

const log = getLogger('notify:webhook');

const MAX_URL_LENGTH = 2048;
const DEFAULT_PORT = '443';
const HTTPS_PREFIX = 'https://';
const MALFORMED_WARN_INTERVAL_MS = 60_000;

// Reasons are fixed class strings: a callback URL is a capability and must never appear in one.
export type CallbackUrlRejection =
  | 'too_long'
  | 'bad_characters'
  | 'unparseable'
  | 'scheme'
  | 'userinfo'
  | 'trailing_dot'
  | 'origin_not_allowed';

export type CallbackUrlVerdict =
  | { ok: true; href: string; origin: string }
  | { ok: false; reason: CallbackUrlRejection };

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function canonicalOrigin(url: URL): string {
  return `${url.hostname}:${url.port || DEFAULT_PORT}`;
}

function hasWhitespaceOrControl(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function parseAllowedOrigins(raw: string): { origins: Set<string>; malformed: number } {
  const origins = new Set<string>();
  let malformed = 0;
  if (raw.trim() === '') return { origins, malformed };
  for (const part of raw.split(',')) {
    const entry = part.trim();
    const host = entry.startsWith(HTTPS_PREFIX) ? entry.slice(HTTPS_PREFIX.length) : entry;
    const url = host === '' || hasWhitespaceOrControl(host) ? null : parse(HTTPS_PREFIX + host);
    if (
      url === null ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      /[?#\\]/.test(host)
    ) {
      malformed++;
      continue;
    }
    origins.add(canonicalOrigin(url));
  }
  return { origins, malformed };
}

export function checkCallbackUrl(raw: string, allowedOriginsRaw: string): CallbackUrlVerdict {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: 'too_long' };
  // Before parsing: the WHATWG parser silently strips tab/newline and trims C0 controls and spaces.
  if (hasWhitespaceOrControl(raw)) return { ok: false, reason: 'bad_characters' };
  const url = parse(raw);
  if (url === null) return { ok: false, reason: 'unparseable' };
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'userinfo' };
  if (url.hostname.endsWith('.')) return { ok: false, reason: 'trailing_dot' };
  const origin = canonicalOrigin(url);
  // Exact equality only: any prefix, suffix or substring comparison here reopens SSRF.
  if (!parseAllowedOrigins(allowedOriginsRaw).origins.has(origin))
    return { ok: false, reason: 'origin_not_allowed' };
  return { ok: true, href: url.href, origin };
}

let lastMalformedWarnAt = 0;

export function checkCallbackUrlAgainstConfig(
  config: { getString(key: string, def?: string): string },
  raw: string,
): CallbackUrlVerdict {
  const allowed = config.getString('webhook.allowed_origins', '');
  const { malformed } = parseAllowedOrigins(allowed);
  if (malformed > 0 && Date.now() - lastMalformedWarnAt >= MALFORMED_WARN_INTERVAL_MS) {
    lastMalformedWarnAt = Date.now();
    log.warn('webhook.allowed_origins has malformed entries — they match nothing', { malformed });
  }
  return checkCallbackUrl(raw, allowed);
}
