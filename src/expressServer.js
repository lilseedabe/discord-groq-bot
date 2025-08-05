// src/expressServer.js - セキュア認証フォーム
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const { encrypt, decrypt } = require('./utils');
const { TwitterApi } = require('twitter-api-v2');

const BASE_URL = process.env.BASE_URL;

const app = express();

// 強化されたセキュリティ設定
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    crossOriginEmbedderPolicy: false
}));

// HTTPS強制（本番環境）
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
            next();
        }
    });
}

app.use(express.json({ limit: '1kb' }));
app.use(express.urlencoded({ extended: true, limit: '1kb' }));

// より厳しいレート制限
const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 3, // より厳しく制限
    message: {
        error: 'Too many authentication attempts. Please try again in 15 minutes.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/auth', authLimit);

const secureSetupSessions = new Map();

// セッションクリーンアップ
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of secureSetupSessions.entries()) {
        if (now > session.expires) {
            secureSetupSessions.delete(sessionId);
        }
    }
}, 5 * 60 * 1000); // 5分ごとにクリーンアップ

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ルートエンドポイント
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Discord Groq Bot</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    max-width: 600px; 
                    margin: 50px auto; 
                    padding: 20px;
                    background-color: #f5f5f5;
                }
                .container {
                    background: white;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .status { color: #22c55e; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Discord Groq Bot</h1>
                <p class="status">✅ サーバーは正常に動作中です</p>
                <p>このサイトはDiscord BotのTwitter認証専用です。</p>
                <p>認証リンクはDiscord Bot経由でのみ利用可能です。</p>
            </div>
        </body>
        </html>
    `);
});

// 認証フォーム表示（セキュリティ強化版）
app.get('/auth/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // セッション検証
        if (!secureSetupSessions.has(sessionId)) {
            return res.status(404).send(getErrorPage('無効なセッション', 'Discord botで新しい設定リンクを取得してください。'));
        }
        
        const session = secureSetupSessions.get(sessionId);
        if (Date.now() > session.expires) {
            secureSetupSessions.delete(sessionId);
            return res.status(410).send(getErrorPage('セッション期限切れ', 'Discord botで新しい設定リンクを取得してください。'));
        }

        // セキュアなフォームHTML
        const formHtml = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Twitter API設定 - Discord Groq Bot</title>
    <meta name="robots" content="noindex, nofollow">
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            max-width: 500px; 
            margin: 50px auto; 
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #2d3748; 
            text-align: center; 
            margin-bottom: 30px;
            font-size: 24px;
        }
        .form-group { 
            margin-bottom: 20px; 
        }
        label { 
            display: block; 
            margin-bottom: 8px; 
            color: #4a5568;
            font-weight: 500;
        }
        input[type="password"] { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #e2e8f0; 
            border-radius: 8px; 
            font-size: 16px;
            transition: border-color 0.3s;
            box-sizing: border-box;
        }
        input[type="password"]:focus { 
            outline: none; 
            border-color: #667eea; 
        }
        button { 
            width: 100%; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 14px; 
            border: none; 
            border-radius: 8px; 
            font-size: 16px; 
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover { 
            transform: translateY(-2px); 
        }
        .security-note {
            background: #f7fafc;
            border-left: 4px solid #4299e1;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
            font-size: 14px;
            color: #2d3748;
        }
        .timer {
            text-align: center;
            color: #e53e3e;
            font-weight: bold;
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Twitter API設定</h1>
        
        <div class="security-note">
            <strong>セキュリティ情報:</strong><br>
            • このページは暗号化されて保護されています<br>
            • 入力された情報は安全に暗号化されて保存されます<br>
            • セッションは自動的に期限切れになります
        </div>
        
        <form method="POST" id="authForm">
            <div class="form-group">
                <label for="apiKey">API Key:</label>
                <input type="password" id="apiKey" name="apiKey" required autocomplete="off">
            </div>
            
            <div class="form-group">
                <label for="apiSecret">API Secret:</label>
                <input type="password" id="apiSecret" name="apiSecret" required autocomplete="off">
            </div>
            
            <div class="form-group">
                <label for="accessToken">Access Token:</label>
                <input type="password" id="accessToken" name="accessToken" required autocomplete="off">
            </div>
            
            <div class="form-group">
                <label for="accessSecret">Access Token Secret:</label>
                <input type="password" id="accessSecret" name="accessSecret" required autocomplete="off">
            </div>
            
            <button type="submit" id="submitBtn">🔒 安全に保存</button>
        </form>
        
        <div class="timer" id="timer"></div>
    </div>

    <script>
        // セッション期限タイマー
        const expiresAt = ${session.expires};
        const timerElement = document.getElementById('timer');
        
        function updateTimer() {
            const now = Date.now();
            const remaining = Math.max(0, expiresAt - now);
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            
            if (remaining > 0) {
                timerElement.textContent = \`⏰ セッション期限: \${minutes}:\${seconds.toString().padStart(2, '0')}\`;
            } else {
                timerElement.textContent = '❌ セッションが期限切れです';
                document.getElementById('authForm').style.display = 'none';
            }
        }
        
        updateTimer();
        setInterval(updateTimer, 1000);
        
        // フォーム送信時の処理
        document.getElementById('authForm').addEventListener('submit', function(e) {
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.textContent = '🔄 保存中...';
            submitBtn.disabled = true;
        });
    </script>
</body>
</html>
        `;
        
        res.send(formHtml);
    } catch (error) {
        console.error('Auth form error:', error);
        res.status(500).send(getErrorPage('サーバーエラー', 'しばらく時間を置いてから再試行してください。'));
    }
});

