package io.github.susuruchachi.koukainisshi;

// 再起動したとき・アプリを入れ替えたとき：アラームとウィジェットの描き直しを入れ直す（AlarmManager は再起動で消えるため）

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a) || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(a)) {
            AlarmScheduler.scheduleSaved(ctx);
            WidgetData.scheduleMidnight(ctx);
        }
    }
}
