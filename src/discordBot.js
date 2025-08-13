// Discord Bot本体 - note AI生成プラン対応版
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MODELS, getSystemPrompt, getAIResponse } = require('./aiService');

// 新しいサービス・コマンドのインポート
const generateCommands = require('./commands/generate');
const accountCommands = require('./commands/account');
const dmService = require('./services/dmService');
const jobQueue = require('./services/jobQueue');
const authService = require('./services/authService');
const edenService = require('./services/edenService');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages
    ],
});

// 会話履歴管理（既存機能）
const conversationMemory = new Map();
let botStats = {
    startTime: Date.now(),
    lastCleanup: Date.now(),
    totalGenerations: 0,
    totalUsers: 0
};

// 既存の会話コマンド
const chatCommands = [
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
    
    // 新機能案内コマンド
    new SlashCommandBuilder()
        .setName('pricing')
        .setDescription('💰 note AI生成プランの料金・機能案内'),
        
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('📖 ボットの使い方・コマンド一覧')
];

// 全コマンド統合
const allCommands = [
    ...chatCommands,
    ...generateCommands.commands,
    ...accountCommands.commands
];

// コマンド登録処理
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function deployCommands() {
    try {
        console.log('🔄 スラッシュコマンドを登録中...');
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: allCommands }
        );
        
        console.log(`✅ ${allCommands.length}個のスラッシュコマンド登録完了`);
        console.log('📋 登録されたコマンド:');
        allCommands.forEach(cmd => {
            console.log(`   /${cmd.name} - ${cmd.description}`);
        });
        
    } catch (error) {
        console.error('❌ スラッシュコマンド登録失敗:', error);
    }
}

// Bot起動時処理
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がログインしました！`);
    
    // DM サービスにクライアントを設定
    dmService.setClient(client);
    
    // コマンド登録
    await deployCommands();
    
    // システム統計の初期化
    botStats.startTime = Date.now();
    
    // Eden.AI接続テスト
    console.log('🔍 Eden.AI接続テスト中...');
    const connectionTest = await edenService.testConnection();
    if (connectionTest.success) {
        console.log('✅ Eden.AI接続成功');
    } else {
        console.warn('⚠️ Eden.AI接続失敗:', connectionTest.error);
    }
    
    console.log('🚀 note AI生成プラン Discord Bot 起動完了！');
});

// 既存の会話機能
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

// スラッシュコマンド処理
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) {
        // ボタンインタラクション処理
        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        }
        return;
    }

    const { commandName } = interaction;
    const userId = interaction.user.id;
    const username = interaction.user.username;

    try {
        // 既存の会話コマンド処理
        if (['ask', 'search', 'ask-model', 'clear', 'history', 'status', 'models'].includes(commandName)) {
            await handleChatCommands(interaction, commandName, userId, username);
        }
        // 新しい案内コマンド
        else if (commandName === 'pricing') {
            await handlePricingInfo(interaction);
        }
        else if (commandName === 'help') {
            await handleHelpCommand(interaction);
        }
        // AI生成コマンド処理
        else if (generateCommands.handlers[commandName]) {
            await generateCommands.handlers[commandName](interaction);
            botStats.totalGenerations++;
        }
        // アカウント管理コマンド処理
        else if (accountCommands.handlers[commandName]) {
            await accountCommands.handlers[commandName](interaction);
        }
        else {
            await interaction.reply({
                content: '❌ 不明なコマンドです',
                ephemeral: true
            });
        }

    } catch (error) {
        console.error(`コマンド実行エラー (${commandName}):`, error);
        
        // エラーメッセージを適切に表示
        const errorMessage = `❌ エラーが発生しました: ${error.message}\n\nしばらく時間を置いて再試行してください。`;
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
            console.error('エラーメッセージ送信失敗:', replyError);
        }
    }
});

/**
 * 既存会話コマンド処理
 */
async function handleChatCommands(interaction, commandName, userId, username) {
    await interaction.deferReply({ ephemeral: true });

    if (commandName === 'ask') {
        const message = interaction.options.getString('message');
        const model = MODELS.DEFAULT;
        const conversation = getConversation(userId);
        const response = await getAIResponse(userId, message, conversation, model);
        updateConversation(userId, message, response, model);
        await sendLongMessage(interaction, response);
        
    } else if (commandName === 'search') {
        const message = interaction.options.getString('message');
        const model = MODELS.SEARCH;
        const conversation = getConversation(userId);
        const response = await getAIResponse(userId, message, conversation, model);
        updateConversation(userId, message, response, model);
        await sendLongMessage(interaction, response);
        
    } else if (commandName === 'ask-model') {
        const message = interaction.options.getString('message');
        const model = interaction.options.getString('model') || MODELS.DEFAULT;
        const conversation = getConversation(userId);
        const response = await getAIResponse(userId, message, conversation, model);
        updateConversation(userId, message, response, model);
        await sendLongMessage(interaction, response);
        
    } else if (commandName === 'clear') {
        conversationMemory.set(userId, { 
            messages: [], 
            lastActivity: Date.now(), 
            createdAt: Date.now() 
        });
        await interaction.editReply({ content: '✅ 会話履歴をクリアしました' });
        
    } else if (commandName === 'history') {
        const conversation = getConversation(userId);
        if (conversation.messages.length === 0) {
            await interaction.editReply({ content: '📝 会話履歴はまだありません' });
            return;
        }
        
        const recentMessages = conversation.messages.slice(-10);
        const history = recentMessages.map((m, index) => {
            const time = new Date(m.timestamp).toLocaleTimeString('ja-JP');
            const role = m.role === 'user' ? '👤' : '🤖';
            const model = m.model ? ` (${m.model})` : '';
            return `${role} [${time}]${model} ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`;
        }).join('\n\n');
        
        const historyMessage = `📚 **会話履歴** (最新10件)\n\`\`\`\n${history}\n\`\`\``;
        await sendLongMessage(interaction, historyMessage);
        
    } else if (commandName === 'status') {
        await handleStatusCommand(interaction);
        
    } else if (commandName === 'models') {
        await handleModelsCommand(interaction);
    }
}

