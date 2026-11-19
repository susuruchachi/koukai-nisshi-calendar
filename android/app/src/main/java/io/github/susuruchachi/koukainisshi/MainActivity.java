package io.github.susuruchachi.koukainisshi;

// 航海日誌の Android アプリ（WebView 版）
// ・中身はウェブ版（GitHub Pages）をそのまま表示する。ウェブ版を更新すれば、アプリの中身も新しくなる
// ・ウェブ版から KoukaiApp.setWidgetData で予定と日記を受け取り、ホーム画面のウィジェットに出す
// ・Google ログイン：WebView の中では Google がログインを許さないので、アプリ側（Credential Manager）でアカウントを選ぶ画面を出し、
//   受け取った ID トークンをウェブ版に渡す（KoukaiApp.takeLogin）。Firebase にこのアプリが登録されていないなどで断られたときは、
//   ブラウザで app-login.html を開いてログインし、「アプリに戻る」（koukainisshi://auth?state=…&id=…）で受け取る（googleSignInBrowser）
// ・.ics の書き出しは「ダウンロード」フォルダーに保存する（WebView ではブラウザのダウンロードが動かないため）
// ・アプリの自動更新（ApkUpdater）：新しい APK を裏でダウンロードし、アプリを閉じて1分たったら入れ替える（はじめの1回だけ確認が出る）

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String LOGIN_PREFS = "koukai_login";
    private WebView web;
    private boolean pageLoaded = false;
    private final Executor bg = Executors.newSingleThreadExecutor();
    // 予定を書いている途中でないか（ウェブ版が apkSetIdle で知らせる）。途中なら、裏に回っても入れ替えない
    static volatile boolean jsIdle = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApkUpdater.appAlive = true;
        // 新しい版に入れ替わってから、はじめて開いたとき
        android.content.SharedPreferences up = getSharedPreferences("koukai_update", MODE_PRIVATE);
        int lastCode = up.getInt("code", 0);
        if (lastCode != 0 && lastCode < BuildConfig.VERSION_CODE) Toast.makeText(this, "📲 航海日誌のアプリを新しくしました（" + BuildConfig.VERSION_NAME + "）", Toast.LENGTH_LONG).show();
        if (lastCode != BuildConfig.VERSION_CODE) up.edit().putInt("code", BuildConfig.VERSION_CODE).apply();
        getWindow().setStatusBarColor(Color.parseColor("#131E29"));
        getWindow().setNavigationBarColor(Color.parseColor("#131E29"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#131E29"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " KoukaiNisshiApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "KoukaiApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isOwnPage(u) && !u.getPath().endsWith("app-login.html")) return false;
                openExternal(u); // ほかのページ（APK のダウンロードなど）は、ブラウザで開く
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) { pageLoaded = true; }
        });

        Intent in = getIntent();
        if (isLoginReturn(in)) receiveLogin(in.getData());
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(startUrl(in));
    }

    private boolean isOwnPage(Uri u) {
        String path = u.getPath() == null ? "" : u.getPath();
        return "https".equals(u.getScheme()) && getString(R.string.hostName).equals(u.getHost()) && path.startsWith(getString(R.string.pathPrefix));
    }

    private static boolean isLoginReturn(Intent i) {
        Uri d = i == null ? null : i.getData();
        return d != null && "koukainisshi".equals(d.getScheme()) && "auth".equals(d.getHost());
    }

    private String startUrl(Intent intent) {
        Uri d = intent != null ? intent.getData() : null;
        if (d != null && isOwnPage(d)) return d.toString();
        return getString(R.string.launchUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isLoginReturn(intent)) {
            receiveLogin(intent.getData());
            web.evaluateJavascript("window.__koukaiLoginArrived&&window.__koukaiLoginArrived()", null);
            return;
        }
        Uri d = intent.getData();
        if (d == null || !isOwnPage(d)) return;
        // ウィジェットから：開いているページはそのままで、その画面（日記・その日）に移る
        String view = d.getQueryParameter("view");
        if (pageLoaded && view != null) {
            String date = d.getQueryParameter("date");
            web.evaluateJavascript("window.__koukaiOpen?window.__koukaiOpen(" + JSONObject.quote(view) + "," + JSONObject.quote(date == null ? "" : date) + "):location.assign(" + JSONObject.quote(d.toString()) + ")", null);
        } else web.loadUrl(d.toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    // 戻るボタン：開いている画面（予定の編集・振り返りなど）をウェブ版で閉じる。閉じるものが無ければアプリを裏に回す
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return !!(window.koukaiAppBack&&window.koukaiAppBack());}catch(e){return false;}})()", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

    // 自動更新：閉じて（裏に回して）1分たち、書いている途中でなく、確認なしで入れられるなら入れ替える（InstallResultReceiver が入れる）
    @Override
    protected void onStart() { super.onStart(); ApkUpdater.onShown(this); }
    @Override
    protected void onStop() { super.onStop(); ApkUpdater.onHidden(this); }
    @Override
    protected void onResume() {
        super.onResume();
        // 裏で入れようとしたら確認が要った：開いたときに確認を出す
        if (InstallResultReceiver.askLater) { InstallResultReceiver.askLater = false; bg.execute(() -> ApkUpdater.install(getApplicationContext())); }
    }
    @Override
    protected void onDestroy() { ApkUpdater.appAlive = false; super.onDestroy(); }

    private void openExternal(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { toast("開けるアプリがありません"); }
    }

    private void toast(String m) { runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show()); }

    // ブラウザでのログインから戻ってきた：合言葉（state）が、アプリが送ったものと同じときだけ受け取る
    private void receiveLogin(Uri d) {
        android.content.SharedPreferences p = getSharedPreferences(LOGIN_PREFS, Context.MODE_PRIVATE);
        String want = p.getString("state", "");
        String got = d.getQueryParameter("state");
        String id = d.getQueryParameter("id");
        String at = d.getQueryParameter("at");
        JSONObject o = new JSONObject();
        try {
            if (want.isEmpty() || got == null || !want.equals(got)) o.put("error", "ログインの確認が合いませんでした。もう一度「Google でログイン」から試してください");
            else if (id == null || id.isEmpty()) o.put("error", "Google のトークンを受け取れませんでした");
            else { o.put("idToken", id); if (at != null) o.put("accessToken", at); }
        } catch (Exception ignored) {}
        p.edit().remove("state").putString("pending", o.toString()).apply();
    }

    // ログインの結果をウェブ版に渡す（KoukaiApp.takeLogin で受け取る）
    private void deliverLogin(JSONObject o) {
        getSharedPreferences(LOGIN_PREFS, Context.MODE_PRIVATE).edit().putString("pending", o.toString()).apply();
        runOnUiThread(() -> web.evaluateJavascript("window.__koukaiLoginArrived&&window.__koukaiLoginArrived()", null));
    }
    private void deliverLoginError(String kind, String msg) {
        JSONObject o = new JSONObject();
        try { o.put("error", msg); o.put("kind", kind); } catch (Exception ignored) {}
        deliverLogin(o);
    }

    // ---------------- ウェブ版から呼ぶ ----------------
    private class Bridge {
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public int versionCode() { return BuildConfig.VERSION_CODE; }

        // 予定と日記をウィジェットに渡す（app-bridge.js の koukaiBuildWidgetData の形）
        @JavascriptInterface public void setWidgetData(String json) { WidgetData.save(MainActivity.this, json); }

        // Google でログイン：アカウントを選ぶ画面（Credential Manager）を出す
        @JavascriptInterface public void googleSignIn() {
            getSharedPreferences(LOGIN_PREFS, Context.MODE_PRIVATE).edit().remove("pending").apply();
            runOnUiThread(() -> {
                try {
                    GetSignInWithGoogleOption opt = new GetSignInWithGoogleOption.Builder(getString(R.string.webClientId)).build();
                    GetCredentialRequest req = new GetCredentialRequest.Builder().addCredentialOption(opt).build();
                    CredentialManager.create(MainActivity.this).getCredentialAsync(MainActivity.this, req, new CancellationSignal(), bg,
                        new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                            @Override public void onResult(GetCredentialResponse r) {
                                Credential c = r.getCredential();
                                if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                                    try {
                                        JSONObject o = new JSONObject();
                                        o.put("idToken", GoogleIdTokenCredential.createFrom(c.getData()).getIdToken());
                                        deliverLogin(o);
                                    } catch (Exception e) { deliverLoginError("error", "Google の答えを読めませんでした"); }
                                } else deliverLoginError("error", "Google 以外のログインには対応していません");
                            }
                            @Override public void onError(GetCredentialException e) {
                                // アカウントを選んだあとに Google に断られたとき（Firebase にこのアプリ・SHA-1 が無いなど）も「キャンセル」で返ってくるので、中身も渡す
                                deliverLoginError(e instanceof GetCredentialCancellationException ? "cancel" : "error",
                                    e.getClass().getSimpleName() + (e.getMessage() == null ? "" : "：" + e.getMessage()));
                            }
                        });
                } catch (Exception e) { deliverLoginError("error", e.getClass().getSimpleName() + "：" + e.getMessage()); }
            });
        }

        // ログアウトのとき：次のログインでアカウントを選び直せるように
        @JavascriptInterface public void signOutGoogle() {
            runOnUiThread(() -> CredentialManager.create(MainActivity.this).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(), bg,
                new CredentialManagerCallback<Void, ClearCredentialException>() {
                    @Override public void onResult(Void v) {}
                    @Override public void onError(ClearCredentialException e) {}
                }));
        }

        // ブラウザで Google にログイン（アカウントを選ぶ画面が使えないとき）：合言葉を作って、ブラウザで app-login.html を開く
        @JavascriptInterface public void googleSignInBrowser() {
            byte[] b = new byte[24];
            new SecureRandom().nextBytes(b);
            String state = Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            getSharedPreferences(LOGIN_PREFS, Context.MODE_PRIVATE).edit().putString("state", state).remove("pending").apply();
            runOnUiThread(() -> openExternal(Uri.parse(getString(R.string.loginUrl) + "#state=" + state)));
        }

        // 受け取ったログイン（{ idToken, accessToken } か { error }）を1回だけ渡す。無ければ空
        @JavascriptInterface public String takeLogin() {
            android.content.SharedPreferences p = getSharedPreferences(LOGIN_PREFS, Context.MODE_PRIVATE);
            String v = p.getString("pending", "");
            if (!v.isEmpty()) p.edit().remove("pending").apply();
            return v;
        }

        // ---- アプリの自動更新（app-bridge.js から） ----
        // apkPrepare：裏でダウンロード（終わったら window.__koukaiApkReady(ok, 確認なしで入れられるか)）。このサイトの APK だけ
        @JavascriptInterface public void apkPrepare(String url, long code) {
            if (!isOwnPage(Uri.parse(url)) || !url.endsWith(".apk")) return;
            bg.execute(() -> {
                boolean ok = ApkUpdater.download(getApplicationContext(), url, code);
                boolean silent = ApkUpdater.canSilent(MainActivity.this);
                runOnUiThread(() -> web.evaluateJavascript("window.__koukaiApkReady&&window.__koukaiApkReady(" + ok + "," + silent + ")", null));
            });
        }
        @JavascriptInterface public boolean apkCanSilent() { return ApkUpdater.canSilent(MainActivity.this); }
        @JavascriptInterface public boolean apkReady() { return ApkUpdater.ready(MainActivity.this); }
        // いま入れる（確認が要れば確認の画面が出る）
        @JavascriptInterface public void apkInstallNow() {
            if (!getPackageManager().canRequestPackageInstalls()) {
                toast("「この提供元のアプリを許可」をオンにしてから、もう一度「更新する」を押してください");
                try { startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (Exception e) {}
                return;
            }
            bg.execute(() -> { if (!ApkUpdater.install(getApplicationContext())) toast("更新を始められませんでした"); });
        }
        // いま入れ替えてよいか（予定を書いている途中でないか）
        @JavascriptInterface public void apkSetIdle(boolean idle) { jsIdle = idle; }

        // ファイルを「ダウンロード」フォルダーに保存する（.ics の書き出し）。保存できたら true
        @JavascriptInterface public boolean saveFile(String name, String mime, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return false;
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(bytes); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return false;
                    try (FileOutputStream os = new FileOutputStream(new File(dir, safe))) { os.write(bytes); }
                }
                toast("「ダウンロード」に保存しました：" + safe);
                return true;
            } catch (Exception e) { toast("保存できませんでした"); return false; }
        }
    }
}
