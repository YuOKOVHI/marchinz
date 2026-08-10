# POVリスト作業 指示書（AI共同作業用）

**この文書の場所: `010_MarchinZ/docs/POV_LIST_GUIDE.md`**

POV（奏者視点）動画リストを触る作業は、**必ずこの文書を最初から最後まで読んでから**
始めてください。Claude Code / Codex / Cursor / その他、どのAIでも同じです。
手順を飛ばすと、過去に実際に起きた事故（無関係な動画の混入・取りこぼし・
Netlifyクレジットの浪費）を繰り返します。

> 読んだ合図として、作業の最初の返答に
> 「POV_LIST_GUIDE.md を読みました（YYYY-MM-DD 時点、収録◯件）」と書いてください。

---

## 0. 30秒で分かる要点

| | |
|---|---|
| 正本 | `大会動画リスト_POV.csv`（**ここだけが真実**） |
| 派生 | `data.json` / `data.inline.js`（**手で触らない**。`sync_csv_to_json.py` が作る） |
| 探索 | `scout_pov_videos.py`（**手で検索して拾ってはいけない**） |
| 判断の蓄積 | `pov_ledger.json`（採用/却下の記録。同じ動画を二度検討しないため） |
| 試験 | `test_scout_pov_videos.py`（判定を変えたら必ず通す） |
| **push** | **毎回、優さんの明示の許可が要る。1度の許可＝1度の実行** |

---

## 1. 採用の基準

**3つすべてを満たすものだけ**を採ります。

1. **YouTubeで公開されている**（限定公開・削除済みは不可）
2. **5分以上**（`MIN_SEC = 300`）
3. **奏者本人の頭部・胸部・楽器付近からの視点**

### 採らないもの（実例つき）

| 種類 | 例 | なぜ |
|---|---|---|
| 固定カメラ | Catwalk Cam / Overhead Cam / High Cam / Press Box | 奏者の視点ではない |
| 編集済み | Multi Cam / Wide-angle / Split Cam / Drone | 同上 |
| 反応・解説 | 「We react to our OWN headcams!」 | 演奏そのものではない |
| 切り抜き | 「Full Show **Highlights**」（1〜2分） | 5分未満 |

### ★ いちばん危ない罠：団体名が他分野と衝突する

団体名で検索すると、**同じ語を持つ無関係な動画**が混ざります。
2026-08-10 に実際に18件混入し、後から取り除きました。

```
Pacific Crest → Pacific Crest Trail（ロングトレイル徒歩）  4件混入
Troopers      → eスポーツ / アイスホッケー / マウンテンバイク  5件
Mandarins     → ゲーム "Bleeding Mandarins" / 個人vlog      3件
Cadets        → 陸軍幼年学校・英軍士官学校の訓練            2件
Cavaliers     → NBA クリーブランド・キャバリアーズ           2件
Jersey Surf   → サーフィン                                1件
Blue Knights  → アイスホッケーのゴーリー                    1件
Genesis       → ヒュンダイの車種（GV80 POV drive など）
```

**"POV" や "GoPro" は車載・ゲーム・アウトドアでも日常的に使われます。**
団体名 × POV語だけでは通ってしまうので、**楽器・パート語**
（snare / marimba / trumpet / mellophone / guard など）があることを必ず確かめてください。
`scout_pov_videos.py` の `MARCHING_CONTEXT` がこの門です。

---

## 2. 毎日の流れ（新着を拾う）

新着は **GitHub Actions が毎日 06:00 JST に自動で見張ります**
（`.github/workflows/pov-update-check.yml`）。
候補が出た日だけ Issue が立ちます。**サイトのファイルは何も変わりません**
（＝ Netlify のビルドは走らず、クレジットも減りません）。

Issue が来たら:

```bash
# 1) 候補を見る（Issueの表、または pov_candidates.tsv）
# 2) 1本ずつ実際に動画を見て、採用基準の3つを確かめる
# 3) 台帳へ入れる（採らないものも必ず入れる）
python3 scout_pov_videos.py --reject ID1 ID2 ...   # 奏者視点でない・短い等
python3 scout_pov_videos.py --accept ID3 ID4 ...   # 採る

# 4) 採用ぶんをCSVへ（大会名は自動生成の"下書き"）
python3 scout_pov_videos.py --apply

# 5) 大会名を手で整える（下の §4 の形に）

# 6) 派生ファイルを作り直して検算
python3 sync_csv_to_json.py && python3 check_data.py
```

> **却下も必ず台帳へ入れてください。** 入れないと翌日も同じ候補がIssueに出ます。

自分で回したいときは:

```bash
python3 scout_pov_videos.py --quick   # 収録済み+見張りチャンネルの新着だけ（速い）
python3 scout_pov_videos.py           # 横断検索も含む全軸（重い・1時間級）
```

---

## 3. 年を指定して過去を埋める（他AIへの依頼はここ）

### まず今どこまで埋まっているかを見る

```bash
python3 scout_pov_videos.py --coverage
```

年ごとの件数が棒グラフで出て、**掘る価値のある年を名指し**します。
ネットに触らないので一瞬で終わります。

**2026-08-11 時点: 936件 / 2003〜2026 の24年分。**
薄い年は **2012・2013・2014・2015**。
2020年が2件なのは**コロナでDCIのシーズンが中止**だったためで、正しい空白です。
2012年より前はヘッドカム自体がほとんど存在しないので、少ないのが自然です。

### 年を決めて掘る

```bash
python3 scout_pov_videos.py --year-from 2012 --year-to 2015
```

- 「団体 × 年 × カメラ語」で検索します
- 過去の年は新着順では拾えないので、**関連度順**に切り替わります
- `--since` は自動でその年の1月1日まで下がります（指定すれば上書きできます）

