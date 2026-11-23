package io.github.susuruchachi.koukainisshi;

// 🔔 タスクのアラーム：ウェブ版（planner.js の alarmList）から受け取った一覧を、AlarmManager で時刻どおりに鳴らす
// ・一覧は SharedPreferences に覚えておく（再起動したら BootReceiver が入れ直す）
// ・setAlarmClock（目覚ましと同じ。省電力中でも時刻どおり）。正確なアラームが許されていない端末（Android 12 で許可を外したとき）は、だいたいの時刻で鳴らす
// ・鳴ったら AlarmReceiver が通知を出す（アラームの音・バイブ。「✅ 完了にする」「⏰ 10分後」）

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

final class AlarmScheduler {
    static final String PREFS = "koukai_alarms";
    private AlarmScheduler() {}

    static int code(String id, long at) { return (id + "@" + at).hashCode(); }

    static PendingIntent firePi(Context ctx, String id, long at, String title, String body) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(AlarmReceiver.FIRE)
            .putExtra("id", id).putExtra("at", at).putExtra("title", title).putExtra("body", body);
        return PendingIntent.getBroadcast(ctx, code(id, at), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openTasksPi(Context ctx, int req) {
        Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(ctx.getString(R.string.launchUrl) + "&view=tasks"))
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void scheduleOne(Context ctx, String id, long at, String title, String body) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = firePi(ctx, id, at, title, body);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openTasksPi(ctx, 9)), pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    // 一覧を入れかえる：前に入れたアラームを消してから、これからのものを入れる
    static void setAll(Context ctx, String json) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        try {
            JSONArray old = new JSONArray(p.getString("list", "[]"));
            for (int i = 0; i < old.length(); i++) {
                JSONObject a = old.optJSONObject(i); if (a == null || am == null) continue;
                am.cancel(firePi(ctx, a.optString("id"), a.optLong("at"), a.optString("title"), a.optString("body")));
            }
        } catch (Exception ignored) {}
        p.edit().putString("list", json == null ? "[]" : json).apply();
        scheduleSaved(ctx);
    }

    // 覚えている一覧のうち、これから鳴るものを入れる（再起動のあと・アプリを入れ替えたあとも）
    static void scheduleSaved(Context ctx) {
        long now = System.currentTimeMillis();
        Set<String> seen = new HashSet<>();
        try {
            JSONArray list = new JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("list", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i); if (a == null) continue;
                long at = a.optLong("at"); String id = a.optString("id");
                if (at < now - 60000 || id.isEmpty() || !seen.add(id + "@" + at)) continue;
                scheduleOne(ctx, id, Math.max(at, now + 1000), a.optString("title"), a.optString("body"));
            }
        } catch (Exception ignored) {}
    }

    // 通知の「✅ 完了にする」：アプリを開いたときにウェブ版が受け取る（takeDoneTasks）
    static void queueDone(Context ctx, String id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray q = new JSONArray(p.getString("done", "[]"));
            q.put(id);
            p.edit().putString("done", q.toString()).apply();
        } catch (Exception ignored) {}
    }
    static String takeDone(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String v = p.getString("done", "[]");
        p.edit().putString("done", "[]").apply();
        return v;
    }
}
