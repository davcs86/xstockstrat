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
  return { subject: `[${payload.severity}] ${payload.title}`, text: lines.join('\n') };
}
