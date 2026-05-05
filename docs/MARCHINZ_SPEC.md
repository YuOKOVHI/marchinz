# MarchinZ（マーチンズ）仕様書

本書は **サイトの挙動・データ・セキュリティ** を開発・運営で共有するためのものです。**法的な拘束力がある利用条件・個人情報の取扱い**は、サイト上の **利用規約（`#terms`）** と **プライバシーポリシー（`#privacy`）** を正とします。本書と矛盾する場合は、規約類および実際の表示を優先して解釈してください。

- **実装の所在**: `010_MarchinZ/`（SPA は `index.html` + ハッシュルーティング）
- **関連ドキュメント**: `docs/SECURITY_CHECKLIST.md`（App Check・課金等）、`docs/ACCOUNT_AND_USER_PAGES.md`（アカウント UI・退会）、`docs/OPS_GUIDE.md`（運用・CSV・Firebase）、`docs/USER_FEATURES.md`（利用者向け機能一覧）

---

## 1. 入会・認証・法的文書

### 1.1 認証方式

- **Firebase Authentication** の **Google アカウント連携**のみ（メール／パスワード登録はサイト側では提供しない）。
- 接続情報は **`auth-config.js`** の `window.MLL_AUTH_CONFIG.firebase`（および App Check 用 `appCheck`）。

### 1.2 入会・ログイン画面

| ハッシュ | 用途 |
|----------|------|
| `#signup` | 新規利用の入口。利用規約・プライバシーポリシーへの **チェックボックス同意** が必須（`index.html` の `#page-signup`）。 |
| `#login` | 既存ユーザーのログイン入口（`#page-login`）。 |

- **`return_to` クエリ**（`site-nav.js` の `buildAuthEntryUrl`）: ログイン／登録完了後に **直前のページへ戻る** ためのスナップショット URL を `sessionStorage` / クエリで保持する。
- **`from` クエリ**: `#signup` から遷移したときの導線識別子（分析・文言差分用。任意）。

### 1.3 利用規約・プライバシーポリシー

| ハッシュ | 内容 |
|----------|------|
| `#terms` | **利用規約**（静的本文 `index.html` の `#page-terms`）。 |
| `#privacy` | **プライバシーポリシー**（同 `#page-privacy`）。 |

- コミュニティ等の **初回利用時モーダル**でも同意を求める実装がありうる（機能モジュール側）。グローバルヘッダー直下に常設の同意フォームは置かない方針（`docs/ACCOUNT_AND_USER_PAGES.md` と整合）。

### 1.4 認証導線の方針（`login` と `signup` の使い分け）

実装上、次のように寄せています（厳密な強制ではなく、UX の意図）。

| 状況 | 主に使うモード | 実装例 |
|------|----------------|--------|
| いいね・再ログイン相当・既存アカウント想定 | `login` | MLL いいね、コミュニティいいね／返信／編集、イベントいいね・参加スタイル |
| 新規登録・マイリスト追加・初回投稿の意図が強い | `signup` | MLL フォーム送信、コミュニティ新規投稿、イベント登録ボタン／送信、動画／YouTube マイリスト |

### 1.5 アカウント凍結（BAN）

- **目的**: 利用規約違反等により、同一 Google での再ログインを拒否し、**書き込み系操作**を Firestore ルールで拒否する。
- **データ**: `mll_profiles/{uid}` に **`banned`**（bool）、**`banned_at`**（ISO 文字列、解除時は空文字可）、**`banned_reason`**（任意・最大 500 文字。運用メモ。公開プロフィール本文には出さない実装）。
- **ログイン時**（`auth.js` の `onSignedIn`）: `banned == true` のプロフィールを検知したら **即 `signOut`** し、アラートで「利用規約により凍結」と案内（問い合わせは `#ops`）。
- **管理者 UI**: `auth-config.js` の **`adminEmails`** でヘッダー「管理者」扱いになるユーザーが、**他ユーザーの** `#profile?uid=…` を開いたときだけ `#prof-admin-ban-panel` を表示し、凍結／解除を `mll_profiles` の **`update`（該当フィールドのみ）** で行う（`user-profile-page.js`）。**Firestore 側の許可は `mll_privileged_uids` の UID**（`firebase/firestore.rules` の `isPrivileged()`）なので、画面の管理者と凍結操作を一致させる運用にすること。
- **ルール**（`firebase/firestore.rules`）:
  - **`requesterCanAct()`** = 退会していない **かつ** 凍結されていない操作者のみ、従来 `requesterProfileNotWithdrawn()` が要求していた **作成・更新・削除** の多くを許可。
  - **凍結の付与・解除**は **`mllProfileBanAdminPatchOk`**（`mll_privileged_uids` の管理人が **他者 UID** に対し、`banned` / `banned_at` / `banned_reason` / `updated_at` **のみ**を変更する diff）に限定。
  - **MLL いいねのみパッチ**（`isMllLogLikeOnlyPatch`）は凍結ユーザーのキー操作を拒否（二重防御）。
