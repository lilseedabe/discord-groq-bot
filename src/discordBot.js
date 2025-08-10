// Discord Bot本体
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MODELS, getSystemPrompt, getAIResponse } = require('./aiService');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// 会話履歴管理
const conversationMemory = new Map();
let botStats = {
    startTime: Date.now(),
    lastCleanup: Date.now()
};

// スラッシュコマンド定義
const commands = [
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('AIと会話する（会話履歴を記憶）')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('メッセージ内容')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Web検索機能付きで会話する（会話履歴を記憶）')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('メッセージ内容（最新情報が必要な場合）')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('ask-model')
        .setDescription('モデルを選択して会話する（会話履歴を記憶）')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('メッセージ内容')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('model')
                .setDescription('使用するAIモデル')
                .setRequired(true)
                .addChoices(
                    { name: 'GPT-OSS-120B (デフォルト)', value: MODELS.DEFAULT },
                    { name: 'Compound Beta', value: MODELS.SEARCH },
                    { name: 'Kimi K2 (推論特化)', value: MODELS.REASONING }
                )
        ),
    new SlashCommandBuilder().setName('clear').setDescription('会話履歴をクリアする'),
    new SlashCommandBuilder().setName('history').setDescription('現在の会話履歴を確認する'),
    new SlashCommandBuilder().setName('status').setDescription('ボットの状態とメモリ使用量を確認する'),
    new SlashCommandBuilder().setName('models').setDescription('利用可能なAIモデルの情報を表示'),
];

// コマンド登録処理
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log('✅ スラッシュコマンド登録完了');
    } catch (error) {
        console.error('❌ スラッシュコマンド登録失敗:', error);
    }
}

