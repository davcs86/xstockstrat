import { getLogger } from '../services/logger';
import { recordDelivery } from '../telemetry';
import type { RenderedEmail } from './emailRender';

const log = getLogger('notify:fanout');

// Fixed code constant, deliberately inside AC-1's 5 s and NOT a 6th config key (F-07).
export const FANOUT_HTTP_TIMEOUT_MS = 3000;

interface SenderConfig {
  getString(key: string, def?: string): string;
}

export class SendgridSender {
  private readonly apiKey: string;

  constructor(private readonly config: SenderConfig) {
    this.apiKey = process.env.SENDGRID_API_KEY?.trim() || '';
  }

  /** Credential presence only; email can still be off when the from/to config keys are empty. */
  hasCredential(): boolean {
    return !!this.apiKey;
  }

  enabled(): boolean {
    return !!this.target();
  }

  /** One mail-send POST. Never throws; true only on a 2xx. */
  async send(email: RenderedEmail, alertId: string): Promise<boolean> {
    const target = this.target();
    if (!target) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FANOUT_HTTP_TIMEOUT_MS);
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: target.to }] }],
          from: { email: target.from },
          subject: email.subject,
          content: [{ type: 'text/plain', value: email.text }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        recordDelivery('sendgrid', 'http_error');
        log.warn('fanout channel error', { alertId, channel: 'sendgrid', error: `HTTP ${res.status}` });
        return false;
      }
      recordDelivery('sendgrid', 'sent');
      return true;
    } catch (error: any) {
      recordDelivery('sendgrid', error?.name === 'AbortError' ? 'timeout' : 'error');
      log.warn('fanout channel error', { alertId, channel: 'sendgrid', error: error?.message ?? String(error) });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // Read live so an address change needs no restart.
  private target(): { from: string; to: string } | null {
    if (!this.apiKey) return null;
    const from = this.config.getString('fanout.sendgrid_from_email');
    const to = this.config.getString('fanout.sendgrid_to_email');
    return from && to ? { from, to } : null;
  }
}
