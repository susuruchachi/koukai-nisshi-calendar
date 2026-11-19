# 航海日誌 (VoyageLog) — 分割版

## ファイル構成と依存関係

```
index.html          … 全ファイルを読み込むシェル(この順序を保つこと)
  ├─ constants.js      共通定数(曜日ラベル、繰り返しラベル、storageキー)
  ├─ date-utils.js     日付ヘルパー(pad, dateKey, todayKey, addDaysToKey など)
  ├─ recurrence.js     繰り返し予定の判定・展開ロジック
  │    └─ depends on: date-utils.js
  ├─ ics-export.js     .ics (iCalendar) 書き出しロジック
  │    └─ depends on: constants.js, date-utils.js
  ├─ calendar-grid.js  月表示グリッドの生成
  │    └─ depends on: date-utils.js, constants.js
  ├─ diary.js          できた事日記（1日3つ＋すするankiの単語数）の保存・連続日数・月の合計
  │    └─ depends on: date-utils.js
  ├─ app-bridge.js     Android アプリとのやりとり（ウィジェットに渡すデータ・.ics の保存・ウィジェットから開く）
  │    └─ depends on: date-utils.js, recurrence.js, diary.js
  ├─ icons.jsx         lucide-react の代わりのインラインSVGアイコン
  └─ VoyageLog.jsx      メインのReactコンポーネント(UI全体)
       └─ depends on: 上記すべて

manifest.json        … PWAの設定(アプリ名・アイコン・表示モード)
sw.js                 … Service Worker(オフラインキャッシュ、インストール要件を満たすため)
app-login.html        … Android アプリの Google ログイン用（ブラウザで開いてログインし、アプリに戻る）
android/              … Android アプリ（WebView 版＋ホーム画面のウィジェット）
apk/koukai-nisshi.apk … 作った Android アプリ
icons/                … アプリアイコン一式(16px〜512px、maskable版含む)
icon-source.svg       … アイコンの元デザイン(編集用)
```

読み込み順は `index.html` 内の `<script>` タグの並びがそのまま依存順になっています。
新しいロジックを追加する場合は、依存先より後ろに置いてください。

## 起動方法(重要)

`index.html` をブラウザで直接ダブルクリックして `file://` で開くと、
ブラウザのセキュリティ制限により外部の `.js` / `.jsx` ファイルの読み込みが
ブロックされて **真っ白な画面になります**。

必ずローカルサーバー経由で開いてください。このフォルダ内で:

```bash
# Python がある場合
python3 -m http.server 8000

# Node.js がある場合
npx serve .
```

その後ブラウザで `http://localhost:8000/` を開いてください。

## Chromeに「アプリ」としてインストールする

PWA(Progressive Web App)化してあるので、Chromeの「インストール」機能で
デスクトップ/ホーム画面にアプリのように追加できます。

**重要な条件:** ChromeのPWAインストール機能は `localhost` か `https://` の
どちらかでないと有効になりません。**`file://` で開いた場合や、`http://`
の通常のIPアドレス・独自ドメインでは、インストールボタンが出ません。**

### 手元のPCだけで使う場合(お手軽)

1. このフォルダで `python3 -m http.server 8000` を実行
2. Chromeで `http://localhost:8000/` を開く
3. アドレスバー右側にインストールアイコン(⊕や画面にアプリを追加するアイコン)が表示されるのでクリック
   → 表示されない場合はChromeメニュー(⋮)→「キャスト、保存、共有」→「ページをアプリとしてインストール」
4. 「インストール」を押すと、独立したウィンドウで開くアプリとしてデスクトップ/アプリ一覧に登録されます

この方法だとサーバーを起動している間しか使えません。恒常的に使うには次のどちらかが必要です。

### 恒常的に使う場合

- **ローカルで常駐させる:** `pm2` や OS起動時の自動起動設定で `python3 -m http.server` を常時立ち上げておく
- **どこかにデプロイする:** GitHub Pages、Vercel、Netlify などの無料ホスティングにこのフォルダをそのままアップロードすると自動的にHTTPSが付与され、スマホ含めどの端末からでもインストールできるようになります
  (すするチャチさんの構成だとGitHub連携がすでにあるので、リポジトリにpushしてGitHub Pagesを有効化するのが一番手軽です)

### インストール後の見た目

- 独立したウィンドウで起動し、Chromeのアドレスバーやタブが表示されません
- アプリ一覧・タスクバー・Dockにアイコン(錨のマーク)が表示されます
- オフラインでも、一度読み込んだ後は `sw.js` のキャッシュによりある程度動作します
  (ただし `localStorage` のデータそのものはオンライン/オフラインに関係なく端末内保持です)

### アイコンを差し替えたい場合

`icon-source.svg` がデザイン元です。編集後、`icons/` 内の各PNGを作り直してください
(このプロジェクトではPillowでの再描画スクリプトを使いましたが、Figmaや他のツールで
書き出しても構いません)。サイズ一覧は `manifest.json` の `icons` 配列を参照してください。

## すするanki と同期（sync.js）

ヘッダーの「☁️ 同期」から、すするanki と同じアカウント（Google・メール）でログインして「すするanki と予定を同期する」をオンにすると、
すするanki のカレンダー（「🔗 連携」→「⚓ 航海日誌と同期」をオン）と予定を同期します。

- 置き場所：Firebase（すするanki と同じプロジェクト）の Firestore `susuru_anki_cal/{uid}` = `{ events: { id: 予定 }, updatedAt }`
- 予定の形はこのアプリの形に、`at`（変えた時刻）と、すするanki の分（`type`：テスト・授業など、`end`：何日か続く予定の最後の日）を足したもの
- 新しく変えた方（`at` が大きい方）を使う。消した予定は `{ deleted: true, at }`（この端末の消した記録は `koukai-nisshi-deleted`）
- 同期がオフなら、今までどおりこの端末の中（localStorage）だけ

