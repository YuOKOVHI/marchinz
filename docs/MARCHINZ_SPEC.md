# MarchinZ（マーチンズ）仕様書

本書は **サイトの挙動・データ・セキュリティ** を開発・運営で共有するためのものです。**法的な拘束力がある利用条件・個人情報の取扱い**は、サイト上の **利用規約（`#terms`）** と **プライバシーポリシー（`#privacy`）** を正とします。本書と矛盾する場合は、規約類および実際の表示を優先して解釈してください。

- **実装の所在**: `010_MarchinZ/`（SPA は `index.html` + ハッシュルーティング）
- **関連ドキュメント**: `docs/SECURITY_CHECKLIST.md`（App Check・課金等）、`docs/ACCOUNT_AND_USER_PAGES.md`（アカウント UI・退会）、`docs/OPS_GUIDE.md`（運用・CSV・Firebase）、`docs/USER_FEATURES.md`（利用者向け機能一覧）、`docs/MLL_CALENDAR_LIFECYCLE_DISCUSSION.md`（MarchinZ Log とイベント掲示のライフサイクル — 協議用ドラフト）
- **改訂履歴の「版」**: `index.html` の **`data-mz-version`**（サイトの表示版）と同じ番号に揃える。サイト版が無いドキュメント整備のみは **—**。

---

## 1. 入会・認証・法的文書

### 1.1 認証方式

- **Firebase Authentication** の **Google アカウント連携**のみ（メール／パスワード登録はサイト側では提供しない）。
- 接続情報は **`auth-config.js`** の `window.MLL_AUTH_CONFIG.firebase`。

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

- **版管理**: `auth.js` の `LEGAL_POLICY_VERSION`（例: `2026-05-20-v1`）と Firestore `mll_profiles.legal_policy_accepted_version` を一致させる。改定時は版を上げ、**ログイン済み既存ユーザー**に「ご利用にあたっての確認」モーダル（`#mz-legal-policy-dialog`）で再同意を求める。新規は `#signup` のチェックで同意記録。
- コミュニティ等の **初回利用時モーダル**でも同意を求める実装がありうる（機能モジュール側）。グローバルヘッダー直下に常設の同意フォームは置かない方針（`docs/ACCOUNT_AND_USER_PAGES.md` と整合）。

### 1.3.1 βテスト規約への同意

- **目的**: βテスト（試験運用）期間中の動作確認。UI改善試験ではない。データが保存されない・失われる可能性等を利用者に明示（プライバシーポリシー第7項・同意モーダル）。ユーザー向け表記は **「βテスト」に統一**（Bテスト・ベータテストは使わない）。
- **新規**: `#signup` に「βテストの規約に同意します」（任意チェック。オンで登録時に同意を記録）。
- **既存（ログイン）**: 利用規約モーダルの**後**に、βテスト規約モーダルを**必須**表示。チェック＋「同意して続ける」または「ログアウト」のみ（協力する／しないの二択はなし）。
- **設定**: 同意済みかどうかの表示のみ。
- **データ**: `b_test_consent_version`（版管理）、`b_test_opt_in`（同意時は `true`）、`b_test_opt_in_at`。実装は `marchinz-b-test.js`。

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
- **管理者 UI**: `auth-config.js` の **`adminEmails`** でヘッダー「管理者」扱いになるユーザーが、**他ユーザーの** `#profile?uid=…` を開いたときだけ `#prof-admin-ban-panel` を表示し、凍結／解除を `mll_profiles` の **`update`（該当フィールドのみ）** で行う（`user-profile-page.js`）。凍結時は **`section_vis_*` をすべて `private`** にし **`prof_count_*` を 0** に更新する（Log・Note・マイリストの他者 read はルールでも拒否）。**一覧・一括確認**は管理ページ **`#admin/banned`**（`marchinz-admin-banned.js`）。**他ユーザー向けプロフィール**はニックネーム・プロフィール画像・カバー写真のみ表示（自己紹介・タブ・一覧は非表示）。**Firestore 側の許可は `mll_privileged_uids` の UID**（`isPrivileged()`）なので、画面の管理者と凍結操作を一致させる運用にすること。
- **ルール**（`firebase/firestore.rules`）:
  - **`requesterCanAct()`** = 退会していない **かつ** 凍結されていない操作者のみ、従来 `requesterProfileNotWithdrawn()` が要求していた **作成・更新・削除** の多くを許可。
  - **凍結の付与・解除**は **`mllProfileBanAdminPatchOk`**（`mll_privileged_uids` の管理人が **他者 UID** に対し、`banned` / `banned_at` / `banned_reason` / `updated_at` **のみ**を変更する diff）に限定。
  - **MLL いいねのみパッチ**（`isMllLogLikeOnlyPatch`）は凍結ユーザーのキー操作を拒否（二重防御）。
- **既存ログの read**: TOP／プロフィールの **`mll_logs` 一覧クエリ**は従来どおり広い `orderBy` のため、**投稿者が凍結でも既存の公開ログが読める可能性**は残す（クエリとルールの整合の都合）。凍結の主効果は **ログイン拒否** と **書き込み禁止**。
- **運用・連絡**: 本仕様や利用者向け説明に影響する変更を入れたら **本書および関連ドキュメントを同じ変更単位で更新**し、チーム／利用者への **連絡**（リリースノート・チャット等）を行う。

### 1.6 サイト全体のお知らせ（運営）

- **データ**: Firestore `mll_site_announcements/current`（`title`, `body`, 任意の `link_href` / `link_label`, `active`, `published_at`, `updated_at`）。
- **表示**: ログイン済みユーザーのみ。**ヘッダー下バナー**（未読時）と、本人プロフィール **通知タブ先頭の運営カード**（既読後も履歴として残す）。
- **既読**: `mll_profiles/{uid}.last_read_announcement_at` が、配信中お知らせの `updated_at` 以上なら既読。バナーを閉じる／通知カードを開くと既読化し、**通知タブの未読バッジ**からは外れる。
- **配信 UI**: 管理者ページ **`#admin/announce`** の「サイトお知らせ」タブ（`marchinz-ops-announcement.js`）。**書込は `mll_privileged_uids` の UID**（§1.5 の凍結と同様）。Console 手動編集も可（`docs/OPS_GUIDE.md` §3.2）。旧 `#ops` 内フォームは廃止。
- **実装**: `marchinz-site-announcement.js`, `user-profile-page.js`（通知一覧・バッジ）, `firebase/firestore.rules`。

### 1.7 いいね通知（プロフィール受信箱）

- **データ**: `mll_profiles/{uid}/notifications`（`kind`, `actor_uid`, `target_id`, `target_title`, `read`, `created_at` 等）。作成は **いいねした本人（actor）** のみ（`marchinz-notify.js` → `MarchinZPushLikeNotification`）。
- **重複抑止**: **同一 actor × 同一 `kind` × 同一 `target_id`** について、直近 **72 時間** 以内に受信箱に通知があれば **新規作成しない**（`marchinz-notify.js` が直近 48 件を読み取りクライアント側で判定）。レート制限（いいね 20 回/分）とは別。
- **表示**: 本人プロフィール **通知タブ**のみ（`user-profile-page.js`）。未読／既読フィルタ、「既読にする」ボタン。actor 名・アバターは **`#profile?uid=`** へ遷移（SPA で `hashchange` を発火）。
- **既読**: 本人が `read: true` に更新（`notifReadMarkOk`）。**`read` 未設定・`false`・`null`** のドキュメントが対象（ルール `notifWasUnread`）。クライアントは **Firestore 更新成功後** に UI を既読へ切り替える（`user-profile-page.js`）。
- **設定**: 設定モーダル内の種別ごと表示 ON/OFF（`like_show_*` フィールド。`false` のとき通知を作成しない）。

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
| `#youtube` | YouTube チャンネル一覧・マイリスト | `youtube-list/youtube-channel-mylist.js`, `site-nav.js`（一覧データは `youtube-list/YouTubeリスト.csv` / `youtube-list/youtube-list.inline.js`。PR 時は `verify_youtube_list_csv_inline.py` で CSV と inline の一致を CI 検証） |
| `#webmagazine` / `#creators` / `#ops` | 静的コンテンツ | `index.html`, `site-nav.js` |
| `#terms` / `#privacy` | 利用規約・プライバシー | `index.html` |
| `#login` / `#signup` | ログイン・新規登録 | `index.html`, `auth.js` |
| `#admin` / `#ugc` / `#ugc/*` / `#admin/reports` / `#admin/announce` / `#admin/trash` | **管理（管理者専用）**：UGC 活動（独立ナビ `#ugc`）・通報・サイト全体お知らせ・イベントゴミ箱 | `marchinz-admin-ugc.js`、`community.js`、`marchinz-admin-page.js`、`marchinz-ops-announcement.js`、`marchinz-admin-trash.js`。未権限で `#admin` / `#ugc` 系へ来た場合は `#top` に寄せる。旧 **`#admin/ugc`** は `#ugc/signup` へ誘導。旧 **`#moderation`** は `#admin/reports` へ誘導。 |

- **OG / Twitter メタ**: `site-nav.js` の `updateMetaForPage`。`#profile` では **現在のハッシュ全文**（`uid` / `tab` 付き）を `og:url` に反映する（`MarchinZRefreshSeoFromLocation` で再計算可）。
- **プロフィールタブ**: ユーザーがタブをクリック／矢印キーで切り替えたとき、**`history.replaceState`** で `#profile?uid=…&tab=…` を同期する（`user-profile-page.js`）。

---

## 3. ユーザー操作（機能別）

### 3.1 TOP — Marching Life Log（`mll.js` / `mll-role.js`）

**参加スタイル（データ）:** Firestore `mll_logs.role` は `watch` / `perform` / `team_staff` / `ops`。表示用 `role_label` は `mll-role.js` の `buildRoleLabel` で生成。プロフィール集計は `inferRoleFromLog`（`role` 優先、無効時は `role_label` から推定）。

**文言:** MarchinZ Log の関わり方は **4種類のみ**（観戦・出演・チームスタッフ・スタッフ・運営）。イベント登録・編集の必須項目も同じラベル **「あなたの関わり方（MarchinZ Log）」** で、Firestore には `mll_calendar_events.participation_format`（値は `観戦` / `出演` / `チームスタッフ` / `運営`。UI では `運営` を **スタッフ・運営** と表示）と `mll_logs.role`（`watch` / `perform` / `team_staff` / `ops`）で対応する。


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
| **通報** | ログイン必須。 | `mll_community_reports` へ作成。管理人は **`#admin/reports`**（通報タブ）で確認。 |
| **フリーワード検索** | 可。 | 可。掲示板パネル上部の `#community-board-search` で投稿タイトル・本文・投稿者名・カテゴリ（返信本文も対象）をクライアント側フィルタ。250ms デバウンス。 |

### 3.3 イベント（`calendar-events.js`）

| 操作 | 未ログイン | ログイン済み |
|------|------------|--------------|
| **一覧閲覧** | 可（`mll_calendar_events` / `attendees` は read 許可）。 | 可。 |
| **いいね** | `#login` へ誘導。 | 可。 |
| **あなたの関わり方（Log）** | `#login` へ誘導。 | ダイアログから `syncUserInvolvementForCalendar`（`attendees/{uid}` + `mll_logs`）。**未記入に戻す**は `clearCommunityAttendanceForEvent` で **Log + `attendees` を削除**（**MarchinZ Note は残す**。確認ダイアログで案内）。残す Note の `participation_style` は空にし、一覧は「—」表示。 |
| **新規イベント登録** | 「イベントを登録」ボタンで **`#signup`** へ（未ログイン時）。 | フォーム展開後に入力・送信。 |
| **編集・削除** | 不可。 | 作成者または管理人。**削除**は物理削除ではなく `status: "trashed"` へ移動（ゴミ箱）。作成者の **MarchinZ Log のみ**物理削除。他人の Log・`attendees` は残す。一覧はクライアントで `trashed` を非表示。P0 の matchKey 再利用は **active のみ**（`mll-role.js`）。**運営復元**は **`#admin/trash`**（`marchinz-admin-trash.js`）で `status: active` に戻し、作成者を運営 UID に引き継ぐ。 |
| **MarchinZ Log（プロフィール）** | 閲覧のみ。 | 本人の **MarchinZ Log** タブの各行に「この MarchinZ Log を削除」。確認ダイアログあり。紐づくイベントを本人が作成した場合は「イベント掲示自体は削除されません」と表示（`user-profile-page.js`）。削除後、同一イベントに本人の Log が残っていなければ **`attendees/{uid}` も削除**（`cleanupCalendarAttendanceAfterLogDelete`）。**MarchinZ Note は残る**（Note を消す場合は Note タブで削除）。 |
| **MarchinZ Note（プロフィール）** | 公開タブ・公開 Note を閲覧（共有 URL も可）。 | 本人: 編集・削除。 |
| **テキスト検索** | 可。 | 可。イベントパネル上部の `#cal-ev-search` でタイトル・開催地・種別・作成者名をクライアント側フィルタ。250ms デバウンス。 |
| **絞り込み** | 可。 | 可。カード表示時 — **都道府県**・**開催年**（登録済みイベントに存在する値のみ、ドロップダウン）。「今後の開催のみ表示」と併用可。 |

### 3.4 大会動画（`app.js` 等）

- 検索・並べ替え・ページング・シェア。**ログイン不要**（データは `data.inline.js` 等）。
- **マイリスト**（`mll-video-mylist.js`）: 追加はログイン必須（未ログインは `#signup` へ）。**公開中のリスト**のシェアは、検索結果の動画行と同じ **「シェアする」** ドロップダウン（リンクコピー／SNS）と、締めの **「マーチンズからシェアしました♪」** 形式の文面（`MarchinZShareMenu.mylistShareText`）。

### 3.5 YouTube（`youtube-list/youtube-channel-mylist.js`, `site-nav.js`）

- チャンネル一覧の閲覧は **ログイン不要**。
- **掲載条件**: API 更新（`export_youtube_list_via_api.py`）では **3分00秒以下を除外**し、**3分01秒（181秒）以上**の動画のみ「最新動画」「視聴回数上位」「最新 LIVE」等に反映。ページ脚注は「*3分01秒未満の動画は表示されません。」
- **チャンネルマイリスト保存**はログイン必須（未ログインは `#signup` へ）。**公開中のリスト**のシェアは大会動画マイリストと同様（`MarchinZShareMenu`、YouTube用のシェア文）。

### 3.6 プロフィール編集・設定・退会（`auth.js`）

- **プロフィール編集モーダル**: 表示名・アバター・カバー（Storage `mll_profile_media/{uid}/`）。保存・キャンセルは **`mz-dialog-foot` でダイアログ最下部に固定**（フォーム本体のみスクロール）。
- **設定モーダル**: 退会説明と **アカウント削除（退会）**。再認証後に Storage / Firestore サブコレクション削除、`mll_profiles` を `withdrawn: true` にし、**Firebase Auth ユーザーを削除**（詳細は `docs/ACCOUNT_AND_USER_PAGES.md`）。
- **ヘッダー**: アバター＋名前は **`#profile`**（本人）へのリンク。メニューに「プロフィールを見る」。

### 3.7 いいね・通報・シェア（対象一覧）

| 操作 | 共通 UI | 補足 |
|------|---------|------|
| **いいね** | タイトル行の右横（`marchinz-engage-ui.js` の `appendInlineLike`） | 通知 `kind` は `marchinz-notify.js`。設定の `like_show_*` は **通知作成の ON/OFF**（ボタン表示ではない） |
| **通報** | **⋯ メニュー**（`buildReportOverflow`） | 自分のコンテンツは不可。レート制限は `report` バケット共通（3回/2分） |
| **シェア** | **「シェアする」** ドロップダウン（`app.js` の `MarchinZShareMenu`） | リンクコピー／X／LINE／Instagram（**URL のみコピー**）／Facebook。X・LINE 等は従来どおり文面＋URL。締めは多くが **「マーチンズからシェアしました♪」**（Log タブシェア文のみ例外）。MarchinZ サイト URL は **`?openExternalBrowser=1` をハッシュ（`#`）の前に自動付与**（LINE 外部ブラウザ起動対策。`MarchinZUrlShare.withOpenExternalBrowserParam` / `buildAbsoluteUrlForHash`） |

#### 統合一覧（対象 × 操作）

