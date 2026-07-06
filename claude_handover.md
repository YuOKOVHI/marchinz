# MarchinZ — Claude Code 完全引き継ぎ書（Brain Dump）

> **最終更新**: 2026-05-29  
> **サイト版番（正）**: `index.html` の `data-mz-version` → 現状 **`1.26.65`**  
> **本番 URL**: https://marchinz.netlify.app  
> **Firebase プロジェクト**: `marchinz-app`  
> **GitHub リポジトリ**: https://github.com/YuOKOVHI/marchinz  

運用・実装の「暗黙知」を言語化した詳細版です。**Claude Code は `CLAUDE.md` を自動読み込み**。本ファイルは深掘り用。

---

## ★ Claude Code に引き継ぐ（コピーするだけ）

**人間向けの手順は `CLAUDE_CODE_ONBOARDING.md` に集約**しています。以下でも同じ内容です。

| やること | 内容 |
|----------|------|
| **① フォルダ** | Claude Code で `010_MarchinZ` をルートに開く（`CLAUDE.md` が自動読込） |
| **② 貼り付け** | `CLAUDE_CODE_START.txt` を**全文コピー**→ 初回チャットに貼る |

② の全文は `CLAUDE_CODE_START.txt` と同一（プレーンテキストでコピーしやすい）。

**2回目以降の短い貼り付け:**

```
CLAUDE.md と claude_handover.md を前提に MarchinZ の作業を続けてください。版番は index.html の data-mz-version を確認。deploy / git push は指示があるまで禁止。
```

---

## AI 運用方針（Claude Code 約1ヶ月 → Cursor 再移行想定）

| 方針 | 内容 |
|------|------|
| 使用期間 | Claude Code をメインに**約1ヶ月**。以降 **Cursor メインへ戻る**可能性が高い |
| ロックイン回避 | `.cursor/`・Cursor 用ルールは**ディレクター指示なしで削除・改変しない** |
| ポータビリティ | コミットメッセージ・`docs/`・本ファイルに変更理由を**汎用的に**残す |
| ブラックボックス禁止 | 複雑な仕様変更は `docs/MARCHINZ_SPEC.md` 改訂履歴等に**必ず**追記 |

Claude Code 作業の記録は `docs/MARCHINZ_SPEC.md` の版・日付・概要を正とする。

---

## 1. プロジェクト概要と AI へのシステム指示（System Prompt）

### 1.1 アプリの目的

**MarchinZ（マーチンズ）** は、マーチング／マーチングバンド／カラーガード等のコミュニティ向け **静的 SPA + Firebase BaaS** サイトです。

| 領域 | 内容 |
|------|------|
| 大会動画 | ショート動画の検索・マイリスト・シェア（`#videos`、データは CSV 由来の JSON） |
| YouTube | 公式チャンネル一覧・マイリスト（`#youtube`、YouTube Data API で日次更新） |
| MarchinZ Log | イベント参加記録（`mll_logs`、SSOT は `mll-role.js`） |
| コミュニティ | 掲示板・Note フィード・Moment（`#community/*`） |
| イベント | カレンダー掲示・参加登録（`mll_calendar_events`） |
| プロフィール | マイページ・通知・公開設定（`#profile?uid=&tab=`） |
| 運営 | UGC 活動ログ・通報・お知らせ・ゴミ箱・凍結（`#ugc/*`, `#admin/*`） |

### 1.2 アーキテクチャ（一言）

```
[ブラウザ SPA]  index.html + 多数の IIFE .js
       │
       ├─ 静的データ: data.inline.js, youtube-list.inline.js（ビルド不要）
       │
       └─ Firebase Auth / Firestore / Storage（auth.js + 各機能 JS）
              projectId: marchinz-app
              authDomain: marchinz.netlify.app（Netlify プロキシで /__/auth/*）
```

- **フロント配信**: Netlify（静的ホスト、`netlify.toml` の `publish = "."`）
- **バックエンド**: Firebase（ルールは `firebase/firestore.rules`, `firebase/storage.rules`）
- **ビルドパイプライン**: 本質的に **なし**（TypeScript / bundler なし。Python はデータ同期用のみ）

