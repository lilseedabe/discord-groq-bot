// メインエントリーポイント（テーブルリセット対応）
require('dotenv').config();

const { startBot } = require('./src/discordBot');
const { initializeDatabase, resetTables } = require('./src/db');
const { startServer } = require('./src/expressServer');

const PORT = process.env.PORT || 3000;

async function startApplication() {
    try {
        console.log('🚀 アプリケーション開始...');
        
        // 🔧 既存テーブルをリセット（初回のみ）
        await resetTables();
        
        // DB初期化（正しいスキーマで再作成）
        await initializeDatabase();
        
        // Discord ボット起動
        startBot();
        
        // Expressサーバー起動
        startServer(PORT);
        
        console.log('✅ すべてのサービスが正常に起動しました');
    } catch (error) {
        console.error('❌ アプリケーション起動エラー:', error);
        process.exit(1);
    }
}

startApplication();