- **既存ログの read**: TOP／プロフィールの **`mll_logs` 一覧クエリ**は従来どおり広い `orderBy` のため、**投稿者が凍結でも既存の公開ログが読める可能性**は残す（クエリとルールの整合の都合）。凍結の主効果は **ログイン拒否** と **書き込み禁止**。
- **運用・連絡**: 本仕様や利用者向け説明に影響する変更を入れたら **本書および関連ドキュメントを同じ変更単位で更新**し、チーム／利用者への **連絡**（リリースノート・チャット等）を行う。

---

## 2. ページ（ハッシュ）一覧と用途

ルーティングは **`site-nav.js`**（`pageFromHash` / `showPage`）。`#profile?uid=…&tab=…` のように **クエリ付きハッシュ** がある場合、ページ ID は `profile` までを切り出す。

| ハッシュ（例） | 画面 | 主な JS |
|------------------|------|----------|
| `#mll` | TOP（ランディング + Marching Life Log） | `mll.js` |
| `#events` | イベント一覧・登録・参加 | `calendar-events.js` |
| `#community` | コミュニティ掲示板 | `community.js` |
| `#profile` / `#profile?uid=&tab=` | プロフィール（マイページ相当） | `user-profile-page.js`, `event-log-diary.js` |
| `#videos` | 大会動画検索・マイリスト | `app.js`, `mll-video-mylist.js` |
| `#youtube` | YouTube チャンネル一覧・マイリスト | `youtube-channel-mylist.js`, `site-nav.js`（一覧データ） |
| `#webmagazine` / `#creators` / `#ops` | 静的コンテンツ | `index.html`, `site-nav.js` |
| `#terms` / `#privacy` | 利用規約・プライバシー | `index.html` |
| `#login` / `#signup` | ログイン・新規登録 | `index.html`, `auth.js` |
| `#moderation` | 通報管理（**管理人のみ**） | `community.js` 等。未権限で `#moderation` へ来た場合は `#mll` に寄せる。 |

- **OG / Twitter メタ**: `site-nav.js` の `updateMetaForPage`。`#profile` では **現在のハッシュ全文**（`uid` / `tab` 付き）を `og:url` に反映する（`MarchinZRefreshSeoFromLocation` で再計算可）。
- **プロフィールタブ**: ユーザーがタブをクリック／矢印キーで切り替えたとき、**`history.replaceState`** で `#profile?uid=…&tab=…` を同期する（`user-profile-page.js`）。

---

## 3. ユーザー操作（機能別）

### 3.1 TOP — Marching Life Log（`mll.js`）

| 操作 | 未ログイン | ログイン済み |
|------|------------|--------------|
| **一覧表示** | Firestore の **`mll_logs` のうち**、ドキュメントが **公開**（`visibility` 未設定は公開扱い）かつ、投稿者の **`mll_profiles` の `section_vis_mll` が公開**のものを、他ユーザーのログも **読める**（`firebase/firestore.rules` の read 条件）。ローカル `localStorage`（`marchinz_mll_logs_v1`）とマージ表示。 | 上記に加え、**自分の非公開ログ**も読める。 |
| **新規保存** | 不可（メッセージで `#signup` / `#login` へ誘導）。 | 可。Firestore へ `mll_logs` 文書を作成。 |
| **いいね** | `#login` へ誘導。 | `liked_by` のみトランザクション更新。 |

- TOP 内の **簡易プロフィールカード**（ユーザー名クリックで開くパネル）から、**`#profile?uid=`** への「プロフィールページを開く」リンクがある（`mll.js`）。

### 3.2 コミュニティ（`community.js`）

| 操作 | 未ログイン | ログイン済み |
|------|------------|--------------|
| **話題一覧の閲覧** | 可（`mll_community_posts` read 許可）。 | 可。 |
| **新規話題・返信・画像付き投稿** | `#signup` へ誘導（意図フラグを `sessionStorage` に保存する場合あり）。 | 可（Storage 未設定時は画像なしのみ等の制約あり）。 |
| **いいね** | `#login` へ誘導。 | 可。 |
| **編集・削除** | 不可。 | 投稿者本人または管理人。退会済み本人は削除不可（ルール／UI）。 |
| **通報** | ログイン必須。 | `mll_community_reports` へ作成。管理人は `#moderation` で確認。 |