// Bot起動時にコマンド登録
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がログインしました！`);
    await deployCommands();
});

function getConversation(userId) {
    if (!conversationMemory.has(userId)) {
        conversationMemory.set(userId, {
            messages: [],
            lastActivity: Date.now(),
            createdAt: Date.now()
        });
    }
    return conversationMemory.get(userId);
}

function updateConversation(userId, userMessage, aiResponse, model) {
    const conversation = getConversation(userId);
    conversation.messages.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
    });
    conversation.messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now(),
        model: model
    });
    conversation.lastActivity = Date.now();
    conversationMemory.set(userId, conversation);
}

// メモリクリーンアップ（24時間非アクティブな会話を削除）
function cleanupOldConversations() {
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [userId, conversation] of conversationMemory.entries()) {
        if (now - conversation.lastActivity > dayInMs) {
            conversationMemory.delete(userId);
            cleanedCount++;
        }
    }
    
    botStats.lastCleanup = now;
    console.log(`🧹 メモリクリーンアップ完了: ${cleanedCount}件削除, アクティブユーザー数 ${conversationMemory.size}`);
}

// 1時間ごとにクリーンアップを実行
setInterval(cleanupOldConversations, 60 * 60 * 1000);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    const { commandName } = interaction;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    await interaction.deferReply({ ephemeral: true });

    try {
        if (commandName === 'ask') {
            const message = interaction.options.getString('message');
            const model = MODELS.DEFAULT;
            const conversation = getConversation(userId);
            const response = await getAIResponse(userId, message, conversation, model);
            updateConversation(userId, message, response, model);
            
            // 長いレスポンスの場合は分割して送信
            if (response.length > 2000) {
                const chunks = response.match(/.{1,2000}/g);
                await interaction.editReply({ content: chunks[0], ephemeral: true });
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({ content: chunks[i], ephemeral: true });
                }
            } else {
                await interaction.editReply({ content: response, ephemeral: true });
            }
        } else if (commandName === 'search') {
            const message = interaction.options.getString('message');
            const model = MODELS.SEARCH;
            const conversation = getConversation(userId);
            const response = await getAIResponse(userId, message, conversation, model);
            updateConversation(userId, message, response, model);
            
            if (response.length > 2000) {
                const chunks = response.match(/.{1,2000}/g);
                await interaction.editReply({ content: chunks[0], ephemeral: true });
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({ content: chunks[i], ephemeral: true });
                }
            } else {
                await interaction.editReply({ content: response, ephemeral: true });
            }
        } else if (commandName === 'ask-model') {
            const message = interaction.options.getString('message');
            const model = interaction.options.getString('model') || MODELS.DEFAULT;
            const conversation = getConversation(userId);
            const response = await getAIResponse(userId, message, conversation, model);
            updateConversation(userId, message, response, model);
            
            if (response.length > 2000) {
                const chunks = response.match(/.{1,2000}/g);
                await interaction.editReply({ content: chunks[0], ephemeral: true });
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({ content: chunks[i], ephemeral: true });
                }
            } else {
                await interaction.editReply({ content: response, ephemeral: true });
            }
        } else if (commandName === 'clear') {
            conversationMemory.set(userId, { 
                messages: [], 
                lastActivity: Date.now(), 
                createdAt: Date.now() 
            });
            await interaction.editReply({ content: '✅ 会話履歴をクリアしました', ephemeral: true });
        } else if (commandName === 'history') {
            const conversation = getConversation(userId);
            if (conversation.messages.length === 0) {
                await interaction.editReply({ content: '📝 会話履歴はまだありません', ephemeral: true });
                return;
            }
            
            const recentMessages = conversation.messages.slice(-10); // 最新10件
            const history = recentMessages.map((m, index) => {
                const time = new Date(m.timestamp).toLocaleTimeString('ja-JP');
                const role = m.role === 'user' ? '👤' : '🤖';
                const model = m.model ? ` (${m.model})` : '';
                return `${role} [${time}]${model} ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`;
            }).join('\n\n');
            
            const historyMessage = `📚 **会話履歴** (最新10件)\n\`\`\`\n${history}\n\`\`\``;
            
            if (historyMessage.length > 2000) {
                await interaction.editReply({ content: '📚 会話履歴が長すぎます。最近の会話のみ表示します。', ephemeral: true });
                await interaction.followUp({ content: history, ephemeral: true });
            } else {
                await interaction.editReply({ content: historyMessage, ephemeral: true });
            }
        } else if (commandName === 'status') {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const lastCleanup = new Date(botStats.lastCleanup).toLocaleString('ja-JP');
            const activeUsers = conversationMemory.size;
            
            const statusMessage = `🤖 **Bot稼働状況**
            
🔄 **サービス情報**
• 稼働時間: ${hours}時間 ${minutes}分
• アクティブユーザー: ${activeUsers}人
• 最終クリーンアップ: ${lastCleanup}

✅ Bot は正常に動作中です`;
            
            await interaction.editReply({ content: statusMessage, ephemeral: true });
        } else if (commandName === 'models') {
            const modelsInfo = `🤖 **利用可能なAIモデル**

**${MODELS.DEFAULT}** (GPT-OSS-120B)
• 高性能な汎用モデル
• 幅広いタスクに対応
• デフォルトモデル

**${MODELS.SEARCH}** (Compound Beta)  
• Web検索機能付き
• 最新情報の取得に対応
• リアルタイム情報

**${MODELS.REASONING}** (Kimi K2)
• 高度な推論能力
• 複雑な論理的思考
• 日本語に特化した分析

💡 \`/ask-model\` コマンドでモデルを選択できます`;
            
            await interaction.editReply({ content: modelsInfo, ephemeral: true });
        }
    } catch (error) {
        console.error('コマンド実行エラー:', error);
        await interaction.editReply({ 
            content: `❌ エラーが発生しました: ${error.message}\n\nしばらく時間を置いて再試行してください。`, 
            ephemeral: true 
        });
    }
});

function startBot() {
    client.login(DISCORD_TOKEN);
}

module.exports = {
    client,
    startBot,
    getConversation,
    updateConversation,
    conversationMemory
};