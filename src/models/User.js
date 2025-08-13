// User.js - note会員ユーザーモデル
const { createClient } = require('@supabase/supabase-js');

class User {
    constructor(data) {
        this.id = data.id;
        this.discordId = data.discord_id;
        this.noteEmail = data.note_email;
        this.membershipStatus = data.membership_status;
        this.subscriptionStart = data.subscription_start;
        this.subscriptionEnd = data.subscription_end;
        this.createdAt = data.created_at;
        this.updatedAt = data.updated_at;
        
        // 関連データ
        this.credits = data.credits || null;
        this.dmPreferences = data.dm_preferences || null;
    }

    /**
     * Discord IDでユーザーを検索
     * @param {string} discordId - Discord ユーザーID
     * @returns {Promise<User|null>} ユーザーオブジェクトまたはnull
     */
    static async findByDiscordId(discordId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('note_users')
            .select(`
                *,
                user_credits!inner (
                    total_credits,
                    available_credits,
                    reserved_credits,
                    last_refill
                ),
                dm_preferences (
                    enable_completion_dm,
                    enable_error_dm,
                    enable_credit_alerts
                )
            `)
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) {
            console.error('ユーザー検索エラー:', error);
            return null;
        }

        if (!data) {
            return null;
        }

        // データを整形
        const userData = {
            ...data,
            credits: data.user_credits?.[0] || null,
            dm_preferences: data.dm_preferences?.[0] || null
        };

