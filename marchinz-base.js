/*
 * marchinz-base.js (v1.34.0) — MarchinZ Days(旧称 MarchinZ Base。内部ID・コレクション名は base_* を維持)
 * v1.34: ツール(メトロノーム/チューナー)は TOP の「練習ツール」ブロックにもマウント(mountTools、ログイン不要)。
 *        メトロノームにマイテンポプリセット(最大10個、localStorage mz_days_tools.presets)。
 * 現役マーチャー向けの「毎日戻ってくる部室」。プロフィールの本人限定タブ
 * (#prof-pane-base、user-profile-page.js が showOwnerChrome 時に window.MarchinZBase.mount(uid) を呼ぶ)。
 *
 * 完全非公開データ(本人のみ read/write、firestore.rules 参照):
 *   mll_profiles/{uid}/base_practice_logs/{id}  練習ログ（日付・タグ・時間・メモ）
 *   mll_profiles/{uid}/base_instruments/{id}    楽器（メーカー/品番/購入日 + メンテ履歴を配列で内包）
 *   mll_profiles/{uid}/base_show_notes/{id}     ショウ覚えメモ（カウント・立ち位置・注意点）
 *   mll_profiles/{uid}/base_countdowns/{id}     本番カウントダウン（名前・日付）
 *   mll_profiles/{uid}/base_goals/{id}          目標（コーチング: タイトル・理由・期限・目標時間・状態）
 * 写真: Storage mll_base_media/{uid}/{fileName}（firebase/storage.rules 参照）
 * コーチング: 練習ログは goal_ids で目標に紐付き、保存時に文脈つき応援メッセージ(ストリーク/進捗/復帰)を表示。
 * 楽器メンテ: 種類ごとの推奨サイクルから次回目安日を自動提案し、期限が近いと Days 上部にリマインダーを出す。
 * ツール(メトロノーム/チューナー)は BandRoom 由来の Web Audio 実装。設定は localStorage mz_days_tools。
 */
