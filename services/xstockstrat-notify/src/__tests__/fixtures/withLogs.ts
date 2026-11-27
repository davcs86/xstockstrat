import { transports } from 'winston';

/** Captures what the real logger writes while `run` executes. */
export async function withLogs(run: () => Promise<void>): Promise<Array<Record<string | symbol, unknown>>> {
  const captured: Array<Record<string | symbol, unknown>> = [];
  const original = transports.Console.prototype.log;
  transports.Console.prototype.log = function (info: Record<string | symbol, unknown>, next: () => void) {
    captured.push(info);
    next();
  };
  try {
    await run();
  } finally {
    transports.Console.prototype.log = original;
  }
  return captured;
}
