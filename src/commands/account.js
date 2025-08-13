// account.js - アカウント管理・認証コマンド群
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const authService = require('../services/authService');
const creditService = require('../services/creditService');
const jobQueue = require('../services/jobQueue');
const User = require('../models/User');
const validators = require('../utils/validators');

const accountCommands = [
    // リデンプションコマンド
    new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('🔑 リデンプションコードでnote AI生成プランに登録')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('note購入時に受け取ったリデンプションコード (NOTE-XXXX-XXXX-XXXX)')
                .setRequired(true)
                .setMinLength(19)
                .setMaxLength(19)
        ),

    // アカウント情報確認
    new SlashCommandBuilder()
        .setName('account')
        .setDescription('👤 アカウント情報・会員ステータス確認')
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('詳細情報を表示する')
                .setRequired(false)
        ),

    // クレジット残高確認
    new SlashCommandBuilder()
        .setName('credits')
        .setDescription('💳 クレジット残高・使用履歴確認')
        .addStringOption(option =>
            option.setName('period')
                .setDescription('履歴表示期間')
                .setRequired(false)
                .addChoices(
                    { name: '今日', value: 'today' },
                    { name: '1週間', value: 'week' },
                    { name: '1ヶ月', value: 'month' },
                    { name: '全期間', value: 'all' }
                )
        ),

    // 使用履歴表示
    new SlashCommandBuilder()
        .setName('history')
        .setDescription('📊 AI生成履歴・統計情報')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('表示件数 (1-20)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)
        ),

    // DM設定
    new SlashCommandBuilder()
        .setName('dm-settings')
        .setDescription('📬 DM通知設定の変更')
        .addBooleanOption(option =>
            option.setName('completion')
                .setDescription('生成完了時のDM通知')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('errors')
                .setDescription('エラー発生時のDM通知')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('credit_alerts')
                .setDescription('クレジット残高警告')
                .setRequired(false)
        ),

    // ジョブ管理
    new SlashCommandBuilder()
        .setName('jobs')
        .setDescription('🔄 実行中・最近のジョブ確認')
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('ジョブフィルター')
                .setRequired(false)
                .addChoices(
                    { name: '実行中のみ', value: 'active' },
                    { name: '完了済みのみ', value: 'completed' },
                    { name: '失敗したもの', value: 'failed' },
                    { name: 'すべて', value: 'all' }
                )
        ),

    // アカウント削除
    new SlashCommandBuilder()
        .setName('delete-account')
        .setDescription('🗑️ アカウント削除（注意：復元不可）')
        .addStringOption(option =>
            option.setName('confirmation')
                .setDescription('削除を確認するには "DELETE MY ACCOUNT" と入力してください')
                .setRequired(true)
        )
];

/**
 * リデンプションコマンド処理
 */
async function handleRedemption(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const code = interaction.options.getString('code');
        const userId = interaction.user.id;

        // コード形式検証
        const validation = validators.validateRedemptionCode(code);
        if (!validation.isValid) {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ コード形式エラー',
                    validation.errors.join('\n'),
                    '正しい形式: NOTE-XXXX-XXXX-XXXX'
                )]
            });
        }

        // リデンプション実行
        const result = await authService.redeemCode(userId, validation.formattedCode);

        if (result.success) {
            // 成功時の表示
            const embed = new EmbedBuilder()
                .setTitle('🎉 リデンプション完了！')
                .setDescription('note AI生成プランへの登録が完了しました')
                .addFields(
                    { name: '📧 登録メール', value: result.noteEmail, inline: true },
                    { name: '💳 付与クレジット', value: `${result.credits}`, inline: true },
                    { name: '📅 有効期限', value: new Date(result.user.subscriptionEnd).toLocaleDateString('ja-JP'), inline: true },
                    { name: '🎯 次のステップ', value: 'AI生成コマンドを試してみましょう！' }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'ご利用ありがとうございます！' });

            const gettingStartedButton = new ButtonBuilder()
                .setCustomId('getting_started')
                .setLabel('使い方ガイド')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📖');

            const firstGenerationButton = new ButtonBuilder()
                .setCustomId('first_generation')
                .setLabel('初回生成 (20%OFF)')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🎨');

            const components = [
                new ActionRowBuilder().addComponents(gettingStartedButton, firstGenerationButton)
            ];

            await interaction.editReply({
                embeds: [embed],
                components: components
            });

        } else {
            // エラー時の表示
            let errorTitle = '❌ リデンプションエラー';
            let errorDescription = result.message;
            let errorFooter = null;

            switch (result.error) {
                case 'INVALID_CODE':
                    errorTitle = '❌ 無効なコード';
                    errorFooter = 'noteでの購入完了メールを確認してください';
                    break;
                case 'EXPIRED_CODE':
                    errorTitle = '⏰ 期限切れコード';
                    errorFooter = 'サポートまでお問い合わせください';
                    break;
                case 'ALREADY_REGISTERED':
                    errorTitle = '⚠️ 登録済みアカウント';
                    errorFooter = '/account コマンドで詳細を確認できます';
                    break;
                case 'DISCORD_ALREADY_USED':
                    errorTitle = '⚠️ Discord ID使用済み';
                    errorFooter = '1つのDiscordアカウントには1つのコードのみ使用可能です';
                    break;
            }

            await interaction.editReply({
                embeds: [createErrorEmbed(errorTitle, errorDescription, errorFooter)]
            });
        }

    } catch (error) {
        console.error('リデンプション処理エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed(
                '❌ システムエラー',
                'システムエラーが発生しました。しばらく後にお試しください。'
            )]
        });
    }
}

