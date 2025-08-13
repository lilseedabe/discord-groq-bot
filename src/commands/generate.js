// generate.js - AI生成コマンド群（X投稿統合版）
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const authService = require('../services/authService');
const creditService = require('../services/creditService');
const jobQueue = require('../services/jobQueue');
const edenService = require('../services/edenService');
const xIntentService = require('../services/xIntentService');
const creditCalculator = require('../utils/creditCalculator');
const validators = require('../utils/validators');

const generateCommands = [
    // 画像生成コマンド
    new SlashCommandBuilder()
        .setName('gen-image')
        .setDescription('🎨 AI画像生成（note会員限定）')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('生成したい画像の説明')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(1000)
        )
        .addStringOption(option =>
            option.setName('model')
                .setDescription('使用するAIモデル')
                .setRequired(false)
                .addChoices(
                    { name: 'Replicate Anime Style (0.23クレ) - アニメ風高速生成', value: 'replicate/anime-style' },
                    { name: 'Replicate Vintedois (0.23クレ) - ヴィンテージ風', value: 'replicate/vintedois-diffusion' },
                    { name: 'Replicate Classic (1.15クレ) - クラシックスタイル', value: 'replicate/classic' },
                    { name: 'MiniMax Image-01 (3.5クレ) - 任意サイズ対応', value: 'minimax/image-01' },
                    { name: 'Amazon Titan Standard (8クレ) - 商用品質', value: 'amazon/titan-image-generator-v1_standard' },
                    { name: 'Leonardo Lightning XL (11クレ) - 高速高品質', value: 'leonardo/lightning-xl' },
                    { name: 'DALL·E 2 (16クレ) - バランス重視', value: 'openai/dall-e-2' },
                    { name: 'DALL·E 3 (40クレ) - 最高品質', value: 'openai/dall-e-3' },
                    { name: 'Stable Diffusion XL (15クレ) - 高解像度', value: 'stabilityai/stable-diffusion-xl' }
                )
        )
        .addStringOption(option =>
            option.setName('size')
                .setDescription('画像サイズ')
                .setRequired(false)
                .addChoices(
                    { name: '正方形 (1024x1024)', value: '1024x1024' },
                    { name: '横長 (1792x1024)', value: '1792x1024' },
                    { name: '縦長 (1024x1792)', value: '1024x1792' },
                    { name: '高解像度正方形 (1152x896)', value: '1152x896' }
                )
        )
        .addIntegerOption(option =>
            option.setName('quantity')
                .setDescription('生成枚数 (1-4枚)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(4)
        )
        .addStringOption(option =>
            option.setName('style')
                .setDescription('生成スタイル (DALL·E 3のみ)')
                .setRequired(false)
                .addChoices(
                    { name: 'Vivid - 鮮やかで劇的', value: 'vivid' },
                    { name: 'Natural - 自然で控えめ', value: 'natural' }
                )
        )
        .addStringOption(option =>
            option.setName('quality')
                .setDescription('画像品質 (DALL·E専用)')
                .setRequired(false)
                .addChoices(
                    { name: 'Standard - 標準品質', value: 'standard' },
                    { name: 'HD - 高画質 (1.5倍料金)', value: 'hd' }
                )
        ),

    // 動画生成コマンド
    new SlashCommandBuilder()
        .setName('gen-video')
        .setDescription('🎬 AI動画生成（note会員限定・高コスト注意）')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('生成したい動画の説明')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(500)
        )
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('動画の長さ（秒）')
                .setRequired(false)
                .setMinValue(2)
                .setMaxValue(8)
        )
        .addStringOption(option =>
            option.setName('size')
                .setDescription('動画解像度')
                .setRequired(false)
                .addChoices(
                    { name: '横長 HD (1280x768)', value: '1280x768' },
                    { name: '縦長 HD (768x1280)', value: '768x1280' },
                    { name: '正方形 HD (1024x1024)', value: '1024x1024' }
                )
        )
        .addStringOption(option =>
            option.setName('model')
                .setDescription('使用する動画生成モデル')
                .setRequired(false)
                .addChoices(
                    { name: 'MiniMax T2V Director (430クレ) - バランス重視', value: 'minimax/T2V/I2V-01-Director' },
                    { name: 'Amazon Nova Reel (500クレ) - 商用動画', value: 'amazon/amazon.nova-reel-v1:0' },
                    { name: 'MiniMax Hailuo 02 (560クレ) - 進化版', value: 'minimax/MiniMax-Hailuo-02' },
                    { name: 'MiniMax S2V-01 (650クレ) - Scene to Video', value: 'minimax/S2V-01' },
                    { name: 'ByteDance SeeDance Lite (1800クレ) - 軽量版', value: 'bytedance/seedance-lite' },
                    { name: 'ByteDance SeeDance Pro (2250クレ) - プロ版', value: 'bytedance/seedance-pro' },
                    { name: 'Google Veo 3.0 (6000クレ) - 最高品質・全消費', value: 'google/veo-3.0-generate-preview' }
                )
        ),


];

