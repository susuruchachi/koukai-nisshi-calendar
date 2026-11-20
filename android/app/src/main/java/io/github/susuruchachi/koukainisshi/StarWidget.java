package io.github.susuruchachi.koukainisshi;

// ★ 大事な予定のウィジェット：★を付けた予定の、いちばん近い回と「あと何日」（今日・明日・期間中）
// データはウェブ版（stars.js の starInstances）が、1つの予定につき3回ぶんまで渡す（stars: [{ k, n, i, d, e2, s }]）。
// 日付が変わったら、ここで「今日」を数え直し、終わった回をとばして次の回を出す（夜中の0時すぎに描き直す）

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class StarWidget extends AppWidgetProvider {
    private static final int[] ROWS = { R.id.s_row0, R.id.s_row1, R.id.s_row2, R.id.s_row3, R.id.s_row4, R.id.s_row5 };
    private static final int[] DATES = { R.id.s_date0, R.id.s_date1, R.id.s_date2, R.id.s_date3, R.id.s_date4, R.id.s_date5 };
    private static final int[] NAMES = { R.id.s_name0, R.id.s_name1, R.id.s_name2, R.id.s_name3, R.id.s_name4, R.id.s_name5 };
    private static final int[] LEFTS = { R.id.s_left0, R.id.s_left1, R.id.s_left2, R.id.s_left3, R.id.s_left4, R.id.s_left5 };
    private static final String[] DOW = { "日", "月", "火", "水", "木", "金", "土" };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
        WidgetData.scheduleMidnight(ctx);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, StarWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static Date parse(String ds) { try { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(ds); } catch (Exception e) { return null; } }
    static long daysBetween(String a, String b) {
        Date x = parse(a), y = parse(b); if (x == null || y == null) return 0;
        return Math.round((y.getTime() - x.getTime()) / 86400000.0);
    }
    static String md(String ds) {
        Date d = parse(ds); if (d == null) return ds;
        Calendar c = Calendar.getInstance(); c.setTime(d);
        return (c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH) + "(" + DOW[c.get(Calendar.DAY_OF_WEEK) - 1] + ")";
    }
    // 「あと何日」（stars.js の starLeftText と同じ）
    static String leftText(JSONObject x, String today) {
        String d = x.optString("d"), e2 = x.optString("e2", "");
        if (d.compareTo(today) <= 0 && !e2.isEmpty() && e2.compareTo(today) >= 0) return d.equals(today) ? "今日から" : "期間中";
        long n = daysBetween(today, d);
        return n <= 0 ? "今日" : n == 1 ? "明日" : "あと" + n + "日";
    }
    // 1つの予定につき、まだ終わっていない最初の回（並びは日付順のまま）
    static List<JSONObject> pick(JSONArray stars, String today) {
        List<JSONObject> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        if (stars == null) return out;
        for (int i = 0; i < stars.length(); i++) {
            JSONObject x = stars.optJSONObject(i);
            if (x == null) continue;
            String last = x.optString("e2", "").isEmpty() ? x.optString("d") : x.optString("e2");
            if (last.compareTo(today) < 0) continue;
            String k = x.optString("k", x.optString("n"));
            if (seen.contains(k)) continue;
            seen.add(k); out.add(x);
        }
        out.sort((a, b) -> a.optString("d").compareTo(b.optString("d")));
        return out;
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_star);
        String today = WidgetData.key(Calendar.getInstance());
        List<JSONObject> list = pick(WidgetData.load(ctx).optJSONArray("stars"), today);
        v.setViewVisibility(R.id.s_empty, list.isEmpty() ? View.VISIBLE : View.GONE);
        for (int r = 0; r < ROWS.length; r++) {
            if (r >= list.size()) { v.setViewVisibility(ROWS[r], View.GONE); continue; }
            JSONObject x = list.get(r);
            String left = leftText(x, today);
            long n = daysBetween(today, x.optString("d"));
            boolean soon = !left.startsWith("あと") || n <= 7;
            String icon = x.optString("i", "");
            String e2 = x.optString("e2", "");
            v.setViewVisibility(ROWS[r], View.VISIBLE);
            v.setTextViewText(DATES[r], md(x.optString("d")));
            v.setTextViewText(NAMES[r], "★ " + (icon.isEmpty() ? "" : icon + " ") + x.optString("n") + (e2.isEmpty() ? "" : "（〜" + md(e2) + "）"));
            v.setTextViewText(LEFTS[r], left);
            v.setTextColor(LEFTS[r], soon ? 0xFF131E29 : 0xFFE3C384);
            v.setInt(LEFTS[r], "setBackgroundResource", soon ? R.drawable.cell_today : 0);
            String day = x.optString("d").compareTo(today) < 0 ? today : x.optString("d");
            v.setOnClickPendingIntent(ROWS[r], WidgetData.openApp(ctx, "view=day&date=" + day, 200 + r));
        }
        v.setTextViewText(R.id.s_title, list.isEmpty() ? "★ 大事な予定" : "★ 大事な予定（" + list.size() + "）");
        v.setOnClickPendingIntent(R.id.s_root, WidgetData.openApp(ctx, "view=today", 30));
        mgr.updateAppWidget(id, v);
    }
}
