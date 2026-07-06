#!/usr/bin/env node
/**
 * 指定 Firebase Auth UID の MarchinZ Log（mll_logs）をすべて削除。
 * attendees / Note の participation_style も整理する。
 *
 * 事前準備（scripts ディレクトリ）:
 *   npm install
 *   cp .local-env.example .local-env   # サービスアカウントパスを設定
 *   source .local-env
 *
 * 実行:
 *   node purge-user-mll-logs.mjs --uid YOUR_UID --dry-run
 *   node purge-user-mll-logs.mjs --uid YOUR_UID
 */

import { readFileSync, existsSync } from "node:fs";
import admin from "firebase-admin";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "marchinz-app";
const dryRun = process.argv.includes("--dry-run");
const uidArg = process.argv.find((a, i) => process.argv[i - 1] === "--uid") || process.env.PURGE_USER_ID || "";

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
  admin.initializeApp({ projectId: PROJECT_ID });
}

async function fetchAllLogsForUser(db, uid) {
  /** @type {FirebaseFirestore.QueryDocumentSnapshot[]} */
  const docs = [];
  let last = null;
  for (;;) {
    let q = db.collection("mll_logs").where("user_id", "==", uid).limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  return docs;
}

async function main() {
  const uid = String(uidArg || "").trim();
  if (!uid) {
    console.error("Usage: node purge-user-mll-logs.mjs --uid FIREBASE_AUTH_UID [--dry-run]");
    process.exit(1);
  }

  initFirebaseAdmin();
  const db = admin.firestore();
  const docs = await fetchAllLogsForUser(db, uid);
  const eventIds = new Set();
  /** @type {Array<{ eventDate: string; eventName: string; venue: string }>} */
  const orphanKeys = [];

  for (const doc of docs) {
    const x = doc.data() || {};
    const eid = String(x.calendar_event_id || "").trim();
    if (eid) eventIds.add(eid);
    else {
      orphanKeys.push({
        eventDate: String(x.event_date || "").trim(),
        eventName: String(x.event_name || "").trim(),
        venue: String(x.venue || "").trim(),
      });
    }
  }

  console.log(
    `[purge-user-mll-logs] uid=${uid} logs=${docs.length} eventIds=${eventIds.size} orphanKeys=${orphanKeys.length} dryRun=${dryRun}`,
  );
  for (const doc of docs.slice(0, 20)) {
    const x = doc.data() || {};
    console.log(
      `  ${doc.id} | ${String(x.event_date || "").slice(0, 10)} | ${String(x.event_name || "").slice(0, 60)}`,
    );
  }
  if (docs.length > 20) console.log(`  ... 他 ${docs.length - 20} 件`);

  if (dryRun || !docs.length) return;

  const chunk = 400;
  for (let i = 0; i < docs.length; i += chunk) {
    const batch = db.batch();
    docs.slice(i, i + chunk).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`[purge-user-mll-logs] deleted logs ${Math.min(i + chunk, docs.length)} / ${docs.length}`);
  }

  let attendanceRemoved = 0;
  for (const eid of eventIds) {
    try {
      await db.collection("mll_calendar_events").doc(eid).collection("attendees").doc(uid).delete();
      attendanceRemoved += 1;
    } catch (e) {
      console.warn(`[purge-user-mll-logs] attendees ${eid}`, e?.message || e);
    }
    try {
      const ref = db.collection("mll_profiles").doc(uid).collection("event_log_diaries").doc(eid);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(
          { participation_style: "", updated_at: new Date().toISOString() },
          { merge: true },
        );
      }
    } catch (e) {
      console.warn(`[purge-user-mll-logs] diary ${eid}`, e?.message || e);
    }
  }

  console.log(`[purge-user-mll-logs] attendanceRemoved=${attendanceRemoved} orphanKeys=${orphanKeys.length}`);
  console.log("[purge-user-mll-logs] done. サブ垢でログイン中のブラウザでは localStorage も消すため、一度ログアウト→再ログインしてください。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