/**
 * アカウント情報表示
 */
async function handleAccountInfo(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const userId = interaction.user.id;
        const detailed = interaction.options.getBoolean('detailed') || false;

        // 会員情報取得
        const membership = await authService.checkMembership(userId);

        if (!membership.isRegistered) {
            return await interaction.editReply({
                embeds: [createInfoEmbed(
                    '📝 未登録アカウント',
                    'note AI生成プランに登録していません',
                    '登録するには `/redeem コード` を実行してください'
                )],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('note AI生成プランを見る')
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://note.com/your-plan-url')
                            .setEmoji('🛒')
                    )
                ]
            });
        }

        // 今日の使用状況
        const todayUsage = await authService.getTodayUsage(userId);

        // 月間統計
        const monthlyStats = await membership.user.getMonthlyStats();

        // 基本情報表示
        const embed = new EmbedBuilder()
            .setTitle('👤 アカウント情報')
            .setDescription(membership.message)
            .addFields(
                { name: '📧 登録メール', value: membership.noteEmail || 'N/A', inline: true },
                { name: '📊 会員ステータス', value: membership.membershipStatus, inline: true },
                { name: '📅 有効期限', value: new Date(membership.subscriptionEnd).toLocaleDateString('ja-JP'), inline: true },
                { name: '💳 利用可能クレジット', value: `${membership.credits}`, inline: true },
                { name: '🔒 予約中クレジット', value: `${membership.reservedCredits}`, inline: true },
                { name: '📊 総クレジット', value: `${membership.totalCredits}`, inline: true }
            )
            .setColor(membership.isActive ? 0x00ff00 : 0xffa500)
            .setTimestamp();

        // 今日の使用状況
        if (todayUsage.generationCount > 0 || todayUsage.creditsUsed > 0) {
            embed.addFields(
                { name: '📅 今日の使用状況', value: `生成回数: ${todayUsage.generationCount}回\nクレジット: ${todayUsage.creditsUsed}`, inline: true }
            );
        }

        // 詳細情報表示
        if (detailed && monthlyStats) {
            embed.addFields(
                { name: '📊 今月の統計', value: `生成回数: ${monthlyStats.totalGenerations}回\n完了率: ${Math.round((monthlyStats.completedGenerations / monthlyStats.totalGenerations) * 100)}%`, inline: true },
                { name: '🤖 よく使うモデル', value: monthlyStats.favoriteModel || 'なし', inline: true }
            );
        }

        // 有効期限警告
        if (membership.daysRemaining <= 7 && membership.daysRemaining > 0) {
            embed.addFields(
                { name: '⚠️ 有効期限警告', value: `あと${membership.daysRemaining}日で期限切れです` }
            );
        }

        // アクションボタン
        const buttons = [];

        if (membership.isActive) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId('view_credits')
                    .setLabel('クレジット詳細')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('💳')
            );
        }

        buttons.push(
            new ButtonBuilder()
                .setCustomId('dm_settings')
                .setLabel('DM設定')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📬')
        );

        if (membership.daysRemaining <= 7) {
            buttons.push(
                new ButtonBuilder()
                    .setLabel('プラン更新')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://note.com/your-plan-url')
                    .setEmoji('🔄')
            );
        }

        const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('アカウント情報取得エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ エラー', 'アカウント情報の取得に失敗しました')]
        });
    }
}