/**
 * ステータスコマンド処理
 */
async function handleStatusCommand(interaction) {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const lastCleanup = new Date(botStats.lastCleanup).toLocaleString('ja-JP');
    const activeUsers = conversationMemory.size;
    
    // システム統計取得
    const systemStats = await authService.getSystemStats();
    
    const embed = new EmbedBuilder()
        .setTitle('🤖 Bot稼働状況')
        .setDescription('note AI生成プラン Discord Bot')
        .addFields(
            { name: '⏱️ 稼働時間', value: `${hours}時間 ${minutes}分`, inline: true },
            { name: '👥 アクティブユーザー', value: `${activeUsers}人`, inline: true },
            { name: '🎨 総生成数', value: `${botStats.totalGenerations}回`, inline: true },
            { name: '🧹 最終クリーンアップ', value: lastCleanup, inline: false }
        )
        .setColor(0x00ff00)
        .setTimestamp()
        .setFooter({ text: 'Bot は正常に動作中です' });

    if (systemStats) {
        embed.addFields(
            { name: '📊 システム統計', value: `登録ユーザー: ${systemStats.users.activeUsers}人\n今日のジョブ: ${systemStats.users.todayJobs}回`, inline: true }
        );
    }

    await interaction.editReply({ embeds: [embed] });
}

/**
 * モデル情報表示
 */
async function handleModelsCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 利用可能なAIモデル')
        .setDescription('チャット機能とAI生成機能で使用できるモデル')
        .addFields(
            { 
                name: '💬 チャット機能 (無料)', 
                value: `**${MODELS.DEFAULT}** - 汎用高性能モデル\n**${MODELS.SEARCH}** - Web検索機能付き\n**${MODELS.REASONING}** - 推論特化モデル` 
            },
            { 
                name: '🎨 AI生成機能 (note会員限定)', 
                value: `**画像生成** - DALL·E 3, Stable Diffusion等\n**動画生成** - MiniMax T2V, Amazon Nova Reel等` 
            }
        )
        .setColor(0x0099ff)
        .setTimestamp()
        .setFooter({ text: 'AI生成機能を使うには note AI生成プランへの登録が必要です' });

    const button = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('note AI生成プランを見る')
                .setStyle(ButtonStyle.Link)
                .setURL('https://note.com/your-plan-url')
                .setEmoji('🛒')
        );

    await interaction.editReply({ 
        embeds: [embed],
        components: [button]
    });
}

