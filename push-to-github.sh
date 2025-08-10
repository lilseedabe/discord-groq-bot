#!/bin/bash
# GitHub変更反映スクリプト

echo "🔄 Discord Groq Bot の変更をGitHubに反映します..."

# 現在のディレクトリ確認
echo "📂 現在のディレクトリ: $(pwd)"

# Git状態確認
echo ""
echo "📊 現在のGit状態:"
git status

# 変更ファイルをステージング
echo ""
echo "📝 変更ファイルをステージング中..."
git add .

# .envファイルが含まれていないか確認
echo ""
echo "🔍 .envファイルがステージングされていないか確認:"
git status --porcelain | grep ".env" && echo "⚠️ .envファイルが含まれています！" || echo "✅ .envファイルは除外されています"

# コミット
echo ""
echo "💾 変更をコミット中..."
git commit -m "feat: VPS・Supabase対応とシンプル化

- VPSデプロイ対応（PM2、自動デプロイスクリプト）
- Supabase接続設定対応
- AIモデル変更（デフォルト: GPT-OSS-120B、推論: Kimi K2）
- 統計機能削除によるシンプル化
- メモリ内会話履歴管理の最適化
- 不要な依存関係の整理

Changes:
- 🗄️ DB: Supabase SSL接続対応
- 🤖 AI: モデル構成変更（Qwen削除）
- 🚀 Deploy: VPSデプロイ自動化
- 🧹 Cleanup: 統計機能削除
- 📦 Dependencies: pg, express, pm2追加
- 🔧 Config: ecosystem.config.js追加"

# プッシュ
echo ""
echo "🚀 GitHubにプッシュ中..."
git push origin main

echo ""
echo "✅ GitHub への変更反映が完了しました！"
echo ""
echo "🔗 リポジトリURL: https://github.com/lilseedabe/discord-groq-bot"
echo ""
echo "⚠️  重要な次のステップ:"
echo "1. 新しいDiscord Botトークンを生成"
echo "2. 新しいGroq APIキーを生成"
echo "3. .envファイルに新しい値を設定"
echo "4. VPSにプロジェクトをクローン"
echo "5. VPS上で環境変数を設定"
