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

// commsgun rejects a subject over 998 (validate.go SubjectMaxLen) or holding CR/LF with a permanent 422.
const SUBJECT_MAX_BYTES = 998;

// Bytes, not UTF-16 units: the cap holds whether the producer counts bytes or runes. Never splits a code point.
function emailSubject(raw: string): string {
  const flat = raw.replace(/[\r\n]+/g, ' ');
  if (Buffer.byteLength(flat, 'utf8') <= SUBJECT_MAX_BYTES) return flat;
  let out = '';
  let bytes = 0;
  for (const ch of flat) {
    bytes += Buffer.byteLength(ch, 'utf8');
    if (bytes > SUBJECT_MAX_BYTES) break;
    out += ch;
  }
  return out;
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
  return { subject: emailSubject(`[${payload.severity}] ${payload.title}`), text: lines.join('\n') };
}
