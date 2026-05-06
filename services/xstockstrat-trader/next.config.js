/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Ensure Connect-RPC Node transport runs in server context without bundling issues
  serverExternalPackages: ['@connectrpc/connect-node'],
};

module.exports = nextConfig;
