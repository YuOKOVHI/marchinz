#!/usr/bin/env node
/**
 * visibility バックフィル（Admin SDK）— 2026-07-25 セキュリティレビュー F2 の前工程
 *
 * 背景:
 *   日記(event_log_diaries) / モーメント(moments) の読み取りルールが
 *     (!resource.data.keys().hasAny(['visibility']) || resource.data.visibility == 'public')
 *   というフェイルオープンになっている。visibility を持たない文書は
 *   「公開」側に倒れるため、未ログインの第三者が collectionGroup で本文・写真URLを取れる。
 *
 *   create 側は visibility を必須にしている（diaryFieldsOk / momentFieldsOk が
 *   visibility を無条件参照するため、欠けていると評価エラーで拒否される）ので、
 *   露出しうるのは「visibility 導入前に作られたレガシー文書」だけ。
 *   本当に残っているかは本番を見ないと分からない ─ それを数えるのがこのスクリプト。
 *
 * 手順:
 *   1) まず数える（書き込みなし）
 *        node backfill-visibility.mjs --dry-run
 *   2) 0件ならバックフィル不要。そのままルールをフェイルクローズへ変更してよい
 *   3) 1件以上なら埋める（安全側の 'private' で埋める）
 *        node backfill-visibility.mjs
 *      ※ 'public' で埋めてはいけない。書いた本人が公開のつもりだった保証がない
 *   4) 埋め終わってからルールを
 *        resource.data.visibility == 'public'
 *      のみに変更し、firebase deploy --only firestore:rules
 *
 * 事前準備:
 *   cd scripts && npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** ローカル専用 `scripts/.local-env`（gitignore）を読む */
function loadLocalEnv() {
  const p = resolve(__dirname, ".local-env");
  if (!existsSync(p) || process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}
loadLocalEnv();

const DRY = process.argv.includes("--dry-run");
const FILL = "private";   // 安全側。公開のつもりだった保証がないので public では埋めない

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS が未設定です。README-backfill-mll.md を参照してください。");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

/** collectionGroup を走査し、visibility を持たない文書を数える／埋める */
async function sweep(groupName) {
  const snap = await db.collectionGroup(groupName).get();
  let missing = 0, filled = 0, total = snap.size;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (Object.prototype.hasOwnProperty.call(d, "visibility")) continue;
    missing++;
    console.log(`  [${missing}] ${doc.ref.path}` +
      (d.note_title ? `  note_title=${JSON.stringify(String(d.note_title).slice(0, 24))}` : ""));
    if (DRY) continue;
    batch.update(doc.ref, { visibility: FILL });
    pending++;
    if (pending >= 400) {           // Firestore のバッチ上限 500 に余裕を持たせる
      await batch.commit();
      filled += pending;
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY && pending > 0) { await batch.commit(); filled += pending; }
  return { groupName, total, missing, filled };
}

const results = [];
for (const g of ["event_log_diaries", "moments"]) {
  console.log(`\n=== ${g} ===`);
  results.push(await sweep(g));
}

console.log("\n---- 結果 ----");
for (const r of results) {
  console.log(`${r.groupName}: 総数 ${r.total} / visibility 欠落 ${r.missing}` +
    (DRY ? "（dry-run のため書き込みなし）" : ` / 埋めた ${r.filled}`));
}
const totalMissing = results.reduce((a, r) => a + r.missing, 0);
console.log(
  totalMissing === 0
    ? "\n欠落ゼロ。ルールをフェイルクローズへ変更して問題ありません。"
    : DRY
      ? `\n欠落 ${totalMissing} 件。--dry-run を外して実行し、埋めてからルールを変更してください。`
      : `\n${totalMissing} 件を '${FILL}' で埋めました。続けてルールをフェイルクローズへ変更してください。`,
);
process.exit(0);
