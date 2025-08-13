#!/usr/bin/env node
// リデンプションコード生成スクリプト（管理者用）

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * ランダム文字列生成（英数字大文字のみ）
 * @param {number} length - 文字列長
 * @returns {string} ランダム文字列
 */
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * リデンプションコード生成
 * @param {string} noteEmail - note購入者のメールアドレス
 * @param {number} creditsAmount - 付与クレジット数
 * @param {number} expiryDays - 有効期限（日数）
 * @param {string} notes - 管理用メモ
 * @returns {Object} 生成されたコード情報
 */
async function generateRedemptionCode(noteEmail, creditsAmount = 1000, expiryDays = 90, notes = '') {
    try {
        // 重複しないコードを生成
        let code;
        let attempts = 0;
        const maxAttempts = 10;
        
        do {
            code = `NOTE-${generateRandomString(4)}-${generateRandomString(4)}-${generateRandomString(4)}`;
            
            // 既存コードチェック
            const { data: existing } = await supabase
                .from('redemption_codes')
                .select('id')
                .eq('code', code)
                .maybeSingle();
            
            if (!existing) break;
            
            attempts++;
            if (attempts >= maxAttempts) {
                throw new Error('ユニークなコードの生成に失敗しました');
            }
        } while (true);
        
        // 有効期限計算
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);
        
        // データベースに挿入
        const { data, error } = await supabase
            .from('redemption_codes')
            .insert([{
                code: code,
                note_email: noteEmail,
                credits_amount: creditsAmount,
                expires_at: expiresAt.toISOString(),
                notes: notes,
                created_by: 'admin-script'
            }])
            .select()
            .single();

        if (error) {
            throw new Error(`データベース挿入エラー: ${error.message}`);
        }

        return {
            success: true,
            data: data,
            code: code,
            email: noteEmail,
            credits: creditsAmount,
            expiresAt: expiresAt
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 複数コード一括生成
 * @param {Array} users - ユーザー情報配列 [{email, credits?, notes?}]
 * @param {number} expiryDays - 有効期限
 * @returns {Array} 生成結果配列
 */
async function generateMultipleCodes(users, expiryDays = 90) {
    const results = [];
    
    console.log(`📝 ${users.length}件のリデンプションコードを生成中...`);
    
    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`⏳ ${i + 1}/${users.length}: ${user.email}`);
        
        const result = await generateRedemptionCode(
            user.email, 
            user.credits || 1000, 
            expiryDays, 
            user.notes || ''
        );
        
        results.push(result);
        
        if (result.success) {
            console.log(`✅ ${result.code}`);
        } else {
            console.log(`❌ エラー: ${result.error}`);
        }
        
        // API制限対策で少し待機
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
}

/**
 * 既存コード一覧表示
 * @param {number} limit - 表示件数
 * @param {boolean} includeRedeemed - 使用済みコードも表示
 */
async function listRedemptionCodes(limit = 20, includeRedeemed = false) {
    try {
        let query = supabase
            .from('redemption_codes')
            .select('code, note_email, credits_amount, is_redeemed, discord_id, expires_at, created_at')
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (!includeRedeemed) {
            query = query.eq('is_redeemed', false);
        }
        
        const { data: codes, error } = await query;
        
        if (error) {
            throw new Error(`データ取得エラー: ${error.message}`);
        }
        
        console.log(`\n📋 リデンプションコード一覧 (最新${limit}件):`);
        console.log('='.repeat(80));
        
        if (codes.length === 0) {
            console.log('コードが見つかりませんでした');
            return;
        }
        
        codes.forEach(code => {
            const status = code.is_redeemed ? '✅ 使用済み' : '⏳ 未使用';
            const expiryDate = new Date(code.expires_at).toLocaleDateString('ja-JP');
            const createdDate = new Date(code.created_at).toLocaleDateString('ja-JP');
            
            console.log(`コード: ${code.code}`);
            console.log(`メール: ${code.note_email}`);
            console.log(`クレジット: ${code.credits_amount}`);
            console.log(`状態: ${status}`);
            if (code.discord_id) {
                console.log(`Discord ID: ${code.discord_id}`);
            }
            console.log(`有効期限: ${expiryDate}`);
            console.log(`作成日: ${createdDate}`);
            console.log('-'.repeat(40));
        });
        
    } catch (error) {
        console.error('❌ 一覧表示エラー:', error.message);
    }
}

/**
 * CSVファイルから一括生成
 * @param {string} csvFilePath - CSVファイルパス
 */
async function generateFromCSV(csvFilePath) {
    try {
        const fs = require('fs');
        const csvContent = fs.readFileSync(csvFilePath, 'utf8');
        const lines = csvContent.split('\n').filter(line => line.trim());
        
        // ヘッダー行をスキップ
        const users = lines.slice(1).map(line => {
            const [email, credits, notes] = line.split(',');
            return {
                email: email.trim(),
                credits: parseInt(credits.trim()) || 1000,
                notes: notes ? notes.trim() : ''
            };
        });
        
        const results = await generateMultipleCodes(users);
        
        // 結果をCSVで出力
        const outputCsv = 'email,code,credits,status\n' + 
            results.map(r => 
                `${r.data?.note_email || 'N/A'},${r.code || 'N/A'},${r.data?.credits_amount || 0},${r.success ? 'SUCCESS' : 'ERROR'}`
            ).join('\n');
        
        const outputPath = `redemption_codes_${Date.now()}.csv`;
        fs.writeFileSync(outputPath, outputCsv);
        
        console.log(`\n📄 結果をCSVファイルに出力: ${outputPath}`);
        
    } catch (error) {
        console.error('❌ CSV処理エラー:', error.message);
    }
}

// コマンドライン引数処理
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'generate':
        case 'gen':
            const email = args[1];
            const credits = parseInt(args[2]) || 1000;
            const notes = args[3] || '';
            
            if (!email) {
                console.log('❌ メールアドレスが必要です');
                console.log('使用方法: npm run generate-code generate <email> [credits] [notes]');
                return;
            }
            
            console.log('🔑 リデンプションコードを生成中...');
            const result = await generateRedemptionCode(email, credits, 90, notes);
            
            if (result.success) {
                console.log('✅ リデンプションコード生成完了！');
                console.log('');
                console.log('📋 生成情報:');
                console.log(`   コード: ${result.code}`);
                console.log(`   メール: ${result.email}`);
                console.log(`   クレジット: ${result.credits}`);
                console.log(`   有効期限: ${result.expiresAt.toLocaleDateString('ja-JP')}`);
                console.log('');
                console.log('📬 購入者への連絡用テンプレート:');
                console.log('='.repeat(50));
                console.log(`note AI生成プランにご購入いただき、ありがとうございます！`);
                console.log(`以下のリデンプションコードでDiscord Botをご利用いただけます。`);
                console.log('');
                console.log(`🔑 リデンプションコード: ${result.code}`);
                console.log(`💰 クレジット: ${result.credits}`);
                console.log(`📅 有効期限: ${result.expiresAt.toLocaleDateString('ja-JP')}`);
                console.log('');
                console.log(`Discord botで「/redeem ${result.code}」を実行してください。`);
                console.log('='.repeat(50));
                
            } else {
                console.error('❌ 生成失敗:', result.error);
            }
            break;
            
        case 'list':
            const limit = parseInt(args[1]) || 20;
            const includeRedeemed = args[2] === 'all';
            await listRedemptionCodes(limit, includeRedeemed);
            break;
            
        case 'csv':
            const csvPath = args[1];
            if (!csvPath) {
                console.log('❌ CSVファイルパスが必要です');
                console.log('使用方法: npm run generate-code csv <csvファイルパス>');
                console.log('CSV形式: email,credits,notes');
                return;
            }
            await generateFromCSV(csvPath);
            break;
            
        default:
            console.log('🔑 リデンプションコード管理ツール');
            console.log('');
            console.log('使用方法:');
            console.log('  npm run generate-code generate <email> [credits] [notes]  - 単体生成');
            console.log('  npm run generate-code list [limit] [all]                  - 一覧表示');
            console.log('  npm run generate-code csv <csvファイルパス>                 - CSV一括生成');
            console.log('');
            console.log('例:');
            console.log('  npm run generate-code generate user@example.com 1000 "note購入者"');
            console.log('  npm run generate-code list 10');
            console.log('  npm run generate-code list 50 all');
            console.log('  npm run generate-code csv users.csv');
            break;
    }
}

// スクリプト直接実行時
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('❌ 実行エラー:', error);
            process.exit(1);
        });
}

module.exports = {
    generateRedemptionCode,
    generateMultipleCodes,
    listRedemptionCodes,
    generateFromCSV
};
