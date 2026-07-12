# P1.5 — `mll_logs` バックフィル & 重複行マージ

`docs/MLL_CALENDAR_LIFECYCLE_DISCUSSION.md` §7 P1.5 / §12 に基づく **Admin SDK** スクリプトです。

## ファイル

| ファイル | 役割 |
|----------|------|
| `lib/mll-match-key.mjs` | 掲示・Log 共通の matchKey（`calendar-events.js` と同型） |
| `lib/mll-log-merge.mjs` | 行マージ（role 優先・`liked_by` ユニオン） |
| `backfill-mll-calendar-event-id.mjs` | 実行本体 |
| `migrate-attendees-to-mll.mjs` | attendees のみある行を `mll_logs` に補完（v1.22.10+） |

## attendees → mll_logs マイグレーション（v1.22.10）

`attendees` サブコレクションはあるが `mll_logs` が無い行を一括作成します。**一覧読込での自動修復は行いません。**

```bash
cd scripts
node migrate-attendees-to-mll.mjs --dry-run
node migrate-attendees-to-mll.mjs --dry-run --user-id=YOUR_FIREBASE_AUTH_UID
node migrate-attendees-to-mll.mjs --user-id=YOUR_FIREBASE_AUTH_UID
```

### 本番デプロイ順

1. `cd firebase && firebase deploy --only firestore:indexes`（`user_id` + `calendar_event_id`）
2. インデックス反映を数分待つ
3. `node migrate-attendees-to-mll.mjs`（必要なら `--user-id` で試験）
4. Netlify へサイト JS をデプロイ

## 事前準備

```bash
cd "/Users/pc20/Library/CloudStorage/GoogleDrive-mm.yu.okochi@gmail.com/マイドライブ/CursorLogs/010_MarchinZ/scripts"
npm install
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccount.json"
# 任意
export FIREBASE_PROJECT_ID="marchinz-app"
```

サービスアカウントには **Cloud Datastore User**（または Firestore 管理者）権限が必要です。

## フェーズ

| フェーズ | 内容 |
|--------|------|
| `backfill` | `calendar_event_id` 付与（matchKey で `mll_calendar_events` を検索） |
| `merge` | 同一 `user_id` + `calendar_event_id`（無ければ matchKey）の重複 Log を 1 件化 |
| `all` | 上記を順に実行（本番時は backfill 後に Log を再読込して merge） |

## コマンド例

```bash
# 1) 全体プレビュー（必ず最初）
node backfill-mll-calendar-event-id.mjs --dry-run

# 2) オーナー UID だけ試す（推奨）
node backfill-mll-calendar-event-id.mjs --dry-run --user-id=YOUR_FIREBASE_AUTH_UID

# 3) レポート JSON
node backfill-mll-calendar-event-id.mjs --dry-run --user-id=YOUR_UID \
  --report=./reports/mll-p15-dryrun.json

# 4) バックフィルのみ本番
node backfill-mll-calendar-event-id.mjs --phase=backfill

# 5) マージのみ本番（backfill 後）
node backfill-mll-calendar-event-id.mjs --phase=merge

# 6) 一括本番
node backfill-mll-calendar-event-id.mjs --phase=all
```

### オプション

| フラグ | 説明 |
|--------|------|
| `--dry-run` | 書き込み・削除なし |
| `--phase=all\|backfill\|merge` | フェーズ（既定: `all`） |
| `--user-id=` | 対象 UID を 1 人に限定 |
| `--force` | 既存 `calendar_event_id` も上書き |
| `--report=` | JSON サマリー出力パス |
| `--prefer-event-id=` | 同一 matchKey で複数掲示があるとき優先する eventId |
| `--delete-orphans` | 掲示と一致しない Log（orphan）を **削除**（削除済みイベントの Log を 0 にする） |

## 行マージ優先ルール（§12）

1. role: `ops` > `perform` > `team_staff` > `watch`
2. 同一 role: `updated_at`（無ければ `created_at`）が新しい方を残す
3. `liked_by` はユニオン。`note` / URL 系は勝者が空なら他 doc から補完

## 孤立 Log（orphan）

matchKey で `mll_calendar_events` が 0 件の Log は **更新しません**（コンソールと `--report` の `orphans` に列挙）。  
運営 UI の **イベント統合** または手動整理を検討してください。

## 検証

1. Firebase Console で `mll_logs` の `calendar_event_id` を確認
2. https://marchinz.netlify.app マイページ → MarchinZ Log（件数・重複行）
3. 問題があれば Firebase エクスポートから復元

## section_vis_mll バックフィル（v1.35.1+）

`mll_logs` 読み取りルールの section_vis_mll チェックを `get(mll_profiles)` から
`resource.data.section_vis_mll`（非正規化フィールド）参照に変更した（public feed クエリが
get()/exists() 上限(10回)を超えて permission-denied になる問題の修正）。既存ログにはこの
フィールドが無いため、`mll_profiles` の現在値を一括コピーする。

```bash
cd scripts
node backfill-mll-section-vis.mjs --dry-run
node backfill-mll-section-vis.mjs --dry-run --user-id=YOUR_FIREBASE_AUTH_UID
node backfill-mll-section-vis.mjs
```

### 本番デプロイ順

1. `cd firebase && firebase deploy --only firestore:rules`
2. `node backfill-mll-section-vis.mjs --dry-run` で確認
3. `node backfill-mll-section-vis.mjs` 本番実行
4. Netlify へサイト JS（mll-role.js / user-profile-page.js）をデプロイ

## 関連

- `repair-mll-log-roles.mjs` — role / role_label 補正（別スクリプト）
