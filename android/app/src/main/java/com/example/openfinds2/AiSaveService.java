package com.example.openfinds2;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.content.ContextCompat;
import java.util.HashSet;
import java.util.Set;

/**
 * Stops Android pausing the app while a search runs behind another app. It does no work of its own.
 * A "short service": Android allows it about three minutes. All calls are on the main thread.
 */
public class AiSaveService extends Service {
    private static final int NOTIFICATION_ID = 1;
    private static final Set<String> searches = new HashSet<>();
    private static boolean foreground;

    static void start(Context context, String shareId) {
        searches.add(shareId);
        ContextCompat.startForegroundService(context, new Intent(context, AiSaveService.class));
    }

    static void stop(Context context, String shareId) {
        // Before the service is in the foreground it must not be stopped from outside; onStartCommand stops it.
        if (searches.remove(shareId) && searches.isEmpty() && foreground) {
            context.stopService(new Intent(context, AiSaveService.class));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, AiSaveNotifications.searching(this),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        } else {
            startForeground(NOTIFICATION_ID, AiSaveNotifications.searching(this));
        }
        foreground = true;
        if (searches.isEmpty()) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        foreground = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
