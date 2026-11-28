package com.example.openfinds2;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** The two AI Save notifications: "still searching" and "ready". Neither carries the link or the venue. */
final class AiSaveNotifications {
    private static final String SEARCHING = "ai_save_searching";
    private static final String READY = "ai_save_ready";

    private AiSaveNotifications() {}

    static Notification searching(Context context) {
        channel(context, SEARCHING, "AI Save searching", NotificationManager.IMPORTANCE_LOW);
        return new NotificationCompat.Builder(context, SEARCHING)
                .setSmallIcon(R.drawable.ic_stat_unsaved)
                .setContentTitle("AI Save is searching")
                .setContentText("We'll tell you when it's ready.")
                .setOngoing(true)
                .build();
    }

    static void ready(Context context, int taskId, boolean found) {
        channel(context, READY, "AI Save results", NotificationManager.IMPORTANCE_HIGH);
        Intent open = new Intent(context, AiSaveReturnActivity.class);
        open.putExtra(AiSaveReturnActivity.TASK_ID, taskId);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, taskId, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(context, READY)
                .setSmallIcon(R.drawable.ic_stat_unsaved)
                .setContentTitle(found ? "Your AI Save is ready" : "No venue found")
                .setContentText(found ? "Tap to check it and save." : "Tap to search for it yourself.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build();
        try {
            NotificationManagerCompat.from(context).notify(taskId, notification);
        } catch (SecurityException ignored) {
            // Notifications were switched off during the search.
        }
    }

    private static void channel(Context context, String id, String name, int importance) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager.class)
                    .createNotificationChannel(new NotificationChannel(id, name, importance));
        }
    }
}
