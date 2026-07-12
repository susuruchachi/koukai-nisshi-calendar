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
  ├─ icons.jsx         lucide-react の代わりのインラインSVGアイコン
  └─ VoyageLog.jsx      メインのReactコンポーネント(UI全体)
       └─ depends on: 上記すべて

manifest.json        … PWAの設定(アプリ名・アイコン・表示モード)
sw.js                 … Service Worker(オフラインキャッシュ、インストール要件を満たすため)
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
