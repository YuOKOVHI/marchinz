# MarchinZ セキュリティ対応チェックリスト

サイト全体の仕様（ページ・操作・データ・法的文書との関係）は **`docs/MARCHINZ_SPEC.md`** にまとめています。

目的は **不正利用・課金暴走・データ改ざん** を抑え、運用で異常に早く気づける状態にすることです。

---

## 必須（運用・コンソール中心）

| 項目 | 目的 | 実施内容（概要） |
|------|------|------------------|
| **課金アラート・予算** | 異常トラフィックや攻撃で請求が跳ねるのを早期検知する | Google Cloud Console → **課金** → **予算とアラート** でプロジェクトに予算を設定し、しきい値（例: 50% / 90% / 100%）でメール通知。Firebase の利用状況は GCP と同一課金アカウントで確認。 |
| **Firebase / GCP 監視** | どのプロダクトが増えているか把握する | Cloud Monitoring のダッシュボード、または Firebase Console の **Usage** を定期的に確認。Storage / Firestore の急増がないか見る。 |
| **App Check（本番キー + Enforcement）** | API キー公開 SPA に対し、Bot や直叩きの悪用を減らす | 1) Firebase Console → **App Check** で Web アプリを登録し **reCAPTCHA v3 サイトキー**を発行する。2) 本番の `auth-config.js`（またはホスティングの環境変数注入）に `appCheck.recaptchaSiteKey` を設定する。3) 問題なければ **Firestore / Storage / 必要なら Realtime DB** で **Enforcement を有効化**する（有効化前にトークンが付いていることを必ず確認）。4) ローカル開発用にデバッグトークンを Console に登録する。 |

**コード側の現状:** `auth.js` でキーがあれば `ReCaptchaV3Provider` を有効化済み。`MLL_AUTH.isAppCheckActive()` で有効かどうかを参照可能。

---

## リポジトリで実装済み・継続メンテ

| 項目 | 目的 | 備考 |
|------|------|------|
| **Firestore `mll_profiles` allowlist** | クライアントが任意フィールドを `merge` で増やせないようにする | `firebase/firestore.rules` の `mll_profiles/{uid}` を参照。 |
| **Storage ルール（サイズ・MIME・パス）** | 巨大ファイル・非画像の直 PUT を抑止 | `firebase/storage.rules`。 |
| **画像の canvas 再エンコード** | EXIF 等のメタが乗りにくい JPEG へ変換（プロフィール・コミュニティ・ログ日記） | クライアント実装。ルールは MIME のみ検知（完全なマジックバイト検証は別レイヤ）。 |

---

## 推奨（余力・脅威に応じて）

| 項目 | 目的 |
|------|------|
| **Firestore ルールに App Check 条件** | Enforcement に加え、ルール層でも「App Check 付き」だけ許可する多層防御（要検証・クライアント全経路でトークン付与が必要） |
| **Cloud Functions での画像検証** | `contentType` 偽装への耐性を上げる |
| **レート制限（Functions / API Gateway）** | 同一 UID・IP 単位の書き込み頻度上限（ルール単体では実装困難） |
| **Search Console + 正規 URL** | 検索・共有時の URL 正規化（ハッシュのみのサイトは SEO 都合と併せて検討） |

---

## デプロイ時

- `firebase/firestore.rules` と `firebase/storage.rules` を **Firebase CLI または Console** にデプロイし、ルールのシミュレータで主要パスを確認する。
- App Check Enforcement を入れた直後は **クライアントが必ず App Check 初期化に成功しているか** を本番で確認する（失敗すると正当ユーザーも拒否される）。
