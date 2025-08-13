// creditCalculator.js - クレジット計算・料金体系管理
const edenService = require('../services/edenService');

class CreditCalculator {
    constructor() {
        // 基本クレジットレート（添付資料に基づく実際の料金）
        this.baseCreditRates = {
            // 画像生成モデル
            'replicate/anime-style': 0.23,
            'replicate/vintedois-diffusion': 0.23,
            'replicate/classic': 1.15,
            'minimax/image-01': 3.5,
            'amazon/titan-image-generator-v1_standard': 8,
            'amazon/titan-image-generator-v1_premium': 10,
            'leonardo/lightning-xl': 11,
            'leonardo/anime-xl': 11,
            'leonardo/phoenix': 14,
            'leonardo/kino-xl': 14,
            'leonardo/vision-xl': 14,
            'leonardo/diffusion-xl': 15,
            'leonardo/albedobase-xl': 16,
            'leonardo/sdxl-0.9': 17,
            'openai/dall-e-2': 16,
            'bytedance/seedream-3-0-t2i': 30,
            'openai/dall-e-3': 40,
            'stabilityai/stable-diffusion-v1-6': 10,
            'stabilityai/stable-diffusion-xl': 15,
            
            // 動画生成モデル
            'minimax/T2V/I2V-01-Director': 430,
            'amazon/amazon.nova-reel-v1:0': 500,
            'minimax/MiniMax-Hailuo-02': 560,
            'minimax/S2V-01': 650,
            'bytedance/seedance-lite': 1800,
            'bytedance/seedance-pro': 2250,
            'google/veo-3.0-generate-preview': 6000
        };

        // 倍率設定（品質・サイズ・長さによる調整）
        this.multipliers = {
            // 画像品質倍率
            imageQuality: {
                'standard': 1.0,
                'hd': 1.5,
                'ultra': 2.0
            },
            
            // 画像サイズ倍率
            imageSize: {
                '256x256': 0.5,
                '512x512': 0.7,
                '768x768': 1.0,
                '1024x1024': 1.0,
                '1024x768': 1.0,
                '768x1024': 1.0,
                '1152x896': 1.2,
                '896x1152': 1.2,
                '1792x1024': 1.5,
                '1024x1792': 1.5
            },
            
            // 動画時間倍率（秒単位）
            videoDuration: {
                2: 0.3,
                3: 0.4,
                4: 0.5,
                5: 0.7,
                6: 0.8,
                7: 0.9,
                8: 1.0
            },
            

        };

        // 特別割引・割増設定
        this.specialRates = {
            // 月末割引（残りクレジットを有効活用）
            monthEndDiscount: 0.9,
            
            // 大量利用割引（同時10個以上）
            bulkDiscount: 0.85,
            
            // プレミアム機能割増
            premiumMultiplier: 1.2
        };
    }

    /**
     * 基本クレジット計算
     * @param {string} model - モデル名
     * @param {number} quantity - 生成数量
     * @returns {number} 基本クレジット数
     */
    calculateBaseCost(model, quantity = 1) {
        const baseRate = this.baseCreditRates[model];
        
        if (!baseRate) {
            console.warn(`Unknown model: ${model}. Using default rate.`);
            return 5 * quantity; // デフォルト値
        }
        
        return baseRate * quantity;
    }

    /**
     * 画像生成クレジット計算
     * @param {string} model - モデル名
     * @param {Object} options - 生成オプション
     * @returns {Object} 計算結果
     */
    calculateImageCost(model, options = {}) {
        const {
            quantity = 1,
            size = '1024x1024',
            quality = 'standard',
            style = null
        } = options;

        // 基本コスト
        let baseCost = this.calculateBaseCost(model, quantity);
        
        // サイズ倍率適用
        const sizeMultiplier = this.multipliers.imageSize[size] || 1.0;
        
        // 品質倍率適用
        const qualityMultiplier = this.multipliers.imageQuality[quality] || 1.0;
        
        // スタイル倍率（DALL·E 3のvivid等）
        const styleMultiplier = (style === 'vivid') ? 1.2 : 1.0;
        
        const totalCost = Math.ceil(baseCost * sizeMultiplier * qualityMultiplier * styleMultiplier);
        
        return {
            baseCost: baseCost,
            totalCost: totalCost,
            breakdown: {
                baseRate: this.baseCreditRates[model],
                quantity: quantity,
                sizeMultiplier: sizeMultiplier,
                qualityMultiplier: qualityMultiplier,
                styleMultiplier: styleMultiplier
            }
        };
    }

