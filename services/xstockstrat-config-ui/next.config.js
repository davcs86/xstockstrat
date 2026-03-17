/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow server-side Connect-RPC calls to backend services
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect-node'],
  },
};

module.exports = nextConfig;
