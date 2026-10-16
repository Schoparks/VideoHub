package app.yingji.tv;

import java.net.ConnectException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import javax.net.ssl.SSLException;

/** Classify transport failures without sending exception messages or addresses to the UI. */
final class HttpFailure {
    static String kind(Throwable error) {
        boolean socketFailure = false;
        for (int depth = 0; error != null && depth < 8; depth++, error = error.getCause()) {
            if (error instanceof UnknownHostException) return "dns";
            if (error instanceof SSLException) return "tls";
            if (error instanceof SocketTimeoutException) return "timeout";
            if (error instanceof ConnectException || error instanceof SocketException) socketFailure = true;
        }
        return socketFailure ? "offline" : null;
    }
}
