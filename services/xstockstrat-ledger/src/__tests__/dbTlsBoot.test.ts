// Feature 266: ledger refuses to boot without DATABASE_CA_CERT (@AC-1, @AC-6), and a resolver-built
// pg.Pool rejects a server cert from an unconfigured CA (@AC-2, Pool level).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';
import pg from 'pg';
import { resolveDbConnection } from '../dbTls';

const VERIFY_CODES = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN'];
const SSL_REQUEST_CODE = 80877103;

function sh(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'pipe' });
}

function mintCa(dir: string, name: string): [string, string] {
  const cert = join(dir, `${name}.pem`);
  const key = join(dir, `${name}-key.pem`);
  sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${name}`);
  return [cert, key];
}

function mintLeaf(dir: string, name: string, ca: string, caKey: string): [string, string] {
  const ext = join(dir, `${name}.ext`);
  writeFileSync(ext, 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `${name}-key.pem`), '-out', join(dir, `${name}.csr`), '-subj', `/CN=${name}`);
  sh('x509', '-req', '-in', join(dir, `${name}.csr`), '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', join(dir, `${name}.pem`), '-days', '1', '-extfile', ext);
  return [readFileSync(join(dir, `${name}.pem`), 'utf8'), readFileSync(join(dir, `${name}-key.pem`), 'utf8')];
}

function bootLedger(databaseUrl: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js')], {
      env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ledger did not exit within 15s; stderr: ${stderr}`));
    }, 15_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

describe('ledger boot: DATABASE_CA_CERT is required (fail-closed)', () => {
  const base = 'postgres://u:p@db.example:25060/xstockstrat';

  for (const [name, url] of [
    ['AC-1: sslmode=require without a CA exits before ConfigWatcher', `${base}?sslmode=require`],
    ['AC-6: no sslmode without a CA exits before ConfigWatcher', base],
  ]) {
    it(name, async () => {
      const { code, stderr } = await bootLedger(url);
      assert.notEqual(code, 0);
      assert.match(stderr, /DATABASE_CA_CERT/);
      assert.doesNotMatch(stderr, /mtls:/);
    });
  }
});

describe('ledger pool TLS: server cert must chain to DATABASE_CA_CERT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbtls-'));
  const [caAPath] = mintCa(dir, 'ca-a');
  const [caBPath, caBKey] = mintCa(dir, 'ca-b');
  const caA = readFileSync(caAPath, 'utf8');
  const caB = readFileSync(caBPath, 'utf8');
  const [cert, key] = mintLeaf(dir, 'db-server', caBPath, caBKey);

  async function queryStub(ca: string): Promise<{ err: NodeJS.ErrnoException; secure: number }> {
    let secure = 0;
    const server = net.createServer((sock) => {
      sock.once('data', (buf) => {
        assert.equal(buf.readInt32BE(4), SSL_REQUEST_CODE);
        sock.write('S');
        const tlsSock = new tls.TLSSocket(sock, { isServer: true, cert, key });
        tlsSock.on('secure', () => (secure += 1));
        tlsSock.on('error', () => undefined);
        tlsSock.once('data', () => tlsSock.destroy());
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    const c = resolveDbConnection(`postgres://u:p@localhost:${port}/x?sslmode=require`, ca);
    const pool = new pg.Pool({ connectionString: c.connectionString, ssl: c.ssl, max: 1 });
    pool.on('error', () => undefined);
    try {
      const err = await pool.query('SELECT 1').then(
        () => assert.fail('query unexpectedly succeeded'),
        (e: NodeJS.ErrnoException) => e,
      );
      return { err, secure };
    } finally {
      await pool.end();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('AC-2: wrong CA rejects the handshake with a verification error', async () => {
    const { err } = await queryStub(caA);
    assert.ok(VERIFY_CODES.includes(err.code ?? ''), `unexpected error code: ${err.code}`);
  });

  it('AC-2 positive control: the right CA completes the handshake', async () => {
    const { err, secure } = await queryStub(caB);
    assert.ok(secure > 0, 'stub recorded no completed TLS handshake');
    assert.ok(!VERIFY_CODES.includes(err.code ?? ''), `unexpected verification error: ${err.code}`);
  });
});
