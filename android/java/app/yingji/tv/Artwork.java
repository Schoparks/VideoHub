package app.yingji.tv;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.InputStream;
import java.util.Locale;

/** Public image channel, with no credentials and no redirects. */
final class Artwork {
    static WebResourceResponse fetch(Uri uri) {
        HttpURLConnection connection = null;
        try {
            URL url = NativeHttp.address(uri.getQueryParameter("url"));
            String host = url.getHost().toLowerCase(Locale.ROOT);
            if (!url.getProtocol().equals("https") || url.getPort() != -1
                || !(host.equals("hdslb.com") || host.endsWith(".hdslb.com")
                || host.equals("biliimg.com") || host.endsWith(".biliimg.com"))) {
                return MediaGateway.response(403, "text/plain", new byte[0]);
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("User-Agent", NativeHttp.USER_AGENT);
            connection.setRequestProperty("Referer", "https://www.bilibili.com/");
            String mime = connection.getContentType();
            if (connection.getResponseCode() != 200 || mime == null
                || !mime.split(";")[0].matches("image/(jpeg|png|webp|avif|gif)")
                || connection.getContentLengthLong() > 12 * 1024 * 1024) throw new IllegalArgumentException();
            try (InputStream stream = connection.getInputStream()) {
                return MediaGateway.response(200, mime.split(";")[0], NativeHttp.read(stream, 12 * 1024 * 1024));
            }
        } catch (Exception error) { return MediaGateway.response(502, "text/plain", new byte[0]); }
        finally { if (connection != null) connection.disconnect(); }
    }
}
