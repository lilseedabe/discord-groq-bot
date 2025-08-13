// jobQueue.js - 非同期ジョブキュー管理（Bull Queue）
const Queue = require('bull');
const redis = require('redis');
const Job = require('../models/Job');
const creditService = require('./creditService');
const edenService = require('./edenService');
const dmService = require('./dmService');
const xIntentService = require('./xIntentService');

class JobQueueService {
    constructor() {
        // Redis接続設定
        this.redisConfig = {
            redis: {
                port: process.env.REDIS_PORT || 6379,
                host: process.env.REDIS_HOST || 'localhost',
                password: process.env.REDIS_PASSWORD || undefined,
                db: 0,
                retryDelayOnFailover: 100,
                enableReadyCheck: false,
                maxRetriesPerRequest: null,
            }
        };

        // ジョブキュー作成
        this.queues = {
            generation: new Queue('AI Generation', this.redisConfig),
            notification: new Queue('Notification', this.redisConfig),
            cleanup: new Queue('Cleanup', this.redisConfig)
        };

        this.isProcessorSetup = false;
        this.setupProcessors();
        this.setupScheduledJobs();

        console.log('🔄 ジョブキューサービスを初期化しました');
    }

    /**
     * ジョブプロセッサー設定
     */
    setupProcessors() {
        if (this.isProcessorSetup) return;

        // AI生成ジョブプロセッサー
        this.queues.generation.process('generate', 3, async (job) => {
            return await this.processGenerationJob(job);
        });

        // 通知ジョブプロセッサー
        this.queues.notification.process('send_dm', 10, async (job) => {
            return await this.processNotificationJob(job);
        });

        // クリーンアップジョブプロセッサー
        this.queues.cleanup.process('cleanup_expired', 1, async (job) => {
            return await this.processCleanupJob(job);
        });

        // エラーハンドリング
        Object.values(this.queues).forEach(queue => {
            queue.on('error', (error) => {
                console.error(`❌ キューエラー (${queue.name}):`, error);
            });

            queue.on('failed', (job, err) => {
                console.error(`❌ ジョブ失敗 (${queue.name}):`, job.id, err.message);
            });

            queue.on('completed', (job) => {
                console.log(`✅ ジョブ完了 (${queue.name}):`, job.id);
            });
        });

        this.isProcessorSetup = true;
    }

    /**
     * AI生成ジョブ追加
     * @param {string} userId - ユーザーID
     * @param {string} type - 生成タイプ
     * @param {string} model - AIモデル
     * @param {string} prompt - プロンプト
     * @param {Object} params - 生成パラメータ
     * @param {number} estimatedCost - 推定コスト
     * @returns {Promise<Object>} ジョブ結果
     */
    async addGenerationJob(userId, type, model, prompt, params = {}, estimatedCost) {
        try {
            // 1. クレジット予約
            console.log(`💰 クレジット予約中: ユーザー${userId}, コスト${estimatedCost}`);
            
            const reservation = await creditService.reserveCredits(
                userId, 
                estimatedCost, 
                null, // jobIdは後で設定
                model,
                `AI generation: ${type} with ${model}`
            );

            if (!reservation.success) {
                throw new Error(reservation.message);
            }

            // 2. ジョブレコード作成
            const jobRecord = await Job.create(
                userId,
                type,
                model,
                prompt,
                params,
                reservation.reservationId
            );

            // 3. ジョブキューに追加
            const queueJob = await this.queues.generation.add('generate', {
                jobId: jobRecord.id,
                userId: userId,
                type: type,
                model: model,
                prompt: prompt,
                params: params,
                reservationId: reservation.reservationId,
                estimatedCost: estimatedCost
            }, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                },
                removeOnComplete: 10,
                removeOnFail: 10,
                delay: 1000 // 1秒遅延で実行
            });

            console.log(`🚀 生成ジョブを追加: ${jobRecord.id} (Queue ID: ${queueJob.id})`);

