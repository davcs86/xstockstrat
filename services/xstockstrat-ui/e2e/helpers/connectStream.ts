import type { Route } from '@playwright/test';

// Connect streaming framing: 1-byte flag (0x00 message, 0x02 end-stream), 4-byte BE length, JSON.
export function connectStreamBody(
  messages: object[],
  error?: { code: string; message: string },
): Buffer {
  const frame = (flag: number, payload: object) => {
    const json = Buffer.from(JSON.stringify(payload));
    const head = Buffer.alloc(5);
    head.writeUInt8(flag, 0);
    head.writeUInt32BE(json.length, 1);
    return Buffer.concat([head, json]);
  };
  return Buffer.concat([
    ...messages.map((m) => frame(0x00, m)),
    frame(0x02, error ? { error } : {}),
  ]);
}

export function fulfillStream(
  route: Route,
  messages: object[],
  error?: { code: string; message: string },
) {
  return route.fulfill({
    status: 200,
    contentType: 'application/connect+json',
    body: connectStreamBody(messages, error),
  });
}

export function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  return { wait, release };
}
