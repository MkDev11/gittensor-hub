/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    styledComponents: true,
  },
  serverExternalPackages: ['better-sqlite3'],
};

module.exports = nextConfig;
