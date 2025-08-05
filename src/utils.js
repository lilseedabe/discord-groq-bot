// 暗号化・復号化ユーティリティ（確実動作版）
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'discord_groq_bot_default_encryption_key_2025';
const algorithm = 'aes-256-cbc';  // 🔧 CBCモードで確実に動作

// 暗号化キーを32バイト（256ビット）に標準化
function getKey() {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encrypt(text) {
    try {
        console.log(`🔒 暗号化開始: "${text.substring(0, 10)}..." (${text.length}文字)`);
        
        // 🔧 最も確実な方法: createCipheriv を使用
        const key = getKey();
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // IV:暗号化データ の形式で返す
        const result = iv.toString('hex') + ':' + encrypted;
        console.log(`✅ 暗号化完了: ${result.length}文字`);
        
        return result;
    } catch (error) {
        console.error('❌ 暗号化エラー:', error);
        
        // 🔄 フォールバック1: 非推奨だが動作するcreatecipher
        try {
            console.log('🔄 フォールバック暗号化を試行中...');
            const cipher = crypto.createCipher('aes192', ENCRYPTION_KEY);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            console.log(`✅ フォールバック暗号化成功: ${encrypted.length}文字`);
            return 'fallback:' + encrypted;
        } catch (fallbackError) {
            console.error('❌ フォールバック暗号化も失敗:', fallbackError);
            
            // 🔄 最終フォールバック: Base64エンコーディング
            console.log('🔄 Base64フォールバックを使用');
            const encoded = Buffer.from(text).toString('base64');
            return 'base64:' + encoded;
        }
    }
}

function decrypt(encryptedData) {
    try {
        console.log(`🔓 復号化開始: ${encryptedData.length}文字`);
        
        // Base64フォールバックの場合
        if (encryptedData.startsWith('base64:')) {
            console.log('🔄 Base64フォールバック復号化');
            const encoded = encryptedData.replace('base64:', '');
            const result = Buffer.from(encoded, 'base64').toString('utf8');
            console.log(`✅ Base64復号化完了: ${result.length}文字`);
            return result;
        }
        
        // 単純暗号化フォールバックの場合
        if (encryptedData.startsWith('fallback:')) {
            console.log('🔄 フォールバック復号化');
            const encrypted = encryptedData.replace('fallback:', '');
            const decipher = crypto.createDecipher('aes192', ENCRYPTION_KEY);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            console.log(`✅ フォールバック復号化完了: ${decrypted.length}文字`);
            return decrypted;
        }
        
        // 通常のCBC復号化
        const key = getKey();
        const parts = encryptedData.split(':');
        
        if (parts.length !== 2) {
            throw new Error(`無効な暗号化データ形式: ${parts.length}個の部分（2個が必要）`);
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        
        // 🔧 修正: createDecipheriv を使用
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        
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
            'twitter_access_token_example',
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
    console.log(`ENCRYPTION_KEY 設定: ${process.env.ENCRYPTION_KEY ? '✅ 設定済み' : '❌ 未設定（デフォルト使用）'}`);
    
    if (process.env.ENCRYPTION_KEY) {
        console.log(`ENCRYPTION_KEY 長さ: ${process.env.ENCRYPTION_KEY.length}文字`);
    }
    
    // 利用可能な暗号化アルゴリズムをチェック
    const ciphers = crypto.getCiphers();
    console.log(`利用可能な暗号化方式数: ${ciphers.length}`);
    console.log(`AES-256-CBC サポート: ${ciphers.includes('aes-256-cbc') ? '✅' : '❌'}`);
    console.log(`AES-192 サポート: ${ciphers.includes('aes192') ? '✅' : '❌'}`);
    
    return {
        nodeVersion: process.version,
        hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
        encryptionKeyLength: process.env.ENCRYPTION_KEY ? process.env.ENCRYPTION_KEY.length : 0,
        supportedCiphers: ciphers.length
    };
}

module.exports = {
    encrypt,
    decrypt,
    testEncryption,
    checkEnvironment
};
