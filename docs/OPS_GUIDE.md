# MarchinZ 運営向け管理メモ

## 1) 日常運用

- **ショウ動画の一覧データは `大会動画リスト_マーチング祭.csv` が正（Single source of truth）**です。新規取り込み・追記は **必ず先にこの CSV** を更新し、`python3 sync_csv_to_json.py` で派生ファイルへ反映します（`data.json` / `data.inline.js` を直接いじらない）。
- 物理パス例: `…/CursorLogs/010_MarchinZ/大会動画リスト_マーチング祭.csv`。Google Drive 上ではフォルダ名が `マイドライブ` と `マイドライブ`（Unicode の分解の違い）のように **表記が変わっても同一フォルダを指す**ことがありますが、**必ず `010_MarchinZ/大会動画リスト_マーチング祭.csv` を開いて編集**してください。
- MLLはFirestoreの `mll_logs` / `mll_profiles` に保存されます。
- 画像やバナー差し替えは `logo/` と `images/` を更新します。
- 本番反映は **手動デプロイのみ**（`netlify deploy --prod --dir .`）で行います。**自動本番デプロイは停止済み**（Netlify `build_settings.stop_builds=true`）。

## 2) MLLの投稿・表示仕様（現状）

- 投稿入力: 大会名、開催日、参加区分（必須）＋会場、メモ、URL（任意）
- 一覧表示: 将来イベントを開催日順で表示
- 参加者表示: 同一イベントに紐づくユーザーを参戦予定として表示
- プロフィール: クリックで表示名・アイコン・投稿件数を表示

## 3) Firebase / Firestore 管理ポイント

- Firestoreコレクション（掲示板・通報など）:
  - `mll_logs` — MLLライフログ
  - `mll_profiles` — 表示名・アバターなど
  - `mll_community_posts` / `mll_community_reports` — コミュニティ掲示板・通報
- `mll_logs` の主要フィールド:
  - `visibility` — `public`（既定）または `private`（**本人は常に read 可**。本人以外は **公開かつ** 投稿者プロフィールの **`section_vis_mll` が public のときのみ read 可**。未ログインでもこの条件を満たす公開ログは read 可。ルールは `firebase/firestore.rules`）
  - `ticket_url`
  - `official_url`
  - `creator_name`
  - `creator_avatar`
  - `created_at`（ISO文字列）
- Firebase AuthはGoogleログインを利用
- 認証/DB接続設定は `auth-config.js` の `window.MLL_AUTH_CONFIG.firebase` に記載

### 3.0) ユーザー番号（`marchinz_public_id`）と採番カウンタ

- **一般ユーザー**の採番はトランザクション **`mll_meta/marchinz_public_id` の `next`** から行われ、**101 以上**が割り当てられます（初回カウンタ未作成時の既定も 101 起算）。
- **001〜100（1〜100 の数値）**はコードでは自動採番されません。運営・公式など **手動で空けたい番号**として使う場合:
  1. Firebase Console で `mll_profiles/{対象UID}` を開く。
  2. フィールド **`marchinz_public_id`** に **数値だけの文字列**（例: **`1`**）を設定する。プロフィールの表示は **`001`**（1〜100 は 3 桁ゼロ埋め）、**`101` 以上は 8 桁**（例: `00000105`）です。
  3. **他ユーザーと番号が重複しない**ことを必ず確認する（重複チェックは会員登録時の表示名とは別軸）。
  4. カウンタ `mll_meta/marchinz_public_id.next` は **新規一般ユーザーが 101 以降を取り続ける値**にしておく（運営に `105` が付いているだけなら、次ユーザー用は `106` 以上でよい）。

### 3.1) セキュリティルール（必読・忘れ防止）

サイトの動きとは別に **Firebase Console 側のルール**が厳しいと、通報カウント更新や管理人による編集・削除がエラーになります。

- **リポジトリ内のひな型**（ここからコピーして Console に貼り付け／CLI deploy でも可）
  - Firestore: `010_MarchinZ/firebase/firestore.rules`
  - Storage: `010_MarchinZ/firebase/storage.rules`
- **管理人はメールではなく Auth の UID で許可**する形にしています（`adminEmails` とは別レイヤ）。
  - Firestore でコレクション **`mll_privileged_uids`** を作成し、管理人アカウントごとに **ドキュメント ID = そのユーザーの UID** を Console から追加（フィールドは空で可）。
  - このコレクションはルール上 **クライアント SDK からの読書き禁止**なので、UID の追加削除は Console または Admin SDK のみになります。
