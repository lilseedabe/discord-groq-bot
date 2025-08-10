// メインエントリーポイント
require('dotenv').config();

const { startBot } = require('./src/discordBot');
const { initializeDatabase } = require('./src/db');
const { startServer } = require('./src/expressServer');

const PORT = process.env.PORT || 3000;

// Discord Bot起動
console.log('🤖 Discord Groq Bot を起動中...');
startBot();

// データベース初期化（オプション）
if (process.env.DB_HOST && process.env.DB_NAME) {
    console.log('🗄️ データベース接続を確認中...');
    initializeDatabase();
} else {
    console.log('ℹ️ データベース設定なし - メモリモードで動作');
}

// Webサーバー起動
startServer(PORT);

console.log('✅ 全サービスの起動が完了しました！');