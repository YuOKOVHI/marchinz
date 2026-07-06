#!/usr/bin/env node
/**
 * mll_logs の role / role_label を一括補正（Admin SDK・ルール無視）。
 *
 * 方針:
 * - 各ドキュメントで inferRoleFromLog(role, role_label) を正とする
 * - role_label は buildRoleLabel(role, event_date) で再生成
 * - 現状と異なる場合のみ update
 *
 * 事前準備（scripts ディレクトリ）:
 *   npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *
 * 実行:
 *   node repair-mll-log-roles.mjs --dry-run    # 変更予定のみ表示
 *   node repair-mll-log-roles.mjs              # 本番書き込み
 */

import { readFileSync, existsSync } from "node:fs";
import admin from "firebase-admin";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "marchinz-app";
const dryRun = process.argv.includes("--dry-run");

const PROFILE_ROLE_ORDER = ["watch", "perform", "team_staff", "ops"];

const ROLE_PHRASE = {
  watch: { present: "観戦する", past: "観戦した" },
  perform: { present: "出演する", past: "出演した" },
  team_staff: { present: "チームスタッフで参加する", past: "チームスタッフで参加した" },
  ops: { present: "運営側で参加する", past: "運営側で参加した" },
};

function canonicalRole(role) {
  const r = String(role || "").trim();
  if (r === "staff" || r === "team_staff" || r === "チームスタッフ") return "team_staff";
  if (r === "ops" || r === "manage" || r === "運営" || r === "スタッフ/運営") return "ops";
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

function inferRoleFromLog(doc) {
  let r = String(doc?.role || "").trim();
  if (r === "staff" || r === "チームスタッフ") r = "team_staff";
  else if (r === "manage" || r === "運営" || r === "スタッフ/運営") r = "ops";
  else if (r === "出演") r = "perform";
  else if (r === "観戦") r = "watch";
  if (PROFILE_ROLE_ORDER.includes(r)) return r;
  const rl = String(doc?.role_label || "").trim();
  if (/出演/.test(rl)) return "perform";
  if (/チームスタッフ/.test(rl)) return "team_staff";
  if (/運営|スタッフ/.test(rl)) return "ops";
  if (/観戦/.test(rl)) return "watch";
  return "watch";
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

function planRepair(id, data) {
  const inferred = inferRoleFromLog(data);
  const eventDate = String(data.event_date || "").trim();
  const nextLabel = buildRoleLabel(inferred, eventDate).slice(0, 120);
  const prevRole = canonicalRole(data.role);
  const prevLabel = String(data.role_label || "").trim();
  if (prevRole === inferred && prevLabel === nextLabel) return null;
  return {
    id,
    user_id: String(data.user_id || ""),
    event_name: String(data.event_name || "").slice(0, 80),
    prevRole,
    nextRole: inferred,
    prevLabel: prevLabel.slice(0, 60),
    nextLabel,
  };
}

async function main() {
  initFirebaseAdmin();
  const db = admin.firestore();
  const snap = await db.collection("mll_logs").get();
  /** @type {ReturnType<typeof planRepair>[]} */
  const plans = [];
  snap.forEach((doc) => {
    const p = planRepair(doc.id, doc.data() || {});
    if (p) plans.push(p);
  });

  console.log(`[repair-mll-log-roles] scanned=${snap.size} to_update=${plans.length} dryRun=${dryRun}`);
  for (const p of plans.slice(0, 30)) {
    console.log(
      `  ${p.id} uid=${p.user_id} 「${p.event_name}」 role ${p.prevRole}→${p.nextRole} label「${p.prevLabel}」→「${p.nextLabel}」`,
    );
  }
  if (plans.length > 30) console.log(`  ... 他 ${plans.length - 30} 件`);

  if (dryRun || !plans.length) return;

  const chunk = 400;
  for (let i = 0; i < plans.length; i += chunk) {
    const batch = db.batch();
    for (const p of plans.slice(i, i + chunk)) {
      batch.update(db.collection("mll_logs").doc(p.id), {
        role: p.nextRole,
        role_label: p.nextLabel,
      });
    }
    await batch.commit();
    console.log(`[repair-mll-log-roles] committed ${Math.min(i + chunk, plans.length)} / ${plans.length}`);
  }
  console.log("[repair-mll-log-roles] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
