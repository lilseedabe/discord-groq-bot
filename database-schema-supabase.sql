-- ===== note AI生成プラン Discord Bot Supabase Schema =====
-- 設計書v1.0に基づく完全版データベーススキーマ

-- ユーザー・会員管理テーブル
CREATE TABLE note_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    discord_id VARCHAR(20) UNIQUE NOT NULL,
    note_email VARCHAR(255), -- note購入時のメール（手動管理）
    membership_status VARCHAR(20) DEFAULT 'active' CHECK (membership_status IN ('active', 'expired', 'suspended')),
    subscription_start TIMESTAMP DEFAULT NOW(),
    subscription_end TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Row Level Security (RLS) 有効化
ALTER TABLE note_users ENABLE ROW LEVEL SECURITY;

-- ユーザー自身のデータのみアクセス可能
CREATE POLICY "Users can view own data" ON note_users
    FOR SELECT USING (auth.uid()::text = discord_id);

-- クレジット管理テーブル
CREATE TABLE user_credits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES note_users(id) ON DELETE CASCADE,
    total_credits INTEGER DEFAULT 0,
    available_credits INTEGER DEFAULT 0,
    reserved_credits INTEGER DEFAULT 0,
    last_refill TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- 制約: 利用可能クレジット >= 0
    CONSTRAINT positive_available_credits CHECK (available_credits >= 0),
    CONSTRAINT positive_reserved_credits CHECK (reserved_credits >= 0)
);

-- クレジット履歴テーブル
CREATE TABLE credit_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES note_users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('grant', 'consume', 'reserve', 'release', 'refund')),
    amount INTEGER NOT NULL,
    model VARCHAR(50),
    job_id VARCHAR(50),
    description TEXT,
    metadata JSONB, -- 追加情報（プロンプト、設定等）
    created_at TIMESTAMP DEFAULT NOW()
);

-- 生成ジョブ管理テーブル
CREATE TABLE generation_jobs (
    id VARCHAR(50) PRIMARY KEY,
    user_id UUID REFERENCES note_users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('image', 'video', 'audio')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    model VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    params JSONB, -- 生成パラメータ（解像度、時間等）
    result_url TEXT,
    x_post_url TEXT, -- X投稿URL記録
    credits_used INTEGER,
    credits_reserved INTEGER,
    reservation_id UUID,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- リデンプションコード管理テーブル
CREATE TABLE redemption_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    note_email VARCHAR(255), -- 購入者メール
    discord_id VARCHAR(20),
    credits_amount INTEGER DEFAULT 1000,
    is_redeemed BOOLEAN DEFAULT FALSE,
    redeemed_at TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '90 days'),
    created_by VARCHAR(50) DEFAULT 'system', -- 管理者識別
    notes TEXT, -- 管理用メモ
    created_at TIMESTAMP DEFAULT NOW()
);

-- クレジット予約テーブル（ジョブキュー用）
CREATE TABLE credit_reservations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES note_users(id) ON DELETE CASCADE,
    job_id VARCHAR(50) UNIQUE,
    reserved_amount INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'released')),
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '1 hour') -- 1時間後に自動解除
);

-- DM通知設定テーブル
CREATE TABLE dm_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES note_users(id) ON DELETE CASCADE UNIQUE,
    enable_completion_dm BOOLEAN DEFAULT TRUE,
    enable_error_dm BOOLEAN DEFAULT TRUE,
    enable_credit_alerts BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===== インデックス作成 =====

-- ユーザー検索用
CREATE INDEX idx_note_users_discord_id ON note_users(discord_id);
CREATE INDEX idx_note_users_membership ON note_users(membership_status, subscription_end);

-- クレジット関連
CREATE INDEX idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(type);

-- ジョブ関連
CREATE INDEX idx_generation_jobs_user_id ON generation_jobs(user_id);
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX idx_generation_jobs_created_at ON generation_jobs(created_at DESC);
CREATE INDEX idx_generation_jobs_type ON generation_jobs(type);

