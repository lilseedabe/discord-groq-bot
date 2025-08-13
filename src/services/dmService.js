// dmService.js - DM送信サービス（X投稿統合版）
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const xIntentService = require('./xIntentService');
const User = require('../models/User');

class DMService {
    constructor() {
        this.client = null; // Discord クライアントは外部から設定
    }

    /**
     * Discord クライアント設定
     * @param {Client} client - Discord.js クライアント
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * 生成完了通知送信
     * @param {string} userId - ユーザーID（Discord ID）
     * @param {string} jobId - ジョブID
     * @param {string} status - ステータス
     * @param {Object} data - 通知データ
     * @returns {Promise<Object>} 送信結果
     */
    async sendJobNotification(userId, jobId, status, data) {
        try {
            if (!this.client) {
                throw new Error('Discord client not set');
            }

            // DM設定確認
            const user = await User.findByDiscordId(userId);
            if (!user) {
                return {
                    success: false,
                    error: 'USER_NOT_FOUND',
                    message: 'ユーザーが見つかりません'
                };
            }

            const dmPrefs = user.getDMPreferences();

            // DM無効の場合はスキップ
            if (status === 'completed' && !dmPrefs.enableCompletionDM) {
                return { success: true, skipped: true, reason: 'DM disabled for completion' };
            }

            if (status === 'failed' && !dmPrefs.enableErrorDM) {
                return { success: true, skipped: true, reason: 'DM disabled for errors' };
            }

            // Discord ユーザー取得
            const discordUser = await this.client.users.fetch(userId);
            if (!discordUser) {
                return {
                    success: false,
                    error: 'DISCORD_USER_NOT_FOUND',
                    message: 'Discord ユーザーが見つかりません'
                };
            }

            // ステータス別処理
            switch (status) {
                case 'completed':
                    return await this.sendCompletionNotification(discordUser, jobId, data);
                case 'failed':
                    return await this.sendErrorNotification(discordUser, jobId, data);
                case 'cancelled':
                    return await this.sendCancellationNotification(discordUser, jobId, data);
                default:
                    return {
                        success: false,
                        error: 'UNKNOWN_STATUS',
                        message: `不明なステータス: ${status}`
                    };
            }

        } catch (error) {
            console.error('DM通知送信エラー:', error);
            return {
                success: false,
                error: 'SEND_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 生成完了通知
     * @param {User} discordUser - Discord ユーザー
     * @param {string} jobId - ジョブID
     * @param {Object} data - 生成データ
     * @returns {Promise<Object>} 送信結果
     */
    async sendCompletionNotification(discordUser, jobId, data) {
        try {
            const { resultUrl, type, model, prompt, creditsUsed, metadata, xPostUrl } = data;

            // 埋め込み作成
            const embed = new EmbedBuilder()
                .setTitle('✅ AI生成完了！')
                .setDescription('生成が正常に完了しました')
                .addFields(
                    { 
                        name: '📝 プロンプト', 
                        value: prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt 
                    },
                    { name: '🤖 モデル', value: this.getModelDisplayName(model), inline: true },
                    { name: '💳 使用クレジット', value: `${creditsUsed}`, inline: true },
                    { name: '🆔 ジョブID', value: jobId, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'noteのAI生成Bot - X投稿ボタンで簡単共有！' });

            // タイプ別の詳細情報追加
            if (type === 'image') {
                embed.setImage(resultUrl);
                if (metadata?.size) {
                    embed.addFields({ name: '📐 サイズ', value: metadata.size, inline: true });
                }
            } else if (type === 'video') {
                embed.addFields({ 
                    name: '🎬 動画', 
                    value: `[動画を開く](${resultUrl})` 
                });
                if (metadata?.duration) {
                    embed.addFields({ name: '⏱️ 時間', value: `${metadata.duration}秒`, inline: true });
                }
            } else if (type === 'audio') {
                embed.addFields({ 
                    name: '🎵 音声', 
                    value: `[音声を再生](${resultUrl})` 
                });
                if (metadata?.voice) {
                    embed.addFields({ name: '🔊 音声', value: metadata.voice, inline: true });
                }
            }

            // アクションボタン作成（X投稿統合）
            const components = this.createCompletionButtons(jobId, {
                url: resultUrl,
                type: type,
                model: model,
                prompt: prompt,
                creditsUsed: creditsUsed,
                metadata: metadata,
                xPostUrl: xPostUrl
            });

            // DM送信
            await discordUser.send({
                embeds: [embed],
                components: components
            });

            return {
                success: true,
                message: 'DM送信完了（X投稿ボタン付き）'
            };

        } catch (error) {
            console.error('完了通知送信エラー:', error);
            
            // フォールバック：シンプルな通知
            try {
                await discordUser.send({
                    content: `✅ AI生成が完了しました！\n🆔 ジョブID: ${jobId}\n🔗 結果: ${data.resultUrl || 'N/A'}\n🐦 X投稿: ${data.xPostUrl || 'N/A'}`
                });
                
                return {
                    success: true,
                    message: 'フォールバック通知送信完了'
                };
            } catch (fallbackError) {
                throw fallbackError;
            }
        }
    }

    /**
     * エラー通知
     * @param {User} discordUser - Discord ユーザー
     * @param {string} jobId - ジョブID
     * @param {Object} data - エラーデータ
     * @returns {Promise<Object>} 送信結果
     */
    async sendErrorNotification(discordUser, jobId, data) {
        try {
            const { error, type, model, prompt, troubleshootingUrl } = data;

            const embed = new EmbedBuilder()
                .setTitle('❌ AI生成エラー')
                .setDescription('生成中にエラーが発生しました')
                .addFields(
                    { name: '📝 プロンプト', value: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '') },
                    { name: '🤖 モデル', value: this.getModelDisplayName(model), inline: true },
                    { name: '❌ エラー', value: error || '不明なエラー' },
                    { name: '🆔 ジョブID', value: jobId, inline: true }
                )
                .setColor(0xff0000)
                .setTimestamp()
                .setFooter({ text: 'サポートが必要な場合はお気軽にご連絡ください' });

            // エラー解決ボタン
            const components = this.createErrorButtons(jobId, {
                type: type,
                model: model,
                prompt: prompt,
                troubleshootingUrl: troubleshootingUrl
            });

            await discordUser.send({
                embeds: [embed],
                components: components
            });

            return {
                success: true,
                message: 'エラー通知送信完了'
            };

        } catch (error) {
            console.error('エラー通知送信エラー:', error);
            throw error;
        }
    }

    /**
     * キャンセル通知
     * @param {User} discordUser - Discord ユーザー
     * @param {string} jobId - ジョブID
     * @param {Object} data - キャンセルデータ
     * @returns {Promise<Object>} 送信結果
     */
    async sendCancellationNotification(discordUser, jobId, data) {
        try {
            const { type, model, prompt } = data;

            const embed = new EmbedBuilder()
                .setTitle('🚫 AI生成キャンセル')
                .setDescription('生成がキャンセルされました')
                .addFields(
                    { name: '📝 プロンプト', value: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '') },
                    { name: '🤖 モデル', value: this.getModelDisplayName(model), inline: true },
                    { name: '🆔 ジョブID', value: jobId, inline: true },
                    { name: '💰 クレジット', value: 'キャンセル時に返却されました', inline: true }
                )
                .setColor(0xffa500)
                .setTimestamp();

            await discordUser.send({ embeds: [embed] });

            return {
                success: true,
                message: 'キャンセル通知送信完了'
            };

        } catch (error) {
            console.error('キャンセル通知送信エラー:', error);
            throw error;
        }
    }

    /**
     * 完了時のアクションボタン作成（X投稿統合）
     * @param {string} jobId - ジョブID
     * @param {Object} result - 生成結果
     * @returns {Array<ActionRowBuilder>} ボタンコンポーネント
     */
    createCompletionButtons(jobId, result) {
        const components = [];

        try {
            // X投稿ボタン
            const xButton = xIntentService.createOptimizedButton(result);
            
            // 再生成ボタン
            const regenerateButton = this.createRegenerateButton(result);

            // 主要ボタン行
            const row1 = new ActionRowBuilder().addComponents(xButton, regenerateButton);
            components.push(row1);

            // 評価・フィードバックボタン
            const ratingButtons = this.createRatingButtons(jobId);
            if (ratingButtons.length > 0) {
                const row2 = new ActionRowBuilder().addComponents(...ratingButtons);
                components.push(row2);
            }

            // その他のシェアオプション
            if (result.url) {
                const additionalShareButtons = this.createAdditionalShareButtons(result);
                if (additionalShareButtons.length > 0) {
                    const row3 = new ActionRowBuilder().addComponents(...additionalShareButtons);
                    components.push(row3);
                }
            }

        } catch (error) {
            console.error('完了ボタン作成エラー:', error);
            // エラー時はボタンなしで送信
        }

        return components;
    }

    /**
     * エラー時のアクションボタン作成
     * @param {string} jobId - ジョブID
     * @param {Object} data - エラーデータ
     * @returns {Array<ActionRowBuilder>} ボタンコンポーネント
     */
    createErrorButtons(jobId, data) {
        const components = [];

        try {
            const buttons = [];

            // トラブルシューティングボタン
            if (data.troubleshootingUrl) {
                const troubleshootButton = new ButtonBuilder()
                    .setLabel('解決方法を確認')
                    .setStyle(ButtonStyle.Link)
                    .setURL(data.troubleshootingUrl)
                    .setEmoji('🔧');
                buttons.push(troubleshootButton);
            }

            // サポートリンクボタン
            const supportButton = new ButtonBuilder()
                .setLabel('サポートに連絡')
                .setStyle(ButtonStyle.Link)
                .setURL('https://note.com/your-support-page') // 実際のサポートページURLに変更
                .setEmoji('🆘');
            buttons.push(supportButton);

            if (buttons.length > 0) {
                const row = new ActionRowBuilder().addComponents(buttons);
                components.push(row);
            }

        } catch (error) {
            console.error('エラーボタン作成エラー:', error);
        }

        return components;
    }

    /**
     * 再生成ボタン作成
     * @param {Object} result - 生成結果
     * @returns {ButtonBuilder} 再生成ボタン
     */
    createRegenerateButton(result) {
        return new ButtonBuilder()
            .setCustomId(`regenerate_${result.type}_${result.model}`)
            .setLabel('類似生成')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄');
    }

    /**
     * 評価ボタン作成
     * @param {string} jobId - ジョブID
     * @returns {Array<ButtonBuilder>} 評価ボタン配列
     */
    createRatingButtons(jobId) {
        return [
            new ButtonBuilder()
                .setCustomId(`rate_good_${jobId}`)
                .setLabel('👍')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`rate_bad_${jobId}`)
                .setLabel('👎')
                .setStyle(ButtonStyle.Danger)
        ];
    }

