# Safari容量問題 — 4つのAI提案の評価と採用方針

作成: 2026-08-09  
対象: MarchinZ 映像ツール / iPhone・iPadOS Safari  
判断時の本番版: **v2.13.0**  
状態: **方針承認済み・第1段階をローカル実装済み（未デプロイ・実機未検証）**

## 1. この文書の目的

Safari「書類とデータ」が動画選択のたびに数GB増える問題について、次の4案を同じ基準で評価し、優さんが承認した複合方針を記録する。

1. Cursor（Auto / Composer系）
2. OpenAI GPT-5系 Codex上級モデル
3. Claude Code / Claude Opus 5
4. Gemini 1.5 Pro

今後この問題を再開する際は、反証済みの案へ戻らず、本書の「9. 採用した複合案」から続ける。

## 2. 評価の前提となる実機事実

### picker内部コピー

- FHD QuickTime素材3本の合計: 3,551,510,873 bytes
- 取り込み前: Safari 5.81GB / OPFS 0B
- 取り込み・分析後: Safari 9.36GB / OPFS 0B
- 増分約3.55GBが素材合計と一致
- Safari完全終了後も9.36GB
- 写真アプリから約1.19GBを1本選択: 約1.19GB増加
- ファイルアプリから同じ約1.19GBを1本選択: 約1.19GB増加
- File参照、video、Object URL、Worker、AudioContext等をMarchinZ側で解放しても回収されない

### mz-source先行コピー試験

- 基準: Safari 0.65GB / OPFS 0B
- 3本処理後: Safari 7.85GB / OPFS 3.59GB
- MarchinZ退出後: Safari 4.26GB / OPFS 0B
- 解放された約3.59GBはmz-source側
- 残った増分約3.61GBはSafari内部コピー側

したがって、mz-sourceはSafari内部コピーを置換せず、ほぼ同量のOPFSコピーを追加した。素材のOPFS先行コピーは根本対策ではない。

### 新たな重要情報

これまで主に使用していた素材は、S5IIXで約15分撮影し、iPhoneの写真アプリで約8分へトリミングした動画だった。一方、iPhoneで直接撮影した動画ではSafari容量が増えていない可能性がある。これは未確認だが、製品方針を変え得る最重要の未検証変数である。

## 3. 5段階評価

5＝非常に良い、1＝採用すべきでない。

| 評価項目 | Cursor | Codex上級 | Claude Code | Gemini |
|---|---:|---:|---:|---:|
| 実機結果との整合性 | 5 | 5 | 4 | 3 |
| 根本原因の分析精度 | 4 | 5 | 5 | 4 |
| 確認済み／未確認の区別 | 4 | 5 | 3 | 2 |
| 次の実機試験の価値・安全性 | 3 | 4 | 2 | 1 |
| 長期アーキテクチャの実現性 | 4 | 5 | 4 | 3 |
| 提示コードの安全性・現行コード適合性 | 4 | 4 | 3 | 2 |
| **合計** | **24/30** | **28/30** | **21/30** | **15/30** |

## 4. Cursor案

### 提案の要旨

- 主因はOrigin/OPFSではなく、`<input type="file">` のpicker準備段階でWebKitが作るフルサイズmaterialization
- PhotosだけでなくFiles経路も同じ一時ファイル管理へ収束する
- Web APIから不可視コピーを削除できない
- mz-sourceを撤回し、旧残骸の掃除だけ残す
- mz-export、mz-export-result、Web Locks、深い掃除、診断は維持
- PWA隔離、picker途中cancel、薄いWKWebViewラッパーを候補にする
- 長期的にはPHPicker/Document PickerとRange供給をネイティブへ出し、既存Webエンジンを再利用する

### 良い点

- mz-source撤回と既存残骸掃除を両立している
- 完成品用mz-exportと素材用mz-sourceを混同していない
- 現行MarchinZへの差分が小さい
- WebKit Bug 318572と実機結果を整合させている

### 弱い点

- PWAはコピーを止めず、別コンテナへ移すだけの可能性が高い
- PWA試験は根治判断として優先度が低い
- 新たに判明した素材由来の差を扱っていない

### 判断

撤回パッチとWeb版の被害最小化方針を採用する。PWAは根治策には採用しない。

## 5. Codex上級モデル案

### 提案の要旨

