/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/insights',
  output: 'standalone',
  serverExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node', '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
};

module.exports = nextConfig;