/**
 * クレジット情報表示
 */
async function handleCreditsInfo(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const userId = interaction.user.id;
        const period = interaction.options.getString('period') || 'week';

        // 会員チェック
        const membership = await authService.checkMembership(userId);
        if (!membership.isActive) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 認証エラー', membership.message)]
            });
        }

        // クレジット残高詳細取得
        const balance = await creditService.getBalance(membership.user.id);
        if (!balance.success) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ エラー', 'クレジット情報の取得に失敗しました')]
            });
        }

        // 使用統計取得
        const days = {
            'today': 1,
            'week': 7,
            'month': 30,
            'all': 365
        }[period] || 7;

        const stats = await creditService.getUsageStats(membership.user.id, days);

        // 埋め込み作成
        const embed = new EmbedBuilder()
            .setTitle('💳 クレジット情報')
            .setDescription('現在のクレジット残高と使用状況')
            .addFields(
                { name: '💰 利用可能', value: `${balance.availableCredits}`, inline: true },
                { name: '🔒 予約中', value: `${balance.reservedCredits}`, inline: true },
                { name: '📊 総取得', value: `${balance.totalCredits}`, inline: true }
            )
            .setColor(0x0099ff)
            .setTimestamp();

        // 予約詳細
        if (balance.activeReservations > 0) {
            const reservationDetails = balance.reservationDetails
                .slice(0, 3)
                .map(r => `• ${r.amount}クレジット (${new Date(r.expiresAt).toLocaleTimeString('ja-JP')})`)
                .join('\n');
            
            embed.addFields(
                { name: '🔒 アクティブな予約', value: reservationDetails || 'なし' }
            );
        }

        // 使用統計
        if (stats.success) {
            embed.addFields(
                { name: `📊 ${period === 'today' ? '今日' : period === 'week' ? '1週間' : period === 'month' ? '1ヶ月' : '全期間'}の使用状況`, value: `消費: ${stats.totalConsumed}\n付与: ${stats.totalGranted}\n返却: ${stats.totalRefunded}` }
            );

            // 人気モデル
            if (Object.keys(stats.modelUsage).length > 0) {
                const topModels = Object.entries(stats.modelUsage)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
                    .map(([model, usage]) => `• ${model}: ${usage}クレジット`)
                    .join('\n');
                
                embed.addFields(
                    { name: '🤖 よく使うモデル', value: topModels }
                );
            }
        }

        // 最終補充日
        if (balance.lastRefill) {
            embed.addFields(
                { name: '🔄 最終補充', value: new Date(balance.lastRefill).toLocaleDateString('ja-JP'), inline: true }
            );
        }

        // アクションボタン
        const buttons = [
            new ButtonBuilder()
                .setCustomId('credit_history')
                .setLabel('詳細履歴')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📋'),
            new ButtonBuilder()
                .setCustomId('usage_prediction')
                .setLabel('使用予測')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📈')
        ];

        const components = [new ActionRowBuilder().addComponents(buttons)];

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('クレジット情報取得エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ エラー', 'クレジット情報の取得に失敗しました')]
        });
    }
}

/**
 * 生成履歴表示
 */
