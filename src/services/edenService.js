// edenService.js - Eden.AI統合サービス（実際のAPI仕様対応版）
const fetch = require('node-fetch');

class EdenService {
    constructor() {
        this.apiKey = process.env.EDEN_AI_API_KEY;
        this.baseUrl = 'https://api.edenai.run/v2';
        
        if (!this.apiKey) {
            console.warn('⚠️ EDEN_AI_API_KEY が設定されていません');
        }

        // 実際にEden.AIで利用可能なモデル定義（添付資料準拠）
        this.availableModels = {
            // 画像生成プロバイダー
            image: {
                'replicate/anime-style': {
                    provider: 'replicate',
                    model: 'anime-style',
                    credits: 0.23,
                    maxPromptLength: 1000,
                    supportedSizes: ['256x256', '512x512', '1024x1024'],
                    description: 'Replicate Anime Style - アニメ風画像生成'
                },
                'replicate/vintedois-diffusion': {
                    provider: 'replicate',
                    model: 'vintedois-diffusion',
                    credits: 0.23,
                    maxPromptLength: 1000,
                    supportedSizes: ['256x256', '512x512', '1024x1024'],
                    description: 'Replicate Vintedois Diffusion - ヴィンテージ風'
                },
                'replicate/classic': {
                    provider: 'replicate',
                    model: 'classic',
                    credits: 1.15,
                    maxPromptLength: 1000,
                    supportedSizes: ['256x256', '512x512', '1024x1024'],
                    description: 'Replicate Classic - クラシックスタイル'
                },
                'minimax/image-01': {
                    provider: 'minimax',
                    model: 'image-01',
                    credits: 3.5,
                    maxPromptLength: 1500,
                    supportedSizes: ['任意'],
                    description: 'MiniMax Image-01 - 任意サイズ対応'
                },
                'amazon/titan-image-generator-v1_standard': {
                    provider: 'amazon',
                    model: 'titan-image-generator-v1',
                    credits: 8,
                    maxPromptLength: 1000,
                    supportedSizes: ['512x512', '1024x1024'],
                    description: 'Amazon Titan Standard - 標準品質'
                },
                'amazon/titan-image-generator-v1_premium': {
                    provider: 'amazon',
                    model: 'titan-image-generator-v1-premium',
                    credits: 10,
                    maxPromptLength: 1000,
                    supportedSizes: ['512x512', '1024x1024'],
                    description: 'Amazon Titan Premium - 高品質'
                },
                'leonardo/lightning-xl': {
                    provider: 'leonardo',
                    model: 'lightning-xl',
                    credits: 11,
                    maxPromptLength: 1200,
                    supportedSizes: ['512x512', '1024x1024'],
                    description: 'Leonardo Lightning XL - 高速高品質'
                },
                'leonardo/anime-xl': {
                    provider: 'leonardo',
                    model: 'anime-xl',
                    credits: 11,
                    maxPromptLength: 1200,
                    supportedSizes: ['512x512', '1024x1024'],
                    description: 'Leonardo Anime XL - アニメ専用'
                },
                'openai/dall-e-2': {
                    provider: 'openai',
                    model: 'dall-e-2',
                    credits: 16,
                    maxPromptLength: 1000,
                    supportedSizes: ['256x256', '512x512', '1024x1024'],
                    description: 'DALL·E 2 - OpenAI画像生成'
                },
                'bytedance/seedream-3-0-t2i': {
                    provider: 'bytedance',
                    model: 'seedream-3-0-t2i',
                    credits: 30,
                    maxPromptLength: 1000,
                    supportedSizes: ['任意'],
                    description: 'ByteDance SeeDream 3.0 - 任意サイズ'
                },
                'openai/dall-e-3': {
                    provider: 'openai',
                    model: 'dall-e-3',
                    credits: 40,
                    maxPromptLength: 4000,
                    supportedSizes: ['512x512', '1024x1024', '1024x1792', '1792x1024'],
                    description: 'DALL·E 3 - 最高品質画像生成'
                },
                'stabilityai/stable-diffusion-v1-6': {
                    provider: 'stabilityai',
                    model: 'stable-diffusion-v1-6',
                    credits: 10,
                    maxPromptLength: 1000,
                    supportedSizes: ['512x512'],
                    description: 'Stable Diffusion v1.6 - 標準品質'
                },
                'stabilityai/stable-diffusion-xl': {
                    provider: 'stabilityai',
                    model: 'stable-diffusion-xl',
                    credits: 15,
                    maxPromptLength: 2000,
                    supportedSizes: ['1024x1024'],
                    description: 'Stable Diffusion XL - 高解像度'
                }
            },
            
            // 動画生成プロバイダー
            video: {
                'minimax/T2V/I2V-01-Director': {
                    provider: 'minimax',
                    model: 'T2V-I2V-01-Director',
                    credits: 430,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280', '1024x1024'],
                    description: 'MiniMax T2V/I2V Director - 高品質動画生成'
                },
                'amazon/amazon.nova-reel-v1:0': {
                    provider: 'amazon',
                    model: 'nova-reel-v1',
                    credits: 500,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280'],
                    description: 'Amazon Nova Reel - 商用動画生成'
                },
                'minimax/MiniMax-Hailuo-02': {
                    provider: 'minimax',
                    model: 'hailuo-02',
                    credits: 560,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280', '1024x1024'],
                    description: 'MiniMax Hailuo 02 - 進化版動画生成'
                },
                'minimax/S2V-01': {
                    provider: 'minimax',
                    model: 'S2V-01',
                    credits: 650,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280'],
                    description: 'MiniMax S2V-01 - Scene to Video'
                },
                'bytedance/seedance-lite': {
                    provider: 'bytedance',
                    model: 'seedance-lite',
                    credits: 1800,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280'],
                    description: 'ByteDance SeeDance Lite - 軽量版'
                },
                'bytedance/seedance-pro': {
                    provider: 'bytedance',
                    model: 'seedance-pro',
                    credits: 2250,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280', '1024x1024'],
                    description: 'ByteDance SeeDance Pro - プロ版'
                },
                'google/veo-3.0-generate-preview': {
                    provider: 'google',
                    model: 'veo-3.0-generate-preview',
                    credits: 6000,
                    maxPromptLength: 500,
                    maxDuration: 8,
                    supportedSizes: ['1280x768', '768x1280', '1024x1024'],
                    description: 'Google Veo 3.0 - 全クレジット消費'
                }
            }
        };
    }

