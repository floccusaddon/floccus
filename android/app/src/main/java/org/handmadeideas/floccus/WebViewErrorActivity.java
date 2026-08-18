package org.handmadeideas.floccus;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Shown instead of the app when the system WebView is too old to run our web
 * bundle. Deliberately native: at this point the WebView cannot be relied on to
 * render anything, and the splash screen would cover an in-WebView error page.
 *
 * See MainActivity#onCreate and android.minWebViewVersion in capacitor.config.json.
 */
public class WebViewErrorActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_webview_error);

        PackageInfo webViewPackage = getCurrentWebViewPackage();

        TextView details = findViewById(R.id.webview_error_details);
        details.setText(
            getString(
                R.string.webview_error_details,
                webViewPackage != null ? webViewPackage.versionName : getString(R.string.webview_error_version_unknown)
            )
        );

        Button update = findViewById(R.id.webview_error_update);
        if (webViewPackage == null) {
            update.setVisibility(View.GONE);
        } else {
            final String packageName = webViewPackage.packageName;
            update.setOnClickListener(v -> openStorePage(packageName));
        }
    }

    private PackageInfo getCurrentWebViewPackage() {
        // Only available from API 26 on; below that we cannot tell the user which
        // WebView they are on, so we just show the generic message.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return null;
        }
        try {
            return WebView.getCurrentWebViewPackage();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Try to open the store page of the WebView implementation in use, so the
     * user has somewhere to go. Which store that is depends on the device (Play
     * Store, AppGallery, ...), hence the implicit intent and the web fallback.
     */
    private void openStorePage(String packageName) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + packageName)));
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(
                    new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + packageName))
                );
            } catch (ActivityNotFoundException ignored) {
                // Nothing we can do -- the message above still tells them what to update.
            }
        }
    }
}
