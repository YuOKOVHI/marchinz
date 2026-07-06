#!/usr/bin/env node
/**
 * P1.5: mll_logs へ calendar_event_id バックフィル + 同一ユーザー重複行マージ（Admin SDK）
 *
 * docs/MLL_CALENDAR_LIFECYCLE_DISCUSSION.md §7 P1.5 / §12
 *
 *   cd scripts && npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   node backfill-mll-calendar-event-id.mjs --dry-run
 *   node backfill-mll-calendar-event-id.mjs --dry-run --user-id=<Firebase UID>
 *   node backfill-mll-calendar-event-id.mjs --phase=backfill
 *   node backfill-mll-calendar-event-id.mjs --phase=merge
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import {
  calendarMatchKey,
  logMatchKey,
  pickCalendarEventId,
} from "./lib/mll-match-key.mjs";
import {
  mergeGroupKey,
  planGroupMerge,
} from "./lib/mll-log-merge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "marchinz-app";
const BATCH_SIZE = 400;
const PREVIEW_LINES = 30;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean; phase: string; userId: string; force: boolean; report: string; preferEventId: string; deleteOrphans: boolean }} */
  const opts = {
    dryRun: false,
    phase: "all",
    userId: "",
    force: false,
    report: "",
    preferEventId: "",
    deleteOrphans: false,
  };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--delete-orphans") opts.deleteOrphans = true;
    else if (a === "--force") opts.force = true;
    else if (a.startsWith("--phase=")) opts.phase = a.slice(8).trim() || "all";
    else if (a.startsWith("--user-id=")) opts.userId = a.slice(10).trim();
    else if (a.startsWith("--report=")) opts.report = a.slice(9).trim();
    else if (a.startsWith("--prefer-event-id=")) opts.preferEventId = a.slice(18).trim();
  }
  if (!["all", "backfill", "merge"].includes(opts.phase)) {
    throw new Error(`Invalid --phase=${opts.phase} (use all|backfill|merge)`);
  }
  return opts;
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
  admin.initializeApp({ projectId: PROJECT_ID });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} preferEventId
 */
async function buildCalendarIndex(db, preferEventId) {
  const snap = await db.collection("mll_calendar_events").get();
  /** @type {Map<string, { id: string; created_at: string }[]>} */
  const byKey = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const eventById = new Map();

  snap.forEach((doc) => {
    const x = doc.data() || {};
    eventById.set(doc.id, x);
    const key = calendarMatchKey(x);
    if (!key || key === "||") return;
    const row = { id: doc.id, created_at: String(x.created_at || "") };
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  });

  /** @type {Map<string, string>} */
  const keyToEventId = new Map();
  /** @type {{ matchKey: string; chosen: string; eventIds: string[] }[]} */
  const ambiguous = [];

  for (const [key, candidates] of byKey) {
    const { eventId, ambiguous: isAmb } = pickCalendarEventId(key, candidates, preferEventId);
    if (eventId) keyToEventId.set(key, eventId);
    if (isAmb && candidates.length > 1) {
      ambiguous.push({
        matchKey: key,
        chosen: eventId,
        eventIds: candidates.map((c) => c.id),
      });
    }
  }

  return { keyToEventId, ambiguous, calendarCount: snap.size, eventById };
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
  snap.forEach((doc) => {
    rows.push({ id: doc.id, data: doc.data() || {} });
  });
  return rows;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ id: string; data: Record<string, unknown> }[]} logs
 * @param {Map<string, string>} keyToEventId
 * @param {{ dryRun: boolean; force: boolean; deleteOrphans: boolean }} opts
 */
