// Twitterサービス（Discord ID型問題完全修正版）
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

// 🆕 Discord ID から DB内部ID を取得するヘルパー関数
async function getDbUserId(discordId, client) {
    console.log(`🔍 DB内部ID取得開始: Discord ID ${discordId}`);
    
    const result = await client.query(
        'SELECT id FROM users WHERE discord_id = $1',
        [discordId.toString()]
    );
    
    if (result.rows.length === 0) {
        console.log(`❌ ユーザーが見つかりません: Discord ID ${discordId}`);
        throw new Error('ユーザーが見つかりません。最初に /setup-twitter でAPIキーを設定してください。');
    }
    
    const dbUserId = result.rows[0].id;
    console.log(`✅ DB内部ID取得成功: Discord ID ${discordId} → DB ID ${dbUserId}`);
    
    return dbUserId;
}

// 🔧 修正: getUserTwitterCredentials
async function getUserTwitterCredentials(userId) {
    console.log(`🔑 Twitter認証情報取得開始: Discord ID ${userId}`);
    
    const client = await pool.connect();
    try {
        // Discord IDからDB内部IDを取得
        const dbUserId = await getDbUserId(userId, client);
        
        // DB内部IDを使ってAPIキーを取得
        const result = await client.query(
            'SELECT * FROM user_api_keys WHERE user_id = $1 AND is_valid = true',
            [dbUserId]  // 🔧 DB内部ID（integer）を使用
        );
        
        if (result.rows.length === 0) {
            console.log(`❌ 有効なAPIキーが見つかりません: DB User ID ${dbUserId}`);
            return null;
        }
        
        const creds = result.rows[0];
        console.log(`✅ Twitter認証情報取得成功: DB User ID ${dbUserId}`);
        
        return {
            apiKey: decrypt(creds.encrypted_api_key),
            apiSecret: decrypt(creds.encrypted_api_secret),
            accessToken: creds.encrypted_access_token ? decrypt(creds.encrypted_access_token) : null,
            accessSecret: creds.encrypted_access_secret ? decrypt(creds.encrypted_access_secret) : null
        };
    } catch (error) {
        console.error('❌ Twitter認証情報取得エラー:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 🔧 修正: checkUsageLimit
async function checkUsageLimit(userId, limit = 50) {
    console.log(`📊 使用制限チェック開始: Discord ID ${userId}, 制限 ${limit}`);
    
    const client = await pool.connect();
    try {
        // Discord IDからDB内部IDを取得
        const dbUserId = await getDbUserId(userId, client);
        
        const currentMonth = new Date().toISOString().slice(0, 7);
        console.log(`📅 対象月: ${currentMonth}`);
        
        // DB内部IDを使って使用状況を取得
        let result = await client.query(
            'SELECT * FROM usage_tracking WHERE user_id = $1 AND month_year = $2',
            [dbUserId, currentMonth]  // 🔧 DB内部ID（integer）を使用
        );
        
        if (result.rows.length === 0) {
            console.log(`📝 新しい使用記録を作成: DB User ID ${dbUserId}`);
            await client.query(
                'INSERT INTO usage_tracking (user_id, month_year, tweet_count) VALUES ($1, $2, 0)',
                [dbUserId, currentMonth]  // 🔧 DB内部ID（integer）を使用
            );
            return { count: 0, remaining: limit };
        }
        
        const usage = result.rows[0];
        const remaining = Math.max(0, limit - usage.tweet_count);
        
        console.log(`✅ 使用制限チェック完了: 使用済み ${usage.tweet_count}, 残り ${remaining}`);
        
        return {
            count: usage.tweet_count,
            remaining: remaining
        };
    } catch (error) {
        console.error('❌ 使用制限チェックエラー:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 🔧 修正: updateUsageCount
async function updateUsageCount(userId) {
    console.log(`🔄 使用回数更新開始: Discord ID ${userId}`);
    
    const client = await pool.connect();
    try {
        // Discord IDからDB内部IDを取得
        const dbUserId = await getDbUserId(userId, client);
        
        const currentMonth = new Date().toISOString().slice(0, 7);
        
        await client.query(
            `INSERT INTO usage_tracking (user_id, month_year, tweet_count) 
             VALUES ($1, $2, 1) 
             ON CONFLICT (user_id, month_year) 
             DO UPDATE SET tweet_count = usage_tracking.tweet_count + 1`,
            [dbUserId, currentMonth]  // 🔧 DB内部ID（integer）を使用
        );
        
        console.log(`✅ 使用回数更新完了: DB User ID ${dbUserId}`);
    } catch (error) {
        console.error('❌ 使用回数更新エラー:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 🔧 修正: postTweet
async function postTweet(userId, content, channelId) {
    console.log(`🐦 ツイート投稿開始: Discord ID ${userId}, 内容 "${content.substring(0, 30)}..."`);
    
    try {
        // Twitter認証情報を取得
        const credentials = await getUserTwitterCredentials(userId);
        if (!credentials) {
            throw new Error('Twitter APIキーが設定されていません。/setup-twitter コマンドで設定してください。');
        }
        
        // 使用制限をチェック
        const usage = await checkUsageLimit(userId);
        if (usage.remaining <= 0) {
            throw new Error(`今月の投稿制限（50回）に達しています。来月まで待つか、別のアカウントをご利用ください。現在の使用回数: ${usage.count}`);
        }
        
        // Twitterクライアントを作成
        const twitterClient = new TwitterApi({
            appKey: credentials.apiKey,
            appSecret: credentials.apiSecret,
            accessToken: credentials.accessToken,
            accessSecret: credentials.accessSecret,
        });
        
        // ツイートを投稿
        console.log(`📤 Twitter投稿実行中...`);
        const tweet = await twitterClient.v2.tweet(content);
        console.log(`✅ Twitter投稿成功: Tweet ID ${tweet.data.id}`);
        
        // 使用回数を更新
        await updateUsageCount(userId);
        
        // 成功履歴を記録
        await recordTweetHistory(userId, channelId, content, tweet.data.id, 'success');
        
        const result = {
            success: true,
            tweetId: tweet.data.id,
            tweetUrl: `https://twitter.com/i/web/status/${tweet.data.id}`,
            remaining: usage.remaining - 1
        };
        
        console.log(`🎉 ツイート投稿完了: ${result.tweetUrl}, 残り ${result.remaining}回`);
        return result;
        
    } catch (error) {
        console.error('❌ Twitter投稿エラー:', error);
        
        // エラー履歴を記録
        try {
            await recordTweetHistory(userId, channelId, content, null, 'failed');
        } catch (historyError) {
            console.error('❌ エラー履歴記録失敗:', historyError);
        }
        
        throw error;
    }
}

// 🆕 ツイート履歴記録のヘルパー関数
async function recordTweetHistory(userId, channelId, content, tweetId, status) {
    console.log(`📝 ツイート履歴記録: Discord ID ${userId}, ステータス ${status}`);
    
    const client = await pool.connect();
    try {
        // Discord IDからDB内部IDを取得
        const dbUserId = await getDbUserId(userId, client);
        
        if (tweetId) {
            await client.query(
                'INSERT INTO tweet_history (user_id, discord_channel_id, tweet_content, tweet_id, status) VALUES ($1, $2, $3, $4, $5)',
                [dbUserId, channelId, content, tweetId, status]  // 🔧 DB内部ID（integer）を使用
            );
        } else {
            await client.query(
                'INSERT INTO tweet_history (user_id, discord_channel_id, tweet_content, status) VALUES ($1, $2, $3, $4)',
                [dbUserId, channelId, content, status]  // 🔧 DB内部ID（integer）を使用
            );
        }
        
        console.log(`✅ ツイート履歴記録完了: DB User ID ${dbUserId}`);
    } catch (error) {
        console.error('❌ ツイート履歴記録エラー:', error);
        // 履歴記録エラーはメイン処理に影響しないようにする
    } finally {
        client.release();
    }
}

// 🆕 追加のヘルパー関数（将来の機能用）
async function getTwitterUsage(userId) {
    console.log(`📊 Twitter使用量取得: Discord ID ${userId}`);
    return await checkUsageLimit(userId);
}

async function getTwitterHistory(userId, limit = 10) {
    console.log(`📜 Twitter履歴取得: Discord ID ${userId}, 件数 ${limit}`);
    
    const client = await pool.connect();
    try {
        // Discord IDからDB内部IDを取得
        const dbUserId = await getDbUserId(userId, client);
        
        const result = await client.query(
            'SELECT * FROM tweet_history WHERE user_id = $1 ORDER BY posted_at DESC LIMIT $2',
            [dbUserId, limit]  // 🔧 DB内部ID（integer）を使用
        );
        
        console.log(`✅ Twitter履歴取得完了: ${result.rows.length}件`);
        return result.rows;
    } catch (error) {
        console.error('❌ Twitter履歴取得エラー:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    getUserTwitterCredentials,
    checkUsageLimit,
    updateUsageCount,
    postTweet,
    getTwitterUsage,
    getTwitterHistory,
    recordTweetHistory
};
