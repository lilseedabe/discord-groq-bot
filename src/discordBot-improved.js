// 改善版Discord Bot - メモリ制限付き
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { MODELS, getSystemPrompt, getAIResponse } = require('./aiService');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// ===== メモリ制限設定 =====
const MEMORY_LIMITS = {
    MAX_CONVERSATIONS_PER_USER: 30,     // ユーザーあたり最大30会話ペア
    MAX_MESSAGE_LENGTH: 2000,           // メッセージ最大長（文字数）
    MAX_TOTAL_USERS: 1000,              // 同時管理最大ユーザー数
    CLEANUP_INTERVAL_HOURS: 6,          // クリーンアップ間隔（6時間）
    INACTIVE_THRESHOLD_HOURS: 12,       // 非アクティブ判定時間（12時間）
    AI_CONTEXT_MESSAGES: 10             // AIに送信する履歴数
};

// 会話履歴管理（メモリ制限付き）
const conversationMemory = new Map();
let memoryStats = {
    activeUsers: 0,
    totalMessages: 0,
    lastCleanup: Date.now(),
    memoryUsageMB: 0,
    maxUsers: MEMORY_LIMITS.MAX_TOTAL_USERS
};

function getConversation(userId) {
    if (!conversationMemory.has(userId)) {
        // 最大ユーザー数チェック
        if (conversationMemory.size >= MEMORY_LIMITS.MAX_TOTAL_USERS) {
            console.warn(`⚠️ 最大ユーザー数(${MEMORY_LIMITS.MAX_TOTAL_USERS})に達しています`);
            // 最も古いユーザーを削除
            removeOldestUser();
        }

        conversationMemory.set(userId, {
            messages: [],
            lastActivity: Date.now(),
            totalMessages: 0,
            createdAt: Date.now()
        });
        memoryStats.activeUsers = conversationMemory.size;
    }
    return conversationMemory.get(userId);
}

function updateConversation(userId, userMessage, aiResponse, model) {
    const conversation = getConversation(userId);
    
    // メッセージ長制限
    const truncatedUserMessage = userMessage.length > MEMORY_LIMITS.MAX_MESSAGE_LENGTH 
        ? userMessage.substring(0, MEMORY_LIMITS.MAX_MESSAGE_LENGTH) + '...(省略)'
        : userMessage;
    
    const truncatedAiResponse = aiResponse.length > MEMORY_LIMITS.MAX_MESSAGE_LENGTH 
        ? aiResponse.substring(0, MEMORY_LIMITS.MAX_MESSAGE_LENGTH) + '...(省略)'
        : aiResponse;

    // 新しいメッセージを追加
    conversation.messages.push({
        role: 'user',
        content: truncatedUserMessage,
        timestamp: Date.now()
    });
    conversation.messages.push({
        role: 'assistant',
        content: truncatedAiResponse,
        timestamp: Date.now(),
        model: model
    });

    // 会話数制限チェック
    if (conversation.messages.length > MEMORY_LIMITS.MAX_CONVERSATIONS_PER_USER * 2) {
        // 古い会話を削除（ユーザー+AI応答ペアで削除）
        conversation.messages.splice(0, 2);
        console.log(`📝 ユーザー ${userId} の古い会話を削除しました`);
    }

    conversation.lastActivity = Date.now();
    conversation.totalMessages += 1;
    memoryStats.totalMessages += 1;
    
    // メモリ使用量を更新
    updateMemoryStats();
    
    conversationMemory.set(userId, conversation);
}

// 最も古いユーザーを削除
function removeOldestUser() {
    let oldestUserId = null;
    let oldestTime = Date.now();
    
    for (const [userId, conversation] of conversationMemory.entries()) {
        if (conversation.lastActivity < oldestTime) {
            oldestTime = conversation.lastActivity;
            oldestUserId = userId;
        }
    }
    
    if (oldestUserId) {
        conversationMemory.delete(oldestUserId);
        console.log(`🗑️ 最古ユーザー ${oldestUserId} を削除しました`);
    }
}

// メモリ使用量を計算・更新
function updateMemoryStats() {
    let totalSize = 0;
    for (const [userId, conversation] of conversationMemory.entries()) {
        const jsonSize = JSON.stringify(conversation).length;
        totalSize += jsonSize;
    }
    memoryStats.memoryUsageMB = (totalSize / 1024 / 1024).toFixed(2);
}

// 改善版メモリクリーンアップ
function cleanupOldConversations() {
    const now = Date.now();
    const thresholdMs = MEMORY_LIMITS.INACTIVE_THRESHOLD_HOURS * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [userId, conversation] of conversationMemory.entries()) {
        if (now - conversation.lastActivity > thresholdMs) {
            conversationMemory.delete(userId);
            cleanedCount++;
        }
    }
    
    memoryStats.activeUsers = conversationMemory.size;
    memoryStats.lastCleanup = now;
    updateMemoryStats();
    
    console.log(`🧹 メモリクリーンアップ完了:`);
    console.log(`   - 削除ユーザー数: ${cleanedCount}`);
    console.log(`   - アクティブユーザー数: ${memoryStats.activeUsers}`);
    console.log(`   - メモリ使用量: ${memoryStats.memoryUsageMB} MB`);
    
    // メモリ使用量が高い場合の警告
    if (parseFloat(memoryStats.memoryUsageMB) > 50) {
        console.warn(`⚠️ メモリ使用量が高くなっています: ${memoryStats.memoryUsageMB} MB`);
    }
}

// より頻繁なクリーンアップ（6時間ごと）
setInterval(cleanupOldConversations, MEMORY_LIMITS.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

// 定期メモリ監視（30分ごと）
setInterval(() => {
    updateMemoryStats();
    console.log(`📊 メモリ監視: ${memoryStats.activeUsers}ユーザー, ${memoryStats.memoryUsageMB}MB使用中`);
}, 30 * 60 * 1000);

// ステータス表示の改善
function getDetailedStatus() {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const lastCleanup = new Date(memoryStats.lastCleanup).toLocaleString('ja-JP');
    const nodeMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    
    return `🤖 **Bot稼働状況**

📊 **統計情報**
• アクティブユーザー数: ${memoryStats.activeUsers} / ${memoryStats.maxUsers}
• 総メッセージ数: ${memoryStats.totalMessages}
• 稼働時間: ${hours}時間 ${minutes}分

🧠 **メモリ管理**
• 会話履歴メモリ: ${memoryStats.memoryUsageMB} MB
• Node.jsメモリ: ${nodeMemory} MB
• 最終クリーンアップ: ${lastCleanup}

⚙️ **制限設定**
• ユーザーあたり最大会話数: ${MEMORY_LIMITS.MAX_CONVERSATIONS_PER_USER}
• クリーンアップ間隔: ${MEMORY_LIMITS.CLEANUP_INTERVAL_HOURS}時間
• 非アクティブ閾値: ${MEMORY_LIMITS.INACTIVE_THRESHOLD_HOURS}時間

✅ Bot は正常に動作中です`;
}

module.exports = {
    client,
    startBot,
    getConversation,
    updateConversation,
    conversationMemory,
    MEMORY_LIMITS,
    memoryStats,
    getDetailedStatus
};
