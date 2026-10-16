package app.yingji.tv;

import android.webkit.JavascriptInterface;

/** UI whitelist is validated again by the existing IPC schemas in the backend. */
final class HubBridge {
    private final MainActivity activity;
    HubBridge(MainActivity activity) { this.activity = activity; }
    @JavascriptInterface public void call(String id, String method, String args) { activity.callBackend(id, method, args); }
    @JavascriptInterface public void exit() { activity.runOnUiThread(activity::finish); }
}
