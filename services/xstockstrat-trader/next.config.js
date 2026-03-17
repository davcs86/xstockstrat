/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    TRADING_ENDPOINT: process.env.TRADING_ENDPOINT ?? 'xstockstrat-trading:50051',
    PORTFOLIO_ENDPOINT: process.env.PORTFOLIO_ENDPOINT ?? 'xstockstrat-portfolio:50052',
    NOTIFY_ENDPOINT: process.env.NOTIFY_ENDPOINT ?? 'xstockstrat-notify:50059',
    IDENTITY_ENDPOINT: process.env.IDENTITY_ENDPOINT ?? 'xstockstrat-identity:50058',
  },
  experimental: {
    serverComponentsExternalPackages: ['@grpc/grpc-js'],
  },
};

module.exports = nextConfig;