async function handleGenerationHistory(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const userId = interaction.user.id;
        const limit = interaction.options.getInteger('limit') || 10;

        // 会員チェック
        const membership = await authService.checkMembership(userId);
        if (!membership.isActive) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 認証エラー', membership.message)]
            });
        }

        // ジョブ履歴取得
        const jobs = await jobQueue.getUserActiveJobs(membership.user.id);
        
        if (jobs.length === 0) {
            return await interaction.editReply({
                embeds: [createInfoEmbed(
                    '📊 生成履歴',
                    '生成履歴がありません',
                    'AI生成コマンドを試してみましょう！'
                )]
            });
        }

        // 履歴埋め込み作成
        const embed = new EmbedBuilder()
            .setTitle('📊 AI生成履歴')
            .setDescription(`最新${Math.min(limit, jobs.length)}件の生成履歴`)
            .setColor(0x0099ff)
            .setTimestamp();

        jobs.slice(0, limit).forEach((job, index) => {
            const statusEmoji = {
                'pending': '⏳',
                'processing': '🔄',
                'completed': '✅',
                'failed': '❌',
                'cancelled': '🚫'
            }[job.status] || '❓';

            const timeAgo = Math.round((Date.now() - new Date(job.createdAt).getTime()) / 60000);
            
            embed.addFields({
                name: `${statusEmoji} ${job.type.toUpperCase()} #${index + 1}`,
                value: `**モデル:** ${job.model}\n**ステータス:** ${job.status}\n**作成:** ${timeAgo}分前\n**クレジット:** ${job.creditsUsed || job.creditsReserved || 'N/A'}`,
                inline: true
            });
        });

        // 統計情報
        const totalJobs = jobs.length;
        const completedJobs = jobs.filter(j => j.status === 'completed').length;
        const totalCredits = jobs.reduce((sum, j) => sum + (j.creditsUsed || 0), 0);

        embed.addFields({
            name: '📈 統計情報',
            value: `総生成数: ${totalJobs}\n完了率: ${Math.round((completedJobs / totalJobs) * 100)}%\n総消費クレジット: ${totalCredits}`
        });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('生成履歴取得エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ エラー', '生成履歴の取得に失敗しました')]
        });
    }
}

/**
 * DM設定変更
 */
async function handleDMSettings(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const userId = interaction.user.id;
        const completion = interaction.options.getBoolean('completion');
        const errors = interaction.options.getBoolean('errors');
        const creditAlerts = interaction.options.getBoolean('credit_alerts');

        // 会員チェック
        const membership = await authService.checkMembership(userId);
        if (!membership.isRegistered) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 認証エラー', '登録されていないアカウントです')]
            });
        }

        // 現在の設定取得
        const currentPrefs = membership.user.getDMPreferences();

        // 新しい設定
        const newPrefs = {
            enableCompletionDM: completion !== null ? completion : currentPrefs.enableCompletionDM,
            enableErrorDM: errors !== null ? errors : currentPrefs.enableErrorDM,
            enableCreditAlerts: creditAlerts !== null ? creditAlerts : currentPrefs.enableCreditAlerts
        };

        // 設定更新
        const updateSuccess = await membership.user.updateDMPreferences(newPrefs);

        if (updateSuccess) {
            const embed = new EmbedBuilder()
                .setTitle('📬 DM設定更新完了')
                .setDescription('DM通知設定を更新しました')
                .addFields(
                    { name: '✅ 生成完了通知', value: newPrefs.enableCompletionDM ? 'ON' : 'OFF', inline: true },
                    { name: '❌ エラー通知', value: newPrefs.enableErrorDM ? 'ON' : 'OFF', inline: true },
                    { name: '💳 クレジット警告', value: newPrefs.enableCreditAlerts ? 'ON' : 'OFF', inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply({
                embeds: [createErrorEmbed('❌ エラー', 'DM設定の更新に失敗しました')]
            });
        }

    } catch (error) {
        console.error('DM設定エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ エラー', 'DM設定の更新に失敗しました')]
        });
    }
}

/**
 * ジョブ管理
 */
async function handleJobsManagement(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const userId = interaction.user.id;
        const filter = interaction.options.getString('filter') || 'all';

        // 会員チェック
        const membership = await authService.checkMembership(userId);
        if (!membership.isActive) {
            return await interaction.editReply({
                embeds: [createErrorEmbed('❌ 認証エラー', membership.message)]
            });
        }

        // アクティブジョブ取得
        const activeJobs = await jobQueue.getUserActiveJobs(membership.user.id);

        const embed = new EmbedBuilder()
            .setTitle('🔄 ジョブ管理')
            .setDescription('現在のジョブ状況')
            .setColor(0x0099ff)
            .setTimestamp();

        if (activeJobs.length === 0) {
            embed.addFields({
                name: '📊 ジョブ状況',
                value: '実行中のジョブはありません'
            });
        } else {
            activeJobs.forEach((job, index) => {
                const statusEmoji = {
                    'pending': '⏳',
                    'processing': '🔄',
                    'completed': '✅',
                    'failed': '❌'
                }[job.status] || '❓';

                embed.addFields({
                    name: `${statusEmoji} ジョブ #${index + 1}`,
                    value: `**ID:** ${job.id}\n**タイプ:** ${job.type}\n**ステータス:** ${job.status}\n**経過時間:** ${job.elapsedTime}秒`,
                    inline: true
                });
            });
        }

        const buttons = [];
        
        if (activeJobs.length > 0) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId('refresh_jobs')
                    .setLabel('更新')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄')
            );
        }

        const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('ジョブ管理エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ エラー', 'ジョブ情報の取得に失敗しました')]
        });
    }
}

