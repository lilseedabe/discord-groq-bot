// Job.js - AI生成ジョブ管理モデル
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

class Job {
    constructor(data) {
        this.id = data.id;
        this.userId = data.user_id;
        this.type = data.type; // 'image', 'video', 'audio'
        this.status = data.status; // 'pending', 'processing', 'completed', 'failed', 'cancelled'
        this.model = data.model;
        this.prompt = data.prompt;
        this.params = data.params;
        this.resultUrl = data.result_url;
        this.xPostUrl = data.x_post_url;
        this.creditsUsed = data.credits_used;
        this.creditsReserved = data.credits_reserved;
        this.reservationId = data.reservation_id;
        this.errorMessage = data.error_message;
        this.startedAt = data.started_at;
        this.completedAt = data.completed_at;
        this.createdAt = data.created_at;
    }

    /**
     * 新規ジョブ作成
     * @param {string} userId - ユーザーID
     * @param {string} type - ジョブタイプ
     * @param {string} model - AIモデル
     * @param {string} prompt - プロンプト
     * @param {Object} params - 生成パラメータ
     * @param {string} reservationId - クレジット予約ID
     * @returns {Promise<Job>} 作成されたジョブ
     */
    static async create(userId, type, model, prompt, params = {}, reservationId = null) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const jobId = `job_${Date.now()}_${uuidv4().substr(0, 8)}`;

        const jobData = {
            id: jobId,
            user_id: userId,
            type: type,
            model: model,
            prompt: prompt,
            params: params,
            status: 'pending',
            reservation_id: reservationId,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('generation_jobs')
            .insert([jobData])
            .select()
            .single();

        if (error) {
            throw new Error(`ジョブ作成エラー: ${error.message}`);
        }

        return new Job(data);
    }

    /**
     * ジョブID検索
     * @param {string} jobId - ジョブID
     * @returns {Promise<Job|null>} ジョブオブジェクト
     */
    static async findById(jobId) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('generation_jobs')
            .select('*')
            .eq('id', jobId)
            .maybeSingle();

        if (error) {
            console.error('ジョブ検索エラー:', error);
            return null;
        }

