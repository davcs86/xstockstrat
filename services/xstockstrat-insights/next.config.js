/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/insights',
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-next', '@connectrpc/connect-node', '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
  },
};

module.exports = nextConfig;
