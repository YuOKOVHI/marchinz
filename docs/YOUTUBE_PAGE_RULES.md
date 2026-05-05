# YouTube ページ運用ルール

## 1. 表示ルール

### 1-1. データの正本

- YouTubeカード表示の正本は `site-nav.js` の以下3つ。
  - `videoMetaByUrl`（動画IDの割当）
  - `videoDateById`（日付）
  - `videoTitleById`（タイトル）
- `videoTitleById` にないタイトルは外部取得せず、`YouTubeで見る` を表示する。

### 1-2. カード上の表示

- チャンネルカードの上段は `チャンネル名` → `URL` → `バッジ` の順。
- バッジ表示ルール:
  - `カテゴリ` バッジは常時表示
  - `最新動画` バッジは常時表示
  - `最新LIVE` バッジは `latestLive` が有効なときのみ表示
- `latestLive` が空の場合、`最新LIVE` バッジは表示しない。

### 1-3. サムネイル4枠

- 4枠は重複ID禁止（同一チャンネル内で同じ `videoId` を使わない）。
- 優先順は `latestVideo` / `latestLive` / 人気系 / `thumbnails` / `gridExtra4`。
- それでも4本に満たない場合は不足本数のまま表示（無理に同一IDで埋めない）。
- Shorts は表示対象外（全カテゴリ共通）。

### 1-4. 新着ソート

- 新着ソートは `latestVideo` と `latestLive` の日付比較で新しい方を採用。
- 両方ない場合のみ `latestDateByUrl` をフォールバックとして使う。

### 1-5. 掲載チャンネル一覧（ダイアログ）

- 一覧は **チャンネル名のみ** 表示する。
- 日付（動画日付/LIVE日付）は一覧に表示しない。

## 2. 新規チャンネル登録時の取得ルール

追加時は、必ず以下を1セットで実施する。

1. **チャンネル基本情報**
   - `channels` に `name / url / category / logo / thumbnails` を追加。
   - `logo` は `og:image` を使用（`favicon.ico` は不可）。

2. **最新動画の取得**
   - `url/videos` から最新動画IDを取得し `latestVideo` に設定。
   - 同IDを `popularVideo` の初期値にも設定。

3. **最新LIVEの取得**
   - `url/streams` から候補IDを取得。
   - ただし `latestVideo` と同一IDは除外。
   - 候補は動画ページでLIVE判定を通ったIDのみ採用し、`latestLive` / `popularLive` に設定。
   - LIVE判定に通らない場合は `latestLive` / `popularLive` を空にする。

4. **人気枠と4枠目**
   - `popular2` / `popular3` / `gridExtra4` は `thumbnails` のIDを優先して設定。
   - 4本ユニークにならない場合はRSS/動画一覧から候補を補完する。

5. **日付データ**
   - `latestVideo` / `latestLive` / `thumbnails` / `gridExtra4` で使う全IDを `videoDateById` に登録。
   - `latestDateByUrl[url]` も更新する（最終フォールバック用）。

6. **タイトルデータ**
   - 表示予定IDのタイトルを `videoTitleById` に登録。
   - 不明時は `YouTubeで見る` 表示になる前提で運用する。

## 3. 登録後の必須監査

- `channels` 件数と `videoMetaByUrl` 件数が一致している。
- `videoMetaByUrl[url]` が空オブジェクトになっていない（`latestVideo` 必須）。
- `latestLive` が入っているIDはLIVE判定に合格している。
- `latestLive` / `latestVideo` の日付が `videoDateById` に存在する。
- `latestLive` があるチャンネルは、カードの4サムネ生成結果に `latestLive` が含まれている。
- Shorts除外後でもカード表示が崩れていない（上段3行 + サムネイル）。
- 一覧ダイアログがチャンネル名のみになっている。
- DOMバッジ監査ログを毎回出力する（`最新動画`/`最新LIVE` の表示用文字列がどう組み立つかを全件記録）。
- 最低でも次をログに残す: `channel`, `latestVideoId`, `latestVideoDate`, `latestLiveId`, `latestLiveDate`, `hasLiveBadge`。
- 監査ログは `docs/YOUTUBE_DOM_BADGE_CHECK.md` に追記し、問い合わせ対象チャンネル（例: じぇねTUBE）は個別行で確認する。