    /**
     * 利用可能なモデル一覧取得
     * @param {string} type - タイプフィルター ('image', 'video', 'audio')
     * @returns {Object} モデル一覧
     */
    getAvailableModels(type = null) {
        if (type) {
            return this.availableModels[type] || {};
        }
        return this.availableModels;
    }

    /**
     * モデル情報取得
     * @param {string} modelKey - モデルキー
     * @param {string} type - タイプ
     * @returns {Object|null} モデル情報
     */
    getModelInfo(modelKey, type) {
        return this.availableModels[type]?.[modelKey] || null;
    }

    /**
     * 画像生成
     * @param {string} prompt - プロンプト
     * @param {string} modelKey - モデルキー
     * @param {Object} options - 生成オプション
     * @returns {Promise<Object>} 生成結果
     */
    async generateImage(prompt, modelKey = 'replicate/classic', options = {}) {
        try {
            const modelInfo = this.getModelInfo(modelKey, 'image');
            if (!modelInfo) {
                throw new Error(`Unknown image model: ${modelKey}`);
            }

            // プロンプト長チェック
            if (prompt.length > modelInfo.maxPromptLength) {
                throw new Error(`Prompt too long. Max length: ${modelInfo.maxPromptLength}`);
            }

            // リクエストパラメータ構築
            const requestBody = {
                providers: modelInfo.provider,
                text: prompt,
                resolution: options.size || modelInfo.supportedSizes[0],
                num_images: options.quantity || 1,
                response_as_dict: true,
                attributes_as_list: false,
                show_original_response: false
            };

            // プロバイダー固有のパラメータ
            if (modelInfo.provider === 'openai') {
                requestBody.quality = options.quality || 'standard';
                requestBody.style = options.style || 'vivid';
            } else if (modelInfo.provider === 'stabilityai') {
                requestBody.cfg_scale = options.cfgScale || 7;
                requestBody.steps = options.steps || 30;
                requestBody.seed = options.seed || Math.floor(Math.random() * 1000000);
            }

            console.log(`🎨 Eden.AI画像生成開始: ${modelInfo.provider} - ${prompt.substring(0, 50)}...`);

            const response = await fetch(`${this.baseUrl}/image/generation`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error('Eden.AI APIエラー:', response.status, errorData);
                throw new Error(`Eden.AI API Error: ${response.status} - ${errorData}`);
            }

            const result = await response.json();
            
            // レスポンス解析
            const providerResult = result[modelInfo.provider];
            if (!providerResult || providerResult.status !== 'success') {
                const errorMsg = providerResult?.error || 'Unknown error';
                throw new Error(`Generation failed: ${errorMsg}`);
            }

            const images = providerResult.items || [];
            if (images.length === 0) {
                throw new Error('No images generated');
            }

            return {
                success: true,
                model: modelKey,
                provider: modelInfo.provider,
                prompt: prompt,
                images: images.map(img => ({
                    url: img.image,
                    size: requestBody.resolution,
                    seed: img.image_seed || null
                })),
                creditsUsed: modelInfo.credits * requestBody.num_images,
                metadata: {
                    requestId: result.request_id || null,
                    processingTime: result.processing_time || null,
                    options: options
                }
            };

        } catch (error) {
            console.error('画像生成エラー:', error);
            return {
                success: false,
                error: error.message,
                model: modelKey,
                prompt: prompt
            };
        }
    }

