# 分析イベント設計（初期版）

MarchinZ の改善判断に使う、最小イベントセットです。  
既存実装に合わせて、イベント名・発火タイミング・主要パラメータを固定します。

## イベント一覧

- `login_start`
  - タイミング: Google ログイン/新規登録ボタン押下時
  - params: `entry` (`login` / `signup` / `unknown`)
- `login_success`
  - タイミング: 認証成功後、プロフィール同期完了時
  - params: `admin` (`1` or `0`)
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
- `login_success`: ログイン成功
- `search_run`: 動画検索実行
- `mylist_add`: マイリスト追加
- `share_click`: シェア操作

推奨運用:

- 週次レポートでは、イベント名ではなく上記の表示名で記載する
- `share_click` は `kind`（copy/x/line/facebook/instagram）別に分解して確認する
- `mylist_add` は `target`（video / youtube_channel）別に分解して確認する

## GA4 カスタム定義（必要時）

GA4 でパラメータ別分析をする場合、以下をイベントスコープで登録します。

- `entry`（`login_start` 用）
- `admin`（`login_success` 用）
- `tab`, `has_team`, `has_event`, `has_free`（`search_run` 用）
- `target`, `list_id`（`mylist_add` 用）
- `kind`, `target`（`share_click` 用）

## 次フェーズ候補

- 追加で見ると有効なイベント:
  - `login_error`（エラーコード分類）
  - `search_result_empty`（0件率）
  - `video_open` の詳細分解（web/app）
  - `signup_consent_blocked`（同意未チェックで離脱）
