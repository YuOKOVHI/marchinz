# MarchinZ Codex引き継ぎ書

作成: 2026-08-07 / 本番 **v2.3.0 (Beta)** / 対象コミット `ea9ef68`

> このファイルは Codex 用の入口です。**日々の詳しい申し送りは
> `引き継ぎ書_2026-08-07_夜.md`**（および同名の日付違い）にあります。
> 作業ルールは `AGENTS.md`。

## 1. 何のためのものか

**目的**: マーチング文化のコミュニティを作る。大会動画・イベント・掲示板・メディア図鑑に加え、
中高生が自分で映像を作れる無料ツールを提供する。

**想定ユーザー**: 中高生のプレイヤーとその保護者、指導者、団体スタッフ。13歳以上。
**iPhone Safari が最優先**（検証は375px幅が第一）。

**現在の完成度**: 本番稼働中。QA 316件（全件）PASS。ただし
**この版の実機確認が7項目たまっている**（下記3）。

**思想（変えてはいけない軸）**
- 映像ツールは**動画をアップロードしない**。端末内だけで処理する。
  「安全に扱います」と約束するのではなく、**送る経路そのものを作っていない**
- **無料**。子どもから課金しない。収益は練習・楽器データを統計化してスポンサーへ提供する設計
  （第三者提供は統計化か個別同意が必須という線を守る）
- UIは嘘をつかない（進捗・無効ボタンのコントラスト・尺度の言葉づかい）

## 2. 現状

**完了済み**（直近の大きな変更・すべて本番投入済み）
- 映像ツールを6つへ再編（Reel / Switcher / Wipe / ReAngle / Privacy / Vlog(開発中)）
- 登録の同意チェックを5個→3個（統計提供は利用規約 第5条の2へ、βはポリシー第7項に内包）
- 2軸（被写体・固定）の初期値が凍結する欠陥を修正（受け取り経路を新設）
- UI/UXブラッシュアップ（無効ボタン 2.14:1 → 4.50:1 等）
- YouTube/メディアに「マーチング配信」カテゴリを追加
- QAランナーの2段化 + `push_check.py`（push前チェックの機械化）

**未完了・保留**
- **実機確認7項目が未実施**（最優先。下記3）
- **Safari「書類とデータ」膨張が未解決** → `docs/SAFARI_STORAGE_ISSUE.md`
- 「被写体」の初期値は**仕様上いまも初回は必ず「指定なし」**になる。
  軽い判定は固定/手持ちしか測っておらず、被写体を推せる材料は本解析にしかない。
  直すなら quickProbe に被写体判定を足す設計変更が要る（**優さんの判断待ち**）
- OGPがツール別に分かれていない（Reelを貼っても「MarchinZ Switcher」と出る）
- `reangle/index.html` だけ og:* と description が無い
- Vlogゲートが3実装に分裂（一本化候補）

**次にやる作業（優先順）**
1. 実機確認7項目（優さんのiPhoneが要る）
2. Safari容量問題の続き（まず対策が効いているかの実機確認）
3. 被写体の初期値をどうするかの判断 → 実装
4. P2以下（OGP分割・Vlogゲート一本化）

## 3. 実機でしか確かめられない7項目（すべて未実施）

```
① クリエイターページに6ツールが並ぶか（上3つが大きい絵つき）
② Reelをタップ → 「Reel」の名前で、いきなり「おまかせ/こだわり」から始まるか
③ おまかせ →「やめる」→ Reelの入口に戻るか
④ ログアウトして新規登録 → チェックが3つだけか / βモーダルが出ないか
⑤ 2軸（被写体・固定）が「自動判定」のままでないか  ← 同じ指摘を4回受けた箇所
⑥ Switcherを開いて「書類とデータ」が減るか（容量対策の実証）
⑦ 縦型おまかせが最後まで通るか / 「やめる」が数秒で効くか / 音の段でバーが動くか
```

①〜⑤は 2026-08-07 に**ブラウザ(375px)で本番を実測して合格**しています。
残るのは iPhone Safari 固有の挙動（⑥⑦）と、実素材での③⑤です。

## 4. 環境変数・外部サービス

値は書きません。名前と用途のみ。

| 名前 | 用途 |
|---|---|
| Firebase の各種設定（apiKey 等） | Auth / Firestore / Storage。**公開されるクライアント設定**で、保護は Firestore rules 側で行う |
| GitHub PAT | `repo` + `workflow` の両スコープが必須。ワークフローを含む push に要る |
| YouTube Data API キー | 名簿更新bot用。**GitHub Secrets にのみ存在**。ローカルには置かない |