### 1.3 新 AI 向け System Prompt（コピペ用）

```text
あなたは MarchinZ（010_MarchinZ）の実装エージェントです。

【絶対禁止 — ディレクター明示まで】
- netlify deploy（--prod 含む）を実行しない
- firebase deploy を実行しない
- git push / git commit を勝手に実行しない
- GitHub Actions workflow の手動起動を勝手にしない

【必須の作業姿勢】
- 仕様の正: docs/MARCHINZ_SPEC.md。運用: docs/OPS_GUIDE.md
- バグ修正・挙動変更後は index.html の data-mz-version を PATCH +1（例 1.26.65 → 1.26.66）
- 変更した JS は index.html 末尾の ?v= クエリも同版に揃える
- Firebase / ログイン検証は file:// 不可。python3 -m http.server 8000 で http://localhost:8000/
- 変更は最小 diff。既存の IIFE / グローバル window.* パターンに合わせる

【本番の真実】
- 本番 Netlify は「ローカル 010_MarchinZ フォルダ」から手動 netlify deploy --prod で更新している
- GitHub origin/main とローカル作業コピーは乖離し得る（後述 §3.3）。main だけ pull して本番と思わないこと

【権限の二層】
- UI の「管理者」: auth-config.js の adminEmails
- Firestore 書込の「特権」: mll_privileged_uids/{uid}（Console で UID 登録。クライアントから読めない）

【ワンチーム】
- 同症状で2回直らないときは実装を重ねず、Gemini に仮説整理を依頼（.cursor/rules/gemini-escalation-after-two-failed-fixes.mdc）
```

### 1.4 版番の扱い

| 場所 | 役割 |
|------|------|
| `index.html` `data-mz-version` | **唯一の公式サイト版**（フッター `ver. 1.26.65` もここから） |
| 各 `<script src="...?v=1.26.xx">` | キャッシュバスト用（版変更時は**触った JS だけ**揃える） |
| `docs/MARCHINZ_SPEC.md` 改訂履歴 | 仕様変更の記録（版番は `data-mz-version` と一致させる） |

ワークスペースルール（`.cursor/rules/bump-patch-on-fix.mdc`）: **バグ修正・挙動変更の依頼単位で PATCH +1**。ユーザーが「版を上げない」と言ったときのみ例外。

---

## 2. ディレクトリ構造と主要ファイルマップ

### 2.1 プロジェクトの物理位置

| パス | 意味 |
|------|------|
| `…/CursorLogs/010_MarchinZ/` | **開発・本番デプロイの実体**（この `claude_handover.md` もここ） |
| `…/CursorLogs/.cursor/rules/` | Cursor 用恒久ルール（デプロイ禁止・localhost 必須等） |
| `010_MarchinZ/backups/backup_YYYYMMDD_HHMMSS/` | 手動スナップショット（デプロイ前など）。**正のコードではない** |

Google Drive 上で `マイドライブ` / `マイドライブ`（Unicode 正規化違い）が同一フォルダを指すことがある。**必ず `010_MarchinZ` 配下を編集**すること。

### 2.2 エントリポイント

| ファイル | 役割 |
|----------|------|
| `index.html` | 全ページ DOM（`#page-*`）、ナビ、フッター、**script 読込順の定義**（約 3600 行） |
| `styles.css` | 全局スタイル（モバイルファースト。デザイントークンルールあり） |
| `site-nav.js` | **SPA ルーター**（ハッシュ解析、`showPage`、OG メタ、管理者表示制御） |
| `manifest.webmanifest` / `sw.js` | PWA |

### 2.3 認証・基盤

| ファイル | 役割 |
|----------|------|
| `auth-config.js` | `window.MLL_AUTH_CONFIG`（Firebase 設定、adminEmails、App Check キー） |
| `auth.js` | **`window.MLL_AUTH`** — Google ログイン、プロフィール同期、`getDisplayName()`、退会、凍結検知、`mll-auth-changed` イベント |
| `marchinz-rate-limit.js` | クライアント側レート制限（いいね・投稿・通報等） |
| `marchinz-notify.js` | いいね通知の Firestore 作成（72h 重複抑止） |
| `marchinz-engage-ui.js` | いいねボタン UI 共通化 |
| `marchinz-like-show.js` | 通知設定・表示名（ニックネーム優先） |
| `marchinz-analytics.js` | 分析イベント送信 |
| `marchinz-image-compress.js` | 画像 JPEG 再エンコード |
| `marchinz-icons.js` | アイコン・動的 SVG 差し込み |

