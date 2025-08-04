// Discord Bot本体
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MODELS, getSystemPrompt, getAIResponse } = require('./aiService');
const { postTweet } = require('./twitterService');
const { getOrCreateUser } = require('./db');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// 会話履歴管理
const conversationMemory = new Map();
let memoryStats = {
    activeUsers: 0,
    totalMessages: 0,
    lastCleanup: Date.now()
};

// スラッシュコマンド定義
const commands = [
    new SlashCommandBuilder().setName('ask').setDescription('AIと会話する').addStringOption(option =>
        option.setName('message').setDescription('メッセージ内容').setRequired(true)
    ),
    new SlashCommandBuilder().setName('tweet').setDescription('X(Twitter)に投稿する').addStringOption(option =>
        option.setName('content').setDescription('投稿内容（280文字以内）').setRequired(true)
    ),
    // 必要に応じて他コマンドも追加
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
            totalMessages: 0,
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
    conversation.totalMessages += 1;
    conversationMemory.set(userId, conversation);
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がログインしました！`);
});

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
            await interaction.editReply({ content: response, ephemeral: true });
        }
        // 他コマンドも同様に分割実装
    } catch (error) {
        await interaction.editReply({ content: `❌ エラー: ${error.message}`, ephemeral: true });
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