/**
 * 画像生成コマンド処理
 */
async function handleImageGeneration(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const prompt = interaction.options.getString('prompt');
        const model = interaction.options.getString('model') || 'replicate/classic';
        const size = interaction.options.getString('size') || '1024x1024';
        const quantity = interaction.options.getInteger('quantity') || 1;
        const style = interaction.options.getString('style') || 'natural';
        const quality = interaction.options.getString('quality') || 'standard';

        const userId = interaction.user.id;

        // 1. 会員認証
        const membership = await authService.checkMembership(userId);
        if (!membership.isActive) {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ 認証エラー',
                    membership.message,
                    'リデンプションコードで会員登録してください: `/redeem コード`'
                )]
            });
        }

        // 2. 入力検証
        const validation = validators.validateAll({
            prompt: prompt,
            type: 'image',
            model: model,
            options: { size, quantity, style, quality }
        });

        if (!validation.isValid) {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ 入力エラー',
                    validation.errors.join('\n'),
                    validation.warnings.length > 0 ? validation.warnings.join('\n') : null
                )]
            });
        }

        // 3. コスト計算
        const costResult = creditCalculator.calculateImageCost(model, {
            quantity,
            size,
            quality,
            style
        });

        // 4. 使用制限チェック
        const limitCheck = await authService.checkUsageLimits(userId, costResult.totalCost);
        if (!limitCheck.allowed) {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ 使用制限',
                    limitCheck.message
                )]
            });
        }

        // 5. ジョブキューに追加
        const jobResult = await jobQueue.addGenerationJob(
            membership.user.id,
            'image',
            model,
            validation.validatedData.prompt,
            validation.validatedData.options,
            costResult.totalCost
        );

        if (!jobResult.success) {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ 生成エラー',
                    jobResult.error
                )]
            });
        }

        // 6. 進行状況表示
        const embed = createProgressEmbed(
            '🎨 画像生成開始',
            prompt,
            model,
            costResult.totalCost,
            membership.credits - costResult.totalCost,
            jobResult.estimatedTime,
            jobResult.jobId
        );

        const components = createProgressButtons(jobResult.jobId, 'image');

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('画像生成コマンドエラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed(
                '❌ システムエラー',
                'システムエラーが発生しました。しばらく後にお試しください。'
            )]
        });
    }
}

/**
 * 動画生成コマンド処理
 */
async function handleVideoGeneration(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const prompt = interaction.options.getString('prompt');
        const duration = interaction.options.getInteger('duration') || 4;
        const size = interaction.options.getString('size') || '1280x768';
        const model = interaction.options.getString('model') || 'minimax/T2V/I2V-01-Director'; // 現在は1つのみサポート

        const userId = interaction.user.id;

        // 会員認証
        const membership = await authService.checkMembership(userId);
        if (!membership.isActive) {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ 認証エラー',
                    membership.message
                )]
            });
        }

        // 高コスト警告
        const costResult = creditCalculator.calculateVideoCost(model, { duration, resolution: size });
        
        if (costResult.totalCost > 200) {
            return await interaction.editReply({
                embeds: [createWarningEmbed(
                    '⚠️ 高コスト注意',
                    `動画生成は${costResult.totalCost}クレジットを消費します`,
                    'この操作を続行するには `/confirm-video` コマンドを使用してください'
                )]
            });
        }

        // 処理継続...（画像生成と同様の流れ）
        const validation = validators.validateAll({
            prompt: prompt,
            type: 'video',
            model: model,
            options: { duration, size }
        });

        if (!validation.isValid) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 入力エラー', validation.errors.join('\n'))]
            });
        }

        const limitCheck = await authService.checkUsageLimits(userId, costResult.totalCost);
        if (!limitCheck.allowed) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 使用制限', limitCheck.message)]
            });
        }

        const jobResult = await jobQueue.addGenerationJob(
            membership.user.id,
            'video',
            model,
            validation.validatedData.prompt,
            validation.validatedData.options,
            costResult.totalCost
        );

        if (!jobResult.success) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 生成エラー', jobResult.error)]
            });
        }

        const embed = createProgressEmbed(
            '🎬 動画生成開始',
            prompt,
            model,
            costResult.totalCost,
            membership.credits - costResult.totalCost,
            jobResult.estimatedTime,
            jobResult.jobId
        );

        const components = createProgressButtons(jobResult.jobId, 'video');

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('動画生成コマンドエラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ システムエラー', 'システムエラーが発生しました')]
        });
    }
}