### 2.4 機能モジュール（ページ別）

| ハッシュ | 主 JS | 概要 |
|----------|-------|------|
| `#mll` / `#top` | `mll.js`, `mll-role.js` | TOP・MarchinZ Log 一覧・登録 |
| `#community`, `#community/events` 等 | `community.js`, `calendar-events.js`, `mll-moment.js`, `mln-public-feed.js`, `event-log-diary.js`, `marchinz-community-updates.js` | コミュニティハブ（イベント／掲示板／Note／Moment） |
| `#profile?uid=&tab=` | `user-profile-page.js`, `event-log-diary.js` | プロフィール・Note・マイリスト・通知 |
| `#videos` | `app.js`, `mll-video-mylist.js` | 大会動画検索（**最大の単一 JS** の一つ） |
| `#youtube` | `site-nav.js`（一覧描画）, `youtube-list/youtube-channel-mylist.js` | YouTube チャンネル一覧 |
| `#ugc/*` | `marchinz-admin-ugc.js`, `marchinz-admin-ugc-log.js` | 運営 UGC フィード |
| `#admin/reports` 等 | `marchinz-admin-page.js`, `community.js`（通報）, `marchinz-ops-announcement.js`, `marchinz-admin-trash.js`, `marchinz-admin-banned.js` | 管理（通報・お知らせ・ゴミ箱・凍結） |
| `#login` / `#signup` | `auth.js` + `index.html` 静的 | 認証入口 |

**SSOT（MarchinZ Log）**: `mll-role.js` の `window.MarchinZMllRole`  
- `syncUserInvolvementForCalendar` … イベント参加時に `mll_logs` + `attendees` + Note 参加スタイルを同期  
- 新規 Log 時に `MarchinZAdminUgcLog.recordMllLog`（UGC 通知）

### 2.5 データファイル（静的・正の所在）

#### 大会動画（`#videos`）

| ファイル | 役割 |
|----------|------|
| **`大会動画リスト_マーチング祭.csv`** | **Single Source of Truth**（手編集・スクリプト追記の起点） |
| `data.json` | CSV から生成（API・CDN 用。直接編集しない） |
| `data.inline.js` | `window.__VIDEO_DATA = [...]` — **ブラウザはこちらを優先読込**（`app.js`） |

同期コマンド:

```bash
python3 sync_csv_to_json.py   # CSV → data.json + data.inline.js
python3 check_data.py         # 件数・列の整合
```

#### YouTube（`#youtube`）

| ファイル | 役割 |
|----------|------|
| `site-nav.js` 内 `channels` 配列 | API 取得時のチャンネルマスタ（URL 一覧） |
| **`youtube-list/YouTubeリスト.csv`** | API 出力の正（GitHub Actions が更新） |
| `youtube-list/youtube-list.inline.js` | `window.__YOUTUBE_LIST_ROWS` — **ブラウザが読む表示データ** |
| `export_youtube_list_via_api.py` | YouTube Data API v3 で CSV + inline 生成。**181秒（3分01秒）以上**のみ掲載 |

```bash
export YOUTUBE_API_KEY="..."   # または ~/.mll_youtube_api_key
./run_youtube_api_refresh.sh   # API → CSV/inline → sync_csv_to_json → check_data
python3 sync_youtube_list_csv_to_inline.py  # CSV のみ手直ししたとき
python3 verify_youtube_list_csv_inline.py
```

### 2.6 Python / 運用スクリプト（抜粋）

| スクリプト | 用途 |
|------------|------|
| `sync_csv_to_json.py` | 大会動画 CSV → JSON/inline |
| `normalize_team_names.py` | 団体名表記ゆれ正規化 |
| `check_data.py` | データ整合 + YouTube CSV/inline 検証 |
| `run_youtube_api_refresh.sh` | YouTube API 一括更新 |
| `netlify_prebuild_refresh.sh` | Netlify ビルド前フック（キー無ければスキップ） |
| `scripts/` | Firestore 移行・修復用 Node スクリプト（本番 UI とは別系統） |

