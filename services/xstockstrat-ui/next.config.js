/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@connectrpc/connect',
    '@connectrpc/connect-node',
    '@bufbuild/protobuf',
    '@opentelemetry/sdk-node',
    '@opentelemetry/exporter-trace-otlp-http',
  ],
  async redirects() {
    return [{ source: '/', destination: '/trader', permanent: false }];
  },
};

module.exports = nextConfig;
