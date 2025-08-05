// Discord Bot本体（修正版）
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionResponseType, MessageFlags } = require('discord.js');
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
const memoryStats = {
    activeUsers: 0,
    totalMessages: 0,
    lastCleanup: Date.now()
};

// スラッシュコマンド定義
const commands = [
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('AIと会話する（会話を記憶）')
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
                    { name: 'Kimi K2 (默认)', value: MODELS.DEFAULT },
                    { name: 'Compound Beta', value: MODELS.SEARCH },
                    { name: 'Qwen3 32B', value: MODELS.QWEN }
                )
        ),
    new SlashCommandBuilder().setName('clear').setDescription('会話履歴をクリアする'),
    new SlashCommandBuilder().setName('history').setDescription('最新会話履歴を確認する'),
    new SlashCommandBuilder().setName('status').setDescription('ボットの状態とメモリ使用量を確認'),
    new SlashCommandBuilder().setName('models').setDescription('利用可能なAIモデルの情報を表示'),
    new SlashCommandBuilder().setName('setup-twitter').setDescription('Twitter APIキーを安全に設定する'),
    new SlashCommandBuilder()
        .setName('tweet')
        .setDescription('X(Twitter)に投稿する')
        .addStringOption(option =>
            option.setName('content')
                .setDescription('投稿内容（280文字以内）')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('ai-tweet')
        .setDescription('AIとツイート内容を相談して投稿する')
        .addStringOption(option =>
            option.setName('request')
                .setDescription('どんなツイートをしたいか相談内容を入力')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('model')
                .setDescription('使用するAIモデル（オプション）')
                .setRequired(false)
                .addChoices(
                    { name: 'Kimi K2 (默认)', value: MODELS.DEFAULT },
                    { name: 'Compound Beta', value: MODELS.SEARCH },
                    { name: 'Qwen3 32B', value: MODELS.QWEN }
                )
        ),
    new SlashCommandBuilder()
        .setName('tweet-ideas')
        .setDescription('指定したテーマでツイートアイデアをAIに提案してもらう')
        .addStringOption(option =>
            option.setName('theme')
                .setDescription('ツイートのテーマや話題')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('提案数（1-5、デフォルト3）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        ),
    new SlashCommandBuilder().setName('twitter-usage').setDescription('今月のTwitter投稿使用量を確認する'),
    new SlashCommandBuilder().setName('twitter-history').setDescription('最近のTwitter投稿履歴を確認する'),
    new SlashCommandBuilder()
        .setName('schedule-tweet')
        .setDescription('指定時刻にTwitter投稿をスケジュールする')
        .addStringOption(option =>
            option.setName('content')
                .setDescription('投稿内容（280文字以内）')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('when')
                .setDescription('投稿時刻（例: "30分後", "明日 8:00", "2025-08-05 14:30"）')
                .setRequired(true)
        ),
    new SlashCommandBuilder().setName('schedule-list').setDescription('スケジュール済みの投稿一覧を確認する'),
    new SlashCommandBuilder()
        .setName('schedule-cancel')
        .setDescription('スケジュール投稿をキャンセルする')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('キャンセルするスケジュールID')
                .setRequired(true)
        ),
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

// エラーハンドリング改善
process.on('unhandledRejection', (reason, promise) => {
    console.error('未処理のPromise拒否:', reason);
});

client.on('error', (error) => {
    console.error('Discord クライアントエラー:', error);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    
    const { commandName } = interaction;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    
    // 🔧 修正: ephemeral フラグの新しい形式を使用
    try {
        await interaction.deferReply({ 
            flags: MessageFlags.Ephemeral 
        });
    } catch (error) {
        // インタラクションが既に期限切れの場合はログだけ出力して処理を続行しない
        if (error.code === 10062) {
            console.warn('Discord interaction expired for user:', userId);
            return;
        }
        console.error('Interaction defer error:', error);
        return;
    }

    try {
        if (commandName === 'ask') {
            const message = interaction.options.getString('message');
            const model = MODELS.DEFAULT;
            const conversation = getConversation(userId);
            const response = await getAIResponse(userId, message, conversation, model);
            updateConversation(userId, message, response, model);
            await interaction.editReply({ content: response });
            
        } else if (commandName === 'search') {
            const message = interaction.options.getString('message');
            // Web検索付きAI会話（仮実装）
            const response = `[search] ${message}（Web検索機能は未実装）`;
            await interaction.editReply({ content: response });
            
        } else if (commandName === 'ask-model') {
            const message = interaction.options.getString('message');
            const model = interaction.options.getString('model') || MODELS.DEFAULT;
            const conversation = getConversation(userId);
            const response = await getAIResponse(userId, message, conversation, model);
            updateConversation(userId, message, response, model);
            await interaction.editReply({ content: response });
            
        } else if (commandName === 'clear') {
            conversationMemory.set(userId, { 
                messages: [], 
                lastActivity: Date.now(), 
                totalMessages: 0, 
                createdAt: Date.now() 
            });
            await interaction.editReply({ content: '✅ 会話履歴をクリアしました' });
            
        } else if (commandName === 'history') {
            const conversation = getConversation(userId);
            const history = conversation.messages.slice(-6).map(m => 
                `**${m.role}**: ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`
            ).join('\n\n');
            await interaction.editReply({ 
                content: history || '履歴がありません' 
            });
            
        } else if (commandName === 'status') {
            await interaction.editReply({ 
                content: `**Bot 稼働中** 🟢\n` +
                        `アクティブユーザー数: ${conversationMemory.size}\n` +
                        `総メッセージ数: ${memoryStats.totalMessages}` 
            });
            
        } else if (commandName === 'models') {
            await interaction.editReply({ 
                content: `**利用可能モデル:**\n` +
                        `• ${MODELS.DEFAULT} (デフォルト)\n` +
                        `• ${MODELS.SEARCH} (Web検索)\n` +
                        `• ${MODELS.QWEN} (高度推論)` 
            });
            
        } else if (commandName === 'setup-twitter') {
            const { secureSetupSessions } = require('./expressServer');
            const sessionId = `${userId}-${Date.now()}`;
            secureSetupSessions.set(sessionId, {
                userId,
                expires: Date.now() + 10 * 60 * 1000 // 10分有効
            });
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            await interaction.editReply({
                content: `**🔐 Twitter API設定**\n` +
                        `以下のリンクから安全に設定してください:\n` +
                        `${baseUrl}/auth/${sessionId}\n\n` +
                        `⏰ **10分以内**に入力してください`
            });
            
        } else if (commandName === 'tweet') {
            const content = interaction.options.getString('content');
            try {
                const { postTweet } = require('./twitterService');
                const result = await postTweet(userId, content, interaction.channelId);
                await interaction.editReply({ 
                    content: `✅ **ツイート完了!**\n` +
                            `🔗 ${result.tweetUrl}\n` +
                            `📊 残り投稿回数: ${result.remaining}`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **ツイート失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'ai-tweet') {
            const request = interaction.options.getString('request');
            const model = interaction.options.getString('model') || MODELS.DEFAULT;
            try {
                const { postAITweet } = require('./twitterService');
                const result = await postAITweet(userId, request, model, interaction.channelId);
                await interaction.editReply({ 
                    content: `✅ **AIツイート完了!**\n` +
                            `🔗 ${result.tweetUrl}\n` +
                            `📊 残り投稿回数: ${result.remaining}`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **AIツイート失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'tweet-ideas') {
            const theme = interaction.options.getString('theme');
            const count = interaction.options.getInteger('count') || 3;
            const model = MODELS.DEFAULT;
            try {
                const { getTweetIdeas } = require('./twitterService');
                const ideas = await getTweetIdeas(userId, theme, count, model);
                await interaction.editReply({ 
                    content: `✅ **アイデア提案:**\n${ideas.join('\n\n')}`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **アイデア提案失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'twitter-usage') {
            try {
                const { getTwitterUsage } = require('./twitterService');
                const usage = await getTwitterUsage(userId);
                await interaction.editReply({ 
                    content: `📊 **今月のTwitter投稿**\n` +
                            `使用済み: ${usage.count}回\n` +
                            `残り: ${usage.remaining}回`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **使用量取得失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'twitter-history') {
            try {
                const { getTwitterHistory } = require('./twitterService');
                const history = await getTwitterHistory(userId, 10);
                const lines = history.map(h => 
                    `• ${h.tweet_content.slice(0, 50)}... (${h.status})`
                ).join('\n');
                await interaction.editReply({ 
                    content: `📜 **最近のTwitter投稿履歴:**\n${lines}`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **履歴取得失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'schedule-tweet') {
            const content = interaction.options.getString('content');
            const when = interaction.options.getString('when');
            try {
                const { scheduleTweet } = require('./twitterService');
                await scheduleTweet(userId, content, when, interaction.channelId);
                await interaction.editReply({ 
                    content: `✅ **スケジュール投稿を登録**\n` +
                            `📝 内容: ${content}\n` +
                            `⏰ 投稿予定: ${when}`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **スケジュール登録失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'schedule-list') {
            try {
                const { getScheduleList } = require('./twitterService');
                const list = await getScheduleList(userId);
                const lines = list.map(s => 
                    `${s.id}: ${s.tweet_content.slice(0, 40)}... at ${s.scheduled_time} (${s.status})`
                ).join('\n');
                await interaction.editReply({ 
                    content: `📅 **スケジュール一覧:**\n${lines || '予定なし'}`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **スケジュール一覧取得失敗**: ${err.message}` 
                });
            }
            
        } else if (commandName === 'schedule-cancel') {
            const id = interaction.options.getInteger('id');
            try {
                const { cancelSchedule } = require('./twitterService');
                await cancelSchedule(userId, id);
                await interaction.editReply({ 
                    content: `✅ **ID:${id} のスケジュール投稿をキャンセルしました**`
                });
            } catch (err) {
                await interaction.editReply({ 
                    content: `❌ **キャンセル失敗**: ${err.message}` 
                });
            }
        }
        
    } catch (error) {
        console.error('Command execution error:', error);
        try {
            await interaction.editReply({ 
                content: `❌ **エラーが発生しました**: ${error.message}` 
            });
        } catch (replyError) {
            // インタラクションの期限切れなどでreplyできない場合
            console.error('Reply error:', replyError);
        }
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
