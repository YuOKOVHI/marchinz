# MarchinZ（010_MarchinZ）— Claude Code プロジェクト指示

静的 SPA + Firebase BaaS のコミュニティサイト。**版番の正**: `index.html` の `data-mz-version`（現状 **1.26.65**）。本番: https://marchinz.netlify.app ／ Firebase: `marchinz-app`。

**人間向け「コピーするだけ」手順**: `@CLAUDE_CODE_ONBOARDING.md`（初回は `CLAUDE_CODE_START.txt` をチャットに貼る）

**ストレージ分離（全 AI）**: 個人は **個人 Google Drive の `CursorLogs/` のみ**。OneDrive・会社 Drive へ作成禁止。会社 AI は個人 Drive 閲覧禁止 → `../docs/STORAGE_ISOLATION_OKOCHI.md`

**詳細引き継ぎ書**: `@claude_handover.md`（ファイルマップ・Firestore・デプロイ乖離・UGC 等）

---

## AI 運用（約1ヶ月の Claude Code → 将来 Cursor へ戻る想定）

- **約1ヶ月** Claude Code がメイン。のち Cursor メインに戻る可能性が高い。
- **`.cursor/` や Cursor 用設定は、ディレクター指示なしで削除・改変しない。**
- 仕様変更・複雑な実装は **`docs/MARCHINZ_SPEC.md` 改訂履歴**（または `claude_handover.md`）に必ず追記。コミットメッセージは汎用的・詳細に。

---

## デプロイ運用（2026-07-08 改訂: 「git push = 本番デプロイ」／2026-07-12 改訂: push はまとめて）

- **本番反映は `git push origin main`**（Netlify が GitHub 連携で自動ビルド・公開）
- **push のたびに Netlify のビルドクレジットを消費する。コミットは都度作ってよいが、push は作業がまとまってから最後に1回にまとめる**（Netlify が Credits ベースの課金になり、2026-07-12 にクレジット上限到達でサイトが一時停止した実績あり。細かい push の回数がそのままビルド回数＝消費に直結する）
- push 前に必須: ①localhost で該当ハッシュを実機確認 ②`data-mz-version` と触った JS の `?v=` を更新 ③`python3 check_data.py` が OK
- **UI が大きく変わる変更は、push 前にディレクター（大河内様）のローカル確認 OK を得る**
- `firebase deploy`（rules/storage）は影響が大きいため、従来どおり**ディレクター承認後のみ**
- GitHub Actions（YouTube 日次更新+Gemini ダイジェスト）は自動運転。手動起動は自由（これも push のたびにビルドを誘発するため、頻度が気になれば見直し候補）

## 必須ルール（毎回の変更）

