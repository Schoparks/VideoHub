package app.yingji.tv;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Account secrets never enter the UI WebView or plaintext files. */
final class SecureStore {
    private final Context context;
    private SecretKey key;

    SecureStore(Context context) {
        this.context = context;
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (!store.containsAlias("yingji-account")) {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder("yingji-account",
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
                generator.generateKey();
            }
            key = (SecretKey) store.getKey("yingji-account", null);
        } catch (Exception ignored) { key = null; }
    }

    boolean available() { return key != null; }

    private AtomicFile file(String name) {
        if (!name.equals("account") && !name.equals("library") && !name.equals("backup")) {
            throw new IllegalArgumentException("不允许的存储名称");
        }
        return new AtomicFile(new File(context.getFilesDir(), name + (name.equals("account") ? ".enc" : ".json")));
    }

    synchronized String read(String name) throws Exception {
        AtomicFile file = file(name);
        if (!file.getBaseFile().exists()) return "";
        byte[] bytes = file.readFully();
        if (name.equals("account")) {
            if (key == null || bytes.length < 28) throw new IllegalStateException("无法解密已保存的账号");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12));
            bytes = cipher.doFinal(bytes, 12, bytes.length - 12);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    synchronized void write(String name, String value) throws Exception {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 32 * 1024 * 1024) throw new IllegalArgumentException("存储数据过大");
        if (name.equals("account")) {
            if (key == null) throw new IllegalStateException("系统密钥环不可用");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] encrypted = cipher.doFinal(bytes);
            byte[] combined = new byte[12 + encrypted.length];
            System.arraycopy(cipher.getIV(), 0, combined, 0, 12);
            System.arraycopy(encrypted, 0, combined, 12, encrypted.length);
            bytes = combined;
        }
        AtomicFile file = file(name);
        FileOutputStream stream = file.startWrite();
        try { stream.write(bytes); file.finishWrite(stream); }
        catch (Exception error) { file.failWrite(stream); throw error; }
    }
}
