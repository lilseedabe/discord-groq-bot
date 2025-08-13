# Discord note AI生成プラン Bot 🎨

高性能なAI機能を搭載したDiscordボットです。無料のチャット機能に加え、**note AI生成プラン会員限定**で画像・動画・音声のAI生成機能をご利用いただけます。

## 🌟 主な機能

### 💬 チャット機能（無料）
- **複数AIモデル対応**: GPT-OSS-120B、Compound Beta、Kimi K2
- **会話履歴記憶**: ユーザーごとの会話コンテキストを自動保存
- **Web検索連携**: 最新情報が必要な場合の自動検索対応
- **スラッシュコマンド**: `/ask`, `/search`, `/ask-model`

### 🎨 AI生成機能（note会員限定）
- **画像生成**: DALL·E 3、Stable Diffusion、Flux等 6種類のモデル
- **動画生成**: RunwayML Gen-2による高品質短時間動画
- **音声生成**: OpenAI TTS、ElevenLabsによる自然な読み上げ
- **クレジット制**: 月1000クレジット、使用量に応じた柔軟な料金体系

### 📱 便利機能
- **Ephemeral レスポンス**: プライベートな応答
- **DM通知**: 生成完了時の通知（設定可能）
- **X(Twitter)投稿**: ワンクリックでの結果共有
- **ジョブキュー**: 非同期処理によるスムーズな体験
- **会話履歴管理**: 24時間自動クリーンアップ

## 🚀 クイックスタート

### 前提条件

- **Node.js 18.0.0 以上**
- **Redis** (ジョブキュー用)
- **Supabase アカウント** (データベース)
- **Discord Developer Portal アカウント**
- **Groq API キー** (チャット機能)
- **Eden.AI API キー** (AI生成機能)

### 1️⃣ リポジトリのクローン

```bash
git clone https://github.com/your-username/discord-groq-bot.git
cd discord-groq-bot
```

### 2️⃣ 依存関係のインストール

```bash
npm install
```

### 3️⃣ 環境変数の設定

```bash
cp .env.example .env
```

`.env`ファイルを編集して、以下の必須項目を設定：

```bash
# Discord Bot設定
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id

# AI API設定
GROQ_API_KEY=your_groq_api_key
EDEN_AI_API_KEY=your_eden_ai_key

# Supabase設定
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Redis設定
REDIS_URL=redis://localhost:6379
```

### 4️⃣ データベースのセットアップ

Supabaseデータベーススキーマを設定：

```bash
npm run db:setup-supabase
```

### 5️⃣ アプリケーションの起動

```bash
# 開発環境
npm run dev

# 本番環境
npm start
```

## 📋 コマンド一覧

### 💬 チャット機能（無料）

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/ask` | AIと基本会話 | `/ask こんにちは` |
| `/search` | Web検索付き会話 | `/search 最新のAI技術について` |
| `/ask-model` | モデル選択会話 | `/ask-model 複雑な計算問題` |
| `/clear` | 会話履歴クリア | `/clear` |
| `/history` | 会話履歴確認 | `/history` |

### 🎨 AI生成機能（note会員限定）

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/gen-image` | 画像生成 | `/gen-image a cute cat in a garden` |
| `/gen-video` | 動画生成 | `/gen-video a bird flying in the sky` |
| `/gen-audio` | 音声生成 | `/gen-audio こんにちは、世界！` |

### 👤 アカウント管理

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/redeem` | 会員登録 | `/redeem NOTE-XXXX-XXXX-XXXX` |
| `/account` | アカウント情報 | `/account` |
| `/credits` | クレジット確認 | `/credits` |
| `/dm-settings` | DM設定変更 | `/dm-settings` |
| `/jobs` | ジョブ確認 | `/jobs` |

### ℹ️ 情報・ヘルプ

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/help` | 使い方ガイド | `/help` |
| `/pricing` | 料金案内 | `/pricing` |
| `/models` | モデル情報 | `/models` |
| `/status` | Bot状態確認 | `/status` |

## 💰 料金体系

### note AI生成プラン: **¥2,500/月**

**毎月1000クレジット付与**

