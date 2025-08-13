#!/usr/bin/env node
// generationWorker.js - AI生成専用ワーカープロセス

require('dotenv').config();
const jobQueue = require('../src/services/jobQueue');

console.log('🔧 AI生成ワーカープロセスを開始中...');

// ワーカーのグレースフルシャットダウン
process.on('SIGTERM', async () => {
    console.log('📡 SIGTERM受信: ワーカーを終了中...');
    await jobQueue.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('📡 SIGINT受信: ワーカーを終了中...');
    await jobQueue.close();
    process.exit(0);
});

// エラーハンドリング
process.on('uncaughtException', (error) => {
    console.error('❌ 未処理例外:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未処理Promise拒否:', reason);
    process.exit(1);
});

console.log('✅ AI生成ワーカープロセス起動完了');
console.log('🔄 ジョブを待機中...');

// ワーカーを生かし続ける
setInterval(() => {
    // ワーカーのヘルスチェック
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB制限
        console.warn('⚠️ メモリ使用量が多くなっています:', Math.round(memUsage.heapUsed / 1024 / 1024), 'MB');
    }
}, 60000); // 1分ごと
