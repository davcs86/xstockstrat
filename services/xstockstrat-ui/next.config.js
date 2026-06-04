/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production/Docker builds emit a standalone server (see Dockerfile). The E2E
  // suite instead builds a regular bundle so it can serve via `next start`,
  // which is unsupported with output:'standalone'. Only the Playwright webServer
  // sets NEXT_DISABLE_STANDALONE — every other build keeps standalone.
  output: process.env.NEXT_DISABLE_STANDALONE ? undefined : 'standalone',
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
