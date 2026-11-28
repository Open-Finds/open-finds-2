package com.example.openfinds2;

import android.content.Intent;
import android.net.Uri;
import android.os.Parcelable;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.PluginHandle;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public class ShareActivity extends MainActivity {
    private String shareId;
    private String sharedText;
    /** Screenshots shared to the app (at most MAX_IMAGES), as content links Android lets this screen read. */
    private ArrayList<String> imageUris = new ArrayList<>();
    private String checkpoint;
    static final int MAX_IMAGES = 6;
    private boolean working;

    @Override
    protected void onCreate(Bundle state) {
        if (state == null || state.getString("shareId") == null) {
            readShare(getIntent());
        } else {
            shareId = state.getString("shareId");
            sharedText = state.getString("sharedText");
            checkpoint = state.getString("checkpoint");
            ArrayList<String> saved = state.getStringArrayList("imageUris");
            if (saved != null) imageUris = saved;
        }
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                PluginHandle share = working ? getBridge().getPlugin("UnsavedShare") : null;
                if (share != null) ((UnsavedSharePlugin) share.getInstance()).requestClose();
                else finish();
            }
        });
    }

    @Override
    public void onDestroy() {
        if (isFinishing()) AiSaveService.stop(this, shareId);
        super.onDestroy();
    }

    void setWorking(boolean value) { working = value; }

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
    public void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("shareId", shareId);
        state.putString("sharedText", sharedText);
        state.putString("checkpoint", checkpoint);
        state.putStringArrayList("imageUris", imageUris);
    }

    private void readShare(Intent intent) {
        String nextText = null;
        ArrayList<String> nextImages = new ArrayList<>();
        String action = intent == null ? null : intent.getAction();
        String type = intent == null ? null : intent.getType();
        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(type)) {
            try {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null && text.length() <= 10000) nextText = text.toString();
            } catch (RuntimeException ignored) {
                // The share sheet can receive malformed extras from another app.
            }
        } else if (type != null && type.startsWith("image/")
                && (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action))) {
            nextImages = sharedImages(intent, action);
        }
        if (shareId != null && Objects.equals(sharedText, nextText) && imageUris.equals(nextImages)) return;
        shareId = UUID.randomUUID().toString();
        checkpoint = null;
        sharedText = nextText;
        imageUris = nextImages;
    }

    /** The shared pictures' content links: only content:// ones (never a file path), at most MAX_IMAGES. */
    @SuppressWarnings("deprecation")
    private static ArrayList<String> sharedImages(Intent intent, String action) {
        ArrayList<String> uris = new ArrayList<>();
        try {
            List<? extends Parcelable> items;
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                items = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            } else {
                Parcelable one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                items = one == null ? null : Collections.singletonList(one);
            }
            if (items == null) return uris;
            for (Parcelable item : items) {
                if (item instanceof Uri uri && "content".equals(uri.getScheme()) && uris.size() < MAX_IMAGES) uris.add(uri.toString());
            }
        } catch (RuntimeException ignored) {
            // Malformed extras from another app: treated as no pictures.
        }
        return uris;
    }

    String getShareId() { return shareId; }
    String getSharedText() { return sharedText; }
    List<String> getImageUris() { return imageUris; }
    String getCheckpoint() { return checkpoint; }
    void setCheckpoint(String value) { checkpoint = value; }
}
