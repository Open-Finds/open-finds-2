package com.example.openfinds2;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

/** Brings a share screen back to the front. If Android has since closed it, opens the app instead. */
public class AiSaveReturnActivity extends Activity {
    static final String TASK_ID = "taskId";

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        int wanted = getIntent().getIntExtra(TASK_ID, -1);
        boolean shown = false;
        for (ActivityManager.AppTask task : getSystemService(ActivityManager.class).getAppTasks()) {
            try {
                ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                int id = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? info.taskId : info.id;
                if (id == wanted) {
                    task.moveToFront();
                    shown = true;
                    break;
                }
            } catch (IllegalArgumentException ignored) {
                // The task closed while we were looking.
            }
        }
        if (!shown) {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        finish();
    }
}