- **掲示板の投稿**: 編集・削除は **投稿者本人** または **`mll_privileged_uids` に登録済み UID** が可能、`reported_count` / `reported_at` のみの更新は **ログイン済みユーザー** が他者投稿に対して行える（通報フローのため）。
- **MLL ログ（`mll_logs`）**: 作成者は従来どおり更新・削除。加えて **いいね** は任意のログイン済みユーザーが **`liked_by` フィールドだけ**変更できる（掲示板のいいねと同様）。
- **Storage の `mll_community/…`**: 本人フォルダへの画像アップ、および管理人は全 `userId` 配下への書込・削除が可能な例になっています。

### 3.2) サイト全体のお知らせ（`mll_site_announcements`）

ログイン済みユーザー向けに、ヘッダー下バナーとプロフィール「通知」タブへ運営お知らせを出します（Phase 1: 未ログインには表示しません）。

| 項目 | 内容 |
|------|------|
| コレクション | `mll_site_announcements` |
| ドキュメント ID | **`current`**（常に 1 件。差し替え配信） |
| 主なフィールド | `title`, `body`, `link_href`, `link_label`（任意）, `active`, `published_at`, `updated_at`, `created_by_uid` |
| 既読 | `mll_profiles/{uid}.last_read_announcement_at` に、読んだ時点のお知らせ `updated_at` を保存 |
| read | ログイン済みユーザー |
| write | **`mll_privileged_uids` に登録した UID のみ**（`adminEmails` の表示だけでは不可） |

**配信方法（2 通り）**

1. **運営ページ UI（推奨）**: **`#admin/announce`** を開き、管理人メール（`auth-config.js` の `adminEmails`）でログインした状態で「サイト全体のお知らせ」から **配信する** / **いまのを停止**。
2. **Firebase Console（初回・緊急）**: コレクション `mll_site_announcements` にドキュメント ID `current` を作成し、上記フィールドを手入力。`active: true` で有効化。

**デプロイ時の注意**: クライアントを反映する前に、必ず `firebase/firestore.rules` を Firebase にデプロイしてください（未デプロイだと read/write が拒否されます）。

### 3.3) 掲示板画像・マイリストが「権限がありません」になるとき

コードを Netlify に出しただけでは **Firebase のルールは自動では更新されません**。次を **同じ Firebase プロジェクト** に反映してください。

```bash
cd 010_MarchinZ
firebase deploy --only firestore:rules,storage
```

| 症状 | 確認するルール |
|------|----------------|
| 掲示板投稿で `storage/unauthorized` | `firebase/storage.rules` の `mll_community/{uid}/…`（レガシー `ml_community` も許可） |
| YouTube／大会動画の「マイリストに追加」で `permission-denied` | `firebase/firestore.rules` の `video_lists` / `video_bookmarks` / `channel_lists` / `channel_bookmarks` |

反映後、ブラウザでハードリロードして再試行してください。

### Storage バケットの CORS 設定（2026-07-08 設定済み・重要）

バケット `marchinz-app.firebasestorage.app` には **GCS の CORS 設定**が入っています。役割は2つ:

1. **本番からのアップロード**（Storage SDK の put。PUT/POST/Authorization/x-goog-resumable が必要）
2. **canvas への画像描画**（MarchinZ Log 動画書き出しが Note 写真/アバターを crossOrigin で読む。GET が必要）

現在の設定（2エントリ）:

| origin | method | 用途 |
|--------|--------|------|
| `https://marchinz.netlify.app` | GET/HEAD/PUT/POST/DELETE | 本番のアップロード+動画書き出し |
| `http://localhost:8000`, `http://localhost:8123` | 同上 | ローカル開発 |

**注意**: この設定を消したり GET だけに絞ったりすると、**本番の画像アップロードが全滅**します（プロフィール/Note/Moment/掲示板/Days 写真）。オリジン追加（独自ドメイン移行等）は既存エントリを保ったまま追記すること。

設定方法: gsutil 不要。firebase CLI ログイン済みなら GCS JSON API に PATCH できる（`storage.googleapis.com/storage/v1/b/{bucket}` の `cors` フィールド。firebase-tools の保存トークンを流用するスクリプト例はセッション記録参照）。または Google Cloud Console → Cloud Storage → バケット → 設定 → CORS。

## 4) デプロイ前チェック

- `#mll` で投稿して一覧に反映される
- 情報作成者/参戦予定ユーザーのクリックでプロフィール表示される
- チケットURL/公式URLリンクが開く
- `#videos` の検索・ページング・シェアが正常
- `#webmagazine` のジャンプリンクと「もっと見る」が正常

## 5) トラブル時の最短確認

- MLLが保存されない: Firestoreの `mll_logs` に新規ドキュメントが入るか確認
- MLL一覧が空: 開催日が未来になっているか確認（過去日は将来一覧に出ない）
- URLが出ない: `ticket_url` / `official_url` フィールドが保存されているか確認
- 認証が動かない: `auth-config.js` の `firebase` 設定（apiKey/authDomain/projectId/appId）を確認

