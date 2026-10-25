package app.yingji.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Application-owned LAN controller, independent of the media/account bridge. */
final class PhoneController {
    private final MainActivity activity;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private final Map<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    private final Map<String, ControllerHttp.Reply> assets = new ConcurrentHashMap<>();
    private volatile ServerSocket server;
    private volatile String token = "";
    private volatile Set<String> hosts = new HashSet<>();
    private JSONArray urls = new JSONArray();
    private double allowance = 30;
    private long refilled = System.nanoTime();

    PhoneController(MainActivity activity) { this.activity = activity; }

    synchronized String status() {
        try { return new JSONObject().put("enabled", server != null).put("urls", urls).toString(); }
        catch (Exception error) { return "{\"enabled\":false,\"urls\":[]}"; }
    }

    synchronized String enable(boolean enabled) {
        if (!enabled) { stop(); return status(); }
        try {
            Set<String> addresses = new HashSet<>();
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (privateAddress(address.getHostAddress())) addresses.add(address.getHostAddress());
                }
            }
            if (server != null) {
                updateAddresses(addresses);
                return status();
            }
            if (addresses.isEmpty()) return "{\"error\":\"未找到局域网地址，请先连接网络\"}";
            String[] paths = { "/", "/remote.js", "/remote.css" };
            String[] files = { "index.html", "remote.js", "remote.css" };
            String[] types = { "text/html; charset=utf-8", "text/javascript; charset=utf-8", "text/css; charset=utf-8" };
            for (int index = 0; index < paths.length; index++) {
                try (InputStream stream = activity.getAssets().open("web/remote/" + files[index])) {
                    assets.put(paths[index], new ControllerHttp.Reply(200, types[index], NativeHttp.read(stream, 1024 * 1024)));
                }
            }
            byte[] secret = new byte[32];
            new SecureRandom().nextBytes(secret);
            token = LocalLibrary.hex(secret);
            ServerSocket listening = new ServerSocket(0, 16, InetAddress.getByName("0.0.0.0"));
            server = listening;
            updateAddresses(addresses);
            new Thread(() -> accept(listening), "yingji-phone-controller").start();
            return status();
        } catch (Exception error) {
            stop();
            return "{\"error\":\"无法开启手机遥控，请检查网络或端口权限\"}";
        }
    }

    private void updateAddresses(Set<String> addresses) {
        JSONArray nextUrls = new JSONArray();
        Set<String> nextHosts = new HashSet<>();
        for (String address : addresses) {
            String host = address + ":" + server.getLocalPort();
            nextHosts.add(host);
            nextUrls.put("http://" + host + "/#" + token);
        }
        nextHosts.add("127.0.0.1:" + server.getLocalPort());
        urls = nextUrls;
        hosts = nextHosts;
    }

    private void accept(ServerSocket listening) {
        while (server == listening && !listening.isClosed()) {
            try {
                Socket socket = listening.accept();
                sockets.add(socket);
                try { workers.execute(() -> serve(socket, listening)); }
                catch (RuntimeException error) { sockets.remove(socket); socket.close(); }
            } catch (Exception error) { break; }
        }
    }

    private void serve(Socket socket, ServerSocket listening) {
        try {
            ControllerHttp.Request request = ControllerHttp.read(socket);
            ControllerHttp.Reply reply;
            String host = request.headers.getOrDefault("host", "");
            String origin = request.headers.get("origin");
            String peer = socket.getInetAddress().getHostAddress();
            String secret = token;
            if (server != listening || !(peer.equals("127.0.0.1") || privateAddress(peer))
                || !hosts.contains(host) || origin != null && !origin.equals("http://" + host)
                || "cross-site".equals(request.headers.get("sec-fetch-site"))) {
                reply = ControllerHttp.json(403, "{\"error\":\"unavailable\"}");
            } else if (request.method.equals("GET") && assets.containsKey(request.path)) reply = assets.get(request.path);
            else if (secret.isEmpty() || !MessageDigest.isEqual(("Bearer " + secret).getBytes(StandardCharsets.US_ASCII),
                request.headers.getOrDefault("authorization", "").getBytes(StandardCharsets.US_ASCII))) {
                reply = ControllerHttp.json(401, "{\"error\":\"unavailable\"}");
            } else if (request.method.equals("GET") && request.path.equals("/state")) reply = ControllerHttp.json(200, "{}");
            else if (request.method.equals("POST") && request.path.equals("/command")
                && "application/json".equals(request.headers.get("content-type"))) {
                if (!permit()) reply = ControllerHttp.json(429, "{\"error\":\"busy\"}");
                else reply = dispatch(new JSONObject(new String(request.body, StandardCharsets.UTF_8)), secret);
            } else reply = ControllerHttp.json(404, "{}");
            ControllerHttp.write(socket, reply);
        } catch (Exception error) {
            try { ControllerHttp.write(socket, ControllerHttp.json(400, "{\"error\":\"failed\"}")); }
            catch (Exception ignored) { /* Closed or malformed socket. No request data is logged. */ }
        } finally {
            sockets.remove(socket);
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    private synchronized boolean permit() {
        long now = System.nanoTime();
        allowance = Math.min(30, allowance + (now - refilled) / 100000000.0);
        refilled = now;
        if (allowance < 1 || pending.size() >= 3) return false;
        allowance--;
        return true;
    }

    private ControllerHttp.Reply dispatch(JSONObject command, String secret) throws Exception {
        String kind = command.optString("kind");
        if (!(kind.equals("action") || kind.equals("search") || kind.equals("url")
            || kind.equals("snapshot") || kind.equals("catalog") || kind.equals("cover")
            || kind.equals("play") || kind.equals("related") || kind.equals("settings")
            || kind.equals("player") || kind.equals("tv-login") || kind.equals("folders")
            || kind.equals("queue-edit") || kind.equals("collection-edit"))) return ControllerHttp.json(400, "{\"error\":\"failed\"}");
        String id = UUID.randomUUID().toString();
        CompletableFuture<String> result = new CompletableFuture<>();
        synchronized (this) {
            if (!secret.equals(token) || server == null) return ControllerHttp.json(401, "{\"error\":\"unavailable\"}");
            if (!activity.controllerAvailable()) return ControllerHttp.json(200, "{\"error\":\"unavailable\"}");
            pending.put(id, result);
            activity.controllerCommand(new JSONObject().put("id", id).put("command", command).toString());
        }
        try { return ControllerHttp.json(200, result.get(kind.equals("action") ? 5 : 90, TimeUnit.SECONDS)); }
        catch (Exception error) { return ControllerHttp.json(200, "{\"error\":\"unavailable\"}"); }
        finally { pending.remove(id); }
    }

    void reply(String id, String json) {
        CompletableFuture<String> result = pending.remove(id);
        if (result != null) result.complete(json);
    }

    synchronized void stop() {
        ServerSocket listening = server;
        server = null;
        token = "";
        urls = new JSONArray();
        // Replace rather than mutate maps that an in-flight request may be reading.
        hosts = new HashSet<>();
        cancelPending();
        try { if (listening != null) listening.close(); } catch (Exception ignored) { }
        for (Socket socket : sockets) try { socket.close(); } catch (Exception ignored) { }
        sockets.clear();
    }

    void cancelPending() {
        for (CompletableFuture<String> result : pending.values()) result.complete("{\"error\":\"unavailable\"}");
        pending.clear();
    }

    void destroy() { stop(); workers.shutdownNow(); }

    private static boolean privateAddress(String value) {
        return value != null && value.matches("(?:10\\.|192\\.168\\.|172\\.(?:1[6-9]|2[0-9]|3[01])\\.).*");
    }
}
