import type { CommsgunKeyState } from '../services/commsgunSecret';

export type EmailMode = 'auto' | 'commsgun' | 'sendgrid';
export type KeyKind = CommsgunKeyState['kind'];
export type DispatchAction = 'sendgrid' | 'queue' | 'unconfigured';
export type WorkerRoute = 'attempt' | 'hold' | 'reroute_lost' | 'reroute_deliberate';

export interface CommsgunSettings {
  url: string;
  appId: string;
  to: string;
  baseSet: boolean;
}

interface ProviderConfig {
  getString(key: string, def?: string): string;
}

// Anything other than the two pinned values reads as auto, at dispatch and in the worker alike.
export function emailMode(config: ProviderConfig): EmailMode {
  const stored = config.getString('fanout.email_provider', 'auto');
  return stored === 'commsgun' || stored === 'sendgrid' ? stored : 'auto';
}

/** The base configuration: commsgun can be addressed only when all three are non-empty. */
export function commsgunSettings(config: ProviderConfig): CommsgunSettings {
  const url = config.getString('commsgun.enqueue_url', '').trim();
  const appId = config.getString('commsgun.app_id', '').trim();
  const to = config.getString('commsgun.to_email', '').trim();
  return { url, appId, to, baseSet: !!url && !!appId && !!to };
}

/** What dispatch does with a qualifying alert's email. */
export function dispatchAction(mode: EmailMode, baseSet: boolean, keyKind: KeyKind): DispatchAction {
  if (mode === 'sendgrid') return 'sendgrid';
  if (mode === 'commsgun') return baseSet ? 'queue' : 'unconfigured';
  // auto is ready only with the base and a resolved key; otherwise it is today's SendGrid path.
  return baseSet && keyKind === 'key' ? 'queue' : 'sendgrid';
}

/** What a worker tick does with pending rows. */
export function workerRoute(mode: EmailMode, baseSet: boolean, keyKind: KeyKind): WorkerRoute {
  if (mode === 'commsgun') return 'attempt';
  if (mode === 'sendgrid') return 'reroute_deliberate';
  // Without the base the key state is irrelevant: hold applies only once commsgun is set up.
  if (!baseSet || keyKind === 'absent') return 'reroute_lost';
  return keyKind === 'key' ? 'attempt' : 'hold';
}
