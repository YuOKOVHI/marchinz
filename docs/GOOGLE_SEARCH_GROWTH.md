# MarchinZ Google検索の改善運用

更新日: 2026-08-12
対象版: v2.32.0

## 目的

- ブランド検索: `MarchinZ` / `マーチンズ` で公式サイトが正しく認識される
- 一般検索: `マーチング` と、利用目的を含む検索語から有用な入口へ到達できる
- 検索流入を、順位だけでなく表示回数・クリック・サイト内行動まで継続測定する

検索順位や「100倍」は保証できない。公開後のクロール・インデックスには数日から数週間かかる場合がある。

## 今回実装した検索入口

| URL | 主な検索意図 |
|---|---|
| `/` | MarchinZ / マーチンズ |
| `/about/` | MarchinZとは / マーチンズとは |
| `/marching/` | マーチングを楽しむ・探す |
| `/marching/videos/` | マーチング動画 / 大会動画 / POV |
| `/marching/events/` | マーチング大会 / 演奏会 / イベント |

各ページは、固有のtitle・description・canonical・本文・構造化データを持つ。トップのフッターから通常リンクで辿れ、`sitemap.xml`にも掲載する。

## 本番公開直後に行うこと

1. Google Search Consoleで `https://marchinz.netlify.app/` のURLプレフィックスプロパティを確認・作成する。
2. `https://marchinz.netlify.app/sitemap.xml` を送信する。
3. URL検査で上表の5URLを順に検査し、「インデックス登録をリクエスト」する。
4. 公開HTMLでcanonical、title、description、JSON-LDが期待どおり返ることを確認する。
5. 公式X、YouTube、提携先など、MarchinZが管理できる正式プロフィールから公式サイトへリンクする。

## 測定

Search Consoleの検索パフォーマンスで、公開日を基準に7日・28日・90日で比較する。

- クエリ: `MarchinZ`, `マーチンズ`, `マーチング`
- 指標: 表示回数、クリック数、CTR、平均掲載順位
- ページ: 上表5URLごとの表示回数とクリック
- ブランド検索と一般検索を分けて評価する

GA4ではOrganic Searchからのランディングページ、滞在、主要導線への遷移を見る。

## 継続更新の原則

- 実際に利用者へ役立つ大会・動画・コミュニティ情報を更新する。
- ページごとに検索意図を一つに絞り、同じ文章の量産ページを作らない。
- キーワードを不自然に反復しない。meta keywordsは追加しない。
- 公開情報の出典・配信元・権利者を明確にする。
- 新しい恒久ページを追加したら、通常リンクとサイトマップの両方へ追加する。

## Google公式資料

- SEOスターターガイド: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- URL構造: https://developers.google.com/search/docs/crawling-indexing/url-structure
- 再クロールの依頼: https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- サイト名: https://developers.google.com/search/docs/appearance/site-names
- スパムポリシー: https://developers.google.com/search/docs/essentials/spam-policies