### 2.7 Firebase 設定

| ファイル | 用途 |
|----------|------|
| `firebase.json` | CLI 用（rules / indexes のパス） |
| `firebase/firestore.rules` | **必ずデプロイが必要**（Netlify だけでは反映されない） |
| `firebase/firestore.indexes.json` | 複合インデックス（UGC `kind+created_at` 等） |
| `firebase/storage.rules` | プロフィール・掲示板・Note 画像 |

### 2.8 ドキュメント（読む順）

1. `docs/MARCHINZ_SPEC.md` — 仕様書（改訂履歴が実装タイムライン）
2. `docs/OPS_GUIDE.md` — CSV・API・デプロイ・Firebase 運用
3. `docs/SECURITY_CHECKLIST.md` — App Check・課金・未実装のサーバー制限
4. `docs/ADMIN_OPERATION_RUNBOOK.md` — 管理人操作
5. `docs/ANALYTICS_EVENTS.md` — イベント名

---

## 3. SPA（ハッシュルーティング）の構造

### 3.1 ルーターの中心

- **`site-nav.js`**: `routeFromHash()` → `{ pageId, communityTab, adminTab, ugcKind }`
- **`showPage(id, routeOpts)`**: 対応する `#page-*` の `hidden` を切り替え、各モジュールの `refresh` を呼ぶ
- 初期化: `hashchange` + `mll-auth-changed` → `syncFromHash()`

### 3.2 ページ ID と DOM

```javascript
// site-nav.js（抜粋）
const pages = {
  mll, community, profile, ugc, admin, videos, youtube,
  webmagazine, creators, ops, terms, privacy, login, signup
};
```

### 3.3 代表的なハッシュ

| ハッシュ | 備考 |
|----------|------|
| `#top` | → `mll` ページ |
| `#events` | → `community` + `events` タブ |
| `#community/board?thread=` | 掲示板スレッド |
| `#profile?uid=XXX&tab=mll` | プロフィール（クエリは `MarchinZProfileHashParams()`） |
| `#ugc/signup` | UGC 種別タブ（未指定 `#ugc` は `#ugc/signup` に replace） |
| `#admin/reports` | 通報（`#admin` 単体は `#admin/reports` へ） |
| `#moderation` | 旧 URL → `#admin/reports` |
| `#admin/ugc` | 旧 URL → `#ugc/signup` |

**管理者ガード**: `#admin` / `#ugc` は `MLL_AUTH.isAdmin()` が false なら `#top` へ。

### 3.4 認証後の戻り

- `buildAuthEntryUrl("login"|"signup")` が `return_to` クエリに現在 URL を保存
- ログイン完了後に元ハッシュへ復帰

### 3.5 script 読込順（重要）

`index.html` 末尾は **すべて `defer`**。概ね:

1. データ（`data.inline.js`, `youtube-list.inline.js`）
2. Firebase SDK（gstatic）
3. `auth-config.js` → `auth.js`
4. `marchinz-admin-ugc-log.js`（UGC 書込は各機能から呼ばれる）
5. 機能 JS 群
6. **`app.js` は最後の方**（大会動画は data 読込後に初期化）

新しいグローバルモジュールを足すときは **依存関係**（`MLL_AUTH` / `MarchinZMllRole` の後）に注意。

---

## 4. デプロイフローとデータ同期アーキテクチャ（要注意）

### 4.1 三層構造（ここが最重要の暗黙知）

```
┌─────────────────────────────────────────────────────────────┐
│ A. GitHub origin/main                                        │
│    - YouTube API daily workflow が data 系を自動 commit/push   │
│    - サイト JS の版は 1.7.x 台の古いコミットがベースのことも   │
└───────────────────────────┬─────────────────────────────────┘
                            │  （自動ではローカルに入らない）
┌───────────────────────────▼─────────────────────────────────┐
│ B. ローカル Google Drive: CursorLogs/010_MarchinZ            │
│    - 実際の開発・版 1.26.x・本番 netlify deploy のソース      │
│    - git HEAD が origin/main と大きく乖離している期間あり     │
└───────────────────────────┬─────────────────────────────────┘
                            │  netlify deploy --prod（手動のみ）
┌───────────────────────────▼─────────────────────────────────┐
│ C. 本番 https://marchinz.netlify.app                         │
│    - Netlify 自動ビルド連携は停止運用（stop_builds 想定）      │
│    - ローカルフォルダの内容がそのまま公開される               │
└─────────────────────────────────────────────────────────────┘
```

