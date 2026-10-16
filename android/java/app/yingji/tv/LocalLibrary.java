package app.yingji.tv;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;

/** Android SAF grants replace desktop filesystem paths; canceled selection is explicit. */
final class LocalLibrary {
    private final MainActivity activity;
    private final ExecutorService executor;
    private String pending;
    private boolean directory;
    static final int PICK = 100;

    LocalLibrary(MainActivity activity, ExecutorService executor) { this.activity = activity; this.executor = executor; }

    void select(String id, boolean tree) {
        activity.runOnUiThread(() -> {
            if (pending != null) { activity.nativeReply(id, null, "片库操作尚未结束"); return; }
            pending = id;
            directory = tree;
            Intent intent = new Intent(tree ? Intent.ACTION_OPEN_DOCUMENT_TREE : Intent.ACTION_OPEN_DOCUMENT);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            if (!tree) {
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("video/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try { activity.startActivityForResult(intent, PICK); }
            catch (Exception error) { pending = null; activity.nativeReply(id, null, "此电视没有文件选择器，请安装支持文档选择的文件管理器"); }
        });
    }

    void result(int code, Intent intent) {
        String id = pending;
        pending = null;
        if (id == null) return;
        if (code != Activity.RESULT_OK || intent == null) {
            activity.nativeReply(id, json(() -> new JSONObject().put("canceled", true)), null);
            return;
        }
        boolean tree = directory;
        executor.execute(() -> {
            try {
                JSONArray roots = new JSONArray();
                ClipData clips = intent.getClipData();
                int count = clips == null ? 1 : clips.getItemCount();
                for (int index = 0; index < count; index++) {
                    Uri uri = clips == null ? intent.getData() : clips.getItemAt(index).getUri();
                    if (uri == null) continue;
                    activity.getContentResolver().takePersistableUriPermission(uri,
                        intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    roots.put(uri.toString());
                }
                JSONArray items = scan(roots, tree);
                activity.nativeReply(id, new JSONObject().put("canceled", false).put("roots", roots).put("items", items), null);
            } catch (Exception error) { activity.nativeReply(id, null, "文件不可读取，请重新选择或检查存储设备"); }
        });
    }

    JSONArray scan(JSONArray roots, boolean trees) throws Exception {
        JSONArray items = new JSONArray();
        for (int index = 0; index < roots.length(); index++) {
            Uri root = Uri.parse(roots.getString(index));
            if (DocumentsContract.isTreeUri(root)) {
                walk(root, DocumentsContract.getTreeDocumentId(root), items, 0);
            } else document(root, items);
        }
        return items;
    }

    private void walk(Uri root, String parent, JSONArray items, int depth) throws Exception {
        if (depth > 16 || items.length() >= 20000) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(root, parent);
        String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE };
        try (Cursor cursor = activity.getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("无法读取目录");
            while (cursor.moveToNext() && items.length() < 20000) {
                String id = cursor.getString(0);
                Uri child = DocumentsContract.buildDocumentUriUsingTree(root, id);
                try {
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(1))) walk(root, id, items, depth + 1);
                    else document(child, items);
                } catch (Exception ignored) { /* Preserve readable siblings; root failures propagate. */ }
            }
        }
    }

    private void document(Uri uri, JSONArray items) throws Exception {
        try (Cursor cursor = activity.getContentResolver().query(uri,
            new String[] { "_display_name", "mime_type" }, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IllegalStateException("无法读取文件");
            String title = cursor.getString(0);
            String mime = cursor.getString(1);
            if ((mime == null || !mime.startsWith("video/")) && !title.toLowerCase(Locale.ROOT)
                .matches(".*\\.(mp4|m4v|mkv|webm|mov|avi|mpg|mpeg|ts|m2ts|flv|ogv|mp3|flac|m4a)$")) return;
            String key = hex(MessageDigest.getInstance("SHA-256").digest(uri.toString().getBytes("UTF-8"))).substring(0, 24);
            items.put(new JSONObject().put("id", "local:" + key).put("source", "local").put("kind", "video")
                .put("title", title.replaceFirst("\\.[^.]+$", "")).put("author", "本地视频")
                .put("path", uri.toString()).put("addedAt", System.currentTimeMillis()));
        }
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    interface JsonFactory { JSONObject create() throws Exception; }
    private JSONObject json(JsonFactory factory) { try { return factory.create(); } catch (Exception error) { throw new IllegalStateException(error); } }
}