-- リデンプションコード
CREATE INDEX idx_redemption_codes_code ON redemption_codes(code);
CREATE INDEX idx_redemption_codes_discord_id ON redemption_codes(discord_id);
CREATE INDEX idx_redemption_codes_is_redeemed ON redemption_codes(is_redeemed);

-- 予約関連
CREATE INDEX idx_credit_reservations_user_id ON credit_reservations(user_id);
CREATE INDEX idx_credit_reservations_job_id ON credit_reservations(job_id);
CREATE INDEX idx_credit_reservations_status ON credit_reservations(status);
CREATE INDEX idx_credit_reservations_expires_at ON credit_reservations(expires_at);

-- ===== トリガー・関数作成 =====

-- updated_at自動更新関数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 各テーブルにupdated_atトリガー設定
CREATE TRIGGER update_note_users_updated_at BEFORE UPDATE ON note_users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_credits_updated_at BEFORE UPDATE ON user_credits 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dm_preferences_updated_at BEFORE UPDATE ON dm_preferences 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- クレジット予約期限切れ自動クリーンアップ関数
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS void AS $$
BEGIN
    -- 期限切れ予約を解除し、クレジットを返却
    WITH expired_reservations AS (
        SELECT id, user_id, reserved_amount
        FROM credit_reservations
        WHERE status = 'active' AND expires_at < NOW()
    )
    UPDATE user_credits 
    SET 
        available_credits = available_credits + er.reserved_amount,
        reserved_credits = reserved_credits - er.reserved_amount,
        updated_at = NOW()
    FROM expired_reservations er
    WHERE user_credits.user_id = er.user_id;
    
    -- 期限切れ予約レコードを削除
    DELETE FROM credit_reservations 
    WHERE status = 'active' AND expires_at < NOW();
    
    -- ログ出力
    RAISE NOTICE 'Cleaned up expired credit reservations at %', NOW();
END;
$$ language 'plpgsql';

-- 初期データ投入（開発用）
-- 1. テスト用リデンプションコード
INSERT INTO redemption_codes (code, note_email, credits_amount, notes) VALUES
('NOTE-TEST-0001-DEMO', 'test@example.com', 1000, 'Development test code'),
('NOTE-BETA-0002-USER', 'beta@example.com', 500, 'Beta tester code');

-- 2. システム設定用データ
-- アプリケーション設定テーブル（システム全体の設定管理）
CREATE TABLE app_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO app_settings (key, value, description) VALUES
('max_credits_per_user', '1000', 'Maximum credits per user'),
('daily_generation_limit', '50', 'Maximum generations per user per day'),
('maintenance_mode', 'false', 'System maintenance mode flag'),
('eden_api_rate_limit', '100', 'Eden.AI API rate limit per hour'),
('x_post_enabled', 'true', 'Enable X (Twitter) posting feature');

-- ===== Views（便利なビュー） =====

