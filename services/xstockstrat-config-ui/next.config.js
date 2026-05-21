/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/config-ui',
  output: 'standalone',
  // Allow server-side Connect-RPC calls to backend services
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect-node', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
  },
};

module.exports = nextConfig;
