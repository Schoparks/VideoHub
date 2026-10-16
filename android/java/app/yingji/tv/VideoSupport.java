package app.yingji.tv;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.Build;
import org.json.JSONObject;
import java.util.Locale;

/** Reports decoder support for a finite codec/size/rate tuple; never opens media. */
final class VideoSupport {
    static int score(String json) {
        try {
            JSONObject input = new JSONObject(json);
            String codec = input.getString("codec");
            String mime = codec.matches("(?i)avc[13]\\.[0-9a-f]{6}") ? "video/avc"
                : codec.startsWith("hev1.") || codec.startsWith("hvc1.") ? "video/hevc"
                : codec.startsWith("av01.") ? "video/av01" : null;
            int width = input.getInt("width"), height = input.getInt("height");
            if (mime == null || width <= 0 || height <= 0 || width > 16384 || height > 16384) return 0;
            String[] fraction = input.optString("frameRate", "0").split("/", -1);
            double rate = Double.parseDouble(fraction[0]);
            if (fraction.length == 2) rate /= Double.parseDouble(fraction[1]);
            if (fraction.length > 2 || !Double.isFinite(rate) || rate < 0 || rate > 240) return 0;
            MediaFormat format = MediaFormat.createVideoFormat(mime, width, height);
            if (!mime.equals("video/avc")) {
                int profile = profile(codec, mime);
                if (profile == 0) return 0;
                format.setInteger(MediaFormat.KEY_PROFILE, profile);
            }
            if (rate > 0) format.setFloat(MediaFormat.KEY_FRAME_RATE, (float) rate);
            int result = 0;
            for (MediaCodecInfo decoder : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
                if (decoder.isEncoder()) continue;
                try {
                    MediaCodecInfo.CodecCapabilities capabilities = decoder.getCapabilitiesForType(mime);
                    if (!capabilities.isFormatSupported(format)) continue;
                    // AVC profile/level comes from the exact RFC6381 stream description.
                    if (mime.equals("video/avc") && !avcSupported(codec, capabilities.profileLevels)) continue;
                    String name = decoder.getName().toLowerCase(Locale.ROOT);
                    boolean software = Build.VERSION.SDK_INT >= 29 ? decoder.isSoftwareOnly()
                        : name.startsWith("omx.google.") || name.startsWith("c2.android.")
                            || name.contains(".sw.") || name.contains("ffmpeg");
                    result = Math.max(result, software ? 1 : 2);
                } catch (IllegalArgumentException ignored) { /* Different MIME or unsupported tuple. */ }
            }
            return result;
        } catch (Exception | LinkageError ignored) { return 0; }
    }

    private static int profile(String codec, String mime) {
        String[] fields = codec.split("\\.");
        if (mime.equals("video/hevc") && fields.length >= 4) {
            if (fields[1].equals("1")) return MediaCodecInfo.CodecProfileLevel.HEVCProfileMain;
            if (fields[1].equals("2")) return MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10;
        }
        if (mime.equals("video/av01") && fields.length >= 4 && fields[1].equals("0")) {
            if (fields[3].equals("08")) return MediaCodecInfo.CodecProfileLevel.AV1ProfileMain8;
            if (fields[3].equals("10")) return MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10;
        }
        return 0;
    }

    private static boolean avcSupported(String codec, MediaCodecInfo.CodecProfileLevel[] levels) {
        int profileId = Integer.parseInt(codec.substring(5, 7), 16);
        int levelId = Integer.parseInt(codec.substring(9, 11), 16);
        int profile = profileId == 66 ? 1 : profileId == 77 ? 2 : profileId == 88 ? 4
            : profileId == 100 ? 8 : profileId == 110 ? 16 : profileId == 122 ? 32 : profileId == 244 ? 64 : 0;
        int[] ids = { 10, 9, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62 };
        int level = 0;
        for (int i = 0; i < ids.length; i++) if (ids[i] == levelId) level = 1 << i;
        if (profile == 0 || level == 0) return false;
        for (MediaCodecInfo.CodecProfileLevel supported : levels) {
            if (supported.profile == profile && supported.level >= level) return true;
        }
        return false;
    }
}
