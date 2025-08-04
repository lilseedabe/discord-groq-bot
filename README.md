# Discord Groq Bot 分割構成

## ディレクトリ構成例

```
discord-groq-bot/
├── src/
│   ├── discordBot.js         # Discord Bot本体（クライアント・コマンド・履歴管理）
│   ├── aiService.js          # Groq AI連携・プロンプト生成
│   ├── twitterService.js     # Twitter API連携・投稿・履歴
│   ├── db.js                 # PostgreSQLデータベース管理・ユーザー管理
│   ├── expressServer.js      # Expressサーバ・認証フォーム
│   └── utils.js              # 暗号化・復号化などユーティリティ
├── index.js                  # メインエントリーポイント（各サービス初期化・起動）
├── package.json
├── .env
└── README.md
```

## 起動方法

1. `.env` を設定
2. 必要な依存パッケージをインストール  
   `npm install`
3. サーバ・Bot起動  
   `node index.js`

## 機能分割のポイント

- 各サービスは `src/` 配下の個別ファイルで管理
- メイン処理は `index.js` で一括起動
- 保守性・拡張性を重視したシンプルな構成
