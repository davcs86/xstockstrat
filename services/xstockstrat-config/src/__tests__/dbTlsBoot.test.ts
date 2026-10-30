// Feature 266: config main() refuses to boot without DATABASE_CA_CERT (@AC-1), rejects a DB server cert
// from an unconfigured CA end to end (@AC-2), and with sslmode=disable connects in plaintext without a CA (@AC-3).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { sh, mintLeaf } from './mtlsTestPki';

const VERIFY_CODES = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN/;
const SSL_REQUEST_CODE = 80877103;
const STARTUP_PROTOCOL_V3 = 196608;

interface Boot {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function bootConfig(databaseUrl: string, caCert?: string): Boot {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    CONFIG_SECRETS_ENCRYPTION_KEY: '0'.repeat(64),
    DATABASE_URL: databaseUrl,
  };
  if (caCert) env.DATABASE_CA_CERT = caCert;
  const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
  const exited = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`config did not exit within 15s; output: ${output}`));
    }, 15_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  exited.catch(() => undefined);
  return { child, output: () => output, exited };
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as net.AddressInfo).port;
}

describe('config boot: DATABASE_CA_CERT is required (fail-closed)', () => {
  it('AC-1: sslmode=require without a CA exits naming DATABASE_CA_CERT', async () => {
    const boot = bootConfig('postgres://u:p@db.example:25060/xstockstrat?sslmode=require');
    try {
      assert.notEqual(await boot.exited, 0);
      assert.match(boot.output(), /DATABASE_CA_CERT/);
    } finally {
      boot.child.kill();
    }
  });
});

describe('config boot TLS: DB server cert must chain to DATABASE_CA_CERT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbtls-'));
  const mintCa = (name: string): [string, string] => {
    const cert = join(dir, `${name}.pem`);
    const key = join(dir, `${name}-key.pem`);
    sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${name}`);
    return [cert, key];
  };
  const [caAPath] = mintCa('ca-a');
  const [caBPath, caBKey] = mintCa('ca-b');
  const caA = readFileSync(caAPath, 'utf8');
  const caB = readFileSync(caBPath, 'utf8');
  const [cert, key] = mintLeaf(dir, 'localhost', caBPath, caBKey);

  async function bootAgainstTlsStub(ca: string): Promise<{ boot: Boot; secure: Promise<void> }> {
    let onSecure: () => void = () => undefined;
    const secure = new Promise<void>((r) => (onSecure = r));
    const server = net.createServer((sock) => {
      sock.on('error', () => undefined);
      sock.once('data', (buf) => {
        assert.equal(buf.readInt32BE(4), SSL_REQUEST_CODE);
        sock.write('S');
        const tlsSock = new tls.TLSSocket(sock, { isServer: true, cert, key });
        tlsSock.on('secure', onSecure);
        tlsSock.on('error', () => undefined);
        tlsSock.once('data', () => tlsSock.destroy());
      });
    });
    const port = await listen(server);
    const boot = bootConfig(`postgres://u:p@localhost:${port}/xstockstrat?sslmode=require`, ca);
    boot.exited.finally(() => server.close()).catch(() => undefined);
    return { boot, secure };
  }

  it('AC-2: wrong CA exits with a verification error', async () => {
    const { boot } = await bootAgainstTlsStub(caA);
    try {
      assert.notEqual(await boot.exited, 0);
      assert.match(boot.output(), VERIFY_CODES);
    } finally {
      boot.child.kill();
    }
  });

  it('AC-2 positive control: the right CA completes the handshake', async () => {
    const { boot, secure } = await bootAgainstTlsStub(caB);
    try {
      await secure;
      assert.doesNotMatch(boot.output(), VERIFY_CODES);
    } finally {
      boot.child.kill();
      await boot.exited.catch(() => undefined);
    }
  });
});

describe('config boot: sslmode=disable connects in plaintext without a CA', () => {
  it('AC-3: first packet is a StartupMessage, not an SSLRequest', async () => {
    let onPacket: (code: number) => void = () => undefined;
    const firstPacket = new Promise<number>((r) => (onPacket = r));
    const server = net.createServer((sock) => {
      sock.on('error', () => undefined);
      sock.once('data', (buf) => {
        onPacket(buf.readInt32BE(4));
        sock.destroy();
      });
    });
    const port = await listen(server);
    const boot = bootConfig(`postgres://u:p@127.0.0.1:${port}/xstockstrat?sslmode=disable`);
    try {
      const code = await firstPacket;
      assert.equal(code, STARTUP_PROTOCOL_V3);
      assert.notEqual(code, SSL_REQUEST_CODE);
      assert.doesNotMatch(boot.output(), /db-tls:/);
    } finally {
      boot.child.kill();
      await boot.exited.catch(() => undefined);
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
