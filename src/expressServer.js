// src/expressServer.js - 基本Webサーバー
const express = require('express');

const app = express();

// 基本的なミドルウェア設定
app.use(express.json({ limit: '1kb' }));
app.use(express.urlencoded({ extended: true, limit: '1kb' }));

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'Discord Groq Bot',
        version: '2.1.0'
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
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    max-width: 600px; 
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
                    text-align: center;
                }
                .status { 
                    color: #22c55e; 
                    font-weight: bold; 
                    font-size: 18px;
                    margin: 20px 0;
                }
                .description {
                    color: #6c757d;
                    line-height: 1.6;
                    margin: 20px 0;
                }
                .features {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                    text-align: left;
                }
                .features h3 {
                    color: #2d3748;
                    margin-bottom: 15px;
                }
                .features ul {
                    list-style-type: none;
                    padding: 0;
                }
                .features li {
                    padding: 5px 0;
                    color: #4a5568;
                }
                .features li::before {
                    content: "🤖 ";
                    margin-right: 8px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 Discord Groq Bot</h1>
                <p class="status">✅ サーバーは正常に動作中です</p>
                <p class="description">
                    高性能なAI機能を搭載したDiscordボットです。<br>
                    複数のAIモデルと会話履歴機能をサポートしています。
                </p>
                
                <div class="features">
                    <h3>🚀 主な機能</h3>
                    <ul>
                        <li>複数AIモデルとの対話</li>
                        <li>会話履歴の記憶・管理</li>
                        <li>Web検索連携対応</li>
                        <li>セキュアな通信</li>
                        <li>リアルタイム応答</li>
                    </ul>
                </div>
                
                <p class="description">
                    DiscordでBotを招待して、<code>/ask</code> コマンドでお試しください！
                </p>
            </div>
        </body>
        </html>
    `);
});

// 404ハンドラー
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested endpoint does not exist.',
        timestamp: new Date().toISOString()
    });
});

// エラーハンドラー
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred.',
        timestamp: new Date().toISOString()
    });
});

function startServer(port) {
    app.listen(port, () => {
        console.log(`🌐 Webサーバーがポート ${port} で起動しました`);
        console.log(`📍 http://localhost:${port}`);
    });
}

module.exports = {
    app,
    startServer
};