/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/insights',
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect-node', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
  },
};

module.exports = nextConfig;
