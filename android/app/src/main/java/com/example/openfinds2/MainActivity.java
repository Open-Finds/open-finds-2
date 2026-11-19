package com.example.openfinds2;

import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle state) {
        registerPlugin(UnsavedSharePlugin.class);
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // Keep device password-manager suggestions out of the staging WebView.
            getBridge().getWebView().setImportantForAutofill(
                    View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
    }
}
