# Discord Groq Bot - AI会話特化版

高性能なAI機能を搭載したDiscordボットです。複数のAIモデルとの対話、会話履歴の記憶、Web検索連携機能をサポートしています。

## 🚀 主な機能

### 🤖 AI対話機能
- **複数AIモデル対応**: GPT-OSS-120B、Compound Beta、Kimi K2から選択可能
- **会話履歴記憶**: ユーザーごとの会話コンテキストを自動保存
- **インテリジェントな応答**: 過去の会話を考慮した自然な対話
- **Web検索連携**: 最新情報が必要な場合の自動検索対応

### 💬 Discord コマンド
- `/ask [メッセージ]` - AIと基本対話
- `/search [メッセージ]` - Web検索機能付き対話  
- `/ask-model [メッセージ] [モデル]` - AIモデルを選択して対話
- `/clear` - 会話履歴をクリア
- `/history` - 現在の会話履歴を確認
- `/status` - ボットの稼働状況確認
- `/models` - 利用可能なAIモデル情報

### 🔧 技術仕様
- **Node.js** ベースの高速処理
- **Discord.js v14** による安定した Discord 連携
- **Groq SDK** による高性能AI処理
- **メモリベース** 会話履歴管理（24時間自動クリーンアップ）
- **Webサーバー** 内蔵（ヘルスチェック・監視対応）

## 📁 プロジェクト構成

```
discord-groq-bot/
├── src/
│   ├── discordBot.js     # Discord Bot本体・コマンド処理
│   ├── aiService.js      # Groq AI連携・プロンプト生成
│   ├── db.js             # データベース管理（オプション）
│   ├── expressServer.js  # Webサーバー・ヘルスチェック
│   └── utils.js          # 暗号化等ユーティリティ
├── index.js              # メインエントリーポイント
├── package.json          # プロジェクト設定
├── .env                  # 環境変数設定
└── README.md             # このファイル
```

## ⚡ クイックスタート

### 1. 環境設定

`.env` ファイルを作成し、以下の項目を設定：

```bash
# 必須設定
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
GROQ_API_KEY=your_groq_api_key

# オプション設定
PORT=3000
NODE_ENV=production

# Supabase データベース設定
DB_HOST=db.your-project-ref.supabase.co
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_supabase_password
DB_PORT=5432
ENCRYPTION_KEY=your_32_character_encryption_key
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. Supabaseデータベース設定

1. [Supabase](https://supabase.com/)でアカウント作成
2. 新しいプロジェクトを作成
3. 「Settings」 → 「Database」で接続情報を取得
4. `.env`ファイルに接続情報を設定

### 4. VPSデプロイ

```bash
# VPSにプロジェクトをクローン
git clone https://github.com/your-username/discord-groq-bot.git
cd discord-groq-bot

# 環境変数設定
cp .env.example .env
# .envファイルを編集して実際の値を設定

# 自動デプロイスクリプト実行
npm run deploy:setup

# 手動デプロイの場合
npm install
npm run db:migrate  # データベース初期化
npm run pm2:start   # PM2で起動
```

### 5. ローカル開発

```bash
# 開発環境（ホットリロード）
npm run dev

# 本番環境
npm start
```

## 🔑 API キー取得方法

### Discord Bot Token
1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 新しいアプリケーションを作成
3. 「Bot」セクションでトークンを生成
4. 必要な権限を設定（スラッシュコマンド、メッセージ送信等）

### Groq API Key
1. [Groq Console](https://console.groq.com/) でアカウント作成
2. API キーを生成
3. 利用制限・課金設定を確認

## 🎯 利用可能なAIモデル

| モデル名 | 特徴 | 最適な用途 |
|---------|------|----------|
| **GPT-OSS-120B** | 高性能汎用モデル | 一般的な会話・幅広いタスク |
| **Compound Beta** | Web検索機能付き | 最新情報が必要な質問 |
| **Kimi K2** | 日本語特化、高度な推論 | 複雑な論理的思考・詳細な分析 |

## 📊 監視・運用

### ヘルスチェック
```bash
# ローカル
curl http://localhost:3000/health

# VPS
curl http://your-vps-ip:3000/health
```

### VPS監視コマンド
```bash
# PM2ステータス確認
npm run pm2:monit

# ログ確認
npm run pm2:logs

# プロセス再起動
npm run pm2:restart

# プロセス停止
npm run pm2:stop
```

### 稼働状況確認
Discordで `/status` コマンドを実行

### ログ管理
- **VPS**: PM2が自動でログローテーション実行
- **ログファイル**: `./logs/` ディレクトリに保存
- **リアルタイム監視**: `pm2 monit` コマンド

## 🔒 セキュリティ機能

- **暗号化**: 機密データの安全な保存
- **レート制限**: API乱用防止
- **入力検証**: 不正なデータの検出・除去
- **エラーハンドリング**: 安全なエラー処理

## 🛠️ カスタマイズ

### AIモデルの追加
`src/aiService.js` の `MODELS` オブジェクトに新しいモデルを追加

### 新しいコマンドの追加
`src/discordBot.js` の `commands` 配列に新しいスラッシュコマンドを定義

### データベース機能の有効化
PostgreSQL設定を `.env` に追加すると自動的にデータベース機能が有効化

## 📈 パフォーマンス

- **メモリ効率**: 自動クリーンアップによる最適化
- **レスポンス速度**: Groq APIによる高速AI処理
- **並行処理**: 複数ユーザーの同時利用対応
- **スケーラビリティ**: 高負荷環境での安定動作

## 🔄 バージョン履歴

### v2.1.0 (現在)
- Twitter機能を削除し、AI会話機能に特化
- パフォーマンス最適化
- セキュリティ強化
- UI/UX改善

## 💡 トラブルシューティング

### よくある問題

**Bot が応答しない**
- Discord トークンの確認
- Bot権限の設定確認
- VPSのファイアウォール設定確認
- PM2プロセスの確認: `pm2 status`

**AI応答が遅い**
- Groq API キーの確認
- API制限の確認
- VPSのリソース使用量確認: `htop`

**データベース接続エラー**
- Supabaseプロジェクトの状態確認
- SSL設定の確認
- ネットワーク接続の確認
- 認証情報の再確認

**VPSデプロイ問題**
- Node.jsバージョン確認: `node --version`
- PM2インストール確認: `pm2 --version`
- 環境変数設定確認: `.env`ファイル
- ポート開放確認: `sudo ufw status`

**メモリ使用量が多い**
- PM2モニターで確認: `pm2 monit`
- `/status` でBot統計確認
- メモリ制限設定: `ecosystem.config.js`

## 📞 サポート

- GitHub Issues での報告
- 詳細なエラーログの提供
- 環境情報の明記

---

**Developed by Nako** | Licensed under MIT