// DB管理サービス（シンプル版）
const { Pool } = require('pg');

// Supabase接続設定
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20
});

async function initializeDatabase() {
    // データベース機能は将来の拡張用として接続テストのみ実行
    if (!process.env.DB_HOST || !process.env.DB_NAME) {
        console.log('ℹ️ データベース設定なし - メモリモードで動作');
        return;
    }

    try {
        const client = await pool.connect();
        console.log('✅ データベース接続確認完了');
        client.release();
    } catch (error) {
        console.error('❌ データベース接続エラー（メモリモードで継続）:', error.message);
    }
}

module.exports = {
    pool,
    initializeDatabase
};