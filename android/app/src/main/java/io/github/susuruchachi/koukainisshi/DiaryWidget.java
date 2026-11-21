package io.github.susuruchachi.koukainisshi;

// できた事日記のウィジェット：今日できた事（はじめの3つと、増やして書いたもの）と、すするanki で解いた数、続けて書いた日数
// 押すと、アプリの「今日のできた事」の欄が開く（まだ書いていない欄にすぐ打てる）

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

public class DiaryWidget extends AppWidgetProvider {
    private static final int C_TEXT = 0xFFEDE6D2, C_DIM = 0xFF5E7180, C_SUB = 0xFF97A8B5, C_BRASS = 0xFFE3C384;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
        WidgetData.scheduleMidnight(ctx);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, DiaryWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static void add(SpannableStringBuilder b, String s, int color, boolean bold) {
        int st = b.length(); b.append(s);
        b.setSpan(new ForegroundColorSpan(color), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (bold) b.setSpan(new StyleSpan(Typeface.BOLD), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_diary);
        JSONObject data = WidgetData.load(ctx);
        Calendar now = Calendar.getInstance();
        JSONObject e = WidgetData.diaryOn(data, WidgetData.key(now));
        int done = WidgetData.doneCount(e);

        v.setTextViewText(R.id.d_title, "✦ 今日のできた事  " + WidgetData.md(now));
        int st = WidgetData.streak(data);
        v.setTextViewText(R.id.d_streak, st > 0 ? st + "日連続" : "");

        SpannableStringBuilder t = new SpannableStringBuilder();
        if (done == 0) {
            add(t, "まだ書いていません\n", C_SUB, false);
            add(t, "どんなに小さなことでも大丈夫。\nタップして、できた事を3つ書こう ✏️", C_TEXT, false);
        } else {
            JSONArray items = e.optJSONArray("items");
            int n = Math.max(3, items == null ? 0 : items.length());
            for (int i = 0; i < n; i++) {
                String s = items == null ? "" : items.optString(i, "").trim();
                if (i >= 3 && s.isEmpty()) continue; // 増やした欄は、書いたものだけ
                if (t.length() > 0) t.append("\n");
                if (s.isEmpty()) { add(t, (i + 1) + ". ", C_DIM, false); add(t, "（あと1つ書けます）", C_DIM, false); }
                else { add(t, (i + 1) + ". ", C_BRASS, true); add(t, s, C_TEXT, false); }
            }
        }
        v.setTextViewText(R.id.d_items, t);

        SpannableStringBuilder a = new SpannableStringBuilder();
        add(a, "📚 すするanki ", C_SUB, false);
        if (e != null && !e.isNull("anki") && e.has("anki")) add(a, e.optInt("anki", 0) + "問", C_BRASS, true);
        else add(a, "—", C_DIM, false);
        if (done >= 3) add(a, "   🎉 " + done + "つ書けました", C_BRASS, false);
        v.setTextViewText(R.id.d_anki, a);

        v.setOnClickPendingIntent(R.id.d_root, WidgetData.openApp(ctx, "view=diary", 20));
        mgr.updateAppWidget(id, v);
    }
}
