/** What a fanout channel renders; only fields a producer actually set (feature 020 FR-5). */
export interface FanoutPayload {
  symbol?: string;
  source: string;
  severity: string;
  conviction?: number;
  title: string;
  body: string;
  timestamp: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

// commsgun rejects a subject holding CR/LF or over 998 runes (validate.go emailContent) with a permanent 422.
const SUBJECT_MAX_RUNES = 998;

// Code points, as commsgun's utf8.RuneCountInString counts them: a cut never splits one.
function emailSubject(raw: string): string {
  return [...raw.replace(/[\r\n]+/g, ' ')].slice(0, SUBJECT_MAX_RUNES).join('');
}

// commsgun refuses a request over 256 KiB (MaxBodyBytes) with a permanent 413. The reserve holds the rest of the
// request: a 998-code-point subject at ≤ 6 escaped bytes each, a ≤ 254-character recipient, and the JSON keys.
const TEXT_MAX_JSON_BYTES = 256 * 1024 - 8 * 1024;
const TRUNCATED_MARKER = '\n[truncated]';

function jsonBytes(s: string): number {
  return Buffer.byteLength(JSON.stringify(s), 'utf8') - 2;
}

// Counted as JSON-escaped bytes, the form commsgun receives; a cut never splits a code point.
function emailText(raw: string): string {
  if (jsonBytes(raw) <= TEXT_MAX_JSON_BYTES) return raw;
  const budget = TEXT_MAX_JSON_BYTES - jsonBytes(TRUNCATED_MARKER);
  let out = '';
  let used = 0;
  for (const ch of raw) {
    used += jsonBytes(ch);
    if (used > budget) break;
    out += ch;
  }
  return out + TRUNCATED_MARKER;
}

// The one email renderer: SendGrid and commsgun must send the same subject and text.
export function renderEmail(payload: FanoutPayload): RenderedEmail {
  const lines = [
    `Symbol: ${payload.symbol ?? '(n/a)'}`,
    `Source: ${payload.source}`,
    `Severity: ${payload.severity}`,
    payload.conviction !== undefined ? `Conviction: ${payload.conviction}` : 'Conviction: (n/a)',
    `Timestamp: ${payload.timestamp}`,
    '',
    payload.title,
    payload.body,
  ];
  return { subject: emailSubject(`[${payload.severity}] ${payload.title}`), text: emailText(lines.join('\n')) };
}
