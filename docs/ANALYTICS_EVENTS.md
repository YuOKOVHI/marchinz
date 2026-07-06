# 分析イベント設計（初期版）

MarchinZ の改善判断に使う、最小イベントセットです。  
既存実装に合わせて、イベント名・発火タイミング・主要パラメータを固定します。

## イベント一覧

- `login_start`
  - タイミング: Google ログイン/新規登録ボタン押下時
  - params: `entry` (`login` / `signup` / `unknown`)
- `login_success`
  - タイミング: **Google リダイレクト認証が完了した直後の初回のみ**（ページ再読み込みでのセッション復元では送信しない）
  - params: `admin` (`1` or `0`)
- `login_action`
  - タイミング: `login_success` と同じ（ヤマハ向けレポート用の明示名。GA4 カスタムイベントとしても利用）
  - params: `method`（`google` 固定）、`admin`、`auth_flow`（`login` / `signup`）
- GA4 推奨イベント `login`
  - `gtag('event', 'login', { method: 'google' })` を上記タイミングで追加送信（GA4 標準のログイン回数レポートと整合）
- `search_run`
  - タイミング: 検索条件を recent に保存する実行時
  - params: `tab`, `has_team`, `has_event`, `has_free`
- `mylist_add`
  - タイミング: マイリスト追加成功時
  - params: `target` (`video` / `youtube_channel`), `list_id`
- `share_click`
  - タイミング: シェアボタン（copy/x/line/facebook/instagram）押下時
  - params: `kind`, `target`

## 見方（暫定）

- `plausible` が有効ならそのまま送信
- `gtag` が有効なら GA に送信
- どちらも無効な環境では、`localStorage` の `marchinz_metric_*` カウンタで最低限の計測を継続

## ダッシュボード表示名（運用用）

Plausible / GA4 の画面でイベントを見たときに、チーム内で意味が揃うように表示名を固定します。

- `login_start`: ログイン開始（Google）
- `login_success`: ログイン成功（実サインイン時のみ）
- `login_action`: ログインアクション（実サインイン時のみ）
- `mz_route_view`: ハッシュ（仮想ページ）遷移
- `mz_core_engagement_start` / `mz_core_engagement_pulse`: コア画面の滞在パルス（30 秒ごと・タブが visible のときのみ）
- `search_run`: 動画検索実行
- `search_result_view`: 検索結果件数（バケット）
- `mylist_add`: マイリスト追加
- `mylist_remove`: マイリスト削除
- `share_click`: シェア操作
- `signup_complete`: 新規プロフィール初回保存
- `legal_policy_accept` / `b_test_consent_accept`: 規約・β同意
- `note_save_success`: Note 保存
- `profile_tab_view`: プロフィールタブ
- `community_post_submit` / `community_reply_submit`: 掲示板
- `report_submit` / `rate_limit_hit`: 通報・レート制限

推奨運用:

- 週次レポートでは、イベント名ではなく上記の表示名で記載する
- `share_click` は `kind`（copy/x/line/facebook/instagram）別に分解して確認する
- `mylist_add` は `target`（video / youtube_channel）別に分解して確認する

## GA4 カスタム定義（必要時）

GA4 でパラメータ別分析をする場合、以下をイベントスコープで登録します。

- `entry`（`login_start` 用）
- `admin`（`login_success` / `login_action` 用）
- `method`, `auth_flow`（`login_action` 用）
- `page_id`, `community_tab`, `page_path`（`mz_route_view` 用）
- `surface`, `pulse_index`, `pulse_sec`（`mz_core_engagement_*` 用）

### SPA と滞在時間

- シングルページのため、**ハッシュ変更ごと**に `page_view`（`gtag`）を送り、画面単位の滞在を GA4 に寄せる。
- **大会動画**（`#videos`）と **MarchinZ Note（練習日記）**（`#profile?…&tab=logdiary`）では、表示中かつタブが前面のとき **30 秒ごと**に `mz_core_engagement_pulse` を送り、パラメータ `engagement_time_msec`（30000）を付与（GA4 のエンゲージメント指標の補助）。

- `tab`, `has_team`, `has_event`, `has_free`（`search_run` 用）
- `target`, `list_id`（`mylist_add` 用）
- `kind`, `target`（`share_click` 用）

BigQuery で生イベントを突き合わせる手順は **`docs/ANALYTICS_BIGQUERY.md`** を参照。

## 次フェーズ（実装済み — v1.20.0, 2026-05-14）