**AI がやってはいけない思い込み**

- 「GitHub の main を pull すれば本番と同じ」→ **誤り**（JS はローカルの方が新しい）
- 「GitHub に push すれば本番が更新される」→ **現運用では誤り**（Netlify 自動デプロイ停止）
- 「origin/main の YouTube データだけ checkout して deploy」→ **可**（データのみ取り込みは时有）

**確認コマンド例**

```bash
cd 010_MarchinZ
git fetch origin main
git log -1 --oneline          # ローカル HEAD
git log origin/main -1 --oneline
```

### 4.2 GitHub Actions（データ更新）

| Workflow | ファイル | 動き |
|----------|----------|------|
| YouTube API daily refresh | `.github/workflows/youtube-api-daily.yml` | 毎日 21:00 UTC（≈ JST 06:00）、`run_youtube_api_refresh.sh`、差分あれば `main` に push |
| Verify repo data | `.github/workflows/verify-repo-data.yml` | PR/push で `check_data.py` 等 |

**Secrets**: `YOUTUBE_API_KEY`（リポジトリ Secrets）

**push 対象ファイル**:  
`youtube-list/YouTubeリスト.csv`, `youtube-list/youtube-list.inline.js`, `data.json`, `data.inline.js`

**ローカルでの手動再現**

```bash
gh workflow run "YouTube API daily refresh" --repo YuOKOVHI/marchinz
git fetch origin main
git checkout origin/main -- youtube-list/ data.json data.inline.js
```

### 4.3 本番 Netlify（手動デプロイのみ）

```bash
cd 010_MarchinZ
netlify deploy --prod
```

- `netlify.toml` の `build.command` = `netlify_prebuild_refresh.sh`
- **`YOUTUBE_API_KEY` が Netlify 環境変数に無い** → ビルド時 API 更新はスキップ（通常どおり）
- 本番反映の実体は **ローカルワークスペースのファイル**

**デプロイ前（ディレクター方針・Cursor ルール）**

1. `http://localhost:8000/` で動作確認（**file:// 禁止** — Firebase Auth が動かない）
2. Firestore ルール変更時は別途 `firebase deploy --only firestore:rules,firestore:indexes,storage`
3. 仕様差分があれば `docs/MARCHINZ_SPEC.md` 改訂履歴を同梱

### 4.4 Firebase ルールデプロイ（Netlify とは別）

```bash
cd 010_MarchinZ
firebase deploy --only firestore:rules,firestore:indexes,storage --project marchinz-app
```

**症状とルールの対応**

| 症状 | 確認 |
|------|------|
| マイリスト保存 `permission-denied` | `video_lists` / `channel_lists` ルール |
| UGC 記録失敗 | `mll_admin_ugc_feed` の `kind` 許可リスト（`mll_log`, `video_search` 等） |
| 掲示板画像 | `storage.rules` の `mll_community/{uid}/` |

### 4.5 ローカル開発（必須手順）

```bash
cd 010_MarchinZ
python3 -m http.server 8000
# ブラウザ: http://localhost:8000/#videos 等
```

- Firebase Console → Authentication → 承認済みドメインに **`localhost`** が必要
- App Check デバッグは `auth-config.js` の `appCheck.debug` / `debugToken`

---

## 5. Firestore データモデル（実装で触るもの）

### 5.1 主要コレクション

