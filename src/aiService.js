// Groq AIサービス
const { Groq } = require('groq-sdk');
const { encrypt, decrypt } = require('./utils');

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const MODELS = {
    DEFAULT: 'moonshotai/kimi-k2-instruct',
    SEARCH: 'compound-beta',
    QWEN: 'qwen/qwen3-32b'
};

function getSystemPrompt(model) {
    const basePrompt = 'あなたは親切で知識豊富なAIアシスタントです。日本語で簡潔かつ有用な回答を提供してください。過去の会話の文脈を考慮して、自然で連続性のある会話を心がけてください。';
    switch (model) {
        case MODELS.SEARCH:
            return basePrompt + ' 最新の情報が必要な場合は、自動的にWeb検索を実行して正確な情報を提供してください。';
        case MODELS.QWEN:
            return basePrompt + ' 複雑な推論や論理的思考が必要な場合は、段階的に説明してください。';
        default:
            return basePrompt;
    }
}

const groq = new Groq({
    apiKey: GROQ_API_KEY,
});

async function getAIResponse(userId, userMessage, conversation, model = MODELS.DEFAULT) {
    try {
        const messages = [
            {
                role: 'system',
                content: getSystemPrompt(model)
            }
        ];
        const recentMessages = conversation.messages.slice(-10);
        const cleanMessages = recentMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        messages.push(...cleanMessages);
        messages.push({
            role: 'user',
            content: userMessage
        });

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: model,
            temperature: 0.7,
            max_tokens: 1500,
        });

        const response = chatCompletion.choices[0]?.message?.content || '申し訳ございませんが、回答を生成できませんでした。';
        return response;
    } catch (error) {
        console.error('Groq API エラー:', error);
        throw new Error(`API エラー: ${error.message}`);
    }
}

module.exports = {
    MODELS,
    getSystemPrompt,
    getAIResponse
};