/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    styledComponents: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