- Filesは`UIDocumentPickerModeImport`、Photosは`NSItemProvider.loadFileRepresentation`を通り、WKFileUploadPanelの一時ディレクトリへ収束する
- cleanup/lifetime管理が最有力だが、削除失敗の正確な1点は未確認とする
- Webで実証済みの回避経路はない。DataTransfer dropだけを最後の未確認候補とする
- mz-sourceをpass-throughへ戻し、旧残骸の監査・掃除だけ残す
- 長期案は二段階:
  1. WKWebViewのカスタムopen panel + `UIDocumentPicker(asCopy:false)`で既存File経路を試す
  2. 直接URLが不安定な素材だけ、最大数MiB単位のNative Range Sourceへ落とす
- iCloud/編集済み素材はコピーゼロを保証せず、自管理一時ファイルとして明示削除する

### 良い点

- 4案中もっとも「確定」「強い推定」「未確認」の区別が厳密
- 直接URLの小さなprototypeを先に行い、いきなりRange bridge全体を作らない
- 編集済み素材・iCloud素材ではAVURLAssetを保証できないと明記している
- security scope、origin固定、cancel、終了、クラッシュ後掃除まで考慮している
- 既存Web UI、同期、Canvas、WebCodecs、mz-exportを再利用できる

### 弱い点

- iPhoneでDataTransfer dropは実用性が低い
- 新たに判明したiPhone撮影素材とS5IIX編集素材の差を扱っていない
- Range bridgeの実装量は小さくないため、source比較の前に着手すべきではない

### 判断

4案中の最良案。長期設計の土台として採用する。ただし次の実機試験はdropではなく素材由来の比較へ置き換える。

## 6. Claude Code案

### 提案の要旨

- WebKitソースを追い、Photos/Filesの両方が`WKFileUploadPanel-*`一時ディレクトリへ到達すると分析
- 一時URLはWKContentViewのdealloc時削除へ登録される
- Safari強制終了ではdeallocが走らないため、タブだけ優しく閉じる試験を最優先にする
- PWAでSafari本体から別コンテナへ隔離する案
- 根治案としてWKWebViewラッパー、native picker、Range供給を提案
- Files経路の実測をWebKit Bugへ追加する価値があるとする

### 良い点

- WebKitソース追跡は詳細で、FilesとPhotosの共通経路の分析は有力
- Files経路の新しい実測証拠をBugzillaへ追加する視点は良い
- 薄いネイティブブリッジという長期方向は妥当

### 弱い点

- 「タブを閉じれば回収できるかもしれない」を最優先にしている
- WebKit Bug 318572は、タブを閉じても、Safariを終了しても、通常・強制再起動後も回収されないと明記している
- 優さんも全タブを閉じて残留を確認済みで、再試験は堂々巡りになる
- 「削除機構はdeallocだけ」「強制終了が永久化させる」と断定しすぎている
- PWAは根治ではなく、別コンテナへの移動にとどまる可能性が高い

### 判断

根本原因のソース分析とnative bridgeの方向は採用する。タブ閉じ試験を次の一手には採用しない。

## 7. Gemini案

### 提案の要旨

- UIProcessのpicker materializationと一時ファイル孤児化を原因とする
- Webだけの回避は不可能と判断
- PHPicker/PHAsset/AVURLAsset + WKURLSchemeHandlerで既存WebエンジンへRange供給する
- mz-source撤回、mz-export維持
- ストレージを限界まで埋める、または意図的にクラッシュさせてOSパージを確認する試験を提案

### 良い点

- 根本原因と薄いネイティブラッパーの大方向は他案と一致
- mz-source撤回、mz-export維持の判断は正しい
- App Store配布等の製品上の負担を認識している

### 弱い点

- AVURLAssetで常に元動画をゼロコピーできるように書いているが、編集済み・iCloud素材では保証できない
- Swift例が要求Rangeを上限なしで読み、GB級全読みになる危険がある
- origin制限、security scopeの寿命、cancel、クラッシュ後掃除が不足
- 「同一原因100%」など未確認事項の断定が強い
- ストレージ逼迫や意図的クラッシュ試験は端末への危険があり、解決にも直結しない

### 判断

ネイティブブリッジという共通結論以外は採用しない。ストレージ逼迫・意図的クラッシュ試験は実施しない。

## 8. 4案で一致した採用事項

1. mz-sourceの素材全量OPFSコピーを撤回する
2. 完成品・分割書き出し用mz-exportを維持する
3. 主症状はOrigin/OPFS quotaではなくpicker materialization側
4. File参照破棄、Object URL解除、Safari終了等では確実に削除できない
5. WebだけでOS元ファイルを直接読む正式APIは現在確認できない
6. 根治が必要なら、既存Webエンジンを使う薄いiOSラッパーが最有力

## 9. 採用した複合案

### 第1段階: mz-sourceを撤回する

