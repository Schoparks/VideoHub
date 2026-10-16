package app.yingji.tv;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Opaque session capabilities; requests cannot introduce an arbitrary remote address. */
final class MediaGateway {
    static final String ORIGIN = "https://app.yingji.local";
    private final Context context;
    private final Map<String, JSONObject> resources = new ConcurrentHashMap<>();
    private final Map<String, String> addresses = new ConcurrentHashMap<>();
    private final Map<String, Set<HttpURLConnection>> connections = new ConcurrentHashMap<>();

    MediaGateway(Context context) { this.context = context; }

    synchronized String register(JSONObject resource) throws Exception {
        String session = resource.getString("session");
        UUID.fromString(session);
        String url = resource.optString("url");
        if (url.startsWith(ORIGIN + "/media/")) {
            String[] path = Uri.parse(url).getPath().split("/");
            JSONObject original = path.length == 3 ? resources.get(path[2]) : null;
            if (original == null) throw new IllegalArgumentException("媒体通道已结束");
            resource = new JSONObject(original.toString()).put("session", session);
            url = resource.optString("url");
        }
        if (!url.isEmpty()) NativeHttp.address(url);
        String key = session + ":" + url;
        if (!url.isEmpty() && addresses.containsKey(key)) return addresses.get(key);
        if (resources.size() >= 20000) throw new IllegalStateException("媒体资源过多");
        String token = UUID.randomUUID().toString();
        resources.put(token, resource);
        String address = ORIGIN + "/media/" + token;
        if (!url.isEmpty()) addresses.put(key, address);
        return address;
    }

    synchronized void release(String session) {
        resources.entrySet().removeIf(entry -> entry.getValue().optString("session").equals(session));
        addresses.keySet().removeIf(key -> key.startsWith(session + ":"));
        Set<HttpURLConnection> active = connections.remove(session);
        if (active != null) for (HttpURLConnection connection : active) connection.disconnect();
    }

    WebResourceResponse serve(Uri uri, Map<String, String> requestHeaders) {
        String[] path = uri.getPath().split("/");
        JSONObject resource = path.length >= 3 ? resources.get(path[2]) : null;
        if (resource == null) return response(404, "text/plain", new byte[0]);
        try {
            String range = header(requestHeaders, "Range");
            String encodedRange = uri.getQueryParameter("range");
            if (encodedRange != null) {
                if (range != null || uri.getQueryParameters("range").size() != 1
                    || !encodedRange.matches("\\d{1,20}-\\d{0,20}")) return response(416, "text/plain", new byte[0]);
                range = "bytes=" + encodedRange;
            }
            if (resource.has("text")) return response(200, resource.optString("mime", "text/plain"), resource.getString("text").getBytes("UTF-8"));
            if (resource.has("path")) return local(resource.getString("path"), range);
            String address = resource.getString("url");
            if (resource.optString("mime").equals("application/x-yingji-template")) {
                address = expand(address, path);
            }
            return remote(resource, address, range);
        } catch (Exception error) { return response(502, "text/plain", new byte[0]); }
    }

    private String expand(String template, String[] path) throws Exception {
        Matcher matcher = Pattern.compile("\\$(Number|Time)(?:%0\\d{1,2}d)?\\$").matcher(template);
        StringBuffer result = new StringBuffer();
        int index = 3;
        while (matcher.find()) {
            if (index >= path.length || !path[index].matches("\\d{1,20}")) throw new IllegalArgumentException();
            matcher.appendReplacement(result, path[index++]);
        }
        matcher.appendTail(result);
        if (index != path.length || result.toString().contains("$")) throw new IllegalArgumentException();
        NativeHttp.address(result.toString());
        return result.toString();
    }

