/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    styledComponents: true,
  },
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // isomorphic-dompurify (used for server-side markdown sanitization) pulls
      // in jsdom, which loads resources like default-stylesheet.css via paths
      // relative to its own __dirname. Bundling it rewrites those paths and
      // breaks the load. Keep both external so Node requires them from
      // node_modules at runtime. (serverExternalPackages does not reach the
      // SSR layer used for client components, so externalize here directly.)
      const externals = ['isomorphic-dompurify', 'jsdom'];
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...externals]
        : [config.externals, ...externals].filter(Boolean);
    }
    return config;
  },
};

module.exports = nextConfig;
