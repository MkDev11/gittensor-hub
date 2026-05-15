// pm2 process config for the gittensor miner dashboard.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save               # persist for `pm2 resurrect` on reboot
//   pm2 logs gittensor-miner-dashboard
module.exports = {
  apps: [
    {
      name: 'gittensor-miner-dashboard',
      cwd: '/root/_GittensorDashboard',
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
      out_file: '/root/.pm2/logs/gittensor-miner-dashboard-out.log',
      error_file: '/root/.pm2/logs/gittensor-miner-dashboard-error.log',
      time: true,
    },
  ],
};
