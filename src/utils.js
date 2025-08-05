// 暗号化・復号化ユーティリティ（完全修正版）
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const algorithm = 'aes-256-gcm';

// 暗号化キーを32バイト（256ビット）に標準化
function getKey() {
    if (!ENCRYPTION_KEY) {
        console.warn('⚠️ ENCRYPTION_KEY が設定されていません。デフォルトキーを使用します。');
        return crypto.createHash('sha256').update('default_discord_bot_key_2025').digest();
    }
    return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encrypt(text) {
    try {
        console.log(`🔒 暗号化開始: "${text.substring(0, 10)}..." (${text.length}文字)`);
        
        const key = getKey();
        const iv = crypto.randomBytes(16);
        
        // 🔧 修正: createCipherGCM を使用（createCipher の代替）
        const cipher = crypto.createCipherGCM(algorithm, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        const result = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
        console.log(`✅ 暗号化完了: ${result.length}文字`);
        
        return result;
    } catch (error) {
        console.error('❌ 暗号化エラー:', error);
        throw new Error(`暗号化に失敗しました: ${error.message}`);
    }
}

function decrypt(encryptedData) {
    try {
        console.log(`🔓 復号化開始: ${encryptedData.length}文字`);
        
        const key = getKey();
        const parts = encryptedData.split(':');
        
        if (parts.length !== 3) {
            throw new Error(`無効な暗号化データ形式: ${parts.length}個の部分（3個が必要）`);
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        // 🔧 修正: createDecipherGCM を使用（createDecipher の代替）
        const decipher = crypto.createDecipherGCM(algorithm, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        console.log(`✅ 復号化完了: "${decrypted.substring(0, 10)}..." (${decrypted.length}文字)`);
        
        return decrypted;
    } catch (error) {
        console.error('❌ 復号化エラー:', error);
        throw new Error(`復号化に失敗しました: ${error.message}`);
    }
}

// 🆕 テスト関数（動作確認用）
function testEncryption() {
    try {
        console.log('🧪 暗号化テスト開始...');
        
        const testTexts = [
            'test_api_key_123',
            'very_long_twitter_access_token_example_12345678901234567890',
            'simple_text'
        ];
        
        for (const testText of testTexts) {
            console.log(`\n📝 テスト対象: "${testText}"`);
            
            const encrypted = encrypt(testText);
            console.log(`暗号化結果: ${encrypted.substring(0, 50)}...`);
            
            const decrypted = decrypt(encrypted);
            console.log(`復号化結果: "${decrypted}"`);
            
            const success = testText === decrypted;
            console.log(`結果: ${success ? '✅ 成功' : '❌ 失敗'}`);
            
            if (!success) {
                console.error(`期待値: "${testText}"`);
                console.error(`実際値: "${decrypted}"`);
                return false;
            }
        }
        
        console.log('\n🎉 すべてのテストが成功しました！');
        return true;
    } catch (error) {
        console.error('❌ テスト失敗:', error);
        return false;
    }
}

// 🆕 環境チェック関数
function checkEnvironment() {
    console.log('🔍 暗号化環境チェック...');
    
    console.log(`Node.js バージョン: ${process.version}`);
    console.log(`ENCRYPTION_KEY 設定: ${ENCRYPTION_KEY ? '✅ 設定済み' : '❌ 未設定'}`);
    
    if (ENCRYPTION_KEY) {
        console.log(`ENCRYPTION_KEY 長さ: ${ENCRYPTION_KEY.length}文字`);
    }
    
    // 利用可能な暗号化アルゴリズムをチェック
    const ciphers = crypto.getCiphers();
    const hasGCM = ciphers.includes('aes-256-gcm');
    console.log(`AES-256-GCM サポート: ${hasGCM ? '✅ 利用可能' : '❌ 利用不可'}`);
    
    return {
        nodeVersion: process.version,
        hasEncryptionKey: !!ENCRYPTION_KEY,
        encryptionKeyLength: ENCRYPTION_KEY ? ENCRYPTION_KEY.length : 0,
        hasGCMSupport: hasGCM
    };
}

module.exports = {
    encrypt,
    decrypt,
    testEncryption,
    checkEnvironment
};