## 6) `大会動画リスト_マーチング祭.csv` の取り込み・修正と反映ルール（必須）

### データの流向（順序を変えない）

1. **`大会動画リスト_マーチング祭.csv` に追記・編集**（これが唯一の正）
2. **（任意）** 団体/チーム名の表記ゆれをまとめる: `python3 normalize_team_names.py --dry-run` → 問題なければ `python3 normalize_team_names.py`（処理内容は同スクリプト先頭）。
3. **`python3 sync_csv_to_json.py`** を実行 → **`data.json` と `data.inline.js` の両方**を CSV から再生成する（別途 `data.inline.js` を手編集しない）。
4. **`python3 check_data.py`** で件数・列・CSV と JSON の一致を確認する。
5. 公開反映時は **`index.html` の `data-mz-version` を PATCH 単位で上げる**、`app.js` の `data.inline.js?v=` のクエリ値を変えてキャッシュを避ける（運用ポリシーに従う）。
6. ブラウザでハードリロード（Mac: `Cmd+Shift+R`）して表示確認。

### YouTube を取り込むときのルール

- **単一のアーカイブ動画からチャプター行を一括追加**する場合: プロジェクト内の **`append_live_chapters_from_youtube.py`** を使う（**出力先は常に `大会動画リスト_マーチング祭.csv`**）。アーカイブにチャプターが付いている前提。例:  
  `python3 append_live_chapters_from_youtube.py --video-id <VIDEO_ID> [--replace]`  
  のあと、上記 **手順 3〜4** を実行する。
- **`--replace`**: 同じ動画 ID を含む既存行を消してから再マージする（誤った 1 行だけ残っている場合など）。
- **配信前・待機中のみの URL**（まだ VOD になっていない）: `yt-dlp` でチャプターが取れないため、**この方法では CSV に行を足せない**。アーカイブ公開後に再実行する。
- **`build_data.py`**: チャンネル全体の取得・一覧再構築用。**手で整えた `大会動画リスト_マーチング祭.csv` を上書きし得る**（`--full` は特に全置換）。手修正済みの CSV を正とする運用では、**安易に `--full` を使わない**。増分で追加される行は必要に応じて CSV 側で後から整える。

### 反映確認の最小チェック

- `CSV` / `data.json` / `data.inline.js` の件数が一致している（`check_data.py` が通る）
- 追加したキーワードでサイト上の検索にヒットする

## 7) 表示が古い／件数が合わないとき（再発防止）

- **原因**: `app.js` は `data.inline.js` を優先読込する。`data.json` だけ直しても、**`sync_csv_to_json.py` を通さないと `data.inline.js` が古いまま**になり得る。
- **対策**: **常に CSV を正として** `sync_csv_to_json.py` を一回通す（同コマンドで `data.json` と `data.inline.js` を揃える）。その後 `check_data.py`、必要ならバージョン表記・`?v=` 更新。

### 7.1) YouTubeチャンネル一覧（`#youtube`）の再発防止（必読）

#### データの正と表示の関係

- ブラウザは **`youtube-list/youtube-list.inline.js`** を読む（`window.__YOUTUBE_LIST_ROWS`）。
- **定常更新**: GitHub Actions「YouTube API daily refresh」が `run_youtube_api_refresh.sh` を実行し、**API が `youtube-list/YouTubeリスト.csv` と `youtube-list.inline.js` を同じ内容で同時に上書き**する。
- **手動で CSV だけ直した場合**: 必ず **`python3 sync_youtube_list_csv_to_inline.py`** を実行し、**CSV と inline を同じコミットで push** する。片方だけのコミットは CI で落ちる。

#### ズレを防ぐチェック（自動）

- **`python3 verify_youtube_list_csv_inline.py`** … CSV と inline の全行・全列が一致するかを検証。
- **`check_data.py`** … 大会動画 JSON／CSV に加え、上記 YouTube の一致検証も実行する。
- **GitHub Actions「Verify repo data」** … `pull_request` と `main` / `master` への `push` で上記を実行。**CSV だけ更新して inline を忘れた PR はマージできない**。

#### 運用でやらないこと

- **Google Drive 上の古いコピーだけ**を編集して本番デプロイする（GitHub の `main` より新しい／古いが混線しやすい）。本番用は **リモートの `main` を pull してから**編集・デプロイする。
- `youtube-list.inline.js` を手編集する（API または `sync_youtube_list_csv_to_inline.py` に任せる）。

## 8) YouTube API 運用（YouTubeページ更新の推奨）

### 追加したスクリプト

