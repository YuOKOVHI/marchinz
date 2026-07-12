#!/usr/bin/env node
/**
 * mll_logs.section_vis_mll バックフィル（Admin SDK）
 *
 * 背景: mll_logs 読み取りルールの section_vis_mll チェックを get(mll_profiles) から
 * resource.data.section_vis_mll（非正規化フィールド）参照に変更した。既存ログには
 * このフィールドが無いため、mll_profiles の現在値をコピーして埋める。
 *
 * 事前準備:
 *   cd scripts && npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *
 * 実行:
 *   node backfill-mll-section-vis.mjs --dry-run
 *   node backfill-mll-section-vis.mjs --dry-run --user-id=YOUR_FIREBASE_AUTH_UID
 *   node backfill-mll-section-vis.mjs
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** ローカル専用 `scripts/.local-env`（gitignore）を読む */
function loadLocalEnv() {
  const p = resolve(__dirname, ".local-env");
  if (!existsSync(p) || process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

loadLocalEnv();

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "marchinz-app";
const BATCH_SIZE = 400;
const PREVIEW_LINES = 30;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean; userId: string; report: string }} */
  const opts = { dryRun: false, userId: "", report: "" };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--user-id=")) opts.userId = a.slice(10).trim();
    else if (a.startsWith("--report=")) opts.report = a.slice(9).trim();
  }
  return opts;
}

function initFirebaseAdmin() {
  const jsonPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "";
  if (jsonPath && existsSync(jsonPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(jsonPath, "utf8"))),
      projectId: PROJECT_ID,
    });
    return;
  }
  admin.initializeApp({ projectId: PROJECT_ID });
}

/** @param {FirebaseFirestore.Firestore} db */
async function loadProfileVisMap(db) {
  const snap = await db.collection("mll_profiles").get();
  /** @type {Map<string, "public"|"private">} */
  const map = new Map();
  snap.forEach((doc) => {
    const v = String(doc.data()?.section_vis_mll || "").trim();
    map.set(doc.id, v === "private" ? "private" : "public");
  });
  return map;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} userId
 */
async function loadLogs(db, userId) {
  let q = db.collection("mll_logs");
  if (userId) q = /** @type {typeof q} */ (q.where("user_id", "==", userId));
  const snap = await q.get();
  /** @type {{ id: string; data: Record<string, unknown> }[]} */
  const rows = [];
  snap.forEach((doc) => rows.push({ id: doc.id, data: doc.data() || {} }));
  return rows;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  initFirebaseAdmin();
  const db = admin.firestore();

  console.log(
    `[backfill-mll-section-vis] project=${PROJECT_ID} dryRun=${opts.dryRun} userId=${opts.userId || "(all)"}`,
  );

  const profileVis = await loadProfileVisMap(db);
  console.log(`[backfill] mll_profiles loaded=${profileVis.size}`);

  const logs = await loadLogs(db, opts.userId);
  console.log(`[backfill] mll_logs loaded=${logs.length}`);

  /** @type {{ id: string; user_id: string; from: string; to: "public"|"private" }[]} */
  const plans = [];
  for (const row of logs) {
    const uid = String(row.data.user_id || "").trim();
    if (!uid) continue;
    const want = profileVis.get(uid) || "public";
    const current = String(row.data.section_vis_mll || "").trim();
    if (current === want) continue;
    plans.push({ id: row.id, user_id: uid, from: current || "(未設定)", to: want });
  }

  const stats = { scanned: logs.length, to_update: plans.length };
  console.log(`[backfill] stats`, stats);
  for (const p of plans.slice(0, PREVIEW_LINES)) {
    console.log(`  ${p.id} uid=${p.user_id} ${p.from} → ${p.to}`);
  }
  if (plans.length > PREVIEW_LINES) console.log(`  ... 他 ${plans.length - PREVIEW_LINES} 件`);

  if (!opts.dryRun && plans.length) {
    for (let i = 0; i < plans.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const p of plans.slice(i, i + BATCH_SIZE)) {
        batch.update(db.collection("mll_logs").doc(p.id), { section_vis_mll: p.to });
      }
      await batch.commit();
      console.log(`[backfill] committed ${Math.min(i + BATCH_SIZE, plans.length)} / ${plans.length}`);
    }
  }

  if (opts.report) {
    const outPath = resolve(process.cwd(), opts.report);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      `${JSON.stringify({ at: new Date().toISOString(), projectId: PROJECT_ID, dryRun: opts.dryRun, userId: opts.userId || null, stats, plans }, null, 2)}\n`,
      "utf8",
    );
    console.log(`[backfill] report written: ${outPath}`);
  }

  console.log("[backfill-mll-section-vis] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
