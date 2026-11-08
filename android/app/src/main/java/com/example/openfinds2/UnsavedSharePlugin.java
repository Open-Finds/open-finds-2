package com.example.openfinds2;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UnsavedShare")
public class UnsavedSharePlugin extends Plugin {
    private String pending;

    @Override
    public void load() {
        receive(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (receive(intent)) notifyListeners("incoming", new JSObject());
    }

    private synchronized boolean receive(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())
            || !"text/plain".equals(intent.getType())) return false;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null || text.length() > 10000) return false;
        pending = text.toString();
        intent.removeExtra(Intent.EXTRA_TEXT);
        return true;
    }

    @PluginMethod
    public synchronized void take(PluginCall call) {
        JSObject result = new JSObject();
        if (pending != null) result.put("text", pending);
        pending = null;
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