(() => {
  "use strict";

  const root = () => document.getElementById("mz-base-root");
  // v1.33: ガード(手具)と楽器なし練習(イメトレ・譜読み)を追加。全選択7件は rules の tags<=8 に収まる
  const PRACTICE_TAGS = ["基礎", "曲", "ドリル", "手具・ガード", "筋トレ", "イメトレ・譜読み", "その他"];
  /** 今日の調子(任意)。mark は UI 表示記号、value が Firestore 保存値 */
  const CONDITIONS = [
    { value: "good", mark: "◎", label: "好調" },
    { value: "soso", mark: "○", label: "ふつう" },
    { value: "bad", mark: "△", label: "不調" },
  ];

  let mountedUid = "";
  let activeSub = "practice";
  /** @type {any[]} */
  let practiceLogs = [];
  /** @type {any[]} */
  let instruments = [];
  /** @type {any[]} */
  let showNotes = [];
  /** @type {any[]} */
  let countdowns = [];
  /** @type {any[]} */
  let goals = [];
  let loadGen = 0;

  /* ツール(メトロノーム/チューナー)状態。AudioContext は遅延生成して使い回す(close しない) */
  const TOOLS_SETTINGS_KEY = "mz_days_tools";
  let audioCtx = null;
  let metroOn = false;
  let metroTimer = null;
  let metroNextNote = 0;
  let metroBeatIdx = 0;
  /** @type {{time:number,beat:number,accent:boolean}[]} */
  let metroDrawQ = [];
  let metroRafId = 0;
  let tunerOn = false;
  /** @type {MediaStream|null} */
  let tunerStream = null;
  /** @type {AnalyserNode|null} */
  let tunerAnalyser = null;
  /** @type {Float32Array|null} */
  let tunerBuf = null;
  let tunerRafId = 0;
  const toolsSettings = loadToolsSettings();

  function loadToolsSettings() {
    const def = { bpm: 120, beats: 4, accent: true, transpose: "C", presets: [] };
    try {
      const raw = JSON.parse(localStorage.getItem(TOOLS_SETTINGS_KEY) || "{}");
      return {
        bpm: Math.min(260, Math.max(30, Number(raw.bpm) || def.bpm)),
        beats: Math.min(8, Math.max(2, Number(raw.beats) || def.beats)),
        accent: raw.accent !== false,
        transpose: ["C", "B♭", "E♭", "F"].includes(raw.transpose) ? raw.transpose : def.transpose,
        // マイテンポプリセット(v1.34): BPM値を最大10個、ブラウザ(localStorage)に保存
        presets: (Array.isArray(raw.presets) ? raw.presets : [])
          .map((n) => Math.round(Number(n)))
          .filter((n) => n >= 30 && n <= 260)
          .slice(0, 10),
      };
    } catch {
      return def;
    }
  }

  function saveToolsSettings() {
    try { localStorage.setItem(TOOLS_SETTINGS_KEY, JSON.stringify(toolsSettings)); } catch { /* noop */ }
  }

  function getDb() {
    try { return window.MLL_AUTH?.getDb?.() || null; } catch { return null; }
  }
  function getStorage() {
    try { return window.MLL_AUTH?.getStorage?.() || null; } catch { return null; }
  }
  function isMe(uid) {
    return String(window.MLL_AUTH?.getUser?.()?.id || "").trim() === String(uid || "").trim();
  }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const t = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(t.getTime())) return null;
    return Math.round((t.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  }

  async function uploadBaseImage(uid, file) {
    const storage = getStorage();
    if (!storage || !file) return "";
    const compressed = window.MarchinZImage?.compressForUpload
      ? await window.MarchinZImage.compressForUpload(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1400, useWebWorker: false })
      : file;
    const path = `mll_base_media/${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed, { contentType: "image/jpeg", cacheControl: "public,max-age=604800" });
    return ref.getDownloadURL();
  }

  /* ---------- データ読込 ---------- */

  async function loadAll(uid) {
    const db = getDb();
    if (!db) return;
    const gen = ++loadGen;
    // 各コレクション個別に catch: 1本の permission-denied(ルール未反映等)が他を巻き込まないように
    const q = (name, build) =>
      build(db.collection("mll_profiles").doc(uid).collection(name)).get().catch((err) => {
        console.warn(`[MarchinZBase] load ${name}`, err);
        return null;
      });
    const [pSnap, iSnap, sSnap, cSnap, gSnap] = await Promise.all([
      q("base_practice_logs", (c) => c.orderBy("date", "desc").limit(200)),
      q("base_instruments", (c) => c.limit(50)),
      q("base_show_notes", (c) => c.orderBy("created_at", "desc").limit(100)),
      q("base_countdowns", (c) => c.orderBy("date").limit(20)),
      q("base_goals", (c) => c.orderBy("created_at", "desc").limit(30)),
    ]);
    if (gen !== loadGen) return;
    practiceLogs = pSnap ? pSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    instruments = iSnap ? iSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    showNotes = sSnap ? sSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    countdowns = cSnap ? cSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    goals = gSnap ? gSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    render();
  }

  /* ---------- サブタブ骨格 ---------- */

  function render() {
    // サブタブ切替で DOM を作り直すため、鳴っている音・マイクは必ずここで止める
    stopTools();
    // 開いたままのメンテダイアログも回収(SPA遷移で body 直下に残らないように)
    document.getElementById("mz-base-maint-dialog")?.remove();
    const host = root();
    if (!host) return;
    host.replaceChildren();

    const tabs = el("div", "mz-base-subtabs");
    [
      ["practice", "練習ログ"],
      ["tools", "ツール"],
      ["instruments", "楽器メンテ"],
      ["shownotes", "ショウ覚え"],
    ].forEach(([key, label]) => {
      const b = el("button", "mz-base-subtab" + (activeSub === key ? " mz-base-subtab--active" : ""), label);
      b.type = "button";
      b.addEventListener("click", () => {
        activeSub = key;
        render();
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    renderMaintReminder(host);

    const panel = el("div", "mz-base-panel");
    host.appendChild(panel);
    if (activeSub === "practice") renderPractice(panel);
    else if (activeSub === "tools") renderTools(panel);
    else if (activeSub === "instruments") renderInstruments(panel);
    else renderShowNotes(panel);
  }

  /**
   * 楽器メンテの期限リマインダー(全サブタブ共通・subtabs 直下)。
   * next_due_date が「期限切れ or 7日以内」の楽器があれば、最も近い1件+残数を出す。
   * タップで楽器メンテタブへ。
   */
  function renderMaintReminder(host) {
    const due = instruments
      .map((inst) => ({ inst, days: daysUntil(inst.next_due_date) }))
      .filter((x) => x.days != null && x.days <= 7)
      .sort((a, b) => a.days - b.days);
    if (!due.length) return;
    const top = due[0];
    const banner = el("button", "mz-base-maint-banner" + (top.days < 0 ? " mz-base-maint-banner--overdue" : ""));
    banner.type = "button";
    const icon = el("span", "mz-base-maint-banner-icon");
    icon.innerHTML = '<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>';
    banner.appendChild(icon);
    const body = el("span", "mz-base-maint-banner-body");
    const label =
      top.days < 0
        ? `「${top.inst.name}」のメンテ目安日を過ぎています(${String(top.inst.next_due_date).slice(5).replace("-", "/")})`
        : top.days === 0
          ? `今日は「${top.inst.name}」のメンテ目安日です`
          : `「${top.inst.name}」のメンテ目安まであと${top.days}日`;
    body.appendChild(el("span", "mz-base-maint-banner-text", label));
    if (due.length > 1) body.appendChild(el("span", "mz-base-maint-banner-more", `ほか${due.length - 1}件`));
    banner.appendChild(body);
    banner.appendChild(el("span", "mz-base-maint-banner-go", "確認 →"));
    banner.addEventListener("click", () => {
      activeSub = "instruments";
      render();
    });
    host.appendChild(banner);
  }

  /* ---------- 1) 練習ログ ---------- */

  function renderPractice(panel) {
    renderCountdownBlock(panel);

    // 主役の「記録する」導線は常にファーストビュー(目標や統計より上)に置く
    const addBtn = el("button", "mz-base-add-btn", "+ 練習ログを記録");
    addBtn.type = "button";
    const form = buildPracticeForm();
    form.hidden = true;
    addBtn.addEventListener("click", () => { form.hidden = !form.hidden; });
    panel.appendChild(addBtn);
    panel.appendChild(form);

    renderGoalsBlock(panel);

    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const weekMinutes = practiceLogs
      .filter((l) => new Date(String(l.date) + "T00:00:00").getTime() >= weekAgo)
      .reduce((sum, l) => sum + (Number(l.minutes) || 0), 0);
    const tagCount = {};
    practiceLogs.forEach((l) => (Array.isArray(l.tags) ? l.tags : []).forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const topTag = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a])[0];
    const streak = calcStreak();

    const stats = el("div", "mz-base-stats");
    const s0 = el("div", "mz-base-stat" + (streak >= 3 ? " mz-base-stat--fire" : ""));
    const s0num = el("span", "mz-base-stat-num");
    if (streak > 0) {
      s0num.innerHTML = '<i class="fa-solid fa-fire" aria-hidden="true"></i> ';
      s0num.appendChild(document.createTextNode(String(streak)));
    } else {
      s0num.textContent = "—";
    }
    s0.appendChild(s0num);
    s0.appendChild(el("span", "mz-base-stat-label", "連続記録(日)・休み1日OK"));
    stats.appendChild(s0);
    const s1 = el("div", "mz-base-stat");
    s1.appendChild(el("span", "mz-base-stat-num", String(Math.round((weekMinutes / 60) * 10) / 10)));
    s1.appendChild(el("span", "mz-base-stat-label", "今週の練習時間(h)"));
    stats.appendChild(s1);
    const s2 = el("div", "mz-base-stat");
    s2.appendChild(el("span", "mz-base-stat-num", String(practiceLogs.length)));
    s2.appendChild(el("span", "mz-base-stat-label", "総記録数"));
    stats.appendChild(s2);
    const s3 = el("div", "mz-base-stat");
    s3.appendChild(el("span", "mz-base-stat-num", topTag || "—"));
    s3.appendChild(el("span", "mz-base-stat-label", "よく練習する内容"));
    stats.appendChild(s3);
    panel.appendChild(stats);

    renderReviewBlock(panel);

    const list = el("ul", "mz-base-practice-list");
    if (!practiceLogs.length) {
      panel.appendChild(el("p", "mz-base-empty", "まだ記録がありません。今日の練習から残してみましょう。"));
    } else {
      practiceLogs.forEach((log) => list.appendChild(buildPracticeRow(log)));
      panel.appendChild(list);
    }
  }

  function buildPracticeForm() {
    const form = el("form", "mz-base-form");
    const dateRow = el("label", "mz-base-field");
    dateRow.appendChild(el("span", "mz-base-field-label", "日付"));
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = todayStr();
    dateInput.required = true;
    dateRow.appendChild(dateInput);
    form.appendChild(dateRow);

    const tagWrap = el("div", "mz-base-field");
    const tagHead = el("span", "mz-base-field-label-row");
    tagHead.appendChild(el("span", "mz-base-field-label", "内容"));
    const chipsRow = el("div", "mz-base-tag-chips");
    const selected = new Set();
    /** @type {Map<string, HTMLElement>} */
    const tagChipByName = new Map();
    PRACTICE_TAGS.forEach((tag) => {
      const chip = el("button", "mz-base-tag-chip", tag);
      chip.type = "button";
      chip.addEventListener("click", () => {
        if (selected.has(tag)) { selected.delete(tag); chip.classList.remove("mz-base-tag-chip--on"); }
        else { selected.add(tag); chip.classList.add("mz-base-tag-chip--on"); }
      });
      tagChipByName.set(tag, chip);
      chipsRow.appendChild(chip);
    });
    // 「前回と同じ」: 部活勢は毎日ほぼ同じ内容。直近ログの内容+分数をワンタップで再現
    const last = practiceLogs[0] || null;
    if (last) {
      const repeatBtn = el("button", "mz-base-mini-btn mz-base-repeat-btn", "前回と同じにする");
      repeatBtn.type = "button";
      repeatBtn.addEventListener("click", () => {
        selected.clear();
        tagChipByName.forEach((chip) => chip.classList.remove("mz-base-tag-chip--on"));
        (Array.isArray(last.tags) ? last.tags : []).forEach((t) => {
          const chip = tagChipByName.get(t);
          if (chip) { selected.add(t); chip.classList.add("mz-base-tag-chip--on"); }
        });
        minInput.value = String(Number(last.minutes) || "");
        quickMins.querySelectorAll(".mz-base-tag-chip--on").forEach((c) => c.classList.remove("mz-base-tag-chip--on"));
      });
      tagHead.appendChild(repeatBtn);
    }
    tagWrap.appendChild(tagHead);
    tagWrap.appendChild(chipsRow);
    form.appendChild(tagWrap);

    const minRow = el("label", "mz-base-field");
    minRow.appendChild(el("span", "mz-base-field-label", "時間(分)"));
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.min = "0";
    minInput.max = "1440";
    minInput.placeholder = "60";
    minRow.appendChild(minInput);
    // よく使う分数はタップだけで入力完了(数字キーボードを開かせない)
    const quickMins = el("div", "mz-base-tag-chips mz-base-min-chips");
    [15, 30, 60, 90].forEach((m) => {
      const chip = el("button", "mz-base-tag-chip", `${m}分`);
      chip.type = "button";
      chip.addEventListener("click", () => {
        minInput.value = String(m);
        quickMins.querySelectorAll(".mz-base-tag-chip--on").forEach((c) => c.classList.remove("mz-base-tag-chip--on"));
        chip.classList.add("mz-base-tag-chip--on");
      });
      quickMins.appendChild(chip);
    });
    minInput.addEventListener("input", () => {
      quickMins.querySelectorAll(".mz-base-tag-chip--on").forEach((c) => c.classList.remove("mz-base-tag-chip--on"));
    });
    minRow.appendChild(quickMins);
    form.appendChild(minRow);

    // 今日の調子(任意・単一選択)。メモを書かなくても波が残る
    let selectedCondition = "";
    const condWrap = el("div", "mz-base-field");
    condWrap.appendChild(el("span", "mz-base-field-label", "今日の調子(任意)"));
    const condChips = el("div", "mz-base-tag-chips");
    CONDITIONS.forEach((c) => {
      const chip = el("button", "mz-base-tag-chip mz-base-cond-chip", `${c.mark} ${c.label}`);
      chip.type = "button";
      chip.addEventListener("click", () => {
        const wasOn = selectedCondition === c.value;
        selectedCondition = wasOn ? "" : c.value;
        condChips.querySelectorAll(".mz-base-tag-chip--on").forEach((n) => n.classList.remove("mz-base-tag-chip--on"));
        if (!wasOn) chip.classList.add("mz-base-tag-chip--on");
      });
      condChips.appendChild(chip);
    });
    condWrap.appendChild(condChips);
    form.appendChild(condWrap);

    // どの目標に向けた練習か(コーチング: 毎回目標との接続を意識してもらう)
    const selectedGoals = new Set();
    const goalOptions = activeGoals();
    if (goalOptions.length) {
      const goalWrap = el("div", "mz-base-field");
      goalWrap.appendChild(el("span", "mz-base-field-label", "どの目標に向けた練習?"));
      const goalChips = el("div", "mz-base-tag-chips");
      goalOptions.forEach((g, i) => {
        const chip = el("button", "mz-base-tag-chip mz-base-goal-chip");
        chip.innerHTML = '<i class="fa-solid fa-bullseye" aria-hidden="true"></i> ';
        chip.appendChild(document.createTextNode(g.title || ""));
        chip.type = "button";
        // 目標が1つだけなら最初から選択済みにして手間ゼロに
        if (goalOptions.length === 1 && i === 0) {
          selectedGoals.add(g.id);
          chip.classList.add("mz-base-tag-chip--on");
        }
        chip.addEventListener("click", () => {
          if (selectedGoals.has(g.id)) { selectedGoals.delete(g.id); chip.classList.remove("mz-base-tag-chip--on"); }
          else { selectedGoals.add(g.id); chip.classList.add("mz-base-tag-chip--on"); }
        });
        goalChips.appendChild(chip);
      });
      goalWrap.appendChild(goalChips);
      form.appendChild(goalWrap);
    }

    const memoRow = el("label", "mz-base-field");
    memoRow.appendChild(el("span", "mz-base-field-label", "メモ"));
    const memoInput = document.createElement("textarea");
    memoInput.rows = 2;
    memoInput.maxLength = 800;
    memoInput.placeholder = "できたこと・課題など";
    memoRow.appendChild(memoInput);
    form.appendChild(memoRow);

    const msg = el("p", "mz-base-form-msg");
    msg.hidden = true;
    form.appendChild(msg);

    const submit = el("button", "mz-base-submit-btn", "記録する");
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const db = getDb();
      if (!db || !mountedUid) return;
      submit.disabled = true;

      // 応援メッセージ用の「保存前」文脈(復帰・初回・進捗跨ぎ判定は保存前の状態から取る)
      const isFirst = practiceLogs.length === 0;
      const lastDate = practiceLogs
        .map((l) => String(l.date || "").slice(0, 10))
        .sort()
        .pop();
      const gapDays = lastDate
        ? Math.round((new Date(todayStr() + "T00:00:00") - new Date(lastDate + "T00:00:00")) / 86400000)
        : 0;
      const minutesVal = Math.max(0, Math.min(1440, Number(minInput.value) || 0));
      // ルール上限(10件)に合わせて切り詰め
      const goalIds = Array.from(selectedGoals).slice(0, 10);
      const pctBeforeById = {};
      goalIds.forEach((gid) => {
        const g = goals.find((x) => x.id === gid);
        const target = g ? Number(g.target_minutes) || 0 : 0;
        pctBeforeById[gid] = target > 0 ? Math.min(100, Math.round((goalProgressMinutes(g) / target) * 100)) : null;
      });

      try {
        const nowIso = new Date().toISOString();
        await db
          .collection("mll_profiles")
          .doc(mountedUid)
          .collection("base_practice_logs")
          .add({
            date: dateInput.value || todayStr(),
            tags: Array.from(selected).slice(0, 8),
            minutes: minutesVal,
            memo: String(memoInput.value || "").trim().slice(0, 800),
            // 任意フィールドは未選択なら送らない(旧ルール配信中でも保存が通るロールバック耐性)
            ...(goalIds.length ? { goal_ids: goalIds } : {}),
            ...(selectedCondition ? { condition: selectedCondition } : {}),
            created_at: nowIso,
            updated_at: nowIso,
          });
        // 目標の累計進捗をインクリメント(表示窓 limit(200) に依存しない恒久カウンタ)
        if (goalIds.length && minutesVal > 0 && window.firebase?.firestore?.FieldValue?.increment) {
          await Promise.all(
            goalIds.map((gid) =>
              db
                .collection("mll_profiles")
                .doc(mountedUid)
                .collection("base_goals")
                .doc(gid)
                .update({
                  progress_minutes: window.firebase.firestore.FieldValue.increment(minutesVal),
                  updated_at: nowIso,
                })
                .catch((e) => console.warn("[MarchinZBase] goal progress", e)),
            ),
          );
        }
      } catch (e) {
        console.warn("[MarchinZBase] practice add", e);
        msg.textContent = "保存に失敗しました。時間をおいて再度お試しください。";
        msg.hidden = false;
        submit.disabled = false;
        return;
      }

      // 保存は成功済み。以降(再読込・応援演出)の失敗を「保存失敗」と誤表示しない
      try {
        window.MarchinZConfetti?.burst({ count: 40, duration: 700 });
        await loadAll(mountedUid); // practiceLogs/goals が最新化され、フォームも作り直される

        const now = new Date();
        const week = practiceLogs
          .filter((l) => new Date(String(l.date) + "T00:00:00").getTime() >= now.getTime() - 7 * 86400000)
          .reduce((s, l) => s + (Number(l.minutes) || 0), 0);
        const prevWeek = practiceLogs
          .filter((l) => {
            const t = new Date(String(l.date) + "T00:00:00").getTime();
            return t >= now.getTime() - 14 * 86400000 && t < now.getTime() - 7 * 86400000;
          })
          .reduce((s, l) => s + (Number(l.minutes) || 0), 0);
        const goalViews = goalIds
          .map((gid) => {
            const g = goals.find((x) => x.id === gid);
            if (!g) return null;
            const target = Number(g.target_minutes) || 0;
            return {
              title: g.title || "",
              pct: target > 0 ? Math.min(100, Math.round((goalProgressMinutes(g) / target) * 100)) : null,
              pctBefore: pctBeforeById[gid],
            };
          })
          .filter(Boolean);
        showCheerToast(
          pickCheerMessage({
            goalViews,
            streak: calcStreak(),
            weekMinutes: week,
            prevWeekMinutes: prevWeek,
            gapDays,
            isFirst,
            hour: now.getHours(),
          }),
          goalViews,
        );
      } catch (e) {
        console.warn("[MarchinZBase] post-save", e);
      }
    });

    return form;
  }

  function buildPracticeRow(log) {
    const li = el("li", "mz-base-practice-row");
    const left = el("div", "mz-base-practice-left");
    const dateLine = el("span", "mz-base-practice-date", String(log.date || "").replace(/-/g, "/"));
    const cond = CONDITIONS.find((c) => c.value === log.condition);
    if (cond) {
      const mark = el("span", `mz-base-practice-cond mz-base-practice-cond--${cond.value}`, cond.mark);
      mark.setAttribute("aria-label", `調子: ${cond.label}`);
      mark.title = `調子: ${cond.label}`;
      dateLine.appendChild(mark);
    }
    left.appendChild(dateLine);
    const tagsWrap = el("div", "mz-base-practice-tags");
    (Array.isArray(log.tags) ? log.tags : []).forEach((t) => tagsWrap.appendChild(el("span", "mz-base-practice-tag", t)));
    left.appendChild(tagsWrap);
    if (log.memo) left.appendChild(el("p", "mz-base-practice-memo", log.memo));
    li.appendChild(left);
    const right = el("div", "mz-base-practice-right");
    right.appendChild(el("span", "mz-base-practice-min", `${Number(log.minutes) || 0}分`));
    const del = el("button", "mz-base-del-btn", "削除");
    del.type = "button";
    del.setAttribute("aria-label", "この練習ログを削除");
    del.addEventListener("click", () => removeDoc("base_practice_logs", log.id, () => loadAll(mountedUid)));
    right.appendChild(del);
    li.appendChild(right);
    return li;
  }

  /* ---------- 1a) ふりかえり(月間サマリー+ヒートマップ) ---------- */

  /**
   * 「今月の合計・回数・タグ内訳」と直近12週間のヒートマップ。
   * データは読み込み済みの practiceLogs(直近200件窓)から作る。1日複数回練習しても
   * 200件あれば12週はまず収まる。窓から溢れた古い日は空白になるだけで実害なし。
   */
  function renderReviewBlock(panel) {
    if (!practiceLogs.length) return;
    const wrap = el("section", "mz-base-review");
    const title = el("p", "mz-base-review-title");
    title.innerHTML = '<i class="fa-solid fa-chart-column" aria-hidden="true"></i> ふりかえり';
    wrap.appendChild(title);

    // 今月サマリー
    const ym = todayStr().slice(0, 7);
    const monthLogs = practiceLogs.filter((l) => String(l.date || "").slice(0, 7) === ym);
    const monthMin = monthLogs.reduce((s, l) => s + (Number(l.minutes) || 0), 0);
    const line = el("p", "mz-base-review-month");
    line.appendChild(el("b", null, `${Number(ym.slice(5))}月`));
    line.appendChild(document.createTextNode(` ${fmtHours(monthMin)}・${monthLogs.length}回`));
    const monthTags = {};
    monthLogs.forEach((l) => (Array.isArray(l.tags) ? l.tags : []).forEach((t) => { monthTags[t] = (monthTags[t] || 0) + 1; }));
    Object.keys(monthTags)
      .sort((a, b) => monthTags[b] - monthTags[a])
      .slice(0, 3)
      .forEach((t) => line.appendChild(el("span", "mz-base-review-tag", `${t} ${monthTags[t]}`)));
    wrap.appendChild(line);

    // ヒートマップ: 列=週(古→新)、行=月〜日。今週は途中まで、未来セルは透明
    const byDate = {};
    practiceLogs.forEach((l) => {
      const k = String(l.date || "").slice(0, 10);
      if (k) byDate[k] = (byDate[k] || 0) + (Number(l.minutes) || 0);
    });
    const key = (dt) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const todayKey = todayStr();
    const start = new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 11); // 12週前の月曜
    const grid = el("div", "mz-hm-grid");
    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", "直近12週間の練習ヒートマップ");
    const cur = new Date(start);
    for (let i = 0; i < 12 * 7; i++) {
      const k = key(cur);
      const cell = el("span", "mz-hm-cell");
      if (k > todayKey) {
        cell.classList.add("mz-hm-cell--future");
      } else {
        const min = byDate[k] || 0;
        const lv = min <= 0 ? 0 : min < 30 ? 1 : min < 60 ? 2 : min < 120 ? 3 : 4;
        cell.classList.add(`mz-hm-l${lv}`);
        cell.title = `${k.slice(5).replace("-", "/")} ${min ? `${min}分` : "記録なし"}`;
      }
      grid.appendChild(cell);
      cur.setDate(cur.getDate() + 1);
    }
    const hmWrap = el("div", "mz-hm-wrap");
    const dayCol = el("div", "mz-hm-days");
    ["月", "", "水", "", "金", "", "日"].forEach((d) => dayCol.appendChild(el("span", "mz-hm-day", d)));
    hmWrap.appendChild(dayCol);
    hmWrap.appendChild(grid);
    wrap.appendChild(hmWrap);
    wrap.appendChild(el("p", "mz-base-review-note", "直近12週間・色が濃いほど長く練習した日"));

    panel.appendChild(wrap);
  }

  /* ---------- 1b) 本番カウントダウン(練習ログタブ最上部) ---------- */

  function renderCountdownBlock(panel) {
    const wrap = el("div", "mz-base-countdown-wrap");

    const today = todayStr();
    const upcoming = countdowns.filter((c) => String(c.date || "") >= today);
    const next = upcoming[0] || null;

    if (next) {
      const d = daysUntil(next.date);
      const hero = el("div", "mz-base-countdown-hero");
      const heroIcon = el("span", "mz-base-countdown-icon");
      heroIcon.innerHTML = '<i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>';
      hero.appendChild(heroIcon);
      const body = el("div", "mz-base-countdown-body");
      body.appendChild(el("p", "mz-base-countdown-name", next.name || "次の本番"));
      body.appendChild(
        el("p", "mz-base-countdown-days", d === 0 ? "本日、本番!" : `あと ${d} 日`),
      );
      body.appendChild(el("p", "mz-base-countdown-date", String(next.date || "").replace(/-/g, "/")));
      hero.appendChild(body);
      wrap.appendChild(hero);
    }

    const toggleBtn = el(
      "button",
      "mz-base-mini-btn mz-base-countdown-toggle",
      countdowns.length ? `本番の予定 ${countdowns.length}件を管理` : "+ 本番カウントダウンを登録",
    );
    toggleBtn.type = "button";
    const detail = el("div", "mz-base-countdown-detail");
    detail.hidden = true;
    toggleBtn.addEventListener("click", () => { detail.hidden = !detail.hidden; });
    wrap.appendChild(toggleBtn);
    wrap.appendChild(detail);

    if (countdowns.length) {
      const list = el("ul", "mz-base-countdown-list");
      countdowns.forEach((c) => {
        const li = el("li", "mz-base-countdown-row");
        const d = daysUntil(c.date);
        const label = d == null ? "" : d < 0 ? "終了" : d === 0 ? "本日" : `あと${d}日`;
        li.appendChild(el("span", "mz-base-countdown-row-date", String(c.date || "").replace(/-/g, "/")));
        li.appendChild(el("span", "mz-base-countdown-row-name", c.name || ""));
        li.appendChild(el("span", "mz-base-countdown-row-left", label));
        const del = el("button", "mz-base-del-btn", "削除");
        del.type = "button";
        del.setAttribute("aria-label", "このカウントダウンを削除");
        del.addEventListener("click", () => removeDoc("base_countdowns", c.id, () => loadAll(mountedUid)));
        li.appendChild(del);
        list.appendChild(li);
      });
      detail.appendChild(list);
    }

    const form = el("form", "mz-base-form mz-base-countdown-form");
    const nameRow = el("label", "mz-base-field");
    nameRow.appendChild(el("span", "mz-base-field-label", "本番名"));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 60;
    nameInput.required = true;
    nameInput.placeholder = "例: マーチング関東大会";
    nameRow.appendChild(nameInput);
    form.appendChild(nameRow);

    const dateRow = el("label", "mz-base-field");
    dateRow.appendChild(el("span", "mz-base-field-label", "日付"));
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.required = true;
    dateRow.appendChild(dateInput);
    form.appendChild(dateRow);

    const msg = el("p", "mz-base-form-msg");
    msg.hidden = true;
    form.appendChild(msg);

    const submit = el("button", "mz-base-submit-btn", "登録する");
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const db = getDb();
      if (!db || !mountedUid || !nameInput.value.trim() || !dateInput.value) return;
      submit.disabled = true;
      try {
        const nowIso = new Date().toISOString();
        await db
          .collection("mll_profiles")
          .doc(mountedUid)
          .collection("base_countdowns")
          .add({
            name: nameInput.value.trim().slice(0, 60),
            date: String(dateInput.value).slice(0, 10),
            created_at: nowIso,
            updated_at: nowIso,
          });
        window.MarchinZConfetti?.burst({ count: 40, duration: 700 });
        await loadAll(mountedUid);
      } catch (e) {
        console.warn("[MarchinZBase] countdown add", e);
        msg.textContent = "登録に失敗しました。";
        msg.hidden = false;
        submit.disabled = false;
      }
    });
    detail.appendChild(form);

    panel.appendChild(wrap);
  }

  /* ---------- 1c) 目標(コーチング) ---------- */

  /**
   * 練習日のユニーク集合から連続記録日数。数えるのは練習した日だけ(休息日はカウントしない)。
   * v1.33: 休みが1日までなら途切れない(週数回ペースの社会人・記録忘れ1日の救済)。
   * 起点も同じ考え方で今日→昨日→一昨日まで遡って探す。
   */
  function calcStreak() {
    const days = new Set(practiceLogs.map((l) => String(l.date || "").slice(0, 10)).filter(Boolean));
    if (!days.size) return 0;
    const d = new Date();
    const key = (dt) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    let probe = 0;
    while (!days.has(key(d)) && probe < 2) {
      d.setDate(d.getDate() - 1);
      probe += 1;
    }
    if (!days.has(key(d))) return 0;
    let streak = 0;
    let rest = 0;
    for (;;) {
      if (days.has(key(d))) {
        streak += 1;
        rest = 0;
      } else {
        rest += 1;
        if (rest > 1) break;
      }
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function activeGoals() {
    return goals.filter((g) => String(g.status || "active") === "active");
  }

  /**
   * 目標の累計練習分数。練習保存時に increment する恒久カウンタ(progress_minutes)を読む。
   * 練習ログの読み込み窓 limit(200) に依存しないので、古いログが窓から落ちても進捗は後退しない。
   * (ログ削除でも減らない=「積み上げた事実」を進捗とみなすコーチング上の割り切り)
   */
  function goalProgressMinutes(g) {
    return Math.max(0, Number(g && g.progress_minutes) || 0);
  }

  function fmtHours(min) {
    const h = Math.round((min / 60) * 10) / 10;
    return h >= 1 ? `${h}h` : `${min}分`;
  }

  function renderGoalsBlock(panel) {
    const wrap = el("section", "mz-base-goals");
    const head = el("div", "mz-base-goals-head");
    const title = el("p", "mz-base-goals-title");
    title.innerHTML = '<i class="fa-solid fa-bullseye" aria-hidden="true"></i> 目標';
    head.appendChild(title);
    const addBtn = el("button", "mz-base-mini-btn", "+ 目標を追加");
    addBtn.type = "button";
    head.appendChild(addBtn);
    wrap.appendChild(head);

    const form = buildGoalForm();
    form.hidden = true;
    addBtn.addEventListener("click", () => { form.hidden = !form.hidden; });

    const actives = activeGoals();
    if (!actives.length) {
      const empty = el("p", "mz-base-goals-empty", "目標を立てると、練習の一歩一歩がそこへ向かいます。小さくてOK。");
      wrap.appendChild(empty);
    } else {
      const list = el("div", "mz-base-goal-list");
      actives.forEach((g) => list.appendChild(buildGoalCard(g)));
      wrap.appendChild(list);
    }
    wrap.appendChild(form);

    const achieved = goals.filter((g) => String(g.status) === "achieved");
    if (achieved.length) {
      const hof = el("details", "mz-base-goal-hof");
      const sum = el("summary", "mz-base-goal-hof-head");
      sum.innerHTML = '<i class="fa-solid fa-trophy" aria-hidden="true"></i> ';
      sum.appendChild(document.createTextNode(`達成した目標 ${achieved.length}件`));
      hof.appendChild(sum);
      achieved.forEach((g) => {
        const row = el("div", "mz-base-goal-hof-row");
        row.appendChild(el("span", "mz-base-goal-hof-title", g.title || ""));
        row.appendChild(el("span", "mz-base-goal-hof-date", String(g.achieved_at || "").slice(0, 10).replace(/-/g, "/")));
        const del = el("button", "mz-base-del-btn", "削除");
        del.type = "button";
        del.addEventListener("click", () => removeDoc("base_goals", g.id, () => loadAll(mountedUid)));
        row.appendChild(del);
        hof.appendChild(row);
      });
      wrap.appendChild(hof);
    }

    panel.appendChild(wrap);
  }

  function buildGoalCard(g) {
    const card = el("div", "mz-base-goal-card");
    const top = el("div", "mz-base-goal-card-top");
    top.appendChild(el("p", "mz-base-goal-name", g.title || ""));
    const dLeft = daysUntil(g.target_date);
    if (g.target_date && dLeft != null) {
      top.appendChild(
        el(
          "span",
          "mz-base-goal-deadline" + (dLeft <= 14 ? " mz-base-goal-deadline--near" : ""),
          dLeft < 0 ? "期限すぎ" : dLeft === 0 ? "今日まで" : `あと${dLeft}日`,
        ),
      );
    }
    card.appendChild(top);
    if (g.why) card.appendChild(el("p", "mz-base-goal-why", `— ${g.why}`));

    const target = Number(g.target_minutes) || 0;
    if (target > 0) {
      const done = goalProgressMinutes(g);
      const pct = Math.min(100, Math.round((done / target) * 100));
      const barWrap = el("div", "mz-base-goal-bar");
      const bar = el("span", "mz-base-goal-bar-fill");
      bar.style.width = `${pct}%`;
      barWrap.appendChild(bar);
      card.appendChild(barWrap);
      card.appendChild(
        el("p", "mz-base-goal-bar-label", `${fmtHours(done)} / ${fmtHours(target)}(${pct}%)`),
      );
    }

    const acts = el("div", "mz-base-goal-actions");
    const del = el("button", "mz-base-del-btn", "削除");
    del.type = "button";
    del.addEventListener("click", () => removeDoc("base_goals", g.id, () => loadAll(mountedUid)));
    acts.appendChild(del);
    const doneBtn = el("button", "mz-base-submit-btn mz-base-goal-achieve-btn");
    doneBtn.innerHTML = '<i class="fa-solid fa-trophy" aria-hidden="true"></i> 達成した!';
    doneBtn.type = "button";
    doneBtn.addEventListener("click", async () => {
      const db = getDb();
      if (!db || !mountedUid) return;
      doneBtn.disabled = true;
      try {
        await db.collection("mll_profiles").doc(mountedUid).collection("base_goals").doc(g.id).update({
          status: "achieved",
          achieved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        window.MarchinZConfetti?.burst({ count: 120, duration: 1600 });
        showCheerToast(`「${g.title}」達成、おめでとう!この積み重ねはもう誰にも消せません。`, [], "🏆 達成!");
        await loadAll(mountedUid);
        // 達成直後は殿堂入りリストを開いて「消えた」と感じさせない
        document.querySelector(".mz-base-goal-hof")?.setAttribute("open", "");
      } catch (e) {
        console.warn("[MarchinZBase] goal achieve", e);
        doneBtn.disabled = false;
      }
    });
    acts.appendChild(doneBtn);
    card.appendChild(acts);
    return card;
  }

  function buildGoalForm() {
    const form = el("form", "mz-base-form mz-base-goal-form");

    const titleRow = el("label", "mz-base-field");
    titleRow.appendChild(el("span", "mz-base-field-label", "目標"));
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.maxLength = 80;
    titleInput.required = true;
    titleInput.placeholder = "例: ロングトーンを毎日続けて大会に立つ";
    titleRow.appendChild(titleInput);
    form.appendChild(titleRow);

    const whyRow = el("label", "mz-base-field");
    whyRow.appendChild(el("span", "mz-base-field-label", "なぜ達成したい?(任意)"));
    const whyInput = document.createElement("input");
    whyInput.type = "text";
    whyInput.maxLength = 200;
    whyInput.placeholder = "例: 去年の悔しさを晴らしたいから";
    whyRow.appendChild(whyInput);
    form.appendChild(whyRow);

    const dateRow = el("label", "mz-base-field");
    dateRow.appendChild(el("span", "mz-base-field-label", "期限(任意)"));
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateRow.appendChild(dateInput);
    form.appendChild(dateRow);

    const minRow = el("label", "mz-base-field");
    minRow.appendChild(el("span", "mz-base-field-label", "目標練習時間(時間・任意)"));
    const hoursInput = document.createElement("input");
    hoursInput.type = "number";
    hoursInput.min = "0";
    hoursInput.max = "10000";
    hoursInput.step = "0.5";
    hoursInput.placeholder = "例: 50";
    minRow.appendChild(hoursInput);
    form.appendChild(minRow);

    const msg = el("p", "mz-base-form-msg");
    msg.hidden = true;
    form.appendChild(msg);

    const submit = el("button", "mz-base-submit-btn", "目標を立てる");
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const db = getDb();
      if (!db || !mountedUid || !titleInput.value.trim()) return;
      submit.disabled = true;
      try {
        const nowIso = new Date().toISOString();
        await db.collection("mll_profiles").doc(mountedUid).collection("base_goals").add({
          title: titleInput.value.trim().slice(0, 80),
          why: whyInput.value.trim().slice(0, 200),
          target_date: String(dateInput.value || "").slice(0, 10),
          target_minutes: Math.max(0, Math.min(600000, Math.round((Number(hoursInput.value) || 0) * 60))),
          progress_minutes: 0,
          status: "active",
          achieved_at: "",
          created_at: nowIso,
          updated_at: nowIso,
        });
        window.MarchinZConfetti?.burst({ count: 50, duration: 800 });
        showCheerToast("目標を立てました。ここからの一歩一歩が全部この目標につながります。", [], "🎯 新しい目標");
        await loadAll(mountedUid);
      } catch (e) {
        console.warn("[MarchinZBase] goal add", e);
        msg.textContent = "保存に失敗しました。";
        msg.hidden = false;
        submit.disabled = false;
      }
    });

    return form;
  }

  /* ---------- 1d) 応援メッセージ(コーチング) ---------- */

  const CHEER_GENERIC = [
    "今日も自分との約束を守りました。それがいちばん強い。",
    "記録した時点で、昨日の自分より一歩前へ。",
    "続けている人にだけ見える景色があります。",
    "小さな積み重ねは、本番の1秒に化けます。",
    "「やった」という事実は消えません。ナイス練習!",
    "楽器を出したこと自体が、もう勝ちです。",
    "コツコツは最強の飛び道具。",
    "今日の1回は、未来のあなたへの仕送りです。",
  ];
  let lastCheerIndex = -1;

  /**
   * 文脈つき応援メッセージを1つ選ぶ。優先度(実装順):
   * 目標100%/90%到達 > マイルストーン跨ぎ(25/50/75) > 初回 > 7日以上の復帰 >
   * ストリーク節目と「節目まであと1日」 > 継続中(間引きあり) > 週間比較 > 朝練/夜練 > 汎用ローテ
   * @param {{goalViews: {title: string, pct: number|null, pctBefore?: number|null}[], streak: number,
   *          weekMinutes: number, prevWeekMinutes: number, gapDays: number, isFirst: boolean, hour: number}} ctx
   */
  function pickCheerMessage(ctx) {
    const g = ctx.goalViews.find((x) => x.pct != null);
    const before = g && g.pctBefore != null ? g.pctBefore : g ? g.pct : null;
    if (g && g.pct >= 100 && before < 100) return `🎉 目標「${g.title}」の練習時間、ついに100%!「達成した!」ボタンを押す準備はいい?`;
    if (g && g.pct >= 90 && g.pct < 100) return `🔜 「${g.title}」まで残りわずか(${g.pct}%)。ゴールテープが見えています。`;
    // 1回の練習で大きく進んでも取りこぼさない「跨ぎ」判定(保存前pct < 節目 <= 保存後pct)
    if (g && [75, 50, 25].some((m) => before < m && g.pct >= m))
      return `📈 「${g.title}」が${g.pct}%到達。積み上がってきた手応え、ありますよね。`;
    if (ctx.isFirst) return "🎺 記念すべき1回目の記録!ここがすべてのスタートラインです。";
    if (ctx.gapDays >= 7) return `おかえりなさい!${ctx.gapDays}日ぶりの再開。戻ってきたこと自体が実力です。`;
    const MILESTONES = [3, 7, 14, 30, 50, 100];
    if (MILESTONES.indexOf(ctx.streak) !== -1) return `🔥 ${ctx.streak}日連続!習慣が実力に変わっていく音がします。`;
    if (MILESTONES.indexOf(ctx.streak + 1) !== -1) return `あと1日で${ctx.streak + 1}日連続🔥 明日の自分に楽しみを残しておきましょう。`;
    // 連続中の定型は毎回は出さない(他の文脈や汎用メッセージにも出番を回す)
    if (ctx.streak >= 2 && Math.random() < 0.5) return `🔥 ${ctx.streak}日連続で継続中。この火、絶やさずにいきましょう。`;
    if (ctx.prevWeekMinutes > 0 && ctx.weekMinutes > ctx.prevWeekMinutes)
      return `📊 今週${fmtHours(ctx.weekMinutes)}。先週(${fmtHours(ctx.prevWeekMinutes)})の自分をもう超えました。`;
    if (ctx.hour < 9) return "🌅 朝練は最高のスタートダッシュ。今日一日、いい音が続きますように。";
    if (ctx.hour >= 21) return "🌙 一日の終わりに楽器と向き合うその姿勢、かっこいいです。";
    let i = Math.floor(Math.random() * CHEER_GENERIC.length);
    if (i === lastCheerIndex) i = (i + 1) % CHEER_GENERIC.length;
    lastCheerIndex = i;
    return CHEER_GENERIC[i];
  }

  /**
   * 応援トースト(下からスライドイン)。goalViews があれば進捗バーも見せる。
   * 見たい人には6.5秒、急ぐ人にはトースト全体タップで即退場。
   * @param {string} message
   * @param {{title: string, pct: number|null}[]} goalViews
   * @param {string} [head] 見出し(既定「記録しました!」。達成・目標作成・メンテはイベントに合わせる)
   */
  function showCheerToast(message, goalViews, head) {
    document.querySelectorAll(".mz-base-cheer").forEach((n) => n.remove());
    const toast = el("div", "mz-base-cheer");
    toast.setAttribute("role", "status");
    const inner = el("div", "mz-base-cheer-inner");
    inner.appendChild(el("p", "mz-base-cheer-head", head || "記録しました!"));
    inner.appendChild(el("p", "mz-base-cheer-msg", message));
    (goalViews || []).forEach((gv) => {
      if (gv.pct == null) return;
      const row = el("div", "mz-base-cheer-goal");
      row.appendChild(el("span", "mz-base-cheer-goal-name", gv.title));
      const bar = el("span", "mz-base-cheer-goal-bar");
      const fill = el("span", "mz-base-cheer-goal-fill");
      // 保存前の値から今回分だけ伸びる(前進の実感)。pctBefore が無ければ 0 から
      fill.style.width = `${Math.max(0, Math.min(100, Number(gv.pctBefore) || 0))}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el("span", "mz-base-cheer-goal-pct", `${gv.pct}%`));
      inner.appendChild(row);
      window.setTimeout(() => { fill.style.width = `${Math.min(100, gv.pct)}%`; }, 350);
    });
    const close = el("button", "mz-base-cheer-x", "×");
    close.type = "button";
    close.setAttribute("aria-label", "閉じる");
    inner.appendChild(close);
    toast.appendChild(inner);
    // どこをタップしても閉じる(×はスクリーンリーダー/明示操作用)
    toast.addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("mz-base-cheer--out");
      window.setTimeout(() => toast.remove(), 450);
    }, 6500);
  }

  /* ---------- 2) 楽器メンテ ---------- */

  function renderInstruments(panel) {
    const addBtn = el("button", "mz-base-add-btn", "+ 楽器を登録");
    addBtn.type = "button";
    const form = buildInstrumentForm();
    form.hidden = true;
    addBtn.addEventListener("click", () => { form.hidden = !form.hidden; });
    panel.appendChild(addBtn);
    panel.appendChild(form);

    if (!instruments.length) {
      panel.appendChild(el("p", "mz-base-empty", "楽器を登録すると、メンテ記録と次回目安をここで管理できます。"));
      return;
    }
    const grid = el("div", "mz-base-instrument-grid");
    instruments.forEach((inst) => grid.appendChild(buildInstrumentCard(inst)));
    panel.appendChild(grid);
  }

  function buildInstrumentForm() {
    const form = el("form", "mz-base-form");
    const nameRow = el("label", "mz-base-field");
    nameRow.appendChild(el("span", "mz-base-field-label", "楽器名"));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 80;
    nameInput.required = true;
    nameInput.placeholder = "例: トランペット(Bach 180)";
    nameRow.appendChild(nameInput);
    form.appendChild(nameRow);

    const typeRow = el("label", "mz-base-field");
    typeRow.appendChild(el("span", "mz-base-field-label", "種類"));
    const typeInput = document.createElement("input");
    typeInput.type = "text";
    typeInput.maxLength = 40;
    typeInput.placeholder = "例: 金管 / 木管 / 打楽器 / カラーガード";
    typeRow.appendChild(typeInput);
    form.appendChild(typeRow);

    const makerRow = el("label", "mz-base-field");
    makerRow.appendChild(el("span", "mz-base-field-label", "メーカー(任意)"));
    const makerInput = document.createElement("input");
    makerInput.type = "text";
    makerInput.maxLength = 60;
    makerInput.placeholder = "例: YAMAHA / Bach / Pearl";
    makerRow.appendChild(makerInput);
    form.appendChild(makerRow);

    const modelRow = el("label", "mz-base-field");
    modelRow.appendChild(el("span", "mz-base-field-label", "品番(任意)"));
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.maxLength = 60;
    modelInput.placeholder = "例: YTR-8335 / 180ML37";
    modelRow.appendChild(modelInput);
    form.appendChild(modelRow);

    const purchaseRow = el("label", "mz-base-field");
    purchaseRow.appendChild(el("span", "mz-base-field-label", "購入日(任意)"));
    const purchaseInput = document.createElement("input");
    purchaseInput.type = "date";
    purchaseRow.appendChild(purchaseInput);
    form.appendChild(purchaseRow);

    const photoRow = el("label", "mz-base-field");
    photoRow.appendChild(el("span", "mz-base-field-label", "写真(任意)"));
    const photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = "image/*";
    photoRow.appendChild(photoInput);
    form.appendChild(photoRow);

    const msg = el("p", "mz-base-form-msg");
    msg.hidden = true;
    form.appendChild(msg);

    const submit = el("button", "mz-base-submit-btn", "登録する");
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const db = getDb();
      if (!db || !mountedUid || !nameInput.value.trim()) return;
      submit.disabled = true;
      try {
        let photoUrl = "";
        if (photoInput.files && photoInput.files[0]) {
          photoUrl = await uploadBaseImage(mountedUid, photoInput.files[0]);
        }
        const nowIso = new Date().toISOString();
        await db
          .collection("mll_profiles")
          .doc(mountedUid)
          .collection("base_instruments")
          .add({
            name: nameInput.value.trim().slice(0, 80),
            type: typeInput.value.trim().slice(0, 40),
            maker: makerInput.value.trim().slice(0, 60),
            model_number: modelInput.value.trim().slice(0, 60),
            purchase_date: String(purchaseInput.value || "").slice(0, 10),
            photo_url: photoUrl,
            maintenance_log: [],
            next_due_date: "",
            created_at: nowIso,
            updated_at: nowIso,
          });
        form.reset();
        form.hidden = true;
        await loadAll(mountedUid);
      } catch (e) {
        console.warn("[MarchinZBase] instrument add", e);
        msg.textContent = "登録に失敗しました。";
        msg.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    return form;
  }

  function buildInstrumentCard(inst) {
    const card = el("div", "mz-base-instrument-card");
    if (inst.photo_url) {
      const img = document.createElement("img");
      img.className = "mz-base-instrument-photo";
      img.src = inst.photo_url;
      img.alt = "";
      card.appendChild(img);
    }
    const body = el("div", "mz-base-instrument-body");
    body.appendChild(el("p", "mz-base-instrument-name", inst.name || ""));
    if (inst.type) body.appendChild(el("p", "mz-base-instrument-type", inst.type));
    const makerModel = [String(inst.maker || "").trim(), String(inst.model_number || "").trim()]
      .filter(Boolean)
      .join(" ・ ");
    if (makerModel) {
      const spec = el("p", "mz-base-instrument-spec");
      spec.innerHTML = '<i class="fa-solid fa-tag" aria-hidden="true"></i> ';
      spec.appendChild(document.createTextNode(makerModel));
      body.appendChild(spec);
    }
    if (inst.purchase_date) {
      const spec2 = el("p", "mz-base-instrument-spec");
      spec2.innerHTML = '<i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> ';
      spec2.appendChild(document.createTextNode(`購入日 ${String(inst.purchase_date).replace(/-/g, "/")}`));
      body.appendChild(spec2);
    }

    const due = daysUntil(inst.next_due_date);
    if (inst.next_due_date) {
      const badge = el(
        "span",
        "mz-base-due-badge" + (due != null && due <= 7 ? " mz-base-due-badge--soon" : ""),
        due == null ? "" : due < 0 ? `期限切れ(${String(inst.next_due_date).slice(5)})` : due === 0 ? "本日が目安" : `あと${due}日(${String(inst.next_due_date).slice(5)})`,
      );
      body.appendChild(badge);
    }

    const log = Array.isArray(inst.maintenance_log) ? inst.maintenance_log : [];
    if (log.length) {
      const hist = el("ul", "mz-base-maint-list");
      log.slice(-3).reverse().forEach((m) => {
        const li = el("li", "mz-base-maint-item");
        li.textContent = `${String(m.date || "").replace(/-/g, "/")} ${m.kind || ""}${m.memo ? " ・ " + m.memo : ""}`;
        hist.appendChild(li);
      });
      body.appendChild(hist);
    }

    const addMaintBtn = el("button", "mz-base-mini-btn", "メンテ記録を追加");
    addMaintBtn.type = "button";
    addMaintBtn.addEventListener("click", () => openMaintDialog(inst));
    body.appendChild(addMaintBtn);

    const del = el("button", "mz-base-del-btn mz-base-del-btn--card", "この楽器を削除");
    del.type = "button";
    del.addEventListener("click", () => removeDoc("base_instruments", inst.id, () => loadAll(mountedUid)));
    body.appendChild(del);

    card.appendChild(body);
    return card;
  }

  /** メンテ種類 → 推奨サイクル(日)。選ぶと次回目安日を自動提案する(編集可) */
  const MAINT_KINDS = [
    ["オイル差し", 14],
    ["グリス塗り", 30],
    ["スワブ・清掃", 7],
    ["リード交換", 14],
    ["弦・ヘッド交換", 90],
    ["リペア・調整", 180],
    ["その他", 0],
  ];

  function addDaysStr(baseDateStr, days) {
    const d = new Date(String(baseDateStr) + "T00:00:00");
    if (Number.isNaN(d.getTime()) || !days) return "";
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function openMaintDialog(inst) {
    document.getElementById("mz-base-maint-dialog")?.remove();
    const dlg = document.createElement("dialog");
    dlg.id = "mz-base-maint-dialog";
    dlg.className = "mz-base-maint-dialog";
    const surface = el("div", "mz-base-maint-surface");

    const head = el("p", "mz-base-maint-head");
    head.innerHTML = '<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i> ';
    head.appendChild(document.createTextNode(`メンテ記録 — ${inst.name || ""}`));
    surface.appendChild(head);

    let kindValue = MAINT_KINDS[0][0];

    const dateRow = el("label", "mz-base-field");
    dateRow.appendChild(el("span", "mz-base-field-label", "実施日"));
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = todayStr();
    dateRow.appendChild(dateInput);

    const nextRow = el("label", "mz-base-field");
    nextRow.appendChild(el("span", "mz-base-field-label", "次回目安日(自動提案・編集可)"));
    const nextInput = document.createElement("input");
    nextInput.type = "date";
    nextRow.appendChild(nextInput);

    const suggestNext = () => {
      const days = (MAINT_KINDS.find(([k]) => k === kindValue) || [])[1] || 0;
      nextInput.value = days ? addDaysStr(dateInput.value || todayStr(), days) : "";
    };

    const kindWrap = el("div", "mz-base-field");
    kindWrap.appendChild(el("span", "mz-base-field-label", "内容"));
    const kindChips = el("div", "mz-base-tag-chips");
    MAINT_KINDS.forEach(([k, days], i) => {
      const chip = el("button", "mz-base-tag-chip" + (i === 0 ? " mz-base-tag-chip--on" : ""), days ? `${k}(${days}日毎)` : k);
      chip.type = "button";
      chip.addEventListener("click", () => {
        kindValue = k;
        kindChips.querySelectorAll(".mz-base-tag-chip--on").forEach((c) => c.classList.remove("mz-base-tag-chip--on"));
        chip.classList.add("mz-base-tag-chip--on");
        suggestNext();
      });
      kindChips.appendChild(chip);
    });
    kindWrap.appendChild(kindChips);
    surface.appendChild(kindWrap);
    surface.appendChild(dateRow);
    dateInput.addEventListener("change", suggestNext);
    surface.appendChild(nextRow);
    suggestNext();

    const memoRow = el("label", "mz-base-field");
    memoRow.appendChild(el("span", "mz-base-field-label", "メモ(任意)"));
    const memoInput = document.createElement("input");
    memoInput.type = "text";
    memoInput.maxLength = 200;
    memoInput.placeholder = "例: 3番管の動きが渋い";
    memoRow.appendChild(memoInput);
    surface.appendChild(memoRow);

    const actions = el("div", "mz-base-maint-actions");
    const cancel = el("button", "mz-base-mini-btn", "キャンセル");
    cancel.type = "button";
    cancel.addEventListener("click", () => dlg.close());
    const save = el("button", "mz-base-submit-btn", "記録する");
    save.type = "button";
    save.addEventListener("click", () => {
      const db = getDb();
      if (!db || !mountedUid) return;
      save.disabled = true;
      const log = Array.isArray(inst.maintenance_log) ? inst.maintenance_log.slice() : [];
      log.push({
        date: String(dateInput.value || todayStr()).slice(0, 10),
        kind: kindValue.slice(0, 40),
        memo: String(memoInput.value || "").trim().slice(0, 200),
      });
      db.collection("mll_profiles")
        .doc(mountedUid)
        .collection("base_instruments")
        .doc(inst.id)
        .update({
          maintenance_log: log.slice(-100),
          next_due_date: String(nextInput.value || "").slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .then(() => {
          dlg.close();
          showCheerToast(`「${inst.name}」お手入れ完了。道具を大切にする人は、音も大切にできる人です。`, [], "🔧 お手入れ記録");
          return loadAll(mountedUid);
        })
        .catch((e) => {
          console.warn("[MarchinZBase] maint add", e);
          save.disabled = false;
        });
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    surface.appendChild(actions);

    dlg.appendChild(surface);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
  }

  /* ---------- 3) ショウ覚えメモ ---------- */

  function renderShowNotes(panel) {
    const addBtn = el("button", "mz-base-add-btn", "+ ショウ覚えメモを作成");
    addBtn.type = "button";
    const form = buildShowNoteForm();
    form.hidden = true;
    addBtn.addEventListener("click", () => { form.hidden = !form.hidden; });
    panel.appendChild(addBtn);
    panel.appendChild(form);

    if (!showNotes.length) {
      panel.appendChild(el("p", "mz-base-empty", "本番前に見返すセットごとのメモを残せます。"));
      return;
    }
    const grid = el("div", "mz-base-shownote-grid");
    showNotes.forEach((note) => grid.appendChild(buildShowNoteCard(note)));
    panel.appendChild(grid);
  }

  function buildShowNoteForm() {
    const form = el("form", "mz-base-form");
    const titleRow = el("label", "mz-base-field");
    titleRow.appendChild(el("span", "mz-base-field-label", "セット名"));
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.maxLength = 120;
    titleInput.required = true;
    titleInput.placeholder = "例: オープニング〜1stムーブ";
    titleRow.appendChild(titleInput);
    form.appendChild(titleRow);

    const countsRow = el("label", "mz-base-field");
    countsRow.appendChild(el("span", "mz-base-field-label", "カウント"));
    const countsInput = document.createElement("textarea");
    countsInput.rows = 2;
    countsInput.maxLength = 2000;
    countsInput.placeholder = "5-6-7-8 で1歩目、16カウントで方向転換…";
    countsRow.appendChild(countsInput);
    form.appendChild(countsRow);

    const posRow = el("label", "mz-base-field");
    posRow.appendChild(el("span", "mz-base-field-label", "立ち位置"));
    const posInput = document.createElement("textarea");
    posInput.rows = 2;
    posInput.maxLength = 2000;
    posInput.placeholder = "サイドライン30ヤード…";
    posRow.appendChild(posInput);
    form.appendChild(posRow);

    const cautionRow = el("label", "mz-base-field");
    cautionRow.appendChild(el("span", "mz-base-field-label", "注意点"));
    const cautionInput = document.createElement("textarea");
    cautionInput.rows = 2;
    cautionInput.maxLength = 2000;
    cautionInput.placeholder = "テンポが走りやすい箇所…";
    cautionRow.appendChild(cautionInput);
    form.appendChild(cautionRow);

    const photoRow = el("label", "mz-base-field");
    photoRow.appendChild(el("span", "mz-base-field-label", "図・写真(任意)"));
    const photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = "image/*";
    photoRow.appendChild(photoInput);
    form.appendChild(photoRow);

    const msg = el("p", "mz-base-form-msg");
    msg.hidden = true;
    form.appendChild(msg);

    const submit = el("button", "mz-base-submit-btn", "保存する");
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const db = getDb();
      if (!db || !mountedUid || !titleInput.value.trim()) return;
      submit.disabled = true;
      try {
        let photoUrl = "";
        if (photoInput.files && photoInput.files[0]) {
          photoUrl = await uploadBaseImage(mountedUid, photoInput.files[0]);
        }
        const nowIso = new Date().toISOString();
        await db
          .collection("mll_profiles")
          .doc(mountedUid)
          .collection("base_show_notes")
          .add({
            title: titleInput.value.trim().slice(0, 120),
            counts_text: countsInput.value.trim().slice(0, 2000),
            position_text: posInput.value.trim().slice(0, 2000),
            caution_text: cautionInput.value.trim().slice(0, 2000),
            photo_url: photoUrl,
            created_at: nowIso,
            updated_at: nowIso,
          });
        form.reset();
        form.hidden = true;
        await loadAll(mountedUid);
      } catch (e) {
        console.warn("[MarchinZBase] shownote add", e);
        msg.textContent = "保存に失敗しました。";
        msg.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    return form;
  }

  function buildShowNoteCard(note) {
    const card = el("div", "mz-base-shownote-card");
    if (note.photo_url) {
      const img = document.createElement("img");
      img.className = "mz-base-shownote-photo";
      img.src = note.photo_url;
      img.alt = "";
      card.appendChild(img);
    }
    const body = el("div", "mz-base-shownote-body");
    body.appendChild(el("p", "mz-base-shownote-title", note.title || ""));
    if (note.counts_text) {
      const b = el("div", "mz-base-shownote-block");
      b.appendChild(el("span", "mz-base-shownote-block-label", "カウント"));
      b.appendChild(el("p", "mz-base-shownote-block-text", note.counts_text));
      body.appendChild(b);
    }
    if (note.position_text) {
      const b = el("div", "mz-base-shownote-block");
      b.appendChild(el("span", "mz-base-shownote-block-label", "立ち位置"));
      b.appendChild(el("p", "mz-base-shownote-block-text", note.position_text));
      body.appendChild(b);
    }
    if (note.caution_text) {
      const b = el("div", "mz-base-shownote-block mz-base-shownote-block--caution");
      b.appendChild(el("span", "mz-base-shownote-block-label", "⚠ 注意点"));
      b.appendChild(el("p", "mz-base-shownote-block-text", note.caution_text));
      body.appendChild(b);
    }
    const del = el("button", "mz-base-del-btn mz-base-del-btn--card", "削除");
    del.type = "button";
    del.addEventListener("click", () => removeDoc("base_show_notes", note.id, () => loadAll(mountedUid)));
    body.appendChild(del);
    card.appendChild(body);
    return card;
  }

  /* ---------- 4) ツール(メトロノーム/チューナー) — BandRoom 由来の Web Audio 実装 ---------- */

  const TUNER_A4 = 442;
  const NOTE_JP = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"];
  const NOTE_EN = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  /** 記譜音 = 実音 + オフセット(半音) */
  const TUNER_TRANSPOSE = { "C": 0, "B♭": 2, "E♭": 9, "F": 7 };
  // 初期プリセット4種(v1.34: 用途がすぐ分かる代表テンポに整理)。ユーザーは下の
  // 「マイプリセット」で自分のテンポを追加保存できる(localStorage)。
  const METRO_PRESETS = [
    ["ゆっくり", 60], ["マーチ", 120], ["8分音符練習", 144], ["ハイテンポ", 220],
  ];

  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS はユーザージェスチャ内での resume が必須(スタートボタンの click 内から呼ばれる)
    audioCtx.resume().catch(() => { /* noop */ });
    return audioCtx;
  }

  /**
   * 鳴っている音・マイクを全部止める。呼び出し箇所:
   * render() 冒頭(サブタブ切替) / pagehide / #prof-pane-base の hidden 監視(プロフタブ離脱)。
   * AudioContext は close せず suspend(次回すぐ再開できる)。
   */
  function stopTools() {
    metroOn = false;
    if (metroTimer) { clearInterval(metroTimer); metroTimer = null; }
    metroDrawQ = [];
    if (metroRafId) { cancelAnimationFrame(metroRafId); metroRafId = 0; }
    tunerOn = false;
    if (tunerRafId) { cancelAnimationFrame(tunerRafId); tunerRafId = 0; }
    if (tunerStream) {
      try { tunerStream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      tunerStream = null;
    }
    tunerAnalyser = null;
    if (audioCtx && audioCtx.state === "running") audioCtx.suspend().catch(() => { /* noop */ });
  }

  function metroClick(time, accent) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = accent ? 1760 : 880;
    g.gain.setValueAtTime(accent ? 0.5 : 0.35, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    o.connect(g).connect(audioCtx.destination);
    o.start(time);
    o.stop(time + 0.06);
  }

  /** 自己相関 + 放物線補間によるピッチ検出(BandRoom より) */
  function autoCorrelate(buf, sr) {
    let SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;
    let r1 = 0;
    let r2 = SIZE - 1;
    const th = 0.2;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < th) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < th) { r2 = SIZE - i; break; }
    buf = buf.slice(r1, r2);
    SIZE = buf.length;
    const c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] += buf[j] * buf[j + i];
    let d = 0;
    while (d < SIZE - 1 && c[d] > c[d + 1]) d++;
    let maxv = -1;
    let maxp = -1;
    for (let i = d; i < SIZE; i++) if (c[i] > maxv) { maxv = c[i]; maxp = i; }
    if (maxp <= 0) return -1;
    let T0 = maxp;
    const x1 = c[T0 - 1];
    const x2 = c[T0];
    const x3 = c[T0 + 1] || x2;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);
    return sr / T0;
  }

  /**
   * メトロノーム1台ぶんのUI(見出し〜スタートボタン)を組み立てて返す。
   * 音・拍数はモジュール変数(metroOn 等)を共有するので、同時に1台だけ動く前提。
   * ログイン不要(Firestoreを触らない・localStorageのみ)。
   */
  function buildMetroSection() {
    const metroSec = el("section", "mz-base-tool-sec");
    const metroHead = el("p", "mz-base-tool-head");
    metroHead.innerHTML = '<i class="fa-solid fa-stopwatch" aria-hidden="true"></i> メトロノーム';
    metroSec.appendChild(metroHead);

    const bpmWrap = el("div", "mz-base-bpm-wrap");
    const bpmNum = el("span", "mz-base-bpm-num", String(toolsSettings.bpm));
    bpmWrap.appendChild(bpmNum);
    bpmWrap.appendChild(el("span", "mz-base-bpm-unit", "BPM"));
    metroSec.appendChild(bpmWrap);

    const dots = el("div", "mz-base-beat-dots");
    metroSec.appendChild(dots);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "30";
    slider.max = "260";
    slider.value = String(toolsSettings.bpm);
    slider.className = "mz-base-bpm-slider";
    slider.setAttribute("aria-label", "テンポ(BPM)");
    metroSec.appendChild(slider);

    const setBpm = (v) => {
      v = Math.min(260, Math.max(30, Math.round(v)));
      toolsSettings.bpm = v;
      saveToolsSettings();
      bpmNum.textContent = String(v);
      slider.value = String(v);
    };
    slider.addEventListener("input", () => setBpm(Number(slider.value)));

    const ctrlRow = el("div", "mz-base-bpm-ctrl");
    [["-5", -5], ["-1", -1], ["+1", 1], ["+5", 5]].forEach(([label, d]) => {
      const b = el("button", "mz-base-mini-btn", label);
      b.type = "button";
      b.addEventListener("click", () => setBpm(toolsSettings.bpm + d));
      ctrlRow.appendChild(b);
    });
    let taps = [];
    const tapBtn = el("button", "mz-base-mini-btn mz-base-tap-btn", "TAP");
    tapBtn.type = "button";
    tapBtn.addEventListener("click", () => {
      const t = performance.now();
      taps = taps.filter((x) => t - x < 2500);
      taps.push(t);
      if (taps.length >= 2) {
        const iv = [];
        for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
        setBpm(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length));
      }
    });
    ctrlRow.appendChild(tapBtn);
    metroSec.appendChild(ctrlRow);

    const beatRow = el("div", "mz-base-tool-row");
    const beatsLabel = el("label", "mz-base-field mz-base-field--inline");
    beatsLabel.appendChild(el("span", "mz-base-field-label", "拍子"));
    const beatsSel = document.createElement("select");
    for (let i = 2; i <= 8; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${i}拍子`;
      beatsSel.appendChild(o);
    }
    beatsSel.value = String(toolsSettings.beats);
    beatsLabel.appendChild(beatsSel);
    beatRow.appendChild(beatsLabel);
    const accentLabel = el("label", "mz-base-field mz-base-field--inline mz-base-accent-label");
    const accentInput = document.createElement("input");
    accentInput.type = "checkbox";
    accentInput.checked = toolsSettings.accent;
    accentLabel.appendChild(accentInput);
    accentLabel.appendChild(document.createTextNode(" 1拍目アクセント"));
    beatRow.appendChild(accentLabel);
    metroSec.appendChild(beatRow);

    const renderDots = () => {
      dots.replaceChildren();
      for (let i = 0; i < toolsSettings.beats; i++) dots.appendChild(el("span", "mz-base-dot"));
    };
    renderDots();
    beatsSel.addEventListener("change", () => {
      toolsSettings.beats = Number(beatsSel.value) || 4;
      saveToolsSettings();
      metroBeatIdx = 0;
      renderDots();
    });
    accentInput.addEventListener("change", () => {
      toolsSettings.accent = accentInput.checked;
      saveToolsSettings();
    });

    const presets = el("div", "mz-base-tool-chips");
    METRO_PRESETS.forEach(([n, b]) => {
      const chip = el("button", "mz-base-tag-chip", `${n} ${b}`);
      chip.type = "button";
      chip.addEventListener("click", () => setBpm(b));
      presets.appendChild(chip);
    });
    metroSec.appendChild(presets);

    // マイテンポプリセット(v1.34): いまのBPMをワンタップ保存、最大10個(localStorage)。
    // チップ本体で適用、右の×で削除。
    const myWrap = el("div", "mz-base-my-presets");
    const myHead = el("div", "mz-base-my-presets-head");
    myHead.appendChild(el("span", "mz-base-field-label", "マイプリセット"));
    const saveBtn = el("button", "mz-base-mini-btn mz-base-preset-save", "+ いまのテンポを保存");
    saveBtn.type = "button";
    myHead.appendChild(saveBtn);
    myWrap.appendChild(myHead);
    const myChips = el("div", "mz-base-tool-chips mz-base-my-preset-chips");
    myWrap.appendChild(myChips);
    const renderMyPresets = () => {
      myChips.replaceChildren();
      toolsSettings.presets.forEach((b, i) => {
        const chip = el("span", "mz-base-tag-chip mz-base-preset-chip");
        const apply = el("button", "mz-base-preset-apply", `♩=${b}`);
        apply.type = "button";
        apply.setAttribute("aria-label", `テンポ ${b} を呼び出す`);
        apply.addEventListener("click", () => setBpm(b));
        chip.appendChild(apply);
        const del = el("button", "mz-base-preset-del", "×");
        del.type = "button";
        del.setAttribute("aria-label", `プリセット ${b} を削除`);
        del.addEventListener("click", () => {
          toolsSettings.presets.splice(i, 1);
          saveToolsSettings();
          renderMyPresets();
        });
        chip.appendChild(del);
        myChips.appendChild(chip);
      });
      if (!toolsSettings.presets.length) {
        myChips.appendChild(el("span", "mz-base-my-presets-empty", "よく使うテンポを保存しておけます(10個まで)"));
      }
      const full = toolsSettings.presets.length >= 10;
      saveBtn.disabled = full;
      saveBtn.textContent = full ? "プリセットは10個まで" : "+ いまのテンポを保存";
    };
    saveBtn.addEventListener("click", () => {
      if (toolsSettings.presets.length >= 10) return;
      if (!toolsSettings.presets.includes(toolsSettings.bpm)) {
        toolsSettings.presets.push(toolsSettings.bpm);
        toolsSettings.presets.sort((a, b) => a - b);
        saveToolsSettings();
      }
      renderMyPresets();
    });
    renderMyPresets();
    metroSec.appendChild(myWrap);

    const metroBtn = el("button", "mz-base-submit-btn mz-base-tool-toggle", "▶ スタート");
    metroBtn.type = "button";
    const metroScheduler = () => {
      if (!audioCtx) return;
      while (metroNextNote < audioCtx.currentTime + 0.1) {
        const accent = toolsSettings.accent && metroBeatIdx === 0;
        metroClick(metroNextNote, accent);
        metroDrawQ.push({ time: metroNextNote, beat: metroBeatIdx, accent });
        metroNextNote += 60 / toolsSettings.bpm;
        metroBeatIdx = (metroBeatIdx + 1) % toolsSettings.beats;
      }
    };
    const metroDraw = () => {
      if (!metroOn || !audioCtx) return;
      const t = audioCtx.currentTime;
      while (metroDrawQ.length && metroDrawQ[0].time <= t) {
        const evd = metroDrawQ.shift();
        dots.querySelectorAll(".mz-base-dot").forEach((d, i) => {
          d.classList.toggle("mz-base-dot--hit", i === evd.beat);
          d.classList.toggle("mz-base-dot--accent", i === evd.beat && evd.accent);
        });
      }
      metroRafId = requestAnimationFrame(metroDraw);
    };
    metroBtn.addEventListener("click", () => {
      if (metroOn) {
        // メトロノームだけ止める(チューナーが動いていれば維持)
        metroOn = false;
        if (metroTimer) { clearInterval(metroTimer); metroTimer = null; }
        metroDrawQ = [];
        if (metroRafId) { cancelAnimationFrame(metroRafId); metroRafId = 0; }
        dots.querySelectorAll(".mz-base-dot").forEach((d) => d.classList.remove("mz-base-dot--hit", "mz-base-dot--accent"));
        metroBtn.textContent = "▶ スタート";
        metroBtn.classList.remove("mz-base-tool-toggle--on");
        if (!tunerOn && audioCtx) audioCtx.suspend().catch(() => { /* noop */ });
        return;
      }
      ensureAudioCtx();
      metroOn = true;
      metroBeatIdx = 0;
      metroNextNote = audioCtx.currentTime + 0.08;
      metroTimer = setInterval(metroScheduler, 25);
      metroBtn.textContent = "⏸ ストップ";
      metroBtn.classList.add("mz-base-tool-toggle--on");
      metroRafId = requestAnimationFrame(metroDraw);
      void window.MarchinZAdminUgcLog?.recordToolUse?.({ toolId: "metronome", toolName: "メトロノーム", targetHref: "#top" });
    });
    metroSec.appendChild(metroBtn);
    return metroSec;
  }

  /** チューナー1台ぶんのUI。ログイン不要。 */
  function buildTunerSection() {
    const tunerSec = el("section", "mz-base-tool-sec");
    const tunerHead = el("p", "mz-base-tool-head");
    tunerHead.innerHTML = `<i class="fa-solid fa-gauge-high" aria-hidden="true"></i> チューナー(A4=${TUNER_A4}Hz)`;
    tunerSec.appendChild(tunerHead);

    const noteName = el("p", "mz-base-tuner-note", "--");
    tunerSec.appendChild(noteName);

    const meterWrap = el("div", "mz-base-cents-bar");
    meterWrap.appendChild(el("span", "mz-base-cents-center"));
    const needle = el("span", "mz-base-needle");
    meterWrap.appendChild(needle);
    tunerSec.appendChild(meterWrap);

    const centTxt = el("p", "mz-base-cent-txt", "マイクをオンにすると音程を判定します");
    tunerSec.appendChild(centTxt);
    const freqTxt = el("p", "mz-base-freq-txt", "");
    tunerSec.appendChild(freqTxt);

    const transRow = el("div", "mz-base-tool-chips");
    const renderTrans = () => {
      transRow.replaceChildren();
      Object.keys(TUNER_TRANSPOSE).forEach((k) => {
        const chip = el(
          "button",
          "mz-base-tag-chip" + (toolsSettings.transpose === k ? " mz-base-tag-chip--on" : ""),
          k === "C" ? "C(実音)" : `${k}管`,
        );
        chip.type = "button";
        chip.addEventListener("click", () => {
          toolsSettings.transpose = k;
          saveToolsSettings();
          renderTrans();
        });
        transRow.appendChild(chip);
      });
    };
    renderTrans();
    tunerSec.appendChild(transRow);

    const tunerBtn = el("button", "mz-base-submit-btn mz-base-tool-toggle");
    tunerBtn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i> マイクをオンにする';
    tunerBtn.type = "button";
    const tunerLoop = () => {
      if (!tunerOn || !tunerAnalyser || !audioCtx || !tunerBuf) return;
      tunerAnalyser.getFloatTimeDomainData(tunerBuf);
      const f = autoCorrelate(tunerBuf, audioCtx.sampleRate);
      if (f > 0 && f < 2500) {
        const n = 12 * Math.log2(f / TUNER_A4) + 69;
        const ni = Math.round(n);
        const cents = Math.round((n - ni) * 100);
        const wi = (((ni + TUNER_TRANSPOSE[toolsSettings.transpose]) % 12) + 12) % 12;
        const oct = Math.floor(ni / 12) - 1;
        noteName.replaceChildren(
          document.createTextNode(NOTE_JP[wi] + " "),
          el("small", "", `${NOTE_EN[wi]}${oct}`),
        );
        needle.style.left = `${Math.max(0, Math.min(100, 50 + cents))}%`;
        const ok = Math.abs(cents) <= 5;
        needle.classList.toggle("mz-base-needle--ok", ok);
        centTxt.classList.toggle("mz-base-cent-txt--ok", ok);
        centTxt.textContent = ok ? "✨ ぴったり!" : cents > 0 ? `+${cents} セント(高い)` : `${cents} セント(低い)`;
        freqTxt.textContent = `${f.toFixed(1)} Hz`;
      } else {
        centTxt.classList.remove("mz-base-cent-txt--ok");
        centTxt.textContent = "音を出してみてください…";
      }
      tunerRafId = requestAnimationFrame(tunerLoop);
    };
    tunerBtn.addEventListener("click", async () => {
      if (tunerOn) {
        tunerOn = false;
        if (tunerRafId) { cancelAnimationFrame(tunerRafId); tunerRafId = 0; }
        if (tunerStream) {
          try { tunerStream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
          tunerStream = null;
        }
        tunerAnalyser = null;
        tunerBtn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i> マイクをオンにする';
        tunerBtn.classList.remove("mz-base-tool-toggle--on");
        noteName.textContent = "--";
        centTxt.textContent = "マイクをオフにしました";
        if (!metroOn && audioCtx) audioCtx.suspend().catch(() => { /* noop */ });
        return;
      }
      try {
        tunerStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        centTxt.textContent = "マイクが使えません: " + (e && e.message ? e.message : String(e));
        return;
      }
      ensureAudioCtx();
      const src = audioCtx.createMediaStreamSource(tunerStream);
      tunerAnalyser = audioCtx.createAnalyser();
      tunerAnalyser.fftSize = 2048;
      tunerBuf = new Float32Array(tunerAnalyser.fftSize);
      src.connect(tunerAnalyser);
      tunerOn = true;
      tunerBtn.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i> マイクをオフにする';
      tunerBtn.classList.add("mz-base-tool-toggle--on");
      tunerLoop();
      void window.MarchinZAdminUgcLog?.recordToolUse?.({ toolId: "tuner", toolName: "チューナー", targetHref: "#top" });
    });
    tunerSec.appendChild(tunerBtn);
    return tunerSec;
  }

  /** TOPブロック用の「練習記録(Days)への誘導」カードを返す(ツールは誰でも・記録はDaysで)。
   * v1.34.1: 説明文は削除し、CTAボタンのみのすっきりしたカードに。 */
  function buildTopGuide() {
    const guide = el("div", "mz-top-tools-guide");
    const loggedIn = Boolean(window.MLL_AUTH?.getUser?.()?.id);
    const cta = document.createElement("a");
    cta.className = "mll-lp-btn mll-lp-btn--primary mz-top-tools-guide-btn";
    cta.href = loggedIn ? "#profile?tab=base" : "#signup";
    cta.innerHTML = loggedIn
      ? '<i class="fa-solid fa-drum" aria-hidden="true"></i> 練習を記録する'
      : '<i class="fa-solid fa-drum" aria-hidden="true"></i> 登録して練習記録をつける';
    if (!loggedIn) cta.setAttribute("data-mll-auth-entry", "signup");
    guide.appendChild(cta);
    return guide;
  }

  /**
   * Days のツールタブ用: メトロノームとチューナーを両方縦に並べる(常時展開)。
   * @param {HTMLElement} panel
   */
  function renderTools(panel) {
    panel.appendChild(buildMetroSection());
    panel.appendChild(buildTunerSection());
  }

  /**
   * TOPページの「練習ツール」ブロック用マウント(v1.34)。ログイン不要。
   * アイコンを押すとそのツールが下に開くアコーディオン(初期は閉じ、TOPを軽く保つ)。
   * TOP以外のページへ移動したら(=祖先 .page が hidden になったら)音・マイクを止める。
   * @param {HTMLElement|null} host
   */
  function mountTools(host) {
    if (!host || host.dataset.mzToolsMounted) return;
    host.dataset.mzToolsMounted = "1";

    const TOOL_DEFS = [
      { key: "metro", icon: "fa-stopwatch", label: "メトロノーム", build: buildMetroSection },
      { key: "tuner", icon: "fa-gauge-high", label: "チューナー", build: buildTunerSection },
    ];

    const render = () => {
      stopTools();
      host.replaceChildren();
      let active = "";
      const btns = {};

      const launcher = el("div", "mz-top-tools-launcher");
      const panel = el("div", "mz-top-tools-panel");
      panel.hidden = true;

      TOOL_DEFS.forEach((t) => {
        const b = el("button", "mz-top-tool-launch");
        b.type = "button";
        b.setAttribute("aria-expanded", "false");
        b.innerHTML =
          '<i class="fa-solid ' + t.icon + '" aria-hidden="true"></i><span>' + t.label + "</span>" +
          '<i class="fa-solid fa-chevron-down mz-top-tool-chevron" aria-hidden="true"></i>';
        b.addEventListener("click", () => {
          // 切替・開閉のたびに鳴っている音・マイクを止める(同時に1台だけの前提を守る)
          stopTools();
          active = active === t.key ? "" : t.key;
          if (active) panel.replaceChildren(t.build());
          else panel.replaceChildren();
          panel.hidden = !active;
          Object.keys(btns).forEach((k) => {
            const on = k === active;
            btns[k].classList.toggle("mz-top-tool-launch--on", on);
            btns[k].setAttribute("aria-expanded", on ? "true" : "false");
          });
        });
        btns[t.key] = b;
        launcher.appendChild(b);
      });

      host.appendChild(launcher);
      host.appendChild(panel);
      host.appendChild(buildTopGuide());
    };

    render();
    const page = host.closest(".page");
    if (page) {
      new MutationObserver(() => {
        // 離脱で音・マイクを止め、再表示で作り直す(開いていたツールも畳んで初期状態に戻す)
        if (page.hidden) stopTools();
        else render();
      }).observe(page, { attributes: true, attributeFilter: ["hidden"] });
    }
    // ログイン状態が変わったら誘導の文言/リンク先を追従させる。
    // 演奏・チューニング中に作り直すと音・マイクが止まってしまうため、その間は誘導カードだけ差し替える
    window.addEventListener("mll-auth-changed", () => {
      if (metroOn || tunerOn) {
        const oldGuide = host.querySelector(".mz-top-tools-guide");
        if (oldGuide) oldGuide.replaceWith(buildTopGuide());
        return;
      }
      render();
    });
  }

  /* ---------- 共通削除 ---------- */

  function removeDoc(coll, id, after) {
    if (!window.confirm("削除しますか？この操作は取り消せません。")) return;
    const db = getDb();
    if (!db || !mountedUid) return;
    db.collection("mll_profiles")
      .doc(mountedUid)
      .collection(coll)
      .doc(id)
      .delete()
      .then(after)
      .catch((e) => console.warn("[MarchinZBase] delete", e));
  }

  /* ---------- mount ---------- */

  // プロフィールタブ切替(user-profile-page.js が pane.hidden を切替)やページ離脱で
  // 音・マイクを確実に止める。pane 監視はコールバックが無いため MutationObserver で拾う。
  window.addEventListener("pagehide", stopTools);
  let paneObserved = false;
  function observePaneVisibility() {
    if (paneObserved) return;
    const pane = document.getElementById("prof-pane-base");
    if (!pane) return;
    paneObserved = true;
    new MutationObserver(() => {
      if (pane.hidden) stopTools();
    }).observe(pane, { attributes: true, attributeFilter: ["hidden"] });
  }

  function mount(uid) {
    uid = String(uid || "").trim();
    if (!uid || !isMe(uid) || !root()) return;
    observePaneVisibility();
    if (mountedUid === uid) {
      render();
      return;
    }
    stopTools();
    mountedUid = uid;
    activeSub = "practice";
    loadAll(uid);
  }

  window.MarchinZBase = { mount, mountTools };
})();
