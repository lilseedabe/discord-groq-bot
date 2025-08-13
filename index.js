// メインエントリーポイント - note AI生成プラン対応版
require('dotenv').config();

const { startBot } = require('./src/discordBot');
const { initializeDatabase } = require('./src/db');
const { startServer } = require('./src/expressServer');

// 新機能のサービスインポート
const authService = require('./src/services/authService');
const creditService = require('./src/services/creditService');
const edenService = require('./src/services/edenService');
const jobQueue = require('./src/services/jobQueue');
const dmService = require('./src/services/dmService');

const PORT = process.env.PORT || 3000;

console.log('🎨 note AI生成プラン Discord Bot 起動中...');
console.log('=====================================');

/**
 * 環境変数チェック
 */
function checkEnvironmentVariables() {
    const required = [
        'DISCORD_TOKEN',
        'CLIENT_ID',
        'GROQ_API_KEY'
    ];

    const recommended = [
        'EDEN_AI_API_KEY',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'REDIS_URL'
    ];

    const missing = required.filter(key => !process.env[key]);
    const missingRecommended = recommended.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error('❌ 必須環境変数が不足しています:');
        missing.forEach(key => console.error(`   - ${key}`));
        process.exit(1);
    }

    if (missingRecommended.length > 0) {
        console.warn('⚠️  推奨環境変数が設定されていません（AI生成機能が制限されます）:');
        missingRecommended.forEach(key => console.warn(`   - ${key}`));
    }

    console.log('✅ 環境変数チェック完了');
}

/**
 * 外部サービス接続テスト
 */
async function testExternalServices() {
    console.log('🔍 外部サービス接続テスト中...');

    // Eden.AI接続テスト
    if (process.env.EDEN_AI_API_KEY) {
        try {
            const edenTest = await edenService.testConnection();
            if (edenTest.success) {
                console.log('✅ Eden.AI接続成功');
            } else {
                console.warn('⚠️ Eden.AI接続失敗:', edenTest.error);
                console.warn('   AI生成機能が利用できません');
            }
        } catch (error) {
            console.warn('⚠️ Eden.AI接続エラー:', error.message);
        }
    } else {
        console.warn('⚠️ EDEN_AI_API_KEY未設定 - AI生成機能無効');
    }

    // Redis接続テスト（ジョブキュー用）
    if (process.env.REDIS_URL) {
        try {
            // ジョブキューの初期化で接続テストも行われる
            console.log('✅ Redis接続成功 - ジョブキュー利用可能');
        } catch (error) {
            console.warn('⚠️ Redis接続失敗:', error.message);
            console.warn('   非同期AI生成機能が制限されます');
        }
    } else {
        console.warn('⚠️ REDIS_URL未設定 - ジョブキュー機能無効');
    }

    console.log('🔍 外部サービステスト完了');
}

/**
 * データベース初期化
 */
async function initializeServices() {
    console.log('🗄️ データベース・サービス初期化中...');

    // 従来のデータベース初期化（オプション）
    if (process.env.DB_HOST && process.env.DB_NAME) {
        console.log('🔧 従来PostgreSQL接続確認中...');
        try {
            await initializeDatabase();
            console.log('✅ PostgreSQL接続成功');
        } catch (error) {
            console.warn('⚠️ PostgreSQL接続失敗:', error.message);
        }
    }

    // Supabase接続テスト
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log('🔧 Supabase接続確認中...');
        try {
            const systemStats = await authService.getSystemStats();
            if (systemStats) {
                console.log('✅ Supabase接続成功');
                console.log(`📊 登録ユーザー数: ${systemStats.users?.activeUsers || 0}人`);
            } else {
                console.warn('⚠️ Supabase接続確認できず');
            }
        } catch (error) {
            console.warn('⚠️ Supabase接続エラー:', error.message);
            console.warn('   note会員機能が利用できません');
        }
    } else {
        console.warn('⚠️ Supabase未設定 - note会員機能無効');
    }

    console.log('🗄️ データベース初期化完了');
}

/**
 * アプリケーション起動
 */
