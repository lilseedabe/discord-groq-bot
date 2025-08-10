// 拡張版データベース設計
-- 会話履歴テーブル
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    discord_id VARCHAR(20) NOT NULL,
    message_role VARCHAR(10) NOT NULL, -- 'user' or 'assistant'
    message_content TEXT NOT NULL,
    ai_model VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    session_id UUID DEFAULT gen_random_uuid()
);

-- 会話統計テーブル
CREATE TABLE IF NOT EXISTS conversation_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    discord_id VARCHAR(20) NOT NULL,
    total_messages INTEGER DEFAULT 0,
    total_ai_responses INTEGER DEFAULT 0,
    favorite_model VARCHAR(50),
    last_conversation_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_conversations_discord_id ON conversations(discord_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_stats_discord_id ON conversation_stats(discord_id);