/**
 * 進行状況表示用埋め込み作成
 */
function createProgressEmbed(title, prompt, model, creditsUsed, remainingCredits, estimatedTime, jobId) {
    const modelDisplayNames = {
        'replicate/anime-style': 'Replicate Anime Style',
        'replicate/vintedois-diffusion': 'Replicate Vintedois',
        'replicate/classic': 'Replicate Classic',
        'minimax/image-01': 'MiniMax Image-01',
        'amazon/titan-image-generator-v1_standard': 'Amazon Titan Standard',
        'amazon/titan-image-generator-v1_premium': 'Amazon Titan Premium',
        'leonardo/lightning-xl': 'Leonardo Lightning XL',
        'leonardo/anime-xl': 'Leonardo Anime XL',
        'openai/dall-e-2': 'DALL·E 2',
        'openai/dall-e-3': 'DALL·E 3',
        'bytedance/seedream-3-0-t2i': 'ByteDance SeeDream 3.0',
        'stabilityai/stable-diffusion-v1-6': 'Stable Diffusion v1.6',
        'stabilityai/stable-diffusion-xl': 'Stable Diffusion XL',
        'minimax/T2V/I2V-01-Director': 'MiniMax T2V Director',
        'amazon/amazon.nova-reel-v1:0': 'Amazon Nova Reel',
        'minimax/MiniMax-Hailuo-02': 'MiniMax Hailuo 02',
        'minimax/S2V-01': 'MiniMax S2V-01',
        'bytedance/seedance-lite': 'ByteDance SeeDance Lite',
        'bytedance/seedance-pro': 'ByteDance SeeDance Pro',
        'google/veo-3.0-generate-preview': 'Google Veo 3.0'
    };

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription('AI生成を開始しました。完了までお待ちください...')
        .addFields(
            { 
                name: '📝 プロンプト', 
                value: prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt 
            },
            { 
                name: '🤖 モデル', 
                value: modelDisplayNames[model] || model, 
                inline: true 
            },
            { 
                name: '💳 使用クレジット', 
                value: `${creditsUsed}`, 
                inline: true 
            },
            { 
                name: '💰 残りクレジット', 
                value: `${remainingCredits}`, 
                inline: true 
            },
            { 
                name: '⏱️ 推定時間', 
                value: `約${estimatedTime}秒`, 
                inline: true 
            },
            { 
                name: '🆔 ジョブID', 
                value: jobId, 
                inline: true 
            }
        )
        .setColor(0xffa500)
        .setTimestamp()
        .setFooter({ text: '完了時にDMまたはこのチャンネルで通知されます（X投稿機能付き）' });
}

/**
 * 進行状況表示用ボタン作成（X投稿機能統合版）
 */
