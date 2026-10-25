package app.yingji.tv;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** One bounded HTTP request per socket; no proxying, upgrades, chunking or file paths. */
final class ControllerHttp {
    static final class Request {
        String method;
        String path;
        final Map<String, String> headers = new HashMap<>();
        byte[] body;
    }
    static final class Reply {
        final int status;
        final String mime;
        final byte[] body;
        Reply(int status, String mime, byte[] body) { this.status = status; this.mime = mime; this.body = body; }
    }

    static Request read(Socket socket) throws Exception {
        socket.setSoTimeout(5000);
        InputStream input = socket.getInputStream();
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int matched = 0;
        byte[] ending = { 13, 10, 13, 10 };
        long deadline = System.nanoTime() + 5000000000L;
        while (matched < 4) {
            int value = input.read();
            if (value < 0) throw new EOFException();
            header.write(value);
            if (header.size() > 8192 || System.nanoTime() > deadline) throw new IllegalArgumentException();
            matched = value == ending[matched] ? matched + 1 : value == 13 ? 1 : 0;
        }
        String[] lines = new String(header.toByteArray(), StandardCharsets.US_ASCII).split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length != 3 || !first[2].equals("HTTP/1.1")) throw new IllegalArgumentException();
        Request request = new Request();
        request.method = first[0];
        request.path = first[1];
        for (int index = 1; index < lines.length; index++) {
            int colon = lines[index].indexOf(':');
            if (colon < 1) throw new IllegalArgumentException();
            String name = lines[index].substring(0, colon).toLowerCase(Locale.ROOT);
            if (!name.matches("[a-z0-9-]+") || request.headers.containsKey(name)) throw new IllegalArgumentException();
            request.headers.put(name, lines[index].substring(colon + 1).trim());
        }
        if (request.headers.containsKey("transfer-encoding") || request.headers.containsKey("expect")) throw new IllegalArgumentException();
        String length = request.headers.getOrDefault("content-length", "0");
        if (!length.matches("[0-9]{1,5}")) throw new IllegalArgumentException();
        int size = Integer.parseInt(length);
        if (size > 32768) throw new IllegalArgumentException();
        request.body = new byte[size];
        int offset = 0;
        while (offset < size) {
            int count = input.read(request.body, offset, size - offset);
            if (count < 0) throw new EOFException();
            offset += count;
            if (System.nanoTime() > deadline) throw new IllegalArgumentException();
        }
        return request;
    }

    static Reply json(int status, String json) {
        return new Reply(status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    static void write(Socket socket, Reply reply) throws Exception {
        OutputStream output = socket.getOutputStream();
        String headers = "HTTP/1.1 " + reply.status + " Response\r\nContent-Type: " + reply.mime
            + "\r\nContent-Length: " + reply.body.length + "\r\nConnection: close\r\nCache-Control: no-store"
            + "\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff"
            + "\r\nContent-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self';"
            + " frame-ancestors 'none'; base-uri 'none'; form-action 'self'\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        output.write(reply.body);
        output.flush();
    }
}
