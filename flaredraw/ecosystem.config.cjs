module.exports = {
  apps: [
    {
      name: 'flaredraw',
      cwd: '/root/works/flaredraw',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host 0.0.0.0 --port 5173',
      env: {
        NODE_ENV: 'development',
      },
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
}