| コレクション | 用途 |
|--------------|------|
| `mll_profiles/{uid}` | 公開プロフィール、凍結、公開範囲 `section_vis_*`、サブコレクション多数 |
| `mll_logs/{logId}` | MarchinZ Log（`user_id`, `role`, `visibility`, `calendar_event_id`） |
| `mll_calendar_events/{eventId}` | イベント掲示、`attendees/{uid}` |
| `mll_community_posts` | 掲示板 |
| `mll_community_reports` / `mll_mylist_reports` / `mll_note_reports` | 通報 |
| `mll_admin_ugc_feed` | **運営 UGC**（書込: `marchinz-admin-ugc-log.js`、read: 特権 UID のみ） |
| `mll_profiles/{adminUid}/admin_ugc_reads/{feedId}` | UGC 既読 |
| `mll_site_announcements/current` | サイト全体お知らせ |
| `mll_meta/marchinz_public_id` | ユーザー番号採番（101 起算） |
| `mll_privileged_uids/{uid}` | **Firestore 特権**（Console でのみ編集可） |
| `mll_community_updates` | コミュニティ「更新情報」フィード（イベント・掲示板 create のみ） |

### 5.2 プロフィールサブコレクション（抜粋）

| パス | 用途 |
|------|------|
| `video_lists`, `video_bookmarks` | 大会動画マイリスト |
| `channel_lists`, `channel_bookmarks` | YouTube マイリスト |
| `event_log_diaries/{eventId}` | MarchinZ Note |
| `moments/{momentId}` | Moment |
| `notifications/{nid}` | いいね通知受信箱 |

### 5.3 UGC フィード（`mll_admin_ugc_feed`）

**kind 一覧**（`marchinz-admin-ugc.js` の `UGC_TABS` と一致）:

`signup`, `event`, `moment`, `board`, `board_reply`, `note`, `mll_log`, `video_mylist`, `yt_mylist`, `video_search`, `search_share`

| kind | 記録元（代表） |
|------|----------------|
| `signup` | `auth.js` |
| `event` | `calendar-events.js` |
| `moment` | `mll-moment.js` |
| `board` / `board_reply` | `community.js` |
| `note` | `event-log-diary.js` |
| `mll_log` | `mll-role.js` `syncUserInvolvementForCalendar`（**新規 Log のみ**） |
| `video_mylist` / `yt_mylist` | 各 mylist JS（**リスト新規作成時**） |
| `video_search` | `app.js` `logVideoSearchUgc`（**3秒以上間隔**、ゲスト可） |
| `search_share` | `app.js` `MarchinZShareMenu`（シェアメニュー選択時） |

**表示名**: ログインユーザーは `mll_profiles.display_name`（ニックネーム）。未ログイン検索は `actor_uid: mll_guest`, `actor_name: ゲスト`。

**未読バッジ**（v1.26.65）: `refreshBadges()` が種別ごとに未読数 → タブとナビに表示。sessionStorage キャッシュで即時表示。`marchinz-admin-ugc-recorded` で再取得。

---

## 6. 技術的負債・制約・ハマりどころ（暗黙の了解）

### 6.1 アーキテクチャ上の制約

| 項目 | 内容 |
|------|------|
| ビルドなし | モジュールバンドルなし。グローバル `window.*` の IIFE |
| 型なし | JSDoc は一部のみ。TS 化は未着手 |
| クライアント rate limit | サーバー側（ルール/Functions）には未実装 |
| `mll_logs` クエリ | 他者非公開混在で collection 全体 orderBy が失敗し得る → `user_id` where 必須（`mll-role.js`） |
| localStorage | `marchinz_mll_logs_v1` が残存（Firestore とマージ表示）。削除時はキャッシュ整合に注意 |

### 6.2 データ運用の罠

| 罠 | 対策 |
|----|------|
| `data.json` だけ更新 | **必ず** `sync_csv_to_json.py` で `data.inline.js` も更新 |
| YouTube CSV だけ更新 | `sync_youtube_list_csv_to_inline.py` + `verify_youtube_list_csv_inline.py` |
| `build_data.py --full` | 手整備 CSV を上書きし得る。**安易に使わない** |
| Google Drive の古いコピー | 本番デプロイ前に **意図した 010_MarchinZ** を開いているか確認 |

### 6.3 Firebase / 認証

| 罠 | 対策 |
|----|------|
| `file://` で開く | Auth / Storage が動かない。**localhost 必須** |
| adminEmails だけ特権 | **書込は `mll_privileged_uids`**。UI で管理者でも UGC write 失敗し得る |
| ルール未デプロイ | Netlify deploy だけでは直らない |
| App Check Enforcement | キー未設定で Enforcement のみ ON にしない |

