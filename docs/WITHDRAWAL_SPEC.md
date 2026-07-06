# MarchinZ アカウント削除（退会）仕様

実装の正は `auth.js`（`btn-account-withdraw`）および `firebase/firestore.rules` の `mll_profiles` / サブコレクションです。

## 前提条件（利用者）

- **Firebase Authentication に Google でログイン済み**であること（`auth.currentUser` が存在し、`uid` がアプリの `currentUser.id` と一致すること）。
- **localhost の開発者用ログイン**（`?dev_login=1` / `simulateLocalLogin`）のみの状態では、Firebase Auth が無いため **退会フローを実行できない**（明示的にブロックする）。

## 利用者が実行する操作

1. アカウントメニュー → **設定** → 「退会について」を開く → **アカウントを削除（退会）する**。
2. 確認ダイアログで同意。
3. **Google の再認証**（ポップアップ）。キャンセルした場合は退会しない。
4. 処理中は「退会処理中…」のオーバーレイを表示（二重実行防止でボタン無効化）。

## サーバー／クライアントで行うこと（順序）

1. **Firebase Storage**（該当ユーザーのみ）
   - `mll_event_diary_media/{uid}/` 以下を再帰削除
   - `mll_community/{uid}/` 以下を再帰削除
   - `mll_profile_media/{uid}/avatar.jpg` / `cover.jpg` を削除
2. **Firestore — `mll_profiles/{uid}` のサブコレクション**をクエリバッチ削除
   - `video_bookmarks`, `channel_bookmarks`, `video_lists`, `channel_lists`, `event_log_diaries`, **`notifications`**
3. **Firestore — `mll_logs`** で `user_id == uid` のドキュメントをバッチ削除
4. **Firestore — `mll_profiles/{uid}` ルート**
   - 既に `withdrawn: true` かつ `display_name: "退会ユーザー"` の場合は **ルート再書き込みをスキップ**（前回 Auth 削除のみ失敗した再試行用）
   - 途中失敗で `withdrawn` だけ立っている／表示名が未マスクの場合は **ルートを再 `set`**
   - 未退会のときのみ **allowlist 内のフィールドのみ**で `set` 全置換（`withdrawn: true`, `display_name: "退会ユーザー"`, 画像 URL 空 等）
   - **`created_at` / `marchinz_public_id` / 凍結系（`banned` 等）は維持**（運用・監査のため）
   - ルール `mllProfileSelfWithdrawOk` は **削除キーを `affectedKeys` で検証しない**（`request.resource.data.keys()` のみ検証）
5. **Firebase Authentication — `currentUser.delete()`**
   - 既に削除済み（`auth/user-not-found`）は成功扱い

## 残すデータ（ポリシー）

- **掲示板** `mll_community_posts`（投稿・スレッド）は削除しない（投稿者表示は `withdrawn` プロフィールでマスク）。
- **共有カレンダー** `mll_calendar_events` は削除しない（同上）。
- **プロフィールドキュメント**は残し、`withdrawn: true` で識別する。

## UI 完了後

- ローカルストレージのログキャッシュ等を削除し、ログアウト UI にし、**「退会が完了しました」**ダイアログを表示。
- TOP へ誘導。

## 既知の制約

- Firestore ルールにより、プロフィール更新は **allowlist キーのみ**許可。退会時パッチが未知キーを残すと `permission-denied` になるため、クライアント側で未知キーをストリップする。
