# MarchinZ 高速開発フロー

品質を落とさず、同じ確認を繰り返さないための手順です。

## 結論

検証は3段階に分けます。

1. **編集中** — 変更ファイルに関係する0.1〜0.4秒の確認だけ
2. **ローカル完成時** — 変更した画面・機能だけを実操作
3. **push直前** — `origin/main` からの全差分を対象に、標準またはfull QAを1回だけ

## コマンド

```bash
# 編集中。未コミット差分から必要な確認だけ自動選択
python3 scripts/fast_verify.py

# 積みコミットを含む本番候補を確認。QAの段も表示
python3 scripts/fast_verify.py --base origin/main --release

# 何が選ばれるかだけ確認
python3 scripts/fast_verify.py --files app.js marchinz-brushup.css --dry-run

# 選択ロジック自身の歯を確認
python3 scripts/test_fast_verify.py
```

## 自動選択

| 変更 | 自動実行 | push前ブラウザQA |
|---|---|---|
| 文書・運用スクリプト | diff / Python構文 | 不要 |
| 大会動画・YouTubeデータ | `check_data.py` | 製品変更を伴う場合のみ標準 |
| POV判定・POVデータ | 上記 + POV回帰100件 | 製品変更を伴う場合のみ標準 |
| 一般UI | diff / JS構文（Node利用可能時） | 標準を最後に1回 |
| 映像エンジン | diff / JS構文 | `?full=1`を最後に1回 |

## 今日の実測（2026-08-15）

- `check_data.py`: 0.05秒
- `push_check.py`: 0.08秒
- `test_scout_pov_videos.py`: 0.20秒（100件）
- `verify_youtube_list_csv_inline.py`: 0.03秒
- ブラウザQA標準: 約70秒
- ブラウザQA full: 約130秒

遅延の中心は自動チェックではなく、全体QAの重複と確認範囲を毎回考える時間です。

## 運用ルール

- 小修正ごとに標準/full QAを回しません。関連画面だけ確認します。
- 複数の小修正は1つのリリース候補へまとめ、全体QAは最後に1回だけです。
- データ更新は正本CSV→派生生成→`fast_verify`の順にします。
- 他AIや自動更新と同時に触る場合、着手前とコミット前に `git status -sb` とHEADを確認します。
- push・本番デプロイは、従来どおり優さんの都度承認後だけ実行します。
