package app.yingji.tv;

import java.io.InputStream;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Resume a broken response at its exact unread byte using a registered same-track mirror. */
final class ResumingMediaStream extends SizedStream {
    private final RemoteMediaConnection source;
    private final long length;
    private final long start;
    private final long total;
    private final String mime;
    private final boolean resumable;
    private long consumed;
    private boolean closed;

    ResumingMediaStream(InputStream input, long length, RemoteMediaConnection source) throws IOException {
        super(input, length);
        this.source = source;
        this.length = length;
        mime = source.connection.getContentType();
        int status = source.connection.getResponseCode();
        resumable = status == 200 || status == 206;
        long offset = 0, size = length;
        String range = source.connection.getHeaderField("Content-Range");
        if (range != null) {
            Matcher match = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)").matcher(range);
            if (!match.matches()) throw new IOException("媒体范围不正确");
            offset = Long.parseLong(match.group(1));
            size = Long.parseLong(match.group(3));
            if (Long.parseLong(match.group(2)) - offset + 1 != length) throw new IOException("媒体长度不正确");
        }
        start = offset;
        total = size;
    }

    @Override public int read() throws IOException {
        byte[] one = new byte[1];
        return read(one, 0, 1) < 0 ? -1 : one[0] & 255;
    }

    @Override public int read(byte[] bytes, int offset, int count) throws IOException {
        if (closed) throw new IOException("媒体已关闭");
        if (count == 0) return 0;
        while (true) {
            try {
                int result = super.read(bytes, offset, count);
                if (result < 0 && length >= 0 && consumed < length) throw new IOException("媒体提前结束");
                if (result > 0) consumed += result;
                return result;
            } catch (IOException failure) {
                if (!resumable || length <= 0 || consumed >= length || !source.hasBackup()) throw failure;
                try {
                    in.close();
                    long next = start + consumed, end = start + length - 1;
                    source.open("bytes=" + next + "-" + end);
                    String expected = "bytes " + next + "-" + end + "/" + total;
                    if (source.connection.getResponseCode() != 206
                        || !expected.equals(source.connection.getHeaderField("Content-Range"))
                        || source.connection.getContentLengthLong() != length - consumed
                        || mime != null && !mime.equals(source.connection.getContentType())) {
                        throw new IOException("备用媒体范围不匹配");
                    }
                    in = source.connection.getInputStream();
                } catch (Exception error) {
                    source.close();
                    throw new IOException("备用媒体读取失败", error);
                }
            }
        }
    }

    @Override public long skip(long count) throws IOException {
        byte[] bytes = new byte[8192];
        long skipped = 0;
        while (skipped < count) {
            int result = read(bytes, 0, (int) Math.min(bytes.length, count - skipped));
            if (result < 0) break;
            skipped += result;
        }
        return skipped;
    }

    @Override public void close() throws IOException {
        closed = true;
        try { super.close(); } finally { source.close(); }
    }
}