1. **仕様**: `docs/MARCHINZ_SPEC.md` ／ **運用**: `docs/OPS_GUIDE.md`
2. **バグ修正・挙動変更後**: `data-mz-version` を PATCH +1（例 `1.26.65` → `1.26.66`）
3. **触った JS**: `index.html` 末尾の同ファイル `?v=` を同版に更新
4. **最小 diff**。既存の IIFE + `window.*` グローバルに合わせる（TypeScript / bundler なし）
5. **検証**: `file://` は不可（Firebase Auth が動かない）
6. **UI アイコンはカラー絵文字禁止**。Font Awesome のモノクロ（`<i class="fa-solid fa-…">`、`vendor/fontawesome`）で統一し CSS で色を継承。既存のカラー絵文字（🗾📅🗺️等）を見かけたら置換候補（シェア用テキスト内の絵文字は対象外）。
7. **動作環境はスマホ・Safari(iOS)を最優先**（iPhone アプリ化予定、2026-07-08 方針）。レイアウト・検証はモバイルファースト（375px 幅を第一に確認）。新しい Web API / CSS 機能は **iOS Safari 16 以降で動くこと**を採用基準にし、それより新しい機能はフォールバック必須。タップ領域・セーフエリア（`env(safe-area-inset-*)`、`viewport-fit=cover` 設定済み）・ホバー非依存（`:hover` は装飾のみ、機能は click/tap）に配慮。
8. **UI/UX の設計そのものを「iPhone で使う」前提で最適化する**（2026-07-20 ディレクター指示・恒久ルール）。7 が「動く・崩れない」の話なのに対し、こちらは**設計思想**。デスクトップで設計してから縮めるのではなく、**375px の縦持ち片手操作を第一の完成形として設計し、広い画面は余白が増えるだけ**にする。具体:
   - 主要 CTA は**親指ゾーン（画面下部）**へ。長い画面では**ボトムアクションバー**を用意する（実装は「実ボタンの `click()` を叩くプロキシ方式」＝状態を二重管理しない。`tools/switcher` に実績あり）
   - 情報は**縦積み 1 カラム**が既定。横並び・多段グリッドは 720px 以上でのみ適用
   - 入力・選択のタップ標的は 44px 以上。枠全体をタップ/ドロップ領域にする
   - 長い処理の進捗・所要時間を明示（iOS は実時間録画経路になり時間がかかるため）。画面ロック対策（無音 audio ループ + Wake Lock）
   - ファイル保存は `navigator.share({files})`（iOS Safari は `<a download>` 不可）。共有は**タップ内でのみ**呼べる
   - 迷ったら「電車の中で片手で操作できるか」で判断する

```bash
cd 010_MarchinZ   # このリポジトリルート
python3 -m http.server 8000
# → http://localhost:8000/#videos 等（Firebase Console に localhost 承認済みドメインが必要）
```

---

## 本番・Git の真実（2026-07-08 改訂: 三層乖離は解消済み）

| 層 | 内容 |
|----|------|
| **GitHub `origin/main`** | **唯一の正**。サイト実装+データの両方。Actions が毎朝データを自動 commit |
| **本番 Netlify** | `main` への push で自動ビルド・公開（GitHub 連携） |
| **ローカル作業コピー** | main のチェックアウト。作業→検証→push |

旧運用（ローカルが正・手動 netlify deploy・main は古い JS）は **2026-07-08 の v1.29.1 push で終了**。`git pull` すれば本番と同じものが手に入る。

---

## 技術スタック

- HTML / CSS（`index.html`, `styles.css`）+ 素の JS（IIFE、グローバル公開）
- Firebase compat SDK 10.12.5（Auth / Firestore / Storage / App Check）
- Python 3: CSV→JSON 同期・YouTube API 取得のみ
- ホスト: Netlify（`netlify.toml`）、ルール: `firebase/firestore.rules`

---

## ディレクトリとデータの「正」

### ルーティング

- **`site-nav.js`**: `routeFromHash()` → `showPage()`。ハッシュ例: `#videos`, `#youtube`, `#profile?uid=&tab=mll`, `#ugc/signup`, `#admin/reports`
- 管理者のみ: `#ugc/*`, `#admin/*`（非管理者は `#top` へ）

### 主要 JS（触る頻度順）

| ファイル | 役割 |
|----------|------|
| `site-nav.js` | SPA ルーター・YouTube 一覧描画・OG |
| `auth.js` / `auth-config.js` | `window.MLL_AUTH`、Google ログイン、`getDisplayName()` |
| `app.js` | 大会動画検索・シェア（`MarchinZShareMenu`） |
| `mll-role.js` | **MarchinZ Log SSOT**（`syncUserInvolvementForCalendar`） |
| `mll.js` | TOP Log 一覧 |
| `calendar-events.js` | イベント |
| `community.js` | 掲示板 |
| `user-profile-page.js` | プロフィール・通知 |
| `event-log-diary.js` | Note |
| `marchinz-admin-ugc.js` | 運営 UGC 一覧・未読バッジ |
| `marchinz-admin-ugc-log.js` | UGC Firestore 書込 |
| `youtube-list/youtube-channel-mylist.js` | YouTube マイリスト |

### 静的データ（直接いじらない派生ファイル）

