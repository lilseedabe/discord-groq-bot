// DB管理サービス
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                discord_id VARCHAR(20) UNIQUE NOT NULL,
                discord_username VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_api_keys (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                encrypted_api_key TEXT NOT NULL,
                encrypted_api_secret TEXT NOT NULL,
                encrypted_access_token TEXT,
                encrypted_access_secret TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used TIMESTAMP,
                is_valid BOOLEAN DEFAULT true
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS tweet_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                discord_channel_id VARCHAR(20),
                tweet_content TEXT,
                tweet_id VARCHAR(20),
                posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'success'
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS usage_tracking (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                month_year VARCHAR(7),
                tweet_count INTEGER DEFAULT 0,
                last_reset TIMESTAMP,
                UNIQUE(user_id, month_year)
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS scheduled_tweets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                tweet_content TEXT NOT NULL,
                scheduled_time TIMESTAMP NOT NULL,
                discord_channel_id VARCHAR(20),
                status VARCHAR(20) DEFAULT 'pending',
                tweet_id VARCHAR(20),
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                executed_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_status_time 
            ON scheduled_tweets(status, scheduled_time)
        `);
        console.log('✅ データベース初期化完了');
    } catch (error) {
        console.error('❌ データベース初期化エラー:', error);
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
        }
        return result.rows[0];
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    initializeDatabase,
    getOrCreateUser
};