-- ユーザー統計ビュー
CREATE VIEW user_stats AS
SELECT 
    nu.id,
    nu.discord_id,
    nu.membership_status,
    uc.total_credits,
    uc.available_credits,
    uc.reserved_credits,
    COUNT(gj.id) as total_generations,
    COUNT(CASE WHEN gj.status = 'completed' THEN 1 END) as completed_generations,
    COUNT(CASE WHEN gj.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as today_generations,
    MAX(gj.created_at) as last_generation
FROM note_users nu
LEFT JOIN user_credits uc ON nu.id = uc.user_id
LEFT JOIN generation_jobs gj ON nu.id = gj.user_id
GROUP BY nu.id, nu.discord_id, nu.membership_status, uc.total_credits, uc.available_credits, uc.reserved_credits;

-- 人気モデルランキングビュー
CREATE VIEW popular_models AS
SELECT 
    model,
    type,
    COUNT(*) as usage_count,
    SUM(credits_used) as total_credits_consumed,
    AVG(credits_used) as avg_credits_per_use,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_generations,
    ROUND(
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::decimal / COUNT(*)::decimal * 100, 
        2
    ) as success_rate
FROM generation_jobs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY model, type
ORDER BY usage_count DESC;

-- ===== 管理用関数 =====

-- ユーザーのクレジット履歴取得
CREATE OR REPLACE FUNCTION get_user_credit_history(user_discord_id VARCHAR(20))
RETURNS TABLE(
    transaction_date TIMESTAMP,
    type VARCHAR(20),
    amount INTEGER,
    model VARCHAR(50),
    description TEXT,
    balance_after INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ct.created_at,
        ct.type,
        ct.amount,
        ct.model,
        ct.description,
        (
            SELECT uc.available_credits 
            FROM user_credits uc 
            JOIN note_users nu ON uc.user_id = nu.id 
            WHERE nu.discord_id = user_discord_id
        ) as balance_after
    FROM credit_transactions ct
    JOIN note_users nu ON ct.user_id = nu.id
    WHERE nu.discord_id = user_discord_id
    ORDER BY ct.created_at DESC;
END;
$$ language 'plpgsql';

-- 月間使用状況レポート
CREATE OR REPLACE FUNCTION monthly_usage_report(target_month DATE DEFAULT DATE_TRUNC('month', NOW()))
RETURNS TABLE(
    discord_id VARCHAR(20),
    total_generations INTEGER,
    total_credits_used INTEGER,
    favorite_model VARCHAR(50),
    last_activity TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        nu.discord_id,
        COUNT(gj.id)::INTEGER as total_generations,
        COALESCE(SUM(gj.credits_used), 0)::INTEGER as total_credits_used,
        MODE() WITHIN GROUP (ORDER BY gj.model) as favorite_model,
        MAX(gj.created_at) as last_activity
    FROM note_users nu
    LEFT JOIN generation_jobs gj ON nu.id = gj.user_id 
        AND gj.created_at >= target_month 
        AND gj.created_at < target_month + INTERVAL '1 month'
    GROUP BY nu.id, nu.discord_id
    HAVING COUNT(gj.id) > 0
    ORDER BY total_credits_used DESC;
END;
$$ language 'plpgsql';

-- ===== セキュリティポリシー =====

-- クレジット情報の RLS
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own credits" ON user_credits
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM note_users 
            WHERE note_users.id = user_credits.user_id 
            AND note_users.discord_id = auth.uid()::text
        )
    );

-- 生成ジョブの RLS
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own jobs" ON generation_jobs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM note_users 
            WHERE note_users.id = generation_jobs.user_id 
            AND note_users.discord_id = auth.uid()::text
        )
    );

-- ===== 実行計画とメンテナンス =====

-- 定期実行：期限切れ予約クリーンアップ（cron jobs等で実行）
-- SELECT cleanup_expired_reservations();

-- 定期実行：古いログデータクリーンアップ（90日以上前）
-- DELETE FROM credit_transactions WHERE created_at < NOW() - INTERVAL '90 days';
-- DELETE FROM generation_jobs WHERE created_at < NOW() - INTERVAL '90 days' AND status IN ('completed', 'failed');

COMMENT ON TABLE note_users IS 'note AI生成プラン会員管理';
COMMENT ON TABLE user_credits IS 'ユーザークレジット残高・履歴';
COMMENT ON TABLE credit_transactions IS 'クレジット取引履歴';
COMMENT ON TABLE generation_jobs IS 'AI生成ジョブ管理';
COMMENT ON TABLE redemption_codes IS 'リデンプションコード管理';
COMMENT ON TABLE credit_reservations IS 'クレジット予約（ジョブキュー用）';
COMMENT ON TABLE dm_preferences IS 'DM通知設定';
COMMENT ON TABLE app_settings IS 'アプリケーション全体設定';

-- スキーマ作成完了ログ
DO $$
BEGIN
    RAISE NOTICE 'note AI生成プラン Discord Bot Supabase Schema 作成完了: %', NOW();
END $$;
