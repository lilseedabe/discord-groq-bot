#!/usr/bin/env node
// Supabaseデータベーススキーマセットアップスクリプト

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です');
    console.error('   .envファイルで設定してください');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupSupabaseSchema() {
    console.log('🗄️  Supabaseデータベーススキーマをセットアップ中...');
    
    try {
        // SQLファイルを読み込み
        const schemaPath = path.join(__dirname, '..', 'database-schema-supabase.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📋 SQLスキーマファイルを読み込み中...');
        
        // SQLを実行（複数ステートメントを分割して実行）
        const statements = schemaSql
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
        
        console.log(`📝 ${statements.length}個のSQLステートメントを実行中...`);
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.trim()) {
                try {
                    const { error } = await supabase.rpc('exec_sql', { 
                        sql_query: statement + ';' 
                    });
                    
                    if (error && !error.message.includes('already exists')) {
                        console.warn(`⚠️  ステートメント ${i + 1}: ${error.message}`);
                    } else {
                        console.log(`✅ ステートメント ${i + 1}/${statements.length} 実行完了`);
                    }
                } catch (err) {
                    // 既存テーブル等のエラーは無視
                    if (!err.message.includes('already exists')) {
                        console.warn(`⚠️  ステートメント ${i + 1} エラー: ${err.message}`);
                    }
                }
            }
        }
        
        // テーブル作成確認
        console.log('🔍 作成されたテーブルを確認中...');
        const { data: tables, error: tablesError } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_schema', 'public')
            .in('table_name', [
                'note_users', 
                'user_credits', 
                'credit_transactions', 
                'generation_jobs', 
                'redemption_codes',
                'credit_reservations',
                'dm_preferences',
                'app_settings'
            ]);
        
        if (!tablesError && tables) {
            console.log('✅ 作成されたテーブル:');
            tables.forEach(table => {
                console.log(`   - ${table.table_name}`);
            });
        }
        
        // テストデータ投入確認
        console.log('🧪 テストデータを確認中...');
        const { data: testCodes, error: codesError } = await supabase
            .from('redemption_codes')
            .select('code, note_email')
            .limit(5);
        
        if (!codesError && testCodes && testCodes.length > 0) {
            console.log('✅ テストリデンプションコード:');
            testCodes.forEach(code => {
                console.log(`   - ${code.code} (${code.note_email})`);
            });
        }
        
        console.log('🎉 Supabaseデータベーススキーマのセットアップが完了しました！');
        console.log('');
        console.log('📋 次のステップ:');
        console.log('   1. リデンプションコード生成: npm run generate-code <email>');
        console.log('   2. Botテスト: /redeem NOTE-TEST-0001-DEMO');
        console.log('   3. AI生成テスト: /gen-image プロンプト');
        
    } catch (error) {
        console.error('❌ セットアップエラー:', error);
        console.error('');
        console.error('🔧 トラブルシューティング:');
        console.error('   1. SUPABASE_URLとSUPABASE_SERVICE_ROLE_KEYを確認');
        console.error('   2. Supabaseプロジェクトのステータス確認');
        console.error('   3. RLSポリシー設定の確認');
        process.exit(1);
    }
}

// 直接実行時のハンドリング
if (require.main === module) {
    setupSupabaseSchema()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('セットアップ失敗:', error);
            process.exit(1);
        });
}

module.exports = { setupSupabaseSchema };