外部サービス: **Netlify**（`git push origin main` = 本番自動デプロイ）/ **Firebase**（Auth・Firestore・Storage）/
**GitHub Actions**（YouTube名簿の定期更新bot）

## 5. 構成

```
index.html            本体SPA（全ページ）+ 版番 data-mz-version
site-nav.js           ページ描画・YouTube名簿の正本（channels 配列）
auth.js               認証・同意・プロフィール
firebase/firestore.rules   項目追加時は allowlist 3箇所
tools/
  shared/             4ツール共通（toolscope.js / sitechrome.js / demux / session）
  switcher/js/        映像エンジン（ui.js / exporter.js / media.js / visual.js / proxy.js …）
  qa/runner.html      QA 316件 + serve.sh（配信スクリプト）
docs/                 設計書・運用手順・SAFARI_STORAGE_ISSUE.md
push_check.py         push前チェック（1コマンド）
引き継ぎ書_*.md        日々の申し送り（最新を読む）
```

## 6. 使用技術と実装ルール

- 素のHTML/CSS/JS（ビルド無し）+ Firebase BaaS。Node は使わない前提
- 映像は WebCodecs / mp4box.js / mp4-muxer / OPFS
- **版番規約**: push命令 → マイナー++・パッチ0 / ローカルコミット → パッチ++
- **変更したJSは `?v=` をバンプ**し、`index.html` の `data-mz-version` も上げる
- UIアイコンはカラー絵文字禁止。Font Awesome のモノクロで統一

## 7. 注意事項（過去に事故った箇所）

- **`git push` = 本番デプロイ。毎回確認・1度の許可=1度の実行**（Netlifyクレジット制）
- **Google Drive同期がコミットを巻き戻す。** push前に `git show HEAD:<file>` で実体検証
- **`body[data-mz-tool]` を書き換えると登録特典が黙って消える**（スコープは別属性 `data-mz-tool-scope`）
- `#modeStepKind` は削除せず `hidden` にする
- **Firebase Storage の CORS は既存を読んでから追記**。上書きすると画像アップロードが全滅
- `mll_profiles` の項目追加は `firestore.rules` の allowlist 3箇所 + デプロイ。
  忘れると**無音で保存拒否**され、設定が毎回巻き戻る
- QAは **desktop の窓**で回す（モバイル判定だと会員×端末の門が実力どおり落ちる）

## 8. 参照

- `AGENTS.md`（作業ルール・スキル対応表）
- `引き継ぎ書_2026-08-07_夜.md`（直近の詳しい申し送り）
- `CLAUDE.md`（版番規約・運用）
- `docs/SAFARI_STORAGE_ISSUE.md`（容量問題の現状と続き）
- `docs/MARCHINZ_SPEC.md` ほか `docs/` 一式
- Git: `origin/main` が唯一の正。`git log --oneline -20` で流れを掴む
- バックアップ: `~/Movies/MarchinZ_FullBackup_2026-08-07/`（復元テスト済み）

## 9. Codexでの再開例

```
MarchinZ の docs/SAFARI_STORAGE_ISSUE.md を読んで、
「4. まだ残っていること」の最優先（掃除が効いているかの実機確認）を
私が iPhone でどう測ればいいか、手順だけ短くまとめて。
```

```
MarchinZ の AGENTS.md と 引き継ぎ書_2026-08-07_夜.md を読んで、
実機確認7項目のうち、ブラウザ(375px)で代替検証できるものを実際に検証して。
iPhone でしか無理なものは「未確認」と分けて報告して。
```

```
MarchinZ で「被写体」の初期値が初回に必ず「指定なし」になる件を調べて、
quickProbe に被写体判定を足す場合の設計案を出して。実装はまだしないで。
```

## 10. マーチング祭エントリー監視（2026-08-18）

- 対象は `https://www.marching-matsuri.com/2026mmcs` の「湘南藤沢OPEN」「東海OPEN」「横浜FINAL」の3スライド。
- `check_matsuri_entries.py` がWix公式データから一覧を取得し、前回との追加・削除・見出し変更を大会・部門ごとに具体的に報告する。解析不能な場合は「更新なし」とせず失敗扱い。
- 報告は必ず `【更新】` と `【現在のリスト】` を含み、3大会の全団体を載せる。
- `.github/workflows/matsuri-entry-check.yml` は毎日05:10 JSTに実行し、`send_matsuri_report_email.py` でSMTPメールを送る。
- GitHub Secretsは `MATSURI_SMTP_USER`、`MATSURI_SMTP_APP_PASSWORD`、`MATSURI_REPORT_EMAIL_TO`。パスワードはリポジトリや引き継ぎ書に記載しない。
- 2026-08-18時点で実測と自動確認9件はPASS。