| 正（編集起点） | ブラウザが読む |
|----------------|----------------|
| `大会動画リスト_マーチング祭.csv` | `data.inline.js`（`window.__VIDEO_DATA`） |
| `youtube-list/YouTubeリスト.csv` | `youtube-list/youtube-list.inline.js`（`window.__YOUTUBE_LIST_ROWS`） |

```bash
python3 sync_csv_to_json.py              # 大会動画 CSV → data.json + data.inline.js
python3 check_data.py
export YOUTUBE_API_KEY=...               # または ~/.mll_youtube_api_key
./run_youtube_api_refresh.sh             # YouTube API 一括
```

YouTube 掲載条件: **181秒（3分01秒）以上**のみ（`export_youtube_list_via_api.py` の `MIN_VIDEO_DURATION_SEC = 181`）。

---

## Firestore（触るとき）

| コレクション | 用途 |
|--------------|------|
| `mll_logs` | MarchinZ Log |
| `mll_profiles/{uid}` | プロフィール + サブコレ（mylist, Note, notifications） |
| `mll_calendar_events` | イベント + `attendees` |
| `mll_community_posts` | 掲示板 |
| `mll_admin_ugc_feed` | 運営 UGC（read は特権 UID のみ） |

**権限の二層**

- UI 管理者: `auth-config.js` → `adminEmails`
- Firestore 書込特権: **`mll_privileged_uids/{uid}`**（Console で UID 登録。`adminEmails` だけでは足りないことがある）

ルール変更後はディレクター指示まで **`firebase deploy` しない**。ローカル検証とルール diff の説明に留める。

### UGC（運営）

- 記録: `marchinz-admin-ugc-log.js` → `mll_admin_ugc_feed`
- UI: `marchinz-admin-ugc.js`（`#ugc/*`）
- kind: `signup`, `event`, `moment`, `board`, `board_reply`, `note`, `mll_log`, `video_mylist`, `yt_mylist`, `video_search`, `search_share`
- `mll_log`: 新規 Log 作成時のみ（`mll-role.js` → `recordMllLog`）
- `video_search`: 連続通知は **3秒以上**（書込成功後のみ間隔カウント）
- 未読バッジ: ページ表示時に先読み + `sessionStorage` キャッシュ

---

## コマンド早見（実行してよいもの）

```bash
python3 -m http.server 8000
python3 sync_csv_to_json.py
python3 check_data.py
python3 verify_youtube_list_csv_inline.py
node --check path/to/file.js
```

## コマンド早見（ディレクター指示まで実行禁止）

```bash
netlify deploy --prod
firebase deploy ...
git push
gh workflow run ...
```

---

## 変更時チェックリスト

- [ ] localhost で該当 `#hash` を確認
- [ ] `data-mz-version` + 変更 JS の `?v=` を更新
- [ ] 必要なら `docs/MARCHINZ_SPEC.md` 改訂履歴 1 行
- [ ] Firestore ルールを変えた場合は「デプロイが必要」とユーザーに明記（勝手に deploy しない）

---

## グローバル API

`MLL_AUTH`, `MarchinZMllRole`, `MarchinZAdminUgc`, `MarchinZAdminUgcLog`, `MarchinZRateLimit`, `MarchinZShareMenu`, `MarchinZProfileHashParams`

イベント: `mll-auth-changed`, `marchinz-admin-ugc-recorded`, `marchinz-mll-updated`

---

## 追加ドキュメント

- `@claude_handover.md` — 完全 Brain Dump（デプロイ三層・全ファイルマップ・負債）
- `@docs/MARCHINZ_SPEC.md` — 仕様・改訂履歴
- `@docs/OPS_GUIDE.md` — CSV / YouTube API / 運用
- `@docs/SECURITY_CHECKLIST.md` — App Check 等

## エスカレーション

同じ症状で 2 回修正しても直らない場合: 3 回目はいきなり大改修せず、仮説整理と切り分け手順をディレクターに提示してから最小 diff。