### 6.4 Git / 本番の乖離

- ローカルは **1.26.65** まで進んでいるが、`git log -1` が **1.13.0 時代のコミット**のままのことがある
- **本番 Netlify** はローカル deploy 由来で **GitHub より新しい**
- データファイルだけ `git checkout origin/main -- youtube-list/ ...` で取り込む運用は有効

### 6.5 バックアップフォルダ

- `backups/backup_*` は参照用。**そこから復元して deploy しない**（版が古い）

### 6.6 AI チーム運用（Cursor ワークスペース）

- **Gemini** と **Cursor** は対立ではなくワンチーム（`.cursor/rules/marchinz-ai-team-one-team.mdc`）
- 同症状 **2回** 修正失敗 → 3回目は Gemini 仮説整理テンプレを提示してから実装（`.cursor/rules/gemini-escalation-after-two-failed-fixes.mdc`）

---

## 7. 変更時のチェックリスト（実務）

### 7.1 フロント修正のみ

- [ ] `http://localhost:8000` で該当ハッシュを確認
- [ ] `data-mz-version` PATCH +1
- [ ] 触った JS の `?v=` を更新
- [ ] 必要なら `docs/MARCHINZ_SPEC.md` 改訂履歴
- [ ] ディレクターが「デプロイ」と言うまで `netlify deploy` しない

### 7.2 Firestore ルール / インデックス変更

- [ ] `firebase/firestore.rules` 編集
- [ ] ローカルで該当操作を再現
- [ ] `firebase deploy --only firestore:rules,firestore:indexes`
- [ ] インデックス構築待ち（数分）— `failed-precondition` に注意

### 7.3 大会動画データ追加

- [ ] `大会動画リスト_マーチング祭.csv` 編集
- [ ] `python3 sync_csv_to_json.py && python3 check_data.py`
- [ ] 版バンプ + localhost `#videos` で検索ヒット確認

### 7.4 YouTube データ更新

- [ ] `./run_youtube_api_refresh.sh`（キー必要）または GitHub Actions + fetch
- [ ] `verify_youtube_list_csv_inline.py`
- [ ] `#youtube` で件数・最新動画確認

---

## 8. グローバル API 早見（デバッグ用）

| グローバル | 定義ファイル |
|------------|--------------|
| `window.MLL_AUTH` | `auth.js` |
| `window.MLL_AUTH_CONFIG` | `auth-config.js` |
| `window.MarchinZMllRole` | `mll-role.js` |
| `window.MarchinZAdminUgc` | `marchinz-admin-ugc.js` |
| `window.MarchinZAdminUgcLog` | `marchinz-admin-ugc-log.js` |
| `window.MarchinZRateLimit` | `marchinz-rate-limit.js` |
| `window.MarchinZShareMenu` | `app.js` |
| `window.MarchinZProfileHashParams` | `site-nav.js` |
| `window.__VIDEO_DATA` | `data.inline.js` |
| `window.__YOUTUBE_LIST_ROWS` | `youtube-list.inline.js` |

**イベント**: `mll-auth-changed`, `marchinz-mll-updated`, `marchinz-admin-ugc-recorded`

---

## 9. 関連リポジトリ外のコンテキスト

| 項目 | 値 |
|------|-----|
| Netlify サイト名 | `marchinz` |
| X アカウント（シェア文） | `@marchinz2026` |
| 管理者メール（UI） | `auth-config.js` → `adminEmails` |
| CursorLogs 直下 | `001_`〜`010_MarchinZ` 等（`cursorlogs-top-level-folders.mdc`） |

---

## 10. 改訂メモ（このファイルの保守）

- サイト版が上がったら **§1 の版番**と **§4.1 乖離の有無**を見直す
- 大きなアーキテクチャ変更（例: bundler 導入、自動デプロイ再開）があれば **§4 全体**を書き換える
- 正は常に **`docs/MARCHINZ_SPEC.md` + 実コード**。この handover は AI 向けの要約層

---

*End of handover — Claude Code 用*
