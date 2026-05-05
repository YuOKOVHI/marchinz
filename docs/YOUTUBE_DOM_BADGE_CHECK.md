# YouTube DOM Badge Check

最終確認日時: 2026-04-29

## 検証内容

- `site-nav.js` の現在データから、`renderYoutubeCards` がバッジ文字列に使う値を全42チャンネル分算出。
- 出力項目:
  - `latestVideoId`
  - `latestVideoDate`
  - `latestLiveId`
  - `latestLiveDate`
  - `hasLiveBadge`

## 全体サマリ

- 対象チャンネル数: 42
- `hasLiveBadge=true`: 13
- `hasLiveBadge=false`: 29
- `latestVideoDate` 空: 0

## 問い合わせ対象（じぇねTUBE）

- channel: `じぇねTUBE_マーチング情報`
- latestVideoId: `3rgxCdI8M4E`
- latestVideoDate: `2026/3/8`
- latestLiveId: `Tuh22JQ-0E4`
- latestLiveDate: `2026/3/8`
- hasLiveBadge: `true`

## 抜粋ログ（LIVEバッジあり）

- `マーチング祭®︎ / MIX3｜Sport of Sound.®︎` | video `2026/3/31` | live `2026/4/26`
- `マーチングバンド DER GLANZ` | video `2026/3/9` | live `2026/3/28`
- `【公式】奈良学園大学マーチングバンド部 / NARAGAKU Marching Band` | video `2026/3/24` | live `2023/2/25`
- `吉祥院ザウルス 公式アカウント` | video `2026/4/8` | live `2026/2/23`
- `MARCHINGBAND COURAGE` | video `2026/4/14` | live `2026/2/22`
- `GENESIS(ジェネシス) 一般マーチング` | video `2023/12/18` | live `2021/5/20`
- `じぇねTUBE_マーチング情報` | video `2026/3/8` | live `2026/3/8`
- `SatsukiDreamersOrg` | video `2025/12/31` | live `2024/12/31`
- `IPUマーチングバンド 公式チャンネル` | video `2026/4/19` | live `2026/4/19`
- `OBBCchannel` | video `2025/12/22` | live `2024/10/22`
- `青鷹TV` | video `2026/3/5` | live `2026/3/5`
- `Revolt colorguard` | video `2026/2/2` | live `2026/1/31`
- `Via Colorguard Jr.` | video `2026/4/12` | live `2026/4/5`
