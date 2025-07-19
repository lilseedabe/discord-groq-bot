const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const { Groq } = require('groq-sdk');
require('dotenv').config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;

const groq = new Groq({
    apiKey: GROQ_API_KEY,
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
});

// モデル設定
const MODELS = {
    DEFAULT: 'moonshotai/kimi-k2-instruct',
    SEARCH: 'compound-beta',
    QWEN: 'qwen/qwen3-32b'
};

const MODEL_NAMES = {
    [MODELS.DEFAULT]: 'Kimi K2 (デフォルト)',
    [MODELS.SEARCH]: 'Compound Beta (検索機能付き)',
    [MODELS.QWEN]: 'Qwen3 32B'
};

// 制限設定
const LIMITS = {
    MAX_USERS: 50,                    // 最大同時ユーザー数
    MAX_CONVERSATION_LENGTH: 10,      // 最大会話往復数（減らした）
    CONVERSATION_TIMEOUT: 20 * 60 * 1000, // 20分（短縮）
    MAX_MESSAGE_LENGTH: 2000,         // 1メッセージの最大文字数
    CLEANUP_INTERVAL: 3 * 60 * 1000   // 3分ごとにクリーンアップ
};

// 会話履歴管理とメモリ監視
const conversationMemory = new Map();
let memoryStats = {
    activeUsers: 0,
    totalMessages: 0,
    lastCleanup: Date.now()
};

// メモリ使用量チェック
function checkMemoryUsage() {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024 * 100) / 100;
    
    console.log(`💾 メモリ使用量: ${heapUsedMB}MB / ${heapTotalMB}MB (ユーザー数: ${conversationMemory.size})`);
    
    // メモリ警告
    if (heapUsedMB > 100) {
        console.warn('⚠️ メモリ使用量が高くなっています。古い会話履歴を削除します。');
        forceCleanup();
    }
    
    return { heapUsedMB, heapTotalMB };
}

// 強制クリーンアップ
function forceCleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, conversation] of conversationMemory.entries()) {
        // 10分以上無活動または会話数が多い場合は削除
        if (now - conversation.lastActivity > 10 * 60 * 1000 || 
            conversation.totalMessages > LIMITS.MAX_CONVERSATION_LENGTH * 2) {
            conversationMemory.delete(userId);
            cleanedCount++;
        }
    }
    
    console.log(`🗑️ 強制クリーンアップ: ${cleanedCount}ユーザーの履歴を削除`);
    updateMemoryStats();
}