| 対象 | 主な画面 | いいね | 通報 | シェア | 実装・備考 |
|------|----------|:------:|:------:|:------:|------------|
| MarchinZ Log（1件） | TOP `#mll` | ○ | — | — | `mll.js` / `like_mll_log` |
| MarchinZ Log（1件） | プロフィール Log タブ | ○ | — | — | `user-profile-page.js` |
| MarchinZ Log（タブ全体・KPI付き） | プロフィール Log タブ | — | — | ○ | **本人のみ**。「MarchinZ Log をシェアする」→ `#profile?uid=&tab=mll`。Log タブ非公開時は案内のみ |
| コミュニティ投稿・返信 | `#community` 掲示板 | ○ | ○ | — | `community.js` / `like_community_post` / `mll_community_reports` |
| カレンダーイベント | `#events` | ○ | — | — | `calendar-events.js` / `like_calendar_event` |
| MarchinZ Note | プロフィール Note タブ・`#community/notes` | ○ | ○ | ○※ | `event-log-diary.js`・`mln-public-feed.js`。**本人のみ**「シェアする」（公開 Note のみ。`#profile?uid=&tab=logdiary&event=`）。※非公開・他人閲覧時はシェア UI なし |
| 大会動画（検索結果1行） | `#videos` 検索・おすすめ | — | — | ○ | `app.js` 各行「シェアする」。**ログイン不要** |
| 大会動画（検索条件まとめ） | `#videos` 上部・ページネーション | — | — | ○ | 「検索結果をシェアする」→ 現在の絞り込み URL |
| 大会動画マイリスト（リスト） | `#videos` マイリスト（本人） | ○ | — | ○ | `mll-video-mylist.js`。シェアはログイン時。リンク先は `#profile?uid=&tab=videos&mylist=` |
| 大会動画マイリスト（リスト） | プロフィール動画タブ（**公開**リスト） | ○ | ○ | ○※ | ※シェアは**本人のみ**（`showOwnerActions`）。他人閲覧時はいいね・通報のみ |
| 大会動画ブックマーク（1件） | プロフィール動画タブ（リスト**展開**後） | ○ | — | — | `user-profile-page.js` / `like_video_bookmark` |
| YouTube マイリスト（リスト） | `#youtube` マイリスト（本人） | ○ | — | ○ | `youtube-channel-mylist.js` |
| YouTube マイリスト（リスト） | プロフィール YouTube タブ（**公開**リスト） | ○ | ○ | ○※ | 大会動画マイリストと同型（シェアは本人のみ） |
| YouTube チャンネルブックマーク（1件） | プロフィール YouTube タブ（リスト**展開**後） | ○ | — | — | `like_channel_bookmark` |
| YouTube チャンネル（CSV一覧1行） | `#youtube` チャンネル一覧 | — | — | — | 閲覧のみ。マイリスト保存は `#signup` 誘導 |

**凡例**: ○ = 実装あり、— = なし（意図的に未提供または対象外）。

**プロフィール「他ユーザーの視点」プレビュー**（`data-mz-prof-guest-preview="1"`）: 編集・シェア・通報（マイリスト見出し右）・Log タブシェアは CSS で非表示（`styles.css`）。

**シェアの制約（実装どおり）**: MarchinZ Note・MarchinZ Moment は **本人のみ**個別 URL シェア可（公開 Note のみ。Moment は常公開だがシェア UI も本人のみ）。コミュニティ・イベント・TOP の個別 Log 行・ブックマーク1件・YouTube CSV 行にはシェア UI なし。マイリストシェアは **本人**が **公開リスト**を `#videos` / `#youtube` または**自分のプロフィール**から行う（他人のプロフィール閲覧時はシェアボタンなし）。受け取り側が開けるかは公開設定（`section_vis_*`・リスト `visibility`・Note `visibility`）に依存。Note の **共有 URL 閲覧**は `visibility: public` のみ（`section_vis_logdiary` 非問）。

### 3.8 UGC 三層（MarchinZ Moment / Note / Board）— **方針（2026-05 確定・段階実装）**

利用者が投稿するテキスト主体 UGC は、用途ごとに **3 種類**に分ける。MarchinZ Log（`mll_logs`）・マイリスト等は本節の対象外。

| 名称 | 用途 | 公開 | 返信 | 実装 |
|------|------|------|:----:|------|
| **MarchinZ Moment** | 気軽な短投稿（日常・練習のひとこと等） | **常に公開** ＋ 共有 URL | なし | **一部実装**（`#community/moments`・`mll-moment.js`） |
| **MarchinZ Note** | イベントにまつわる日記（観戦・出演・大会の思い出） | **公開 / 非公開**。公開時は **共有 URL で未ログイン閲覧可**（YAMAP 型） | なし | **一部実装**（URL 外部公開・Log 切り離しはこれから） |
| **MarchinZ Board** | 告知・質問・議論（掲示板） | 掲示板既存 | **あり（唯一）** | **実装済**（`community.js`） |

**使い分け（利用者向け文案）**

- **Moment** … 気軽に、その瞬間を（すべて公開）
- **Note** … イベントの思い出を丁寧に（公開/非公開を選べる）
- **Board** … みんなで話す（返信あり）

#### MarchinZ Moment（1.26.14 — コミュニティタブ）

- **名称**: **MarchinZ Moment**（確定。2026-05）。
- **コンセプト**: カジュアル UGC。X / タイムライン寄り。**非公開設定は設けない**（作成 UI は「公開」のみ表示）。
- **フィールド**: 本文（最大 **400 字**）・写真（1〜4枚）・表紙（`cover_photo_index`）。イベント名・MarchinZ Log 紐付けは **なし**。
- **コレクション**: `mll_profiles/{uid}/moments/{momentId}`（collection group 一覧）。
- **コミュニティ**: `#community/moments` — 公開 Moment 一覧・検索（本文・投稿者）・ログイン時「モーメントを投稿」。
- **いいね・通報**: `like_moment` / `mll_moment_reports`。
- **共有 URL**: `#community/moments?uid={uid}&moment={id}`（詳細モーダル）。プロフィールタブ連携・本人シェア UI は将来。
- **操作**: いいね・通報あり。返信なし（議論は Board へ）。

#### MarchinZ Note（改修方針 — **1.26.3 反映**）

MarchinZ Log 連携は **現状維持**（イベント紐付け・参加スタイル・`attendees` 等）。変更点は **公開 URL とシェア** のみ。

| 項目 | 内容 |
|------|------|
| **公開** | `visibility: public` → **共有 URL で未ログイン閲覧可**（YAMAP 型。`section_vis_logdiary` はプロフィール **一覧**用のみ） |
| **非公開** | 本人のみ。URL を知っていても **他人・未ログインは閲覧不可** |
| **共有 URL** | `#profile?uid={uid}&tab=logdiary&event={eventId}` |
| **シェア UI** | **本人のみ**。「シェアする」（`MarchinZShareMenu`・`canShareProfileMarchinZNote`）。公開 Note のみ（非公開は UI なし） |
| **MarchinZ Log シェア** | プロフィール Log タブ「MarchinZ Log をシェアする」— **本人のみ**（`#profile?uid=&tab=mll`）。他人・未ログインには非表示 |
| **Firestore read** | 未ログインは `visibility: public` のみ（`section_vis_logdiary` 不要） |

#### MarchinZ Board

- **閲覧**: 未ログインでも **質問カテゴリ以外** の話題を閲覧可。質問カテゴリは **ログインユーザーのみ**（Firestore ルール + UI）。
- **投稿・返信・いいね**: ログイン必須。未ログイン向けにリード文・「投稿する」付近で明示。
- **共有 URL**: `#community/board?thread={thread_root_id}`（Board 専用）。
- **シェア UI**: 元投稿（スレッド root）に **全員**「シェアする」。返信にはなし。**質問カテゴリにはシェアボタンなし**。
- **運営より**: 投稿作成時のカテゴリ選択は **運営（`isAdmin` / `mll_privileged_uids`）のみ**。一般ユーザーには UI 非表示 + Firestore create/update で拒否。
- 実装: `community.js` / `MarchinZShareMenu.boardShareText` / `firebase/firestore.rules`（`mll_community_posts` read）。
- Moment / Note から「議論したい → Board」への導線を将来追加可。

#### 実装フェーズ（目安）

| Phase | 内容 |
|-------|------|
| P1 | MarchinZ Note — **公開 URL・シェア・未ログイン閲覧**（**1.26.3**）。Log 連携は維持 |
| P2 | MarchinZ Moment — 新コレクション・作成 UI・フィード・通報（**1.26.14** コミュニティタブ） |
| P3 | コミュニティ UI 整理（Moment 投稿ボタン・Note 作成ボタンの分離） |
| P4 | 練習日記（Moment 拡張・構造化フィールド・匿名統計同意） |

---

## 4. マイページ（定義）

本サイトにおける **「マイページ」に相当する画面**は **`#profile`（プロフィールページ）** とする。

- **`#profile`**（`uid` 省略）: ログイン中は **自分の UID** で表示（`user-profile-page.js` の `uidFromRoute`）。
- **`#profile?uid={他人UID}`**: 他人の公開プロフィール。**未ログイン**でもヘッダー・カバー・公開設定に応じた **タブの存在**は見える。MarchinZ Log の本文は従来どおり条件付き。**大会動画マイリスト／YouTubeマイリスト**は、当該タブが公開かつ **各リストが `visibility: public`** のとき **未ログインでも本文を Firestore から表示**（`user-profile-page.js` / ルール参照）。Log日記は下記 5 章どおりゲート。
- **タブ**: Marching Life Log / 大会動画マイリスト / YouTube マイリスト / Log日記。`role="tablist"` / `role="tab"` / `role="tabpanel"` と **矢印キー**でフォーカス移動可能。

---

## 5. 公開設定・プライバシー（データ観点）

- **`mll_profiles` の `section_vis_mll` / `section_vis_videos` / `section_vis_yt` / `section_vis_logdiary`**: `public`（未設定も公開扱い）または `private`。
- **動画／YouTubeマイリストのリスト単位**: サブコレクション `video_lists` / `channel_lists` の **`visibility`**（`public` / `private`）。**プロフィール閲覧者（未ログイン含む）**が読めるのは、親プロフィールの **`section_vis_videos` / `section_vis_yt` が公開**かつ、当該リスト文書が **`public`** の組み合わせに限る（`video_bookmarks` / `channel_bookmarks` も同条件で `list_id` を参照してゲート。`firebase/firestore.rules`）。
- **`mll_logs.visibility`**: `public` または `private`（未設定は公開扱い）。**非公開は本人＋Firestore ルール上の読み取り条件でのみ**閲覧可能。
- **プロフィール未ログイン閲覧**: **`section_vis_*` が公開**のタブは、ログイン済みの他ユーザー閲覧と同様に本文を表示（Log / Note / マイリスト）。**非公開タブ**は「非公開です」ぼかし。**Note 共有 URL**（`#profile?uid=&tab=logdiary&event=`）はタブ非公開でも **当該 Note が `visibility: public` なら** `openViewer` で表示（`section_vis_logdiary` 非問）。
- **コミュニティ投稿本文**は `mll_community_posts` に保存。画像 URL は Storage パスに紐づく。

### MarchinZ Note と Log の参加スタイル（`participation_style`）同期

Note のタグ表示（「MarchinZ Log」バッジ＋観戦・出演等のチップ）は、**最新の MarchinZ Log**（`mll_logs` の `role` / `role_label`）と整合させる。

| 層 | タイミング | 実装 |
|----|------------|------|
| **1. 書き込み時の即時同期** | イベント詳細・マイページ等で Log の参加スタイルを保存したとき、または **MarchinZ Note 編集**で参加スタイルを変更したとき | `mll-role.js` — `syncUserInvolvementForCalendar` / `updateProfileLogParticipation` / **`syncParticipationForProfileEvent`**（Note 編集から一括）のあと、`syncDiariesParticipationStyleForUserEvent` で紐づく `event_log_diaries` の `participation_style` を更新。キーは **`calendar_event_id`（= Note ドキュメント ID）** または **`event_date` + `event_title`** の一致。 |
| **2. 一覧読み込み時の自己修復（バックフィル）** | 過去の同期漏れ・不整合の修復 | `mll-role.js` — `reconcileDiariesParticipationFromLogs`。対象 Note ごとに `mll_logs` を照会し、差異があれば **表示用メモリの `participation_style` を必ず上書き**。Firestore の Note 更新は **Note 所有者が閲覧者と一致するときのみ**（他人の Note はルールで `update` 不可のため、コミュニティ一覧はメモリ反映が主）。呼び出し: **コミュニティ Note 一覧**（`mln-public-feed.js`）、**プロフィール Log日記タブ**（`event-log-diary.js`）。Log 突合キーは `calendar_event_id` または **日付+タイトル**（venue は無視）。 |

**データの正:** 表示用ラベルは Note フィールド `participation_style` を読むが、上記 2 層で Log 由来の最新ラベル（`participationFormatLabel` 経由）に揃える。

### イベント参加登録の作成・削除（Log / attendees / Note）

コミュニティ（`#community/events`）とマイページ（プロフィール Log・Note）の両方から操作できる。**登録**は `syncUserInvolvementForCalendar`（`mll_logs` + `attendees` + Note の `participation_style` 更新）。**解除**は `removeUserInvolvementForCalendarEvent`（`mll-role.js`）。

| 操作 | UI（①コミュニティ / ②マイページ） | 書き込み | 解除（本人） |
|------|-----------------------------------|----------|--------------|
| **イベント掲示** 作成 | ① イベント登録フォーム | `mll_calendar_events` 新規 | 作成者・管理人: `status: trashed`（掲示のみ。他人 Log・`attendees` は原則維持） |
| **イベント掲示** 編集 | ① イベント編集モーダル | `mll_calendar_events` 更新。関わり方を選んだときのみ `syncUserInvolvementForCalendar` | 同上（ゴミ箱） |
| **MarchinZ Log** 登録 | ①「Logを残す」（黄色ボタン）／観戦ダイアログ | `syncUserInvolvementForCalendar` | ①「未記入に戻す」（確認あり）→ Log + `attendees` 削除。**Note は残す**（`participation_style` を空に） |
| **MarchinZ Log** 削除 | ② Log 一覧 ⋯「削除する」 | — | `mll_logs` 1件削除 → `pruneLocalMllLogsCacheForEvent` → 残 Log が無ければ `attendees` 削除。**Note は残す** |
| **MarchinZ Note** 作成・編集 | ①「Noteを書く」／② Note タブ | **新規**: 2段階（① Note 内容 → ② MarchinZ Log 参加スタイル → 保存）。`event_log_diaries` + `syncParticipationForProfileEvent` / `ensureAttendeeForDiarySave`。**編集**: 1画面。 | ② **編集画面「日記を削除」** → Note + Log + `attendees` 削除 |
| **MarchinZ Log** 参加スタイルのみ編集 | ② Log ⋯ 編集 | `updateProfileLogParticipation` または `syncParticipationForProfileEvent`（Note 編集時） | — |

一覧の再読込: `marchinz-mll-updated`（`calendar-events.js`・`mln-public-feed.js`・プロフィール `user-profile-page.js`・**Note タブ** `event-log-diary.js` の `#prof-log-diary-root` が購読）。

**コミュニティ一覧の Firestore（CG）:** クエリは `visibility == public` のみ。ルールも同条件＋本人 read（**Rules are not filters** — CG `read` に `profileOwnerActive` は載せない）。凍結・退会ユーザーの一覧除外は **`mln-public-feed.js` の `loadProfilesMinimal` → `hide`** のみ（1.25.64）。

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

- **クライアント**: `auth-config.js` の `appCheck.recaptchaSiteKey` が設定されているとき、`auth.js` が Firebase 初期化直後に **reCAPTCHA v3** で App Check を有効化する（未設定・空文字のときは **初期化しない**）。`MLL_AUTH.isAppCheckActive()` で有効か参照可能。localhost では `appCheck.debug` / `debugToken` でデバッグトークン運用。
- **運用（Console）**: Firebase Console → App Check で Web アプリ登録 → 本番でメトリクス確認 → **Firestore / Storage** の Enforcement を段階的に有効化（キー未設定のまま Enforcement だけオンにしない）。手順は `docs/SECURITY_CHECKLIST.md`。
- **Enforcement 状態（本番・2026-05-23 確認）**: **Cloud Firestore** 適用済み。**Storage** 適用済み（適用前メトリクス確認済み 100%・適用後プロフィール画像保存成功）。
- **ルール**: `firestore.rules` / `storage.rules` には App Check 条件は **未記載**（Enforcement を主とする。ルール多層防御は将来検討）。

### 7.4 クライアント側レート制限

- **`marchinz-rate-limit.js`** でスライディングウィンドウ方式の頻度制限を実装（`window.MarchinZRateLimit`）。
- 制限値: いいね 20回/分、投稿・返信 5回/分、イベント作成 3回/分、**通報 3回/2分**（掲示板通報・**マイリスト通報で共通の `report` バケット**）。
- 適用箇所: コミュニティいいね（`community.js`）、MLLログいいね（`mll.js`）、カレンダーイベントいいね（`calendar-events.js`）、動画/チャンネルブックマークいいね（`user-profile-page.js`）、**大会動画／YouTube のリスト単位いいね**（`mll-video-mylist.js`・`youtube-list/youtube-channel-mylist.js`）、Log日記いいね（`event-log-diary.js`・`mln-public-feed.js`）、投稿/返信送信（`community.js`）、イベント登録（`calendar-events.js`）、**掲示板・マイリスト・Note 通報**（いずれも `report` バケット。`community.js` / `user-profile-page.js` / `event-log-diary.js`）、いいね通知の **作成**（`marchinz-notify.js`・§1.7 の 72 時間重複抑止）。
- サーバー側（Firestore ルール / Cloud Functions）の制限は未実装。

### 7.5 クライアント側の入力制御

- 画像は **canvas 等で JPEG 再エンコード**（プロフィール・コミュニティ・Log日記）。完全なバイト検証はルール・ブラウザのみでは限界がある点は **SECURITY_CHECKLIST** の推奨事項に記載。

---

## 8. 通報・モデレーション

