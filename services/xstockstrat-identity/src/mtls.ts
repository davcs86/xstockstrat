// Mutual-TLS transport credentials for inter-service gRPC (feature 210).
//
// Cert material is read from boot-time env PEM strings (MTLS_CERT / MTLS_KEY / MTLS_CA_CERT), never
// over WatchConfig. Absent material throws (fail-closed — the server/client must not start without
// it). Clients pin the verified server authority to the TARGET SERVICE NAME (never the dialed host)
// via the grpc.ssl_target_name_override channel option, so verification is env-independent across
// docker-compose (bare service name) and DO App Platform (PRIVATE_DOMAIN FQDN).
// See docs/patterns/inter-service-mtls.md.
import * as grpc from '@grpc/grpc-js';

function load(): { cert: Buffer; key: Buffer; ca: Buffer } {
  const cert = process.env.MTLS_CERT ?? '';
  const key = process.env.MTLS_KEY ?? '';
  const ca = process.env.MTLS_CA_CERT ?? '';
  if (!cert || !key || !ca) {
    throw new Error('mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)');
  }
  return { cert: Buffer.from(cert), key: Buffer.from(key), ca: Buffer.from(ca) };
}

// serverCredentials requires and verifies the client cert chains to the platform CA (mutual TLS).
export function serverCredentials(): grpc.ServerCredentials {
  const { cert, key, ca } = load();
  return grpc.ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }], true);
}

// clientCredentials presents this service's leaf and verifies the server cert chains to the CA.
export function clientCredentials(): grpc.ChannelCredentials {
  const { cert, key, ca } = load();
  return grpc.credentials.createSsl(ca, key, cert);
}

// targetOverride pins the verified server authority to targetService (the destination registry
// service name, e.g. "xstockstrat-config") — the env-independent authority pin, NOT the dialed host.
export function targetOverride(targetService: string): grpc.ChannelOptions {
  return { 'grpc.ssl_target_name_override': targetService };
}