- pickerのFileを従来どおり直接エンジンへ渡す
- mz-sourceへの新規書込みを止める
- 過去のmz-source残骸の削除機構だけ残す
- mz-export、mz-export-result、Web Locks、深い掃除、purgeAllのbusy拒否、診断を変更しない

#### 実装記録（2026-08-09）

- `tools/switcher/js/media.js` から `MC.sourceStore.stage()` 呼び出しを外し、picker由来のFileを既存エンジンへ直接渡すよう変更した
- `tools/switcher/js/source-store.js` の `stage()` は安全側の直接File返却へ変更し、今後の呼び出しでもOPFS複製を再開しない
- 同モジュールの旧 `mz-source` 掃除APIは残した
- 書き出し用 `mz-export`、`mz-export-result`、診断、ロック、深い掃除は未変更
- Switcherのキャッシュ更新値は `2.12.2`
- 本番デプロイ前・iPhone実機検証前である

### 第2段階: 素材の作られ方を小容量で比較する

大容量素材を使わず、各30秒程度を用意する。

- A: iPhoneで撮影した未編集動画
- B: S5IIX素材をiPhoneの写真アプリで30秒にトリミングし、「新しいクリップ」として保存した動画

管理者診断の「選択だけ」で各1本を測る。解析、再生、OPFS、書き出しを行わない。

| 結果 | 判断 |
|---|---|
| AもBもファイルサイズ相当増える | 汎用WebKit pickerバグ。Webだけの根治調査を終了 |
| Aは増えずBだけ増える | 外部カメラ＋iPhone編集後のrepresentation生成が主因候補 |
| 両方増えない | ファイルサイズ、長さ、codec等の閾値を次に調査 |
| Bだけ準備時間が長く増加も大きい | picker内の互換形式生成/materializationが有力 |

Bだけ増えた場合のみ、次に「未編集S5IIX素材」または「一度フラットに書き出したS5IIX素材」を比較する。

### 第3段階: 結果別に製品方針を決める

#### A/Bの両方が増える場合

- Safari Web版はmz-sourceを作らず、再選択回数を減らす被害最小化へ限定
- Safari内部コピーをMarchinZ所有データと明確に区別する
- 薄いWKWebViewラッパーのproof of conceptへ進む

#### S5IIX編集素材だけ増える場合

- 全面ネイティブ化を急がない
- 問題になる素材条件を追加で1回だけ分離する
- 安全な事前変換/新規クリップ保存手順を実機確定する
- その手順で増加が止まる場合だけ、素材選択前の短い案内として製品化する

### 第4段階: 必要なら薄いiOS版を試作する

最初からRange bridge全体を作らない。

1. WKWebViewのcustom open panel + `UIDocumentPicker(asCopy:false)`の小さなprototype
2. 容量増加と既存File経路の動作を実機確認
3. 直接URLが使えない素材だけNative Range Sourceへfallback
4. Safari版とiOS版でUI・同期・WebCodecs・mz-exportを共用

## 10. 採用しない案

- OPFSへ素材を先行コピーする
- 小さいチャンクでOPFSへ移せばSafari内部コピーが消えると考える
- タブを閉じれば根治すると期待する
- Safari終了、iPhone再起動を同じ条件で繰り返す
- ストレージを故意に満杯にする
- 意図的にクラッシュさせる
- PWAを根治策と呼ぶ
- 全面ネイティブで作り直す
- サーバーへ動画をアップロードする

## 11. 実装開始時の確認事項

実装は優さんの明示指示後に開始する。

- 現行v2.13.0では`tools/switcher/js/media.js`から`sourceStore.stage()`が呼ばれ、mz-sourceは有効
- dirty worktreeの未追跡`.claude/`と引き継ぎ書は変更・削除しない
- source-store.jsは削除せず、pass-throughと旧残骸掃除の互換moduleとして残す
- 触ったJSの`?v=`と版番を規約どおり更新する
- push/deployは毎回、直前に優さんの明示許可を得る

## 12. 一次情報・関連資料

- WebKit Bug 318572: https://bugs.webkit.org/show_bug.cgi?id=318572
- WKFileUploadPanel.mm: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm
- WKContentView.mm: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentView.mm
- `docs/SAFARI_STORAGE_ISSUE.md`
- `docs/SAFARI_STORAGE_CODEX_PASTE.md`
- `/Users/yuokocchi/Library/CloudStorage/GoogleDrive-mm.yu.okochi@gmail.com/マイドライブ/Codex_u/MarchinZ_Safari_FilePicker_Storage_Analysis_2026-08-09.md`
