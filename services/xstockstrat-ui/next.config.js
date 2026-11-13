const {
  resolveUiTheme,
  themeCssPath,
  themeBackgroundHex,
} = require('./src/styles/themes/uiTheme.cjs');

// Theme is fixed at build time from UI_THEME only; never read a runtime environment variable here (FR-10).
const uiTheme = resolveUiTheme(process.env.UI_THEME);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { UI_THEME_BACKGROUND_HEX: themeBackgroundHex(uiTheme) },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@theme-tokens$': themeCssPath(uiTheme) };
    // The persistent cache ignores alias targets: without the theme in its version a rebuild with a
    // different UI_THEME reuses the previous theme's CSS.
    if (config.cache && typeof config.cache === 'object') {
      config.cache = {
        ...config.cache,
        version: `${config.cache.version ?? ''}|ui-theme:${uiTheme}`,
      };
    }
    return config;
  },
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
  // PWA (feature 165): the service worker and manifest must be revalidated on every load so an
  // updated handler always reaches installed clients — a cached sw.js would pin a stale worker.
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
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
