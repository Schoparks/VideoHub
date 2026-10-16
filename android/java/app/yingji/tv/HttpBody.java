package app.yingji.tv;

import java.io.InputStream;
import java.io.PushbackInputStream;
import java.util.Locale;
import java.util.zip.GZIPInputStream;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;

/** Decode HTTP transfer content before the bounded byte reader; no encoding reaches JSON/XML. */
final class HttpBody {
    static boolean compressed(String encoding) {
        return encoding != null && !encoding.isEmpty() && !encoding.equalsIgnoreCase("identity");
    }

    static InputStream decode(InputStream input, String encoding) throws Exception {
        if (!compressed(encoding)) return input;
        String kind = encoding.trim().toLowerCase(Locale.ROOT);
        if (kind.equals("gzip")) return new GZIPInputStream(input);
        if (!kind.equals("deflate")) throw new IllegalArgumentException("不支持的响应压缩格式");
        // HTTP servers use both zlib-wrapped and raw DEFLATE. Inspect only its header.
        PushbackInputStream bytes = new PushbackInputStream(input, 2);
        int first = bytes.read(), second = bytes.read();
        if (second >= 0) bytes.unread(second);
        if (first >= 0) bytes.unread(first);
        boolean zlib = first >= 0 && second >= 0 && (first & 15) == 8
            && (first >> 4) <= 7 && ((first << 8) + second) % 31 == 0;
        Inflater inflater = new Inflater(!zlib);
        return new InflaterInputStream(bytes, inflater) {
            @Override public void close() throws java.io.IOException {
                try { super.close(); } finally { inflater.end(); }
            }
        };
    }
}