function createProgressButtons(jobId, type) {
    const dmButton = new ButtonBuilder()
        .setCustomId(`dm_result_${jobId}`)
        .setLabel('完了時にDMで受け取る')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📬');

    const statusButton = new ButtonBuilder()
        .setCustomId(`status_${jobId}`)
        .setLabel('進行状況確認')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📊');

    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_${jobId}`)
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const shareInfoButton = new ButtonBuilder()
        .setCustomId(`share_info_${jobId}`)
        .setLabel('X投稿機能を確認')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🐦');

    return [
        new ActionRowBuilder().addComponents(dmButton, statusButton, cancelButton),
        new ActionRowBuilder().addComponents(shareInfoButton)
    ];
}

/**
 * エラー埋め込み作成
 */
function createErrorEmbed(title, description, footer = null) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xff0000)
        .setTimestamp();

    if (footer) {
        embed.setFooter({ text: footer });
    }

    return embed;
}

/**
 * 警告埋め込み作成
 */
function createWarningEmbed(title, description, footer = null) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xffa500)
        .setTimestamp();

    if (footer) {
        embed.setFooter({ text: footer });
    }

    return embed;
}

/**
 * ボタンインタラクション処理（X投稿機能統合版）
 */
async function handleButtonInteraction(interaction) {
    const [action, ...params] = interaction.customId.split('_');

    switch (action) {
        case 'dm':
            await handleDMRequest(interaction, params.slice(1).join('_'));
            break;
        case 'status':
            await handleStatusCheck(interaction, params[0]);
            break;
        case 'cancel':
            await handleJobCancel(interaction, params[0]);
            break;
        case 'share':
            if (params[0] === 'info') {
                await handleShareInfo(interaction, params[1]);
            }
            break;
        case 'regenerate':
            await handleRegenerate(interaction, params);
            break;
        default:
            await interaction.reply({
                content: '❌ 不明なアクションです',
                ephemeral: true
            });
    }
}

/**
 * DM受取設定
 */
async function handleDMRequest(interaction, jobId) {
    // DM設定処理
    await interaction.reply({
        content: '📬 完了時にDMで通知するように設定しました（X投稿ボタン付き）',
        ephemeral: true
    });
}

/**
 * ステータス確認
 */
async function handleStatusCheck(interaction, jobId) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const status = await jobQueue.getJobStatus(jobId);
        
        if (!status.success) {
            return await interaction.editReply({
                content: '❌ ジョブが見つかりません'
            });
        }

        const job = status.job;
        const queueStatus = status.queueStatus;

        const embed = new EmbedBuilder()
            .setTitle('📊 ジョブ進行状況')
            .addFields(
                { name: '🆔 ジョブID', value: job.id, inline: true },
                { name: '📊 ステータス', value: job.status, inline: true },
                { name: '⏱️ 経過時間', value: `${job.elapsedTime}秒`, inline: true }
            )
            .setColor(job.isProcessing ? 0xffa500 : job.isCompleted ? 0x00ff00 : 0xff0000)
            .setTimestamp();

        if (queueStatus) {
            embed.addFields(
                { name: '📈 進捗', value: `${queueStatus.progress}%`, inline: true },
                { name: '🔄 試行回数', value: `${queueStatus.attempts}`, inline: true }
            );
        }

        // 完了した場合はX投稿リンクも表示
        if (job.isCompleted && job.xPostUrl) {
            embed.addFields(
                { name: '🐦 X投稿', value: `[投稿用リンク](${job.xPostUrl})` }
            );
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('ステータス確認エラー:', error);
        await interaction.editReply({
            content: '❌ ステータス確認に失敗しました'
        });
    }
}

/**
 * ジョブキャンセル
 */
async function handleJobCancel(interaction, jobId) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const cancelResult = await jobQueue.cancelJob(jobId, interaction.user.id);
        
        if (cancelResult.success) {
            await interaction.editReply({
                content: '✅ ジョブをキャンセルしました。クレジットは返却されます。'
            });
        } else {
            await interaction.editReply({
                content: `❌ キャンセルできませんでした: ${cancelResult.error}`
            });
        }

    } catch (error) {
        console.error('ジョブキャンセルエラー:', error);
        await interaction.editReply({
            content: '❌ キャンセル処理に失敗しました'
        });
    }
}

/**
 * X投稿共有情報表示
 */
async function handleShareInfo(interaction, jobId) {
    await interaction.deferReply({ ephemeral: true });

    try {
        // ジョブ情報取得
        const status = await jobQueue.getJobStatus(jobId);
        
        if (!status.success) {
            return await interaction.editReply({
                content: '❌ ジョブが見つかりません'
            });
        }

        const job = status.job;

        if (!job.isCompleted && !job.resultUrl) {
            return await interaction.editReply({
                content: '❌ 完了したジョブのみX投稿機能を利用できます。生成完了後に再度お試しください。'
            });
        }

        // X投稿プレビュー生成
        const preview = xIntentService.getPostPreview(
            job.resultUrl,
            job.prompt,
            job.model,
            job.type,
            { includeModel: true }
        );

        const embed = new EmbedBuilder()
            .setTitle('🐦 X(Twitter)投稿プレビュー')
            .setDescription('以下の内容でXに投稿できます：')
            .addFields(
                { 
                    name: '📝 投稿テキスト', 
                    value: `\`\`\`${preview.adjustedText}\`\`\`` 
                },
                { 
                    name: '📊 文字数', 
                    value: `${preview.textLength}/280文字`, 
                    inline: true 
                },
                { 
                    name: '✅ 制限状況', 
                    value: preview.isWithinLimit ? '正常' : '超過', 
                    inline: true 
                },
                {
                    name: '🔗 コンテンツ',
                    value: job.resultUrl ? '[生成結果を表示](' + job.resultUrl + ')' : 'URLなし',
                    inline: true
                }
            )
            .setColor(preview.isWithinLimit ? 0x1da1f2 : 0xff6b35)
            .setTimestamp();

        // 投稿ボタン群作成
        const buttons = [];

        // 標準のX投稿ボタン
        if (job.resultUrl) {
            const standardButton = xIntentService.createOptimizedButton({
                url: job.resultUrl,
                type: job.type,
                model: job.model,
                prompt: job.prompt
            });
            buttons.push(standardButton);
        }

        // シンプル投稿ボタン
        const simpleText = `noteのAI生成Botで${job.type === 'image' ? '画像' : job.type === 'video' ? '動画' : '音声'}を作成しました！ #AI生成 #note #Discord`;
        const simpleButton = new ButtonBuilder()
            .setLabel('シンプル投稿')
            .setStyle(ButtonStyle.Link)
            .setURL(xIntentService.createIntentUrl(simpleText, job.resultUrl))
            .setEmoji('✨');
        buttons.push(simpleButton);

        // カスタム投稿ボタン（詳細版）
        const detailedText = xIntentService.createCustomPost(
            'AI{{type}}生成完了！\n\n「{{prompt}}」\n\n{{model}}で作成 #AI生成 #{{model}} #noteBot',
            {
                type: job.type === 'image' ? '画像' : job.type === 'video' ? '動画' : '音声',
                prompt: job.prompt.length > 50 ? job.prompt.substring(0, 50) + '...' : job.prompt,
                model: job.model
            },
            job.resultUrl
        );
        const detailedButton = new ButtonBuilder()
            .setLabel('詳細投稿')
            .setStyle(ButtonStyle.Link)
            .setURL(detailedText)
            .setEmoji('📝');
        buttons.push(detailedButton);

        // プロンプトのみ投稿（コンテンツURL無し）
        const promptOnlyButton = new ButtonBuilder()
            .setLabel('プロンプトのみ投稿')
            .setStyle(ButtonStyle.Link)
            .setURL(xIntentService.createIntentUrl(`「${job.prompt}」をAIで生成してみました！ #AI生成 #プロンプト`, ''))
            .setEmoji('💭');
        buttons.push(promptOnlyButton);

        // ボタンを2つずつ配置
        const components = [];
        for (let i = 0; i < buttons.length; i += 2) {
            const row = new ActionRowBuilder();
            row.addComponents(buttons.slice(i, i + 2));
            components.push(row);
        }

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('X投稿情報表示エラー:', error);
        await interaction.editReply({
            content: '❌ X投稿情報の取得に失敗しました。しばらく後にお試しください。'
        });
    }
}

/**
 * 再生成処理
 */
async function handleRegenerate(interaction, params) {
    const [model, type] = params;
    
    await interaction.reply({
        content: `🔄 ${model}での${type}再生成を開始するには、対応するコマンドを使用してください`,
        ephemeral: true
    });
}

module.exports = {
    commands: generateCommands,
    handlers: {
        'gen-image': handleImageGeneration,
        'gen-video': handleVideoGeneration
    },
    buttonHandler: handleButtonInteraction
};
