# MarchinZ — Codex 作業ルール

## 共通の対話ルール

- 優さんから他のAIへの意見照会・質問を依頼されたときは、送付用の依頼文・質問文を1クリックでコピーできるテキスト形式で出力する。コピー先だけで判断できるよう、必要な前提・質問・望む回答形式を含める。

**作業を始める前に、まず同じフォルダの `引き継ぎ書_2026-08-07_夜.md` と `CLAUDE.md` を読むこと。**
Safari の容量問題を触るなら `docs/SAFARI_STORAGE_ISSUE.md` も先に読む。
**POV（奏者視点）動画リストを触るなら `docs/POV_LIST_GUIDE.md` を必ず先に読む**
（手で検索して拾うのは禁止・団体名が他分野と衝突する罠がある）。

## このプロジェクトは何か

マーチング文化のコミュニティSPA（静的サイト + Firebase）。本番 **v2.3.0 (Beta)** 稼働中。
中高生とその保護者が主な利用者。**すべて無料**で、映像ツールは
**動画をアップロードせず端末内だけで処理する**（送る経路そのものを作っていない）。
`marchinz.netlify.app` で公開中。

映像ツールは6つ: Reel（縦型）/ Switcher（自動スイッチング）/ Wipe（ワイプ）/
ReAngle / Privacy / Vlog（開発中）。実体は1アプリで `?tool=reel|switcher|wipe` が入口を分ける。

## 実行・検証コマンド

```bash
# QAランナー（配信 → ブラウザで開く）
tools/qa/serve.sh                 # → http://127.0.0.1:8931/tools/qa/runner.html
tools/qa/serve.sh stop            # 終わったら必ず止める
#   既定       = 標準セット 283件 / 約70秒
#   ?full=1    = 全件 316件 / 約130秒（エンジンを触ったpushの前は必須）
#   ?g=㉗      = 群を名指しで絞る

# push前チェック（積みコミット・Drive巻き戻り・版番整合・QAの段を機械判定）
python3 push_check.py
```

**QAは desktop の窓で回すこと。** モバイル判定のUA/タッチ環境だと、
会員×端末の門の試験が実力どおり落ちて偽FAILになる（1時間溶かした実績あり）。

## 高速検証（品質を落とさない）

- **編集中**: `python3 scripts/fast_verify.py`。差分から必要な0.1〜0.4秒級の確認だけ選ぶ
- **ローカル完成時**: 変更した画面・機能だけを実操作。小修正ごとに標準/full QAは回さない
- **push直前**: `python3 scripts/fast_verify.py --base origin/main --release`。表示された標準/full QAを、まとめた本番候補に対して最後に1回だけ回す
- 自動選択の詳細は `docs/FAST_DEVELOPMENT_WORKFLOW.md`。選択ロジック変更時は `python3 scripts/test_fast_verify.py`も必須
- pushと本番デプロイの都度承認、版番、Drive巻き戻り確認は従来どおり省略しない

## 絶対に守ること

- **`git push` は本番自動デプロイ。実行前に毎回、優さんの明示確認を得る。**
  **1度の許可は1度の実行にしか使えない**（Netlifyクレジット制。過去に上限到達で
  サイトが一時停止した）。コミットは都度作ってよい。止めるのは push だけ
- **push命令を受けたら版番のマイナーを上げてパッチを0にする**（例 2.3.0 → 2.4.0）。
  push しないローカルコミットはパッチを上げる
- **変更したJSは `?v=` を必ずバンプし、`index.html` の `data-mz-version` も上げる**
- **Google Drive同期がコミットを巻き戻す。** push前に `git show HEAD:<file>` で実体を確認する
  （`push_check.py` が自動でやる）
- **秘密情報（APIキー・トークン・個人情報）を出力・記録・コミットしない**
- **未確認のことを推測で実装しない。** 引き継ぎ書の「要確認」を勝手に埋めない
- `firebase deploy`（rules / storage）は自動化しない。優さんの承認後に別途実行する
- Firebase Storage の CORS は**既存エントリを読んでから追記**する。
  上書きすると本番の画像アップロードが全滅する

## 変更前に必ず確認するファイル

| ファイル | なぜ |
|---|---|
| `tools/shared/toolscope.js` | URL→ツールの正本。`h1` の直後に同期読込が必須 |
| `tools/switcher/js/ui.js` | `MODES` / 画面遷移 / 2軸の初期値。最大のファイル |
| `tools/shared/sitechrome.js` | ヘッダー・ドロワー・タブバー・フッターの正本（4ツール共通） |
| `firebase/firestore.rules` | 項目追加時は allowlist 3箇所。忘れると無音で保存拒否される |
| `index.html` | 版番 `data-mz-version` と各 `?v=` |

**`body` の `data-mz-tool="switcher"` を書き換えないこと。**
`limits.js`（登録特典の辞書）と `sitechrome.js` が読んでいて、変えると
登録特典ボックスが黙って消える。スコープは `documentElement` の
`data-mz-tool-scope` という**別属性**で持っている。
`#modeStepKind` も削除せず `hidden` にする（消すとQA4本と素URLの入口が死ぬ）。

## 使うスキル

タスクに合うものがあれば、**着手前に `SKILL.md` を読む**
（一覧: `マイドライブ/Codex_u/CODEX_SKILL_DIRECTORY.md`）。

| 場面 | スキル |
|---|---|
| push・デプロイの前 | `deploy-guard` |
| 実機で「直っていない」と言われた | `repro-first` |
| テスト・QAを書く/直す | `test-teeth` |
| 一括編集・大きな改修 | `verified-edit` |
| 映像ツールの中身（WebCodecs・同期・書き出し） | `browser-video` |
| 完成後の品質総点検 | `trio-review` |

## いま優先度の高い残件

1. **実機確認が全部たまっている**（引き継ぎ書 参照）。
   iPhone実機でしか確かめられないものが7項目
2. **Safari「書類とデータ」膨張** → `docs/SAFARI_STORAGE_ISSUE.md`
3. **「被写体」の初期値は仕様上いまも初回「指定なし」になる**
   （軽い判定は固定/手持ちしか測っていない）
4. iPhone実機での書き出し成功は v1.70.0 の1度きり

## バックアップ

`~/Movies/MarchinZ_FullBackup_2026-08-07/`（v2.3.0時点の完全な控え・復元テスト済み）
