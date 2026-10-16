package app.yingji.tv;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native diagnostics remain usable when no WebView can start. Never display raw exception data. */
final class StartupFailure {
    private StartupFailure() {}

    static void show(Activity activity, PackageInfo webview, String reason) {
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(48, 32, 48, 32);
        root.setBackgroundColor(Color.rgb(22, 25, 31));
        root.addView(text(activity, "无法启动映集", 28));
        root.addView(text(activity, reason, 21));
        String version = webview == null ? "未检测到可用组件" : webview.versionName;
        root.addView(text(activity, "设备：" + Build.MODEL + "\nAndroid：" + Build.VERSION.RELEASE
            + "（API " + Build.VERSION.SDK_INT + "）\nWebView：" + version, 20));
        LinearLayout actions = new LinearLayout(activity);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button retry = button(activity, "重试", view -> activity.recreate());
        actions.addView(retry);
        Button leave = button(activity, "退出", view -> activity.finish());
        LinearLayout.LayoutParams spacing = new LinearLayout.LayoutParams(-2, -2);
        spacing.leftMargin = 24;
        actions.addView(leave, spacing);
        root.addView(actions);
        activity.setContentView(root);
        retry.requestFocus();
    }

    private static TextView text(Activity activity, String value, int size) {
        TextView text = new TextView(activity);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(Color.rgb(235, 237, 241));
        text.setPadding(0, 0, 0, 22);
        text.setFocusable(false);
        return text;
    }

    private static Button button(Activity activity, String label, View.OnClickListener action) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextSize(20);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setPadding(30, 12, 30, 12);
        button.setFocusable(true);
        button.setOnClickListener(action);
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[] { android.R.attr.state_focused }, background(true));
        background.addState(new int[] {}, background(false));
        button.setBackground(background);
        return button;
    }

    private static GradientDrawable background(boolean focused) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(Color.rgb(39, 43, 51));
        shape.setCornerRadius(18);
        shape.setStroke(2, focused ? Color.WHITE : Color.rgb(68, 73, 83));
        return shape;
    }
}
