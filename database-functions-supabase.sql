-- ===== Supabase用SQL関数 =====
-- note AI生成プラン Discord Bot用のストアドプロシージャ

-- 1. ユーザー作成とクレジット付与（リデンプション用）
CREATE OR REPLACE FUNCTION create_user_with_credits(
    p_discord_id VARCHAR(20),
    p_note_email VARCHAR(255),
    p_initial_credits INTEGER DEFAULT 1000
)
RETURNS UUID AS $$
DECLARE
    user_id UUID;
BEGIN
    -- ユーザー作成
    INSERT INTO note_users (discord_id, note_email, membership_status)
    VALUES (p_discord_id, p_note_email, 'active')
    RETURNING id INTO user_id;
    
    -- クレジット初期化
    INSERT INTO user_credits (user_id, total_credits, available_credits, reserved_credits, last_refill)
    VALUES (user_id, p_initial_credits, p_initial_credits, 0, NOW());
    
    -- DM設定初期化
    INSERT INTO dm_preferences (user_id, enable_completion_dm, enable_error_dm, enable_credit_alerts)
    VALUES (user_id, TRUE, TRUE, TRUE);
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, description)
    VALUES (user_id, 'grant', p_initial_credits, 'Initial credits from redemption');
    
    RETURN user_id;
END;
$$ LANGUAGE plpgsql;

-- 2. リデンプションコード使用（トランザクション）
CREATE OR REPLACE FUNCTION redeem_code_transaction(
    p_discord_id VARCHAR(20),
    p_code VARCHAR(20),
    p_note_email VARCHAR(255),
    p_credits INTEGER
)
RETURNS JSON AS $$
DECLARE
    user_id UUID;
    result JSON;
BEGIN
    -- リデンプションコード使用済みマーク
    UPDATE redemption_codes 
    SET 
        is_redeemed = TRUE,
        discord_id = p_discord_id,
        redeemed_at = NOW()
    WHERE code = p_code AND is_redeemed = FALSE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Redemption code not found or already used';
    END IF;
    
    -- ユーザー作成
    user_id := create_user_with_credits(p_discord_id, p_note_email, p_credits);
    
    result := json_build_object(
        'user_id', user_id,
        'discord_id', p_discord_id,
        'credits', p_credits,
        'success', true
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 3. クレジット予約
CREATE OR REPLACE FUNCTION reserve_user_credits(
    p_user_id UUID,
    p_reservation_id UUID,
    p_amount INTEGER,
    p_job_id VARCHAR(50) DEFAULT NULL,
    p_expires_at TIMESTAMP DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    current_available INTEGER;
    result JSON;
BEGIN
    -- 現在の利用可能クレジット確認
    SELECT available_credits INTO current_available
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User credits not found';
    END IF;
    
    IF current_available < p_amount THEN
        RAISE EXCEPTION 'Insufficient credits: available %, required %', current_available, p_amount;
    END IF;
    
    -- クレジット予約実行
    UPDATE user_credits
    SET 
        available_credits = available_credits - p_amount,
        reserved_credits = reserved_credits + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- 予約レコード作成
    INSERT INTO credit_reservations (id, user_id, job_id, reserved_amount, status, expires_at)
    VALUES (
        p_reservation_id, 
        p_user_id, 
        p_job_id, 
        p_amount, 
        'active',
        COALESCE(p_expires_at, NOW() + INTERVAL '1 hour')
    );
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, job_id, description)
    VALUES (p_user_id, 'reserve', p_amount, p_job_id, 'Credits reserved for generation');
    
    result := json_build_object(
        'reservation_id', p_reservation_id,
        'amount', p_amount,
        'expires_at', COALESCE(p_expires_at, NOW() + INTERVAL '1 hour'),
        'success', true
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 4. 予約クレジット消費
CREATE OR REPLACE FUNCTION consume_reserved_credits(
    p_reservation_id UUID,
    p_actual_cost INTEGER,
    p_model VARCHAR(50) DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    reservation_record RECORD;
    refund_amount INTEGER;
    result JSON;
BEGIN
    -- 予約情報取得
    SELECT * INTO reservation_record
    FROM credit_reservations
    WHERE id = p_reservation_id AND status = 'active'
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active reservation not found';
    END IF;
    
    -- 返却金額計算
    refund_amount := reservation_record.reserved_amount - p_actual_cost;
    
    IF refund_amount < 0 THEN
        RAISE EXCEPTION 'Actual cost exceeds reserved amount';
    END IF;
    
    -- クレジット更新
    UPDATE user_credits
    SET 
        reserved_credits = reserved_credits - reservation_record.reserved_amount,
        available_credits = available_credits + refund_amount,
        updated_at = NOW()
    WHERE user_id = reservation_record.user_id;
    
    -- 予約ステータス更新
    UPDATE credit_reservations
    SET status = 'consumed'
    WHERE id = p_reservation_id;
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, model, job_id, description)
    VALUES (
        reservation_record.user_id, 
        'consume', 
        p_actual_cost, 
        p_model, 
        reservation_record.job_id,
        COALESCE(p_description, 'Credits consumed for generation')
    );
    
    -- 返却がある場合は返却履歴も記録
    IF refund_amount > 0 THEN
        INSERT INTO credit_transactions (user_id, type, amount, model, job_id, description)
        VALUES (
            reservation_record.user_id, 
            'refund', 
            refund_amount, 
            p_model, 
            reservation_record.job_id,
            'Refund from reservation'
        );
    END IF;
    
    result := json_build_object(
        'consumed', p_actual_cost,
        'refunded_amount', refund_amount,
        'success', true
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 5. 予約解除
CREATE OR REPLACE FUNCTION release_credit_reservation(
    p_reservation_id UUID
)
RETURNS JSON AS $$
DECLARE
    reservation_record RECORD;
    result JSON;
BEGIN
    -- 予約情報取得
    SELECT * INTO reservation_record
    FROM credit_reservations
    WHERE id = p_reservation_id AND status = 'active'
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active reservation not found';
    END IF;
    
    -- クレジット返却
    UPDATE user_credits
    SET 
        available_credits = available_credits + reservation_record.reserved_amount,
        reserved_credits = reserved_credits - reservation_record.reserved_amount,
        updated_at = NOW()
    WHERE user_id = reservation_record.user_id;
    
    -- 予約削除
    DELETE FROM credit_reservations WHERE id = p_reservation_id;
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, job_id, description)
    VALUES (
        reservation_record.user_id, 
        'release', 
        reservation_record.reserved_amount, 
        reservation_record.job_id,
        'Reservation released'
    );
    
    result := json_build_object(
        'released_amount', reservation_record.reserved_amount,
        'success', true
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 6. クレジット付与
CREATE OR REPLACE FUNCTION grant_user_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_description TEXT DEFAULT 'Manual grant'
)
RETURNS BOOLEAN AS $$
BEGIN
    -- クレジット更新
    UPDATE user_credits
    SET 
        total_credits = total_credits + p_amount,
        available_credits = available_credits + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, description)
    VALUES (p_user_id, 'grant', p_amount, p_description);
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 7. 月次クレジット補充
CREATE OR REPLACE FUNCTION monthly_credit_refill(
    p_user_id UUID,
    p_amount INTEGER DEFAULT 1000
)
RETURNS BOOLEAN AS $$
BEGIN
    -- クレジット補充
    UPDATE user_credits
    SET 
        total_credits = total_credits + p_amount,
        available_credits = available_credits + p_amount,
        last_refill = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, description)
    VALUES (p_user_id, 'grant', p_amount, 'Monthly credit refill');
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 8. 直接クレジット消費
CREATE OR REPLACE FUNCTION consume_user_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_model VARCHAR(50) DEFAULT NULL,
    p_job_id VARCHAR(50) DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    current_available INTEGER;