async function runBackfill(db, logs, keyToEventId, opts) {
  /** @type {{ id: string; user_id: string; event_name: string; calendar_event_id: string; matchKey: string }[]} */
  const plans = [];
  /** @type {{ id: string; user_id: string; event_name: string; matchKey: string }[]} */
  const orphans = [];

  for (const row of logs) {
    const existing = String(row.data.calendar_event_id || "").trim();
    if (existing && !opts.force) continue;

    const mk = logMatchKey(row.data);
    const eventId = keyToEventId.get(mk) || "";
    if (!eventId) {
      orphans.push({
        id: row.id,
        user_id: String(row.data.user_id || ""),
        event_name: String(row.data.event_name || "").slice(0, 80),
        matchKey: mk,
      });
      continue;
    }

    const prevSource = String(row.data.source || "").trim();
    const nextSource = prevSource && prevSource !== "legacy" ? prevSource : "backfill";

    plans.push({
      id: row.id,
      user_id: String(row.data.user_id || ""),
      event_name: String(row.data.event_name || "").slice(0, 80),
      calendar_event_id: eventId,
      matchKey: mk,
      payload: {
        calendar_event_id: eventId,
        source: nextSource,
      },
    });
  }

  /** @type {typeof orphans} */
  const orphanDeletes = opts.deleteOrphans ? [...orphans] : [];

  const stats = {
    scanned: logs.length,
    to_backfill: plans.length,
    orphan: orphans.length,
    orphan_deleted: orphanDeletes.length,
    skipped_has_id: logs.length - plans.length - orphans.length,
  };

  console.log(`[backfill] phase=backfill dryRun=${opts.dryRun} deleteOrphans=${opts.deleteOrphans}`, stats);
  for (const p of plans.slice(0, PREVIEW_LINES)) {
    console.log(
      `  ${p.id} uid=${p.user_id} 「${p.event_name}」 → calendar_event_id=${p.calendar_event_id}`,
    );
  }
  if (plans.length > PREVIEW_LINES) console.log(`  ... 他 ${plans.length - PREVIEW_LINES} 件`);
  if (orphans.length) {
    const label = opts.deleteOrphans ? "orphan → delete" : "orphan (no calendar match)";
    console.log(`[backfill] ${label}: ${orphans.length}`);
    for (const o of orphans.slice(0, 10)) {
      console.log(`  ${o.id} uid=${o.user_id} 「${o.event_name}」 key=${o.matchKey}`);
    }
  }

  if (!opts.dryRun && orphanDeletes.length) {
    for (let i = 0; i < orphanDeletes.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const o of orphanDeletes.slice(i, i + BATCH_SIZE)) {
        batch.delete(db.collection("mll_logs").doc(o.id));
      }
      await batch.commit();
      console.log(
        `[backfill] orphan deleted ${Math.min(i + BATCH_SIZE, orphanDeletes.length)} / ${orphanDeletes.length}`,
      );
    }
  }

  if (!opts.dryRun && plans.length) {
    for (let i = 0; i < plans.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const p of plans.slice(i, i + BATCH_SIZE)) {
        batch.update(db.collection("mll_logs").doc(p.id), p.payload);
      }
      await batch.commit();
      console.log(`[backfill] committed ${Math.min(i + BATCH_SIZE, plans.length)} / ${plans.length}`);
    }
  }

  const orphanIds = new Set(orphanDeletes.map((o) => o.id));
  const logsAfter = orphanDeletes.length ? logs.filter((r) => !orphanIds.has(r.id)) : logs;

  return { stats, plans, orphans, logsAfter };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ id: string; data: Record<string, unknown> }[]} logs
 * @param {{ dryRun: boolean }} opts
 */
