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
  // Serve the MCP agent's OAuth metadata at the RFC 8414/9728 canonical (path-insertion) locations.
  // The agent is mounted under `/agent`, so its issuer is `https://<host>/agent`; spec-compliant
  // clients (Claude.ai) fetch `…/.well-known/oauth-authorization-server/agent`, which lands on this
  // UI (the `/` catch-all). These rewrites map those paths to local handlers that emit the metadata.
  // (feature 049 OAuth edge — fixes Claude.ai "couldn't register" caused by discovery hitting the
  // auth-gated UI instead of JSON.)
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server/agent',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource/agent',
        destination: '/api/oauth/protected-resource',
      },
    ];
  },
};

module.exports = nextConfig;
