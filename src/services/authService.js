// authService.js - note会員認証・リデンプション管理
const { createClient } = require('@supabase/supabase-js');
const User = require('../models/User');
const Credit = require('../models/Credit');

class AuthService {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
    }

    /**
     * リデンプションコード使用
     * @param {string} discordId - Discord ユーザーID
     * @param {string} redemptionCode - リデンプションコード
     * @returns {Promise<Object>} 使用結果
     */
    async redeemCode(discordId, redemptionCode) {
        try {
            // 1. コードの検証と取得
            const { data: codeData, error: codeError } = await this.supabase
                .from('redemption_codes')
                .select('*')
                .eq('code', redemptionCode.toUpperCase())
                .eq('is_redeemed', false)
                .maybeSingle();

            if (codeError) {
                throw new Error(`コード検証エラー: ${codeError.message}`);
            }

            if (!codeData) {
                return {
                    success: false,
                    error: 'INVALID_CODE',
                    message: '無効なリデンプションコードまたは既に使用済みです'
                };
            }

            // 2. 有効期限チェック
            const now = new Date();
            const expiresAt = new Date(codeData.expires_at);
            
            if (expiresAt < now) {
                return {
                    success: false,
                    error: 'EXPIRED_CODE',
                    message: 'リデンプションコードの有効期限が切れています'
                };
            }

            // 3. 既存ユーザーチェック
            let existingUser = await User.findByDiscordId(discordId);
            
            if (existingUser) {
                return {
                    success: false,
                    error: 'ALREADY_REGISTERED',
                    message: 'このDiscordアカウントは既に登録済みです'
                };
            }

            // 4. Discord IDが既に他のコードで使用されていないかチェック
            const { data: usedCode, error: usedError } = await this.supabase
                .from('redemption_codes')
                .select('id')
                .eq('discord_id', discordId)
                .eq('is_redeemed', true)
                .maybeSingle();

            if (usedError) {
                console.error('既存使用チェックエラー:', usedError);
            }

            if (usedCode) {
                return {
                    success: false,
                    error: 'DISCORD_ALREADY_USED',
                    message: 'このDiscordアカウントは既に別のコードで使用されています'
                };
            }

            // 5. トランザクション処理でユーザー作成・コード使用・クレジット付与
            const { data: result, error: txError } = await this.supabase.rpc(
                'redeem_code_transaction',
                {
                    p_discord_id: discordId,
                    p_code: redemptionCode.toUpperCase(),
                    p_note_email: codeData.note_email,
                    p_credits: codeData.credits_amount
                }
            );

            if (txError) {
                throw new Error(`リデンプション処理エラー: ${txError.message}`);
            }

            // 6. 成功レスポンス
            const newUser = await User.findByDiscordId(discordId);
            
            return {
                success: true,
                user: newUser,
                credits: codeData.credits_amount,
                noteEmail: codeData.note_email,
                message: `リデンプション完了！${codeData.credits_amount}クレジットが付与されました`
            };

        } catch (error) {
            console.error('リデンプションエラー:', error);
            return {
                success: false,
                error: 'INTERNAL_ERROR',
                message: 'システムエラーが発生しました。しばらく後にお試しください'
            };
        }
    }

    /**
     * 会員状況確認
     * @param {string} discordId - Discord ユーザーID
     * @returns {Promise<Object>} 会員情報
     */
    async checkMembership(discordId) {
        try {
            const user = await User.findByDiscordId(discordId);
            
            if (!user) {
                return {
                    isRegistered: false,
                    isActive: false,
                    message: '未登録です。リデンプションコードで登録してください'
                };
            }

            const isActive = user.isActiveMember();
            const credits = user.getAvailableCredits();
            const subscriptionEnd = new Date(user.subscriptionEnd);
            const daysRemaining = Math.max(0, Math.ceil((subscriptionEnd - new Date()) / (24 * 60 * 60 * 1000)));

            return {
                isRegistered: true,
                isActive: isActive,
                user: user,
                credits: credits,
                totalCredits: user.getTotalCredits(),
                reservedCredits: user.getReservedCredits(),
                membershipStatus: user.membershipStatus,
                subscriptionEnd: user.subscriptionEnd,
                daysRemaining: daysRemaining,
                noteEmail: user.noteEmail,
                message: isActive 
                    ? `アクティブな会員です（残り${daysRemaining}日）`
                    : '会員期限が切れています'
            };

        } catch (error) {
            console.error('会員状況確認エラー:', error);
            return {
                isRegistered: false,
                isActive: false,
                error: error.message,
                message: '会員状況の確認に失敗しました'
            };
        }
    }

    /**
     * 会員の今日の使用状況確認
     * @param {string} discordId - Discord ユーザーID
     * @returns {Promise<Object>} 使用状況
     */
    async getTodayUsage(discordId) {
        try {
            const user = await User.findByDiscordId(discordId);
            
            if (!user) {
                return { generationCount: 0, creditsUsed: 0 };
            }

            const todayCount = await user.getTodayGenerationCount();
            
            // 今日のクレジット使用量を取得
            const { data: todayUsage, error } = await this.supabase
                .from('credit_transactions')
                .select('amount')
                .eq('user_id', user.id)
                .eq('type', 'consume')
                .gte('created_at', new Date().toISOString().split('T')[0] + 'T00:00:00Z');

            if (error) {
                console.error('今日の使用量取得エラー:', error);
            }

            const creditsUsed = todayUsage ? 
                todayUsage.reduce((sum, tx) => sum + tx.amount, 0) : 0;

            return {
                generationCount: todayCount,
                creditsUsed: creditsUsed
            };

        } catch (error) {
            console.error('今日の使用状況取得エラー:', error);
            return { generationCount: 0, creditsUsed: 0 };
        }
    }

    /**
     * 使用制限チェック
     * @param {string} discordId - Discord ユーザーID
     * @param {number} requestedCredits - 要求クレジット数
     * @returns {Promise<Object>} 制限チェック結果
     */
    async checkUsageLimits(discordId, requestedCredits) {
        try {
            const membership = await this.checkMembership(discordId);
            
            if (!membership.isActive) {
                return {
                    allowed: false,
                    reason: 'INACTIVE_MEMBERSHIP',
                    message: '有効な会員ではありません'
                };
            }

            // クレジット残高チェック
            if (membership.credits < requestedCredits) {
                return {
                    allowed: false,
                    reason: 'INSUFFICIENT_CREDITS',
                    message: `クレジットが不足しています（必要: ${requestedCredits}, 残高: ${membership.credits}）`
                };
            }

            // 今日の使用状況チェック
            const todayUsage = await this.getTodayUsage(discordId);
            const maxGenerationsPerDay = parseInt(process.env.MAX_GENERATIONS_PER_DAY) || 50;
            const maxCreditsPerDay = parseInt(process.env.MAX_CREDITS_PER_DAY) || 500;

            if (todayUsage.generationCount >= maxGenerationsPerDay) {
                return {
                    allowed: false,
                    reason: 'DAILY_GENERATION_LIMIT',
                    message: `1日の生成回数上限に達しています（${maxGenerationsPerDay}回）`
                };
            }

            if (todayUsage.creditsUsed + requestedCredits > maxCreditsPerDay) {
                return {
                    allowed: false,
                    reason: 'DAILY_CREDIT_LIMIT',
                    message: `1日のクレジット使用上限を超えます（上限: ${maxCreditsPerDay}）`
                };
            }

            return {
                allowed: true,
                message: '使用可能です'
            };

        } catch (error) {
            console.error('使用制限チェックエラー:', error);
            return {
                allowed: false,
                reason: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 管理者による手動コード生成
     * @param {string} noteEmail - noteメールアドレス
     * @param {number} creditsAmount - クレジット数
     * @param {number} expiryDays - 有効期限（日数）
     * @param {string} notes - 管理用メモ
     * @returns {Promise<Object>} 生成結果
     */
    async generateCode(noteEmail, creditsAmount = 1000, expiryDays = 90, notes = '') {
        try {
            const { generateRedemptionCode } = require('../../scripts/generateRedemptionCode');
            
            const result = await generateRedemptionCode(
                noteEmail, 
                creditsAmount, 
                expiryDays, 
                notes
            );

            return result;

        } catch (error) {
            console.error('コード生成エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 会員期限延長
     * @param {string} discordId - Discord ユーザーID
     * @param {number} days - 延長日数
     * @returns {Promise<Object>} 延長結果
     */
    async extendMembership(discordId, days) {
        try {
            const user = await User.findByDiscordId(discordId);
            
            if (!user) {
                return {
                    success: false,
                    message: 'ユーザーが見つかりません'
                };
            }

            const success = await user.extendMembership(days);
            
            if (success) {
                return {
                    success: true,
                    message: `会員期限を${days}日間延長しました`,
                    newEndDate: user.subscriptionEnd
                };
            } else {
                return {
                    success: false,
                    message: '期限延長に失敗しました'
                };
            }

        } catch (error) {
            console.error('会員期限延長エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * コード使用履歴取得
     * @param {string} discordId - Discord ユーザーID
     * @returns {Promise<Array>} 使用履歴
     */
    async getRedemptionHistory(discordId) {
        try {
            const { data, error } = await this.supabase
                .from('redemption_codes')
                .select('code, credits_amount, redeemed_at, expires_at, note_email')
                .eq('discord_id', discordId)
                .eq('is_redeemed', true)
                .order('redeemed_at', { ascending: false });

            if (error) {
                console.error('リデンプション履歴取得エラー:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('リデンプション履歴取得エラー:', error);
            return [];
        }
    }

    /**
     * システム統計取得（管理者用）
     * @returns {Promise<Object>} システム統計
     */
    async getSystemStats() {
        try {
            const userStats = await User.getGlobalStats();
            
            // コード統計
            const { data: codeStats, error: codeError } = await this.supabase
                .from('redemption_codes')
                .select('is_redeemed, credits_amount, created_at')
                .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

            if (codeError) {
                console.error('コード統計取得エラー:', codeError);
            }

            const codeAnalysis = {
                totalCodes: codeStats?.length || 0,
                redeemedCodes: codeStats?.filter(c => c.is_redeemed).length || 0,
                pendingCodes: codeStats?.filter(c => !c.is_redeemed).length || 0,
                totalCreditsIssued: codeStats?.reduce((sum, c) => sum + c.credits_amount, 0) || 0,
                redemptionRate: 0
            };

            if (codeAnalysis.totalCodes > 0) {
                codeAnalysis.redemptionRate = Math.round(
                    (codeAnalysis.redeemedCodes / codeAnalysis.totalCodes) * 100
                );
            }

            return {
                users: userStats,
                codes: codeAnalysis,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('システム統計取得エラー:', error);
            return null;
        }
    }

    /**
     * 期限切れ間近の会員にアラート
     * @param {number} daysThreshold - 警告する日数
     * @returns {Promise<Array>} 警告対象ユーザー一覧
     */
    async getExpiringMembers(daysThreshold = 7) {
        try {
            const warningDate = new Date();
            warningDate.setDate(warningDate.getDate() + daysThreshold);

            const { data, error } = await this.supabase
                .from('note_users')
                .select('discord_id, note_email, subscription_end, membership_status')
                .eq('membership_status', 'active')
                .lte('subscription_end', warningDate.toISOString());

            if (error) {
                console.error('期限切れ間近会員取得エラー:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('期限切れ間近会員取得エラー:', error);
            return [];
        }
    }
}

module.exports = new AuthService();