/**
 * 料金案内
 */
async function handlePricingInfo(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
        .setTitle('💰 note AI生成プラン')
        .setDescription('高品質なAI生成機能をお得にご利用いただけます')
        .addFields(
            { name: '💳 料金', value: '**¥2,500/月**\n毎月1000クレジット付与', inline: true },
            { name: '🎨 画像生成', value: '1-7クレジット/枚\nDALL·E 3, Stable Diffusion等', inline: true },
            { name: '🎬 動画生成', value: '480クレジット/8秒\n高品質短時間動画', inline: true },
            { name: '🎵 音声生成', value: '2-3クレジット/回\n自然な読み上げ音声', inline: true },
            { name: '📱 便利機能', value: '• DM通知\n• X投稿ボタン\n• 生成履歴管理', inline: true },
            { name: '🎯 特典', value: '• 初回20%割引\n• 月末割引あり\n• 24時間サポート', inline: true }
        )
        .setColor(0xffd700)
        .setTimestamp()
        .setFooter({ text: 'リデンプションコードでの登録が必要です' });

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('今すぐ購入')
                .setStyle(ButtonStyle.Link)
                .setURL('https://note.com/your-plan-url')
                .setEmoji('🛒'),
            new ButtonBuilder()
                .setCustomId('pricing_details')
                .setLabel('詳細な料金表')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📊')
        );

    await interaction.editReply({
        embeds: [embed],
        components: [buttons]
    });
}

/**
 * ヘルプコマンド
 */
async function handleHelpCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
        .setTitle('📖 Discord AI Bot 使い方ガイド')
        .setDescription('チャット機能とAI生成機能の使い方')
        .addFields(
            { 
                name: '💬 チャット機能 (無料)', 
                value: '`/ask メッセージ` - AI会話\n`/search メッセージ` - Web検索付き会話\n`/ask-model` - モデル選択会話\n`/clear` - 履歴クリア' 
            },
            { 
                name: '🎨 AI生成 (note会員限定)', 
                value: '`/gen-image` - 画像生成\n`/gen-video` - 動画生成' 
            },
            { 
                name: '👤 アカウント管理', 
                value: '`/redeem` - 会員登録\n`/account` - アカウント情報\n`/credits` - クレジット確認\n`/history` - 生成履歴' 
            },
            { 
                name: '⚙️ その他', 
                value: '`/status` - Bot状態確認\n`/models` - モデル情報\n`/pricing` - 料金案内\n`/dm-settings` - DM設定' 
            }
        )
        .setColor(0x0099ff)
        .setTimestamp()
        .setFooter({ text: '困ったときはサポートまでお気軽にどうぞ！' });

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('help_beginner')
                .setLabel('初心者ガイド')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔰'),
            new ButtonBuilder()
                .setCustomId('help_advanced')
                .setLabel('高度な使い方')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⚙️')
        );

    await interaction.editReply({
        embeds: [embed],
        components: [buttons]
    });
}

/**
 * ボタンインタラクション処理
 */
async function handleButtonInteraction(interaction) {
    try {
        const customId = interaction.customId;

        // 生成コマンドのボタン処理
        if (customId.includes('dm_result_') || customId.includes('status_') || customId.includes('cancel_') || customId.includes('regenerate_') || customId.includes('share_info_')) {
            await generateCommands.buttonHandler(interaction);
        }
        // アカウントコマンドのボタン処理
        else if (['getting_started', 'first_generation', 'view_credits', 'dm_settings', 'credit_history', 'refresh_jobs'].includes(customId)) {
            await accountCommands.buttonHandler(interaction);
        }
        // その他のボタン処理
        else {
            await handleMiscButtonInteraction(interaction, customId);
        }

    } catch (error) {
        console.error('ボタンインタラクションエラー:', error);
        
        try {
            await interaction.reply({
                content: '❌ ボタン処理中にエラーが発生しました',
                ephemeral: true
            });
        } catch (replyError) {
            console.error('エラーレスポンス送信失敗:', replyError);
        }
    }
}

/**
 * その他ボタン処理
 */
