# Claude Code 引き継ぎ — コピーするだけ

> **この1ページだけ見れば足ります。** 詳細は `CLAUDE.md`（自動読込）と `claude_handover.md`（Brain Dump）。
>
> **個人プロファイル全体**（`claude-okochi` / シェル設定 / グローバル `~/.claude-okochi/CLAUDE.md`）: `../docs/CLAUDE_CODE_PERSONAL_OKOCHI.md`  
> **Gemini 共有**: 個人 **`../docs/GEMINI_CLAUDE_CODE_OKOCHI.txt`**（前回文取り消し+Claude Code分離）/ 会社 `../docs/GEMINI_COMPANY_SHARE.txt`

---

## 手順（2つだけ）

### ① フォルダを開く

Claude Code で次を**プロジェクトルート**にする（`index.html` がある場所）:

```
010_MarchinZ
```

（フルパス例: `…/CursorLogs/010_MarchinZ`）

→ `CLAUDE.md` が毎セッション自動で読み込まれます。**追加設定は不要**です。

### ② 下の枠内をすべてコピーして、初回チャットに貼り付け

**開始行から終了行まで、1文字残さずコピーしてください。**

--- ここからコピー ---

MarchinZ（010_MarchinZ）の開発を引き継いでください。

## 読むファイル（この順）

1. `CLAUDE.md`（プロジェクトルート・自動読込済みのはずだが内容を確認）
2. `claude_handover.md`（詳細 Brain Dump）

## 運用前提（約1ヶ月）

- あなた（Claude Code）は**約1ヶ月**のメイン AI。のちに **Cursor へ戻る**可能性が高い。
- `.cursor/` や Cursor 用ルールは、ディレクター指示がない限り**削除・改変しない**。
- 仕様変更・複雑な実装は **`docs/MARCHINZ_SPEC.md` 改訂履歴** または `claude_handover.md` に必ず追記（ブラックボックス禁止）。
- コミットする場合はメッセージを**汎用的・詳細**に（Cursor 側 AI も読めるように）。

## 絶対禁止（ディレクター明示まで）

- `netlify deploy` / `firebase deploy` / `git push` / GitHub Actions 手動起動

## 開発の正

- 版番: `index.html` の `data-mz-version`（現在 **1.26.65**）。修正のたび **PATCH +1**。
- 本番: ローカルから手動 `netlify deploy --prod` のみ。**GitHub main ≠ 本番**（乖離し得る）。
- 検証: `python3 -m http.server 8000` → `http://localhost:8000/`（**file:// 禁止**）

## 最初の返答

両ファイルを読んだうえで、**把握した要点を10行以内**で要約し、次の指示を待ってください。

--- ここまでコピー ---

---

## 以降のセッション（2回目以降）

新しいチャットを開いたときは、短くてよい:

```
CLAUDE.md と claude_handover.md を前提に MarchinZ の作業を続けてください。版番は index.html の data-mz-version を確認。deploy / git push は指示があるまで禁止。
```

---

## ファイル一覧（何が何か）

| ファイル | 誰が読むか |
|----------|------------|
| `CLAUDE_CODE_ONBOARDING.md` | **人間**（このページ・コピペ元） |
| `CLAUDE_CODE_START.txt` | **人間**（②と同じ文面・プレーン text） |
| `CLAUDE.md` | **Claude Code**（自動） |
| `claude_handover.md` | **Claude Code / Cursor**（詳細） |

---

## Cursor に戻るとき（1ヶ月後）

1. Cursor で同じ `010_MarchinZ` を開く
2. `claude_handover.md` の「改訂メモ」と `docs/MARCHINZ_SPEC.md` 改訂履歴で Claude Code 期間の差分を確認
3. ワークスペースの `.cursor/rules/` はそのまま利用可能（Claude Code 期間中に触っていなければ）
