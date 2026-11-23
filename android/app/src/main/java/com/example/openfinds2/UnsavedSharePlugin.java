package com.example.openfinds2;

import android.content.Intent;
import java.util.concurrent.atomic.AtomicReference;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UnsavedShare")
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
                result.put("checkpoint", activity.getCheckpoint());
            }
            call.resolve(result);
        });
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
