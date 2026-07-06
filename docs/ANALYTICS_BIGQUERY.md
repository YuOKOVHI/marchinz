# GA4 / Firebase Analytics → BigQuery（検討・確認用）

MarchinZ のイベントは **`gtag` が有効な環境**で GA4 に送られます（実装は `marchinz-analytics.js` / `auth.js` / `app.js` 等）。  
ヤマハ向けに **生ログをパート別滞在などで集計**する場合、**GA4 の BigQuery エクスポート**が定石です（リポジトリ内のコードではなく **Google 側コンソールの設定**）。

## 確認・有効化の手順（プロジェクト管理者）

1. [Google Analytics](https://analytics.google.com/) で対象の **GA4 プロパティ**を開く。
2. **管理** → **プロダクトのリンク** → **BigQuery のリンク**（または「BigQuery Links」）。
3. リンク先の **GCP プロジェクト**と **データセットのリージョン**を選び、**日次エクスポート**（および必要なら **ストリーミング**）を有効化する。
4. 初回テーブルが出るまで **24〜48 時間**かかることがある。

エクスポート後、BigQuery では通常:

- データセット: `analytics_<プロパティID>`
- 日次テーブル: `events_YYYYMMDD`
- _intraday テーブル（ストリーミング利用時）

に `event_name`, `event_params`, `user_pseudo_id`, タイムスタンプなどが載る。

## MarchinZ で重点的に見るイベント名（例）

| event_name | 用途の目安 |
|------------|------------|
| `login` | GA4 推奨（`method: google`） |
| `login_action` | カスタム・明示的ログイン回数 |
| `page_view` | SPA 補正用（`mz_page_id` 等のパラメータ付き） |
| `mz_route_view` | ルート単位の補助ログ |
| `mz_core_engagement_pulse` | 動画一覧・Note・コミュニティ・メディア等の **30 秒パルス**（`surface`, `engagement_time_msec`） |
| `search_result_view` | 大会動画検索の結果件数バケット（`result_bucket`） |
| `signup_complete` / `b_test_consent_accept` / `legal_policy_accept` | β・新規登録ファネル |
| `note_save_success` / `community_post_submit` | UGC（Note・掲示板） |
| `report_submit` / `rate_limit_hit` | 安全・運用 |

## SQL の方向性（例）

- **画面別滞在の近似**: `page_view` または `mz_route_view` の間隔、`mz_core_engagement_pulse` の回数 × 30 秒を組み合わせる。
- **ログイン回数**: `event_name = 'login'` または `login_action` で `COUNT(*)`。

詳細なクエリはエクスポート後のスキーマ（`event_params` の REPEATED 構造）に合わせて調整する。

## 本リポジトリとの関係

- **Firebase Authentication / Firestore** の BigQuery エクスポートとは別物（必要なら Firebase コンソールの Extensions / 別リンクでも設定可能）。
- 本ドキュメントは **GA4 → BigQuery** を指す。
