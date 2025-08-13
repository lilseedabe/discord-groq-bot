// validators.js - 入力検証・バリデーション機能
const edenService = require('../services/edenService');

class Validators {
    constructor() {
        // 基本的な制限値
        this.limits = {
            prompt: {
                minLength: 3,
                maxLength: 4000,
                bannedWords: ['nsfw', 'explicit', 'adult', 'porn', 'nude']
            },
            redemptionCode: {
                pattern: /^NOTE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
                length: 19
            },
            credits: {
                min: 1,
                max: 10000,
                dailyLimit: 500
            },
            generation: {
                maxConcurrent: 3,
                maxPerHour: 20,
                maxPerDay: 50
            }
        };

        // 安全でないコンテンツ検出パターン
        this.unsafePatterns = [
            /violence|kill|death|blood|gore/i,
            /naked|nude|sexual|erotic|porn/i,
            /drug|cocaine|heroin|marijuana/i,
            /hate|racist|nazi|terrorism/i,
            /suicide|self.?harm|cutting/i
        ];

        // 許可されたファイル形式
        this.allowedFormats = {
            image: ['jpg', 'jpeg', 'png', 'webp'],
            video: ['mp4', 'webm', 'mov']
        };
    }

    /**
     * プロンプト検証
     * @param {string} prompt - プロンプト
     * @param {string} type - 生成タイプ
     * @param {string} model - モデル名
     * @returns {Object} 検証結果
     */
    validatePrompt(prompt, type = 'image', model = null) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            cleanedPrompt: prompt
        };

        // 基本検証
        if (!prompt || typeof prompt !== 'string') {
            result.isValid = false;
            result.errors.push('プロンプトが指定されていません');
            return result;
        }

        const trimmedPrompt = prompt.trim();

        // 長さ検証
        if (trimmedPrompt.length < this.limits.prompt.minLength) {
            result.isValid = false;
            result.errors.push(`プロンプトが短すぎます（最小${this.limits.prompt.minLength}文字）`);
        }

        if (trimmedPrompt.length > this.limits.prompt.maxLength) {
            result.isValid = false;
            result.errors.push(`プロンプトが長すぎます（最大${this.limits.prompt.maxLength}文字）`);
        }

        // モデル固有の制限チェック
        if (model) {
            const modelInfo = edenService.getModelInfo(model, type);
            if (modelInfo && modelInfo.maxPromptLength) {
                if (trimmedPrompt.length > modelInfo.maxPromptLength) {
                    result.warnings.push(`モデル ${model} の推奨最大長 ${modelInfo.maxPromptLength} 文字を超えています`);
                    result.cleanedPrompt = trimmedPrompt.substring(0, modelInfo.maxPromptLength);
                }
            }
        }

        // 安全でないコンテンツ検証
        const unsafeCheck = this.checkUnsafeContent(trimmedPrompt);
        if (!unsafeCheck.isSafe) {
            result.isValid = false;
            result.errors.push('不適切なコンテンツが含まれています');
            result.errors.push(...unsafeCheck.reasons);
        }

        // 禁止単語チェック
        const bannedWords = this.checkBannedWords(trimmedPrompt);
        if (bannedWords.length > 0) {
            result.isValid = false;
            result.errors.push(`禁止されている単語が含まれています: ${bannedWords.join(', ')}`);
        }

        // 言語別検証
        const languageCheck = this.validateLanguage(trimmedPrompt, type);
        if (!languageCheck.isValid) {
            result.warnings.push(...languageCheck.warnings);
        }

        // プロンプト最適化提案
        const optimization = this.suggestOptimization(trimmedPrompt, type, model);
        if (optimization.suggestions.length > 0) {
            result.warnings.push('プロンプト改善提案があります');
            result.optimizationSuggestions = optimization.suggestions;
        }

        result.cleanedPrompt = result.cleanedPrompt.trim();

        return result;
    }

    /**
     * リデンプションコード検証
     * @param {string} code - リデンプションコード
     * @returns {Object} 検証結果
     */
    validateRedemptionCode(code) {
        const result = {
            isValid: true,
            errors: [],
            formattedCode: null
        };

        if (!code || typeof code !== 'string') {
            result.isValid = false;
            result.errors.push('リデンプションコードが指定されていません');
            return result;
        }

        const upperCode = code.toUpperCase().trim();

        // フォーマット検証
        if (!this.limits.redemptionCode.pattern.test(upperCode)) {
            result.isValid = false;
            result.errors.push('リデンプションコードの形式が正しくありません');
            result.errors.push('正しい形式: NOTE-XXXX-XXXX-XXXX');
            return result;
        }

        // 長さ検証
        if (upperCode.length !== this.limits.redemptionCode.length) {
            result.isValid = false;
            result.errors.push('リデンプションコードの長さが正しくありません');
            return result;
        }

        result.formattedCode = upperCode;
        return result;
    }

    /**
     * 生成オプション検証
     * @param {string} type - 生成タイプ
     * @param {string} model - モデル名
     * @param {Object} options - オプション
     * @returns {Object} 検証結果
     */
    validateGenerationOptions(type, model, options) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            validatedOptions: { ...options }
        };

        // モデル情報取得
        const modelInfo = edenService.getModelInfo(model, type);
        if (!modelInfo) {
            result.isValid = false;
            result.errors.push(`サポートされていないモデル: ${model}`);
            return result;
        }

        // タイプ別検証
        switch (type) {
            case 'image':
                Object.assign(result, this.validateImageOptions(options, modelInfo));
                break;
            case 'video':
                Object.assign(result, this.validateVideoOptions(options, modelInfo));
                break;

            default:
                result.isValid = false;
                result.errors.push(`サポートされていない生成タイプ: ${type}`);
        }

        return result;
    }

    /**
     * 画像生成オプション検証
     * @param {Object} options - オプション
     * @param {Object} modelInfo - モデル情報
     * @returns {Object} 検証結果
     */
    validateImageOptions(options, modelInfo) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            validatedOptions: { ...options }
        };

        // サイズ検証
        if (options.size) {
            if (!modelInfo.supportedSizes.includes(options.size)) {
                result.warnings.push(`サイズ ${options.size} はサポートされていません`);
                result.validatedOptions.size = modelInfo.supportedSizes[0];
                result.warnings.push(`デフォルトサイズ ${modelInfo.supportedSizes[0]} を使用します`);
            }
        } else {
            result.validatedOptions.size = modelInfo.supportedSizes[0];
        }

        // 数量検証
        if (options.quantity) {
            if (options.quantity < 1 || options.quantity > 10) {
                result.isValid = false;
                result.errors.push('生成数量は1〜10個の間で指定してください');
            }
        } else {
            result.validatedOptions.quantity = 1;
        }

        // 品質検証（DALL·E用）
        if (options.quality && modelInfo.provider === 'openai') {
            if (!['standard', 'hd'].includes(options.quality)) {
                result.warnings.push('品質設定が無効です。standardを使用します');
                result.validatedOptions.quality = 'standard';
            }
        }

        // スタイル検証（DALL·E 3用）
        if (options.style && modelInfo.model === 'dall-e-3') {
            if (!['vivid', 'natural'].includes(options.style)) {
                result.warnings.push('スタイル設定が無効です。naturalを使用します');
                result.validatedOptions.style = 'natural';
            }
        }

        return result;
    }

    /**
     * 動画生成オプション検証
     * @param {Object} options - オプション
     * @param {Object} modelInfo - モデル情報
     * @returns {Object} 検証結果
     */
    validateVideoOptions(options, modelInfo) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            validatedOptions: { ...options }
        };

        // 時間検証
        if (options.duration) {
            if (options.duration < 2 || options.duration > modelInfo.maxDuration) {
                result.isValid = false;
                result.errors.push(`動画時間は2〜${modelInfo.maxDuration}秒の間で指定してください`);
            }
        } else {
            result.validatedOptions.duration = 4; // デフォルト4秒
        }

        // 解像度検証
        if (options.size) {
            if (!modelInfo.supportedSizes.includes(options.size)) {
                result.warnings.push(`解像度 ${options.size} はサポートされていません`);
                result.validatedOptions.size = modelInfo.supportedSizes[0];
            }
        } else {
            result.validatedOptions.size = modelInfo.supportedSizes[0];
        }

        return result;
    }

    /**
     * 音声生成オプション検証
     * @param {Object} options - オプション
     * @param {Object} modelInfo - モデル情報
     * @returns {Object} 検証結果
     */
    validateAudioOptions(options, modelInfo) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            validatedOptions: { ...options }
        };

        // 音声タイプ検証
        if (options.voice) {
            if (!modelInfo.supportedVoices.includes(options.voice)) {
                result.warnings.push(`音声 ${options.voice} はサポートされていません`);
                result.validatedOptions.voice = modelInfo.supportedVoices[0];
            }
        } else {
            result.validatedOptions.voice = modelInfo.supportedVoices[0];
        }

        // 速度検証（OpenAI TTS用）
        if (options.speed && modelInfo.provider === 'openai') {
            if (options.speed < 0.25 || options.speed > 4.0) {
                result.warnings.push('音声速度は0.25〜4.0の間で指定してください');
                result.validatedOptions.speed = 1.0;
            }
        }

        return result;
    }

    /**
     * 安全でないコンテンツチェック
     * @param {string} text - テキスト
     * @returns {Object} チェック結果
     */
    checkUnsafeContent(text) {
        const result = {
            isSafe: true,
            reasons: [],
            riskLevel: 'low'
        };

        const lowerText = text.toLowerCase();

        // パターンマッチング
        this.unsafePatterns.forEach((pattern, index) => {
            if (pattern.test(lowerText)) {
                result.isSafe = false;
                
                const categories = [
                    '暴力的な内容',
                    'アダルト・性的内容',
                    '薬物関連',
                    'ヘイト・差別的内容',
                    '自傷・自殺関連'
                ];
                
                result.reasons.push(categories[index] || '不適切な内容');
                result.riskLevel = 'high';
            }
        });

        // 追加の安全性チェック
        const suspiciousWords = ['hack', 'crack', 'illegal', 'bomb', 'weapon'];
        const foundSuspicious = suspiciousWords.filter(word => lowerText.includes(word));
        
        if (foundSuspicious.length > 0) {
            result.riskLevel = result.riskLevel === 'high' ? 'high' : 'medium';
            result.reasons.push('疑わしい内容が含まれています');
        }

        return result;
    }

    /**
     * 禁止単語チェック
     * @param {string} text - テキスト
     * @returns {Array} 見つかった禁止単語
     */
    checkBannedWords(text) {
        const lowerText = text.toLowerCase();
        return this.limits.prompt.bannedWords.filter(word => 
            lowerText.includes(word.toLowerCase())
        );
    }

    /**
     * 言語検証
     * @param {string} text - テキスト
     * @param {string} type - 生成タイプ
     * @returns {Object} 検証結果
     */
    validateLanguage(text, type) {
        const result = {
            isValid: true,
            warnings: [],
            detectedLanguage: null,
            confidence: 0
        };

        // 簡易言語検出
        const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
        const hasEnglish = /[a-zA-Z]/.test(text);
        const hasNumbers = /[0-9]/.test(text);

        if (hasJapanese && hasEnglish) {
            result.detectedLanguage = 'mixed';
            result.warnings.push('日本語と英語が混在しています。英語のみの方が高品質になる場合があります');
        } else if (hasJapanese) {
            result.detectedLanguage = 'japanese';
            if (type === 'image') {
                result.warnings.push('画像生成では英語プロンプトの方が高品質になる場合があります');
            }
        } else if (hasEnglish) {
            result.detectedLanguage = 'english';
        } else {
            result.detectedLanguage = 'unknown';
            result.warnings.push('認識できない言語です');
        }

        return result;
    }

    /**
     * プロンプト最適化提案
     * @param {string} prompt - プロンプト
     * @param {string} type - 生成タイプ
     * @param {string} model - モデル名
     * @returns {Object} 最適化提案
     */
    suggestOptimization(prompt, type, model) {
        const suggestions = [];
        const lowerPrompt = prompt.toLowerCase();

        // 画像生成用の最適化提案
        if (type === 'image') {
            // 品質向上キーワード
            if (!lowerPrompt.includes('detailed') && !lowerPrompt.includes('high quality')) {
                suggestions.push('「detailed」や「high quality」を追加すると品質が向上する可能性があります');
            }

            // アートスタイル提案
            if (!lowerPrompt.includes('style') && !lowerPrompt.includes('art')) {
                suggestions.push('アートスタイルを指定すると（例：digital art, photorealistic）より明確な結果が得られます');
            }

            // 照明・構図提案
            if (!lowerPrompt.includes('lighting') && !lowerPrompt.includes('light')) {
                suggestions.push('照明の指定（例：soft lighting, dramatic lighting）で雰囲気を改善できます');
            }
        }

        // 動画生成用の最適化提案
        if (type === 'video') {
            if (!lowerPrompt.includes('motion') && !lowerPrompt.includes('moving')) {
                suggestions.push('動きの説明を追加すると（例：slowly moving, dynamic motion）より良い動画になります');
            }
        }

        // モデル固有の提案
        if (model && model.includes('openai')) {
            suggestions.push('OpenAIモデルでは詳細で具体的な説明が効果的です');
        } else if (model && model.includes('stabilityai')) {
            suggestions.push('Stable Diffusionでは「8k resolution, highly detailed」等のキーワードが効果的です');
        }

        return {
            suggestions: suggestions,
            optimizedPrompt: this.generateOptimizedPrompt(prompt, type, suggestions)
        };
    }

    /**
     * 最適化されたプロンプト生成
     * @param {string} original - 元のプロンプト
     * @param {string} type - 生成タイプ
     * @param {Array} suggestions - 提案一覧
     * @returns {string} 最適化されたプロンプト
     */
    generateOptimizedPrompt(original, type, suggestions) {
        let optimized = original;

        // 自動最適化は慎重に行う（ユーザーの意図を尊重）
        if (type === 'image' && !original.toLowerCase().includes('detailed')) {
            optimized = `${optimized}, highly detailed`;
        }

        return optimized;
    }

    /**
     * 使用制限チェック
     * @param {string} userId - ユーザーID
     * @param {string} type - 生成タイプ
     * @param {Object} currentUsage - 現在の使用状況
     * @returns {Object} 制限チェック結果
     */
    validateUsageLimits(userId, type, currentUsage) {
        const result = {
            isAllowed: true,
            errors: [],
            warnings: [],
            limits: {}
        };

        // 同時実行数チェック
        if (currentUsage.concurrent >= this.limits.generation.maxConcurrent) {
            result.isAllowed = false;
            result.errors.push(`同時実行可能数の上限（${this.limits.generation.maxConcurrent}個）に達しています`);
        }

        // 時間別制限チェック
        if (currentUsage.hourly >= this.limits.generation.maxPerHour) {
            result.isAllowed = false;
            result.errors.push(`1時間あたりの生成上限（${this.limits.generation.maxPerHour}回）に達しています`);
        }

        // 日別制限チェック
        if (currentUsage.daily >= this.limits.generation.maxPerDay) {
            result.isAllowed = false;
            result.errors.push(`1日あたりの生成上限（${this.limits.generation.maxPerDay}回）に達しています`);
        }

        // 警告レベル
        if (currentUsage.daily >= this.limits.generation.maxPerDay * 0.8) {
            result.warnings.push('1日の使用上限の80%に達しています');
        }

        result.limits = {
            concurrent: {
                current: currentUsage.concurrent,
                max: this.limits.generation.maxConcurrent
            },
            hourly: {
                current: currentUsage.hourly,
                max: this.limits.generation.maxPerHour
            },
            daily: {
                current: currentUsage.daily,
                max: this.limits.generation.maxPerDay
            }
        };

        return result;
    }

    /**
     * ファイル形式検証
     * @param {string} filename - ファイル名
     * @param {string} type - 期待するタイプ
     * @returns {Object} 検証結果
     */
    validateFileFormat(filename, type) {
        const result = {
            isValid: true,
            errors: [],
            detectedFormat: null
        };

        if (!filename || typeof filename !== 'string') {
            result.isValid = false;
            result.errors.push('ファイル名が指定されていません');
            return result;
        }

        const extension = filename.split('.').pop()?.toLowerCase();
        
        if (!extension) {
            result.isValid = false;
            result.errors.push('ファイル拡張子が見つかりません');
            return result;
        }

        result.detectedFormat = extension;

        const allowedFormats = this.allowedFormats[type];
        if (allowedFormats && !allowedFormats.includes(extension)) {
            result.isValid = false;
            result.errors.push(`サポートされていないファイル形式: .${extension}`);
            result.errors.push(`対応形式: ${allowedFormats.join(', ')}`);
        }

        return result;
    }

    /**
     * 総合検証（すべての検証を一括実行）
     * @param {Object} input - 入力データ
     * @returns {Object} 総合検証結果
     */
    validateAll(input) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            validatedData: {}
        };

        // プロンプト検証
        if (input.prompt) {
            const promptValidation = this.validatePrompt(
                input.prompt, 
                input.type, 
                input.model
            );
            
            if (!promptValidation.isValid) {
                result.isValid = false;
                result.errors.push(...promptValidation.errors);
            }
            
            result.warnings.push(...promptValidation.warnings);
            result.validatedData.prompt = promptValidation.cleanedPrompt;
        }

        // 生成オプション検証
        if (input.type && input.model && input.options) {
            const optionsValidation = this.validateGenerationOptions(
                input.type,
                input.model,
                input.options
            );
            
            if (!optionsValidation.isValid) {
                result.isValid = false;
                result.errors.push(...optionsValidation.errors);
            }
            
            result.warnings.push(...optionsValidation.warnings);
            result.validatedData.options = optionsValidation.validatedOptions;
        }

        // リデンプションコード検証
        if (input.redemptionCode) {
            const codeValidation = this.validateRedemptionCode(input.redemptionCode);
            
            if (!codeValidation.isValid) {
                result.isValid = false;
                result.errors.push(...codeValidation.errors);
            }
            
            result.validatedData.redemptionCode = codeValidation.formattedCode;
        }

        return result;
    }
}

module.exports = new Validators();
