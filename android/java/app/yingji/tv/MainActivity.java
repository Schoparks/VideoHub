package app.yingji.tv;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private volatile WebView ui;
    private WebView backend;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final List<String> waiting = new ArrayList<>();
    private NativeHttp http;
    private MediaGateway gateway;
    private LocalLibrary library;
    private PhoneController controller;
    private volatile boolean resumed;
    private volatile boolean ready;
    private long lastDirection;
    private final Runnable controllerRefresh = new Runnable() {
        @Override public void run() {
            if (controller == null || executor.isShutdown()) return;
            executor.execute(() -> controller.enable(true));
            handler.postDelayed(this, 5000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // Text entry uses our seven-key keyboard; a system IME must not consume remote keys.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
            | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        immersive();
        android.content.pm.PackageInfo webview = null;
        String phase = "检查系统内核";
        try {
            webview = WebView.getCurrentWebViewPackage();
            if (webview == null) {
                StartupFailure.show(this, null, "系统未提供可用的 WebView 组件。");
                return;
            }
            if (Integer.parseInt(webview.versionName.split("\\.")[0]) < 66) {
                StartupFailure.show(this, webview, "此版本需要 WebView 66 或更新版本。");
                return;
            }
            phase = "初始化 WebView";
            WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
            FrameLayout root = new FrameLayout(this);
            setContentView(root);
            gateway = new MediaGateway(this);
            http = new NativeHttp();
            library = new LocalLibrary(this, executor);
            controller = new PhoneController(this);
            handler.post(controllerRefresh);
            phase = "加载后端";
            backend = webView(true);
            backend.addJavascriptInterface(new BackendBridge(this, new SecureStore(this), http, gateway, library, executor), "Backend");
            root.addView(backend, new FrameLayout.LayoutParams(1, 1));
            backend.setAlpha(0);
            backend.setFocusable(false);
            backend.loadUrl(MediaGateway.ORIGIN + "/backend/index.html");
            phase = "加载界面";
            ui = webView(false);
            ui.addJavascriptInterface(new HubBridge(this), "HubBridge");
            root.addView(ui, new FrameLayout.LayoutParams(-1, -1));
            ui.loadUrl(MediaGateway.ORIGIN + "/index.html");
            ui.requestFocus();
        } catch (Exception | LinkageError error) {
            // Discard partially created views so native buttons own the seven remote keys.
            if (ui != null) { ui.destroy(); ui = null; }
            if (backend != null) { backend.destroy(); backend = null; }
            StartupFailure.show(this, webview, "启动失败（" + phase + "：" + error.getClass().getSimpleName() + "）。");
        }
    }

    private WebView webView(boolean isolated) {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        view.setWebViewClient(new AppWebClient(this, isolated, gateway));
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        view.setDownloadListener((url, agent, disposition, mime, length) -> {});
        view.setBackgroundColor(android.graphics.Color.BLACK);
        return view;
    }

    void callBackend(String id, String method, String json) {
        if (!id.matches("\\d{1,12}") || !method.matches("[A-Za-z]{1,40}") || json.length() > 2000000) return;
        handler.post(() -> {
            try {
                JSONArray args = new JSONArray(json);
                String script = "window.backendCall(" + JSONObject.quote(id) + "," + JSONObject.quote(method) + "," + args + ")";
                if (ready) backend.evaluateJavascript(script, null);
                else if (waiting.size() < 100) waiting.add(script);
            } catch (Exception error) { uiReply(id, "{\"error\":\"请求参数不正确\"}"); }
        });
    }
    void backendReady() {
        handler.post(() -> {
            ready = true;
            for (String script : waiting) backend.evaluateJavascript(script, null);
            waiting.clear();
        });
    }
    String controllerStatus() { return controller == null ? "{\"enabled\":false,\"urls\":[]}" : controller.enable(true); }
    String controllerEnable(boolean enabled) {
        if (controller == null || !resumed) return "{\"error\":\"应用当前不可遥控\"}";
        return controller.enable(true);
    }
    boolean controllerAvailable() { return resumed && ready && ui != null; }
    void controllerReply(String id, String json) { if (controller != null) controller.reply(id, json); }
    void controllerCommand(String json) {
        handler.post(() -> {
            if (!controllerAvailable()) {
                try { controllerReply(new JSONObject(json).getString("id"), "{\"error\":\"unavailable\"}"); }
                catch (Exception ignored) { }
                return;
            }
            ui.evaluateJavascript("window.dispatchEvent(new CustomEvent('hub-controller-command',{detail:JSON.parse("
                + JSONObject.quote(json) + ")}))", null);
        });
    }
    void uiReply(String id, String json) {
        handler.post(() -> { if (ui != null) ui.evaluateJavascript("window.hubReply && window.hubReply(" + JSONObject.quote(id) + "," + JSONObject.quote(json) + ")", null); });
    }
    void nativeReply(String id, Object value, String error) {
        nativeReply(id, value, error, null);
    }
    void nativeReply(String id, Object value, String error, String errorKind) {
        handler.post(() -> {
            if (backend == null) return;
            try {
                JSONObject result = new JSONObject();
                if (error == null) result.put("value", value); else result.put("error", error);
                if (errorKind != null) result.put("errorKind", errorKind);
                backend.evaluateJavascript("window.nativeReply(" + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ")", null);
            } catch (Exception ignored) { /* No raw request or credential data is logged. */ }
        });
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        String action;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_UP: action = "up"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: action = "down"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: action = "left"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: action = "right"; break;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER: action = "confirm"; break;
            case KeyEvent.KEYCODE_MENU: action = "menu"; break;
            case KeyEvent.KEYCODE_BACK: action = "back"; break;
            default: return super.dispatchKeyEvent(event);
        }
        if (ui == null) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            boolean direction = action.equals("up") || action.equals("down") || action.equals("left") || action.equals("right");
            long now = android.os.SystemClock.uptimeMillis();
            if (event.getRepeatCount() == 0 || direction && now - lastDirection >= 110) {
                lastDirection = now;
                ui.evaluateJavascript("window.dispatchEvent(new CustomEvent('hub-remote',{detail:" + JSONObject.quote(action) + "}))", null);
            }
        }
        return true;
    }
    @Override public void onBackPressed() {
        if (ui == null) { super.onBackPressed(); return; }
        ui.evaluateJavascript("window.dispatchEvent(new CustomEvent('hub-remote',{detail:'back'}))", null);
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if (focus) immersive(); }
    @Override protected void onPause() {
        resumed = false;
        if (controller != null) controller.cancelPending();
        if (ui != null) { ui.evaluateJavascript("window.dispatchEvent(new Event('hub-suspend'))", null); ui.onPause(); }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (controller != null) executor.execute(() -> controller.enable(true));
        if (ui != null) { ui.onResume(); immersive(); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == LocalLibrary.PICK && library != null) library.result(result, data);
    }
    @Override protected void onDestroy() {
        if (controller != null) controller.destroy();
        if (gateway != null) gateway.close();
        if (http != null) http.close();
        executor.shutdownNow();
        handler.removeCallbacksAndMessages(null);
        if (ui != null) { ui.removeJavascriptInterface("HubBridge"); ui.destroy(); ui = null; }
        if (backend != null) { backend.removeJavascriptInterface("Backend"); backend.destroy(); backend = null; }
        super.onDestroy();
    }
}