### 3.3 イベント（`calendar-events.js`）

| 操作 | 未ログイン | ログイン済み |
|------|------------|--------------|
| **一覧閲覧** | 可（`mll_calendar_events` / `attendees` は read 許可）。 | 可。 |
| **いいね** | `#login` へ誘導。 | 可。 |
| **参加スタイル** | `#login` へ誘導。 | ダイアログから `attendees/{uid}` を更新。 |
| **新規イベント登録** | 「イベントを登録」ボタンで **`#signup`** へ（未ログイン時）。 | フォーム展開後に入力・送信。 |
| **編集・削除** | 不可。 | 作成者または管理人。 |

### 3.4 大会動画（`app.js` 等）

- 検索・並べ替え・ページング・シェア。**ログイン不要**（データは `data.inline.js` 等）。
- **マイリスト**（`mll-video-mylist.js`）: 追加はログイン必須（未ログインは `#signup` へ）。

### 3.5 YouTube（`youtube-channel-mylist.js`, `site-nav.js`）

- チャンネル一覧の閲覧は **ログイン不要**。
- **チャンネルマイリスト保存**はログイン必須（未ログインは `#signup` へ）。

### 3.6 プロフィール編集・設定・退会（`auth.js`）

- **プロフィール編集モーダル**: 表示名・アバター・カバー（Storage `mll_profile_media/{uid}/`）。
- **設定モーダル**: 退会説明と **アカウント削除（退会）**。再認証後に Storage / Firestore サブコレクション削除、`mll_profiles` を `withdrawn: true` にし、**Firebase Auth ユーザーを削除**（詳細は `docs/ACCOUNT_AND_USER_PAGES.md`）。
- **ヘッダー**: アバター＋名前は **`#profile`**（本人）へのリンク。メニューに「プロフィールを見る」。

---

## 4. マイページ（定義）

本サイトにおける **「マイページ」に相当する画面**は **`#profile`（プロフィールページ）** とする。

- **`#profile`**（`uid` 省略）: ログイン中は **自分の UID** で表示（`user-profile-page.js` の `uidFromRoute`）。
- **`#profile?uid={他人UID}`**: 他人の公開プロフィール。**未ログイン**でもヘッダー・カバー・公開設定に応じた **タブの存在**は見えるが、MLL・マイリスト・Log日記の **本文データは「公開かつログイン」など条件付き**（下記 5 章）。
- **タブ**: Marching Life Log / 大会動画マイリスト / YouTube マイリスト / Log日記。`role="tablist"` / `role="tab"` / `role="tabpanel"` と **矢印キー**でフォーカス移動可能。

---

## 5. 公開設定・プライバシー（データ観点）

- **`mll_profiles` の `section_vis_mll` / `section_vis_videos` / `section_vis_yt` / `section_vis_logdiary`**: `public`（未設定も公開扱い）または `private`。
- **`mll_logs.visibility`**: `public` または `private`（未設定は公開扱い）。**非公開は本人＋Firestore ルール上の読み取り条件でのみ**閲覧可能。
- **プロフィール未ログイン閲覧**: 公開タブでも **Log日記（`event_log_diaries`）の read はルール上ログイン必須**のため、UI 上は **登録を促すゲート**を表示（`user-profile-page.js` の `PROF_AUTH_GATE_NOTE`）。
- **コミュニティ投稿本文**は `mll_community_posts` に保存。画像 URL は Storage パスに紐づく。

---

## 6. 退会・アカウント削除

- 画面文言・削除範囲の要約は **`docs/ACCOUNT_AND_USER_PAGES.md` の「退会仕様」** を参照。
- 実装は **`auth.js`**（再認証 → Storage 削除 → サブコレクション削除 → `mll_logs` の `user_id` 一致削除 → `mll_profiles` を tombstone 化 → `currentUser.delete()`）。
- **`mll_community_reports`**: クライアントからの **delete はルール禁止**のため、退会フローでは削除しない（運用で Admin SDK 対応が必要なら別途）。

---

## 7. セキュリティ

### 7.1 Firestore

- ルールの正本: **`firebase/firestore.rules`**（本番は Console または Firebase CLI でデプロイ）。
- **管理人**: `mll_privileged_uids/{uid}` に **Auth UID をドキュメント ID** として登録（クライアントからの read/write は禁止）。クライアント上の「管理者メニュー」は **`auth-config.js` の `adminEmails`** と Auth のメール照合（`auth.js`）。
- **プロフィール更新**: `mll_profiles` はキー allowlist。退会済み（`withdrawn: true`）の **本人による新規書き込み**は拒否（`requesterProfileNotWithdrawn`）。
- **いいね系**: `liked_by` の diff が **自分の UID のキーのみ**であることを検証する関数を使用（改ざん抑止）。

