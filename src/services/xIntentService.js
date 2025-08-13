// xIntentService.js - X(Twitter)投稿Intent機能完全実装
const { ButtonBuilder, ButtonStyle } = require('discord.js');

class XIntentService {
    constructor() {
        // X投稿の文字制限
        this.MAX_TWEET_LENGTH = 280;
        this.RESERVED_URL_LENGTH = 23; // X短縮URL分
        this.SAFE_TEXT_LENGTH = this.MAX_TWEET_LENGTH - this.RESERVED_URL_LENGTH - 10; // 余裕を持たせる

        // 生成タイプ別のハッシュタグ
        this.typeHashtags = {
            image: '#AI画像生成',
            video: '#AI動画生成', 
            audio: '#AI音声生成'
        };

        // モデル別ハッシュタグ
        this.modelHashtags = {
            'openai-dalle3': '#DALLE3',
            'openai-dalle2': '#DALLE2',
            'stabilityai-sdxl': '#StableDiffusion',
            'stabilityai-sd': '#StableDiffusion',
            'replicate-flux': '#Flux',
            'leonardo-ai': '#LeonardoAI',
            'runwayml-gen2': '#RunwayML',
            'openai-tts': '#OpenAITTS',
            'elevenlabs-tts': '#ElevenLabs'
        };

        // デフォルトハッシュタグ
        this.defaultHashtags = '#AIBot #Discord #note';
    }

    /**
     * X投稿Intent URL生成
     * @param {string} contentUrl - 生成されたコンテンツのURL
     * @param {string} prompt - 元のプロンプト
     * @param {string} model - 使用したモデル
     * @param {string} type - 生成タイプ (image/video/audio)
     * @param {Object} options - 追加オプション
     * @returns {string} X投稿用IntentURL
     */
    generateTweetIntent(contentUrl, prompt, model, type, options = {}) {
        try {
            // 基本テキスト構築
            let tweetText = this.buildTweetText(prompt, model, type, options);
            
            // 文字数調整
            tweetText = this.adjustTextLength(tweetText);

            // URL作成
            const tweetUrl = this.createIntentUrl(tweetText, contentUrl);

            return tweetUrl;

        } catch (error) {
            console.error('X投稿Intent生成エラー:', error);
            
            // フォールバック用シンプルURL
            const fallbackText = `noteのAI生成Botで作成しました！ ${this.typeHashtags[type]} ${this.defaultHashtags}`;
            return this.createIntentUrl(fallbackText, contentUrl);
        }
    }

    /**
     * ツイートテキスト構築
     * @param {string} prompt - プロンプト
     * @param {string} model - モデル
     * @param {string} type - タイプ
     * @param {Object} options - オプション
     * @returns {string} 構築されたテキスト
     */
    buildTweetText(prompt, model, type, options = {}) {
        const parts = [];

        // 1. 開始文
        const typeText = {
            image: 'AI画像を生成しました！',
            video: 'AI動画を生成しました！',
            audio: 'AI音声を生成しました！'
        }[type] || 'AIコンテンツを生成しました！';
        
        parts.push(typeText);

        // 2. プロンプト（調整対象）
        if (prompt && prompt.trim()) {
            parts.push(`\n\n📝 "${prompt.trim()}"`);
        }

        // 3. モデル情報（オプション）
        if (options.includeModel) {
            const modelName = this.getModelDisplayName(model);
            parts.push(`\n🤖 ${modelName}`);
        }

        // 4. 追加情報
        if (options.additionalInfo) {
            parts.push(`\n${options.additionalInfo}`);
        }

        // 5. ハッシュタグ
        const hashtags = this.buildHashtags(model, type, options);
        parts.push(`\n\n${hashtags}`);

        return parts.join('');
    }

