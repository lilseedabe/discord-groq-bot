// Expressサーバ管理（構文エラー修正版）
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const { encrypt, decrypt } = require('./utils');
const { TwitterApi } = require('twitter-api-v2');

const BASE_URL = process.env.BASE_URL;

const app = express();

// 🔧 Trust proxy 設定 - Renderなどのプロキシ環境で必要
app.set('trust proxy', 1);

// 🔒 セキュリティ強化 - Chrome警告解決
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            formAction: ["'self'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// 🌐 HTTPS強制（本番環境）
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

// 🚦 レート制限（trust proxy対応）
const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 5, // 最大5回
    message: {
        error: 'アクセス制限に達しました。しばらく時間をおいてから再度お試しください。',
        retryAfter: '15分後'
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true,
    keyGenerator: (req) => {
        const ip = req.ip || 
                  req.connection.remoteAddress || 
                  req.socket.remoteAddress ||
                  (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                  'unknown';
        return ip;
    }
});

app.use('/auth', authLimit);

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime()
    });
});

// ルートページ
app.get('/', (req, res) => {
    const envMode = process.env.NODE_ENV || 'development';
    res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Discord Groq Bot</title>
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    max-width: 600px; 
                    margin: 50px auto; 
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    color: white;
                }
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(10px);
                    padding: 40px;
                    border-radius: 16px;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    text-align: center;
                }
                h1 { margin-bottom: 20px; font-size: 2.5em; }
                .status { 
                    background: rgba(34, 197, 94, 0.2);
                    padding: 15px;
                    border-radius: 8px;
                    margin: 20px 0;
                    border: 1px solid rgba(34, 197, 94, 0.3);
                }
                .info {
                    background: rgba(59, 130, 246, 0.2);
                    padding: 15px;
                    border-radius: 8px;
                    border: 1px solid rgba(59, 130, 246, 0.3);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 Discord Groq Bot</h1>
                <div class="status">
                    <h3>✅ サーバー正常稼働中</h3>
                    <p>Environment: ${envMode}</p>
                </div>
                <div class="info">
                    <p>このサイトはDiscord BotのTwitter認証専用です。</p>
                    <p>認証リンクはDiscord Bot経由でのみ利用可能です。</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

const secureSetupSessions = new Map();

// セッション自動クリーンアップ
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [sessionId, session] of secureSetupSessions.entries()) {
        if (now > session.expires) {
            secureSetupSessions.delete(sessionId);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        console.log(`🧹 期限切れセッション ${cleanedCount}件 をクリーンアップしました`);
    }
}, 5 * 60 * 1000); // 5分ごと

// 認証フォーム表示（構文エラー修正版）
app.get('/auth/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!secureSetupSessions.has(sessionId)) {
            return res.status(404).send(getErrorPage(
                '無効なセッション', 
                'Discord botで新しい設定リンクを取得してください。'
            ));
        }
        
        const session = secureSetupSessions.get(sessionId);
        if (Date.now() > session.expires) {
            secureSetupSessions.delete(sessionId);
            return res.status(410).send(getErrorPage(
                'セッション期限切れ', 
                'Discord botで新しい設定リンクを取得してください。'
            ));
        }
        
        // 🎨 修正されたフォーム（構文エラー解消）
        const formHtml = createAuthFormHtml(session.expires);
        res.send(formHtml);
        
    } catch (error) {
        console.error('Auth form error:', error);
        res.status(500).send(getErrorPage(
            'サーバーエラー', 
            'しばらく時間を置いてから再試行してください。'
        ));
    }
});