        return new User(userData);
    }

    /**
     * 新規ユーザー作成
     * @param {string} discordId - Discord ユーザーID
     * @param {string} noteEmail - noteメールアドレス
     * @param {number} initialCredits - 初期クレジット数
     * @returns {Promise<User>} 作成されたユーザー
     */
    static async create(discordId, noteEmail, initialCredits = 1000) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        // トランザクション的な処理のためにRPC関数を使用
        const { data, error } = await supabase.rpc('create_user_with_credits', {
            p_discord_id: discordId,
            p_note_email: noteEmail,
            p_initial_credits: initialCredits
        });

        if (error) {
            throw new Error(`ユーザー作成エラー: ${error.message}`);
        }

        return await User.findByDiscordId(discordId);
    }

    /**
     * 会員ステータス確認
     * @returns {boolean} アクティブな会員かどうか
     */
    isActiveMember() {
        if (this.membershipStatus !== 'active') {
            return false;
        }

        const now = new Date();
        const subscriptionEnd = new Date(this.subscriptionEnd);
        
        return subscriptionEnd > now;
    }

    /**
     * 利用可能クレジット取得
     * @returns {number} 利用可能クレジット数
     */
    getAvailableCredits() {
        return this.credits?.available_credits || 0;
    }

    /**
     * 予約中クレジット取得
     * @returns {number} 予約中クレジット数
     */
    getReservedCredits() {
        return this.credits?.reserved_credits || 0;
    }

    /**
     * 合計クレジット取得
     * @returns {number} 合計クレジット数
     */
    getTotalCredits() {
        return this.credits?.total_credits || 0;
    }

    /**
     * 今日の生成回数取得
     * @returns {Promise<number>} 今日の生成回数
     */
    async getTodayGenerationCount() {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { count, error } = await supabase
            .from('generation_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', this.id)
            .gte('created_at', today.toISOString());

        if (error) {
            console.error('今日の生成回数取得エラー:', error);
            return 0;
        }

        return count || 0;
    }

    /**
     * 月間使用統計取得
     * @returns {Promise<Object>} 月間統計データ
     */
    async getMonthlyStats() {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const { data, error } = await supabase
            .from('generation_jobs')
            .select('type, model, credits_used, status, created_at')
            .eq('user_id', this.id)
            .gte('created_at', thisMonth.toISOString());

        if (error) {
            console.error('月間統計取得エラー:', error);
            return null;
        }

        // 統計を計算
        const stats = {
            totalGenerations: data.length,
            completedGenerations: data.filter(j => j.status === 'completed').length,
            totalCreditsUsed: data.reduce((sum, j) => sum + (j.credits_used || 0), 0),
            modelUsage: {},
            typeUsage: {}
        };

        // モデル別・タイプ別使用回数
        data.forEach(job => {
            stats.modelUsage[job.model] = (stats.modelUsage[job.model] || 0) + 1;
            stats.typeUsage[job.type] = (stats.typeUsage[job.type] || 0) + 1;
        });

        // 最も使用されたモデル
        stats.favoriteModel = Object.keys(stats.modelUsage).reduce((a, b) => 
            stats.modelUsage[a] > stats.modelUsage[b] ? a : b, null
        );

        return stats;
    }

    /**
     * DM通知設定取得
     * @returns {Object} DM通知設定
     */
    getDMPreferences() {
        return {
            enableCompletionDM: this.dmPreferences?.enable_completion_dm ?? true,
            enableErrorDM: this.dmPreferences?.enable_error_dm ?? true,
            enableCreditAlerts: this.dmPreferences?.enable_credit_alerts ?? true
        };
    }

    /**
     * DM通知設定更新
     * @param {Object} preferences - 新しい設定
     * @returns {Promise<boolean>} 更新成功かどうか
     */
    async updateDMPreferences(preferences) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { error } = await supabase
            .from('dm_preferences')
            .upsert({
                user_id: this.id,
                enable_completion_dm: preferences.enableCompletionDM,
                enable_error_dm: preferences.enableErrorDM,
                enable_credit_alerts: preferences.enableCreditAlerts
            });

        if (error) {
            console.error('DM設定更新エラー:', error);
            return false;
        }

        return true;
    }

    /**
     * 会員期限延長
     * @param {number} days - 延長日数
     * @returns {Promise<boolean>} 更新成功かどうか
     */
    async extendMembership(days) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const newEndDate = new Date(this.subscriptionEnd);
        newEndDate.setDate(newEndDate.getDate() + days);

        const { error } = await supabase
            .from('note_users')
            .update({
                subscription_end: newEndDate.toISOString(),
                membership_status: 'active'
            })
            .eq('id', this.id);

        if (error) {
            console.error('会員期限延長エラー:', error);
            return false;
        }

        this.subscriptionEnd = newEndDate.toISOString();
        this.membershipStatus = 'active';
        return true;
    }

    /**
     * ユーザー情報のJSON表現
     * @returns {Object} JSONオブジェクト
     */
    toJSON() {
        return {
            id: this.id,
            discordId: this.discordId,
            noteEmail: this.noteEmail,
            membershipStatus: this.membershipStatus,
            subscriptionStart: this.subscriptionStart,
            subscriptionEnd: this.subscriptionEnd,
            isActiveMember: this.isActiveMember(),
            credits: {
                total: this.getTotalCredits(),
                available: this.getAvailableCredits(),
                reserved: this.getReservedCredits()
            },
            dmPreferences: this.getDMPreferences(),
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * 全ユーザー統計取得（管理者用）
     * @returns {Promise<Object>} 全体統計
     */
    static async getGlobalStats() {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        // 基本統計
        const { data: userStats } = await supabase
            .from('note_users')
            .select('membership_status')
            .eq('membership_status', 'active');

        const { data: jobStats } = await supabase
            .from('generation_jobs')
            .select('status, credits_used, created_at')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const { data: creditStats } = await supabase
            .from('user_credits')
            .select('available_credits, total_credits');

        return {
            activeUsers: userStats?.length || 0,
            todayJobs: jobStats?.length || 0,
            todayCreditsUsed: jobStats?.reduce((sum, j) => sum + (j.credits_used || 0), 0) || 0,
            totalAvailableCredits: creditStats?.reduce((sum, c) => sum + (c.available_credits || 0), 0) || 0,
            totalGrantedCredits: creditStats?.reduce((sum, c) => sum + (c.total_credits || 0), 0) || 0
        };
    }
}

module.exports = User;
