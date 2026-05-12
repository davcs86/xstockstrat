/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/insights',
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect-node'],
  },
};

module.exports = nextConfig;
