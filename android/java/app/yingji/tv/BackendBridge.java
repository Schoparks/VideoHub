package app.yingji.tv;

import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;

/** Installed exclusively on the isolated local backend WebView. */
final class BackendBridge {
    private final MainActivity activity;
    private final SecureStore store;
    private final NativeHttp http;
    private final MediaGateway gateway;
    private final LocalLibrary library;
    private final ExecutorService executor;

    BackendBridge(MainActivity activity, SecureStore store, NativeHttp http,
        MediaGateway gateway, LocalLibrary library, ExecutorService executor) {
        this.activity = activity; this.store = store; this.http = http;
        this.gateway = gateway; this.library = library; this.executor = executor;
    }
    @JavascriptInterface public boolean secure() { return store.available(); }
    @JavascriptInterface public String controllerStatus() { return activity.controllerStatus(); }
    @JavascriptInterface public String controllerEnable(boolean enabled) { return activity.controllerEnable(enabled); }
    @JavascriptInterface public void controllerReply(String id, String json) { activity.controllerReply(id, json); }
    @JavascriptInterface public int videoSupport(String json) { return VideoSupport.score(json); }
    @JavascriptInterface public String read(String name) {
        try { return store.read(name); }
        catch (Exception error) { return "!unreadable"; }
    }
    @JavascriptInterface public String write(String name, String value) {
        try { store.write(name, value); return ""; }
        catch (Exception error) { return "无法保存到本机，请检查存储空间"; }
    }
    @JavascriptInterface public String digest(String algorithm, String value) {
        try {
            if (!algorithm.equals("md5") && !algorithm.equals("sha256")) return "";
            return LocalLibrary.hex(MessageDigest.getInstance(algorithm.equals("md5") ? "MD5" : "SHA-256").digest(value.getBytes("UTF-8")));
        } catch (Exception error) { return ""; }
    }
    @JavascriptInterface public void request(String id, String json) {
        executor.execute(() -> {
            try { activity.nativeReply(id, http.request(id, new JSONObject(json)), null); }
            catch (Exception error) {
                activity.nativeReply(id, null, "网络请求失败或超时，请检查地址与网络", HttpFailure.kind(error));
            }
        });
    }
    @JavascriptInterface public void cancel(String id) { http.cancel(id); }
    @JavascriptInterface public String register(String json) {
        try { return gateway.register(new JSONObject(json)); }
        catch (Exception error) { return "无法建立媒体通道"; }
    }
    @JavascriptInterface public void release(String id) { gateway.release(id); }
    @JavascriptInterface public boolean access(String value) {
        Uri uri = Uri.parse(value);
        if (!"content".equals(uri.getScheme())) return false;
        try (InputStream stream = activity.getContentResolver().openInputStream(uri)) { return stream != null; }
        catch (Exception error) { return false; }
    }
    @JavascriptInterface public void select(String id, boolean directory) { library.select(id, directory); }
    @JavascriptInterface public void scan(String id, String roots) {
        executor.execute(() -> {
            try { activity.nativeReply(id, library.scan(new JSONArray(roots), true), null); }
            catch (Exception error) { activity.nativeReply(id, null, "扫描失败，原片库已保留，请检查存储设备"); }
        });
    }
    @JavascriptInterface public String official(String value) {
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null
            || !(host.equals("bilibili.com") || host.endsWith(".bilibili.com"))) return "此来源没有官方入口";
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        if (intent.resolveActivity(activity.getPackageManager()) == null) return "此电视没有可打开官方链接的应用";
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
            } catch (Exception ignored) { /* A handler can be removed after the capability check. */ }
        });
        return "";
    }
    @JavascriptInterface public void reply(String id, String json) { activity.uiReply(id, json); }
    @JavascriptInterface public void ready() { activity.backendReady(); }
}
