package com.example.openfinds2;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import android.os.Build;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "UnsavedShare", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class UnsavedSharePlugin extends Plugin {
    private static final String PLAN_ACTION = "com.example.openfinds2.OPEN_SHARED_PLAN";
    private static final AtomicReference<String> pendingPlan = new AtomicReference<>();

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (getActivity() instanceof ShareActivity) {
            notifyListeners("incoming", new JSObject());
        } else if (intent != null && PLAN_ACTION.equals(intent.getAction())) {
            notifyListeners("plan", new JSObject());
        }
    }

    @PluginMethod
    public void getShare(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            if (getActivity() instanceof ShareActivity activity) {
                result.put("id", activity.getShareId());
                result.put("text", activity.getSharedText());
                result.put("images", activity.getImageUris().size());
                result.put("checkpoint", activity.getCheckpoint());
            }
            call.resolve(result);
        });
    }

    /** Longest side of a screenshot sent to the AI: small enough to send quickly, big enough to read a caption. */
    private static final int MAX_SIDE = 1600;

    /**
     * The shared screenshots, shrunk and re-encoded as JPEG (which also drops the photo's hidden details such as GPS),
     * as data links the AI can read. Read off the main thread; pictures that cannot be opened are skipped.
     */
    @PluginMethod
    public void getImages(PluginCall call) {
        if (!(getActivity() instanceof ShareActivity activity) || !activity.getShareId().equals(call.getString("id"))) {
            call.reject("No shared pictures");
            return;
        }
        List<String> uris = new ArrayList<>(activity.getImageUris());
        ContentResolver resolver = activity.getContentResolver();
        new Thread(() -> {
            JSArray images = new JSArray();
            for (String uri : uris) {
                String image = shrink(resolver, Uri.parse(uri));
                if (image != null) images.put(image);
            }
            JSObject result = new JSObject();
            result.put("images", images);
            call.resolve(result);
        }, "unsaved-share-images").start();
    }

    private static String shrink(ContentResolver resolver, Uri uri) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) return null;
                BitmapFactory.decodeStream(in, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            BitmapFactory.Options options = new BitmapFactory.Options();
            int sample = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2;
            options.inSampleSize = sample;
            Bitmap bitmap;
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) return null;
                bitmap = BitmapFactory.decodeStream(in, null, options);
            }
            if (bitmap == null) return null;
            float scale = Math.min(1f, (float) MAX_SIDE / Math.max(bitmap.getWidth(), bitmap.getHeight()));
            if (scale < 1f) {
                Bitmap scaled = Bitmap.createScaledBitmap(bitmap,
                        Math.max(1, Math.round(bitmap.getWidth() * scale)), Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
                if (scaled != bitmap) bitmap.recycle();
                bitmap = scaled;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 72, out);
            bitmap.recycle();
            String data = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            return data.length() <= 1_400_000 ? data : null;
        } catch (Exception | OutOfMemoryError ignored) {
            return null;
        }
    }

    @PluginMethod
    public void remember(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String value = call.getString("value");
            if (getActivity() instanceof ShareActivity activity
                    && activity.getShareId().equals(call.getString("id"))
                    && value != null && value.length() <= 32000) {
                activity.setCheckpoint(value);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void dismiss(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getActivity() instanceof ShareActivity activity
                    && activity.getShareId().equals(call.getString("id"))) activity.finish();
            call.resolve();
        });
    }

    @PluginMethod
    public void working(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getActivity() instanceof ShareActivity activity
                    && activity.getShareId().equals(call.getString("id"))) {
                activity.setWorking(Boolean.TRUE.equals(call.getBoolean("working", false)));
            }
            call.resolve();
        });
    }

    /**
     * Puts the share screen behind the other app while the search carries on. Notifications are asked for so the phone can say
     * when it is done; without them the result still waits in the app's Notifications.
     */
    @PluginMethod
    public void background(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsAnswered");
            return;
        }
        moveBehind(call);
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        moveBehind(call);
    }

    private void moveBehind(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean moved = false;
            if (getActivity() instanceof ShareActivity activity
                    && !activity.isFinishing()
                    && activity.getShareId().equals(call.getString("id"))) {
                try {
                    AiSaveService.start(activity, activity.getShareId());
                    moved = activity.moveTaskToBack(true);
                } catch (RuntimeException ignored) {
                    // Android refused: the screen stays open.
                }
                if (moved) {
                    Toast.makeText(activity.getApplicationContext(), "AI Save is searching. We'll tell you when it's ready.",
                            Toast.LENGTH_SHORT).show();
                } else {
                    AiSaveService.stop(activity, activity.getShareId());
                }
            }
            JSObject result = new JSObject();
            result.put("moved", moved);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void ready(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getActivity() instanceof ShareActivity activity
                    && activity.getShareId().equals(call.getString("id"))) {
                AiSaveNotifications.ready(activity, activity.getTaskId(), Boolean.TRUE.equals(call.getBoolean("found", false)));
                AiSaveService.stop(activity, activity.getShareId());
            }
            call.resolve();
        });
    }

    /** The back button, passed to the web screen. */
    void requestClose() {
        notifyListeners("close", new JSObject());
    }

    @PluginMethod
    public void openPlan(PluginCall call) {
        String value = call.getString("value");
        getActivity().runOnUiThread(() -> {
            if (!(getActivity() instanceof ShareActivity activity)
                    || activity.isFinishing()
                    || !activity.getShareId().equals(call.getString("id"))
                    || value == null || value.length() > 12000) {
                call.reject("Cannot open this itinerary");
                return;
            }
            pendingPlan.set(value);
            try {
                Intent intent = new Intent(activity, MainActivity.class);
                intent.setAction(PLAN_ACTION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                activity.finish();
                call.resolve();
            } catch (RuntimeException error) {
                pendingPlan.compareAndSet(value, null);
                call.reject("Cannot open this itinerary", error);
            }
        });
    }

    @PluginMethod
    public void takePlan(PluginCall call) {
        JSObject result = new JSObject();
        if (!(getActivity() instanceof ShareActivity)) {
            result.put("value", pendingPlan.getAndSet(null));
        }
        call.resolve(result);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("A recommendation is required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("text/plain");
                share.putExtra(Intent.EXTRA_TEXT, text);
                getActivity().startActivity(Intent.createChooser(share, null));
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Could not open Android sharing", error);
            }
        });
    }
}
