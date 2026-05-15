// pm2 process config for gittensor-hub.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save               # persist for `pm2 resurrect` on reboot
//   pm2 logs gittensor-hub
module.exports = {
  apps: [
    {
      name: 'gittensor-hub',
      cwd: '/root/gittensor-hub',
      script: 'pnpm',
      args: 'start',
      // pnpm needs argv[0]
      interpreter: 'none',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: '12074',
      },
      out_file: '/root/.pm2/logs/gittensor-hub-out.log',
      error_file: '/root/.pm2/logs/gittensor-hub-error.log',
      time: true,
    },
  ],
};