        return data ? new Job(data) : null;
    }

    /**
     * ユーザーのジョブ一覧取得
     * @param {string} userId - ユーザーID
     * @param {number} limit - 取得件数
     * @param {string} status - ステータスフィルター
     * @returns {Promise<Array>} ジョブ一覧
     */
    static async findByUser(userId, limit = 20, status = null) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        let query = supabase
            .from('generation_jobs')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            console.error('ユーザージョブ取得エラー:', error);
            return [];
        }

        return (data || []).map(jobData => new Job(jobData));
    }

    /**
     * 処理中ジョブ一覧取得
     * @returns {Promise<Array>} 処理中ジョブ一覧
     */
    static async findPendingJobs() {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('generation_jobs')
            .select('*')
            .in('status', ['pending', 'processing'])
            .order('created_at', { ascending: true });

        if (error) {
            console.error('処理中ジョブ取得エラー:', error);
            return [];
        }

        return (data || []).map(jobData => new Job(jobData));
    }

    /**
     * ジョブステータス更新
     * @param {string} status - 新しいステータス
     * @param {Object} updates - 追加の更新データ
     * @returns {Promise<boolean>} 更新成功かどうか
     */
    async updateStatus(status, updates = {}) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const updateData = {
            status: status,
            ...updates
        };

        // ステータスに応じた自動フィールド設定
        if (status === 'processing' && !this.startedAt) {
            updateData.started_at = new Date().toISOString();
        }

        if (['completed', 'failed', 'cancelled'].includes(status) && !this.completedAt) {
            updateData.completed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('generation_jobs')
            .update(updateData)
            .eq('id', this.id)
            .select()
            .single();

        if (error) {
            console.error('ジョブステータス更新エラー:', error);
            return false;
        }

        // オブジェクトのプロパティを更新
        Object.assign(this, data);
        return true;
    }

    /**
     * ジョブ完了処理
     * @param {string} resultUrl - 生成結果URL
     * @param {number} creditsUsed - 使用クレジット数
     * @param {Object} metadata - 追加メタデータ
     * @returns {Promise<boolean>} 完了処理成功かどうか
     */
    async complete(resultUrl, creditsUsed, metadata = {}) {
        return await this.updateStatus('completed', {
            result_url: resultUrl,
            credits_used: creditsUsed,
            ...metadata
        });
    }

    /**
     * ジョブ失敗処理
     * @param {string} errorMessage - エラーメッセージ
     * @param {Object} metadata - 追加メタデータ
     * @returns {Promise<boolean>} 失敗処理成功かどうか
     */
    async fail(errorMessage, metadata = {}) {
        return await this.updateStatus('failed', {
            error_message: errorMessage,
            ...metadata
        });
    }

    /**
     * X投稿URL設定
     * @param {string} xPostUrl - X投稿URL
     * @returns {Promise<boolean>} 設定成功かどうか
     */
    async setXPostUrl(xPostUrl) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { error } = await supabase
            .from('generation_jobs')
            .update({ x_post_url: xPostUrl })
            .eq('id', this.id);

        if (error) {
            console.error('X投稿URL設定エラー:', error);
            return false;
        }

        this.xPostUrl = xPostUrl;
        return true;
    }

    /**
     * ジョブの実行時間取得
     * @returns {number|null} 実行時間（秒）
     */
    getExecutionTime() {
        if (!this.startedAt || !this.completedAt) {
            return null;
        }

        const startTime = new Date(this.startedAt);
        const endTime = new Date(this.completedAt);
        return Math.round((endTime - startTime) / 1000);
    }

    /**
     * ジョブが完了済みかどうか
     * @returns {boolean} 完了済みかどうか
     */
    isCompleted() {
        return this.status === 'completed';
    }

    /**
     * ジョブが失敗かどうか
     * @returns {boolean} 失敗かどうか
     */
    isFailed() {
        return this.status === 'failed';
    }

    /**
     * ジョブが処理中かどうか
     * @returns {boolean} 処理中かどうか
     */
    isProcessing() {
        return ['pending', 'processing'].includes(this.status);
    }

    /**
     * ジョブの経過時間取得
     * @returns {number} 経過時間（秒）
     */
    getElapsedTime() {
        const startTime = new Date(this.createdAt);
        const currentTime = new Date();
        return Math.round((currentTime - startTime) / 1000);
    }

    /**
     * 古いジョブのクリーンアップ
     * @param {number} days - 保持日数
     * @returns {Promise<number>} クリーンアップした件数
     */
    static async cleanupOldJobs(days = 90) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('generation_jobs')
            .delete()
            .lt('created_at', cutoffDate.toISOString())
            .in('status', ['completed', 'failed', 'cancelled'])
            .select('id');

        if (error) {
            console.error('古いジョブクリーンアップエラー:', error);
            return 0;
        }

        return data ? data.length : 0;
    }

    /**
     * ジョブ統計取得
     * @param {number} days - 統計期間（日数）
     * @returns {Promise<Object>} 統計データ
     */
    static async getJobStats(days = 30) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('generation_jobs')
            .select('type, model, status, credits_used, created_at, completed_at, started_at')
            .gte('created_at', sinceDate.toISOString());

        if (error) {
            console.error('ジョブ統計取得エラー:', error);
            return null;
        }

        const stats = {
            totalJobs: data.length,
            completedJobs: 0,
            failedJobs: 0,
            processingJobs: 0,
            totalCreditsUsed: 0,
            averageExecutionTime: 0,
            typeBreakdown: {},
            modelBreakdown: {},
            successRate: 0
        };

        let totalExecutionTime = 0;
        let completedJobsWithTime = 0;

        data.forEach(job => {
            // ステータス集計
            if (job.status === 'completed') stats.completedJobs++;
            else if (job.status === 'failed') stats.failedJobs++;
            else if (['pending', 'processing'].includes(job.status)) stats.processingJobs++;

            // クレジット使用量
            if (job.credits_used) {
                stats.totalCreditsUsed += job.credits_used;
            }

            // タイプ別集計
            stats.typeBreakdown[job.type] = (stats.typeBreakdown[job.type] || 0) + 1;

            // モデル別集計
            stats.modelBreakdown[job.model] = (stats.modelBreakdown[job.model] || 0) + 1;

            // 実行時間計算
            if (job.started_at && job.completed_at && job.status === 'completed') {
                const execTime = (new Date(job.completed_at) - new Date(job.started_at)) / 1000;
                totalExecutionTime += execTime;
                completedJobsWithTime++;
            }
        });

        // 平均実行時間
        if (completedJobsWithTime > 0) {
            stats.averageExecutionTime = Math.round(totalExecutionTime / completedJobsWithTime);
        }

        // 成功率
        if (stats.totalJobs > 0) {
            stats.successRate = Math.round((stats.completedJobs / stats.totalJobs) * 100);
        }

        return stats;
    }

    /**
     * 長時間実行中ジョブの検出
     * @param {number} thresholdMinutes - 閾値（分）
     * @returns {Promise<Array>} 長時間実行中ジョブ一覧
     */
    static async findLongRunningJobs(thresholdMinutes = 10) {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);

        const { data, error } = await supabase
            .from('generation_jobs')
            .select('*')
            .in('status', ['pending', 'processing'])
            .lt('created_at', thresholdTime.toISOString());

        if (error) {
            console.error('長時間実行ジョブ検出エラー:', error);
            return [];
        }

        return (data || []).map(jobData => new Job(jobData));
    }

    /**
     * JSON表現
     * @returns {Object} JSONオブジェクト
     */
    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            type: this.type,
            status: this.status,
            model: this.model,
            prompt: this.prompt,
            params: this.params,
            resultUrl: this.resultUrl,
            xPostUrl: this.xPostUrl,
            creditsUsed: this.creditsUsed,
            creditsReserved: this.creditsReserved,
            reservationId: this.reservationId,
            errorMessage: this.errorMessage,
            startedAt: this.startedAt,
            completedAt: this.completedAt,
            createdAt: this.createdAt,
            executionTime: this.getExecutionTime(),
            elapsedTime: this.getElapsedTime(),
            isCompleted: this.isCompleted(),
            isFailed: this.isFailed(),
            isProcessing: this.isProcessing()
        };
    }
}

module.exports = Job;