            return {
                success: true,
                jobId: jobRecord.id,
                queueJobId: queueJob.id,
                estimatedTime: this.getEstimatedTime(type, model),
                reservationId: reservation.reservationId
            };

        } catch (error) {
            console.error('生成ジョブ追加エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * AI生成ジョブ処理
     * @param {Object} job - Bull ジョブオブジェクト
     * @returns {Promise<Object>} 処理結果
     */
    async processGenerationJob(job) {
        const { jobId, userId, type, model, prompt, params, reservationId, estimatedCost } = job.data;
        
        console.log(`🎨 AI生成開始: ${jobId} (${type}/${model})`);
        
        try {
            // 1. ジョブステータス更新
            const jobRecord = await Job.findById(jobId);
            if (!jobRecord) {
                throw new Error('ジョブレコードが見つかりません');
            }

            await jobRecord.updateStatus('processing');

            // 2. プロンプト最適化
            const optimizedPrompt = edenService.optimizePrompt(prompt, type, model);

            // 3. Eden.AIで生成実行
            job.progress(20);
            const generationResult = await edenService.generate(type, optimizedPrompt, model, params);

            if (!generationResult.success) {
                throw new Error(generationResult.error || 'AI生成に失敗しました');
            }

            job.progress(80);

            // 4. 結果URL取得
            let resultUrl;
            if (type === 'image') {
                resultUrl = generationResult.images[0]?.url;
            } else if (type === 'video') {
                resultUrl = generationResult.videoUrl;
            } else if (type === 'audio') {
                resultUrl = generationResult.audioUrl;
            }

            if (!resultUrl) {
                throw new Error('生成結果のURLが取得できませんでした');
            }

            // 5. 実際のクレジット消費
            const actualCost = generationResult.creditsUsed || estimatedCost;
            const creditResult = await creditService.consumeReservedCredits(
                reservationId,
                actualCost,
                model,
                `${type} generation completed`
            );

            if (!creditResult.success) {
                console.warn('クレジット消費警告:', creditResult.error);
            }

            // 6. ジョブ完了処理
            await jobRecord.complete(resultUrl, actualCost, {
                generation_metadata: generationResult.metadata,
                optimized_prompt: optimizedPrompt
            });

            // 7. 通知ジョブ追加（X投稿URL含む）
            const xPostUrl = xIntentService.generateTweetIntent(
                resultUrl,
                prompt,
                model,
                type,
                { includeModel: true }
            );
            
            await this.addNotificationJob(userId, jobId, 'completed', {
                resultUrl: resultUrl,
                type: type,
                model: model,
                prompt: prompt,
                creditsUsed: actualCost,
                xPostUrl: xPostUrl,
                metadata: generationResult.metadata
            });
            
            // X投稿URLをジョブレコードに保存
            await jobRecord.setXPostUrl(xPostUrl);

            job.progress(100);

            console.log(`✅ AI生成完了: ${jobId}`);

            return {
                success: true,
                jobId: jobId,
                resultUrl: resultUrl,
                creditsUsed: actualCost,
                metadata: generationResult.metadata
            };

        } catch (error) {
            console.error(`❌ AI生成エラー (${jobId}):`, error);

            // エラー時の予約解除
            if (reservationId) {
                await creditService.releaseReservation(reservationId, error.message);
            }

            // ジョブ失敗処理
            const jobRecord = await Job.findById(jobId);
            if (jobRecord) {
                await jobRecord.fail(error.message);
            }

            // エラー通知
            await this.addNotificationJob(userId, jobId, 'failed', {
                error: error.message,
                type: type,
                model: model,
                prompt: prompt,
                troubleshootingUrl: this.generateTroubleshootingUrl(error.message, type, model)
            });

            throw error;
        }
    }

    /**
     * 通知ジョブ追加
     * @param {string} userId - ユーザーID
     * @param {string} jobId - ジョブID
     * @param {string} status - ステータス
     * @param {Object} data - 通知データ
     * @returns {Promise<Object>} 追加結果
     */
    async addNotificationJob(userId, jobId, status, data) {
        try {
            const notificationJob = await this.queues.notification.add('send_dm', {
                userId: userId,
                jobId: jobId,
                status: status,
                data: data
            }, {
                attempts: 3,
                backoff: 'exponential',
                removeOnComplete: 20,
                removeOnFail: 5
            });

            return {
                success: true,
                notificationJobId: notificationJob.id
            };

        } catch (error) {
            console.error('通知ジョブ追加エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 通知ジョブ処理
     * @param {Object} job - Bull ジョブオブジェクト
     * @returns {Promise<Object>} 処理結果
     */
    async processNotificationJob(job) {
        const { userId, jobId, status, data } = job.data;

        try {
            // DM通知送信
            const notificationResult = await dmService.sendJobNotification(
                userId, 
                jobId, 
                status, 
                data
            );

            if (!notificationResult.success) {
                // DM送信失敗時はエラーログのみ（ジョブ自体は失敗扱いにしない）
                console.warn(`DM送信失敗 (ユーザー: ${userId}):`, notificationResult.error);
            }

            return {
                success: true,
                notificationSent: notificationResult.success
            };

        } catch (error) {
            console.error('通知処理エラー:', error);
            throw error;
        }
    }

    /**
     * クリーンアップジョブ処理
     * @param {Object} job - Bull ジョブオブジェクト
     * @returns {Promise<Object>} 処理結果
     */
    async processCleanupJob(job) {
        const { type } = job.data;

        try {
            let result = {};

            switch (type) {
                case 'expired_reservations':
                    const creditCleanup = await creditService.cleanupExpiredReservations();
                    result.expiredReservations = creditCleanup.cleanedCount || 0;
                    break;

                case 'old_jobs':
                    const jobCleanup = await Job.cleanupOldJobs(90);
                    result.oldJobs = jobCleanup || 0;
                    break;

                case 'all':
                    const allCredit = await creditService.cleanupExpiredReservations();
                    const allJobs = await Job.cleanupOldJobs(90);
                    result = {
                        expiredReservations: allCredit.cleanedCount || 0,
                        oldJobs: allJobs || 0
                    };
                    break;

                default:
                    throw new Error(`Unknown cleanup type: ${type}`);
            }

            console.log('🧹 クリーンアップ完了:', result);

            return {
                success: true,
                cleaned: result
            };

        } catch (error) {
            console.error('クリーンアップエラー:', error);
            throw error;
        }
    }

    /**
     * 定期実行ジョブ設定
     */
    setupScheduledJobs() {
        // 期限切れ予約クリーンアップ（10分毎）
        this.queues.cleanup.add('cleanup_expired', 
            { type: 'expired_reservations' },
            { 
                repeat: { cron: '*/10 * * * *' },
                removeOnComplete: 5,
                removeOnFail: 2
            }
        );

        // 古いジョブクリーンアップ（毎日2時）
        this.queues.cleanup.add('cleanup_old_jobs',
            { type: 'old_jobs' },
            {
                repeat: { cron: '0 2 * * *' },
                removeOnComplete: 3,
                removeOnFail: 1
            }
        );

        console.log('📅 定期実行ジョブを設定しました');
    }

    /**
     * ジョブステータス取得
     * @param {string} jobId - ジョブID
     * @returns {Promise<Object>} ステータス情報
     */
    async getJobStatus(jobId) {
        try {
            const jobRecord = await Job.findById(jobId);
            
            if (!jobRecord) {
                return {
                    success: false,
                    error: 'ジョブが見つかりません'
                };
            }

            // キュー内のジョブも確認
            const queueJobs = await this.queues.generation.getJobs(['waiting', 'active', 'completed', 'failed']);
            const queueJob = queueJobs.find(j => j.data.jobId === jobId);

            return {
                success: true,
                job: jobRecord.toJSON(),
                queueStatus: queueJob ? {
                    id: queueJob.id,
                    progress: queueJob.progress(),
                    state: await queueJob.getState(),
                    attempts: queueJob.attemptsMade,
                    failedReason: queueJob.failedReason
                } : null
            };

        } catch (error) {
            console.error('ジョブステータス取得エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * ユーザーのアクティブジョブ一覧
     * @param {string} userId - ユーザーID
     * @returns {Promise<Array>} アクティブジョブ一覧
     */
    async getUserActiveJobs(userId) {
        try {
            const activeJobs = await Job.findByUser(userId, 10, null);
            const processingJobs = activeJobs.filter(job => job.isProcessing());

            return processingJobs.map(job => job.toJSON());

        } catch (error) {
            console.error('ユーザーアクティブジョブ取得エラー:', error);
            return [];
        }
    }

    /**
     * ジョブキャンセル
     * @param {string} jobId - ジョブID
     * @param {string} userId - ユーザーID（権限確認用）
     * @returns {Promise<Object>} キャンセル結果
     */
    async cancelJob(jobId, userId) {
        try {
            const jobRecord = await Job.findById(jobId);
            
            if (!jobRecord) {
                return {
                    success: false,
                    error: 'ジョブが見つかりません'
                };
            }

            if (jobRecord.userId !== userId) {
                return {
                    success: false,
                    error: '権限がありません'
                };
            }

            if (!jobRecord.isProcessing()) {
                return {
                    success: false,
                    error: 'キャンセルできないステータスです'
                };
            }

            // キュー内のジョブを削除
            const queueJobs = await this.queues.generation.getJobs(['waiting', 'active']);
            const queueJob = queueJobs.find(j => j.data.jobId === jobId);
            
            if (queueJob) {
                await queueJob.remove();
            }

            // 予約解除
            if (jobRecord.reservationId) {
                await creditService.releaseReservation(
                    jobRecord.reservationId, 
                    'Job cancelled by user'
                );
            }

            // ジョブレコード更新
            await jobRecord.updateStatus('cancelled');

            return {
                success: true,
                message: 'ジョブをキャンセルしました'
            };

        } catch (error) {
            console.error('ジョブキャンセルエラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 推定実行時間取得
     * @param {string} type - 生成タイプ
     * @param {string} model - モデル名
     * @returns {number} 推定時間（秒）
     */
    getEstimatedTime(type, model) {
        const estimates = {
            image: {
                'openai-dalle3': 60,
                'openai-dalle2': 30,
                'stabilityai-sdxl': 45,
                'stabilityai-sd': 20,
                'replicate-flux': 15,
                'default': 30
            },
            video: {
                'runwayml-gen2': 300,
                'default': 300
            },
            audio: {
                'openai-tts': 15,
                'elevenlabs-tts': 25,
                'default': 20
            }
        };

        return estimates[type]?.[model] || estimates[type]?.default || 60;
    }

    /**
     * キュー統計取得
     * @returns {Promise<Object>} 統計情報
     */
    async getQueueStats() {
        try {
            const stats = {};

            for (const [name, queue] of Object.entries(this.queues)) {
                const waiting = await queue.getWaiting();
                const active = await queue.getActive();
                const completed = await queue.getCompleted();
                const failed = await queue.getFailed();

                stats[name] = {
                    waiting: waiting.length,
                    active: active.length,
                    completed: completed.length,
                    failed: failed.length,
                    total: waiting.length + active.length + completed.length + failed.length
                };
            }

            return {
                success: true,
                stats: stats,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('キュー統計取得エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * トラブルシューティングURL生成
     * @param {string} errorMessage - エラーメッセージ
     * @param {string} type - 生成タイプ
     * @param {string} model - モデル名
     * @returns {string} トラブルシューティングURL
     */
    generateTroubleshootingUrl(errorMessage, type, model) {
        const baseUrl = 'https://note.com/troubleshooting'; // 実際のトラブルシューティングページに変更
        const params = new URLSearchParams({
            error: errorMessage.substring(0, 100),
            type: type,
            model: model,
            timestamp: new Date().toISOString()
        });
        
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * システム終了時のクリーンアップ
     */
    async close() {
        console.log('🔄 ジョブキューを終了中...');
        
        for (const queue of Object.values(this.queues)) {
            await queue.close();
        }
        
        console.log('✅ ジョブキューを終了しました');
    }
}

module.exports = new JobQueueService();