// フォームHTML生成関数（構文エラー回避）
function createAuthFormHtml(expiresAt) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Twitter API設定 - Discord Groq Bot</title>
    <meta name="robots" content="noindex, nofollow">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            max-width: 500px; 
            margin: 30px auto; 
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #2d3748; 
            text-align: center; 
            margin-bottom: 30px;
            font-size: 28px;
            font-weight: 700;
        }
        .form-group { 
            margin-bottom: 24px; 
        }
        label { 
            display: block; 
            margin-bottom: 8px; 
            color: #4a5568;
            font-weight: 600;
            font-size: 14px;
        }
        input[type="password"] { 
            width: 100%; 
            padding: 14px 16px; 
            border: 2px solid #e2e8f0; 
            border-radius: 12px; 
            font-size: 16px;
            font-family: 'SF Mono', Monaco, monospace;
            transition: all 0.2s ease;
            box-sizing: border-box;
            background: #f7fafc;
        }
        input[type="password"]:focus { 
            outline: none; 
            border-color: #667eea; 
            background: white;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        button { 
            width: 100%; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 16px; 
            border: none; 
            border-radius: 12px; 
            font-size: 16px; 
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-top: 10px;
        }
        button:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .security-note {
            background: linear-gradient(135deg, #f0f8ff 0%, #e6f3ff 100%);
            border-left: 4px solid #4299e1;
            padding: 20px;
            margin: 25px 0;
            border-radius: 8px;
            font-size: 14px;
            color: #2d3748;
            line-height: 1.6;
        }
        .timer {
            text-align: center;
            color: #e53e3e;
            font-weight: 600;
            margin-top: 20px;
            padding: 12px;
            background: #fed7d7;
            border-radius: 8px;
            font-size: 14px;
        }
        .help-text {
            font-size: 12px;
            color: #718096;
            margin-top: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Twitter API設定</h1>
        
        <div class="security-note">
            <strong>🛡️ セキュリティ保護:</strong><br>
            • このページはHTTPS暗号化で保護されています<br>
            • 入力された情報は安全に暗号化されて保存されます<br>
            • セッションは自動的に期限切れになります<br>
            • IPアドレスベースでアクセス制限されています
        </div>
        
        <form method="POST" id="authForm">
            <div class="form-group">
                <label for="apiKey">API Key (Consumer Key):</label>
                <input type="password" id="apiKey" name="apiKey" required autocomplete="off" 
                       placeholder="例: xvz1evFS4wEEPTGEFPHBog">
                <div class="help-text">Twitter Developer Portal から取得</div>
            </div>
            
            <div class="form-group">
                <label for="apiSecret">API Secret (Consumer Secret):</label>
                <input type="password" id="apiSecret" name="apiSecret" required autocomplete="off"
                       placeholder="例: L8qq9PZyRg6ieKGEKhZolGC0vJWLw8iEJ88DRdyOg">
                <div class="help-text">Twitter Developer Portal から取得</div>
            </div>
            
            <div class="form-group">
                <label for="accessToken">Access Token:</label>
                <input type="password" id="accessToken" name="accessToken" required autocomplete="off"
                       placeholder="例: 16253605-2YxK7dufYqXb2fE4XgVhmXT">
                <div class="help-text">アプリの認証が必要</div>
            </div>
            
            <div class="form-group">
                <label for="accessSecret">Access Token Secret:</label>
                <input type="password" id="accessSecret" name="accessSecret" required autocomplete="off"
                       placeholder="例: GDdGIXNw1Ec43MYptXJ0dNTpTkxGf8JmAU">
                <div class="help-text">アクセストークンと一緒に発行</div>
            </div>
            
            <button type="submit" id="submitBtn">🔒 安全に保存して設定完了</button>
        </form>
        
        <div class="timer" id="timer"></div>
    </div>

    <script>
        // セッション期限タイマー
        var expiresAt = ${expiresAt};
        var timerElement = document.getElementById('timer');
        
        function updateTimer() {
            var now = Date.now();
            var remaining = Math.max(0, expiresAt - now);
            var minutes = Math.floor(remaining / 60000);
            var seconds = Math.floor((remaining % 60000) / 1000);
            
            if (remaining > 0) {
                timerElement.textContent = '⏰ セッション残り時間: ' + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
                if (remaining < 60000) {
                    timerElement.style.background = '#fed7d7';
                    timerElement.style.color = '#c53030';
                }
            } else {
                timerElement.textContent = '❌ セッションが期限切れです - ページを更新してください';
                timerElement.style.background = '#feb2b2';
                document.getElementById('authForm').style.display = 'none';
            }
        }
        
        updateTimer();
        setInterval(updateTimer, 1000);
        
        // フォーム送信時の処理
        document.getElementById('authForm').addEventListener('submit', function(e) {
            var submitBtn = document.getElementById('submitBtn');
            submitBtn.innerHTML = '🔄 認証中... しばらくお待ちください';
            submitBtn.disabled = true;
            
            var inputs = document.querySelectorAll('input');
            for (var i = 0; i < inputs.length; i++) {
                inputs[i].disabled = true;
            }
        });
    </script>
</body>
</html>`;
}

// 認証フォーム処理
app.post('/auth/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { apiKey, apiSecret, accessToken, accessSecret } = req.body;
        
        // 基本的な入力検証
        if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
            return res.status(400).send(getErrorPage(
                '入力エラー', 
                'すべてのフィールドを入力してください。'
            ));
        }
        
        // セッション検証
        if (!secureSetupSessions.has(sessionId)) {
            return res.status(404).send(getErrorPage(
                '無効なセッション', 
                'Discord botで新しい設定リンクを取得してください。'
            ));
        }
        
        const session = secureSetupSessions.get(sessionId);
        if (Date.now() > session.expires) {
            secureSetupSessions.delete(sessionId);
            return res.status(410).send(getErrorPage(
                'セッション期限切れ', 
                'Discord botで新しい設定リンクを取得してください。'
            ));
        }
        
        // Twitter API認証テスト
        const testClient = new TwitterApi({
            appKey: apiKey.trim(),
            appSecret: apiSecret.trim(),
            accessToken: accessToken.trim(),
            accessSecret: accessSecret.trim(),
        });
        
        const user = await testClient.v2.me();
        console.log(`✅ Twitter API認証成功: @${user.data.username} (${session.userId})`);
        
        // データベースに保存
        const client = await pool.connect();
        try {
            // 既存のキーを無効化
            await client.query(
                'UPDATE user_api_keys SET is_valid = false WHERE user_id = $1',
                [session.userId]
            );
            
            // 新しいキーを保存（🔧 構文エラー修正）
            await client.query(
                'INSERT INTO user_api_keys (user_id, encrypted_api_key, encrypted_api_secret, encrypted_access_token, encrypted_access_secret) VALUES ($1, $2, $3, $4, $5)',
                [
                    session.userId,
                    encrypt(apiKey.trim()),
                    encrypt(apiSecret.trim()),
                    encrypt(accessToken.trim()),
                    encrypt(accessSecret.trim())
                ]
            );
        } finally {
            client.release();
        }
        
        // セッションクリーンアップ
        secureSetupSessions.delete(sessionId);
        
        // 成功ページ
        res.send(getSuccessPage(user.data.username));
        
    } catch (error) {
        console.error('Twitter API設定エラー:', error);
        
        if (error.code === 401 || error.code === 403) {
            res.status(400).send(getErrorPage(
                '認証失敗', 
                'Twitter APIキーの検証に失敗しました。正しいキーを入力してください。'
            ));
        } else {
            res.status(500).send(getErrorPage(
                'サーバーエラー', 
                'しばらく時間を置いてから再試行してください。'
            ));
        }
    }
});

// エラーページヘルパー
function getErrorPage(title, message) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Discord Groq Bot</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 50px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .error-container {
            background: white;
            padding: 50px;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .error-icon { 
            font-size: 64px; 
            margin-bottom: 24px; 
        }
        h1 { 
            color: #dc3545; 
            margin-bottom: 20px; 
            font-size: 24px;
        }
        p { 
            color: #6c757d; 
            line-height: 1.6; 
            margin-bottom: 30px;
        }
        .back-link {
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
            padding: 12px 24px;
            border: 2px solid #667eea;
            border-radius: 8px;
            display: inline-block;
            transition: all 0.2s ease;
        }
        .back-link:hover {
            background: #667eea;
            color: white;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <a href="javascript:history.back()" class="back-link">戻る</a>
    </div>
</body>
</html>`;
}

// 成功ページヘルパー
function getSuccessPage(username = '') {
    const usernameDisplay = username ? `<div class="username">@${username} として認証されました</div>` : '';
    
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>設定完了 - Discord Groq Bot</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 50px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .success-container {
            background: white;
            padding: 50px;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .success-icon { 
            font-size: 64px; 
            margin-bottom: 24px; 
            animation: bounce 1s ease-in-out;
        }
        @keyframes bounce {
            0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-10px); }
            60% { transform: translateY(-5px); }
        }
        h1 { 
            color: #28a745; 
            margin-bottom: 20px; 
            font-size: 28px;
        }
        p { 
            color: #6c757d; 
            line-height: 1.6; 
            margin-bottom: 20px;
        }
        .note {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-top: 30px;
            font-size: 14px;
            border-left: 4px solid #28a745;
        }
        .username {
            background: #e8f5e8;
            color: #28a745;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: 600;
            display: inline-block;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="success-container">
        <div class="success-icon">✅</div>
        <h1>設定完了！</h1>
        ${usernameDisplay}
        <p>Twitter APIキーの設定が正常に完了しました。</p>
        <p>このページを閉じて、Discordでボットをご利用ください。</p>
        <div class="note">
            <strong>🔒 セキュリティ通知:</strong><br>
            • このページのURLは既に無効になっています<br>
            • APIキーは暗号化されて安全に保存されました<br>
            • 不正アクセスを検知した場合は自動的に無効化されます
        </div>
    </div>
</body>
</html>`;
}

function startServer(port) {
    app.listen(port, () => {
        console.log(`🌐 認証サーバーがポート ${port} で起動しました`);
        console.log(`🔒 セキュリティモード: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🛡️ Trust Proxy: 有効`);
    });
}

module.exports = {
    app,
    secureSetupSessions,
    startServer
};
