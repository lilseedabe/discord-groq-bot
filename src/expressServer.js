// Expressサーバ管理
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const { encrypt, decrypt } = require('./utils');
const { TwitterApi } = require('twitter-api-v2');

const BASE_URL = process.env.BASE_URL;

const app = express();
app.use(helmet());
app.get('/', (req, res) => {
    res.send('Discord Groq Bot is running.');
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'アクセス制限に達しました。しばらく時間をおいてから再度お試しください。'
});

app.use('/auth', authLimit);

const secureSetupSessions = new Map();

// 認証フォーム表示
app.get('/auth/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!secureSetupSessions.has(sessionId)) {
        return res.status(404).send('無効なセッションです。Discord botで新しい設定リンクを取得してください。');
    }
    const session = secureSetupSessions.get(sessionId);
    if (Date.now() > session.expires) {
        secureSetupSessions.delete(sessionId);
        return res.status(410).send('セッションが期限切れです。Discord botで新しい設定リンクを取得してください。');
    }
    res.send(`
        <html>
        <head><title>Twitter APIキー設定</title></head>
        <body>
            <h2>Twitter APIキー設定フォーム</h2>
            <form method="POST">
                <label>API Key: <input type="text" name="apiKey" required></label><br>
                <label>API Secret: <input type="text" name="apiSecret" required></label><br>
                <label>Access Token: <input type="text" name="accessToken" required></label><br>
                <label>Access Token Secret: <input type="text" name="accessSecret" required></label><br>
                <button type="submit">保存</button>
            </form>
        </body>
        </html>
    `);
});

// 認証フォーム処理
app.post('/auth/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { apiKey, apiSecret, accessToken, accessSecret } = req.body;
    if (!secureSetupSessions.has(sessionId)) {
        return res.status(404).send('無効なセッションです。');
    }
    const session = secureSetupSessions.get(sessionId);
    if (Date.now() > session.expires) {
        secureSetupSessions.delete(sessionId);
        return res.status(410).send('セッションが期限切れです。');
    }
    try {
        const testClient = new TwitterApi({
            appKey: apiKey,
            appSecret: apiSecret,
            accessToken: accessToken,
            accessSecret: accessSecret,
        });
        await testClient.v2.me();
        const client = await pool.connect();
        try {
            await client.query(
                'UPDATE user_api_keys SET is_valid = false WHERE user_id = $1',
                [session.userId]
            );
            await client.query(
                `INSERT INTO user_api_keys 
                 (user_id, encrypted_api_key, encrypted_api_secret, encrypted_access_token, encrypted_access_secret) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    session.userId,
                    encrypt(apiKey),
                    encrypt(apiSecret),
                    encrypt(accessToken),
                    encrypt(accessSecret)
                ]
            );
        } finally {
            client.release();
        }
        secureSetupSessions.delete(sessionId);
        res.send('設定が完了しました！');
    } catch (error) {
        console.error('Twitter API設定エラー:', error);
        res.status(400).send('APIキーの検証に失敗しました。正しいキーを入力してください。');
    }
});

function startServer(port) {
    app.listen(port, () => {
        console.log(`🌐 認証サーバーがポート ${port} で起動しました`);
    });
}

module.exports = {
    app,
    secureSetupSessions,
    startServer
};