// 認証フォーム処理（セキュリティ強化版）
app.post('/auth/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { apiKey, apiSecret, accessToken, accessSecret } = req.body;
        
        // 基本的な入力検証
        if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
            return res.status(400).send(getErrorPage('入力エラー', 'すべてのフィールドを入力してください。'));
        }
        
        // セッション検証
        if (!secureSetupSessions.has(sessionId)) {
            return res.status(404).send(getErrorPage('無効なセッション', 'Discord botで新しい設定リンクを取得してください。'));
        }
        
        const session = secureSetupSessions.get(sessionId);
        if (Date.now() > session.expires) {
            secureSetupSessions.delete(sessionId);
            return res.status(410).send(getErrorPage('セッション期限切れ', 'Discord botで新しい設定リンクを取得してください。'));
        }
        
        // Twitter API認証テスト
        const testClient = new TwitterApi({
            appKey: apiKey,
            appSecret: apiSecret,
            accessToken: accessToken,
            accessSecret: accessSecret,
        });
        
        await testClient.v2.me(); // 認証テスト
        
        // データベースに保存
        const client = await pool.connect();
        try {
            // 既存のキーを無効化
            await client.query(
                'UPDATE user_api_keys SET is_valid = false WHERE user_id = $1',
                [session.userId]
            );
            
            // 新しいキーを保存
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
        
        // セッションクリーンアップ
        secureSetupSessions.delete(sessionId);
        
        // 成功ページ
        res.send(getSuccessPage());
        
    } catch (error) {
        console.error('Twitter API設定エラー:', error);
        
        if (error.code === 401 || error.code === 403) {
            res.status(400).send(getErrorPage('認証失敗', 'APIキーの検証に失敗しました。正しいキーを入力してください。'));
        } else {
            res.status(500).send(getErrorPage('サーバーエラー', 'しばらく時間を置いてから再試行してください。'));
        }
    }
});

// エラーページヘルパー
function getErrorPage(title, message) {
    return `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Discord Groq Bot</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            max-width: 500px; 
            margin: 100px auto; 
            padding: 20px;
            text-align: center;
            background-color: #f8f9fa;
        }
        .error-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .error-icon { font-size: 48px; margin-bottom: 20px; }
        h1 { color: #dc3545; margin-bottom: 20px; }
        p { color: #6c757d; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h1>${title}</h1>
        <p>${message}</p>
    </div>
</body>
</html>
    `;
}

// 成功ページヘルパー
function getSuccessPage() {
    return `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>設定完了 - Discord Groq Bot</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            max-width: 500px; 
            margin: 100px auto; 
            padding: 20px;
            text-align: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .success-container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .success-icon { font-size: 48px; margin-bottom: 20px; }
        h1 { color: #28a745; margin-bottom: 20px; }
        p { color: #6c757d; line-height: 1.6; }
        .note {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="success-container">
        <div class="success-icon">✅</div>
        <h1>設定完了！</h1>
        <p>Twitter APIキーの設定が正常に完了しました。</p>
        <p>このページを閉じて、Discordでボットをご利用ください。</p>
        <div class="note">
            <strong>注意:</strong> このページのURLは既に無効になっています。
        </div>
    </div>
</body>
</html>
    `;
}

function startServer(port) {
    app.listen(port, () => {
        console.log(`🌐 認証サーバーがポート ${port} で起動しました`);
        console.log(`🔒 セキュリティモード: ${process.env.NODE_ENV || 'development'}`);
    });
}

module.exports = {
    app,
    secureSetupSessions,
    startServer
};