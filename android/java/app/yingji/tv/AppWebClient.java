package app.yingji.tv;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.Map;
import java.util.HashMap;
import java.io.InputStream;

/** Bundle-only navigation: remote content never receives either native bridge. */
final class AppWebClient extends WebViewClient {
    private final MainActivity activity;
    private final boolean backend;
    private final MediaGateway gateway;

    AppWebClient(MainActivity activity, boolean backend, MediaGateway gateway) {
        this.activity = activity; this.backend = backend; this.gateway = gateway;
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return true;
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!"https".equals(uri.getScheme()) || !"app.yingji.local".equals(uri.getHost()) || uri.getPort() != -1) {
            return MediaGateway.response(403, "text/plain", new byte[0]);
        }
        String path = uri.getPath();
        if (!backend && path.startsWith("/media/")) return gateway.serve(uri, request.getRequestHeaders());
        if (!backend && path.equals("/image")) return Artwork.fetch(uri);
        if (path.contains("..") || path.contains("\\") || backend != path.startsWith("/backend/")) {
            return MediaGateway.response(403, "text/plain", new byte[0]);
        }
        if (path.equals("/")) path = "/index.html";
        try {
            InputStream stream = activity.getAssets().open("web" + path);
            String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript"
                : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml"
                    : path.endsWith(".png") ? "image/png" : "application/json";
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
        } catch (Exception error) { return MediaGateway.response(404, "text/plain", new byte[0]); }
    }
}