- **掲示板**: ユーザーは **通報**で `mll_community_reports` を作成し、対象投稿に **`reported_count` / `reported_at`** のみを書き込む（ルール上の制約）。クライアントでは **`MarchinZRateLimit.check("report")`**（3回/2分）を通過した場合のみ作成する。
- **マイリスト（プロフィール上の大会動画／YouTube リスト）**: 通報は **`mll_mylist_reports`** に **新規ドキュメント作成のみ**（更新・削除はクライアント不可）。**掲示板通報と同一の `report` レート制限**（3回/2分）を `user-profile-page.js` で適用する。
- **MarchinZ Note**: 通報は **`mll_note_reports`** に **新規ドキュメント作成のみ**（`event-log-diary.js`）。**同一 `report` レート制限**。管理人は **`#admin/reports` → MarchinZ Note** タブで時系列一覧と **`#profile?uid=&tab=logdiary&event=`** への導線を表示（Note 本文の一括非表示 UI は無し）。
- **管理人**は **`#admin/reports`**（通報タブ）で一覧を閲覧（`community.js`）。**コミュニティ**サブタブでは `mll_community_reports` に紐づく投稿の非表示・復元・削除。**マイリスト**サブタブでは `mll_mylist_reports` を時系列表示し、該当 **`#profile?uid=&tab=videos|yt&mylist=`** への導線を表示（リスト本体の一括非表示等はコミュニティと同一 UI には載せない）。**サイト全体お知らせ**は **`#admin/announce`**（`marchinz-ops-announcement.js`）。**イベントゴミ箱**は **`#admin/trash`**（`marchinz-admin-trash.js`）。**未ログインまたは非管理人**は `#top` へリダイレクト。
- **一括モデレーション（掲示板のみ）**: 管理人画面上部の検索は **各通報タブで共通**。コミュニティタブでは投稿者名・本文等で絞り込み、全選択チェックボックス、「一括非表示」「一括削除」を使用。一括操作は Firestore バッチ（400件チャンク）で実行し、完了後に1回だけ再読み込みする。マイリスト／Note タブでは **対象UID・理由等** で絞り込み（一括操作 UI は非表示）。

---

## 9. 主要データマップ（参照用）

| 種別 | パス / コレクション |
|------|---------------------|
| MLL ログ | `mll_logs/{logId}` |
| 公開プロフィール | `mll_profiles/{uid}`（`withdrawn`, **`banned`**, `banned_at`, `banned_reason` 等）およびサブコレクション `video_bookmarks`, `video_lists`, `channel_bookmarks`, `event_log_diaries` |
| イベント | `mll_calendar_events/{eventId}`, `attendees/{uid}` |
| 掲示板 | `mll_community_posts`, `mll_community_reports` |
| マイリスト通報 | `mll_mylist_reports`（プロフィール上のリスト単位。管理人 read、一般ユーザー create のみ） |
| MarchinZ Note 通報 | `mll_note_reports`（管理人 read、一般ユーザー create のみ） |
| 採番 | `mll_meta/marchinz_public_id`（**101 起算**の自動採番）。**1〜100** は運営向けに Firestore で手動設定可。画面表示は **常に 8 桁**（例: `1` → `00000001`、`103` → `00000103`）。 |
| Storage（例） | `mll_profile_media/{uid}/`, `mll_community/{uid}/`, `mll_event_diary_media/{uid}/` |

---

## 10. PWA（Progressive Web App）

- **マニフェスト**: `manifest.webmanifest`。`display: standalone`、`start_url: ./?source=pwa`。
- **アイコン**: `pwa/icon-192.png` / `pwa/icon-512.png`（`purpose: any`）、`pwa/icon-192-maskable.png` / `pwa/icon-512-maskable.png`（`purpose: maskable`）。maskable はテーマカラー（`#0f2138`）の背景に 80% サイズで配置。
- **ショートカット（`shortcuts`）**: 「イベントを見る」（`#community`）、「動画を検索」（`#videos`）、「マイページ」（`#profile`）の 3 件。ホーム画面長押しで表示。
- **スクリーンショット（`screenshots`）**: `ogp-card.png`（1200×630、`form_factor: wide`）。インストールプロンプトの品質向上用。
- **Service Worker**: `sw.js`。`networkFirst`（HTML・API）+ `staleWhileRevalidate`（静的リソース）。キャッシュキー `marchinz-pwa-v{version}` で activate 時に旧キャッシュを削除。

---

## 11. 実装確認メモ（本仕様書との照合）

次をコードで確認済みとする（以降の変更では本節を更新するか、差分を PR 説明に書く）。

1. **`mll_logs` read**: 本人 **または**（**公開ドキュメント** かつ **`section_vis_mll` が公開**）は **未ログインでも read 可**（`firebase/firestore.rules`）。
2. **`mll.js`**: 未ログイン時の案内文は上記に合わせてある。
3. **`#profile`**: `index.html` に `#page-profile` が存在し、`user-profile-page.js` / `event-log-diary.js` が読み込まれている。`site-nav.js` が `MarchinZProfileHashParams` 等を定義し、`MarchinZUserProfile.onRouteShow` を `syncFromHash` から呼ぶ。
4. **プロフィールタブ**: `role="tablist"` 等。クリック／矢印で `tab=` を URL に同期し、`MarchinZRefreshSeoFromLocation` で OG URL を更新。
5. **イベント**: 未ログイン時の新規登録は「イベントを登録」から **`#signup`** へ（専用の傍注ブロックは置かない）。
6. **コミュニティリード文**: 閲覧可・投稿は登録必須と記載（`index.html`）。
7. **TOP の簡易プロフィール**: `mll.js` の `openUserProfile` が **`#profile?uid=`** へのリンクを出す。
8. **凍結（BAN）**: `auth.js` のログイン拒否、`user-profile-page.js` の管理者パネル、`firebase/firestore.rules` の `requesterCanAct` / `mllProfileBanAdminPatchOk` を本書 §1.5 と一致させる。
9. **クライアント側レート制限**: `marchinz-rate-limit.js` がいいね・投稿・返信・イベント作成・**通報（掲示板・マイリスト・Note 共通 `report`）**の全操作に適用されていることを確認（§7.4）。
10. **コミュニティ検索**: `community.js` の `communitySearchQuery` がタイトル・本文（`content`）・投稿者名・カテゴリ・返信本文にマッチすることを確認。
11. **イベント検索**: `calendar-events.js` の `eventSearchQuery` がタイトル・開催地・種別・作成者名にマッチすることを確認。
12. **モデレーション一括操作（掲示板）**: コミュニティタブで検索フィルタ、全選択、一括非表示（`updatePost` ループ）、一括削除（Firestore バッチ）が実装済み。N回 `refreshAll` の非効率は修正済み。**マイリスト通報**・**Note 通報**は別タブで `mll_mylist_reports` / `mll_note_reports` を表示。
13. **PWA マニフェスト**: maskable アイコン・shortcuts 3件・screenshots 1件が `manifest.webmanifest` に設定済み。
14. **分析イベント**: `login_error`・`signup_consent_blocked`・`search_result_empty` がコードに埋め込み済み。`video_open` は既存。
15. **管理者ページ**: `#admin/reports`・`#admin/announce`・`#admin/trash` が `site-nav.js` / `marchinz-admin-page.js` と一致し、旧 `#moderation` が `#admin/reports` に誘導されることを確認。
16. **いいね・通報・シェア対象**: §3.7 の統合一覧と `mll.js` / `community.js` / `calendar-events.js` / `event-log-diary.js` / `mln-public-feed.js` / `user-profile-page.js` / `app.js`（`MarchinZShareMenu`）/ マイリスト JS の実装が一致することを確認。

---

## 改訂履歴