    /**
     * 動画生成
     * @param {string} prompt - プロンプト
     * @param {string} modelKey - モデルキー
     * @param {Object} options - 生成オプション
     * @returns {Promise<Object>} 生成結果
     */
    async generateVideo(prompt, modelKey = 'minimax/T2V/I2V-01-Director', options = {}) {
        try {
            const modelInfo = this.getModelInfo(modelKey, 'video');
            if (!modelInfo) {
                throw new Error(`Unknown video model: ${modelKey}`);
            }

            // プロンプト長チェック
            if (prompt.length > modelInfo.maxPromptLength) {
                throw new Error(`Prompt too long. Max length: ${modelInfo.maxPromptLength}`);
            }

            const duration = Math.min(options.duration || 4, modelInfo.maxDuration);

            const requestBody = {
                providers: modelInfo.provider,
                text: prompt,
                duration: duration,
                resolution: options.size || modelInfo.supportedSizes[0],
                response_as_dict: true
            };

            console.log(`🎬 Eden.AI動画生成開始: ${modelInfo.provider} - ${prompt.substring(0, 50)}...`);

            const response = await fetch(`${this.baseUrl}/video/generation`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error('Eden.AI動画APIエラー:', response.status, errorData);
                throw new Error(`Eden.AI Video API Error: ${response.status} - ${errorData}`);
            }

            const result = await response.json();
            
            const providerResult = result[modelInfo.provider];
            if (!providerResult || providerResult.status !== 'success') {
                const errorMsg = providerResult?.error || 'Unknown error';
                throw new Error(`Video generation failed: ${errorMsg}`);
            }

            return {
                success: true,
                model: modelKey,
                provider: modelInfo.provider,
                prompt: prompt,
                videoUrl: providerResult.video_url,
                duration: duration,
                resolution: requestBody.resolution,
                creditsUsed: modelInfo.credits,
                metadata: {
                    requestId: result.request_id || null,
                    processingTime: result.processing_time || null,
                    fileSize: providerResult.file_size || null
                }
            };

        } catch (error) {
            console.error('動画生成エラー:', error);
            return {
                success: false,
                error: error.message,
                model: modelKey,
                prompt: prompt
            };
        }
    }



    /**
     * 汎用生成メソッド
     * @param {string} type - 生成タイプ ('image', 'video')
     * @param {string} prompt - プロンプト/テキスト
     * @param {string} modelKey - モデルキー
     * @param {Object} options - オプション
     * @returns {Promise<Object>} 生成結果
     */
    async generate(type, prompt, modelKey, options = {}) {
        switch (type) {
            case 'image':
                return await this.generateImage(prompt, modelKey, options);
            case 'video':
                return await this.generateVideo(prompt, modelKey, options);
            default:
                return {
                    success: false,
                    error: `Unsupported generation type: ${type}`
                };
        }
    }

    /**
     * API接続テスト
     * @returns {Promise<Object>} テスト結果
     */
    async testConnection() {
        try {
            if (!this.apiKey) {
                return {
                    success: false,
                    error: 'API key not configured'
                };
            }

            // 簡単な画像生成でテスト
            const testResult = await this.generateImage(
                'A simple red circle',
                'replicate/classic',
                { size: '512x512' }
            );

            return {
                success: testResult.success,
                message: testResult.success ? 'Eden.AI connection successful' : 'Connection failed',
                error: testResult.error || null
            };

        } catch (error) {
            console.error('Eden.AI接続テストエラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 利用可能プロバイダー確認
     * @returns {Promise<Object>} プロバイダー一覧
     */
    async getAvailableProviders() {
        try {
            const response = await fetch(`${this.baseUrl}/info/providers`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const result = await response.json();
            
            return {
                success: true,
                providers: result,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('プロバイダー取得エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * API使用量確認
     * @returns {Promise<Object>} 使用量情報
     */
    async getUsageStats() {
        try {
            const response = await fetch(`${this.baseUrl}/info/usage`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const result = await response.json();
            
            return {
                success: true,
                usage: result,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('使用量取得エラー:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * プロンプト最適化（内部処理用）
     * @param {string} prompt - 元のプロンプト
     * @param {string} type - 生成タイプ
     * @param {string} modelKey - モデルキー
     * @returns {string} 最適化されたプロンプト
     */
    optimizePrompt(prompt, type, modelKey) {
        const modelInfo = this.getModelInfo(modelKey, type);
        if (!modelInfo) return prompt;

        let optimized = prompt.trim();

        // プロンプト長制限対応
        if (optimized.length > modelInfo.maxPromptLength) {
            optimized = optimized.substring(0, modelInfo.maxPromptLength - 3) + '...';
            console.warn(`プロンプトを${modelInfo.maxPromptLength}文字に短縮しました`);
        }

        // プロバイダー別最適化
        if (modelInfo.provider === 'openai' && type === 'image') {
            // DALL·E用の最適化（詳細な説明を推奨）
            if (!optimized.includes('detailed') && !optimized.includes('high quality')) {
                optimized = `detailed, high quality, ${optimized}`;
            }
        } else if (modelInfo.provider === 'stabilityai') {
            // Stable Diffusion用の最適化
            if (!optimized.includes('8k') && !optimized.includes('detailed')) {
                optimized = `${optimized}, highly detailed, 8k resolution`;
            }
        }

        return optimized;
    }
}

module.exports = new EdenService();