    /**
     * 動画生成クレジット計算
     * @param {string} model - モデル名
     * @param {Object} options - 生成オプション
     * @returns {Object} 計算結果
     */
    calculateVideoCost(model, options = {}) {
        const {
            duration = 4,
            resolution = '1280x768',
            fps = 24
        } = options;

        // 基本コスト
        let baseCost = this.calculateBaseCost(model, 1);
        
        // 時間倍率適用
        const durationMultiplier = this.multipliers.videoDuration[duration] || (duration / 8.0);
        
        // 解像度倍率（簡易計算）
        const resolutionMultiplier = this.calculateResolutionMultiplier(resolution);
        
        // FPS倍率（24fps基準）
        const fpsMultiplier = fps > 24 ? (fps / 24) : 1.0;
        
        const totalCost = Math.ceil(baseCost * durationMultiplier * resolutionMultiplier * fpsMultiplier);
        
        return {
            baseCost: baseCost,
            totalCost: totalCost,
            breakdown: {
                baseRate: this.baseCreditRates[model],
                duration: duration,
                durationMultiplier: durationMultiplier,
                resolutionMultiplier: resolutionMultiplier,
                fpsMultiplier: fpsMultiplier
            }
        };
    }



    /**
     * 汎用クレジット計算
     * @param {string} type - 生成タイプ ('image', 'video')
     * @param {string} model - モデル名
     * @param {Object} options - オプション
     * @returns {Object} 計算結果
     */
    calculateCost(type, model, options = {}) {
        switch (type) {
            case 'image':
                return this.calculateImageCost(model, options);
            case 'video':
                return this.calculateVideoCost(model, options);
            default:
                return {
                    baseCost: 5,
                    totalCost: 5,
                    breakdown: { error: `Unsupported type: ${type}` }
                };
        }
    }

    /**
     * 利用可能数量計算
     * @param {string} type - 生成タイプ
     * @param {string} model - モデル名
     * @param {number} availableCredits - 利用可能クレジット
     * @param {Object} options - オプション
     * @returns {Object} 利用可能数量情報
     */
    getAffordableQuantity(type, model, availableCredits, options = {}) {
        // 1回あたりのコストを計算
        const singleCost = this.calculateCost(type, model, { ...options, quantity: 1 });
        
        if (singleCost.totalCost <= 0) {
            return {
                maxQuantity: 0,
                costPerItem: singleCost.totalCost,
                totalCostForMax: 0
            };
        }
        
        const maxQuantity = Math.floor(availableCredits / singleCost.totalCost);
        
        return {
            maxQuantity: maxQuantity,
            costPerItem: singleCost.totalCost,
            totalCostForMax: maxQuantity * singleCost.totalCost,
            remainingCredits: availableCredits - (maxQuantity * singleCost.totalCost)
        };
    }

    /**
     * 特別割引適用
     * @param {number} baseCost - 基本コスト
     * @param {Object} discountOptions - 割引オプション
     * @returns {Object} 割引適用後の結果
     */
    applyDiscounts(baseCost, discountOptions = {}) {
        const {
            isMonthEnd = false,
            quantity = 1,
            isPremium = false,
            isFirstTime = false
        } = discountOptions;

        let finalCost = baseCost;
        const appliedDiscounts = [];

        // 月末割引
        if (isMonthEnd) {
            finalCost *= this.specialRates.monthEndDiscount;
            appliedDiscounts.push({
                name: '月末割引',
                rate: this.specialRates.monthEndDiscount,
                savings: baseCost - finalCost
            });
        }

        // 大量割引
        if (quantity >= 10) {
            const bulkDiscount = this.specialRates.bulkDiscount;
            const beforeBulk = finalCost;
            finalCost *= bulkDiscount;
            appliedDiscounts.push({
                name: '大量割引',
                rate: bulkDiscount,
                savings: beforeBulk - finalCost
            });
        }

        // 初回利用割引
        if (isFirstTime) {
            const firstTimeDiscount = 0.8; // 20%割引
            const beforeFirstTime = finalCost;
            finalCost *= firstTimeDiscount;
            appliedDiscounts.push({
                name: '初回利用割引',
                rate: firstTimeDiscount,
                savings: beforeFirstTime - finalCost
            });
        }

        // プレミアム機能割増
        if (isPremium) {
            const beforePremium = finalCost;
            finalCost *= this.specialRates.premiumMultiplier;
            appliedDiscounts.push({
                name: 'プレミアム機能',
                rate: this.specialRates.premiumMultiplier,
                additional: finalCost - beforePremium
            });
        }

        return {
            originalCost: baseCost,
            finalCost: Math.ceil(finalCost),
            appliedDiscounts: appliedDiscounts,
            totalSavings: Math.max(0, baseCost - finalCost)
        };
    }

