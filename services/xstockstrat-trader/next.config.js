/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/trader',
  output: 'standalone',
  // Keep all Connect-RPC + protobuf packages external so instanceof checks share
  // the same class instance as connect-node (bundling them separately breaks instanceof ConnectError).
  serverExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node', '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
};

module.exports = nextConfig;
