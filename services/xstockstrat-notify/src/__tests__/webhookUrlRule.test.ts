/**
 * Unit tests for the webhook callback URL rule (the SSRF control). Pure functions, no network or DB.
 * Covers AC-4, AC-5, AC-23.
 *
 * Compiled-first harness (tsc && node --test dist/__tests__/*.test.js) with a static import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkCallbackUrl,
  checkCallbackUrlAgainstConfig,
  parseAllowedOrigins,
} from '../fanout/webhookUrlRule.js';

const ALLOWED = 'webhooks.ts.example.net:8443';
const ORIGIN = 'webhooks.ts.example.net:8443';
const GOOD = 'https://webhooks.ts.example.net:8443/hooks';

function accepted(raw: string, allowed: string): { href: string; origin: string } {
  const v = checkCallbackUrl(raw, allowed);
  if (v.ok === true) return { href: v.href, origin: v.origin };
  return assert.fail(`expected acceptance, got reason ${v.reason}`);
}

function rejected(raw: string, allowed: string): string {
  const v = checkCallbackUrl(raw, allowed);
  if (v.ok === false) return v.reason;
  return assert.fail(`expected rejection, accepted for origin ${v.origin}`);
}

describe('webhookUrlRule test harness', () => {
  it('imports the rule', () => {
    assert.equal(typeof checkCallbackUrl, 'function');
    assert.equal(typeof checkCallbackUrlAgainstConfig, 'function');
    assert.equal(typeof parseAllowedOrigins, 'function');
  });
});

describe('checkCallbackUrl — accepts only an exact allowlisted https origin', () => {
  it('accepts the allowlisted origin and returns the re-serialized href and the origin', () => {
    assert.deepEqual(accepted(GOOD, ALLOWED), { href: GOOD, origin: ORIGIN });
    assert.deepEqual(accepted('https://webhooks.ts.example.net:8443', ALLOWED), {
      href: 'https://webhooks.ts.example.net:8443/',
      origin: ORIGIN,
    });
  });

  it('AC-23: upper-case scheme and host are accepted; origin and href are lower-case', () => {
    assert.deepEqual(accepted('HTTPS://WEBHOOKS.TS.EXAMPLE.NET:8443/hooks', ALLOWED), {
      href: GOOD,
      origin: ORIGIN,
    });
  });

  it('accepts when the entry is one of several', () => {
    assert.equal(accepted(GOOD, `a.example.org, ${ALLOWED} ,b.example.org:9000`).origin, ORIGIN);
  });
});

describe('checkCallbackUrl — AC-5 rows are rejected', () => {
  const rows: [string, string][] = [
    ['http://webhooks.ts.example.net:8443/hooks', 'scheme'],
    ['https://webhooks.ts.example.net/hooks', 'origin_not_allowed'],
    ['https://webhooks.ts.example.net:9443/hooks', 'origin_not_allowed'],
    ['https://user@webhooks.ts.example.net:8443/hooks', 'userinfo'],
    ['https://evil.example.org:8443/hooks', 'origin_not_allowed'],
    ['https://webhooks.ts.example.net.evil.org:8443/h', 'origin_not_allowed'],
    ['https://webhooks.ts.example.net:8443@evil.org/h', 'userinfo'],
    ['ftp://webhooks.ts.example.net:8443/hooks', 'scheme'],
    ['not-a-url', 'unparseable'],
  ];
  for (const [url, reason] of rows) {
    it(`rejects ${url}`, () => {
      assert.equal(rejected(url, ALLOWED), reason);
    });
  }
});

describe('checkCallbackUrl — AC-4 empty allowlist', () => {
  it('rejects an otherwise valid URL', () => {
    assert.equal(rejected(GOOD, ''), 'origin_not_allowed');
    assert.equal(rejected(GOOD, '   '), 'origin_not_allowed');
  });
});

describe('checkCallbackUrl — exact origin equality (no prefix / suffix / substring match)', () => {
  it('suffix: the allowlisted host followed by another domain', () => {
    assert.equal(
      rejected('https://webhooks.ts.example.net.evil.org:8443/h', ALLOWED),
      'origin_not_allowed',
    );
    assert.equal(
      rejected('https://webhooks.ts.example.net.evil.org/h', 'webhooks.ts.example.net'),
      'origin_not_allowed',
    );
  });

  it('prefix: another label glued in front of the allowlisted host', () => {
    assert.equal(
      rejected('https://evil-webhooks.ts.example.net:8443/h', ALLOWED),
      'origin_not_allowed',
    );
    assert.equal(
      rejected('https://evil.webhooks.ts.example.net:8443/h', ALLOWED),
      'origin_not_allowed',
    );
  });

  it('substring: a parent domain of the allowlisted host, and a host that contains it', () => {
    assert.equal(rejected('https://ts.example.net:8443/h', ALLOWED), 'origin_not_allowed');
    assert.equal(rejected('https://example.net:8443/h', ALLOWED), 'origin_not_allowed');
    assert.equal(
      rejected('https://a.webhooks.ts.example.net.b.org:8443/h', ALLOWED),
      'origin_not_allowed',
    );
  });

  it('port: a longer or shorter port that shares digits with the allowlisted one', () => {
    assert.equal(
      rejected('https://webhooks.ts.example.net:8443/h', 'webhooks.ts.example.net:844'),
      'origin_not_allowed',
    );
    assert.equal(rejected('https://webhooks.ts.example.net:844/h', ALLOWED), 'origin_not_allowed');
    assert.equal(rejected('https://webhooks.ts.example.net:443/h', ALLOWED), 'origin_not_allowed');
    assert.equal(
      rejected('https://webhooks.ts.example.net:4430/h', 'webhooks.ts.example.net'),
      'origin_not_allowed',
    );
  });

  it('the allowlisted origin inside the path, query or fragment does not count', () => {
    assert.equal(rejected(`https://evil.org/${ORIGIN}`, ALLOWED), 'origin_not_allowed');
    assert.equal(rejected(`https://evil.org/?u=https://${ORIGIN}/`, ALLOWED), 'origin_not_allowed');
    assert.equal(rejected(`https://evil.org/#${ORIGIN}`, ALLOWED), 'origin_not_allowed');
  });
});

describe('checkCallbackUrl — default and explicit port 443', () => {
  it('an entry without a port means 443', () => {
    const want = { href: 'https://hooks.example.org/x', origin: 'hooks.example.org:443' };
    assert.deepEqual(accepted('https://hooks.example.org/x', 'hooks.example.org'), want);
    assert.deepEqual(accepted('https://hooks.example.org:443/x', 'hooks.example.org'), want);
  });

  it('an entry with an explicit 443 matches a URL with or without the port', () => {
    assert.equal(
      accepted('https://hooks.example.org/x', 'hooks.example.org:443').origin,
      'hooks.example.org:443',
    );
    assert.equal(
      accepted('https://hooks.example.org:443/x', 'hooks.example.org:443').origin,
      'hooks.example.org:443',
    );
  });

  it('an entry without a port does not allow another port', () => {
    assert.equal(
      rejected('https://hooks.example.org:8443/x', 'hooks.example.org'),
      'origin_not_allowed',
    );
  });
});

describe('checkCallbackUrl — host forms', () => {
  it('IDN: a Unicode host and its punycode form are the same origin', () => {
    const puny = 'xn--bcher-kva.example:8443';
    assert.equal(accepted('https://bücher.example:8443/h', puny).origin, puny);
    assert.equal(
      accepted('https://xn--bcher-kva.example:8443/h', 'bücher.example:8443').origin,
      puny,
    );
  });

  it('IDN: a look-alike host does not match the ASCII entry', () => {
    assert.equal(rejected('https://webhооks.ts.example.net:8443/h', ALLOWED), 'origin_not_allowed');
  });

  it('rejects a trailing-dot host even when the dotless host is allowlisted', () => {
    assert.equal(rejected('https://webhooks.ts.example.net.:8443/hooks', ALLOWED), 'trailing_dot');
    assert.equal(
      rejected('https://webhooks.ts.example.net.:8443/hooks', 'webhooks.ts.example.net.:8443'),
      'trailing_dot',
    );
  });

  it('IPv6 literal: rejected unless that exact literal and port are allowlisted', () => {
    assert.equal(rejected('https://[::1]:8443/h', ALLOWED), 'origin_not_allowed');
    assert.equal(rejected('https://[::1]:8443/h', '[::2]:8443'), 'origin_not_allowed');
    assert.equal(rejected('https://[::1]:9443/h', '[::1]:8443'), 'origin_not_allowed');
    assert.equal(accepted('https://[0:0:0:0:0:0:0:1]:8443/h', '[::1]:8443').origin, '[::1]:8443');
  });

  it('IPv4 forms never match a hostname entry', () => {
    assert.equal(rejected('https://127.0.0.1:8443/h', ALLOWED), 'origin_not_allowed');
    assert.equal(rejected('https://2130706433:8443/h', ALLOWED), 'origin_not_allowed');
  });

  it('backslash: the host the parser lands on decides, never another one', () => {
    assert.equal(
      rejected('https://evil.org\\@webhooks.ts.example.net:8443/h', ALLOWED),
      'origin_not_allowed',
    );
    assert.equal(
      rejected('https:\\\\evil.org\\webhooks.ts.example.net:8443', ALLOWED),
      'origin_not_allowed',
    );
    const v = accepted('https://webhooks.ts.example.net:8443\\@evil.org/h', ALLOWED);
    assert.equal(v.origin, ORIGIN);
    assert.equal(v.href, 'https://webhooks.ts.example.net:8443/@evil.org/h');
    assert.equal(new URL(v.href).host, ORIGIN);
  });

  it('rejects userinfo, including a password-only one', () => {
    assert.equal(rejected('https://user:pw@webhooks.ts.example.net:8443/h', ALLOWED), 'userinfo');
    assert.equal(rejected('https://:pw@webhooks.ts.example.net:8443/h', ALLOWED), 'userinfo');
  });
});

describe('checkCallbackUrl — raw string hygiene (checked before parsing)', () => {
  it('rejects leading, trailing and embedded ASCII whitespace', () => {
    for (const raw of [
      ` ${GOOD}`,
      `${GOOD} `,
      `\t${GOOD}`,
      `${GOOD}\n`,
      'https://webhooks.ts.exa\tmple.net:8443/hooks',
      'https://webhooks.ts.example.net:8443/ho oks',
      `${GOOD}\r\nHost: evil.org`,
    ]) {
      assert.equal(rejected(raw, ALLOWED), 'bad_characters', JSON.stringify(raw));
    }
  });

  it('rejects control characters', () => {
    for (const raw of [
      `${GOOD}\u0000`,
      `\u0001${GOOD}`,
      'https://webhooks.ts.example.net:8443/\u007fx',
      'https://webhooks.ts.example.net:8443/\u001fx',
    ]) {
      assert.equal(rejected(raw, ALLOWED), 'bad_characters', JSON.stringify(raw));
    }
  });

  it('accepts 2048 characters and rejects 2049', () => {
    const base = `${GOOD}/`;
    assert.equal(accepted(base + 'a'.repeat(2048 - base.length), ALLOWED).origin, ORIGIN);
    assert.equal(rejected(base + 'a'.repeat(2049 - base.length), ALLOWED), 'too_long');
  });

  it('rejects the empty string', () => {
    assert.equal(rejected('', ALLOWED), 'unparseable');
  });

  it('a rejection reason never contains the URL', () => {
    const urls = [
      'http://secret-host.example:8443/tok-1',
      'https://u:secret@secret-host.example/tok-2',
      'https://secret-host.example/tok-3',
      'secret-host tok-4',
      'https://secret-host.example./tok-5',
      'x'.repeat(2049),
    ];
    const seen = new Set<string>();
    for (const u of urls) seen.add(rejected(u, ALLOWED));
    for (const r of seen) assert.match(r, /^[a-z_]{1,32}$/);
    assert.deepEqual([...seen].sort(), [
      'bad_characters',
      'origin_not_allowed',
      'scheme',
      'too_long',
      'trailing_dot',
      'userinfo',
    ]);
  });
});

describe('parseAllowedOrigins', () => {
  it('canonicalizes entries to hostname:port with 443 as the default', () => {
    const p = parseAllowedOrigins(' Hooks.Example.org , b.example.org:8443,c.example.org:443 ');
    assert.deepEqual([...p.origins].sort(), [
      'b.example.org:8443',
      'c.example.org:443',
      'hooks.example.org:443',
    ]);
    assert.equal(p.malformed, 0);
  });

  it('an empty value has no origins and no malformed entries', () => {
    for (const raw of ['', '  ']) {
      const p = parseAllowedOrigins(raw);
      assert.equal(p.origins.size, 0);
      assert.equal(p.malformed, 0);
    }
  });

  it('strips an optional leading https://', () => {
    const p = parseAllowedOrigins('https://webhooks.ts.example.net:8443');
    assert.deepEqual([...p.origins], [ORIGIN]);
    assert.equal(p.malformed, 0);
    assert.equal(accepted(GOOD, 'https://webhooks.ts.example.net:8443').origin, ORIGIN);
  });

  it('an empty entry (trailing or doubled comma) never matches and is counted', () => {
    const p = parseAllowedOrigins(`${ALLOWED},`);
    assert.deepEqual([...p.origins], [ORIGIN]);
    assert.equal(p.malformed, 1);
    assert.equal(parseAllowedOrigins(`,,${ALLOWED}`).malformed, 2);
    assert.equal(accepted(GOOD, `${ALLOWED},`).origin, ORIGIN);
    assert.equal(rejected('https://evil.org/h', `${ALLOWED},`), 'origin_not_allowed');
  });

  it('malformed entries never match and are counted', () => {
    const bad = [
      'http://webhooks.ts.example.net:8443',
      'webhooks.ts.example.net:8443/hooks',
      'https://webhooks.ts.example.net:8443/hooks',
      'webhooks.ts.example.net:8443?x=1',
      'webhooks.ts.example.net:8443#f',
      'user@webhooks.ts.example.net:8443',
      'webhooks.ts.example.net:notaport',
      'webhooks.ts.example.net:99999',
      'web hooks.example.net',
      'webhooks.ts.example.net:8443?',
      'webhooks.ts.example.net:8443#',
      'webhooks.ts.example.net:8443\\',
      'HTTPS://webhooks.ts.example.net:8443',
      'https://',
      ':8443',
    ];
    for (const entry of bad) {
      const p = parseAllowedOrigins(entry);
      assert.equal(p.origins.size, 0, entry);
      assert.equal(p.malformed, 1, entry);
      assert.equal(rejected(GOOD, entry), 'origin_not_allowed', entry);
    }
  });

  it('a malformed entry does not disable the valid ones next to it', () => {
    const p = parseAllowedOrigins(`http://x.example.org, ${ALLOWED}, y.example.org/path`);
    assert.deepEqual([...p.origins], [ORIGIN]);
    assert.equal(p.malformed, 2);
  });

  it('a trailing slash on an entry is not a path', () => {
    assert.deepEqual(
      [...parseAllowedOrigins('https://webhooks.ts.example.net:8443/').origins],
      [ORIGIN],
    );
  });

  it('a wildcard-looking or path-carrying entry does not widen the match', () => {
    assert.equal(
      rejected('https://a.ts.example.net:8443/h', '*.ts.example.net:8443'),
      'origin_not_allowed',
    );
    assert.equal(
      rejected('https://ts.example.net:8443/h', '*.ts.example.net:8443'),
      'origin_not_allowed',
    );
    assert.equal(
      rejected('https://evil.org/h', 'webhooks.ts.example.net:8443/..//evil.org'),
      'origin_not_allowed',
    );
  });
});

describe('checkCallbackUrlAgainstConfig', () => {
  it('reads webhook.allowed_origins live on every call, with an empty default', () => {
    let stored: string | undefined;
    const asked: [string, string | undefined][] = [];
    const config = {
      getString: (k: string, d?: string) => {
        asked.push([k, d]);
        return stored ?? d ?? '';
      },
    };
    assert.deepEqual(checkCallbackUrlAgainstConfig(config, GOOD), {
      ok: false,
      reason: 'origin_not_allowed',
    });
    stored = ALLOWED;
    assert.deepEqual(checkCallbackUrlAgainstConfig(config, GOOD), {
      ok: true,
      href: GOOD,
      origin: ORIGIN,
    });
    stored = 'other.example.org';
    assert.deepEqual(checkCallbackUrlAgainstConfig(config, GOOD), {
      ok: false,
      reason: 'origin_not_allowed',
    });
    assert.ok(asked.length >= 3);
    for (const a of asked) assert.deepEqual(a, ['webhook.allowed_origins', '']);
  });

  it('a malformed entry in the stored value still rejects and never throws', () => {
    const config = { getString: () => 'http://webhooks.ts.example.net:8443,,' };
    assert.deepEqual(checkCallbackUrlAgainstConfig(config, GOOD), {
      ok: false,
      reason: 'origin_not_allowed',
    });
    assert.deepEqual(checkCallbackUrlAgainstConfig(config, GOOD), {
      ok: false,
      reason: 'origin_not_allowed',
    });
  });
});
