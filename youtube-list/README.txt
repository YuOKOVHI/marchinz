YouTube チャンネル一覧ページ用のアセット一式（サイト直下から分離）

- YouTubeリスト.csv … リストの「正」（列定義・整合は check_data.py も参照）
- youtube-list.inline.js … `window.__YOUTUBE_LIST_ROWS`（CSV の同内容。index.html から先読み）
- youtube-channel-mylist.js … チャンネルマイリスト UI（Firestore 連携）

生成・同期:
  export_youtube_list_via_api.py / export_youtube_list_csv.py → 上記 CSV・inline を更新
  sync_youtube_list_csv_to_inline.py … CSV だけ直したときに inline 再生成

archive/ … API 実行時の *.bak.*（gitignore でコミットしない）