    private WebResourceResponse remote(JSONObject resource, String address, String range) throws Exception {
        String session = resource.getString("session");
        Set<HttpURLConnection> active = connections.computeIfAbsent(session, key -> ConcurrentHashMap.newKeySet());
        RemoteMediaConnection source = new RemoteMediaConnection(resource, address, active,
            () -> resources.containsValue(resource));
        try {
            source.open(range != null && range.matches("bytes=\\d*-\\d*") ? range : null);
            HttpURLConnection connection = source.connection;
            URL url = source.url;
            int status = connection.getResponseCode();
            String mime = connection.getContentType();
            if (mime == null) mime = "application/octet-stream";
            mime = mime.split(";")[0];
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
            if (status == 200 && (mime.contains("mpegurl") || url.getPath().toLowerCase().endsWith(".m3u8"))) {
                byte[] bytes;
                try (InputStream manifest = stream) { bytes = NativeHttp.read(manifest, 4 * 1024 * 1024); }
                source.close();
                return response(200, "application/vnd.apple.mpegurl", rewriteHls(new String(bytes, "UTF-8"), url, resource).getBytes("UTF-8"));
            }
            InputStream body = new ResumingMediaStream(stream, connection.getContentLengthLong(), source);
            Map<String, String> headers = baseHeaders();
            for (String name : new String[] { "Content-Length", "Content-Range", "Accept-Ranges" }) {
                if (connection.getHeaderField(name) != null) headers.put(name, connection.getHeaderField(name));
            }
            return new WebResourceResponse(mime, null, status, "Media", headers, body);
        } catch (Exception error) {
            source.close();
            throw error;
        }
    }

    private String rewriteHls(String text, URL base, JSONObject resource) throws Exception {
        if (!text.trim().startsWith("#EXTM3U")) throw new IllegalArgumentException();
        StringBuilder result = new StringBuilder();
        for (String line : text.split("\n")) {
            if (line.startsWith("#")) {
                Matcher matcher = Pattern.compile("URI=\"([^\"]+)\"").matcher(line);
                StringBuffer replaced = new StringBuffer();
                while (matcher.find()) matcher.appendReplacement(replaced, Matcher.quoteReplacement("URI=\"" + child(base, matcher.group(1), resource) + "\""));
                matcher.appendTail(replaced);
                result.append(replaced);
            } else if (!line.trim().isEmpty()) result.append(child(base, line.trim(), resource));
            result.append('\n');
        }
        return result.toString();
    }

    private String child(URL base, String value, JSONObject resource) throws Exception {
        JSONObject child = new JSONObject(resource.toString());
        child.remove("mime");
        child.put("url", new URL(base, value).toString());
        return register(child);
    }

    private WebResourceResponse local(String path, String range) throws Exception {
        Uri uri = Uri.parse(path);
        if (!uri.getScheme().equals("content")) throw new IllegalArgumentException();
        AssetFileDescriptor descriptor = context.getContentResolver().openAssetFileDescriptor(uri, "r");
        if (descriptor == null) throw new IllegalArgumentException();
        long size = descriptor.getLength();
        long start = 0, end = size - 1;
        if (range != null) {
            Matcher match = Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);
            if (size <= 0 || !match.matches() || match.group(1).isEmpty() && match.group(2).isEmpty()) {
                descriptor.close(); return response(416, "text/plain", new byte[0]);
            }
            start = match.group(1).isEmpty() ? Math.max(0, size - Long.parseLong(match.group(2))) : Long.parseLong(match.group(1));
            if (!match.group(1).isEmpty() && !match.group(2).isEmpty()) end = Math.min(end, Long.parseLong(match.group(2)));
            if (start > end || start >= size) { descriptor.close(); return response(416, "text/plain", new byte[0]); }
        }
        InputStream stream = descriptor.createInputStream();
        Map<String, String> headers = baseHeaders();
        if (size >= 0) {
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", String.valueOf(end - start + 1));
            if (range != null) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            stream = new RangeStream(stream, start, end - start + 1);
        }
        String mime = context.getContentResolver().getType(uri);
        return new WebResourceResponse(mime == null ? "video/mp4" : mime, null, range == null ? 200 : 206, "Media", headers, stream);
    }

    static String header(Map<String, String> values, String name) {
        for (Map.Entry<String, String> field : values.entrySet()) if (field.getKey().equalsIgnoreCase(name)) return field.getValue();
        return null;
    }
    static Map<String, String> baseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", ORIGIN);
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }
    static WebResourceResponse response(int status, String mime, byte[] body) {
        return new WebResourceResponse(mime, "UTF-8", status, "Response", baseHeaders(), new ByteArrayInputStream(body));
    }
    void close() { for (JSONObject resource : resources.values()) release(resource.optString("session")); }
}
