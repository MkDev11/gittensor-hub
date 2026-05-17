// pm2 process config for gittensor-hub.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save               # persist for `pm2 resurrect` on reboot
//   pm2 logs gittensor-hub
//
// Paths resolve relative to the running user:
//   cwd        → the directory this config file lives in
//   log files  → ~/.pm2/logs/ for whichever user owns the pm2 daemon
// So no edits needed when deploying to a new box or user.
const path = require('path');
const os = require('os');

module.exports = {
  apps: [
    {
      name: 'gittensor-hub',
      cwd: __dirname,
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
      out_file: path.join(os.homedir(), '.pm2/logs/gittensor-hub-out.log'),
      error_file: path.join(os.homedir(), '.pm2/logs/gittensor-hub-error.log'),
      time: true,
    },
  ],
};
