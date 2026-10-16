package app.yingji.tv;

import java.io.FilterInputStream;
import java.io.InputStream;
import java.io.IOException;

/** Limit local document reads to the requested HTTP byte range. */
final class RangeStream extends FilterInputStream {
    private long remaining;
    RangeStream(InputStream input, long start, long length) throws IOException {
        super(input);
        remaining = length;
        long skipped = 0;
        while (skipped < start) {
            long amount = input.skip(start - skipped);
            if (amount == 0) {
                if (input.read() == -1) throw new IOException("无法定位文件");
                amount = 1;
            }
            skipped += amount;
        }
    }
    @Override public int read() throws IOException {
        if (remaining <= 0) return -1;
        int result = super.read();
        if (result >= 0) remaining--;
        return result;
    }
    @Override public int read(byte[] bytes, int offset, int length) throws IOException {
        if (remaining <= 0) return -1;
        int result = super.read(bytes, offset, (int) Math.min(length, remaining));
        if (result > 0) remaining -= result;
        return result;
    }
}
