// 拡張版DB管理サービス
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
    const client = await pool.connect();
    try {
        // ユーザーテーブル
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                discord_id VARCHAR(20) UNIQUE NOT NULL,
                discord_username VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
        `);

        // 会話履歴テーブル
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                discord_id VARCHAR(20) NOT NULL,
                message_role VARCHAR(10) NOT NULL,
                message_content TEXT NOT NULL,
                ai_model VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                session_id UUID DEFAULT gen_random_uuid()
            )
        `);

        // 会話統計テーブル
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversation_stats (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                discord_id VARCHAR(20) NOT NULL,
                total_messages INTEGER DEFAULT 0,
                total_ai_responses INTEGER DEFAULT 0,
                favorite_model VARCHAR(50),
                last_conversation_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // インデックス
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_discord_id ON conversations(discord_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_conversation_stats_discord_id ON conversation_stats(discord_id)`);

        console.log('✅ 拡張版データベース初期化完了');
    } catch (error) {
        console.error('❌ データベース初期化エラー:', error);
    } finally {
        client.release();
    }
}

// 会話履歴をデータベースに保存
async function saveConversation(discordId, userMessage, aiResponse, model) {
    const client = await pool.connect();
    try {
        // ユーザー情報取得
        const user = await getOrCreateUser(discordId, null);
        
        // ユーザーメッセージ保存
        await client.query(`
            INSERT INTO conversations (user_id, discord_id, message_role, message_content, ai_model)
            VALUES ($1, $2, 'user', $3, $4)
        `, [user.id, discordId, userMessage, model]);

        // AI応答保存
        await client.query(`
            INSERT INTO conversations (user_id, discord_id, message_role, message_content, ai_model)
            VALUES ($1, $2, 'assistant', $3, $4)
        `, [user.id, discordId, aiResponse, model]);

        // 統計情報更新
        await updateConversationStats(discordId, model);

        console.log(`💾 会話履歴をデータベースに保存: ${discordId}`);
    } catch (error) {
        console.error('❌ 会話履歴保存エラー:', error);
    } finally {
        client.release();
    }
}

// データベースから会話履歴を取得
async function getConversationHistory(discordId, limit = 10) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT message_role, message_content, ai_model, created_at
            FROM conversations
            WHERE discord_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [discordId, limit]);

        return result.rows.reverse(); // 古い順に並び替え
    } catch (error) {
        console.error('❌ 会話履歴取得エラー:', error);
        return [];
    } finally {
        client.release();
    }
}

// 統計情報更新
async function updateConversationStats(discordId, model) {
    const client = await pool.connect();
    try {
        // 既存の統計があるかチェック
        const existing = await client.query(`
            SELECT id FROM conversation_stats WHERE discord_id = $1
        `, [discordId]);

        if (existing.rows.length === 0) {
            // 新規作成
            await client.query(`
                INSERT INTO conversation_stats (discord_id, total_messages, total_ai_responses, favorite_model, last_conversation_at)
                VALUES ($1, 1, 1, $2, CURRENT_TIMESTAMP)
            `, [discordId, model]);
        } else {
            // 更新
            await client.query(`
                UPDATE conversation_stats 
                SET total_messages = total_messages + 1,
                    total_ai_responses = total_ai_responses + 1,
                    favorite_model = $2,
                    last_conversation_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE discord_id = $1
            `, [discordId, model]);
        }
    } catch (error) {
        console.error('❌ 統計情報更新エラー:', error);
    } finally {
        client.release();
    }
}

// ユーザー統計取得
async function getUserStats(discordId) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                u.created_at as user_created_at,
                u.updated_at as user_updated_at,
                cs.total_messages,
                cs.total_ai_responses,
                cs.favorite_model,
                cs.last_conversation_at
            FROM users u
            LEFT JOIN conversation_stats cs ON u.discord_id = cs.discord_id
            WHERE u.discord_id = $1
        `, [discordId]);

        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ ユーザー統計取得エラー:', error);
        return null;
    } finally {
        client.release();
    }
}

// 古い会話履歴を削除（プライバシー保護のため）
async function cleanupOldConversations(daysOld = 30) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            DELETE FROM conversations 
            WHERE created_at < NOW() - INTERVAL '${daysOld} days'
        `);
        
        console.log(`🧹 ${result.rowCount}件の古い会話履歴を削除しました`);
        return result.rowCount;
    } catch (error) {
        console.error('❌ 会話履歴クリーンアップエラー:', error);
        return 0;
    } finally {
        client.release();
    }
}

async function getOrCreateUser(discordId, username) {
    const client = await pool.connect();
    try {
        let result = await client.query('SELECT * FROM users WHERE discord_id = $1', [discordId]);
        if (result.rows.length === 0) {
            result = await client.query(
                'INSERT INTO users (discord_id, discord_username) VALUES ($1, $2) RETURNING *',
                [discordId, username]
            );
        } else if (username) {
            // ユーザー名の更新（必要に応じて）
            await client.query(
                'UPDATE users SET discord_username = $2, updated_at = CURRENT_TIMESTAMP WHERE discord_id = $1',
                [discordId, username]
            );
        }
        return result.rows[0];
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    initializeDatabase,
    getOrCreateUser,
    getUserStats,
    saveConversation,
    getConversationHistory,
    updateConversationStats,
    cleanupOldConversations
};
