package io.github.susuruchachi.koukainisshi;

// ウィジェットのデータ：ウェブ版（app-bridge.js の koukaiBuildWidgetData）が KoukaiApp.setWidgetData で渡す
//   { today, days: { 'YYYY-MM-DD': [{ s: 開始, e: 終了, n: 名前, i: 印 }] }, diary: { 'YYYY-MM-DD': { items: [3つ], anki } }, at }
// 日付が変わったら、アプリを開かなくても「今日」をここで数え直す（夜中の0時すぎにアラームで描き直す）

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

final class WidgetData {
    static final String PREFS = "koukai_widget";
    static final String TICK = "io.github.susuruchachi.koukainisshi.TICK";
    static final String[] DOW = { "日", "月", "火", "水", "木", "金", "土" };

    private WidgetData() {}

    static JSONObject load(Context ctx) {
        try { return new JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", "{}")); }
        catch (Exception e) { return new JSONObject(); }
    }

    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json == null ? "{}" : json).apply();
        refreshAll(ctx);
    }

    static void refreshAll(Context ctx) {
        CalendarWidget.updateAll(ctx);
        DiaryWidget.updateAll(ctx);
        scheduleMidnight(ctx);
    }

    static String key(Calendar c) { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime()); }

    static String day(int offset) {
        Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, offset);
        return key(c);
    }

    static String md(Calendar c) {
        return (c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH) + "(" + DOW[c.get(Calendar.DAY_OF_WEEK) - 1] + ")";
    }

    // その日の予定（無ければ空）
    static JSONArray eventsOn(JSONObject data, String k) {
        JSONObject days = data.optJSONObject("days");
        JSONArray a = days == null ? null : days.optJSONArray(k);
        return a == null ? new JSONArray() : a;
    }

    // その日の日記（無ければ null）
    static JSONObject diaryOn(JSONObject data, String k) {
        JSONObject d = data.optJSONObject("diary");
        return d == null ? null : d.optJSONObject(k);
    }

    // 書いたできた事の数（0〜3）
    static int doneCount(JSONObject e) {
        if (e == null) return 0;
        JSONArray items = e.optJSONArray("items");
        if (items == null) return 0;
        int n = 0;
        for (int i = 0; i < items.length(); i++) if (!items.optString(i, "").trim().isEmpty()) n++;
        return n;
    }

    // 続けて書いた日数：今日書いていれば今日から、まだなら昨日からさかのぼる（diary.js の diaryStreak と同じ）
    static int streak(JSONObject data) {
        Calendar c = Calendar.getInstance();
        if (doneCount(diaryOn(data, key(c))) == 0) c.add(Calendar.DAY_OF_MONTH, -1);
        int n = 0;
        while (n < 3650 && doneCount(diaryOn(data, key(c))) > 0) { n++; c.add(Calendar.DAY_OF_MONTH, -1); }
        return n;
    }

    // アプリを開く（query は "view=diary" など。ウェブ版の __koukaiOpen が受け取る）
    static PendingIntent openApp(Context ctx, String query, int requestCode) {
        String url = ctx.getString(R.string.launchUrl) + (query == null || query.isEmpty() ? "" : "&" + query);
        Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(url));
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // 夜中の0時すぎに描き直す（日付が変わったら、今日の印・今日の日記を新しい日にする）
    static void scheduleMidnight(Context ctx) {
        try {
            Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, 1);
            c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 30); c.set(Calendar.MILLISECOND, 0);
            Intent i = new Intent(ctx, CalendarWidget.class).setAction(TICK);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.set(AlarmManager.RTC, c.getTimeInMillis(), pi);
        } catch (Exception e) { /* 描き直しは 30分ごとにも来るので、ここで失敗しても困らない */ }
    }
}