    /**
     * 追加シェアボタン作成
     * @param {Object} result - 生成結果
     * @returns {Array<ButtonBuilder>} 追加シェアボタン配列
     */
    createAdditionalShareButtons(result) {
        const buttons = [];

        try {
            // シンプルX投稿
            const simpleXText = `noteのAI生成Botで${result.type === 'image' ? '画像' : result.type === 'video' ? '動画' : '音声'}を作成！ #AI生成 #note`;
            const simpleXButton = new ButtonBuilder()
                .setLabel('シンプル投稿')
                .setStyle(ButtonStyle.Link)
                .setURL(xIntentService.createIntentUrl(simpleXText, result.url))
                .setEmoji('✨');
            buttons.push(simpleXButton);

            // プロンプトのみ投稿
            const promptText = `「${result.prompt.length > 80 ? result.prompt.substring(0, 80) + '...' : result.prompt}」をAIで生成！ #AI生成 #プロンプト`;
            const promptButton = new ButtonBuilder()
                .setLabel('プロンプト投稿')
                .setStyle(ButtonStyle.Link)
                .setURL(xIntentService.createIntentUrl(promptText, ''))
                .setEmoji('💭');
            buttons.push(promptButton);

        } catch (error) {
            console.error('追加シェアボタン作成エラー:', error);
        }

        return buttons;
    }

