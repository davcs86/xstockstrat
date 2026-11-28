import { getLogger } from './services/logger';

const log = getLogger('identity:auth-mode');

export const AUTH_MODES = ['local', 'both', 'oidc'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

interface StringConfig {
  getString(key: string, def?: string): string;
}

const loggedInvalid = new Set<string>();

export function parseAuthMode(raw: string | undefined): { mode: AuthMode; invalid: boolean } {
  if (raw === undefined) return { mode: 'local', invalid: false };
  const mode = AUTH_MODES.find((m) => m === raw);
  return mode ? { mode, invalid: false } : { mode: 'local', invalid: true };
}

// The only auth.mode read in identity; the parameter name `config` is the config-wiring receiver.
export function readAuthMode(config: StringConfig): AuthMode {
  const value = config.getString('auth.mode', 'local');
  const { mode, invalid } = parseAuthMode(value);
  if (invalid && !loggedInvalid.has(value)) {
    loggedInvalid.add(value);
    log.warn('auth_mode_invalid', { value });
  }
  return mode;
}

export function watchAuthMode(
  watcher: StringConfig & { on(event: 'update', fn: () => void): unknown },
): void {
  readAuthMode(watcher);
  watcher.on('update', () => readAuthMode(watcher));
}

export function __resetAuthModeLogOnce(): void {
  loggedInvalid.clear();
}