// 定期クリーンアップ
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, conversation] of conversationMemory.entries()) {
        if (now - conversation.lastActivity > LIMITS.CONVERSATION_TIMEOUT) {
            conversationMemory.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🗑️ 自動クリーンアップ: ${cleanedCount}ユーザーの履歴を削除`);
    }
    
    updateMemoryStats();
    checkMemoryUsage();
}, LIMITS.CLEANUP_INTERVAL);

// メモリ統計更新
function updateMemoryStats() {
    memoryStats.activeUsers = conversationMemory.size;
    memoryStats.totalMessages = Array.from(conversationMemory.values())
        .reduce((total, conv) => total + conv.totalMessages, 0);
    memoryStats.lastCleanup = Date.now();
}

// スラッシュコマンドの定義
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
                    { name: 'Kimi K2 (デフォルト) - 高性能汎用モデル', value: MODELS.DEFAULT },
                    { name: 'Compound Beta - Web検索機能付き', value: MODELS.SEARCH },
                    { name: 'Qwen3 32B - 推論特化モデル', value: MODELS.QWEN }
                )
        ),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('会話履歴をクリアする'),
    
    new SlashCommandBuilder()
        .setName('history')
        .setDescription('現在の会話履歴を確認する'),
    
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('ボットの状態とメモリ使用量を確認する'),
    
    new SlashCommandBuilder()
        .setName('models')
        .setDescription('利用可能なAIモデルの情報を表示')
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function deployCommands() {
    try {
        console.log('🔄 スラッシュコマンドを登録中...');
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );

        console.log('✅ スラッシュコマンドが正常に登録されました！');
    } catch (error) {
        console.error('❌ スラッシュコマンドの登録に失敗しました:', error);
    }
}

// 会話履歴を取得・初期化（制限チェック付き）
function getConversation(userId) {
    // ユーザー数制限チェック
    if (!conversationMemory.has(userId) && conversationMemory.size >= LIMITS.MAX_USERS) {
        throw new Error(`同時ユーザー数の上限（${LIMITS.MAX_USERS}人）に達しています。しばらく時間をおいてから再度お試しください。`);
    }
    
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

// 会話履歴を更新
function updateConversation(userId, userMessage, aiResponse, model) {
    const conversation = getConversation(userId);
    
    // メッセージ長制限
    const truncatedUserMessage = userMessage.length > LIMITS.MAX_MESSAGE_LENGTH ? 
        userMessage.substring(0, LIMITS.MAX_MESSAGE_LENGTH) + '...' : userMessage;
    const truncatedAiResponse = aiResponse.length > LIMITS.MAX_MESSAGE_LENGTH ? 
        aiResponse.substring(0, LIMITS.MAX_MESSAGE_LENGTH) + '...' : aiResponse;
    
    // ユーザーメッセージを追加
    conversation.messages.push({
        role: 'user',
        content: truncatedUserMessage,
        timestamp: Date.now()
    });
    
    // AIレスポンスを追加
    conversation.messages.push({
        role: 'assistant',
        content: truncatedAiResponse,
        timestamp: Date.now(),
        model: model
    });
    
    // 会話数制限（短縮）
    if (conversation.messages.length > LIMITS.MAX_CONVERSATION_LENGTH * 2) {
        conversation.messages = conversation.messages.slice(-LIMITS.MAX_CONVERSATION_LENGTH * 2);
    }
    
    conversation.lastActivity = Date.now();
    conversation.totalMessages += 1;
    
    conversationMemory.set(userId, conversation);
    updateMemoryStats();
}

// モデル別のシステムプロンプト
function getSystemPrompt(model) {
    const basePrompt = 'あなたは親切で知識豊富なAIアシスタントです。日本語で簡潔かつ有用な回答を提供してください。過去の会話の文脈を考慮して、自然で連続性のある会話を心がけてください。';
    
    switch (model) {
        case MODELS.SEARCH:
            return basePrompt + ' 最新の情報が必要な場合は、自動的にWeb検索を実行して正確な情報を提供してください。';
        case MODELS.QWEN:
            return basePrompt + ' 複雑な推論や論理的思考が必要な場合は、段階的に説明してください。';
        default:
            return basePrompt;
    }
}

// Groq APIを呼び出す関数
async function getAIResponse(userId, userMessage, model = MODELS.DEFAULT) {
    try {
        const conversation = getConversation(userId);
        
        // 会話履歴を構築（短縮版）
        const messages = [
            {
                role: 'system',
                content: getSystemPrompt(model)
            }
        ];
        
        // 過去の会話履歴を追加（最新5往復まで）
        const recentMessages = conversation.messages.slice(-10);
        
        // Groq APIに送信するため、timestamp等の不要なプロパティを除去
        const cleanMessages = recentMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        
        messages.push(...cleanMessages);
        
        // 現在のユーザーメッセージを追加
        messages.push({
            role: 'user',
            content: userMessage
        });

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: model,
            temperature: 0.7,
            max_tokens: 1500, // 短縮
        });

        const response = chatCompletion.choices[0]?.message?.content || '申し訳ございませんが、回答を生成できませんでした。';
        
        // 会話履歴を更新
        updateConversation(userId, userMessage, response, model);
        
        return response;
    } catch (error) {
        console.error('Groq API エラー:', error);
        throw new Error(`API エラー: ${error.message}`);
    }
}

// 長いメッセージを分割して送信する関数
async function sendLongMessage(interaction, content) {
    if (content.length <= 2000) {
        await interaction.editReply({ content, ephemeral: true });
    } else {
        const chunks = [];
        let currentChunk = '';
        const lines = content.split('\n');
        
        for (const line of lines) {
            if ((currentChunk + line + '\n').length > 2000) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = line + '\n';
                } else {
                    const longLineChunks = line.match(/.{1,2000}/g) || [line];
                    chunks.push(...longLineChunks.slice(0, -1));
                    currentChunk = longLineChunks[longLineChunks.length - 1] + '\n';
                }
            } else {
                currentChunk += line + '\n';
            }
        }
        
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
        
        await interaction.editReply({ content: chunks[0], ephemeral: true });
        
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i], ephemeral: true });
        }
    }
}

// ステータス情報を表示する関数
function createStatusEmbed() {
    const memory = checkMemoryUsage();
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    
    const embed = new EmbedBuilder()
        .setTitle('🤖 ボットステータス')
        .setColor(0x00ff00)
        .addFields([
            {
                name: '👥 アクティブユーザー',
                value: `${memoryStats.activeUsers} / ${LIMITS.MAX_USERS}人`,
                inline: true
            },
            {
                name: '💬 総会話数',
                value: `${memoryStats.totalMessages}回`,
                inline: true
            },
            {
                name: '💾 メモリ使用量',
                value: `${memory.heapUsedMB}MB / ${memory.heapTotalMB}MB`,
                inline: true
            },
            {
                name: '⏱️ 稼働時間',
                value: `${uptimeHours}時間 ${uptimeMinutes}分`,
                inline: true
            },
            {
                name: '🔧 制限設定',
                value: `最大${LIMITS.MAX_CONVERSATION_LENGTH}往復 / ${LIMITS.CONVERSATION_TIMEOUT/60000}分保持`,
                inline: true
            },
            {
                name: '🗑️ 最終クリーンアップ',
                value: new Date(memoryStats.lastCleanup).toLocaleTimeString('ja-JP'),
                inline: true
            }
        ])
        .setTimestamp();
    
    return embed;
}

// モデル情報を表示する関数
function createModelInfoEmbed() {
    const embed = new EmbedBuilder()
        .setTitle('🤖 利用可能なAIモデル')
        .setColor(0x7289DA)
        .setDescription(`各モデルの特徴と用途（最大${LIMITS.MAX_USERS}人同時利用可能）`)
        .addFields(
            {
                name: '🎯 Kimi K2 (デフォルト)',
                value: '• 1兆パラメータのMoEモデル\n• 汎用的な会話に最適\n• 高性能でバランスの取れた回答\n• コーディングと数学に強い',
                inline: true
            },
            {
                name: '🔍 Compound Beta',
                value: '• Web検索機能内蔵\n• 最新情報の取得が可能\n• ニュースや時事問題に最適\n• リアルタイム情報が必要な質問用',
                inline: true
            },
            {
                name: '🧠 Qwen3 32B',
                value: '• 推論と論理的思考に特化\n• 複雑な問題解決に最適\n• 数学・科学計算に強い\n• 思考モード対応',
                inline: true
            }
        )
        .addFields(
            {
                name: '💬 制限事項',
                value: `• 最大${LIMITS.MAX_CONVERSATION_LENGTH}往復まで記憶\n• ${LIMITS.CONVERSATION_TIMEOUT/60000}分間無活動で自動削除\n• 最大${LIMITS.MAX_USERS}人同時利用\n• サーバー再起動で履歴リセット`,
                inline: false
            },
            {
                name: '📝 使用方法',
                value: '• `/ask` - デフォルトモデル(Kimi K2)で会話\n• `/search` - Web検索付きで会話\n• `/ask-model` - モデルを選択して会話\n• `/clear` - 会話履歴をクリア\n• `/history` - 会話履歴を確認\n• `/status` - ボット状態を確認',
                inline: false
            }
        )
        .setFooter({ text: '全ての回答と会話履歴は質問したユーザーにだけ表示されます' })
        .setTimestamp();
    
    return embed;
}

// 会話履歴表示関数
function createHistoryEmbed(userId) {
    const conversation = getConversation(userId);
    const embed = new EmbedBuilder()
        .setTitle('📚 あなたの会話履歴')
        .setColor(0x00ff00);
    
    if (conversation.messages.length === 0) {
        embed.setDescription('まだ会話履歴がありません。`/ask` コマンドで会話を始めてみましょう！');
        return embed;
    }
    
    const recentMessages = conversation.messages.slice(-8); // 最新4往復
    let historyText = '';
    
    for (let i = 0; i < recentMessages.length; i += 2) {
        const userMsg = recentMessages[i];
        const aiMsg = recentMessages[i + 1];
        
        if (userMsg && aiMsg) {
            const timestamp = new Date(userMsg.timestamp).toLocaleTimeString('ja-JP');
            const model = aiMsg.model ? MODEL_NAMES[aiMsg.model] : 'Unknown';
            
            historyText += `**${timestamp}** (${model})\n`;
            historyText += `👤 ${userMsg.content.substring(0, 80)}${userMsg.content.length > 80 ? '...' : ''}\n`;
            historyText += `🤖 ${aiMsg.content.substring(0, 100)}${aiMsg.content.length > 100 ? '...' : ''}\n\n`;
        }
    }
    
    embed.setDescription(historyText || '会話履歴の読み込みに失敗しました。');
    embed.addFields([
        {
            name: '📊 統計',
            value: `総会話数: ${conversation.totalMessages}回\n最終活動: ${new Date(conversation.lastActivity).toLocaleString('ja-JP')}\n作成日時: ${new Date(conversation.createdAt).toLocaleString('ja-JP')}`,
            inline: false
        }
    ]);
    
    return embed;
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がログインしました！`);
    console.log(`🔧 利用可能モデル:`, Object.values(MODEL_NAMES).join(', '));
    console.log(`💬 会話履歴機能: 有効 (最大${LIMITS.MAX_USERS}ユーザー, ${LIMITS.MAX_CONVERSATION_LENGTH}往復, ${LIMITS.CONVERSATION_TIMEOUT/60000}分間保持)`);
    await deployCommands();
    
    // 初期メモリチェック
    checkMemoryUsage();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;
    const userId = interaction.user.id;

    // 全てのコマンドでエフェメラルレスポンスを使用
    await interaction.deferReply({ ephemeral: true });

    try {
        if (commandName === 'ask') {
            const message = interaction.options.getString('message');
            const model = MODELS.DEFAULT;
            
            const response = await getAIResponse(userId, message, model);
            const conversation = getConversation(userId);
            const formattedResponse = `💬 **${MODEL_NAMES[model]}** との会話 (${conversation.totalMessages}回目)\n\n**あなた:** ${message}\n\n**AI:**\n${response}`;
            
            await sendLongMessage(interaction, formattedResponse);

        } else if (commandName === 'search') {
            const message = interaction.options.getString('message');
            const model = MODELS.SEARCH;
            
            const response = await getAIResponse(userId, message, model);
            const conversation = getConversation(userId);
            const formattedResponse = `🔍 **${MODEL_NAMES[model]}** との会話 (${conversation.totalMessages}回目)\n\n**あなた:** ${message}\n\n**AI:**\n${response}`;
            
            await sendLongMessage(interaction, formattedResponse);

        } else if (commandName === 'ask-model') {
            const message = interaction.options.getString('message');
            const model = interaction.options.getString('model');
            
            const response = await getAIResponse(userId, message, model);
            const conversation = getConversation(userId);
            const formattedResponse = `🎯 **${MODEL_NAMES[model]}** との会話 (${conversation.totalMessages}回目)\n\n**あなた:** ${message}\n\n**AI:**\n${response}`;
            
            await sendLongMessage(interaction, formattedResponse);

        } else if (commandName === 'clear') {
            const conversation = getConversation(userId);
            const messageCount = conversation.totalMessages;
            
            conversationMemory.delete(userId);
            updateMemoryStats();
            
            await interaction.editReply({ 
                content: `🗑️ **会話履歴をクリアしました**\n\n削除された会話: ${messageCount}回\n新しい会話を始めることができます。`, 
                ephemeral: true 
            });

        } else if (commandName === 'history') {
            const embed = createHistoryEmbed(userId);
            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } else if (commandName === 'status') {
            const embed = createStatusEmbed();
            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } else if (commandName === 'models') {
            const embed = createModelInfoEmbed();
            await interaction.editReply({ embeds: [embed], ephemeral: true });
        }

    } catch (error) {
        console.error(`❌ ${commandName} コマンドでエラーが発生:`, error);
        
        const errorMessage = `❌ **エラーが発生しました**\n\n` +
            `**コマンド:** ${commandName}\n` +
            `**エラー:** ${error.message}\n\n` +
            `しばらく時間をおいてから再度お試しください。`;
        
        await interaction.editReply({ content: errorMessage, ephemeral: true });
    }
});

// エラーハンドリング
client.on('error', (error) => {
    console.error('❌ Discord クライアントエラー:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ 未処理のPromise拒否:', error);
});

// ボットをログイン
client.login(DISCORD_TOKEN);