    /**
     * クレジット残高警告通知
     * @param {string} userId - ユーザーID
     * @param {number} remainingCredits - 残りクレジット
     * @param {number} threshold - 警告閾値
     * @returns {Promise<Object>} 送信結果
     */
    async sendCreditAlert(userId, remainingCredits, threshold = 100) {
        try {
            const user = await User.findByDiscordId(userId);
            if (!user?.getDMPreferences().enableCreditAlerts) {
                return { success: true, skipped: true, reason: 'Credit alerts disabled' };
            }

            const discordUser = await this.client.users.fetch(userId);
            if (!discordUser) {
                throw new Error('Discord user not found');
            }

            const embed = new EmbedBuilder()
                .setTitle('⚠️ クレジット残高警告')
                .setDescription(`クレジット残高が少なくなっています（残り${remainingCredits}）`)
                .addFields(
                    { name: '💳 現在の残高', value: `${remainingCredits}クレジット`, inline: true },
                    { name: '📊 警告レベル', value: remainingCredits < 50 ? '🔴 緊急' : '🟡 注意', inline: true },
                    { name: '🔄 補充タイミング', value: 'note AI生成プランは毎月自動補充されます' }
                )
                .setColor(remainingCredits < 50 ? 0xff0000 : 0xffa500)
                .setTimestamp();

            // プラン更新リンク
            const planButton = new ButtonBuilder()
                .setLabel('プラン確認・更新')
                .setStyle(ButtonStyle.Link)
                .setURL('https://note.com/your-plan-page') // 実際のプランページURLに変更
                .setEmoji('💳');

            const components = [new ActionRowBuilder().addComponents(planButton)];

            await discordUser.send({
                embeds: [embed],
                components: components
            });

            return {
                success: true,
                message: 'クレジット警告送信完了'
            };

        } catch (error) {
            console.error('クレジット警告送信エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * バルク生成完了通知
     * @param {string} userId - ユーザーID
     * @param {Array} results - 生成結果配列
     * @param {Object} summary - サマリー情報
     * @returns {Promise<Object>} 送信結果
     */
    async sendBulkCompletionNotification(userId, results, summary) {
        try {
            const discordUser = await this.client.users.fetch(userId);
            if (!discordUser) {
                throw new Error('Discord user not found');
            }

            const completedCount = results.filter(r => r.status === 'completed').length;
            const failedCount = results.filter(r => r.status === 'failed').length;
            const totalCredits = results.reduce((sum, r) => sum + (r.creditsUsed || 0), 0);

            const embed = new EmbedBuilder()
                .setTitle('🎯 バルク生成完了')
                .setDescription(`${results.length}件の生成が完了しました`)
                .addFields(
                    { name: '✅ 成功', value: `${completedCount}件`, inline: true },
                    { name: '❌ 失敗', value: `${failedCount}件`, inline: true },
                    { name: '💳 総使用クレジット', value: `${totalCredits}`, inline: true }
                )
                .setColor(failedCount === 0 ? 0x00ff00 : 0xffa500)
                .setTimestamp();

            // バルク共有ボタン
            const bulkShareButton = xIntentService.createBulkShareButton(results, summary);
            const components = [new ActionRowBuilder().addComponents(bulkShareButton)];

            await discordUser.send({
                embeds: [embed],
                components: components
            });

            return {
                success: true,
                message: 'バルク完了通知送信完了'
            };

        } catch (error) {
            console.error('バルク完了通知送信エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * モデル表示名取得
     * @param {string} model - モデルキー
     * @returns {string} 表示名
     */
    getModelDisplayName(model) {
        const displayNames = {
            'openai-dalle3': 'DALL·E 3',
            'openai-dalle2': 'DALL·E 2',
            'stabilityai-sdxl': 'Stable Diffusion XL',
            'stabilityai-sd': 'Stable Diffusion',
            'replicate-flux': 'Flux',
            'leonardo-ai': 'Leonardo AI',
            'runwayml-gen2': 'RunwayML Gen-2',
            'openai-tts': 'OpenAI TTS',
            'elevenlabs-tts': 'ElevenLabs'
        };

        return displayNames[model] || model;
    }

    /**
     * DM送信テスト
     * @param {string} userId - ユーザーID
     * @returns {Promise<Object>} テスト結果
     */
    async testDMDelivery(userId) {
        try {
            const discordUser = await this.client.users.fetch(userId);
            
            const embed = new EmbedBuilder()
                .setTitle('🧪 DM送信テスト')
                .setDescription('DM通知機能が正常に動作しています（X投稿機能も利用可能）')
                .setColor(0x0099ff)
                .setTimestamp();

            // テスト用X投稿ボタン
            const testXButton = new ButtonBuilder()
                .setLabel('テスト投稿')
                .setStyle(ButtonStyle.Link)
                .setURL(xIntentService.createIntentUrl('noteのAI生成Bot、DM通知テスト中！ #AI生成 #Discord #note', ''))
                .setEmoji('🧪');

            const components = [new ActionRowBuilder().addComponents(testXButton)];

            await discordUser.send({ 
                embeds: [embed],
                components: components
            });

            return {
                success: true,
                message: 'テストDM送信完了（X投稿ボタン付き）'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 統計情報取得
     * @returns {Object} DM送信統計
     */
    getUsageStats() {
        // 実装時にはRedisやデータベースから実際の統計を取得
        return {
            totalSent: 0,
            successRate: 0,
            errorRate: 0,
            xPostButtonClicks: 0,
            lastActivity: new Date().toISOString()
        };
    }
}

module.exports = new DMService();