    /**
     * 解像度倍率計算
     * @param {string} resolution - 解像度文字列
     * @returns {number} 倍率
     */
    calculateResolutionMultiplier(resolution) {
        if (!resolution.includes('x')) return 1.0;
        
        const [width, height] = resolution.split('x').map(Number);
        const pixels = width * height;
        
        // 1280x768 (982,080 pixels) を基準とする
        const basePixels = 1280 * 768;
        
        return Math.max(0.5, pixels / basePixels);
    }







    /**
     * 料金一覧表示用データ取得
     * @returns {Object} 料金表データ
     */
    getPricingTable() {
        const pricing = {
            image: {},
            video: {}
        };

        // Eden.AIの利用可能モデルから料金表を生成
        const availableModels = edenService.getAvailableModels();

        Object.entries(availableModels.image || {}).forEach(([key, info]) => {
            const cost = this.calculateImageCost(key);
            pricing.image[key] = {
                name: info.description,
                credits: cost.totalCost,
                description: info.description
            };
        });

        Object.entries(availableModels.video || {}).forEach(([key, info]) => {
            const cost = this.calculateVideoCost(key);
            pricing.video[key] = {
                name: info.description,
                credits: cost.totalCost,
                description: info.description
            };
        });

        return pricing;
    }

    /**
     * コスト予測（複数オプションの比較）
     * @param {string} type - 生成タイプ
     * @param {Array} scenarios - シナリオ配列
     * @returns {Array} 予測結果配列
     */
    compareCosts(type, scenarios) {
        return scenarios.map(scenario => {
            const cost = this.calculateCost(type, scenario.model, scenario.options);
            
            return {
                ...scenario,
                cost: cost,
                costEfficiency: this.calculateCostEfficiency(cost.totalCost, scenario.quality || 'medium')
            };
        }).sort((a, b) => a.cost.totalCost - b.cost.totalCost);
    }

    /**
     * コストパフォーマンス計算
     * @param {number} cost - コスト
     * @param {string} quality - 品質レベル
     * @returns {number} コストパフォーマンススコア
     */
    calculateCostEfficiency(cost, quality) {
        const qualityScores = {
            'low': 1,
            'medium': 2,
            'high': 3,
            'ultra': 4
        };
        
        const qualityScore = qualityScores[quality] || 2;
        return Math.round((qualityScore / cost) * 100) / 100;
    }

    /**
     * 月間使用推定
     * @param {Array} usage - 使用予定配列
     * @returns {Object} 月間推定
     */
    estimateMonthlyUsage(usage) {
        let totalCost = 0;
        const breakdown = {};

        usage.forEach(item => {
            const cost = this.calculateCost(item.type, item.model, item.options);
            const monthlyCost = cost.totalCost * (item.frequency || 1);
            
            totalCost += monthlyCost;
            
            if (!breakdown[item.type]) {
                breakdown[item.type] = 0;
            }
            breakdown[item.type] += monthlyCost;
        });

        return {
            totalMonthlyCredits: totalCost,
            breakdown: breakdown,
            isWithinPlan: totalCost <= 1000, // 標準プランの月間クレジット
            overage: Math.max(0, totalCost - 1000)
        };
    }
}

module.exports = new CreditCalculator();
