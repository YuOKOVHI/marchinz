#!/usr/bin/env node
/**
 * attendees → mll_logs 一括補完（Admin SDK）
 *
 * 背景: 「MarchinZ Logを残す」等で attendees のみ書き込まれ mll_logs が欠けた行を修復する。
 * クライアント一覧読込での repair は行わない（コスト・ループ防止）。
 *
 * 事前準備:
 *   cd scripts && npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *
 * 実行:
 *   node migrate-attendees-to-mll.mjs --dry-run
 *   node migrate-attendees-to-mll.mjs --dry-run --user-id=YOUR_FIREBASE_AUTH_UID
 *   node migrate-attendees-to-mll.mjs
 *
 * デプロイ順（本番）:
 *   1) firebase deploy --only firestore:indexes  （user_id + calendar_event_id）
 *   2) 本スクリプト（--dry-run 後に本番）
 *   3) Netlify へサイト JS（ver.1.22.10+）
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
const ATTENDANCE_STYLES = new Set(["観戦", "出演", "チームスタッフ", "スタッフ/運営"]);

const ROLE_PHRASE = {
  watch: { present: "観戦する", past: "観戦した" },
  perform: { present: "出演する", past: "出演した" },
  team_staff: { present: "チームスタッフで参加する", past: "チームスタッフで参加した" },
  ops: { present: "運営側で参加する", past: "運営側で参加した" },
};

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean; userId: string; report: string; limit: number }} */
  const opts = { dryRun: false, userId: "", report: "", limit: 0 };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--user-id=")) opts.userId = a.slice(10).trim();
    else if (a.startsWith("--report=")) opts.report = a.slice(9).trim();
    else if (a.startsWith("--limit=")) opts.limit = Number(a.slice(8)) || 0;
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

function canonicalRole(role) {
  const r = String(role || "").trim();
  if (r === "staff" || r === "team_staff" || r === "チームスタッフ") return "team_staff";
  if (r === "ops" || r === "manage" || r === "運営" || r === "スタッフ/運営" || r === "スタッフ・運営")
    return "ops";
  if (r === "perform" || r === "出演") return "perform";
  if (r === "watch" || r === "観戦") return "watch";
  return "watch";
}

function isPastDate(dateStr) {
  const raw = String(dateStr || "").trim().replace(/\//g, "-");
  if (!raw) return false;
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d < today;
}

function buildRoleLabel(role, dateStr) {
  const key = canonicalRole(role);
  const r = ROLE_PHRASE[key] || ROLE_PHRASE.watch;
  return isPastDate(dateStr) ? r.past : r.present;
}

function firestoreStyleToParticipationValue(style) {
  const s = String(style || "").trim();
  if (s === "スタッフ/運営" || s === "スタッフ・運営") return "運営";
  if (s === "出演" || s === "チームスタッフ" || s === "観戦") return s;
  if (s === "運営") return "運営";
  return "";
}

function attendanceJaToRole(style) {
  const s = String(style || "").trim();
  if (s === "出演") return "perform";
  if (s === "チームスタッフ") return "team_staff";
  if (s === "運営" || s === "スタッフ/運営" || s === "スタッフ・運営") return "ops";
  return "watch";
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {string} eventId
 */
async function findExistingLog(db, uid, eventId) {
  const snap = await db
    .collection("mll_logs")
    .where("user_id", "==", uid)
    .where("calendar_event_id", "==", eventId)
    .limit(5)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} eventId
 * @param {Record<string, unknown>} ev
 * @param {string} uid
 * @param {string} style
 * @param {boolean} dryRun
 */
async function ensureLogFromAttendee(db, eventId, ev, uid, style, dryRun) {
  const existing = await findExistingLog(db, uid, eventId);
  if (existing) return { action: "skip_exists", logId: existing.id };

  const pv = firestoreStyleToParticipationValue(style);
  if (!pv) return { action: "skip_invalid_style", style };

  const role = attendanceJaToRole(pv);
  const date = String(ev.date || "").trim();
  const title = String(ev.title || "").trim();
  const venue = String(ev.venue_pref || "").trim();
  const nowIso = new Date().toISOString();
  const logId = `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const logPayload = {
    user_id: uid,
    event_name: title,
    event_date: date,
    venue,
    role,
    role_label: buildRoleLabel(role, date),
    official_url: String(ev.event_url || "").trim(),
    note: "",
    ticket_url: "",
    visibility: "public",
    created_at: nowIso,
    updated_at: nowIso,
    liked_by: {},
    calendar_event_id: eventId,
    source: "migrate_attendees",
  };

  if (!dryRun) {
    await db.collection("mll_logs").doc(logId).set(logPayload, { merge: true });
    const creatorId = String(ev.created_by || "").trim();
    if (creatorId === uid) {
      await db.collection("mll_calendar_events").doc(eventId).update({ participation_format: pv });
    }
  }

  return { action: dryRun ? "would_create" : "created", logId, participation: pv, role };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  initFirebaseAdmin();
  const db = admin.firestore();

  /** @type {{ scannedEvents: number; scannedAttendees: number; created: number; skippedExists: number; skippedInvalid: number; skippedUser: number; samples: unknown[] }} */
  const summary = {
    scannedEvents: 0,
    scannedAttendees: 0,
    created: 0,
    skippedExists: 0,
    skippedInvalid: 0,
    skippedUser: 0,
    samples: [],
  };

  console.log(`[migrate-attendees-to-mll] project=${PROJECT_ID} dryRun=${opts.dryRun}`);
  if (opts.userId) console.log(`  filter user-id=${opts.userId}`);

  const evSnap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(2000).get();

  for (const evDoc of evSnap.docs) {
    if (opts.limit > 0 && summary.scannedEvents >= opts.limit) break;
    const ev = evDoc.data() || {};
    if (String(ev.status || "").trim() === "trashed") continue;
    summary.scannedEvents += 1;

    const attSnap = await evDoc.ref.collection("attendees").get();
    for (const attDoc of attSnap.docs) {
      const uid = attDoc.id;
      if (opts.userId && uid !== opts.userId) {
        summary.skippedUser += 1;
        continue;
      }
      const style = String(attDoc.data()?.style || "").trim();
      if (!ATTENDANCE_STYLES.has(style)) {
        summary.skippedInvalid += 1;
        continue;
      }
      summary.scannedAttendees += 1;

      const result = await ensureLogFromAttendee(db, evDoc.id, ev, uid, style, opts.dryRun);
      if (result.action === "skip_exists") summary.skippedExists += 1;
      else if (result.action === "skip_invalid_style") summary.skippedInvalid += 1;
      else if (result.action === "created" || result.action === "would_create") {
        summary.created += 1;
        if (summary.samples.length < 40) {
          summary.samples.push({
            eventId: evDoc.id,
            title: ev.title,
            date: ev.date,
            uid,
            style,
            ...result,
          });
        }
      }
    }
  }

  console.log("\n--- summary ---");
  console.log(JSON.stringify(summary, null, 2));

  if (opts.report) {
    const reportPath = resolve(opts.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`\nWrote report: ${reportPath}`);
  }

  if (opts.dryRun) {
    console.log("\n(dry-run: no writes performed)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