### 他のAIへ出す依頼文のひな形

> `010_MarchinZ/docs/POV_LIST_GUIDE.md` を読んでから作業してください。
> `python3 scout_pov_videos.py --year-from 2013 --year-to 2014` を回し、
> 出てきた候補を1本ずつ確認して、採用基準（5分以上・奏者本人の視点）を
> 満たすものだけ `--accept`、それ以外は `--reject` で台帳へ入れてください。
> 団体名が他分野と衝突する罠（§1）に必ず注意してください。
> `--apply` のあと大会名を §4 の形に整え、
> `sync_csv_to_json.py` と `check_data.py` を通してください。
> **push はしないでください。**

---

## 4. 大会名の形（厳守）

```
【POV/YYYY】団体名「ショウ名」【役割】
```

- プレフィックスは **半角スラッシュ**。`【POV｜2026】`（全角縦棒）は**禁止**
- ショウ名が分からなければ **「」ごと省く**。捏造しない
  例: `【POV/2026】Bluecoats【Trumpet】`
- 役割は楽器・パート。`【POV】` のままにしない（分からなければ一覧にして報告）
- 年が分からなければ、題名の年 → 配信日の年 の順で埋める。どうしても無理なら `【POV】`

良い例:

```
【POV/2026】Bluecoats「Gravity & Grace」【Lead Mellophone／Victory Run】
【POV/2025】Boston Crusaders「BOOM」【Quad／Victory Run】
【POV/2026】Phantom Regiment【Drum Set】
```

---

## 5. ファイルの場所

作業ディレクトリは `マイドライブ/CursorLogs/010_MarchinZ`。

### 触ってよい

| ファイル | 役割 |
|---|---|
| `大会動画リスト_POV.csv` | **正本**。POVの行はここだけを編集する |
| `pov_ledger.json` | 採用/却下の台帳。`--accept` / `--reject` が書く |
| `pov_channel_watchlist.txt` | 見張る個人チャンネル。1行1URL |
| `scout_pov_videos.py` | 探索と判定。変えたら試験を通す |
| `test_scout_pov_videos.py` | 判定の見張り |
| `check_pov_updates.py` | 日次チェックの本体 |
| `docs/POV_LIST_GUIDE.md` | この文書 |

### 触らない

| ファイル | 理由 |
|---|---|
| `data.json` / `data.inline.js` | `sync_csv_to_json.py` が作る派生物。手編集は必ず巻き戻る |
| 他の3つの `大会動画リスト_*.csv` | マーチング祭 / DrumcorpsfunTV / FloMarching は別の取り込みスクリプトが正本 |
| `大会動画リスト_POV_claude.csv` ほか `*_claude.*` | 調査時の記録（参照用）。本番データではない |
| `body[data-mz-tool]` | 書き換えると登録特典が黙って消える |

---

## 6. 変更を反映する手順（順序を変えない）

```bash
# 1) 正本CSVを直す
# 2) 派生ファイルを作り直す
python3 sync_csv_to_json.py
# 3) 件数・列・CSVとJSONの一致を検算
python3 check_data.py
# 4) 版番を上げる（パッチだけ）
#    index.html の data-mz-version と、変更したJSの ?v= を必ず揃える
#    ★ app.js の中にも data.inline.js?v= がある。片方だけ直すと旧データを掴む
# 5) コミット（ここまではAIが自走してよい）
# 6) push は止まって確認を取る
```

---

## 7. やってはいけないこと

### push / 本番デプロイ

- **`git push` は毎回、優さんの明示の許可を取る。1度の許可＝1度の実行**
- 同じ会話の続きでも、次の push はあらためて確認する
- 理由: Netlify はビルドクレジット制。2026-07-12 に上限到達でサイトが一時停止した
- **コミットは都度作ってよい。止めるのは push だけ**

### Google Drive の巻き戻し

このリポジトリは Google Drive 同期下にあります。
**コミット直前にDriveがファイルを旧版へ戻す事故が複数回あります。**

```bash
# push前に必ず、コミットに入った実体を見る
git show HEAD:大会動画リスト_POV.csv | tail -n +2 | wc -l
python3 push_check.py   # 積みコミット・巻き戻り・版番整合をまとめて判定
```

作業ツリーの grep だけで安心しないこと。権威は git blob です。

### 試験を骨抜きにする

`test_scout_pov_videos.py` が落ちたとき、**試験の方を書き換えないでください。**
通るだけの試験になります。

実際にやらかした例: 「落とすべき」の試験文に楽器語が無かったため、
除外規則を踏む前に「手掛かりなし」で落ちており、
`multicam` の除外を消しても PASS してしまっていました。
**落とすべき試験文には必ず楽器語を入れてください**（そうしないと規則を一度も踏まない）。

判定を変えたら、変異試験で歯を確かめること:

```bash
python3 test_scout_pov_videos.py     # まず通ることを確認
# わざと規則を1つ消して、FAIL になることを確認してから戻す
```

---

## 8. 困ったときの読み物

| 知りたいこと | 読む場所 |
|---|---|
| なぜ取りこぼしたのか・再発予防の全体像 | `docs/POV_MISS_2026-08-10.md` |
| CSV全般の運用ルール | `docs/OPS_GUIDE.md` §6 |
| プロジェクト全体のルール | `CLAUDE.md` / `AGENTS.md` |
| 版番の付け方 | `CLAUDE.md`「バージョニング」 |

---

## 更新履歴

- 2026-08-11 新規作成。日次チェック（Actions）・`--coverage`・`--year-from/--year-to` を追加した回
