package io.github.susuruchachi.koukainisshi;

// 🔔 アラームが鳴ったとき：通知を出す（アラームの音・バイブ・ロック画面にも）。
// 「✅ 完了にする」：そのタスクを完了の待ち行列に入れる（アプリを開いたときに完了になる）。「⏰ 10分後」：10分後にもう一度鳴らす

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

public class AlarmReceiver extends BroadcastReceiver {
    static final String FIRE = "io.github.susuruchachi.koukainisshi.ALARM_FIRE";
    static final String DONE = "io.github.susuruchachi.koukainisshi.ALARM_DONE";
    static final String SNOOZE = "io.github.susuruchachi.koukainisshi.ALARM_SNOOZE";
    static final String CHANNEL = "koukai_alarm";

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "タスクのアラーム", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("タスクの期限に鳴らすアラーム");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        ch.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 600, 300, 600, 300, 600 });
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private static PendingIntent action(Context ctx, String act, Intent src, int req) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(act).putExtras(src);
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String act = intent.getAction(), id = intent.getStringExtra("id");
        if (id == null) return;
        int nid = id.hashCode();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (DONE.equals(act)) {
            AlarmScheduler.queueDone(ctx, id);
            if (nm != null) nm.cancel(nid);
            return;
        }
        if (SNOOZE.equals(act)) {
            if (nm != null) nm.cancel(nid);
            AlarmScheduler.scheduleOne(ctx, id + "~snooze", System.currentTimeMillis() + 10 * 60000L, intent.getStringExtra("title"), intent.getStringExtra("body"));
            return;
        }
        if (!FIRE.equals(act) || nm == null) return;
        ensureChannel(ctx);
        String taskId = id.endsWith("~snooze") ? id.substring(0, id.length() - 7) : id;
        Intent extras = new Intent().putExtra("id", taskId).putExtra("title", intent.getStringExtra("title")).putExtra("body", intent.getStringExtra("body"));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(intent.getStringExtra("title"))
            .setContentText(intent.getStringExtra("body"))
            .setCategory(Notification.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(AlarmScheduler.openTasksPi(ctx, nid))
            .addAction(new Notification.Action.Builder(null, "✅ 完了にする", action(ctx, DONE, extras, nid + 1)).build())
            .addAction(new Notification.Action.Builder(null, "⏰ 10分後", action(ctx, SNOOZE, extras, nid + 2)).build());
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_VIBRATE)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
        }
        try { nm.notify(taskId.hashCode(), b.build()); } catch (SecurityException ignored) { /* 通知の許可が無い */ }
    }
}
