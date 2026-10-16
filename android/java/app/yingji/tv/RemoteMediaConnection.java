package app.yingji.tv;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Same-track platform mirrors only, tried after a connection or transient HTTP failure. */
final class RemoteMediaConnection {
    private final JSONObject resource;
    private final Set<HttpURLConnection> active;
    private final BooleanSupplier alive;
    private final List<String> candidates = new ArrayList<>();
    private int next;
    HttpURLConnection connection;
    URL url;

    RemoteMediaConnection(JSONObject resource, String address, Set<HttpURLConnection> active,
        BooleanSupplier alive) throws Exception {
        this.resource = resource;
        this.active = active;
        this.alive = alive;
        candidates.add(address);
        JSONArray backups = resource.optBoolean("bili") ? resource.optJSONArray("backups") : null;
        if (backups != null) for (int index = 0; index < Math.min(4, backups.length()); index++) {
            String backup = backups.getString(index);
            NativeHttp.address(backup);
            if (!candidates.contains(backup)) candidates.add(backup);
        }
    }

    void open(String range) throws Exception {
        Exception failure = new IOException("媒体读取失败");
        while (next < candidates.size()) {
            String address = candidates.get(next++);
            try {
                close();
                url = NativeHttp.address(address);
                for (int hop = 0; hop <= 5; hop++) {
                    if (!alive.getAsBoolean()) throw new IOException("会话已结束");
                    connection = (HttpURLConnection) url.openConnection();
                    active.add(connection);
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(20000);
                    connection.setRequestProperty("User-Agent", NativeHttp.USER_AGENT);
                    if (range != null) connection.setRequestProperty("Range", range);
                    if (resource.optBoolean("bili")) connection.setRequestProperty("Referer", "https://www.bilibili.com/");
                    else if (resource.has("referer")) connection.setRequestProperty("Referer", resource.getString("referer"));
                    int status = connection.getResponseCode();
                    if (status >= 300 && status < 400 && status != 304) {
                        URL redirected = NativeHttp.address(new URL(url, connection.getHeaderField("Location")).toString());
                        close();
                        url = redirected;
                        if (hop == 5) throw new IOException("重定向过多");
                        continue;
                    }
                    if ((status == 404 || status == 410 || status >= 500) && next < candidates.size()) {
                        throw new IOException("媒体节点暂时不可用");
                    }
                    if (next > 1 && range != null && status < 400) {
                        Matcher requested = Pattern.compile("bytes=(\\d+)-(\\d*)").matcher(range);
                        String returned = connection.getHeaderField("Content-Range");
                        Matcher actual = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)").matcher(returned == null ? "" : returned);
                        if (!requested.matches() || status != 206 || !actual.matches()
                            || !requested.group(1).equals(actual.group(1))
                            || !requested.group(2).isEmpty() && !requested.group(2).equals(actual.group(2))) {
                            throw new IOException("备用媒体范围不匹配");
                        }
                    }
                    return;
                }
            } catch (Exception error) {
                failure = error;
                close();
                if (!alive.getAsBoolean()) throw error;
            }
        }
        throw failure;
    }

    boolean hasBackup() { return next < candidates.size() && alive.getAsBoolean(); }

    void close() {
        if (connection != null) {
            connection.disconnect();
            active.remove(connection);
            connection = null;
        }
    }
}
