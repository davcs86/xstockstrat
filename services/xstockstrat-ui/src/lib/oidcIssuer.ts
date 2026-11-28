// Must equal scripts/testdata/oidc-issuer-vectors.json byte for byte (agent and UI share it; D-79, D-88).
export const ISSUER_PATTERN = String.raw`^(?:https://(?:(?:(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|127\.0\.0\.1|\[::1\])(?::(?!443(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?|http://(?:localhost|127\.0\.0\.1|\[::1\])(?::(?!80(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?)(?:/(?!\.\.?(?:/|$))[A-Za-z0-9._~!$&'()*+,;=:-]+)*$`;
export const APP_URL_PATTERN = String.raw`^(?:https://(?:(?:(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|127\.0\.0\.1|\[::1\])(?::(?!443(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?|http://(?:localhost|127\.0\.0\.1|\[::1\])(?::(?!80(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?)$`;

// No flags: g/y make test() stateful, and i/u/v change what the explicit ASCII classes match.
const ISSUER_RE = new RegExp(ISSUER_PATTERN);
export const APP_URL_RE = new RegExp(APP_URL_PATTERN);

export function isValidIssuer(v: string): boolean {
  if (!ISSUER_RE.test(v)) return false;
  const u = new URL(v);
  return u.origin + (v.length > u.origin.length ? u.pathname : '') === v;
}
