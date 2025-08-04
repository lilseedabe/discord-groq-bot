// メインエントリーポイント
require('dotenv').config();

const { startBot } = require('./src/discordBot');
const { initializeDatabase } = require('./src/db');
const { startServer } = require('./src/expressServer');

const PORT = process.env.PORT || 3000;

// DB初期化
initializeDatabase();

// Discord Bot起動
startBot();

// Expressサーバ起動
startServer(PORT);