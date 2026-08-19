const path = require('path');

module.exports = {
  apps: [
    {
      name: 'streaming',
      cwd: path.join(__dirname, '..'),
      script: 'server/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3040,
      },
    },
  ],
};
