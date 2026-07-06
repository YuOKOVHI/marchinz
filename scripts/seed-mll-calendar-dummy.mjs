#!/usr/bin/env node
/**
 * mll_calendar_events にダミーを 20 件追加（Firestore Admin / ルール無視）。
 *
 * 事前準備（この scripts ディレクトリで）:
 *   npm install
 *
 * 実行例:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   export SEED_CREATED_BY_UID=<あなたの Firebase Auth UID>
 *   node seed-mll-calendar-dummy.mjs
 *
 * 削除するときは Firebase Console で title が「[ダミー]」で検索・一括削除するか、
 * 出力された doc id を参照してください。
 *
 * --dry-run … 書き込まずペイロードだけ表示
 */

import { readFileSync, existsSync } from "node:fs";
import admin from "firebase-admin";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "marchinz-app";
const uid = process.env.SEED_CREATED_BY_UID || "";
const dryRun = process.argv.includes("--dry-run");

if (!uid && !dryRun) {
  console.error("SEED_CREATED_BY_UID を設定してください（イベントの created_by に使います）。");
  process.exit(1);
}

const kinds = ["イベント", "演奏会", "大会"];
const prefs = ["東京都", "大阪府", "愛知県", "福岡県", "北海道", "神奈川県"];
const parts = ["観戦", "出演", "運営", "チームスタッフ", "未定"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function buildPayload(i) {
  const month = ((i % 12) + 1);
  const day = ((i * 3) % 28) + 1;
  const year = 2026 + Math.floor(i / 15);
  const date = `${year}/${pad(month)}/${pad(day)}`;
  const kind = kinds[i % kinds.length];
  const title = `[ダミー] テストイベント ${i + 1}（削除可） ${kind}`;
  return {
    kind,
    date,
    title,
    venue_pref: prefs[i % prefs.length],
    event_url: i % 4 === 0 ? "" : `https://example.com/dummy-event-${i + 1}`,
    participation_format: parts[i % parts.length],
    created_by: uid || "dry-run-no-uid",
    liked_by: {},
    creator_display_name: "ダミーSeed",
    creator_avatar_url: "",
    created_at: new Date().toISOString(),
  };
}

const payloads = Array.from({ length: 20 }, (_, i) => buildPayload(i));

if (dryRun) {
  console.log(JSON.stringify(payloads.slice(0, 2), null, 2), "\n... 計20件");
  process.exit(0);
}

function initFirebaseAdmin() {
  const jsonPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "";
  if (jsonPath && existsSync(jsonPath)) {
    const raw = readFileSync(jsonPath, "utf8");
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      projectId: PROJECT_ID,
    });
    return;
  }
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim()) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(inline)),
      projectId: PROJECT_ID,
    });
    return;
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
}

try {
  initFirebaseAdmin();
} catch (e) {
  console.error(
    "Firebase Admin 初期化に失敗しました。FIREBASE_SERVICE_ACCOUNT_PATH（JSON のパス）または GOOGLE_APPLICATION_CREDENTIALS を設定してください。",
    e.message,
  );
  process.exit(1);
}

const db = admin.firestore();
const col = db.collection("mll_calendar_events");

console.log(`project=${PROJECT_ID} created_by=${uid} … 20件書き込み`);
const ids = [];
for (let i = 0; i < payloads.length; i++) {
  const ref = await col.add(payloads[i]);
  ids.push(ref.id);
  console.log(`  [${i + 1}/20] ${ref.id} ${payloads[i].title}`);
}
console.log("完了。doc ids:", ids.join(", "));
