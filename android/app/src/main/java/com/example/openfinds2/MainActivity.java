package com.example.openfinds2;

import com.getcapacitor.BridgeActivity;

import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle state) {
        registerPlugin(UnsavedSharePlugin.class);
        super.onCreate(state);
    }
}
