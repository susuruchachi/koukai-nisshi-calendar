package io.github.susuruchachi.koukainisshi;

// カレンダーのウィジェット：今月の日（予定のある日に点、できた事日記を書いた日に ✦、今日は真鍮色）と、今日の予定
// 日を押すと、アプリのその日が開く

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

public class CalendarWidget extends AppWidgetProvider {
    private static final int C_TEXT = 0xFFEDE6D2, C_DIM = 0xFF5E7180, C_SUB = 0xFF97A8B5, C_SIGNAL = 0xFF7FB69E,
        C_BRASS = 0xFFE3C384, C_INK = 0xFF131E29, C_SUN = 0xFFC0605A;
    private static final int[] CELLS = { R.id.cal_c0, R.id.cal_c1, R.id.cal_c2, R.id.cal_c3, R.id.cal_c4, R.id.cal_c5, R.id.cal_c6, R.id.cal_c7, R.id.cal_c8, R.id.cal_c9, R.id.cal_c10, R.id.cal_c11, R.id.cal_c12, R.id.cal_c13, R.id.cal_c14, R.id.cal_c15, R.id.cal_c16, R.id.cal_c17, R.id.cal_c18, R.id.cal_c19, R.id.cal_c20, R.id.cal_c21, R.id.cal_c22, R.id.cal_c23, R.id.cal_c24, R.id.cal_c25, R.id.cal_c26, R.id.cal_c27, R.id.cal_c28, R.id.cal_c29, R.id.cal_c30, R.id.cal_c31, R.id.cal_c32, R.id.cal_c33, R.id.cal_c34, R.id.cal_c35, R.id.cal_c36, R.id.cal_c37, R.id.cal_c38, R.id.cal_c39, R.id.cal_c40, R.id.cal_c41 };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
        WidgetData.scheduleMidnight(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (WidgetData.TICK.equals(intent.getAction())) WidgetData.refreshAll(ctx);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, CalendarWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static void add(SpannableStringBuilder b, String s, int color, boolean bold, float size) {
        int st = b.length(); b.append(s);
        b.setSpan(new ForegroundColorSpan(color), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (bold) b.setSpan(new StyleSpan(Typeface.BOLD), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (size != 1f) b.setSpan(new RelativeSizeSpan(size), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_calendar);
        JSONObject data = WidgetData.load(ctx);
        Calendar now = Calendar.getInstance();
        String today = WidgetData.key(now);
        v.setTextViewText(R.id.cal_month, "⚓ " + now.get(Calendar.YEAR) + "年" + (now.get(Calendar.MONTH) + 1) + "月");

        // 今月の1日がある週の日曜日から、6週ぶん
        Calendar c = Calendar.getInstance();
        c.set(Calendar.DAY_OF_MONTH, 1);
        int month = c.get(Calendar.MONTH);
        int lead = c.get(Calendar.DAY_OF_WEEK) - 1;
        int daysInMonth = c.getActualMaximum(Calendar.DAY_OF_MONTH);
        int rows = (lead + daysInMonth + 6) / 7;
        c.add(Calendar.DAY_OF_MONTH, -lead);
        for (int i = 0; i < 42; i++) {
            int cell = CELLS[i];
            String k = WidgetData.key(c);
            boolean inMonth = c.get(Calendar.MONTH) == month;
            boolean isToday = k.equals(today);
            int nEv = WidgetData.eventsOn(data, k).length();
            int done = WidgetData.doneCount(WidgetData.diaryOn(data, k));
            int dow = c.get(Calendar.DAY_OF_WEEK);

            SpannableStringBuilder t = new SpannableStringBuilder();
            int numColor = isToday ? C_INK : !inMonth ? C_DIM : dow == Calendar.SUNDAY ? C_SUN : C_TEXT;
            add(t, String.valueOf(c.get(Calendar.DAY_OF_MONTH)), numColor, isToday, 1f);
            t.append("\n");
            StringBuilder dots = new StringBuilder();
            for (int d = 0; d < Math.min(3, nEv); d++) dots.append('•');
            if (dots.length() > 0) add(t, dots.toString(), isToday ? C_INK : inMonth ? C_SIGNAL : C_DIM, false, 0.8f);
            if (done > 0) add(t, "✦", isToday ? C_INK : done >= 3 ? C_BRASS : C_SUB, false, 0.7f);
            if (dots.length() == 0 && done == 0) add(t, " ", C_DIM, false, 0.8f);
            v.setTextViewText(cell, t);
            v.setInt(cell, "setBackgroundResource", isToday ? R.drawable.cell_today : 0);
            v.setOnClickPendingIntent(cell, WidgetData.openApp(ctx, "view=day&date=" + k, 100 + i));
            c.add(Calendar.DAY_OF_MONTH, 1);
        }
        v.setViewVisibility(R.id.cal_r5, rows >= 6 ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.cal_r4, rows >= 5 ? View.VISIBLE : View.GONE);

        // 今日の予定（時刻順。終わったものは薄く）
        JSONArray evs = WidgetData.eventsOn(data, today);
        SpannableStringBuilder t = new SpannableStringBuilder();
        String nowHm = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
        for (int i = 0; i < evs.length(); i++) {
            JSONObject x = evs.optJSONObject(i);
            if (x == null) continue;
            String s = x.optString("s", ""), e = x.optString("e", "");
            boolean past = !s.isEmpty() && (e.isEmpty() ? s : e).compareTo(nowHm) < 0;
            if (t.length() > 0) t.append("\n");
            add(t, (s.isEmpty() ? "終日" : s) + "  ", past ? C_DIM : C_SIGNAL, false, 1f);
            String icon = x.optString("i", "");
            add(t, (icon.isEmpty() ? "" : icon + " ") + x.optString("n", ""), past ? C_DIM : C_TEXT, !past, 1f);
        }
        if (evs.length() == 0) add(t, data.has("at") ? "今日の予定はありません" : "アプリを開くと、予定が届きます", C_SUB, false, 1f);
        v.setTextViewText(R.id.cal_today, t);
        v.setTextViewText(R.id.cal_count, evs.length() == 0 ? "" : "今日 " + evs.length() + "件");

        v.setOnClickPendingIntent(R.id.cal_head, WidgetData.openApp(ctx, "view=today", 10));
        v.setOnClickPendingIntent(R.id.cal_today, WidgetData.openApp(ctx, "view=today", 11));
        mgr.updateAppWidget(id, v);
    }
}