| 版（`data-mz-version`） | 日付 | 内容 |
|----|------|------|
| 1.34.1 | 2026-07-12 | **UX/UIデザイナー+シニアエンジニアの2者レビュー反映**(v1.34.0公開後、デスクトップの実測: TODAY=460px中央ポツン/TOOLSボタン564×88/誘導1140px全幅と幅バラバラ)。[デザイン] ①TODAY・TOOLSランチャー/パネル・誘導カードを**同一のウィジェット幅 `--mz-widget-w: 640px` 中央**に統一(縦一列の「ウィジェットカラム」でリズムを揃える)。②ツール起動ボタンに **chevron(fa-chevron-down)** — 押すと開く手掛かり、開いている間は180度回転。[エンジニア] ③**`[hidden]` vs display:flex バグ修正** — `.mz-dash-countdown` が hidden でも表示され「−日後」の空骨組みが本番露出(実測で発覚)。`.mz-hero-dash`/`.mz-dash-countdown`/`.mz-dash-video` に `[hidden]{display:none!important}` ガード。④**ツール使用中の `mll-auth-changed` で音が止まる問題** — 演奏/チューニング中は誘導カードのみ差し替え、再マウントしない。⑤`loadAndRender` の catch のエラーメッセージ表示に stale ガード(古いロードの例外が新しい画面に出ない)。⑥ダッシュボードの📍カラー絵文字→FA `fa-location-dot`(必須ルール6)。 |
| 1.34.0(続き) | 2026-07-12 | **TOPブロックの再編+ツールのアコーディオン化**(1.34.0 の続き、本番未反映のため版番据え置き)。①**ブロック順を整理** — ヒーロー(コピー+CTA+キービジュアル)を独立した「TOPブロック」に。その次に「TODAY'S MARCHINZ」ダッシュボードを独立セクションとして分離(旧: ヒーロー内に右寄せ併記→中央寄せカード)。さらにその次が「TOOLS(練習ツール)」。順序: hero → today → tools → 近日開催。②**ツールをアコーディオン化** — TOPは初期状態でメトロノーム/チューナーの2アイコンだけ表示し、押すとその下にパネルが開く(`mountTools` を launcher+panel に作り替え、切替・開閉のたびに `stopTools`)。`renderTools` を `buildMetroSection`/`buildTunerSection`/`buildTopGuide` に分割(Days のツールタブは従来どおり両方縦並び=`renderTools`)。③**メトロノーム初期プリセットを4種に整理** — ゆっくり60/マーチ120/8分音符練習144/ハイテンポ220(旧6種から)。マイプリセットは別途保存可。④セクション見出しに英字 eyebrow(`TOOLS` 等、`.mz-section-eyebrow`)。 |
| 1.34.0 | 2026-07-12 | ①**TOPにキービジュアル復元** — `images/lp/hero-show.png` をヒーローに再表示(v1.29.1のダッシュボード化で `showHeroDash()` が隠していた)。画像の下に TODAY'S MARCHINZ ダッシュボードを縦積み併記。②**TOPに「練習ツール」ブロック新設**(ヒーロー直後・ログイン不要) — Days のメトロノーム/チューナーを `MarchinZBase.mountTools()` で共用マウント。ページ離脱で音・マイク停止、再表示で作り直し(ボタン表示不整合防止)。末尾に Days への誘導(ログイン済=「練習を記録する」→`#profile?tab=base`、未ログイン=「登録して練習記録をつける」→`#signup`、`mll-auth-changed` で追従)。③**メトロノームにマイテンポプリセット** — いまのBPMをワンタップ保存・最大10個・昇順表示・×で削除(localStorage `mz_days_tools.presets`、Days側にも表示)。BPM調整ボタン(-5/-1/+1/+5/TAP)を横一列化。④**マイページが半透明のまま残るバグ修正** — `loadAndRender` を try/finally ラッパー化し、途中return・例外・stale の全経路で `--loading`(opacity 0.55)を確実に解除。⑤**iOS Safariの左右ブレ対策** — `body{touch-action:pan-y pinch-zoom}`(ルートのタッチを縦パン+ズームのみに)+`html{overscroll-behavior-x:none}`+横スクロールUI(プロフィールタブ/タブ帯/ページネーション/ヒートマップ等)に `overscroll-behavior-x:contain`。※`overflow-x:clip` 案は相方の overflow-y を巻き込み縦スクロールが死ぬため不採用(検証で発覚)。実機(iPhone)でのブレ解消確認は未。⑥チューナーの🎤カラー絵文字→FA `fa-microphone`/`fa-stop`(必須ルール6)。 |
| 1.33.3(続き) | 2026-07-12 | フッターのオレンジ列見出し(「みる・さがす」「つながる」「サイト情報」)を削除。スマホも1列積みをやめ3列を維持(見出しがなくなった分、gap/paddingを詰めてfont-sizeを0.76remに縮小)。プライバシーポリシー等の長いリンクは375px幅で2行折返しになるが横はみ出しはなし。まだ本番未反映のため版番は据え置き。 |
| 1.33.3 | 2026-07-12 | **フッターをページリンク中心に整理**: ブランド見出し(ロゴ+キャッチコピー)を撤去し、広告バナー行(Kindle Unlimited・Artlist・公式X)+3列のページリンク(みる・さがす/つながる/サイト情報)+コピーライト行の構成に。※当初はバナーも撤去したが、広告バナーは維持する方針に変更しフッター上部へ復元。**レイアウトも整理**: 旧全幅フッター用 `.footer-nav`(styles.css)と新グリッド用 `.mz-footer-grid`(marchinz-brushup.css)が同じ`<nav>`に同時適用され詳細度で綱引きしていた構造を解消(HTMLから`.footer-nav`クラスを外し、グリッド1本に統一)。CSS内の重複`.site-footer`定義2箇所も統合。スマホは3列だと「プライバシーポリシー」等の長いリンクが窮屈なため1列積み(720px以下)。使われなくなった `.footer-nav-inner` / `.footer-nav-sep` / 旧`.footer-nav-link`ダーク調CSSを削除(styles.css）。 |
| 1.33.2 | 2026-07-12 | **マップ: スマホはイベントカードをボトムシートで表示**(v1.33.1後も「狭いマップ45vh内に吹き出しを収める」構造の不安定さが残っていたため)。タップ時に `max-width:767px` を評価し、スマホは Leaflet ポップアップの代わりに**画面下からのボトムシート**(Googleマップ型、`<dialog>`+`showModal()`、マップは一切動かさない)。全件をシート内スクロールで表示(3件制限なし)、行52px・×44px・つまみバー・safe-area対応・backdrop/×/ESCで閉じる・`hashchange` で自動クローズ。表示中は `.mz-evmap--reading` で揺れ停止(ポップアップと同じ)。デスクトップは従来ポップアップ維持(3件+ほか◯件)。吹き出し内容の構築は `buildPrefPop(pref,list,{limit,onPick})` に共通化し `bindPopup`→クリック時 `L.popup().openOn()` に変更。CSS: `display` は `.mz-evmap-sheet[open]` にのみ付与(UA の `dialog:not([open]){display:none}` を打ち消さない)、reduced-motion でスライドアップ無効。イベント/TOP両マップ共通。 |
| 1.33.1 | 2026-07-09 | **イベント/TOPマップ: カード表示時の「2つが同時に動く」問題の修正**(5名ペルソナの再テストで集約)。原則「動くのは一度に1つ」: ①`keepInView` 廃止 — 表示中ずっと地図を引き戻すため、カードを開いたまま隣を見るスワイプと地図がケンカしていた。`autoPan`(開く瞬間の1回だけパン)は維持。②カード出現アニメを translateY+scale の「ぽよん」→ フェード+scale(0.97) 0.22s に — パンと重なると「ガクッ」に見えた。③**カード表示中はピンの揺れ・パルスを一時停止** — `popupopen/popupclose` で地図要素に `.mz-evmap--reading` を付け外しし `animation-play-state: paused`(読む時間は静止、閉じたら再開。酔い対策)。④吹き出し内イベント行に `min-height: 44px`(誤タップ対策)。⑤吹き出し見出しの📍カラー絵文字→ FA `fa-location-dot` モノクロ(必須ルール6)。両マップ共通(createController 共有)。 |
| 1.33.0 | 2026-07-09 | **MarchinZ Days: 5名ペルソナレビュー(高1・大2・社2)の反映**。①**導線** — Days がマイページのタブの奥で毎日機能なのに遠い、への対応。`#profile?tab=base` 深いリンクを3か所に新設: TOPヒーローのログイン時CTA「練習を記録」(fa-drum)/デスクトップのアカウントメニュー/モバイルドロワーのメニュー。あわせて `auth.js` のドロップダウンをアンカー項目クリックで閉じるように(従来「プロフィールを見る」でも開きっぱなしだった)。②**ストリーク救済** — `calcStreak` を「休みが1日までなら途切れない」判定に変更(週数回ペースの社会人・記録忘れ1日を救済。数えるのは練習日のみ、起点は今日→一昨日まで許容)。統計ラベルを「連続記録(日)・休み1日OK」に。③**タグ拡充** — 内容チップに「手具・ガード」「イメトレ・譜読み」を追加(カラーガード・楽器なし練習勢が「その他」に落ちる問題)。全7種。④**ふりかえり** — 統計と一覧の間に月間サマリー(今月◯h・◯回・タグ内訳上位3)+**直近12週間のヒートマップ**(GitHub 草スタイル、列=週・行=月〜日、練習分数で5段階の amber、未来セルは透明、practiceLogs 200件窓から生成)。⑤**「前回と同じにする」** — 記録フォームの内容ラベル横に、直近ログの内容タグ+分数をワンタップ再現するボタン(部活勢の毎日同内容を1タップ化)。⑥**今日の調子(任意)** — ◎好調/○ふつう/△不調の単一選択チップ(`condition`: good/soso/bad)。ログ行の日付横に色付き記号で表示、あとから調子の波が見える。**要ルールデプロイ(v1.32 の未デプロイ分と一括)**: `base_practice_logs` の tags 上限 6→8、`condition`(任意・存在時のみ検証)追加。JS は condition 未選択時に送らないロールバック耐性パターン(goal_ids と同じ)。 |
| 1.32.0 | 2026-07-09 | **MarchinZ Days: 目標コーチング機能**。①**目標(複数可)** — 新コレクション `mll_profiles/{uid}/base_goals`(タイトル・なぜ達成したいか・期限・目標練習時間・状態)。練習ログタブ上部に目標カード(進捗バー=紐づく練習分数の合計/目標時間、期限バッジ、「🏆達成した!」で紙吹雪+殿堂入り)。②**練習記録と目標の紐付け** — 記録フォームに「どの目標に向けた練習?」チップ(`base_practice_logs.goal_ids`、目標1つなら自動選択)。③**応援メッセージ** — 保存直後に文脈つきトースト(下からスライドイン・濃紺カード+金の進捗バー)。優先度: 目標100%/90%到達 > 25/50/75%マイルストーン > 初回 > 7日ぶり復帰 > ストリーク節目(🔥3/7/14/30/50/100連続) > 週間比較(先週超え) > 朝練/夜練 > 汎用8種ローテ。ストリーク統計(🔥連続記録日数)も追加。④**楽器メンテのリマインダー** — 目安日が7日以内/超過の楽器があると Days 上部にバナー(タップで楽器メンテタブへ)。メンテ記録は prompt 連発をやめモダンなダイアログに刷新、種類チップ(オイル差し14日/グリス30日/スワブ7日/リード14日/弦・ヘッド90日/リペア180日)から**次回目安日を自動提案**(編集可)。**要ルールデプロイ**: `base_goals` 新設(+累計進捗 `progress_minutes`) + `base_practice_logs` に `goal_ids`(任意)追加。**リリース前に UX/UI デザイナー+シニアエンジニアの2者レビューを実施し反映**: [堅牢性] loadAll を各コレクション個別 catch(1本の権限エラーが Days 全体を巻き込まない)/goal_ids 未選択時は送らない(旧ルール配信中でも保存が通る)/進捗をログ集計→累計カウンタ progress_minutes(保存時 increment)に変更(直近200件窓に依存せず後退しない)/goal_ids 10件上限/保存後の演出エラーを保存失敗と誤表示しない。[UX] 記録CTAをファーストビューへ(目標より上)/分数クイックチップ(15/30/60/90)/トーストのヘッダをイベント別+全体タップで閉じる+×44px/達成ボタンをアンバー主役ボタン化+達成直後に殿堂を開く/進捗バー blue→amber 統一/マイルストーンは跨ぎ判定+節目前日の予告/UIラベル絵文字を FA モノクロ化/チップ min-height 40px/-webkit-backdrop-filter/reduced-motion で transition も無効。 |
| 1.31.0 | 2026-07-08 | **マイナーリリース(1.30.x の総まとめ)**。この版で機能追加は無し(版番マーカーの繰り上げ)。1.30.0〜1.30.4 で入った内容: localhost ログインの popup 化 / イベント&TOP マップ刷新(バルーンピン・ランダム揺れ・参加者 facepile・カレンダー登録ボタン・チェックボックス化)/ MarchinZ Log 動画書き出し(Note 写真込み・Storage CORS 設定)/ MarchinZ Base→Days(チューナー・メトロノーム・楽器メンテ拡張・本番カウントダウン)/ UI アイコンの FA モノクロ統一 / フッター・マイページ・モーメント写真の表示修正 / スマホ Safari 最優先方針。 |
| 1.30.4 | 2026-07-08 | **TOP マップをイベントページと同機能に**: TOP の「近日開催予定」マップの吹き出しにも**参加予定者アイコン(facepile)**を表示。1.30.3 では TOP は参加者データ非保持のため対象外だったが、`marchinz-top-highlights.js` に `attachEventFaces` を追加 — 公開 MLL ログ(`MarchinZMllRole.queryMllLogsForFeed` を再利用・1クエリ)+ 直近イベントの参加登録(attendees、上限30件)+ プロフィール最小ロードで、イベントページの `getMllPublicFaceUids` と同じ公開判定(退会/非公開/非表示を除外)の顔集合を構築。ピンの落下アニメが二度走らないよう「顔データを読んでから一度だけ描画」(最大2.5秒でフォールバック)。 |
| 1.30.3 | 2026-07-08 | **イベントマップ強化**: ①吹き出しの各イベントに**参加予定者アイコン(facepile)** — カードの顔アイコンと同じ公開 Log 参加者集合(`getMllPublicFaceUids`)のアバターを白リング付きで重ね表示。Apple Watch のクラスタ風に人数が多いほど小さく(〜3人26px/〜6人21px/7人〜17px+「+N」)。データは calendar-events.js の refresh payload に `faces`/`faces_total` を追加(TOPマップは参加者データ非保持のため対象外)。②**バルーンがランダムに揺れる** — 足先(開催地)を支点に風船のようにゆらゆら。周期(2.6〜4.4s)・位相はピンごとに JS がランダム付与。直近イベント専用の bob は廃止しパルスリングで区別。ホバー中はアニメを外して拡大が効くように。 |
| 1.30.2 | 2026-07-08 | **モーメント写真の表示改善**: ①拡大表示(ビューア)の紺帯レターボックスを廃止 — コンテナを画像幅にシュリンクラップして中央寄せ・背景透明(Note ビューアも共通)。②フィードのサムネイルは**正方形(1:1)クロップ**に統一(最大440px・中央寄せ)。縦長スクショの contain+紺帯表示をやめ、縦長も cover でクロップ。CSS のみ(`marchinz-brushup.css`)。 |
| 1.30.1 | 2026-07-08 | **フィードバック対応**: ①UIアイコンのカラー絵文字をFont Awesomeモノクロに統一(🗾→fa-map-location-dot、📅→fa-calendar-plus、🗺️/📹→fa-map-location-dot/fa-video)。**今後もUIアイコンはFAモノクロで統一**(CLAUDE.md 必須ルール6に追記)。②**PCフッターのレイアウト崩れ修正**: `.site-footer .footer-nav`(旧全幅用・詳細度0,2,0)が `.mz-footer-grid` の中央寄せを上書きしていた→同詳細度で中央寄せ。コピーライト行が濃紺背景に暗いグレーで読めなかったのを白系+中央揃えに。③**マイページの余白**: `.user-profile-panel`(カード枠)が padding 0 で内容が枠に密着→ padding 1.5rem(モバイル1rem)。④**イベントマップのピン刷新**: 丸だけ→バルーン型(丸い頭+開催地を指す下向きの足、光沢グラデ)、色を鮮やかに(イベントのくすんだ茶#92400e→amber #f59e0b 等)、直近1ヶ月は頭がふわふわ弾む。アンカーを足先=開催地に。 |
| 1.30.0 | 2026-07-08 | **バグ修正**: ①ログイン/登録ダイアログのロゴが実在しない `logo/mll-logo.png` を参照し本番で壊れていた → `logo/marchinz-logo.png` へ修正。②**イベントマップのポップアップが地図の隅へ飛んで見えない**(v1.29.1 の `.leaflet-popup` への `animation: mz-pop-in ... both` が、fill-mode により Leaflet の位置決め用インライン transform を上書きしていた) → アニメを `.leaflet-popup-content-wrapper` 系へ移動。再描画時に取り残される孤児ポップアップも `map.closePopup()`+ポップアップ表示中の再描画スキップで解消。**イベントマップUX**: 「マップで見る」をチェックボックス化(既定ON・OFFのみ記憶)、ポップアップを日付ピル+種別色+2行タイトルのカード型に刷新、`keepInView` で画面内に収める。**イベントカード**: 「📅 カレンダーに登録」ボタン(Googleカレンダー終日イベントURL、`buildGoogleCalendarUrl`)。**大会動画**: 年チップは2018年以降のみ表示。**Journey→MarchinZ Log 統合**: 「あしあとを再生」→「MarchinZ Logを再生」等の文言統一、停留カードに Note(event_log_diaries)表紙写真を表示(`calendar_event_id` 経由、非公開Noteは個別catch)、**動画書き出し**(`marchinz-journey-export.js` 新規: 1080×1920縦型、タイル事前取得+Mercator自前計算の固定ビュー、canvas.captureStream+MediaRecorder、MP4→WebM自動選択、55秒キャップ、navigator.share/ダウンロード。Storage画像はバケットCORS未設定のためtaint検査で自動プレースホルダ化)。**MarchinZ Base→MarchinZ Days**: 表示名変更(内部ID・コレクションは base_* 維持)+タブアイコンをFAモノクロ(fa-drum)に統一。新サブタブ「ツール」= メトロノーム(ルックアヘッドスケジューラ、BPM30-260、TAP、拍子2-8、アクセント、プリセット6種)+チューナー(自己相関+放物線補間、A4=442Hz、B♭/E♭/F移調) — BandRoom移植、設定は localStorage `mz_days_tools`、タブ離脱/ページ離脱でマイク・音を停止(`stopTools`+pane hidden 監視)。楽器メンテに**メーカー/品番/購入日**を追加。練習ログタブ最上部に**本番カウントダウン**(`base_countdowns` 新コレクション)。**要デプロイ**: `firestore.rules`(base_instruments 3フィールドの任意パターン追加+base_countdowns ブロック)を**JSの公開より先に** `firebase deploy --only firestore:rules`。 |
| 1.29.1 | 2026-07-08 | **TOP ヒーローをダッシュボード化**: ヒーロー右のイラストを「TODAY'S MARCHINZ」ライブパネルへ置換(`#mz-hero-dash`、`marchinz-top-highlights.js` が描画。JS失敗時はイラストにフォールバック)。①次イベントまでのカウントダウン(ネイビーカード・日数大表示・kindチップ・タップで #community/events)②最新YouTube動画カード(サムネ+再生ボタン)③ミニ統計(大会動画/今後の予定/チャンネル数、各ページへのリンク)。デスクトップのロゴ帯を圧縮(padding縮小+ロゴ60px)しファーストビュー情報量を向上。**TOP セクション順変更**: YouTube新着→新着の大会動画の順へ。**地図デザイン刷新**: ベースタイルを OSM標準→**CARTO Positron**(イベントマップ/Journey共通、彩度調整フィルタ+日本周辺へmaxBounds固定+ズームUI/帰属表記のブランド化)。**イベントマップ改良**: タブ最上部へ移動、ピン落下スタッガー/ホバー拡大/吹き出しポップイン/カード着地パルス、モバイル初回は折りたたみ、**Leaflet遅延ロード修正**(イベントパネル可視時のみロード。従来は全ページで読込まれていた)。 |
| 1.29.0 | 2026-07-07 | **機能: MarchinZ Base** — プロフィールに本人限定タブ「🏠 MarchinZ Base」を追加(`marchinz-base.js` 新規)。練習ログ(日付・タグ・時間・メモ、今週合計時間の統計)、楽器メンテ記録(楽器登録+メンテ履歴+次回目安日バッジ)、ショウ覚えメモ(カウント・立ち位置・注意点+写真)の3サブタブ。データは `mll_profiles/{uid}/base_practice_logs\|base_instruments\|base_show_notes`、写真は Storage `mll_base_media/{uid}/`(いずれも本人のみ read/write、`profilePrivateDocReadable/Writable` を再利用)。タブ表示制御は既存の notifs/ops と同じ「本人限定」パターン(`profileOwnerInboxTab`)に統合。練習ログ登録で紙吹雪演出。**要デプロイ**: `firebase/firestore.rules` に `base_practice_logs`/`base_instruments`/`base_show_notes` の3ルールブロック、`firebase/storage.rules` に `mll_base_media` を追加済みだが**未デプロイ**。ディレクター承認後に `firebase deploy --only firestore:rules,storage` が必要（ルールデプロイまでは本番で書き込み時に permission-denied になる）。 |
| 1.28.0 | 2026-07-07 | **機能: MarchinZ Journey** — プロフィール Log タブの「🗺️ あしあとを再生」から、Log の年代・県・大会名を日本地図(Leaflet+OSM、初回クリック時に動的ロード)上でアバターがたどるアニメーション再生。年カード+役割チップ+進捗/速度/前後コントロール+完走サマリー(年数・県数・記録数+シェア文コピー)。`marchinz-journey.js` 新規。**機能: イベントマップ** — #community/events のリスト前に県別ピン(件数バッジ・kind色・1ヶ月以内はパルス)の日本地図。ピン→ポップアップ→該当カードへスクロール&ハイライト。期間チップ(今後/3ヶ月/全期間)+開閉トグル。`marchinz-event-map.js` 新規 + calendar-events.js `renderCurrentView` にフック。**デザイン刷新第2弾**: グローバルナビをスティッキー・ガラス(白85%+blur)化 / 見出しタイポ大型化+アイブロウをアンバー統一 / モーメントを Threads 風シングルカラム(区切り線・本文全文表示) / フッターをサイトマップ型4カラムに刷新。**演出**: 紙吹雪 `marchinz-confetti.js`(Log新規作成・Journey完走時、reduced-motion無効) / いいねハートの弾け(既存 `community-like-btn--pop` にCSSアニメ)。 |
| 1.27.1 | 2026-07-07 | **機能**: TOP に「近日開催予定」セクション（`#mz-top-events-grid`、`marchinz-top-highlights.js` が `mll_calendar_events` を公開読み取りし本日以降を日付昇順で最大6件、日付ボックス+種別チップの横型カード。kind 別アクセント色はイベントカード刷新と共通）。**改善**: Moment/Note ビューアの写真をクロップせず全体表示（`object-fit: contain`、縦長スクショの断片見え対策）。一覧カードも**縦長画像のみ**自動判定で全体表示（`marchinz-image-compress.js` が縦横比>1.15 の画像へ `mz-img-portrait` 付与 → contain+ネイビー帯。横長写真は従来どおり 16:10 クロップ）。**刷新**: MarchinZ Log イベントカード（角丸カード+上辺アクセント帯+kind別配色8種+ピルチップ+CTA、`marchinz-brushup.css`）。イベント種別アンバーのコントラストを WCAG AA 合格値へ調整（#92400e）。 |
| 1.27.0 | 2026-07-07 | **デザイン全面刷新（案1 モダンクリーン）**: 新規 `marchinz-brushup.css`（styles.css の後読みオーバーレイ。link を外せば旧デザインへ戻る）。ピル型グローバルナビ・カードUI・角丸/影/タイポ刷新。トップに「新着の大会動画」「YouTube 新着」「今週のマーチング（AIダイジェスト枠）」（`marchinz-top-highlights.js` 新規）。モバイル専用の下部タブナビ（`.mz-tabbar`、site-nav.js のアクティブ制御対象へ追加）。**検索強化**: #videos に配信年フィルタチップ（`#video-year-chips`）、検索のかな正規化（カタカナ→ひらがな折りたたみ。#youtube チャンネル検索にも適用）。**自動化**: `generate_weekly_digest.py`（Gemini API、`GEMINI_API_KEY` 未設定時はスキップ）を daily workflow へ追加し `digest.inline.js` を生成。**運用変更**: Git和解（ローカル正→origin/main 集約）+ Netlify 自動デプロイ再開 = 「git push が本番デプロイ」（`claude_handover.md` §4）。**本番デプロイ**（Netlify）。バックアップ `~/Movies/marchinz_backups/backup_20260707_worktree_and_git_history.zip` + git タグ `pre-brushup-1.26.65`。 |
| 1.26.65 | 2026-05-29 | **修正**: UGC — 運営ページ表示時にタブ未読数を**即時表示**（キャッシュ＋先読み）。UGC 記録後にバッジ自動更新。**MarchinZ Log** 新規作成時の UGC 通知を安定化。大会動画検索 UGC は連続通知の間隔 **3 秒以上**（書き込み成功時のみ間隔カウント）。**本番デプロイ**（Netlify）。 |
| 1.26.64 | 2026-05-26 | **改善**: YouTube 掲載一覧 — API 更新で **3分01秒以上**のみ反映（3分00秒以下は除外）。`YouTubeリスト.csv` / `youtube-list.inline.js` を最新化。**本番デプロイ**（Netlify）。 |
| 1.26.58 | 2026-05-24 | **改善**: 大会動画 — 優先表示をインスタントコー・YOKOHAMA ROBINS・THE FOCUS の3団体固定（動画あり時は必ず先頭）。団体一覧フッターを2行化。**UI**: YouTube 掲載一覧横の「xxチャンネル」削除。モバイルメニューにモーメント追加。**本番デプロイ**（Netlify）。バックアップ `backups/backup_20260525_174039`。 |
| 1.26.57 | 2026-05-24 | **UI**: YouTube 埋め込みモーダル — PC でフッターボタンを文字幅＋広め余白に（横伸び解除）。 |
| 1.26.56 | 2026-05-24 | **改善**: 大会動画 — 初期ランダム表示の優先団体プールに `allure`・湘南台 WSS を追加。優先枠を3団体×各1動画に変更（同団体の重複なし）。1.26.55 同梱。**本番デプロイ**（Netlify）。バックアップ `backups/backup_20260524_142745`。 |
| 1.26.55 | 2026-05-24 | **UX**: YouTube 埋め込みモーダル — 次チャプター自動停止を廃止。タイトル縮小。全画面／YouTubeで開くを同サイズ1行配置。全画面フォールバック文言変更。 |
| 1.26.54 | 2026-05-24 | **UX**: YouTube 埋め込みモーダル — フッターに「全画面表示 ⛶」ボタン（Fullscreen API・iOS フォールバックトースト）。フッター flex レイアウト調整。1.26.52–53 同梱。**本番デプロイ**（Netlify）。バックアップ `backups/backup_20260524_140038`。 |
| 1.26.53 | 2026-05-24 | **UI**: YouTube モーダル — 画質案内文言から「（初期 720p）」を削除。 |
| 1.26.63 | 2026-05-26 | **機能**: UGC — **MarchinZ Log** タブ（`mll_log`、新規 Log 作成時）。大会動画検索は連続通知の間隔を **3 秒以上**に制限。要 Firestore rules デプロイ。 |
| 1.26.62 | 2026-05-26 | **修正**: いいね通知・掲示板いいね・MLL Log いいね等 — `MarchinZActorDisplayName` / `getDisplayName()` でニックネーム優先（掲示板投稿・返信は従来どおり `fetchProfile`）。 |
| 1.26.61 | 2026-05-26 | **修正**: UGC・いいね通知の `actor_name` — Google 登録名ではなく `mll_profiles.display_name`（ニックネーム）を記録。`MLL_AUTH.getDisplayName()` を追加。 |
| 1.26.60 | 2026-05-24 | **修正**: UGC 大会動画検索 — 団体一覧からの選択・検索欄入力・「この団体を検索」で明示記録。検索語は `exactOrgTeam` も反映。 |
| 1.26.59 | 2026-05-24 | **機能**: UGC お知らせ — **大会動画検索**・**検索結果シェア**タブを追加（`video_search` / `search_share`）。未ログインは表示名 **ゲスト**（`mll_guest`）。要 Firestore rules デプロイ。 |
| 1.26.52 | 2026-05-24 | **修正**: 大会動画 YouTube モーダル — スマホ左右余白の根本原因（`.mz-dialog-body` padding 上書き）を `#mz-youtube-embed-overlay` 限定で解除。画質はプレイヤー ⚙️ から変更可能な旨をフッター表示。初期 720p は1回のみリクエスト。 |
| 1.26.51 | 2026-05-24 | **UI**: 大会動画・MIX3 共通 — YouTube 埋め込みモーダル（`MarchinZYouTubePlayer`）を PC で拡大（最大 1200px）。スマホは動画を横いっぱい・上下中央。初期画質 720p リクエスト（`vq=hd720` + `setPlaybackQuality`）。MIX3 オーバーレイも同様に拡大。MIX3 サムネ代替リンク文言を削除。**本番デプロイ**（Netlify）。 |
| 1.26.50 | 2026-05-24 | **改善**: 大会動画 — YouTube 外部リンク・シェア URL を `t=` + `#t=` 付きに正規化（続きから再生より指定秒数を優先しやすく）。埋め込みモーダルは `start` + `seekTo` で指定位置から再生。**本番デプロイ**（Netlify）。バックアップ `backups/backup_20260524_132742`。 |
| 1.26.49 | 2026-05-24 | **機能**: 大会動画 — 同一ライブ配信の次チャプター開始時に埋め込みモーダルを自動で閉じ一覧へ戻る（`end` + `enablejsapi` + 再生位置監視）。1.26.47–48 同梱。 |
| 1.26.48 | 2026-05-24 | **UI**: YouTube 埋め込みモーダル — 大きく表示。見出しを動画タイトルに。スマホは上下左右中央。「YouTubeで開く」を小さく地味に。 |
| 1.26.47 | 2026-05-24 | **UI**: 大会動画 MIX3 — 「MIX3 って？👀」チップ＋前面オーバーレイ（大サムネ・サイト内再生）。 |
| 1.26.46 | 2026-05-24 | **UI**: 大会動画 MIX3 タブ — 商標注記コンパクト化（1.26.47 でオーバーレイ方式に差し替え）。**本番デプロイ**（Netlify）。 |
| 1.26.45 | 2026-05-24 | **UI**: コミュニティイベント — カレンダー表示は種別ラベル非表示（イベント名・都道府県のみ）。リスト表示は「演奏会」「大会」「イベント」ラベルを種別カラーに。**本番デプロイ**（Netlify）。 |
| 1.26.44 | 2026-05-24 | **UI**: プロフィール MarchinZ Log KPI バッジ — 2〜3 個は横並び、4 個は 2×2 グリッド（1.26.45 に同梱デプロイ）。 |
| 1.26.43 | 2026-05-24 | **UI**: プロフィール MarchinZ Log KPI サブタイトル — 自分は「名前のこれまでの…」（句点なし）。他人は「名前さんのこれまでの…」のまま。**本番デプロイ**（Netlify）。 |
| 1.26.42 | 2026-05-24 | **UI**: プロフィール MarchinZ Log KPI — 見出し横にサブタイトル。KPI 枠に TOP 最終 CTA と同じ `mll-lp-finale--pattern-a` 背景（1.26.43 に同梱デプロイ）。 |
| 1.26.41 | 2026-05-24 | **UX**: アプリ内 WebView 案内バナー文言を短縮（ログイン・登録時は URL コピー→ブラウザ）。**本番デプロイ**（Netlify）。 |
| 1.26.40 | 2026-05-24 | **UX**: アプリ内 WebView — 全画面ブロック（1.26.38–39）を廃止。共有ページはそのまま閲覧可。画面下部の案内バナー（💡・「とじる」・sessionStorage・控えめな URL コピー）。ログイン制限は `auth.js` 維持。**本番デプロイ**（Netlify）。 |
| 1.26.39 | 2026-05-24 | **UX**: アプリ内ブラウザ対策 — MarchinZ シェア URL に `?openExternalBrowser=1` を自動付与（Board / Note / Moment / Log / マイリスト / 検索シェア。`MarchinZUrlShare`）。**UX**: LINE / X / Instagram 等 WebView 検知時に全画面オーバーレイ（標準ブラウザ案内・URL コピー）。**UX**: YouTube 動画リンク — アプリ強制起動（`preferYouTubeApp`）を廃止し、サイト内 iframe モーダル再生（`MarchinZYouTubePlayer`）。**UI**: YouTube 掲載一覧行の flex レイアウト（1.26.37 同梱）。**本番デプロイ**（Netlify）。 |
| 1.26.38 | 2026-05-24 | **UX**: アプリ内 WebView 検知 — 全画面オーバーレイ（`site-nav.js` `MarchinZInAppBrowser`）。メイン UI を非表示。 |
| 1.26.37 | 2026-05-24 | **UI**: YouTube 掲載一覧 — 「掲載リスト」ボタン・（XXch）・検索欄が縦積みになる不具合を flex 1 行レイアウトに修正。 |
| 1.26.36 | 2026-05-24 | **修正**: コミュニティイベント **統合** — 統合元の MarchinZ Log / Note / 参加登録（attendees）を統合先へ移行。Note は同一ユーザーで両方ある場合 **新しい方**（`updated_at` / `created_at`）を残す。Firestore ルール — 特権ユーザー（`mll_privileged_uids`）の `mll_logs` read、`attendees` write、`event_log_diaries` read/write を統合操作用に許可。**本番デプロイ**（Firestore rules + Netlify）。 |
| — | 2026-05-23 | **セキュリティ（Console）**: App Check **Storage** Enforcement を適用。適用前 Storage 確認済み 100%。本番でプロフィール画像（カバー等）保存成功を確認。 |
| 1.25.130 | 2026-05-19 | **修正**: プロフィール画像クロップ — Mac Safari でも data URL + viewMode 1 経路を使い、カバー切り取り枠のずれを抑制。本番 `auth-config.js` の App Check `debug` を false に。**UI**: プロフィール編集 — 保存・キャンセルを `mz-dialog-foot` で最下部固定（1.25.129 分を同梱）。バックアップ `backups/backup_20260523_151919`。**本番デプロイ**。 |
| 1.25.129 | 2026-05-19 | **UI**: プロフィール編集 — 保存・キャンセルを `mz-dialog-foot` に移し、スマホでフォーム中央に浮かないようダイアログ最下部に固定（1.25.130 に同梱デプロイ）。 |
| 1.25.128 | 2026-05-19 | **UI**: プロフィール編集 — カバー写真ヒントに「*スマホから推奨」を追記。 |
| 1.25.127 | 2026-05-19 | **セキュリティ**: App Check — `auth-config.js` に reCAPTCHA v3 サイトキーを設定。Firebase Console で `marchinz-web` を reCAPTCHA 登録・localhost デバッグトークン `MarchinZ localhost` 追加。バックアップ `backups/backup_20260523_143056`。**本番デプロイ**。 |
| 1.25.126 | 2026-05-19 | **セキュリティ**: App Check（reCAPTCHA v3）を再導入 — `firebase-app-check-compat.js`、`auth-config.js` の `appCheck`、`auth.js` 初期化（キー未設定時はスキップ）。`MLL_AUTH.isAppCheckActive()`。 |
| 1.25.125 | 2026-05-19 | **UI**: メディアページの余白上書きを撤回。**UI**: クリエイター — リード・Artlist 本文をメディアと同型クラス（`static-panel-lead` / `media-promo-text`）に変更し、セクション見出し下余白を `.media-subheading` と揃える。バックアップ `backups/backup_20260523_140323`。**本番デプロイ**。 |
| 1.25.124 | 2026-05-19 | **UI**: クリエイター — Artlist 専用リンク文言（アイコン直後にスペース、中間スペース削除）と pill 内アイコン間隔。**UI**: メディア・クリエイター — セクション見出し・本文・バナー・グリッド間の縦余白を拡大（スマホ含む）。 |
| 1.25.123 | 2026-05-23 | **UI**: ヘッダー — PC アカウントメニュー（プロフィール・設定・ログアウト）に Font Awesome アイコンを追加。 |
| 1.25.122 | 2026-05-23 | **UI**: 大会動画 — 並べ替え／絞り込みラベルを「並び順」「絞込み」に変更（ラベル字を小さく）。配信日・団体/チームボタンをグループ化してレイアウト整理。 |
| 1.25.121 | 2026-05-23 | **修正**: いいね — タップ直後に赤ハート＋ポップアニメーション。Firestore 保存後の再描画で古いキャッシュが UI を上書きしないよう楽観更新＋キャッシュパッチ。 |
| 1.25.120 | 2026-05-23 | **UI**: 掲示板 — 運営のみ見える「非表示」投稿・操作をピンク／赤系で装飾（#admin と同系。非表示バナー・投稿枠・非表示ボタン）。 |
| 1.25.119 | 2026-05-23 | **修正**: 大会動画 — 配信元絞り込みを「マーチング祭」「DrumcorpsfunTV」の2択に変更（旧 YouTube プラットフォーム絞り込みを廃止）。 |
| 1.25.118 | 2026-05-23 | **修正**: コミュニティイベント — Log／Note CTA を排他表示に戻す（Log 未登録→「Logを残す」のみ、Log のみ→「Noteを書く」のみ、両方→緑「Logをみる」＋アイコン）。 |
| 1.25.117 | 2026-05-23 | **UI**: マイページ —「通知」と「運営より」をタブ分離（アイコン付き）。運営お知らせは本人のみ。未読バッジ位置調整。 |
| 1.25.116 | 2026-05-23 | **修正**: ヘッダー未読バッジ — アバター内側寄り配置（`translate`・負 margin 廃止）、`z-index: 100` で名前・メニュー下に潜らないよう調整。 |
| 1.26.28 | 2026-05-24 | **機能**: コミュニティ — 演奏会等・掲示板に「更新情報」横スクロール（最新3件常時＋7日以内）。`mll_community_updates`・絵文字固定。Board は未ログインで非公開カテゴリを非表示（ルール＋UI）。**UI**: 開催年絞り込みに並び替え同型アイコン。 |
| 1.26.27 | 2026-05-24 | **修正**: UGC タブ `UGC【x】` — 計算式を `next − 101` に変更（自動採番の登録済み人数）。 |
| 1.26.26 | 2026-05-24 | **UI**: ヘッダー UGC タブ — `UGC【x】` 表示（`mll_meta/marchinz_public_id.next` − 100 ＝ 自動採番ユーザー登録数の目安）。 |
| 1.26.25 | 2026-05-24 | **UI**: UGC を管理タブ外の独立ナビ（`#ugc/*`、管理の左）へ移動。未読バッジ（ナビ合計・種別タブ）。**修正**: UGC 一覧の Firestore クエリをクライアントソートに変更（インデックス待ちエラー回避）。 |
| 1.26.24 | 2026-05-24 | **機能**: 管理ページ — **UGC** タブ（ユーザー登録・イベント・モーメント・掲示板・掲示板返信・ノート・大会動画／YouTube マイリスト・大会動画検索・検索結果シェア）。`yyyy/mm/ddにxxさんが…` 形式、ユーザー・対象にリンク。未ログインの検索／シェアは **ゲスト** 表示。未読/既読はマイページ通知と同型（`mll_admin_ugc_feed` + `admin_ugc_reads`）。いいねは対象外。**本番デプロイ**（Firestore rules / indexes + Netlify）。 |
| 1.26.23 | 2026-05-23 | **UI**: シェア —「Instagramでシェア」は **URL のみ**クリップボードコピー（従来はタイトル・締め文込みの全文）。 |
| 1.26.22 | 2026-05-23 | **修正**: MarchinZ Moment — 投稿ダイアログが `hidden` のまま `showModal` されフリーズする不具合。コミュニティ「モーメント」タブにアイコン追加。1.26.21（YouTube 掲載 Xコ）同梱。**本番デプロイ**。 |
| 1.26.21 | 2026-05-23 | **UI**: YouTube — 掲載数を `掲載 Xコ` に変更（検索絞り込み前の区分内全体数を常時表示）。検索欄を同ラベルの右隣・1行配置。 |
| 1.26.20 | 2026-05-23 | **修正**: MarchinZ Moment — collection group 一覧用 `updated_at` インデックス（`fieldOverrides`）を Firebase にデプロイ。`failed-precondition` で一覧・投稿後更新が失敗していた問題。 |
| 1.26.19 | 2026-05-23 | **UI**: YouTube — 掲載リストを `掲載リスト（xxch）` 表記に。右隣にチャンネル名検索（虫眼鏡アイコン付き）。1.26.13–1.26.18（Moment・コミュニティ UI 等）同梱。Firebase rules / Storage デプロイ済。バックアップ `backups/backup_20260523_224333`。**本番デプロイ**。 |
| 1.26.18 | 2026-05-19 | **UI**: マイページ MarchinZ Log — 各行に Note CTA（未作成→「Noteを書く」／作成済→「Noteを見る」。コミュニティ同型ボタン）。 |
| 1.26.17 | 2026-05-19 | **UI**: コミュニティイベント — Note CTA 文言を「Noteを書く」「Noteを見る」に短縮。 |
| 1.26.16 | 2026-05-19 | **UI**: コミュニティタブ順 — 演奏会等 → モーメント → 掲示板 → ノート。 |
| 1.26.15 | 2026-05-19 | **UI**: コミュニティ — モーメントタブ追加（タブ順調整の前段）。 |
| 1.26.14 | 2026-05-19 | **機能**: MarchinZ Moment — コミュニティ `#community/moments` タブ（一覧・検索・投稿・詳細・いいね・通報）。`mll_profiles/{uid}/moments`・`mll_moment_reports`・Storage `mll_moment_media`。要 Firestore rules / indexes デプロイ。 |
| 1.26.13 | 2026-05-23 | **修正**: MarchinZ Board —「シェアする」メニューが見えない（上向き表示・flex 幅潰れ・overflow 対策。Note 1.26.6 と同型）。 |
| 1.26.12 | 2026-05-19 | **UI**: コミュニティイベント — 絞り込みに **開催年** を追加（都道府県と同型。登録済みの年のみ選択可）。 |
| 1.26.11 | 2026-05-19 | **MarchinZ Board**: 投稿作成時「運営より」カテゴリ — **運営のみ**選択可（UI 非表示 + Firestore ルール）。 |
| 1.26.10 | 2026-05-19 | **UI**: MarchinZ Board — 質問タブ表示を **雑談・質問🔒** に変更（内部キー `theme: 質問` は維持）。 |
| 1.26.9 | 2026-05-19 | **MarchinZ Board**: 未ログイン UX 明示。Board 専用 URL（`#community/board?thread=`）と元投稿シェア（質問カテゴリ除く・返信なし）。質問カテゴリはログイン限定（🔒タブ・Firestore read ルール）。 |
| 1.26.8 | 2026-05-19 | **仕様統一**: プロフィール — 公開設定の Log / Note / マイリストは **未ログインでも閲覧可**（従来の登録ゲートを廃止。非公開タブはぼかし）。 |
| 1.26.7 | 2026-05-19 | **仕様**: MarchinZ Note / Moment —「シェアする」は **本人のみ**（公開 Note でも他人・未ログインには非表示）。`canShareProfileMarchinZNote`。 |
| 1.26.6 | 2026-05-19 | **修正**: MarchinZ Note 閲覧モーダル —「シェアする」展開メニューが「閉じる」に隠れて見えない問題（メニューを上向き表示）。 |
| 1.26.5 | 2026-05-19 | **仕様明確化**: MarchinZ Log プロフィールの「MarchinZ Log をシェアする」— **本人のみ**（`canShareProfileMarchinZLog`）。 |
| 1.26.4 | 2026-05-19 | **UI**: コミュニティイベント — 参加者チップ「Log x人」（太字）、CTA「Logを残す」、関わり方ダイアログ見出し「MarchinZ Log」（説明文削除）。**本番デプロイ**。 |
| 1.26.3 | 2026-05-19 | **機能**: MarchinZ Note — 公開 Note に個別 URL シェア（`MarchinZShareMenu`）。`visibility: public` で未ログイン閲覧可（`section_vis_logdiary` 非問）。Firestore `event_log_diaries` read ルール更新。 |
| — | 2026-05-19 | **仕様**: UGC 三層を確定 — **MarchinZ Moment**（カジュアル・常公開・未実装）／**MarchinZ Note**／**MarchinZ Board**。§3.8 追加。 |
| 1.26.2 | 2026-05-23 | **修正**: MarchinZ Note 共有リンク — 未ログインでも `#profile?uid=&tab=logdiary&event=` で公開 Note を `openViewer` 表示（`user-profile-page.js`）。 |
| 1.26.1 | 2026-05-23 | **修正**: Google ログイン — LINE / Instagram / X 等のアプリ内ブラウザで `403 disallowed_useragent` となる問題に対し、事前検知・案内バナー・URLコピー（`auth.js`）。バックアップ `backups/backup_20260523_170146`。**本番デプロイ**。 |
| 1.26.0 | 2026-05-23 | **マイナー・βテスト開始**: 1.25.131（MarchinZ Log シェア修正）・1.25.132（プロフィール画像保存の並列アップロード・再圧縮省略）を同梱。App Check（Firestore / Storage）・プロフィール編集 UI（1.25.129–130）確定版。バックアップ `backups/backup_20260523_160121`。**本番デプロイ**。 |
| 1.25.132 | 2026-05-23 | **改善**: プロフィール画像保存 — アバター・表紙のアップロードを並列化。クロップ済み JPEG の保存時再圧縮を省略（900KB 超のみ従来どおり圧縮）。 |
| 1.25.131 | 2026-05-23 | **修正**: マイページ MarchinZ Log —「MarchinZ Log をシェアする」ボタンが反応しない不具合（1.25.110 のアクションバー化でシェアメニュー初期化が DOM 挿入前に走っていた）。バックアップ `backups/backup_20260523_155418`。**本番デプロイ**（β開始版）。 |
| 1.25.115 | 2026-05-23 | **改善**: 大会動画初期表示の優先チームに `Splendore` を追加。 |
| 1.25.114 | 2026-05-23 | **修正**: ヘッダー／マイページ — 未読通知バッジ（赤丸）が右端で見切れないよう配置・余白を調整。 |
| 1.25.113 | 2026-05-23 | **UI**: 大会動画 —「配信元」を並べ替えから分離。右に「絞り込み」（アイコン付き）を追加し、配信元ドロップダウンで YouTube を選択可能。**本番デプロイ**（1.25.107〜112 含む）。 |
| 1.25.112 | 2026-05-23 | **UI**: 大会動画 MIX3 タブ — 商標注記下に MIX3 紹介動画リンク（後夜祭5 スペシャル対談 LIVE）を追加。 |
| 1.25.111 | 2026-05-19 | **UI**: マイページ MarchinZ Note — 未記入カードの日付表示を「2026/05/04  スタッフ・運営」形式に。「MarchinZ Note を書く」をピンク系・中央配置・アイコン付き。 |
| 1.25.110 | 2026-05-19 | **UI**: マイページ MarchinZ Log — シェアボタンにアイコン。「すべて削除」をシェア右の ⋯ メニューへ移動。 |
| 1.25.109 | 2026-05-19 | **UI**: コミュニティイベント —「MarchinZ Logを残す」（黄色・アイコン）と「MarchinZ Noteを書く／見る」（青・アイコン）を常時2ボタン表示。**改善**: Note 新規作成を2段階（① Note 内容 → ② MarchinZ Log 参加スタイル）に変更。Log 未登録でも Note 作成可能。 |
| 1.25.108 | 2026-05-23 | **UI**: プロフィール性別 —「その他」を削除（男性・女性・無回答のみ）。 |
| 1.25.107 | 2026-05-23 | **修正**: マイページ —「MarchinZ Log をすべて削除」を Log 一覧の下に固定表示（本人のみ。他ユーザー視点プレビューでも表示）。0 件時も表示。 |
| 1.25.106 | 2026-05-23 | **修正**: 大会動画 —「もっと見る」で同一ページに全件表示されたとき、ページネーションを「ページ 1 / 1」等の実表示に合わせて更新。バックアップ `backups/backup_20260523_100500`。**本番デプロイ**。 |
| 1.25.105 | 2026-05-19 | **改善**: マイページ — Log 0 件でも「MarchinZ Log をすべて削除」を表示（イベント参加者 orphan 削除）。**機能**: `#admin/trash` 完全削除（Log・Note・参加者・いいねをカスケード）。Firestore ルール: 運営の Note / attendees 削除。 |
| 1.25.101 | 2026-05-19 | **改善**: カレンダー表示でイベントをクリックしたとき、リスト表示と同じイベントカードオーバーレイ（`buildCalendarCardLi`）を表示。カード表示へ切り替えずカレンダーのまま。Esc／背景クリックで閉じる。 |
| 1.25.100 | 2026-05-19 | **UI**: コミュニティイベント — 並び替えを「開催年」トグル（新しい年→古い年／逆）に統一。登録済み会場都道府県による「絞り込み」ドロップダウン追加。動画・YouTube 並び替えボタンに Font Awesome アイコン。 |
| 1.25.98 | 2026-05-23 | **改善**: イベント編集保存後も「保存しました。」トースト表示（登録時と同様）。 |
| 1.25.97 | 2026-05-23 | **UI**: イベント編集モーダル — 冒頭・MarchinZ Log 下の説明文を削除。ラベルを「MarchinZ Log」に短縮。 |
| 1.25.96 | 2026-05-23 | **改善**: イベント登録成功時「登録しました。」をモーダル外トーストで表示。一覧再取得の二重実行を抑制。 |
| 1.25.95 | 2026-05-23 | **UI**: カード表示の一覧末尾に「イベントを登録」ボタン（中央配置）。 |
| 1.25.94 | 2026-05-23 | **UI**: マイページ MarchinZ Log KPI — チームスタッフ丸画像の切り抜きを緩和（文字見切れ対策）。 |
| 1.25.93 | 2026-05-23 | **UI**: イベントカード — 参加者行を「MarchinZ Log(x人)」+ プロフィールアイコンに変更。 |
| 1.25.92 | 2026-05-23 | **改善**: コミュニティイベント登録後に `location.reload()` せず一覧だけ再取得 — TOP が一瞬表示される不具合を解消。 |
| 1.25.91 | 2026-05-23 | **UI**: イベントカードの MarchinZ Log 行 — 青い「MarchinZ Log」チップを削除。「参加者」ラベルをプロフィールアイコンの左に配置（人数は `（N）` ボタン）。 |
| 1.25.90 | 2026-05-23 | **UI**: コミュニティイベントのカレンダー表示 — チップを最大2行、同一週に複数イベントがある行は縦幅を自動拡張（`data-cal-week-max`）。 |
| 1.25.89 | 2026-05-23 | **修正**: コミュニティイベントカードの ⋯ メニュー（編集する／削除する）が `overflow: hidden` で切れる不具合 — 開いたときカード・一覧を `overflow: visible` に。 |
| 1.25.88 | 2026-05-21 | **改善**: 「未記入に戻す」確認文・Log 解除時の Note `participation_style` クリア／一覧「—」表示。プロフィール Log 削除の `localStorage` をイベント単位で整理。Note タブが `marchinz-mll-updated` で再読込。触った JS の `?v=` を 1.25.88 に統一。§3.3・§5 に Note 残存／削除 UI を追記。 |
| 1.25.87 | 2026-05-21 | **修正**: Google ログイン直後に Google 登録名がヘッダーに一瞬出る不具合 — Firestore 同期完了まで表示名を非表示。リダイレクト復帰時はローディングを維持。 |
| 1.25.86 | 2026-05-21 | **修正**: コミュニティ「未記入に戻す」を `clearCommunityAttendanceForEvent` に固定（`mll_logs` + `attendees` 削除・Note 維持）。`attendees` のみ消すフォールバックを廃止。`marchinz_mll_logs_v1` のローカルキャッシュも同期削除。 |
| 1.25.85 | 2026-05-21 | **修正**: イベント参加の解除を `removeUserInvolvementForCalendarEvent` に統一 — Log 削除・Note 削除・コミュニティ「未記入に戻す」で `mll_logs` / `attendees` /（Note 削除時は Note も）を整合。`marchinz-mll-updated` を Note 削除でも発火。仕様 §5 に作成・削除対応表を追記。 |
| 1.25.84 | 2026-05-21 | **修正**: マイページから MarchinZ Log 削除後もコミュニティ（演奏会等）に参加者として残る不具合 — 登録時は `mll_logs` と `attendees` の両方に書くのに削除は Log のみだったため。同一イベントに Log が残っていなければ `attendees` も削除（`cleanupCalendarAttendanceAfterLogDelete`）。`marchinz-mll-updated` でイベント一覧を再読込。 |
| 1.25.83 | 2026-05-21 | **修正**: プロフィール保存 — 二重送信防止・保存中のボタン／オーバーレイ表示の統一、誕生日エラー時の `setProfileError` 未定義を修正、失敗時の誤った `marchinz-profile-saved` 発火を削除。スマホはプロフィール編集ダイアログ内スクロールを安定化。 |
| 1.25.82 | 2026-05-21 | **UI**: プロフィール編集・新規登録 — 表示名の説明を「MarchinZで他ユーザーに見える名前です。」に短縮。 |
| 1.25.81 | 2026-05-21 | **修正**: スマホのイベント編集モーダル — 背面ではなく `.calendar-edit-body` 内でスクロール。表示中は `calendar-ev-compose-active` で背面スクロールをロック（`calendar-events.js`）。 |
| 1.25.80 | 2026-05-21 | **データ**: `大会動画リスト_マーチング祭.csv` — 団体/チーム名 `Keys`（引用符なし）4件を `"Keys"` に統一。`sync_csv_to_json.py` で `data.json` / `data.inline.js` 再生成。 |
| 1.25.79 | 2026-05-21 | **UI**: メディアページ — 区分タブ・セクション見出しチップ内のアイコンと文字の間隔を `gap` で確保（`inline-flex`）。1行表示は維持。 |
| 1.25.78 | 2026-05-21 | **UI**: 運営・メディアのセクション見出しチップ（`.media-section-heading`）— 文言が2行に折り返されないよう `white-space: nowrap`。 |
| 1.25.77 | 2026-05-21 | **UI**: 新規登録後のプロフィール記入 — 必須項目（表示名・都道府県・性別・誕生日・カテゴリー）未入力時に項目別の赤文字メッセージ。写真・カバー・プロフィール文は任意表示。 |
| 1.25.76 | 2026-05-21 | **修正**: YouTube マイリスト追加 — 削除済みの `ensureDefaultChannelList` 参照で `Can't find variable` が出る不具合。リスト未作成ユーザーはピッカーで新規リスト作成後に保存（空名は「リスト」）。 |
| 1.25.74 | 2026-05-21 | **UI**: MarchinZ Log KPI バッジ（チームスタッフ）— 円内イラストの下部ラベルが切れないよう `background-size: contain` に変更。 |
| 1.25.73 | 2026-05-21 | **修正**: 参加スタイルの表示 — 空・変換不能・4区分外の値を黙って「観戦」にしない。`resolveParticipationStyle` / `inferRoleFromLogOrNull` で不明は「（参加スタイル不明）」、KPI 集計は不明行を除外。フォーム未選択のみ `canonicalRole` → watch。 |
| 1.25.72 | 2026-05-21 | **修正**: Note 編集の参加スタイル同期が日付+タイトル一致で他イベントの Log/Note まで更新されていた不具合（`eventId` 指定時は当該イベントのみ）。**修正**: ヘッダー／フッター内ナビを同一タブのハッシュ遷移に統一（`site-nav.js`）。 |
| 1.25.71 | 2026-05-21 | **修正（緊急）**: `index.html` で `user-profile-page.js` の script タグが欠落しマイページが表示不能になっていた不具合を復旧。 |
| 1.25.70 | 2026-05-21 | **UI**: MarchinZ Note サブタブ文言を「作成済」「未記入」「すべて」に変更。初期表示は「作成済」。 |
| 1.25.69 | 2026-05-21 | **UI**: MarchinZ Note サブタブにアイコン。**機能**: Note 編集で参加スタイルを変更し、同一イベントの MarchinZ Log・Note・カレンダー参加登録へ一括反映（`syncParticipationForProfileEvent`）。 |
| 1.25.68 | 2026-05-21 | **UI**: マイページ MarchinZ Note（本人視点）— サブタブ「記入済み」「未記入」「全MarchinZ Log」で一覧を切り替え（`event-log-diary.js` / `user-profile-page.js`）。 |
| 1.25.67 | 2026-05-21 | **修正**: コミュニティ Note 一覧 — `reconcileDiariesParticipationFromLogs` が他人の Note を Firestore 更新しようとして失敗し表示が古いままだった不具合。公開 Log から **メモリ上のタグを常に上書き**、Firestore バックフィルは本人閲覧時のみ。Log 突合で venue 不一致を解消。 |
| 1.25.66 | 2026-05-21 | **修正**: プロフィール Log日記タブでも `reconcileDiariesParticipationFromLogs` を実行（仕様「CG およびプロフィール」に整合）。**ドキュメント**: §5 に Note/Log `participation_style` 同期の 2 段構えを追記。 |
| 1.25.65 | 2026-05-21 | **修正**: MarchinZ Log の参加スタイル変更時、紐づく Note の `participation_style` を必ず同期（カレンダー未紐づけ Log 含む）。コミュニティ Note 一覧読み込み時も Log と突き合わせてずれを Firestore 上で修正（`mll-role.js` `reconcileDiariesParticipationFromLogs`）。 |
| 1.25.64 | 2026-05-21 | **修正（Firestore）**: コミュニティ Note 一覧 CG — `event_log_diaries` の collection group `read` から `profileOwnerActiveForPublicContent` を削除（Rules are not filters 違反で `permission-denied`）。公開判定は `visibility==public`（＋本人）のみ。凍結・退会除外は `mln-public-feed.js` のクライアント hide のみ。要 `firebase deploy --only firestore:rules`。 |
| 1.25.64 | 2026-05-21 | **修正**: MarchinZ Note 詳細で参加スタイルが「観戦」に化ける（`スタッフ・運営` の中黒表記を `canonicalRole` / `participationFormatLabel` で正しく解釈）。 |
| 1.25.63 | 2026-05-21 | **修正**: プロフィール MarchinZ Log のケバブメニューがスマホ右端で切れる（オーバーフローパネルを右寄せ）。 |
| 1.25.62 | 2026-05-21 | **修正**: 退会 — `mll_profiles` 更新が凍結フィールド差分ガードで拒否され得る不具合（退会ルールをガード外に）。ペイロード型正規化（`marchinz_public_id` 等）。 |
| 1.25.60 | 2026-05-21 | **UI**: ヘッダー・モバイルメニュー・認証導線（`data-mll-auth-entry` / `data-mll-auth-switch`）に Font Awesome アイコン（新規登録・ログイン）。 |
| 1.25.59 | 2026-05-21 | **UI**: MarchinZ Log KPI — メダル型バッジを復元し、その下に「x回観戦…」テキスト行。 |
| 1.25.58 | 2026-05-21 | **UI**: マイページ MarchinZ Log タブの背景を TOP finale（`mll-lp-finale--pattern-a`）と同一ルールに。レイアウト調整。 |
| 1.25.57 | 2026-05-21 | **UI**: MarchinZ Log 集計を「x回観戦、x回出演…」形式に統一（全体サマリー＋年別、0回は非表示、運営は「x回運営」）。 |
| 1.25.56 | 2026-05-21 | **UI**: 「この団体を検索」でキーボードが出ないよう focus 削除。スマホドロワーのプロフィール／設定／ログアウトにアイコン。設定ダイアログをスマホでも中央表示。 |
| 1.25.55 | 2026-05-21 | **修正**: 掲示板返信で「画像を添付」ボタンが出ない不具合（返信用 file 入力のラベル組み立て）。**コンテンツ**: みかづきマーチ5巻の Amazon リンク・表紙画像を更新。 |
| 1.25.54 | 2026-05-20 | **修正**: β同意が毎回出る不具合（`fetchProfile` が `b_test_consent_version` を返していなかった）。Note 一覧 read ルール緩和。退会再試行時のサブコレクション削除。 |
| 1.25.53 | 2026-05-20 | **UI**: 管理人専用領域（管理ページ・凍結パネル・ナビ「管理」）の背景をピンク／赤系に統一。 |
| 1.25.52 | 2026-05-20 | **変更**: 凍結アカウントは他ユーザーにニックネーム・画像・カバーのみ表示。凍結時に Log/Note/マイリストを非公開化（ルール `profileOwnerActiveForPublicContent`）。 |
| 1.25.51 | 2026-05-20 | **追加**: 管理ページに「凍結アカウント」タブ（一覧・検索・凍結解除・プロフィールへのリンク）。 |
| 1.25.50 | 2026-05-20 | **修正**: 退会時の `mll_profiles` 権限エラー（ルール緩和・退会フラグを先に保存してからサブコレクション削除）。 |
| 1.25.49 | 2026-05-20 | **修正**: 参加スタイル変更時に MarchinZ Note の `participation_style` も同期。イベント詳細の見出しを「MarchinZ Log」に統一。 |
| 1.25.48 | 2026-05-20 | **修正**: 掲示板「通報する」メニューが投稿カード下端で切れる不具合（上向き表示・overflow 調整）。 |
| 1.25.47 | 2026-05-20 | **修正**: ノート編集 — ノートページからの編集で画面が固まる件（タブ表示前のモーダル・深いリンク行解決）、保存後のトースト（非公開含む）を表示。 |
| 1.25.46 | 2026-05-20 | **修正**: 大会動画「もっと見る」後のページ案内が表示件数のままになる不具合（実際の表示件数・該当件数を反映、全件表示時は次へを無効化）。 |
| 1.25.45 | 2026-05-20 | **修正**: β同意モーダルがリロード時に2回出る不具合（`auth.js` の二重呼び出し削除・表示中の再オープン防止）。 |
| 1.25.44 | 2026-05-20 | **UI**: スマホのフッターナビ — 3列グリッドを廃止し、`/` 区切りの横並び（間隔を詰める）。 |
| 1.25.43 | 2026-05-20 | **文案**: ユーザー向け表記を「βテスト」に統一（Bテスト・ベータテスト・「UI改善」目的の記述を廃止）。プライバシー第7項・同意モーダルを試験運用・データ保存リスクの説明に差し替え。`B_TEST_CONSENT_VERSION` → `2026-05-20-v3`（再同意）。 |
| 1.25.42 | 2026-05-20 | **修正**: 大会動画・YouTube — 全件表示後も「もっと見る」が残る不具合（残り件数判定・残り1件のチラ見せ廃止）。**分析**: GA4 イベント拡張（β同意・Note・掲示板・通報等、`docs/ANALYTICS_EVENTS.md`）。バックアップ `backups/backup_20260520_202804`。 |
| 1.25.41 | 2026-05-20 | **分析**: GA4 イベント拡張（初回実装、`marchinz-analytics.js` 連携）。 |
| 1.25.40 | 2026-05-20 | **βテスト同意**: 「協力する／参加しない」を廃止し「βテストの規約に同意します」チェック＋同意して続ける／ログアウトのみに変更。 |
| 1.25.38 | 2026-05-20 | **法務・同意**: 既存ユーザーはログイン時に規約・ポリシー再同意のあと**ベータ（Bテスト）同意を必須**（ブロック付きモーダル。「あとで」廃止）。 |
| 1.25.37 | 2026-05-20 | **法務・同意**: 利用規約・プライバシーポリシーを現行機能（退会・凍結・Firebase・通知等）に合わせて更新。`LEGAL_POLICY_VERSION` を `2026-05-20-v1` に上げ、既存ユーザーはログイン時の再同意モーダル。**任意**: UI改善 Bテスト — 新規登録チェック・設定トグル・既存向け一度きりの案内（`marchinz-b-test.js`、`b_test_*` フィールド）。 |
| 1.25.36 | 2026-05-20 | **UI**: メディアページ — 区分タブと同じ FA アイコンを各セクション見出し（`h3.media-section-heading`）にも表示（note は従来どおりなし）。 |
| 1.25.35 | 2026-05-20 | **修正**: 退会再試行 — 途中失敗で `withdrawn: true` のまま残った場合でもサブコレクション／`mll_logs` 削除可（`profileOwnerSelfDeleteOwn`）。既に退会済みなら `mll_profiles` の再書き込みをスキップ。**UI**: フリーマガジンタブアイコンを `fa-music`（音符）に変更。 |
| 1.25.34 | 2026-05-20 | **修正**: 退会 — `mllProfileSelfWithdrawOk` が `FieldValue.delete` の removed キーを誤検証して `permission-denied` になる不具合。プロフィールは allowlist のみ `set` 全置換。`notifications` / `profile_private` 削除を退会前ルールに統一。 |
| 1.25.33 | 2026-05-20 | **修正・UI**: MarchinZ Note — 参加スタイル変更で同一イベントが二重表示される問題を日付＋タイトルで統合、チップは Log の最新スタイルを優先。公開／非公開バッジは一覧の表紙のみ。詳細の写真は表紙除くギャラリー、4 枚は 2×2。 |
| 1.25.32 | 2026-05-20 | **UI**: メディア区分タブ — note はアイコンなし。アニメは `fa-film`（動画）。フリーマガジン（当時 `fa-unlock`、1.25.35 で `fa-music`）、マンガ `fa-book-open-reader`、雑誌 `fa-newspaper` で差別化。運営ページ — 見出し（公式X・お問い合わせ）と Google フォームボタンに FA。 |
| 1.25.31 | 2026-05-20 | **修正**: 掲示板 — 通報 ⋯ を `panelBelow`＋高 z-index、スレッド／返信の `overflow` クリップ解除。返信入力中はスレッド内の「返信する」を非表示。返信は「画像を添付」＋「返信を送る」各50%。大会動画検索ラベルを1行左詰め、リセット／シェアに内側余白。フッターナビの FA アイコン削除（3列は維持）。 |
| 1.25.30 | 2026-05-20 | **UI**: イベント一覧（リスト表示）— 日付 `mm/dd` 化に合わせ日付列を `max-content` に縮小し、イベント名の表示開始位置を左寄せ。 |
| 1.25.29 | 2026-05-20 | **差し戻し**: イベント／Note カード左端バッジを「観戦」から **MarchinZ Log** に戻す（参加スタイルチップの「観戦・出演」等は変更なし）。 |
| 1.25.28 | 2026-05-20 | **UI**: フッターナビをスマホで 3 列×3 行グリッドに（フォント・余白をやや縮小）。 |
| 1.25.27 | 2026-05-20 | **UI**: 大会動画カード等 — 「この団体を検索」「マイリストに追加」「シェアする」「もっと見る」に FA アイコン。配信元メタ日付を `yyyy/mm/dd`・区切りスペースに。ページ送り「前へ」「次へ」は矢印アイコンのみ。メディア／クリエイター／YouTube も同様。 |
| 1.25.26 | 2026-05-20 | **UI**: イベント一覧 — リスト表示の日付を `mm/dd` に。カレンダー表示時は年別リストを非表示。カレンダー左端の見切れをグリッド幅調整で解消。 |
| 1.25.25 | 2026-05-20 | **UI**: 大会動画検索パネル — 見出し「検索」を削除、入力内の虫眼鏡を廃止しラベル左に検索アイコン（団体/チーム名・フリーワード）。 |
| 1.25.24 | 2026-05-20 | **修正・UI**: 掲示板の ⋯ 通報メニューを下向き表示（`panelBelow`）で見切れ解消。返信入力中は「返信する」を非表示。返信行に「画像を添付」（左半分）＋「返信を送る」（右半分）、画像付き返信は既存 Storage フロー。 |
| 1.25.23 | 2026-05-20 | **修正**: 種別タブ・表示切替（FA アイコン追加後）の横はみ出し。タブ行に横スクロール＋右端余白、カード／チップ行の `min-width:0` で右端見切れを解消。 |
| 1.25.22 | 2026-05-20 | **改善**: イベントカード左端バッジの「MarchinZ Log」表記を「観戦」に統一。コミュニティ Note 一覧・詳細にも同バッジを表示。参加スタイルチップは `participationFormatLabel` で正規化（旧データ・role キー対応）。 |
| 1.25.21 | 2026-05-20 | **改善**: TOP ランディングの青リンク（ヒーロー下・できることカード内）と CTA ボタンに Font Awesome アイコンを追加。 |
| 1.25.20 | 2026-05-20 | **修正**: スマホ表示でハンバーガーメニューが二重表示になる不具合（CSS 3 本線＋ FA `fa-bars` の重複。モバイルトグルは CSS のみ）。 |
| 1.25.19 | 2026-05-20 | **改善**: Font Awesome 6 Free をセルフホスト導入。グローバルナビ・主要タブ・検索・CTA（P0+P1）にアイコン。いいねは全画面で FA ハート＋タップ時ポップアニメ（`marchinz-engage-ui.js` 共通化）。 |
| 1.25.18 | 2026-05-19 | **改善**: MarchinZ Note カードのイベント名・日付・参加スタイル行から中黒（·）区切りを削除（flex の gap で間隔を確保）。 |
| 1.25.17 | 2026-05-19 | **改善**: コミュニティイベント一覧（カード・リスト表示）を開催年ごとにグループ化。マイページ MarchinZ Log と同様の年見出し＋件数サマリー。2年以上あるときは上部に年ジャンプ用リール（横スクロール）を表示。 |
| 1.25.16 | 2026-05-19 | **改善**: プロフィール MarchinZ Log の参加スタイル編集ダイアログ見出しを「MarchinZ Logを編集」に変更（説明文を削除）。 |
| 1.25.15 | 2026-05-19 | **改善**: 新規話題投稿の画像説明文を短縮（「アップロード時に自動で圧縮。（元が20MB超は不可）」）。 |
| 1.25.14 | 2026-05-19 | **改善**: 掲示板返信のプレースホルダーを「返信」に短縮。画像添付は「画像を添付」ボタン化（未選択時の「ファイル未選択」非表示・新規投稿フォームも同仕様）。 |
| 1.25.13 | 2026-05-19 | **改善**: 掲示板・返信の「編集」で画像の追加・削除。コミュニティ Note 閲覧から「編集する」で写真編集付き画面へ（`#profile?…&edit=1`）。イベント登録フォームの冗長な説明削除・旧 `mll-log-form` 二重表示防止。 |
| 1.25.12 | 2026-05-19 | **修正**: 掲示板（スマホ）で投稿本文が右にはみ出して見切れる不具合（画像 flex の min-width・本文の折り返し）。 |
| 1.25.11 | 2026-05-19 | **改善**: 掲示板投稿画像は正方形トリミングを廃止（全体表示・枚数に応じて中央配置）。タップでライトボックス表示（画面内・×で閉じる）。アップロード前圧縮は維持（最大辺1920px）。 |
| 1.25.10 | 2026-05-19 | **改善**: プロフィール MarchinZ Log で「編集する」から参加スタイル（観戦・出演等）を変更可能に。スマホは参加スタイル・いいね・⋯ を1行表示。 |
| 1.25.9 | 2026-05-19 | **修正**: 大会動画「検索結果をシェアする」等のシェアドロップダウンがスマホで左にはみ出して見切れる不具合（検索パネル内は左揃え・行幅100%）。 |
| 1.25.8 | 2026-05-19 | **改善**: 掲示板の新規話題・イベント登録フォームの入力下書きを `sessionStorage` に保持（別画面へ移動してもテキスト欄を復元。画像は対象外）。未入力のまま離脱した場合は作成 UI を閉じ、カテゴリ／種別タブを左端に戻す。 |
| 1.25.5 | 2026-05-19 | **修正**: コミュニティ「ノート」一覧のカードクリックで詳細が開かずフリーズする不具合（ビューア dialog・画像オーバーレイ）。 |
| 1.25.3 | 2026-05-19 | **修正**: 退会処理が Firestore ルールで拒否される不具合（`mllProfileSelfWithdrawOk`・サブコレクション削除・`update`+`FieldValue.delete`）。 |
| 1.25.2 | 2026-05-19 | PC表示: コミュニティ／MarchinZ Note をワイドレイアウト化（カードグリッド・見出し余白）。TOP ランディングの機能カードを PC 向けに調整。 |
| 1.25.1 | 2026-05-19 | 大会動画／YouTubeマイリストの「シェアする」はリスト所有者のみ表示（他者の公開プロフィール閲覧時は非表示）。 |
| 1.25.0 | 2026-05-19 | **マイナー**: 1.24.x パッチ確定（プロフィール／カバー切り抜き・Firestore 保存 1.24.31–33）。ワークスペースルール（ワンチーム・2回失敗後 Gemini 仮説依頼）。バックアップ `backups/backup_20260519_190550`。**本番デプロイは未実施**。 |
| 1.24.33 | 2026-05-19 | プロフィール保存: レガシーフィールド2段階削除・型ゆれ掃除（cover_image_urls/pref_count_* 等）。Firestore 更新時は変更キーのみ型検証。 |
| 1.24.32 | 2026-05-19 | プロフィール保存: Firestore 差分検証の型ゆれ修正・レガシー削除パス・profile_private 差分更新。保存失敗時はプレビューをサーバー状態に戻し、端末ローカルだけ変わって見える問題を案内。 |
| 1.24.31 | 2026-05-19 | プロフィール保存: Firestore 本人更新を差分 allowlist 検証に変更（レガシーフィールド残存でも保存可）。クライアントは掃除＋更新を1回の merge に統合。 |
| 1.24.30 | 2026-05-19 | プロフィール: カバー Cropper 初期化修正・Firestore 許可外キー自動削除・スマホ画像縮小・マイページ画像キャッシュバスター。Storage ルール `image/jpeg` 緩和。 |
| 1.24.29 | 2026-05-19 | プロフィール切り抜き（スマホ）: iOS Safari 向けに Data URL 読込・`src=\"\"` 誤 onerror 防止。 |
| 1.24.28 | 2026-05-19 | プロフィール保存: 保存前に性別・誕生日のルート移行を再実行。`permission-denied` 時の案内強化。カバー切り抜き: ファイル選択後 450ms 遅延表示で幽霊クリック対策。 |
| 1.24.27 | 2026-05-19 | 掲示板・新規話題: モーダル内ログイン案内を廃止（未ログイン時は作成ボタンで `#login` へ）。スマホのみカテゴリをプルダウン。返信行のボタン折り返し改善。 |
| 1.24.26 | 2026-05-19 | プロフィール切り抜き: `profileCropGateActive` でファイル選択〜クロップ完了まで背面閉じ・保存を制御（`capture` 廃止・ゲート誤残留による保存不能を修正）。 |
| 1.24.25 | 2026-05-19 | プロフィールカバー／アバター切り抜き: Esc・背面オーバーレイ・`profileForm` submit をクロップ表示中は完全ブロック（キャプチャ段階・`stopPropagation`）。ファイル選択ハンドラにコメント整理。 |
| 1.24.22 | 2026-05-16 | カバー切り抜き: 診断ロック解除（本番復帰）。Cropper `dragMode: move` + `zoomOnTouch: false` でスマホ初回ドラッグを改善（ズームは ± ボタン・ホイール）。 |
| 1.24.21 | 2026-05-16 | **診断用**: カバー切り抜き `closeCropDialog` 凍結＋`console.trace`、`openCropDialog` try-catch、Submit 捕捉、inert/DOM 構造チェック（本番デバッグ・一時）。 |
| 1.24.20 | 2026-05-16 | カバー切り抜き: 背面タップ閉じ廃止・決定/キャンセルのみ（`heic2any`/`inert`/2.35:1 維持）。Note/フィードの作者表示を名前のみ（「プロフィールで見る」廃止）。Log バッジ 112px・スマホ 2×2・MLL 一覧タイトル折り返し修正。 |
| 1.24.16 | 2026-05-16 | MarchinZ Log KPI バッジ: 実寸 224px 画像を 112px 表示（Retina 2x）、参加形式別枠色・Fredoka 48px。PC 4列／スマホ 2×2。カバー切り抜き背面閉じフラグ制御（`1.24.15`）。 |
| 1.24.15 | 2026-05-16 | カバー切り抜き: `isCropBackdropDismissActive` フラグ（Cropper ready 後 100ms で有効化）、プロフィールモーダル背面クリック無効化。 |
| 1.24.14 | 2026-05-16 | プロフィールカバー／アバター切り抜き堅牢化: 背面閉じを `pointerdown`（ファントム `click` 無視）、HEIC→JPEG（`heic2any`）、クロップ中 `#mz-profile-dialog` に `inert`。MLL KPI バッジ 4色・カレンダーイベント ⋯（`1.24.13` 分を本番反映）。 |
| 1.24.12 | 2026-05-17 | プロフィールカバー／アバター切り抜き: ファイル選択直後の幽霊クリックで `#mz-crop-dialog` が即閉じる不具合を修正（バックドロップ閉じ 450ms ロック・画像読込失敗時アラート・Esc でクロップ優先）。 |
| 1.24.11 | 2026-05-17 | プロフィール MarchinZ Log 一覧: 各行の巨大「削除」ボタンを廃止し、右端 **⋯** から「編集する」「削除する」ドロップダウン（`marchinz-engage-ui.js` `buildActionOverflow`）。 |
| 1.24.10 | 2026-05-17 | **本番デプロイ**: OGP 共通画像 `ogp-card.png`（1200×630）・Note 表紙 `cover_photo_index` 保存修正・コミュニティ／イベントタブ「すべて」・掲示板 compose 配置ほか（`1.24.8`–`1.24.10`）。**Firestore rules**（`cover_photo_index`）反映済。 |
| 1.24.0 | 2026-05-17 | **マイナー**: 本番デプロイ（1.23.28–1.23.31 のパッチ一式・`img/mll-log/`・`img/defaults/`・Firebase rules/indexes）。バックアップ `backups/backup_20260517_185526`。 |
| 1.23.31 | 2026-05-17 | MarchinZ Note サムネ: `normalizeNotePhotoUrls`（https のユーザー添付のみ・既定画像は表示専用で Firestore 非保存）。プロフィールカバー未設定時 `img/defaults/cover_d.png`（`marchinz-default-assets.js`）。 |
| 1.23.29 | 2026-05-17 | MarchinZ Log 集計 KPI: 参加形式別丸画像（`img/mll-log/`）・Fredoka フォント・紫枠。マイリスト見出しは展開ヒット領域と分離（いいね誤タップ抑制）。 |
| 1.23.28 | 2026-05-17 | いいね通知 72h 重複抑止: `marchinz-notify.js`（actor+target クエリ・sessionStorage）、通知 read ルール（actor 自分の送分のみ）、インデックス。マイリストいいね inflight・プロフィール refresh。 |
| 1.23.16 | 2026-05-17 | **いいね・通報・シェアの整理**: §3.7 に統合一覧（シェア含む）を追加。**修正**: プロフィールマイリスト展開時の**ブックマーク個別いいね**を復元。**修正**: `#admin/reports` に **MarchinZ Note** 通報タブ（`mll_note_reports`）。§8・§9 を整合。 |
| 1.23.11 | 2026-05-17 | **修正**: 他会員のプロフィールでマイリスト名がリスト ID（`L_…`）表示になる不具合。Firestore `video_lists` / `channel_lists` の read 条件をブックマーク側と揃え（`visibility` 未設定＝公開）。クライアントで公開リスト名の doc 補完・ID フォールバック廃止。 |
| 1.23.10 | 2026-05-16 | **プロフィール表示ルール**: 登録ユーザーは非公開タブ／リストで「非公開です」、未記入は「まだ○○はありません」。未登録来訪者はユーザー名・プロフィール・バナーのみ閲覧可。Log／Note／マイリストは公開でも**登録必須**（案内文＋「登録促進フェーズへ」）。 |
| 1.23.9 | 2026-05-16 | **UI 統一**: ユーザー向け**通報**はすべて **⋯ メニュー**（`marchinz-engage-ui.js`）。**いいね**はタイトル（イベント名・投稿タイトル・リスト名）の**右横**に配置（掲示板スレッド・Note カード・プロフィール Log／マイリスト・カレンダー・自分の Log 一覧・動画／YouTube マイリスト）。 |
| 1.23.6 | 2026-05-17 | MarchinZ Note: **タイトル（必須・30字）**と本文を分離。YAMAP 風カード（画像・イベント名・日付・参加形式・投稿者）。プロフィール／コミュニティで**検索**・**いいね**・**通報（⋯）**。コミュニティ一覧の **permission-denied** 修正（collection group 読取ルール）。他ユーザー視点で**参加形式が古い値のまま**になる不具合を修正（`attendees` / Log の最新値を表示・保存時同期）。`mll_note_reports` コレクション追加。 |
| 1.23.1 | 2026-05-17 | MarchinZ Note: 保存前に `attendees` を補完（`mll_logs` のみの行でも保存可）。保存後は閲覧画面に切替。リンクコピー（🔗）は保存済み Note のみ表示。 |
| 1.23.0 | 2026-05-17 | **マイナー**: MarchinZ Log SSOT（`mll_logs` 同期・編集プレフィル・Note 整合・登録モーダル修正）。バックアップ `backups/backup_20260517_105350`。本番未デプロイの版表記。 |
| 1.22.11 | 2026-05-17 | イベント登録モーダルが空になる不具合を修正（`calendar-event-form` をモーダル内に表示）。 |
| 1.22.10 | 2026-05-17 | Gemini レビュー反映: 一覧読込の client-side repair 廃止。イベント必須項目を復活（ゴミデータ防止）。`scripts/migrate-attendees-to-mll.mjs` で attendees→mll_logs 一括補完。SSOT 同期・顔アイコン・編集プレフィルは維持。 |
| 1.22.9 | 2026-05-17 | MarchinZ Log を **mll_logs を正**としてイベント・Note・編集フォームと同期（中間版。repair/任意化は 1.22.10 で整理）。 |
| 1.22.8 | 2026-05-17 | イベント編集に「やめる」ボタン。イベント登録・編集の関わり方を**任意**（未選択は `未定`）。マイリスト保存ダイアログで既存リスト選択時に新規作成フォームが出る不具合を修正。 |
| 1.22.7 | 2026-05-17 | 「募集対象（想定参加者）」を廃止し、イベント登録・編集を **あなたの関わり方（MarchinZ Log）** の4区分（観戦・出演・チームスタッフ・スタッフ・運営）に統一。`mll-role.js` の `MLL_PARTICIPATION_4` を正とする。 |
| 1.22.6 | 2026-05-17 | プロフィール MarchinZ Log 各行に「この MarchinZ Log を削除」（確認付き）。本人作成イベント紐づき時は掲示は残る旨を表示。 |
| 1.22.5 | 2026-05-17 | イベント削除時の作成者 Log 削除を強化（`calendar_event_id` 直クエリ・日付不一致時のタイトル+会場フォールバック）。Log 未検出時の案内文言。 |
| 1.22.4 | 2026-05-16 | **P1.8** イベント削除をゴミ箱化（`status` / `trashed_at` / `trashed_by`）。作成者 Log は常に物理削除。一覧・P0 matchKey は `trashed` 除外。`isCalendarEventTrashPatch` を Firestore ルールに追加。イベント登録はモーダル UI（v1.22.3 から継続）。 |
| 1.22.1 | 2026-05-16 | **P0** イベント登録フォーム: 同一 matchKey のカレンダー再利用・同一 user+role の Log マージ・`calendar_event_id` / `source: event_register` 付与。**P1** 管理人統合: `calendar_event_id` 優先の Log 書き換え・統合先のユーザー別重複行マージ（§12）・確認ダイアログに件数プレビュー。イベント削除: 「自分の MarchinZ Log も削除」チェック（既定 ON）。Firestore ルール・インデックス更新。 |
| 1.22.0 | 2026-05-16 | P1.5 準備: `scripts/backfill-mll-calendar-event-id.mjs`（`calendar_event_id` バックフィル・重複 Log 行マージ）。`docs/MLL_CALENDAR_LIFECYCLE_DISCUSSION.md` v0.3（Gemini レビュー・合意ロードマップ）。バックアップ `backups/backup_20260516_*`。 |
| 1.21.33 | 2026-05-16 | MarchinZ Log プロフィール読み込み修正: `mll_logs` を `user_id` でクエリ（他者非公開混在によるコレクション全体クエリ失敗を回避）。`queryMllLogsForUser` / `queryMllLogsForFeed`。保存後 `marchinz-mll-updated` でプロフィール再描画。 |
| 1.21.32 | 2026-05-16 | MarchinZ Log 根本改修: `mll-role.js` で role ロジック一元化。Firestore 複合インデックス（`mll_logs`）。カレンダー Log 同期失敗のエラー明示。文言分離（募集対象 vs あなたの関わり方）。`scripts/repair-mll-log-roles.mjs` で既存ログ補正。 |
| 1.21.31 | 2026-05-16 | ヘッダーアバターに未読通知バッジ。通知「既読にする」で未読一覧から即非表示。マイリスト編集（推しポイント・リスト単位の公開設定・削除文言）。プロフィールのマイリストいいね。旧「マイリスト」リストのピッカー非表示。MarchinZ Log 参加スタイルの保存・表示整合（`role` / `role_label`）。 |
| 1.21.30 | 2026-05-16 | マイリスト新規作成時に推しポイント入力。旧 default「マイリスト」の自動削除。通知削除の改善・いいね対象リンク遷移修正（`#community/board`）。管理お知らせフォーム表示修正。検索文言「この団体を検索」。 |
| 1.21.29 | 2026-05-16 | カバー切り抜き：枠を画像表示領域（canvas）内にフィットさせ、Cropper 内部要素の CSS 強制 100% を撤去（枠と出力の不一致を修正）。 |
| 1.21.28 | 2026-05-16 | マイリスト保存先ピッカー：タブ単位の公開中／非公開中表示、デフォルト「マイリスト」廃止。通知：件ごと「削除する」、運営お知らせリンクの in-app 遷移修正、同一対象いいねは 72 時間で 1 通知まで。掲示板：返信フォームは「返信する」押下後にのみ表示。 |
| 1.21.27 | 2026-05-16 | 通知「既読にする」で未読から即時非表示（楽観 UI）。ユーザー番号は常に 8 桁表示。カバーをシネスコ 2.35:1（1200×510）に変更。他人プロフィール閲覧時は視点切替・通知を非表示（`data-mz-prof-visitor`）。 |
| 1.21.26 | 2026-05-16 | いいね通知の既読化を再修正（ログイン UID で更新・成功後に UI 反映・ボタン直結リスナー）。Firestore ルールで `read: null` も既読化可。72h 重複抑止のクエリを `target_id` 単体に変更。 |
| 1.21.25 | 2026-05-16 | 設定ダイアログを PC でプロフィール編集相当に拡大・スマホ横揺れ抑制。掲示板: 折りたたみ返信で「ファイルを選択」を非表示、モバイル本文の折り返し強化。いいね通知: 72 時間重複抑止、既読化ルール修正（`read` 未設定対応）、actor プロフィール遷移、受信箱 owner UID 固定。§1.7 追加。 |
| 1.21.24 | 2026-05-16 | マイリスト折りたたみ時は見出しブロック内にサムネイルのみ表示（大会動画・YouTube 共通）。非公開はブラー＋「非公開です」（タブ単位・リスト単位）。MarchinZ Log 非公開も同様。他ユーザー視点でプロフィール全体をオレンジ系背景に。 |
| 1.21.23 | 2026-05-16 | 管理ナビを TOP より左へ。管理ページのサイトお知らせフォーム表示を修正。プロフィール編集ダイアログを PC で拡大・スマホ横揺れを抑制。「他ユーザーの視点」で編集・シェア・推しポイント編集を非表示。マイリスト公開設定を全リスト一括反映、折りたたみ時も小カード表示、非公開リストは文言表示。 |
| 1.21.22 | 2026-05-16 | カバー切り抜き・表示を **13:4** に統一。掲示板・イベント・MLL の作成者表示をプロフィール最新情報に。掲示板のスマホはみ出し修正、作成者名をプロフィールへリンク。「他のユーザーの視点」で通知 UI を完全非表示。 |
| 1.21.21 | 2026-05-16 | Firestore ルール: `isVideoListLikeOnlyPatch` / `isChannelListLikeOnlyPatch` から未使用引数を削除（コンパイル警告解消）。挙動変更なし。 |
| 1.21.20 | 2026-05-16 | カバー高さを約 2/3 に調整。プロフィールのマイリスト: シェアメニューが効くよう修正、本人のみ「編集する」（削除含む）。視点切替ラベルを「他のユーザーの視点」に変更し、当該プレビュー中は通知タブ・運営バナーを非表示。設定トグル不具合の原因だった `marchinz_public_id` ルール（1〜2 桁を許可）を修正。 |
| 1.21.19 | 2026-05-16 | 掲示板: いいね・返信を大型化し右下エリアに配置、通報は「⋯」メニュー経由。ユーザー番号表示で 1〜100 を 3 桁（`001`）、101+ を 8 桁に区分（`user-profile-page.js`）。運用手順は `docs/OPS_GUIDE.md` §3.0。 |
| 1.21.18 | 2026-05-16 | プロフィール編集: PC 向けにダイアログを大型化、`ensureProfile` がログインのたびに `display_name` を Google 氏名で上書きしていた不具合を修正（ニックネーム保持）。保存成功時に「変更を保存しました」トースト。 |
| 1.21.17 | 2026-05-16 | 掲示板: ログイン後も認証フェーズが残る問題の修正、本文の改行表示（`pre-wrap`）、編集をオーバーレイで実施。プロフィール通知: 「既読にする」、遷移タップ時の未読バッジ更新、サイトお知らせの内部リンク（`#`）を `target=_blank` なしで遷移。 |
| 1.21.16 | 2026-05-16 | **管理者ページ** `#admin`（タブ: 通報 / サイトお知らせ）。ナビは TOP 直後の「管理」。旧 `#moderation` → `#admin/reports`。お知らせ配信 UI を `#ops` から **`#admin/announce`** へ移設（`marchinz-admin-page.js`）。`styles.css` で管理 UI を色分け。 |
| 1.21.15 | 2026-05-16 | プロフィールの大会動画／YouTube タブ件数が **空のリスト行を含めて +1** になる不具合を修正（件数をブックマークのあるリスト数に統一、`user-profile-page.js`）。PWA キャッシュキー・`?v=` を **1.21.15** に。 |
| 1.21.14 | 2026-05-16 | **`sw.js` の PWA キャッシュ名**を `marchinz-pwa-v1.21.14` に更新（activate 時に旧プリキャッシュを削除しやすくする）。`data-mz-version` と全 `?v=` を **1.21.14** に統一。**本番 URL がまだ旧版のときは** Netlify へ `010_MarchinZ` を **`netlify deploy --prod`**（または接続 Git の push）で反映する。 |
| 1.21.13 | 2026-05-16 | マイリスト通報に **`report` レート制限**（`user-profile-page.js`）。`#moderation` に **マイリスト**タブで `mll_mylist_reports` 表示（`community.js`）。仕様書 §7.4・§8・§9・§11 を整合。 |
| 1.21.12 | 2026-05-16 | `index.html` の `data-mz-version`・`styles.css`・PWA リンク・全ローカル JS の `?v=` を **同一版**に揃え、SW 登録 URL にも同版クエリ。Firebase **`firestore.rules` を本番反映**（未ログインのマイリスト read 等）。**Netlify 本番デプロイ**。 |
| 1.21.11 | 2026-05-16 | Google `signInWithRedirect` から戻ったあと（キャンセル等で未ログインのとき）`getRedirectResult` の **finally** で `mll_auth_redirect_pending` を必ず解除し、ローディングオーバーレイを閉じる（`auth.js`）。 |
| 1.21.10 | 2026-05-16 | プロフィールのマイリスト見出し横から「公開／非公開」バッジを削除（一覧上は非表示、公開設定の切替は各編集ページのパネルで従来どおり）。 |
| 1.21.9 | 2026-05-16 | プロフィールの大会動画／YouTubeマイリスト: タブ公開かつ各リストが公開のとき **未ログインでも本文表示**（`firebase/firestore.rules` の read を整理）。公開リストの **シェア**を検索結果の動画行と同型（`MarchinZShareMenu`・「シェアする」・締め文）に統一。 |
| 1.21.8 | 2026-05-16 | マイリストの推しコメント表記を UI 全体で「推しポイント！」に統一（プロフィール・YouTube リスト・案内リード）。 |
| 1.21.7 | 2026-05-16 | プロフィールで Log/Note 非公開かつマイリストのみ公開のとき、マイリストカードを高密度プレビュー（先頭 18 件＋件数表示）。 |
| 1.21.6 | 2026-05-16 | 大会動画マイリスト／YouTube マイリストの**リスト単位**いいねで `like_video_list` / `like_channel_list` 通知（既存の `like_show_*` 設定と整合）。通知タップで該当リストへ `mylist=` 付きで遷移。 |
| 1.21.5 | 2026-05-16 | カレンダーイベントのいいね UI と `liked_by` 更新、登録者へ `like_calendar_event` 通知（`like_show_calendar`・`MarchinZPushLikeNotification` と整合）。 |
| 1.21.4 | 2026-05-16 | イベント登録／掲示板投稿時のブラーと種別同期、`mll.js` のイベント種別整合、マイリスト／Storage の権限まわりと `firebase/firestore.rules`・`firebase/storage.rules` の調整（運用は `docs/OPS_GUIDE.md` §3.3）。 |
| 1.21.2 | 2026-05-15 | 運営サイト全体お知らせ（`mll_site_announcements/current`、ログイン者向けバナー・通知タブ、#ops 配信 UI、§1.6）。 |
| 1.21.0 | 2026-05-15 | `data-mz-version`・`styles.css`・スクリプト／PWA 資産の `?v=` を揃え、**Netlify 本番へ再デプロイ済**（版表示・キャッシュ付け替え）。 |
| 1.20.14 | 2026-05-15 | YouTube リスト CSV／inline 同期・整合検証（`verify_youtube_list_csv_inline.py`／`verify-repo-data.yml`）、イベント登録 UI／文言、プロフィール YouTube マイ推し・カード表示、綾北 Mercury winds リスト更新ほか。 |
| 1.20.13 | 2026-05-15 | YouTube リスト CSV／inline 整合検証（`verify_youtube_list_csv_inline.py`）、PR 用 CI（`verify-repo-data.yml`）、`check_data.py`／API 更新シェルの組み込み。 |
| 1.20.12 | 2026-05-15 | YouTube リスト CSV／`youtube-list.inline.js` の手元同期（綾北 Mercury winds 最新動画ほか）。一覧の正は `YouTubeリスト.csv` → `sync_youtube_list_csv_to_inline.py`。 |
| 1.20.11 | 2026-05-15 | イベント登録（案内文言・同意文・参加スタイルプレビュー）、登録ボタン位置、プロフィール YouTube マイリスト（マイ推し表示・編集・カード名表示）の調整。 |
| 1.20.2 | 2026-05-14 | コミュニティ・イベント検索追加（§3.2, §3.3）、クライアント側レート制限（§7.4）、App Check ロールバック（§7.3）、モデレーション一括操作（§8）、PWA マニフェスト強化（§10）、分析イベント次フェーズ（§11-14）。 |
| 1.5.1 | 2026-05-01 | Firebase 未設定時: Google ボタンが無反応にならないよう `auth.js` でクリック案内。 |
| 1.5.0 | 2026-05-01 | サイト表記をマイナーへ。次期開発: **ログイン機能の再実装**（`auth.js` 等）。 |
| — | 2026-05-01 | イベント登録: 未ログイン時の傍注 `#calendar-ev-register-guest-note` を廃止。TOP Aパターン背景写真の opacity を finale 既定（0.15）に合わせる。 |
| — | 2026-05-01 | アカウント凍結（BAN）: データ項目・ログイン拒否・管理者 UI・Firestore ルール・既存ログ read の注意（§1.5、§9、§10）。 |
| — | 2026-05-01 | 再照合: TOP 簡易プロフィールからフルプロフィールへのリンク（`mll.js`）を追記。 |
| — | 2026-05-01 | 初版（実装照合・ルール変更・UI 改善を反映）。 |
