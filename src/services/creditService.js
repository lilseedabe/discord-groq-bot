// creditService.js - クレジット管理・予約・消費サービス
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const Credit = require('../models/Credit');

class CreditService {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
    }

    /**
     * クレジット予約（ジョブ開始前）
     * @param {string} userId - ユーザーID
     * @param {number} amount - 予約金額
     * @param {string} jobId - ジョブID
     * @param {string} model - 使用モデル
     * @param {string} description - 説明
     * @returns {Promise<Object>} 予約結果
     */
    async reserveCredits(userId, amount, jobId = null, model = null, description = null) {
        try {
            // 1. 残高確認
            const credit = await Credit.findByUserId(userId);
            if (!credit || credit.availableCredits < amount) {
                return {
                    success: false,
                    error: 'INSUFFICIENT_CREDITS',
                    message: `クレジット不足です。必要: ${amount}, 残高: ${credit?.availableCredits || 0}`
                };
            }

            // 2. 予約実行
            const reservationResult = await Credit.reserveCredits(userId, amount, jobId);
            
            if (!reservationResult.success) {
                return reservationResult;
            }

            // 3. 取引履歴記録
            await this.recordTransaction(
                userId, 
                'reserve', 
                amount, 
                model,
                jobId,
                description || `Credits reserved for ${model || 'AI generation'}`
            );

            return {
                success: true,
                reservationId: reservationResult.reservationId,
                amount: amount,
                expiresAt: reservationResult.expiresAt,
                message: `${amount}クレジットを予約しました`
            };

        } catch (error) {
            console.error('クレジット予約エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 予約クレジット消費（ジョブ完了時）
     * @param {string} reservationId - 予約ID
     * @param {number} actualCost - 実際のコスト
     * @param {string} model - 使用モデル
     * @param {string} description - 説明
     * @param {Object} metadata - 追加メタデータ
     * @returns {Promise<Object>} 消費結果
     */
    async consumeReservedCredits(reservationId, actualCost, model = null, description = null, metadata = {}) {
        try {
            // 1. 予約情報取得
            const { data: reservation, error: resError } = await this.supabase
                .from('credit_reservations')
                .select('*')
                .eq('id', reservationId)
                .eq('status', 'active')
                .maybeSingle();

            if (resError || !reservation) {
                return {
                    success: false,
                    error: 'RESERVATION_NOT_FOUND',
                    message: '予約が見つかりません'
                };
            }

            // 2. 期限チェック
            if (new Date(reservation.expires_at) < new Date()) {
                return {
                    success: false,
                    error: 'RESERVATION_EXPIRED',
                    message: '予約が期限切れです'
                };
            }

            // 3. 消費実行
            const consumeResult = await Credit.consumeReservedCredits(
                reservationId, 
                actualCost, 
                model, 
                description
            );

            if (!consumeResult.success) {
                return consumeResult;
            }

            // 4. 差額返却の履歴記録
            if (consumeResult.refunded > 0) {
                await this.recordTransaction(
                    reservation.user_id,
                    'refund',
                    consumeResult.refunded,
                    model,
                    reservation.job_id,
                    `Refund from reservation (reserved: ${reservation.reserved_amount}, used: ${actualCost})`
                );
            }

            return {
                success: true,
                consumed: actualCost,
                refunded: consumeResult.refunded,
                message: `${actualCost}クレジットを消費しました${consumeResult.refunded > 0 ? `（${consumeResult.refunded}クレジット返却）` : ''}`
            };

        } catch (error) {
            console.error('予約クレジット消費エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 予約解除（ジョブ失敗時）
     * @param {string} reservationId - 予約ID
     * @param {string} reason - 解除理由
     * @returns {Promise<Object>} 解除結果
     */
    async releaseReservation(reservationId, reason = 'Job failed or cancelled') {
        try {
            // 1. 予約情報取得
            const { data: reservation, error: resError } = await this.supabase
                .from('credit_reservations')
                .select('*')
                .eq('id', reservationId)
                .eq('status', 'active')
                .maybeSingle();

            if (resError || !reservation) {
                return {
                    success: false,
                    error: 'RESERVATION_NOT_FOUND',
                    message: '予約が見つかりません'
                };
            }

            // 2. 予約解除実行
            const releaseSuccess = await Credit.releaseReservation(reservationId);
            
            if (!releaseSuccess) {
                return {
                    success: false,
                    error: 'RELEASE_FAILED',
                    message: '予約解除に失敗しました'
                };
            }

            // 3. 履歴記録
            await this.recordTransaction(
                reservation.user_id,
                'release',
                reservation.reserved_amount,
                null,
                reservation.job_id,
                `Released reservation: ${reason}`
            );

            return {
                success: true,
                amount: reservation.reserved_amount,
                message: `${reservation.reserved_amount}クレジットの予約を解除しました`
            };

        } catch (error) {
            console.error('予約解除エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 直接クレジット消費（予約なし）
     * @param {string} userId - ユーザーID
     * @param {number} amount - 消費金額
     * @param {string} model - 使用モデル
     * @param {string} jobId - ジョブID
     * @param {string} description - 説明
     * @returns {Promise<Object>} 消費結果
     */
    async consumeCredits(userId, amount, model = null, jobId = null, description = null) {
        try {
            // 1. 残高確認
            const credit = await Credit.findByUserId(userId);
            if (!credit || credit.availableCredits < amount) {
                return {
                    success: false,
                    error: 'INSUFFICIENT_CREDITS',
                    message: `クレジット不足です。必要: ${amount}, 残高: ${credit?.availableCredits || 0}`
                };
            }

            // 2. 直接消費実行
            const { error } = await this.supabase.rpc('consume_user_credits', {
                p_user_id: userId,
                p_amount: amount,
                p_model: model,
                p_job_id: jobId,
                p_description: description || `Direct consumption for ${model || 'AI generation'}`
            });

            if (error) {
                throw new Error(error.message);
            }

            return {
                success: true,
                consumed: amount,
                message: `${amount}クレジットを消費しました`
            };

        } catch (error) {
            console.error('直接クレジット消費エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * クレジット付与
     * @param {string} userId - ユーザーID
     * @param {number} amount - 付与金額
     * @param {string} reason - 付与理由
     * @param {string} description - 詳細説明
     * @returns {Promise<Object>} 付与結果
     */
    async grantCredits(userId, amount, reason = 'manual', description = null) {
        try {
            const grantSuccess = await Credit.grantCredits(
                userId, 
                amount, 
                description || `Credits granted: ${reason}`
            );

            if (!grantSuccess) {
                return {
                    success: false,
                    error: 'GRANT_FAILED',
                    message: 'クレジット付与に失敗しました'
                };
            }

            return {
                success: true,
                amount: amount,
                reason: reason,
                message: `${amount}クレジットを付与しました`
            };

        } catch (error) {
            console.error('クレジット付与エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 月次クレジット補充
     * @param {string} userId - ユーザーID
     * @param {number} amount - 補充金額
     * @returns {Promise<Object>} 補充結果
     */
    async monthlyRefill(userId, amount = 1000) {
        try {
            const refillSuccess = await Credit.monthlyRefill(userId, amount);

            if (!refillSuccess) {
                return {
                    success: false,
                    error: 'REFILL_FAILED',
                    message: '月次補充に失敗しました'
                };
            }

            return {
                success: true,
                amount: amount,
                message: `月次クレジット${amount}を補充しました`
            };

        } catch (error) {
            console.error('月次クレジット補充エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 取引履歴記録
     * @param {string} userId - ユーザーID
     * @param {string} type - 取引タイプ
     * @param {number} amount - 金額
     * @param {string} model - モデル名
     * @param {string} jobId - ジョブID
     * @param {string} description - 説明
     * @param {Object} metadata - 追加メタデータ
     * @returns {Promise<boolean>} 記録成功かどうか
     */
    async recordTransaction(userId, type, amount, model = null, jobId = null, description = null, metadata = {}) {
        try {
            const { error } = await this.supabase
                .from('credit_transactions')
                .insert([{
                    user_id: userId,
                    type: type,
                    amount: amount,
                    model: model,
                    job_id: jobId,
                    description: description,
                    metadata: metadata
                }]);

            if (error) {
                console.error('取引履歴記録エラー:', error);
                return false;
            }

            return true;

        } catch (error) {
            console.error('取引履歴記録エラー:', error);
            return false;
        }
    }

    /**
     * ユーザーのクレジット残高取得
     * @param {string} userId - ユーザーID
     * @returns {Promise<Object>} 残高情報
     */
    async getBalance(userId) {
        try {
            const credit = await Credit.findByUserId(userId);
            
            if (!credit) {
                return {
                    success: false,
                    error: 'USER_NOT_FOUND',
                    message: 'ユーザーのクレジット情報が見つかりません'
                };
            }

            // アクティブな予約も取得
            const activeReservations = await Credit.getActiveReservations(userId);

            return {
                success: true,
                totalCredits: credit.totalCredits,
                availableCredits: credit.availableCredits,
                reservedCredits: credit.reservedCredits,
                activeReservations: activeReservations.length,
                reservationDetails: activeReservations.map(r => ({
                    id: r.id,
                    amount: r.reserved_amount,
                    jobId: r.job_id,
                    expiresAt: r.expires_at,
                    createdAt: r.created_at
                })),
                lastRefill: credit.lastRefill
            };

        } catch (error) {
            console.error('残高取得エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * クレジット履歴取得
     * @param {string} userId - ユーザーID
     * @param {number} limit - 取得件数
     * @param {number} offset - オフセット
     * @param {string} type - タイプフィルター
     * @returns {Promise<Object>} 履歴データ
     */
    async getHistory(userId, limit = 50, offset = 0, type = null) {
        try {
            let query = this.supabase
                .from('credit_transactions')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (type) {
                query = query.eq('type', type);
            }

            const { data, error, count } = await query;

            if (error) {
                throw new Error(error.message);
            }

            return {
                success: true,
                transactions: data || [],
                total: count,
                offset: offset,
                limit: limit
            };

        } catch (error) {
            console.error('履歴取得エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 使用統計取得
     * @param {string} userId - ユーザーID
     * @param {number} days - 統計期間（日数）
     * @returns {Promise<Object>} 統計データ
     */
    async getUsageStats(userId, days = 30) {
        try {
            const stats = await Credit.getUsageStats(userId, days);
            
            if (!stats) {
                return {
                    success: false,
                    error: 'STATS_ERROR',
                    message: '統計データの取得に失敗しました'
                };
            }

            return {
                success: true,
                period: `Past ${days} days`,
                ...stats
            };

        } catch (error) {
            console.error('使用統計取得エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'システムエラーが発生しました'
            };
        }
    }

    /**
     * 期限切れ予約クリーンアップ
     * @returns {Promise<Object>} クリーンアップ結果
     */
    async cleanupExpiredReservations() {
        try {
            const cleanedCount = await Credit.cleanupExpiredReservations();
            
            return {
                success: true,
                cleanedCount: cleanedCount,
                message: `${cleanedCount}件の期限切れ予約をクリーンアップしました`
            };

        } catch (error) {
            console.error('期限切れ予約クリーンアップエラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'クリーンアップに失敗しました'
            };
        }
    }

    /**
     * 残高バリデーション
     * @param {string} userId - ユーザーID
     * @returns {Promise<Object>} バリデーション結果
     */
    async validateBalance(userId) {
        try {
            const validation = await Credit.validateBalance(userId);
            
            return {
                success: validation.valid,
                details: validation,
                message: validation.valid ? '残高は正常です' : '残高に不整合があります'
            };

        } catch (error) {
            console.error('残高バリデーションエラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: 'バリデーションに失敗しました'
            };
        }
    }

    /**
     * 低残高ユーザー検出
     * @param {number} threshold - 閾値
     * @returns {Promise<Array>} 低残高ユーザー一覧
     */
    async getLowBalanceUsers(threshold = 100) {
        try {
            const users = await Credit.getLowBalanceUsers(threshold);
            
            return users.map(user => ({
                discordId: user.note_users.discord_id,
                noteEmail: user.note_users.note_email,
                availableCredits: user.available_credits,
                totalCredits: user.total_credits,
                membershipStatus: user.note_users.membership_status
            }));

        } catch (error) {
            console.error('低残高ユーザー検出エラー:', error);
            return [];
        }
    }

    /**
     * 管理者用全体統計
     * @returns {Promise<Object>} 全体統計
     */
    async getGlobalStats() {
        try {
            const { data: stats, error } = await this.supabase.rpc('get_global_credit_stats');

            if (error) {
                throw new Error(error.message);
            }

            return {
                success: true,
                stats: stats || {},
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('全体統計取得エラー:', error);
            return {
                success: false,
                error: 'SYSTEM_ERROR',
                message: '統計取得に失敗しました'
            };
        }
    }
}

module.exports = new CreditService();