| 生成タイプ | モデル | クレジット/回 | 説明 |
|-----------|--------|--------------|------|
| 🎨 **画像** | Stable Diffusion | 1 | 高速・低コスト |
| | Flux | 1 | 高速生成 |
| | Stable Diffusion XL | 3 | 高解像度 |
| | DALL·E 2 | 3 | 高品質 |
| | Leonardo AI | 4 | アーティスティック |
| | **DALL·E 3** | **6** | **最高品質** |
| 🎬 **動画** | RunwayML Gen-2 (8秒) | 480 | 高品質短時間動画 |
| 🎵 **音声** | OpenAI TTS | 2 | 自然な読み上げ |
| | ElevenLabs | 3 | 高品質多言語 |

### 特典・割引

- 🎯 **初回20%割引** (最初の3回)
- 🌙 **月末割引** (10%OFF)
- 📦 **大量割引** (10個以上同時生成で15%OFF)

## 🛠️ 詳細セットアップガイド

### Discord Bot設定

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーション作成
2. Botセクションでトークン生成
3. 必要な権限を設定：
   - `Send Messages`
   - `Use Slash Commands`
   - `Send Messages in Threads`
   - `Embed Links`
   - `Attach Files`

### API キー取得

#### Groq API (必須)
1. [Groq Console](https://console.groq.com/)でアカウント作成
2. API キーを生成

#### Eden.AI (AI生成機能用)
1. [Eden.AI](https://app.edenai.run/)でアカウント作成
2. API キーを生成
3. 利用予定のプロバイダーを有効化

### Supabaseデータベース設定

1. [Supabase](https://supabase.com/)でプロジェクト作成
2. データベース設定で接続情報取得
3. `.env`ファイルに設定
4. スキーマセットアップ実行：
   ```bash
   npm run db:setup-supabase
   ```

### Redis設定

#### Windowsの場合
```bash
# Redis for Windows をインストール
# または Docker を使用
docker run -d -p 6379:6379 redis:alpine
```

#### macOS/Linuxの場合
```bash
# Homebrew (macOS)
brew install redis
brew services start redis

# apt (Ubuntu/Debian)
sudo apt install redis-server
sudo systemctl start redis-server
```

## 🚀 VPS本番環境デプロイ

### 自動デプロイスクリプト

```bash
# VPSにプロジェクトをクローン
git clone https://github.com/your-username/discord-groq-bot.git
cd discord-groq-bot

# 環境変数設定
cp .env.example .env
# .envファイルを実際の値で編集

# 自動デプロイ実行
npm run deploy:setup
```

### 手動デプロイ

```bash
# 依存関係インストール
npm install --production

# データベース初期化
npm run db:setup-supabase

# PM2で起動
npm run pm2:start

# 状態確認
npm run pm2:monit
```

### PM2運用コマンド

```bash
# プロセス確認
pm2 status

# ログ確認
npm run pm2:logs

# 再起動
npm run pm2:restart

# 停止
npm run pm2:stop

# 監視
npm run pm2:monit
```

## 👥 note会員登録フロー

### 管理者側（リデンプションコード生成）

```bash
# 単体生成
npm run generate-code generate user@example.com 1000 "note購入者"

# 一覧表示
npm run generate-code list 20

# CSV一括生成
npm run generate-code csv users.csv
```

### ユーザー側（Discord内での登録）

1. noteでAI生成プランを購入
2. リデンプションコードを受け取り
3. Discord で `/redeem NOTE-XXXX-XXXX-XXXX` を実行
4. 1000クレジットが自動付与
5. AI生成機能が利用可能に

## 🔧 トラブルシューティング

### よくある問題

#### Bot が応答しない
```bash
# Discord トークンを確認
echo $DISCORD_TOKEN

# プロセス状態確認
pm2 status

# ログ確認
npm run pm2:logs
```

#### AI生成が動作しない
```bash
# Eden.AI API キー確認
echo $EDEN_AI_API_KEY

# Redis接続確認
redis-cli ping

# ワーカープロセス確認
pm2 list | grep worker
```

#### データベース接続エラー
```bash
# Supabase接続テスト
npm run db:setup-supabase

# 環境変数確認
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
```

### ログレベル調整

```bash
# .envファイルで設定
LOG_LEVEL=debug  # error, warn, info, debug
```

### テストモード

```bash
# 安全なテストが可能
TEST_MODE=true
DEBUG=true
```

## 📊 監視・運用

### ヘルスチェック

```bash
# ローカル
curl http://localhost:3000/health

# VPS
curl http://your-server-ip:3000/health
```

### 統計情報取得

Discord内で以下のコマンドを実行：

```
/status        # Bot稼働状況
/account       # ユーザー統計
/credits       # クレジット使用状況
```

### 監視指標

- **レスポンス時間**: AI生成の平均実行時間
- **成功率**: 生成の成功/失敗率  
- **クレジット消費**: 日/月別の消費量
- **ユーザー活動**: アクティブユーザー数
- **エラー率**: システムエラーの発生頻度

## 🔒 セキュリティ

### 実装済みセキュリティ機能

- ✅ **入力検証**: 不正なプロンプト・データの検出
- ✅ **レート制限**: API乱用防止
- ✅ **暗号化**: 機密データの安全な保存
- ✅ **RLS**: Row Level Security（Supabase）
- ✅ **エラーハンドリング**: 安全なエラー処理
- ✅ **ログ管理**: セキュリティイベントの記録

### セキュリティベストプラクティス

1. **API キーの定期更新**
2. **アクセスログの監視**
3. **不正使用パターンの検出**
4. **定期的な依存関係更新**
5. **バックアップの暗号化**

## 🔄 アップデート・メンテナンス

### 定期メンテナンス

```bash
# 期限切れデータクリーンアップ
npm run cleanup

# 依存関係更新
npm update

# セキュリティ監査
npm audit
```

### バージョン管理

現在のバージョン: **v2.1.0 (note AI生成プラン対応版)**

#### 更新履歴

- **v2.1.0**: note AI生成プラン機能追加
- **v2.0.0**: AI生成機能追加
- **v1.5.0**: Web検索機能強化  
- **v1.0.0**: 基本チャット機能

## 🤝 コントリビューション

### 開発環境セットアップ

```bash
# リポジトリフォーク・クローン
git clone https://github.com/your-username/discord-groq-bot.git
cd discord-groq-bot

# 開発用依存関係インストール
npm install

# 開発サーバー起動
npm run dev
```

### コントリビューションガイドライン

1. Issueで機能提案・バグ報告
2. フォークしてfeatureブランチ作成
3. コードの品質確保：
   - ESLintルールに準拠
   - 適切なエラーハンドリング
   - コメント・ドキュメント追加
4. プルリクエスト作成

## 📞 サポート

### 問い合わせ方法

- 🐛 **バグ報告**: GitHub Issues
- 💡 **機能提案**: GitHub Discussions  
- ❓ **使い方質問**: Discord サーバー
- 🚨 **緊急事態**: 直接連絡

### サポート範囲

- ✅ セットアップ支援
- ✅ 設定の最適化
- ✅ トラブルシューティング
- ✅ 機能の使い方説明
- ✅ カスタマイズ相談

## 📄 ライセンス

MIT License - 詳細は [LICENSE](LICENSE) ファイルを参照

## 🙏 謝辞

- **Discord.js** - 優秀なDiscord APIライブラリ
- **Groq** - 高速なAI推論プラットフォーム
- **Eden.AI** - 統合AI APIプラットフォーム
- **Supabase** - 使いやすいBaaS
- **note** - クリエイター支援プラットフォーム

---

**Developed with ❤️ by Nako**

📧 お問い合わせ: admin@example.com  
🌐 公式サイト: https://your-website.com  
📱 Discord サーバー: https://discord.gg/your-server

---

## 🔗 関連リンク

- [note AI生成プラン](https://note.com/your-plan-url)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Groq Console](https://console.groq.com/)
- [Eden.AI Platform](https://app.edenai.run/)
- [Supabase Dashboard](https://supabase.com/)

**最終更新**: 2024年12月 | **バージョン**: 2.1.0