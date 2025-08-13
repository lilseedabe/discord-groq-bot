// Credit.js - クレジット管理モデル
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

class Credit {
    constructor(data) {
        this.id = data.id;
        this.userId = data.user_id;
        this.totalCredits = data.total_credits;
        this.availableCredits = data.available_credits;
        this.reservedCredits = data.reserved_credits;
        this.lastRefill = data.last_refill;
        this.createdAt = data.created_at;
        this.updatedAt = data.updated_at;
    }

    /**
     * ユーザーのクレジット情報取得
     * @param {string} userId - ユーザーID
     * @returns {Promise<Credit|null>} クレジット情報
     */
    static async findByUserId(userId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('user_credits')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.error('クレジット取得エラー:', error);
            return null;
        }

        return data ? new Credit(data) : null;
    }

    /**
     * Discord IDからクレジット情報取得
     * @param {string} discordId - Discord ユーザーID
     * @returns {Promise<Credit|null>} クレジット情報
     */
    static async findByDiscordId(discordId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('user_credits')
            .select(`
                *,
                note_users!inner (discord_id)
            `)
            .eq('note_users.discord_id', discordId)
            .maybeSingle();

        if (error) {
            console.error('Discord IDからクレジット取得エラー:', error);
            return null;
        }

        return data ? new Credit(data) : null;
    }

    /**
     * クレジット予約
     * @param {string} userId - ユーザーID
     * @param {number} amount - 予約金額
     * @param {string} jobId - ジョブID
     * @returns {Promise<Object>} 予約結果
     */
    static async reserveCredits(userId, amount, jobId = null) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const reservationId = uuidv4();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1時間後

        try {
            // トランザクション開始
            const { data, error } = await supabase.rpc('reserve_user_credits', {
                p_user_id: userId,
                p_reservation_id: reservationId,
                p_amount: amount,
                p_job_id: jobId,
                p_expires_at: expiresAt.toISOString()
            });

            if (error) {
                throw new Error(error.message);
            }

            return {
                success: true,
                reservationId: reservationId,
                amount: amount,
                expiresAt: expiresAt,
                data: data
            };

        } catch (error) {
            console.error('クレジット予約エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 予約クレジット消費
     * @param {string} reservationId - 予約ID
     * @param {number} actualCost - 実際のコスト
     * @param {string} model - 使用モデル
     * @param {string} description - 説明
     * @returns {Promise<Object>} 消費結果
     */
    static async consumeReservedCredits(reservationId, actualCost, model = null, description = null) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        try {
            const { data, error } = await supabase.rpc('consume_reserved_credits', {
                p_reservation_id: reservationId,
                p_actual_cost: actualCost,
                p_model: model,
                p_description: description
            });

            if (error) {
                throw new Error(error.message);
            }

            return {
                success: true,
                consumed: actualCost,
                refunded: data.refunded_amount || 0,
                data: data
            };

        } catch (error) {
            console.error('予約クレジット消費エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 予約解除
     * @param {string} reservationId - 予約ID
     * @returns {Promise<boolean>} 解除成功かどうか
     */
    static async releaseReservation(reservationId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        try {
            const { data, error } = await supabase.rpc('release_credit_reservation', {
                p_reservation_id: reservationId
            });

            if (error) {
                throw new Error(error.message);
            }

            return true;

        } catch (error) {
            console.error('予約解除エラー:', error);
            return false;
        }
    }

    /**
     * クレジット付与
     * @param {string} userId - ユーザーID
     * @param {number} amount - 付与金額
     * @param {string} description - 説明
     * @returns {Promise<boolean>} 付与成功かどうか
     */
    static async grantCredits(userId, amount, description = 'Manual grant') {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        try {
            const { error } = await supabase.rpc('grant_user_credits', {
                p_user_id: userId,
                p_amount: amount,
                p_description: description
            });

            if (error) {
                throw new Error(error.message);
            }

            return true;

        } catch (error) {
            console.error('クレジット付与エラー:', error);
            return false;
        }
    }

    /**
     * 月次クレジット付与（サブスクリプション）
     * @param {string} userId - ユーザーID
     * @param {number} amount - 付与金額
     * @returns {Promise<boolean>} 付与成功かどうか
     */
    static async monthlyRefill(userId, amount = 1000) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        try {
            const { error } = await supabase.rpc('monthly_credit_refill', {
                p_user_id: userId,
                p_amount: amount
            });

            if (error) {
                throw new Error(error.message);
            }

            return true;

        } catch (error) {
            console.error('月次クレジット付与エラー:', error);
            return false;
        }
    }

    /**
     * クレジット履歴取得
     * @param {string} userId - ユーザーID
     * @param {number} limit - 取得件数
     * @param {number} offset - オフセット
     * @returns {Promise<Array>} 履歴一覧
     */
    static async getHistory(userId, limit = 50, offset = 0) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('credit_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('クレジット履歴取得エラー:', error);
            return [];
        }

        return data || [];
    }

    /**
     * 期間別クレジット使用統計
     * @param {string} userId - ユーザーID
     * @param {number} days - 過去何日間
     * @returns {Promise<Object>} 統計データ
     */
    static async getUsageStats(userId, days = 30) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('credit_transactions')
            .select('type, amount, model, created_at')
            .eq('user_id', userId)
            .gte('created_at', sinceDate.toISOString());

        if (error) {
            console.error('使用統計取得エラー:', error);
            return null;
        }

        const stats = {
            totalConsumed: 0,
            totalGranted: 0,
            totalRefunded: 0,
            modelUsage: {},
            dailyUsage: {}
        };

        data.forEach(tx => {
            const date = new Date(tx.created_at).toDateString();
            
            switch (tx.type) {
                case 'consume':
                    stats.totalConsumed += tx.amount;
                    if (tx.model) {
                        stats.modelUsage[tx.model] = (stats.modelUsage[tx.model] || 0) + tx.amount;
                    }
                    break;
                case 'grant':
                    stats.totalGranted += tx.amount;
                    break;
                case 'refund':
                    stats.totalRefunded += tx.amount;
                    break;
            }

            stats.dailyUsage[date] = (stats.dailyUsage[date] || 0) + 
                (tx.type === 'consume' ? tx.amount : 0);
        });

        return stats;
    }

    /**
     * 期限切れ予約のクリーンアップ
     * @returns {Promise<number>} クリーンアップした件数
     */
    static async cleanupExpiredReservations() {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        try {
            const { data, error } = await supabase.rpc('cleanup_expired_reservations');

            if (error) {
                throw new Error(error.message);
            }

            return data?.cleaned_count || 0;

        } catch (error) {
            console.error('期限切れ予約クリーンアップエラー:', error);
            return 0;
        }
    }

    /**
     * ユーザーの現在の予約一覧
     * @param {string} userId - ユーザーID
     * @returns {Promise<Array>} 予約一覧
     */
    static async getActiveReservations(userId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('credit_reservations')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('アクティブ予約取得エラー:', error);
            return [];
        }

        return data || [];
    }

    /**
     * 低残高ユーザー一覧（アラート用）
     * @param {number} threshold - 閾値
     * @returns {Promise<Array>} 低残高ユーザー一覧
     */
    static async getLowBalanceUsers(threshold = 100) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('user_credits')
            .select(`
                *,
                note_users!inner (discord_id, note_email, membership_status)
            `)
            .lt('available_credits', threshold)
            .eq('note_users.membership_status', 'active');

        if (error) {
            console.error('低残高ユーザー取得エラー:', error);
            return [];
        }

        return data || [];
    }

    /**
     * クレジット残高のバリデーション
     * @param {string} userId - ユーザーID
     * @returns {Promise<Object>} バリデーション結果
     */
    static async validateBalance(userId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase.rpc('validate_user_credit_balance', {
            p_user_id: userId
        });

        if (error) {
            console.error('残高バリデーションエラー:', error);
            return { valid: false, error: error.message };
        }

        return data || { valid: false, error: 'Unknown error' };
    }

    /**
     * JSON表現
     * @returns {Object} JSONオブジェクト
     */
    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            totalCredits: this.totalCredits,
            availableCredits: this.availableCredits,
            reservedCredits: this.reservedCredits,
            lastRefill: this.lastRefill,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

module.exports = Credit;
