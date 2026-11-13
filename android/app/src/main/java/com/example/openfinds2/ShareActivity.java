package com.example.openfinds2;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import java.util.Objects;
import java.util.UUID;

public class ShareActivity extends MainActivity {
    private String shareId;
    private String sharedText;
    private String checkpoint;

    @Override
    protected void onCreate(Bundle state) {
        if (state == null || state.getString("shareId") == null) {
            readShare(getIntent());
        } else {
            shareId = state.getString("shareId");
            sharedText = state.getString("sharedText");
            checkpoint = state.getString("checkpoint");
        }
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finish();
            }
        });
    }

    @Override
    protected void load() {
        super.load();
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        findViewById(android.R.id.content).setBackgroundColor(Color.TRANSPARENT);
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Capacitor also delivers the original intent once during bridge startup.
        if (intent != getIntent()) {
            readShare(intent);
            setIntent(intent);
        }
        super.onNewIntent(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("shareId", shareId);
        state.putString("sharedText", sharedText);
        state.putString("checkpoint", checkpoint);
    }

    private void readShare(Intent intent) {
        String nextText = null;
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())
                && "text/plain".equals(intent.getType())) {
            try {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null && text.length() <= 10000) nextText = text.toString();
            } catch (RuntimeException ignored) {
                // The share sheet can receive malformed extras from another app.
            }
        }
        if (shareId != null && Objects.equals(sharedText, nextText)) return;
        shareId = UUID.randomUUID().toString();
        checkpoint = null;
        sharedText = nextText;
    }

    String getShareId() { return shareId; }
    String getSharedText() { return sharedText; }
    String getCheckpoint() { return checkpoint; }
    void setCheckpoint(String value) { checkpoint = value; }
}