    /**
     * ハッシュタグ構築
     * @param {string} model - モデル
     * @param {string} type - タイプ
     * @param {Object} options - オプション
     * @returns {string} ハッシュタグ文字列
     */
    buildHashtags(model, type, options = {}) {
        const hashtags = [];

        // タイプ別ハッシュタグ
        if (this.typeHashtags[type]) {
            hashtags.push(this.typeHashtags[type]);
        }

        // モデル別ハッシュタグ
        if (this.modelHashtags[model]) {
            hashtags.push(this.modelHashtags[model]);
        }

        // カスタムハッシュタグ
        if (options.customHashtags && Array.isArray(options.customHashtags)) {
            hashtags.push(...options.customHashtags);
        }

        // デフォルトハッシュタグ
        hashtags.push(...this.defaultHashtags.split(' '));

        // 重複除去と結合
        const uniqueHashtags = [...new Set(hashtags)];
        return uniqueHashtags.join(' ');
    }

    /**
     * 文字数制限に合わせてテキスト調整
     * @param {string} text - 元のテキスト
     * @returns {string} 調整後のテキスト
     */
    adjustTextLength(text) {
        if (text.length <= this.SAFE_TEXT_LENGTH) {
            return text;
        }

        // プロンプト部分を特定・短縮
        const promptMatch = text.match(/📝 "([^"]+)"/);
        if (promptMatch) {
            const originalPrompt = promptMatch[1];
            const promptStart = text.indexOf(promptMatch[0]);
            const promptEnd = promptStart + promptMatch[0].length;
            
            const beforePrompt = text.substring(0, promptStart);
            const afterPrompt = text.substring(promptEnd);
            
            // プロンプト以外の部分の長さを計算
            const nonPromptLength = beforePrompt.length + afterPrompt.length + 7; // 📝 "" 分
            const availablePromptLength = this.SAFE_TEXT_LENGTH - nonPromptLength;
            
            if (availablePromptLength > 10) {
                // プロンプトを短縮
                const truncatedPrompt = originalPrompt.length > availablePromptLength
                    ? originalPrompt.substring(0, availablePromptLength - 3) + '...'
                    : originalPrompt;
                
                return beforePrompt + `📝 "${truncatedPrompt}"` + afterPrompt;
            }
        }

