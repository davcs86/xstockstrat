// A call-builder helper (an mTLS peer SAN + request metadata), not domain data, so no INVENTORY.md row.
import * as grpc from '@grpc/grpc-js';

export function callWith(san?: string, md: Record<string, string> = {}, noAuthContext = false) {
  const metadata = new grpc.Metadata();
  for (const [k, v] of Object.entries(md)) metadata.set(k, v);
  if (noAuthContext) return { metadata };
  return { getAuthContext: () => ({ sslPeerCertificate: { subjectaltname: san } }), metadata };
}