以下は実装済み。`window.MarchinZTrackEvent` 経由で Plausible / GA4 / localStorage カウンタに送信される。

- `login_error`
  - タイミング: Google ログイン/新規登録の `.catch()` 内
  - params: `method`（`google`）, `intent`（`login` / `signup`）, `error_code`
  - 実装箇所: `auth.js`
- `signup_consent_blocked`
  - タイミング: 新規登録ボタン押下時に規約チェックボックス未同意 or 属性未選択で中断
  - params: `reason`（`checkbox_unchecked` / `no_attributes`）
  - 実装箇所: `auth.js`
- `search_result_empty`
  - タイミング: 大会動画の `applyFilter()` で検索条件あり＆結果 0 件
  - params: `team`, `free`, `tab`
  - 実装箇所: `app.js`
- `video_open`
  - タイミング: 動画リンク（YouTube 等）クリック時
  - params: `platform`（`embed_modal` / `web` / `web_fallback` — 旧 `youtube_app_attempt` は 1.26.39 で廃止）
  - 実装箇所: `app.js` の `enhanceVideoLink` / `MarchinZYouTubePlayer.openEmbed`

## β前拡張（実装済み — v1.25.41, 2026-05-19）

プライバシー: **検索語・表示名・投稿本文・UID 全文は送らない**。件数はバケット化（`result_bucket` 等）。

### 認証・法務・β

| イベント | タイミング | params |
|----------|------------|--------|
| `legal_policy_accept` | 規約モーダル同意成功 / 新規登録時の初回記録 | `flow`（`gate` / `signup`）, `version` |
| `b_test_consent_accept` | β規約同意保存成功（モーダル）/ 新規で payload に付与 | `flow`（`modal` / `signup`）, `version` |
| `b_test_gate_signout` | βモーダルでログアウト | `flow`（`modal`） |
| `signup_complete` | 新規登録後の初回プロフィール保存成功 | `has_attributes`（`0` / `1`） |
| `account_withdraw_complete` | 退会フロー完了 | — |
| `account_banned_view` | 凍結ダイアログ表示 | `surface`（`login`） |

### 大会動画・マイリスト

| イベント | タイミング | params |
|----------|------------|--------|
| `search_result_view` | 検索条件ありで `applyFilter()` 完了 | `tab`, `has_team`, `has_event`, `has_free`, `result_bucket`（`0` / `1-10` / `11-50` / `51+`） |
| `mylist_remove` | マイリストから動画/チャンネル削除成功 | `target`（`video` / `youtube_channel`）, `list_id` |

### Note・プロフィール・コミュニティ

| イベント | タイミング | params |
|----------|------------|--------|
| `note_save_success` | Note 保存成功 | `visibility`（`public` / `private`）, `has_cover`, `is_new` |
| `profile_tab_view` | プロフィールタブ切替 | `tab`, `is_own` |
| `community_post_submit` | 掲示板の新規話題投稿成功 | `has_image`, `theme` |
| `community_reply_submit` | 掲示板返信成功 | `has_image` |
| `community_search_run` | 掲示板フリーワード検索（250ms デバウンス後） | `has_query` |

### 安全・レート制限

| イベント | タイミング | params |
|----------|------------|--------|
| `report_submit` | 通報送信成功 | `target_type`（`community` / `note` / `mylist_videos` / `mylist_yt`） |
| `rate_limit_hit` | `MarchinZRateLimit.check` が拒否 | `bucket`（`like` / `post` / `report` 等） |

### 滞在パルス（surface 追加）

`mz_core_engagement_*` の `surface` に **`community_browse`**（`#community`）、**`media_browse`**（`#media`）を追加（`site-nav.js`）。

### GA4 カスタム定義（追加分）

- `method`, `intent`, `error_code`（`login_error` 用）
- `reason`（`signup_consent_blocked` 用）
- `team`, `free`, `tab`（`search_result_empty` 用）
- `platform`（`video_open` 用）
- `flow`, `version`（`legal_policy_accept` / `b_test_consent_accept` 用）
- `has_attributes`（`signup_complete` 用）
- `result_bucket`, `has_team`, `has_event`, `has_free`（`search_result_view` 用）
- `visibility`, `has_cover`, `is_new`（`note_save_success` 用）
- `tab`, `is_own`（`profile_tab_view` 用）
- `has_image`, `theme`（コミュニティ投稿系）
- `has_query`（`community_search_run` 用）
- `target_type`（`report_submit` 用）
- `bucket`（`rate_limit_hit` 用）