- `export_youtube_list_via_api.py`
  - `site-nav.js` の `channels` を入力に YouTube Data API v3 で収集
  - `youtube-list/YouTubeリスト.csv` / `youtube-list/youtube-list.inline.js` を再生成
  - 書き込み前に `youtube-list/archive/` へ `.bak.YYYYmmdd_HHMMSS` を自動バックアップ（`.gitignore` の `*.bak.*` でコミット対象外）
- `run_youtube_api_refresh.sh`
  - 上記 API 取得に続けて `sync_csv_to_json.py` → `check_data.py` → **`verify_youtube_list_csv_inline.py`** まで一括実行

### 事前準備

- API キーを環境変数に設定:
  - `export YOUTUBE_API_KEY="YOUR_API_KEY"`

### 実行例

- 本運用（全チャンネル）:
  - `./run_youtube_api_refresh.sh`
- 試運転（件数を絞る）:
  - `./run_youtube_api_refresh.sh --max-channels 5 --max-items 80 --dry-run`

### 更新頻度の推奨

- 通常日: **1日1回**
- 大会日: 必要なら **+1回（合計2回）**
- 障害時: 手動で再実行

### API 消費量の目安（search.list 不使用設計）

- 1回更新あたり概算:
  - `ceil(チャンネル数/50) + チャンネル数 + チャンネル数`
- 現在の 44 チャンネルなら:
  - **89 units / 回**
  - 1日1回: **89 units/日**
  - 1日2回: **178 units/日**

> 追記: 現在の運用ルールは「最新1 + 人気3（通常動画/LIVE混合、Shorts除外）」のため、
> `search.list` は使わず低コストです（60ch 目安で **約 122 units/回**）。

## 8.5) GitHub Actions 日次更新（Git 連携 Netlify 向け・推奨）

> 現在運用では本番の自動反映を止めているため、この節の手順は**採用しない**。必要になった場合のみ再有効化する。

Netlify を **GitHub リポジトリ連携**にしたうえで、リポジトリに以下を置く。

- `.github/workflows/youtube-api-daily.yml` … 毎日 `run_youtube_api_refresh.sh` を実行し、差分があれば `main` に push
- リポジトリの **Actions secrets** に `YOUTUBE_API_KEY` を登録

### 動き

1. GitHub Actions が API で `youtube-list/YouTubeリスト.csv` / `youtube-list/youtube-list.inline.js` / `data.json` / `data.inline.js` を更新して push
2. Netlify がそのコミットで **Production デプロイ**（ビルドコマンドは既存の `netlify_prebuild_refresh.sh`。キー未設定ならスキップしても問題なし）

### Netlify 側の API キーについて

- **日次更新は GitHub のみ**にするなら、Netlify の `YOUTUBE_API_KEY` は空でよい（二重取得を避けられる）。
- 手動「Deploy site」だけで API 再取得もしたい場合は、Netlify にもキーを残してよい。

## 9) Cloud Run + Cloud Scheduler 自動化（PC電源OFFでも実行）

### 全体構成

- Scheduler（毎日 06:00 JST）→ Cloud Run `/trigger` を呼ぶ
- Cloud Run は Netlify Build Hook を呼ぶ
- Netlify build 時に `netlify_prebuild_refresh.sh` が `run_youtube_api_refresh.sh` を実行
- そのビルド成果物として最新 `youtube-list/` 直下の CSV・インライン JS および `data.json` などが配信される

### 追加ファイル

- `netlify_prebuild_refresh.sh`（Netlify ビルド前更新）
- `cloudrun/main.py`（Build Hook 呼び出しAPI）
- `cloudrun/Dockerfile`
- `cloudrun/requirements.txt`
- `cloudrun/deploy_cloudrun_scheduler.sh`（Cloud Run + Scheduler 一括作成）

### 事前に設定する環境変数

- Netlify 側（Site settings → Environment variables）
  - `YOUTUBE_API_KEY`
- ローカル（デプロイスクリプト実行時）
  - `PROJECT_ID`（GCP の実プロジェクトID）
  - `NETLIFY_BUILD_HOOK_URL`
  - `TRIGGER_TOKEN`（任意のランダム文字列）

### デプロイ手順（初回）

1. Netlify に `YOUTUBE_API_KEY` を登録
2. ローカルで次を実行:
   - `export PROJECT_ID="..."`  
   - `export NETLIFY_BUILD_HOOK_URL="..."`  
   - `export TRIGGER_TOKEN="$(openssl rand -hex 16)"`  
   - `bash ./cloudrun/deploy_cloudrun_scheduler.sh`
3. 手動疎通テスト:
   - `curl -X POST "Cloud Run URL/trigger" -H "X-Trigger-Token: ..."`

### 注意

- `TRIGGER_TOKEN` は秘密情報。漏えいしたら再生成して Cloud Run/Scheduler を更新する。
- Cloud Run は Build Hook を叩くだけで、APIキー自体は Netlify 側に置く（フロントには出さない）。