async function handleMiscButtonInteraction(interaction, customId) {
    switch (customId) {
        case 'pricing_details':
            await handleDetailedPricing(interaction);
            break;
        case 'help_beginner':
            await handleBeginnerGuide(interaction);
            break;
        case 'help_advanced':
            await handleAdvancedGuide(interaction);
            break;
        default:
            await interaction.reply({
                content: '❌ 不明なボタンアクションです',
                ephemeral: true
            });
    }
}

/**
 * 詳細料金表示
 */
async function handleDetailedPricing(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('📊 詳細料金表')
        .setDescription('AI生成機能の詳細な料金設定')
        .addFields(
            { name: '🎨 画像生成', value: 'Replicate Anime Style: 0.23クレジット\nReplicate Classic: 1.15クレジット\nMiniMax Image-01: 3.5クレジット\nLeonardo Lightning XL: 11クレジット\nDALL·E 2: 16クレジット\nDALL·E 3: 40クレジット', inline: true },
            { name: '🎬 動画生成', value: 'MiniMax T2V Director: 430クレジット\nAmazon Nova Reel: 500クレジット\nGoogle Veo 3.0: 6000クレジット\n\u203b 8秒動画の基本料金', inline: true }
        )
        .setColor(0xffd700)
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

/**
 * 初心者ガイド
 */
async function handleBeginnerGuide(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🔰 初心者ガイド')
        .setDescription('Discord AI Botを初めて使う方向けのガイド')
        .addFields(
            { name: 'ステップ1: チャット機能を試す', value: '`/ask こんにちは` で基本的なAI会話を体験してみましょう' },
            { name: 'ステップ2: note AI生成プランに登録', value: 'noteでプランを購入し、リデンプションコードを受け取ります' },
            { name: 'ステップ3: アカウント登録', value: '`/redeem コード` でDiscordアカウントと紐付けます' },
            { name: 'ステップ4: AI生成を試す', value: '`/gen-image 猫の絵` で初回生成（20%割引）を体験' },
            { name: 'ステップ5: 設定を調整', value: '`/dm-settings` でDM通知など、お好みに合わせて設定' }
        )
        .setColor(0x00ff00)
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

/**
 * 高度な使い方ガイド
 */
async function handleAdvancedGuide(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('⚙️ 高度な使い方')
        .setDescription('効率的な使い方とコツ')
        .addFields(
            { name: '🎨 高品質画像生成のコツ', value: '• 英語でプロンプトを書く\n• "highly detailed, 8k resolution"を追加\n• アートスタイルを指定する' },
            { name: '💳 クレジット節約術', value: '• 低コストモデル（Stable Diffusion）を活用\n• 月末割引を利用する\n• バッチ生成で効率化' },
            { name: '📱 便利機能活用', value: '• DM通知でマルチタスク\n• X投稿ボタンで共有\n• 生成履歴で振り返り' },
            { name: '🔄 ジョブ管理', value: '• `/jobs` で進行状況確認\n• キャンセル機能でクレジット節約\n• 同時実行数制限に注意' }
        )
        .setColor(0x9932cc)
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

/**
 * 長いメッセージの分割送信
 */
async function sendLongMessage(interaction, content) {
    if (content.length > 2000) {
        const chunks = content.match(/.{1,2000}/g);
        await interaction.editReply({ content: chunks[0] });
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i], ephemeral: true });
        }
    } else {
        await interaction.editReply({ content: content });
    }
}

/**
 * Bot起動関数
 */
function startBot() {
    console.log('🚀 Discord note AI生成プラン Bot を起動中...');
    client.login(DISCORD_TOKEN);
}

/**
 * プロセス終了時のクリーンアップ
 */
process.on('SIGINT', async () => {
    console.log('🛑 Bot終了処理を開始...');
    
    // ジョブキューのクリーンアップ
    try {
        await jobQueue.close();
    } catch (error) {
        console.error('ジョブキュー終了エラー:', error);
    }
    
    // Discord クライアント終了
    if (client) {
        client.destroy();
    }
    
    console.log('✅ Bot終了処理完了');
    process.exit(0);
});

module.exports = {
    client,
    startBot,
    getConversation,
    updateConversation,
    conversationMemory,
    botStats
};
