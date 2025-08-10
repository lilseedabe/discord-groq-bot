// PM2設定ファイル
module.exports = {
  apps: [{
    name: 'discord-groq-bot',
    script: 'index.js',
    cwd: '/path/to/your/discord-groq-bot', // VPS上の実際のパスに変更
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // 自動再起動設定
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    // メモリ・CPU監視
    monitoring: true,
    pmx: true
  }],

  deploy: {
    production: {
      user: 'your-username', // VPSのユーザー名に変更
      host: 'your-vps-ip', // VPSのIPアドレスに変更
      ref: 'origin/main',
      repo: 'git@github.com:your-username/discord-groq-bot.git', // GitHubリポジトリに変更
      path: '/path/to/your/discord-groq-bot', // VPS上のデプロイパスに変更
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
