package org.handmadeideas.floccus;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.ValueCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Our bundle needs a WebView that can at least parse ES2020 (see
        // android.minWebViewVersion in capacitor.config.json). On an older one it
        // throws a SyntaxError before anything runs -- including the code that
        // hides the splash screen -- so the app would sit on the splash forever.
        // Capacitor only logs this to Logcat and keeps loading the app anyway,
        // and the page behind server.errorPath gets no bridge injected, so it
        // could not hide the splash either. Bail out to a native screen instead.
        if (bridge != null && !bridge.isMinimumWebViewInstalled()) {
            startActivity(new Intent(this, WebViewErrorActivity.class));
            finish();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        this.handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        String action = intent.getAction();
        String type = intent.getType();
        if (Intent.ACTION_SEND.equals(action) && type != null) {
            bridge.getActivity().setIntent(intent);
            bridge.eval("window.dispatchEvent(new Event('sendIntentReceived'))", s -> {
                // no op
            });
        }
    }
}
