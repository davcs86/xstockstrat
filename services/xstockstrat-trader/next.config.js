/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // Ensure Connect-RPC Node transport runs in server context without bundling issues
    serverComponentsExternalPackages: ['@connectrpc/connect-node'],
  },
};

module.exports = nextConfig;