/**
 * アカウント削除
 */
async function handleAccountDeletion(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const confirmation = interaction.options.getString('confirmation');
        const userId = interaction.user.id;

        if (confirmation !== 'DELETE MY ACCOUNT') {
            return await interaction.editReply({
                embeds: [createErrorEmbed(
                    '❌ 確認失敗',
                    '正確に "DELETE MY ACCOUNT" と入力してください',
                    'アカウント削除は元に戻せません'
                )]
            });
        }

        // 実際の削除処理は慎重に実装
        return await interaction.editReply({
            embeds: [createInfoEmbed(
                '🚧 機能開発中',
                'アカウント削除機能は現在開発中です',
                'データ削除が必要な場合はサポートまでご連絡ください'
            )]
        });

    } catch (error) {
        console.error('アカウント削除エラー:', error);
        await interaction.editReply({
            embeds: [createErrorEmbed('❌ エラー', 'アカウント削除処理に失敗しました')]
        });
    }
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
 * 情報埋め込み作成
 */
function createInfoEmbed(title, description, footer = null) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0x0099ff)
        .setTimestamp();

    if (footer) {
        embed.setFooter({ text: footer });
    }

    return embed;
}

/**
 * ボタンインタラクション処理
 */
async function handleButtonInteraction(interaction) {
    const customId = interaction.customId;

    switch (customId) {
        case 'getting_started':
            await handleGettingStarted(interaction);
            break;
        case 'first_generation':
            await handleFirstGeneration(interaction);
            break;
        case 'view_credits':
            await handleViewCredits(interaction);
            break;
        case 'dm_settings':
            await handleDMSettingsButton(interaction);
            break;
        case 'credit_history':
            await handleCreditHistory(interaction);
            break;
        case 'refresh_jobs':
            await handleRefreshJobs(interaction);
            break;
        default:
            await interaction.reply({
                content: '❌ 不明なアクションです',
                ephemeral: true
            });
    }
}

/**
 * 使い方ガイド表示
 */
async function handleGettingStarted(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('📖 AI生成Bot 使い方ガイド')
        .setDescription('note AI生成プランの機能をフル活用しましょう！')
        .addFields(
            { name: '🎨 画像生成', value: '`/gen-image プロンプト` - AIで画像を生成\n• DALL·E 3, Stable Diffusion等が利用可能' },
            { name: '🎬 動画生成', value: '`/gen-video プロンプト` - AIで短時間動画を生成\n• 高コストなのでご注意ください' },
            { name: '🎵 音声生成', value: '`/gen-audio テキスト` - AIでテキスト読み上げ\n• 自然な音声で多言語対応' },
            { name: '💳 クレジット管理', value: '`/credits` - 残高確認\n`/account` - アカウント情報' },
            { name: '📱 便利機能', value: '• 完了時DM通知\n• X(Twitter)投稿ボタン\n• 生成履歴管理' }
        )
        .setColor(0x0099ff)
        .setTimestamp()
        .setFooter({ text: '困ったときはサポートまでお気軽にどうぞ！' });

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

/**
 * 初回生成案内
 */
async function handleFirstGeneration(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🎨 初回生成特典')
        .setDescription('最初の生成は20%OFFでお試しいただけます！')
        .addFields(
            { name: '🌟 おすすめプロンプト', value: '• "a cute cat sitting in a garden, digital art"\n• "futuristic city at sunset, cyberpunk style"\n• "minimalist logo design, clean and modern"' },
            { name: '💡 コツ', value: '• 英語での指定が高品質\n• 具体的な描写を心がける\n• アートスタイルを指定する' }
        )
        .setColor(0x00ff00)
        .setFooter({ text: '初回特典は最初の3回まで適用されます' });

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

module.exports = {
    commands: accountCommands,
    handlers: {
        'redeem': handleRedemption,
        'account': handleAccountInfo,
        'credits': handleCreditsInfo,
        'history': handleGenerationHistory,
        'dm-settings': handleDMSettings,
        'jobs': handleJobsManagement,
        'delete-account': handleAccountDeletion
    },
    buttonHandler: handleButtonInteraction
};