BEGIN
    -- 現在の利用可能クレジット確認
    SELECT available_credits INTO current_available
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;
    
    IF current_available < p_amount THEN
        RAISE EXCEPTION 'Insufficient credits';
    END IF;
    
    -- クレジット消費
    UPDATE user_credits
    SET 
        available_credits = available_credits - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- 取引履歴記録
    INSERT INTO credit_transactions (user_id, type, amount, model, job_id, description)
    VALUES (p_user_id, 'consume', p_amount, p_model, p_job_id, COALESCE(p_description, 'Direct credit consumption'));
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 9. クレジット残高検証
CREATE OR REPLACE FUNCTION validate_user_credit_balance(
    p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
    credit_record RECORD;
    calculated_total INTEGER;
    calculated_available INTEGER;
    calculated_reserved INTEGER;
    result JSON;
BEGIN
    -- 現在のクレジット情報取得
    SELECT * INTO credit_record
    FROM user_credits
    WHERE user_id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('valid', false, 'error', 'User not found');
    END IF;
    
    -- 取引履歴から計算
    SELECT 
        COALESCE(SUM(CASE WHEN type IN ('grant', 'refund', 'release') THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type IN ('consume', 'reserve') THEN amount ELSE 0 END), 0)
    INTO calculated_available
    FROM credit_transactions
    WHERE user_id = p_user_id;
    
    -- アクティブ予約の合計
    SELECT COALESCE(SUM(reserved_amount), 0)
    INTO calculated_reserved
    FROM credit_reservations
    WHERE user_id = p_user_id AND status = 'active';
    
    -- 検証結果
    result := json_build_object(
        'valid', 
        credit_record.available_credits = calculated_available AND 
        credit_record.reserved_credits = calculated_reserved,
        'current_available', credit_record.available_credits,
        'calculated_available', calculated_available,
        'current_reserved', credit_record.reserved_credits,
        'calculated_reserved', calculated_reserved
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 10. 期限切れ予約クリーンアップ
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS JSON AS $$
DECLARE
    expired_count INTEGER;
    result JSON;
BEGIN
    -- 期限切れ予約のクレジットを返却
    WITH expired_reservations AS (
        SELECT user_id, SUM(reserved_amount) as total_amount
        FROM credit_reservations
        WHERE status = 'active' AND expires_at < NOW()
        GROUP BY user_id
    )
    UPDATE user_credits 
    SET 
        available_credits = available_credits + er.total_amount,
        reserved_credits = reserved_credits - er.total_amount,
        updated_at = NOW()
    FROM expired_reservations er
    WHERE user_credits.user_id = er.user_id;
    
    -- 期限切れ予約を削除してカウント
    WITH deleted AS (
        DELETE FROM credit_reservations 
        WHERE status = 'active' AND expires_at < NOW()
        RETURNING id
    )
    SELECT COUNT(*) INTO expired_count FROM deleted;
    
    result := json_build_object(
        'cleaned_count', expired_count,
        'timestamp', NOW(),
        'success', true
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 11. グローバルクレジット統計
CREATE OR REPLACE FUNCTION get_global_credit_stats()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_users', (SELECT COUNT(*) FROM note_users WHERE membership_status = 'active'),
        'total_available_credits', (SELECT COALESCE(SUM(available_credits), 0) FROM user_credits),
        'total_reserved_credits', (SELECT COALESCE(SUM(reserved_credits), 0) FROM user_credits),
        'total_credits_granted', (SELECT COALESCE(SUM(total_credits), 0) FROM user_credits),
        'today_transactions', (
            SELECT COUNT(*) 
            FROM credit_transactions 
            WHERE created_at >= CURRENT_DATE
        ),
        'today_credits_consumed', (
            SELECT COALESCE(SUM(amount), 0) 
            FROM credit_transactions 
            WHERE type = 'consume' AND created_at >= CURRENT_DATE
        ),
        'active_reservations', (
            SELECT COUNT(*) 
            FROM credit_reservations 
            WHERE status = 'active'
        ),
        'last_updated', NOW()
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 12. SQL実行関数（setupスクリプト用）
CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
RETURNS TEXT AS $$
BEGIN
    EXECUTE sql_query;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 定期実行用の自動化関数 =====

-- 13. 定期クリーンアップジョブ
CREATE OR REPLACE FUNCTION scheduled_maintenance()
RETURNS JSON AS $$
DECLARE
    cleanup_result JSON;
    result JSON;
BEGIN
    -- 期限切れ予約クリーンアップ
    SELECT cleanup_expired_reservations() INTO cleanup_result;
    
    -- 古いトランザクション履歴削除（90日以上前）
    DELETE FROM credit_transactions 
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- 古いジョブ削除（90日以上前、完了・失敗のみ）
    DELETE FROM generation_jobs 
    WHERE created_at < NOW() - INTERVAL '90 days' 
    AND status IN ('completed', 'failed', 'cancelled');
    
    result := json_build_object(
        'cleanup_result', cleanup_result,
        'maintenance_completed', NOW(),
        'success', true
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ===== インデックス追加（パフォーマンス向上） =====

-- 検索パフォーマンス向上用インデックス
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_type ON credit_transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at_desc ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires ON credit_reservations(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_status ON generation_jobs(user_id, status);

-- ===== 権限設定 =====

-- 関数の実行権限を適切に設定
GRANT EXECUTE ON FUNCTION create_user_with_credits TO postgres;
GRANT EXECUTE ON FUNCTION redeem_code_transaction TO postgres;
GRANT EXECUTE ON FUNCTION reserve_user_credits TO postgres;
GRANT EXECUTE ON FUNCTION consume_reserved_credits TO postgres;
GRANT EXECUTE ON FUNCTION release_credit_reservation TO postgres;
GRANT EXECUTE ON FUNCTION grant_user_credits TO postgres;
GRANT EXECUTE ON FUNCTION monthly_credit_refill TO postgres;
GRANT EXECUTE ON FUNCTION consume_user_credits TO postgres;
GRANT EXECUTE ON FUNCTION validate_user_credit_balance TO postgres;
GRANT EXECUTE ON FUNCTION cleanup_expired_reservations TO postgres;
GRANT EXECUTE ON FUNCTION get_global_credit_stats TO postgres;
GRANT EXECUTE ON FUNCTION exec_sql TO postgres;
GRANT EXECUTE ON FUNCTION scheduled_maintenance TO postgres;

-- ===== 完了メッセージ =====
DO $$
BEGIN
    RAISE NOTICE 'note AI生成プラン Discord Bot SQL関数セットアップ完了: %', NOW();
END $$;
