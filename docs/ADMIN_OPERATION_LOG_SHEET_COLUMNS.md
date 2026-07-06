# MarchinZ 管理者運用ログ（スプレッドシート列定義）

最終更新: 2026-05-06

## 推奨シート名

- `admin_operation_log`

## 列定義（左から順）

1. `record_id`（任意: `YYYYMMDD-HHMMSS-担当者` 形式）
2. `executed_at_jst`（実施日時）
3. `operator`（実施者）
4. `reviewer`（確認者・任意）
5. `ticket_or_note_url`（チケット/メモURL・任意）
6. `target_type`（投稿 / コメント / ユーザー / 権限）
7. `target_id`（投稿ID等）
8. `target_uid`（ユーザー操作時は必須）
9. `related_url`（画面URL・任意）
10. `operation`（権限付与 / 権限解除 / 非表示 / 復元 / 凍結 / 凍結解除 / その他）
11. `operation_detail`（実施内容詳細）
12. `reason`（実施理由）
13. `result`（成功 / 一部成功 / 失敗）
14. `user_side_check`（OK / NG / N/A）
15. `admin_side_check`（OK / NG / N/A）
16. `impact_scope`（影響範囲）
17. `follow_up`（追加対応・任意）
18. `before_state`（実施前状態・任意）
19. `after_state`（実施後状態・任意）
20. `reference_logs`（Netlify/FirebaseログURL等・任意）

## データ入力ルール

- `executed_at_jst`, `operator`, `operation`, `reason`, `result` は必須
- `operation` が `凍結` / `凍結解除` / `権限付与` / `権限解除` の場合、`target_uid` は必須
- `result` が `一部成功` / `失敗` の場合、`follow_up` を必須入力

## フィルタ例

- 期間: `executed_at_jst`
- 操作種別: `operation`
- 担当者: `operator`
- 対象UID: `target_uid`
- 結果: `result`

## 1行サンプル

- `20260506-190500-admin_a,2026-05-06 19:05,admin_a,admin_b,https://...,ユーザー,,abc123,#admin/reports,凍結,banned=trueに更新,利用規約違反の通報複数件,成功,OK,OK,対象ユーザーのみ,なし,banned=false,banned=true,https://...`