async function runMerge(db, logs, opts) {
  /** @type {Map<string, { id: string; data: Record<string, unknown> }[]>} */
  const groups = new Map();
  for (const row of logs) {
    const gk = mergeGroupKey(row, logMatchKey);
    if (!gk.startsWith("|") && gk !== "|mk:||") {
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(row);
    }
  }

  /** @type {{ groupKey: string; winnerId: string; loserIds: string[]; user_id: string }[]} */
  const mergePlans = [];
  for (const [groupKey, docs] of groups) {
    const plan = planGroupMerge(docs);
    if (!plan) continue;
    mergePlans.push({
      groupKey,
      winnerId: plan.winner.id,
      loserIds: plan.losers.map((l) => l.id),
      user_id: String(plan.winner.data.user_id || ""),
      winnerRole: String(plan.payload.role || ""),
    });
  }

  const docsToDelete = mergePlans.reduce((n, p) => n + p.loserIds.length, 0);
  const stats = {
    groups_with_duplicates: mergePlans.length,
    docs_to_delete: docsToDelete,
    logs_scanned: logs.length,
  };

  console.log(`[backfill] phase=merge dryRun=${opts.dryRun}`, stats);
  for (const p of mergePlans.slice(0, PREVIEW_LINES)) {
    console.log(
      `  group=${p.groupKey} keep=${p.winnerId} (${p.winnerRole}) delete=[${p.loserIds.join(", ")}]`,
    );
  }
  if (mergePlans.length > PREVIEW_LINES) {
    console.log(`  ... 他 ${mergePlans.length - PREVIEW_LINES} グループ`);
  }

  if (!opts.dryRun && mergePlans.length) {
    for (const mp of mergePlans) {
      const full = groups.get(mp.groupKey);
      if (!full) continue;
      const planned = planGroupMerge(full);
      if (!planned) continue;
      const updateFields = {
        liked_by: planned.payload.liked_by,
        note: planned.payload.note || "",
        ticket_url: planned.payload.ticket_url || "",
        official_url: planned.payload.official_url || "",
        role: planned.payload.role,
      };
      await db.collection("mll_logs").doc(planned.winner.id).update(updateFields);
      for (let i = 0; i < planned.losers.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const L of planned.losers.slice(i, i + BATCH_SIZE)) {
          batch.delete(db.collection("mll_logs").doc(L.id));
        }
        await batch.commit();
      }
    }
    console.log(`[backfill] merge done: ${mergePlans.length} groups`);
  }

  return { stats, mergePlans };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  initFirebaseAdmin();
  const db = admin.firestore();

  console.log(
    `[backfill-mll-calendar-event-id] project=${PROJECT_ID} phase=${opts.phase} dryRun=${opts.dryRun} userId=${opts.userId || "(all)"}`,
  );

  const { keyToEventId, ambiguous, calendarCount } = await buildCalendarIndex(db, opts.preferEventId);
  console.log(`[backfill] calendar_events=${calendarCount} matchKeys=${keyToEventId.size} ambiguousKeys=${ambiguous.length}`);

  const logs = await loadLogs(db, opts.userId);
  console.log(`[backfill] mll_logs loaded=${logs.length}`);

  /** @type {Record<string, unknown>} */
  const report = {
    at: new Date().toISOString(),
    projectId: PROJECT_ID,
    dryRun: opts.dryRun,
    phase: opts.phase,
    userId: opts.userId || null,
    calendarCount,
    ambiguous,
    logsLoaded: logs.length,
  };

  let logsForMerge = logs;

  if (opts.phase === "all" || opts.phase === "backfill") {
    const backfill = await runBackfill(db, logs, keyToEventId, opts);
    report.backfill = backfill.stats;
    report.orphans = backfill.orphans;
    report.backfill_plans_sample = backfill.plans.slice(0, 50);
    logsForMerge = backfill.logsAfter;

    for (const row of backfill.plans) {
      const target = logsForMerge.find((r) => r.id === row.id);
      if (target) {
        target.data.calendar_event_id = row.calendar_event_id;
        target.data.source = row.payload.source;
      }
    }
  }

  if (opts.phase === "all" || opts.phase === "merge") {
    const mergeLogs = !opts.dryRun ? await loadLogs(db, opts.userId) : logsForMerge;
    const merge = await runMerge(db, mergeLogs, opts);
    report.merge = merge.stats;
    report.merge_plans_sample = merge.mergePlans.slice(0, 50);
  }

  if (opts.report) {
    const outPath = resolve(process.cwd(), opts.report);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[backfill] report written: ${outPath}`);
  }

  console.log("[backfill-mll-calendar-event-id] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
