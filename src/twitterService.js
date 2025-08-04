// Twitterサービス
const { TwitterApi } = require('twitter-api-v2');
const { Pool } = require('pg');
const { encrypt, decrypt } = require('./utils');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function getUserTwitterCredentials(userId) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM user_api_keys WHERE user_id = $1 AND is_valid = true',
            [userId]
        );
        if (result.rows.length === 0) return null;
        const creds = result.rows[0];
        return {
            apiKey: decrypt(creds.encrypted_api_key),
            apiSecret: decrypt(creds.encrypted_api_secret),
            accessToken: creds.encrypted_access_token ? decrypt(creds.encrypted_access_token) : null,
            accessSecret: creds.encrypted_access_secret ? decrypt(creds.encrypted_access_secret) : null
        };
    } finally {
        client.release();
    }
}

async function checkUsageLimit(userId, limit = 50) {
    const client = await pool.connect();
    try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        let result = await client.query(
            'SELECT * FROM usage_tracking WHERE user_id = $1 AND month_year = $2',
            [userId, currentMonth]
        );
        if (result.rows.length === 0) {
            await client.query(
                'INSERT INTO usage_tracking (user_id, month_year, tweet_count) VALUES ($1, $2, 0)',
                [userId, currentMonth]
            );
            return { count: 0, remaining: limit };
        }
        const usage = result.rows[0];
        return {
            count: usage.tweet_count,
            remaining: Math.max(0, limit - usage.tweet_count)
        };
    } finally {
        client.release();
    }
}

async function updateUsageCount(userId) {
    const client = await pool.connect();
    try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        await client.query(
            `INSERT INTO usage_tracking (user_id, month_year, tweet_count) 
             VALUES ($1, $2, 1) 
             ON CONFLICT (user_id, month_year) 
             DO UPDATE SET tweet_count = usage_tracking.tweet_count + 1`,
            [userId, currentMonth]
        );
    } finally {
        client.release();
    }
}

async function postTweet(userId, content, channelId) {
    try {
        const credentials = await getUserTwitterCredentials(userId);
        if (!credentials) {
            throw new Error('Twitter APIキーが設定されていません。/setup-twitter コマンドで設定してください。');
        }
        const usage = await checkUsageLimit(userId);
        if (usage.remaining <= 0) {
            throw new Error(`今月の投稿制限（${usage.remaining}回）に達しています。来月まで待つか、別のアカウントをご利用ください。`);
        }
        const twitterClient = new TwitterApi({
            appKey: credentials.apiKey,
            appSecret: credentials.apiSecret,
            accessToken: credentials.accessToken,
            accessSecret: credentials.accessSecret,
        });
        const tweet = await twitterClient.v2.tweet(content);
        await updateUsageCount(userId);

        // 履歴記録
        const client = await pool.connect();
        try {
            await client.query(
                'INSERT INTO tweet_history (user_id, discord_channel_id, tweet_content, tweet_id, status) VALUES ($1, $2, $3, $4, $5)',
                [userId, channelId, content, tweet.data.id, 'success']
            );
        } finally {
            client.release();
        }
        return {
            success: true,
            tweetId: tweet.data.id,
            tweetUrl: `https://twitter.com/i/web/status/${tweet.data.id}`,
            remaining: usage.remaining - 1
        };
    } catch (error) {
        console.error('Twitter投稿エラー:', error);
        // エラー履歴記録
        const client = await pool.connect();
        try {
            await client.query(
                'INSERT INTO tweet_history (user_id, discord_channel_id, tweet_content, status) VALUES ($1, $2, $3, $4)',
                [userId, channelId, content, 'failed']
            );
        } finally {
            client.release();
        }
        throw error;
    }
}

module.exports = {
    getUserTwitterCredentials,
    checkUsageLimit,
    updateUsageCount,
    postTweet
};