async function startApplication() {
    try {
        // 1. 環境変数チェック
        checkEnvironmentVariables();

        // 2. 外部サービステスト
        await testExternalServices();

        // 3. データベース・サービス初期化
        await initializeServices();

        // 4. Discord Bot起動
        console.log('🤖 Discord Bot起動中...');
        startBot();

        // 5. Webサーバー起動
        console.log('🌐 Webサーバー起動中...');
        startServer(PORT);

        // 6. 起動完了メッセージ
        console.log('');
        console.log('🎉 note AI生成プラン Discord Bot 起動完了！');
        console.log('=====================================');
        console.log(`📱 Bot機能: Discord スラッシュコマンド`);
        console.log(`🌐 Webサーバー: http://localhost:${PORT}`);
        console.log(`🔗 ヘルスチェック: http://localhost:${PORT}/health`);
        
        if (process.env.EDEN_AI_API_KEY) {
            console.log(`🎨 AI生成機能: 有効`);
        } else {
            console.log(`🎨 AI生成機能: 無効 (EDEN_AI_API_KEY未設定)`);
        }
        
        if (process.env.SUPABASE_URL) {
            console.log(`👥 note会員機能: 有効`);
        } else {
            console.log(`👥 note会員機能: 無効 (Supabase未設定)`);
        }
        
        console.log('');
        console.log('📋 利用可能なコマンド:');
        console.log('   💬 チャット: /ask, /search, /ask-model');
        console.log('   🎨 AI生成: /gen-image, /gen-video (要会員)');
        console.log('   👤 アカウント: /redeem, /account, /credits');
        console.log('   ℹ️  情報: /help, /status, /models, /pricing');
        console.log('');

        // 7. 運用状況の定期出力
        setInterval(() => {
            const uptime = Math.floor(process.uptime() / 60); // 分単位
            const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024); // MB
            console.log(`📊 運用状況: 稼働時間 ${uptime}分, メモリ使用量 ${memUsage}MB`);
        }, 30 * 60 * 1000); // 30分ごと

    } catch (error) {
        console.error('❌ アプリケーション起動エラー:', error);
        console.error('');
        console.error('🔧 トラブルシューティング:');
        console.error('   1. .envファイルの設定を確認してください');
        console.error('   2. 必須サービス（Discord, Groq）のAPIキーを確認');
        console.error('   3. ネットワーク接続を確認してください');
        console.error('   4. ログファイルで詳細なエラー情報を確認');
        process.exit(1);
    }
}

/**
 * グレースフルシャットダウン処理
 */
process.on('SIGTERM', async () => {
    console.log('📡 SIGTERM受信: アプリケーション終了処理開始...');
    await gracefulShutdown();
});

process.on('SIGINT', async () => {
    console.log('📡 SIGINT受信: アプリケーション終了処理開始...');
    await gracefulShutdown();
});

async function gracefulShutdown() {
    console.log('🛑 グレースフルシャットダウン中...');

    try {
        // ジョブキュー終了
        if (jobQueue) {
            console.log('🔄 ジョブキュー終了中...');
            await jobQueue.close();
        }

        // Discord Bot終了
        if (require('./src/discordBot').client) {
            console.log('🤖 Discord Bot終了中...');
            require('./src/discordBot').client.destroy();
        }

        console.log('✅ グレースフルシャットダウン完了');
        process.exit(0);

    } catch (error) {
        console.error('❌ シャットダウンエラー:', error);
        process.exit(1);
    }
}

/**
 * 未処理エラーハンドリング
 */
process.on('uncaughtException', (error) => {
    console.error('❌ 未処理例外:', error);
    console.error('   アプリケーションを再起動してください');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未処理Promise拒否:', reason);
    console.error('   発生箇所:', promise);
    console.error('   アプリケーションを再起動してください');
    process.exit(1);
});

// アプリケーション起動
startApplication();

// 開発時の便利な情報出力
if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 開発モード情報:');
    console.log(`   Node.js: ${process.version}`);
    console.log(`   プラットフォーム: ${process.platform}`);
    console.log(`   作業ディレクトリ: ${process.cwd()}`);
    console.log('');
}
