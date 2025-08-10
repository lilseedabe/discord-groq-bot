#!/bin/bash
# VPSデプロイスクリプト

set -e  # エラー時にスクリプトを終了

echo "🚀 Discord Groq Bot VPSデプロイを開始します..."

# 設定変数
PROJECT_DIR="/opt/discord-groq-bot"  # VPS上のプロジェクトディレクトリ
SERVICE_NAME="discord-groq-bot"
LOG_DIR="$PROJECT_DIR/logs"

# ログディレクトリ作成
echo "📁 ログディレクトリを作成中..."
mkdir -p $LOG_DIR

# Node.js環境確認
echo "🔍 Node.js環境を確認中..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.jsがインストールされていません"
    echo "以下のコマンドでインストールしてください:"
    echo "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "sudo apt-get install -y nodejs"
    exit 1
fi

echo "✅ Node.js バージョン: $(node --version)"
echo "✅ npm バージョン: $(npm --version)"

# PM2がインストールされているか確認
echo "🔍 PM2を確認中..."
if ! command -v pm2 &> /dev/null; then
    echo "📦 PM2をインストール中..."
    npm install -g pm2
fi

# プロジェクトディレクトリに移動
echo "📂 プロジェクトディレクトリに移動: $PROJECT_DIR"
cd $PROJECT_DIR

# 依存関係をインストール
echo "📦 依存関係をインストール中..."
npm install --production

# 環境変数ファイルの確認
echo "🔧 環境変数ファイルを確認中..."
if [ ! -f .env ]; then
    echo "⚠️  .env ファイルが見つかりません"
    echo "📋 .env.example を参考に .env ファイルを作成してください"
    exit 1
fi

# 既存のプロセスを停止
echo "⏹️  既存のプロセスを停止中..."
pm2 stop $SERVICE_NAME 2>/dev/null || echo "ℹ️  プロセスが実行されていません"
pm2 delete $SERVICE_NAME 2>/dev/null || echo "ℹ️  プロセスが登録されていません"

# PM2でアプリケーションを起動
echo "🚀 アプリケーションを起動中..."
pm2 start ecosystem.config.js --env production

# PM2の自動起動設定
echo "🔄 PM2自動起動を設定中..."
pm2 startup
pm2 save

# ファイアウォール設定確認（ufw使用の場合）
echo "🔥 ファイアウォール設定を確認中..."
if command -v ufw &> /dev/null; then
    if ufw status | grep -q "3000"; then
        echo "✅ ポート3000は既に開放済みです"
    else
        echo "🔓 ポート3000を開放中..."
        sudo ufw allow 3000
    fi
fi

# Nginx設定例を表示（オプション）
echo ""
echo "🌐 Nginxリバースプロキシ設定例:"
echo "server {"
echo "    listen 80;"
echo "    server_name your-domain.com;"
echo ""
echo "    location / {"
echo "        proxy_pass http://localhost:3000;"
echo "        proxy_http_version 1.1;"
echo "        proxy_set_header Upgrade \$http_upgrade;"
echo "        proxy_set_header Connection 'upgrade';"
echo "        proxy_set_header Host \$host;"
echo "        proxy_set_header X-Real-IP \$remote_addr;"
echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
echo "        proxy_cache_bypass \$http_upgrade;"
echo "    }"
echo "}"

# 状態確認
echo ""
echo "📊 デプロイ状態確認:"
pm2 status
pm2 logs $SERVICE_NAME --lines 10

echo ""
echo "✅ Discord Groq Bot のVPSデプロイが完了しました！"
echo ""
echo "🔗 確認URL: http://your-vps-ip:3000"
echo "📊 PM2監視: pm2 monit"
echo "📋 ログ確認: pm2 logs $SERVICE_NAME"
echo "🔄 再起動: pm2 restart $SERVICE_NAME"
echo ""
echo "⚠️  重要: Discordアプリケーション設定でリダイレクトURLを更新してください"