        // プロンプトを完全削除してハッシュタグのみ残す
        const hashtagMatch = text.match(/\n\n(#[^\n]+)$/);
        if (hashtagMatch) {
            const baseText = text.substring(0, text.indexOf('\n\n📝'));
            return baseText + '\n\n' + hashtagMatch[1];
        }

        // 最終手段：全体を短縮
        return text.substring(0, this.SAFE_TEXT_LENGTH - 3) + '...';
    }

    /**
     * Intent URL作成
     * @param {string} text - ツイートテキスト
     * @param {string} url - 添付URL
     * @returns {string} Intent URL
     */
    createIntentUrl(text, url = '') {
        const params = new URLSearchParams();
        
        params.set('text', text);
        
        if (url) {
            params.set('url', url);
        }

        return `https://twitter.com/intent/tweet?${params.toString()}`;
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
     * X投稿ボタン作成
     * @param {Object} result - 生成結果
     * @param {Object} options - ボタンオプション
     * @returns {ButtonBuilder} X投稿ボタン
     */
    createXPostButton(result, options = {}) {
        try {
            const intentUrl = this.generateTweetIntent(
                result.url || result.resultUrl,
                result.prompt,
                result.model,
                result.type,
                options
            );

            return new ButtonBuilder()
                .setLabel(options.buttonLabel || 'Xに投稿')
                .setStyle(ButtonStyle.Link)
                .setURL(intentUrl)
                .setEmoji(options.emoji || '🐦');

        } catch (error) {
            console.error('X投稿ボタン作成エラー:', error);
            
            // フォールバック：シンプルなボタン
            return new ButtonBuilder()
                .setLabel('Xで共有')
                .setStyle(ButtonStyle.Link)
                .setURL('https://twitter.com/intent/tweet?text=noteのAI生成Botを使いました！')
                .setEmoji('🐦');
        }
    }

    /**
     * 生成タイプ別の最適化されたボタン作成
     * @param {Object} result - 生成結果
     * @returns {ButtonBuilder} 最適化されたボタン
     */
    createOptimizedButton(result) {
        const options = {};

        switch (result.type) {
            case 'image':
                options.includeModel = true;
                options.customHashtags = ['#AIアート', '#画像生成'];
                options.buttonLabel = '画像をXで共有';
                break;

            case 'video':
                options.includeModel = true;
                options.customHashtags = ['#AI動画', '#VideoGeneration'];
                options.buttonLabel = '動画をXで共有';
                options.additionalInfo = `⏱️ ${result.duration || 'N/A'}秒`;
                break;

            case 'audio':
                options.includeModel = true;
                options.customHashtags = ['#AI音声', '#TTS'];
                options.buttonLabel = '音声をXで共有';
                options.additionalInfo = `🔊 ${result.voice || 'AI'}音声`;
                break;

            default:
                options.buttonLabel = 'Xで共有';
        }

        return this.createXPostButton(result, options);
    }

    /**
     * バルク生成用の共有ボタン（複数結果）
     * @param {Array} results - 生成結果配列
     * @param {Object} summary - サマリー情報
     * @returns {ButtonBuilder} 共有ボタン
     */
    createBulkShareButton(results, summary) {
        const count = results.length;
        const type = results[0]?.type || 'content';
        
        const text = `noteのAI生成Botで${count}個の${this.typeHashtags[type] || 'コンテンツ'}を作成しました！ ${this.defaultHashtags}`;
        
        const intentUrl = this.createIntentUrl(text, summary.galleryUrl || '');

        return new ButtonBuilder()
            .setLabel(`${count}個の結果をXで共有`)
            .setStyle(ButtonStyle.Link)
            .setURL(intentUrl)
            .setEmoji('🎯');
    }

    /**
     * カスタムテンプレート投稿
     * @param {string} template - テンプレート文字列
     * @param {Object} variables - 変数置換用オブジェクト
     * @param {string} url - 添付URL
     * @returns {string} Intent URL
     */
    createCustomPost(template, variables = {}, url = '') {
        let text = template;

        // 変数置換
        Object.entries(variables).forEach(([key, value]) => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            text = text.replace(regex, value);
        });

        // 文字数調整
        text = this.adjustTextLength(text);

        return this.createIntentUrl(text, url);
    }

    /**
     * 投稿プレビュー生成（デバッグ用）
     * @param {string} contentUrl - コンテンツURL
     * @param {string} prompt - プロンプト
     * @param {string} model - モデル
     * @param {string} type - タイプ
     * @param {Object} options - オプション
     * @returns {Object} プレビュー情報
     */
    getPostPreview(contentUrl, prompt, model, type, options = {}) {
        const text = this.buildTweetText(prompt, model, type, options);
        const adjustedText = this.adjustTextLength(text);
        const intentUrl = this.createIntentUrl(adjustedText, contentUrl);

        return {
            originalText: text,
            adjustedText: adjustedText,
            textLength: adjustedText.length,
            isWithinLimit: adjustedText.length <= this.SAFE_TEXT_LENGTH,
            intentUrl: intentUrl,
            estimatedFinalLength: adjustedText.length + (contentUrl ? this.RESERVED_URL_LENGTH : 0)
        };
    }

    /**
     * 設定更新
     * @param {Object} config - 新しい設定
     */
    updateConfig(config) {
        if (config.maxTweetLength) {
            this.MAX_TWEET_LENGTH = config.maxTweetLength;
            this.SAFE_TEXT_LENGTH = this.MAX_TWEET_LENGTH - this.RESERVED_URL_LENGTH - 10;
        }

        if (config.defaultHashtags) {
            this.defaultHashtags = config.defaultHashtags;
        }

        if (config.typeHashtags) {
            Object.assign(this.typeHashtags, config.typeHashtags);
        }

        if (config.modelHashtags) {
            Object.assign(this.modelHashtags, config.modelHashtags);
        }
    }

    /**
     * 統計情報取得
     * @returns {Object} 利用統計
     */
    getUsageStats() {
        return {
            maxTweetLength: this.MAX_TWEET_LENGTH,
            safeTextLength: this.SAFE_TEXT_LENGTH,
            supportedTypes: Object.keys(this.typeHashtags),
            supportedModels: Object.keys(this.modelHashtags),
            defaultHashtags: this.defaultHashtags
        };
    }
}

module.exports = new XIntentService();