## ✦ できた事日記（diary.js）

選んだ日の予定の下に「今日のできた事」の欄があります。

- どんなに小さなことでも、できた事を **3つ** 書く（1〜3の欄。Enter で次の欄へ）
- 4つ目の欄に、**すするanki でできた単語の数**（語）を入れる
  - ログインしていれば、すするanki の記録（Firestore の `susuru_anki_logs/{日付}_{uid}` の `correct`＝その日に正解した数。すするanki が1問ごとに書く）を読んで**自動で入れる**（今日の分は解くたびに増える）。
    下に「すするanki：正解 ○問 ／ 解いた ○問」と出る。同期がオフでもログインしていれば読む（読むだけで、すするanki 側は変えていない）
  - 自分で数を打つと、それを使う（自動では上書きしない）。「正解数を入れる」で、すするanki の数に戻せる
  - 自動で入れるのは、今日と、できた事を書いた日だけ（前の日を見ただけで日記を作らない）
- 打つとすぐ保存（「✓ 保存しました」）。先の日には書けない。前の日はカレンダーで選べば書き直せる
- カレンダーの日の右上の ✦ が日記を書いた日（3つ書いた日は明るい ✦）。続けて書いた日数を「○日連続」で出す
- 「振り返る」：表示中の月の日記の一覧と、書いた日数・できた事の数・すするanki の単語の合計。押すとその日に移る
- 保存先：localStorage の `koukai-nisshi-diary` = `{ 'YYYY-MM-DD': { items: [3つ], anki: 数 or null, ankiAuto: 自動で入れた数なら true・自分で打ったら false, at: 変えた時刻 } }`
- 同期がオンなら Firestore の `susuru_anki_cal/{uid}` の `diary` に、日ごとに新しい方（`at` が大きい方）を使って入れる
  （予定と同じ文書なので、Firestore のルールを変えなくてよい。すするanki は `events` しか読まないので影響しない）

## 🤖 Android アプリ（android/・ウィジェット付き）

`apk/koukai-nisshi.apk` を Android の端末で開くと入れられます（「提供元不明のアプリ」の許可が要ることがあります）。
ウェブ版を Android の WebView でそのまま表示するので、画面の中身はウェブ版（main）を更新すれば自動で新しくなります。

- **ホーム画面のウィジェット**（ホーム画面を長押し →「ウィジェット」→「航海日誌」）
  - **航海日誌 カレンダー**（4×4）：今月のカレンダー（予定のある日に点・日記を書いた日に ✦・今日は真鍮色）と今日の予定。日を押すとその日が開く
  - **航海日誌 できた事日記**（4×2）：今日できた事3つ・すするanki の単語数・続けて書いた日数。押すと「今日のできた事」の欄が開いてすぐ書ける
  - データはアプリを開いたとき（予定・日記を変えたとき）に届く。夜中の0時すぎに「今日」を描き直す
- **Google ログイン**：WebView の中では Google がログインを許さないので、「Google でログイン」を押すとブラウザで
  `app-login.html` が開く → ログイン →「アプリに戻る」で戻るとログインできている（アプリが作った合言葉 state を確かめる）。メールでのログインはアプリの中でそのままできる
- **.ics の書き出し**：アプリでは「ダウンロード」フォルダーに保存する
- **作り直すとき**（android/ を変えたときだけ）：`android/app/build.gradle` の `versionCode` と `app-bridge.js` の `ANDROID_APK_CODE` を同じ数に上げて、
  GitHub の Actions →「android-apk」→ Run workflow。署名鍵を Secrets（`KOUKAI_KEYSTORE_B64`・`KOUKAI_KEYSTORE_PASSWORD`）に入れておくと、
  前のアプリの上から入れ直せる APK になり、`apk/koukai-nisshi.apk` に置かれる。古いアプリを開くと「🆕 新しいアプリがあります」と出る
- 手元で作るとき：`cd android && gradle assembleRelease`（Android SDK と JDK 17 以上が要る。`KOUKAI_KEYSTORE`・`KOUKAI_KEYSTORE_PASSWORD` で署名鍵を渡す）

## データの保存先

`localStorage` を使っています。キーは `koukai-nisshi-events`。
ブラウザ・ポート番号・オリジンが変わると別のストレージ扱いになる点に注意してください
(例: `localhost:8000` と `127.0.0.1:8000` は別オリジンとして扱われます)。

## 今後の改良の目安

- カレンダーの表示ロジックだけ変えたい → `calendar-grid.js`
- 繰り返し予定のルールを増やしたい(例: 隔週の特定曜日など) → `recurrence.js`
- Googleカレンダー以外のエクスポート形式を足したい → `ics-export.js`
- 見た目やアイコンを変えたい → `icons.jsx` / `VoyageLog.jsx` 内のJSX・インラインスタイル
- 保存先をFirebaseなど別のバックエンドに変えたい → `VoyageLog.jsx` 内の `persist` 関数と
  初回読み込みの `useEffect` を差し替える
- アプリ名やアイコン、起動時の画面向きを変えたい → `manifest.json`
- オフラインキャッシュの対象ファイルを増やしたい → `sw.js` の `APP_SHELL` 配列にパスを追加
  (ファイルを更新したら `CACHE_NAME` の末尾のバージョン番号も上げること。上げないと古いキャッシュが
  使われ続けて変更が反映されないことがあります)
