package app.yingji.tv;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.concurrent.ConcurrentHashMap;

/** No CookieManager: API credentials are explicit and confined to exact trusted hosts. */
final class NativeHttp {
    static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36";
    private static final Set<String> API = new HashSet<>(Arrays.asList(
        "api.bilibili.com", "app.bilibili.com", "passport.bilibili.com", "api.live.bilibili.com"));
    private final Map<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final Set<String> canceled = ConcurrentHashMap.newKeySet();

    static URL address(String value) throws Exception {
        URL url = new URL(value);
        if ((!url.getProtocol().equals("http") && !url.getProtocol().equals("https"))
            || url.getUserInfo() != null || value.length() > 10000) throw new IllegalArgumentException("不允许的网络地址");
        return url;
    }

    static byte[] read(InputStream stream, int limit) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int count;
        while ((count = stream.read(chunk)) != -1) {
            if (bytes.size() + count > limit) throw new IllegalArgumentException("网络响应过大");
            bytes.write(chunk, 0, count);
        }
        return bytes.toByteArray();
    }

    JSONObject request(String id, JSONObject input) throws Exception {
        HttpURLConnection connection = null;
        URL url = address(input.getString("url"));
        JSONObject headers = input.optJSONObject("headers");
        boolean credential = false;
        int limit = 4 * 1024 * 1024;
        if (headers != null) for (String name : iterable(headers.keys())) {
            if (name.equalsIgnoreCase("cookie")) credential = true;
            if (name.equalsIgnoreCase("range")) {
                java.util.regex.Matcher range = java.util.regex.Pattern.compile("bytes=0-(\\d+)").matcher(headers.getString(name));
                if (range.matches() && Long.parseLong(range.group(1)) < 65536) limit = Integer.parseInt(range.group(1)) + 1;
            }
        }
        try {
            for (int redirect = 0; redirect <= 5; redirect++) {
                if (canceled.contains(id)) throw new IllegalStateException("操作已取消");
                boolean trusted = url.getProtocol().equals("https") && url.getPort() == -1 && API.contains(url.getHost());
                if (credential && !trusted) throw new IllegalArgumentException("禁止向此地址发送账号凭证");
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setRequestProperty("Accept-Encoding", "gzip, deflate");
                requests.put(id, connection);
                String method = input.optString("method", "GET");
                if (!Arrays.asList("GET", "HEAD", "POST").contains(method) || method.equals("POST") && !trusted) {
                    throw new IllegalArgumentException("不允许的请求方式");
                }
                connection.setRequestMethod(method);
                if (headers != null) for (String name : iterable(headers.keys())) {
                    String lower = name.toLowerCase(Locale.ROOT);
                    if (!Arrays.asList("cookie", "referer", "user-agent", "accept", "range", "content-type").contains(lower)) continue;
                    String value = headers.getString(name);
                    if (value.contains("\r") || value.contains("\n")) throw new IllegalArgumentException("无效的请求头");
                    connection.setRequestProperty(name, value);
                }
                if (method.equals("POST")) {
                    connection.setDoOutput(true);
                    byte[] body = input.optString("body").getBytes("UTF-8");
                    if (body.length > 65536) throw new IllegalArgumentException("请求数据过大");
                    try (java.io.OutputStream stream = connection.getOutputStream()) { stream.write(body); }
                }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400 && status != 304) {
                    if (input.optString("redirect").equals("error") || credential || redirect == 5) {
                        throw new IllegalStateException("不允许的重定向");
                    }
                    url = address(new URL(url, connection.getHeaderField("Location")).toString());
                    connection.disconnect();
                    continue;
                }
                JSONObject responseHeaders = new JSONObject();
                JSONArray cookies = new JSONArray();
                String encoding = connection.getContentEncoding();
                boolean compressed = HttpBody.compressed(encoding);
                for (Map.Entry<String, List<String>> field : connection.getHeaderFields().entrySet()) {
                    if (field.getKey() == null) continue;
                    if (compressed && (field.getKey().equalsIgnoreCase("Content-Encoding")
                        || field.getKey().equalsIgnoreCase("Content-Length"))) continue;
                    if (field.getKey().equalsIgnoreCase("Set-Cookie")) {
                        if (trusted) for (String cookie : field.getValue()) cookies.put(cookie);
                    } else responseHeaders.put(field.getKey(), String.join(", ", field.getValue()));
                }
                byte[] bytes = new byte[0];
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream != null) try (InputStream raw = stream) {
                    if (!method.equals("HEAD") && status != 204 && status != 205 && status != 304) {
                        try (InputStream body = HttpBody.decode(raw, encoding)) { bytes = read(body, limit); }
                    }
                }
                return new JSONObject().put("status", status).put("headers", responseHeaders).put("cookies", cookies)
                    .put("url", url.toString()).put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
            }
            throw new IllegalStateException("重定向过多");
        } finally {
            requests.remove(id);
            canceled.remove(id);
            if (connection != null) connection.disconnect();
        }
    }

    private static Iterable<String> iterable(java.util.Iterator<String> iterator) { return () -> iterator; }
    void cancel(String id) { canceled.add(id); HttpURLConnection connection = requests.get(id); if (connection != null) connection.disconnect(); }
    void close() { for (String id : requests.keySet()) cancel(id); }
}