### 7.2 Storage

- ルールの正本: **`firebase/storage.rules`**。プロフィール・コミュニティ・Log日記画像は **UID 配下パス**に制限。

### 7.3 App Check

- **`auth.js`** で reCAPTCHA v3 プロバイダを初期化可能。運用は **`docs/SECURITY_CHECKLIST.md`** に従い、本番では Enforcement を段階的に有効化する。

### 7.4 クライアント側の入力制御

- 画像は **canvas 等で JPEG 再エンコード**（プロフィール・コミュニティ・Log日記）。完全なバイト検証はルール・ブラウザのみでは限界がある点は **SECURITY_CHECKLIST** の推奨事項に記載。

---

## 8. 通報・モデレーション

- ユーザーは **通報**で `mll_community_reports` を作成し、対象投稿に **`reported_count` / `reported_at`** のみを書き込む（ルール上の制約）。
- **管理人**は `#moderation` で一覧・操作（`community.js`）。**未ログインまたは非管理人**は `#mll` へリダイレクト。

---

## 9. 主要データマップ（参照用）

| 種別 | パス / コレクション |
|------|---------------------|
| MLL ログ | `mll_logs/{logId}` |
| 公開プロフィール | `mll_profiles/{uid}`（`withdrawn`, **`banned`**, `banned_at`, `banned_reason` 等）およびサブコレクション `video_bookmarks`, `video_lists`, `channel_bookmarks`, `event_log_diaries` |
| イベント | `mll_calendar_events/{eventId}`, `attendees/{uid}` |
| 掲示板 | `mll_community_posts`, `mll_community_reports` |
| 採番 | `mll_meta/marchinz_public_id` |
| Storage（例） | `mll_profile_media/{uid}/`, `mll_community/{uid}/`, `mll_event_diary_media/{uid}/` |

---

## 10. 実装確認メモ（本仕様書との照合・2026-05-01 時点）

次をコードで確認済みとする（以降の変更では本節を更新するか、差分を PR 説明に書く）。

1. **`mll_logs` read**: 本人 **または**（**公開ドキュメント** かつ **`section_vis_mll` が公開**）は **未ログインでも read 可**（`firebase/firestore.rules`）。
2. **`mll.js`**: 未ログイン時の案内文は上記に合わせてある。
3. **`#profile`**: `index.html` に `#page-profile` が存在し、`user-profile-page.js` / `event-log-diary.js` が読み込まれている。`site-nav.js` が `MarchinZProfileHashParams` 等を定義し、`MarchinZUserProfile.onRouteShow` を `syncFromHash` から呼ぶ。
4. **プロフィールタブ**: `role="tablist"` 等。クリック／矢印で `tab=` を URL に同期し、`MarchinZRefreshSeoFromLocation` で OG URL を更新。
5. **イベント**: 未ログイン時の新規登録は「イベントを登録」から **`#signup`** へ（専用の傍注ブロックは置かない）。
6. **コミュニティリード文**: 閲覧可・投稿は登録必須と記載（`index.html`）。
7. **TOP の簡易プロフィール**: `mll.js` の `openUserProfile` が **`#profile?uid=`** へのリンクを出す。
8. **凍結（BAN）**: `auth.js` のログイン拒否、`user-profile-page.js` の管理者パネル、`firebase/firestore.rules` の `requesterCanAct` / `mllProfileBanAdminPatchOk` を本書 §1.5 と一致させる。

---

## 改訂履歴

| 版 | 日付 | 内容 |
|----|------|------|
| 1.0.0 | 2026-05-01 | 初版（実装照合・ルール変更・UI 改善を反映） |
| 1.0.1 | 2026-05-01 | 再照合: TOP 簡易プロフィールからフルプロフィールへのリンク（`mll.js`）を追記 |
| 1.0.2 | 2026-05-01 | アカウント凍結（BAN）: データ項目・ログイン拒否・管理者 UI・Firestore ルール・既存ログ read の注意（§1.5、§9、§10） |
| 1.0.3 | 2026-05-01 | イベント登録: 未ログイン時の傍注 `#calendar-ev-register-guest-note` を廃止。TOP Aパターン背景写真の opacity を finale 既定（0.15）に合わせる |
| 1.0.4 | 2026-05-01 | サイト表記 `data-mz-version` を **1.5.0**（マイナー）へ。次期開発: **ログイン機能の再実装**（`auth.js` 等）。 |
| 1.0.5 | 2026-05-01 | Firebase 未設定時: Google ボタンが無反応にならないよう `auth.js` でクリック案内（PATCH **1.5.1** と対応）。 |
