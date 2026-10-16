package app.yingji.tv;

import java.io.FilterInputStream;
import java.io.InputStream;
import java.io.IOException;

/** The old WebView obtains response size from available(), even for remote streams. */
class SizedStream extends FilterInputStream {
    private long remaining;
    SizedStream(InputStream input, long length) { super(input); remaining = length; }
    @Override public int available() throws IOException {
        return remaining >= 0 ? (int) Math.min(remaining, Integer.MAX_VALUE) : super.available();
    }
    @Override public int read() throws IOException {
        if (remaining == 0) return -1;
        int value = in.read();
        if (value >= 0 && remaining > 0) remaining--;
        return value;
    }
    @Override public int read(byte[] bytes, int offset, int length) throws IOException {
        if (length == 0) return 0;
        if (remaining == 0) return -1;
        int count = in.read(bytes, offset, remaining < 0 ? length : (int) Math.min(length, remaining));
        if (count > 0 && remaining > 0) remaining -= count;
        return count;
    }
}
