/*
 * marchinz-base.js (v1.30.0) — MarchinZ Days(旧称 MarchinZ Base。内部ID・コレクション名は base_* を維持)
 * 現役マーチャー向けの「毎日戻ってくる部室」。プロフィールの本人限定タブ
 * (#prof-pane-base、user-profile-page.js が showOwnerChrome 時に window.MarchinZBase.mount(uid) を呼ぶ)。
 *
 * 完全非公開データ(本人のみ read/write、firestore.rules 参照):
 *   mll_profiles/{uid}/base_practice_logs/{id}  練習ログ（日付・タグ・時間・メモ）
 *   mll_profiles/{uid}/base_instruments/{id}    楽器（メーカー/品番/購入日 + メンテ履歴を配列で内包）
 *   mll_profiles/{uid}/base_show_notes/{id}     ショウ覚えメモ（カウント・立ち位置・注意点）
 *   mll_profiles/{uid}/base_countdowns/{id}     本番カウントダウン（名前・日付）
 * 写真: Storage mll_base_media/{uid}/{fileName}（firebase/storage.rules 参照）
 * ツール(メトロノーム/チューナー)は BandRoom 由来の Web Audio 実装。設定は localStorage mz_days_tools。
 */
(() => {
  "use strict";

  const root = () => document.getElementById("mz-base-root");
  const PRACTICE_TAGS = ["基礎", "曲", "ドリル", "筋トレ", "その他"];

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
    const def = { bpm: 120, beats: 4, accent: true, transpose: "C" };
    try {
      const raw = JSON.parse(localStorage.getItem(TOOLS_SETTINGS_KEY) || "{}");
      return {
        bpm: Math.min(260, Math.max(30, Number(raw.bpm) || def.bpm)),
        beats: Math.min(8, Math.max(2, Number(raw.beats) || def.beats)),
        accent: raw.accent !== false,
        transpose: ["C", "B♭", "E♭", "F"].includes(raw.transpose) ? raw.transpose : def.transpose,
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
    const [pSnap, iSnap, sSnap, cSnap] = await Promise.all([
      db.collection("mll_profiles").doc(uid).collection("base_practice_logs").orderBy("date", "desc").limit(200).get(),
      db.collection("mll_profiles").doc(uid).collection("base_instruments").limit(50).get(),
      db.collection("mll_profiles").doc(uid).collection("base_show_notes").orderBy("created_at", "desc").limit(100).get(),
      db.collection("mll_profiles").doc(uid).collection("base_countdowns").orderBy("date").limit(20).get(),
    ]).catch((err) => {
      console.warn("[MarchinZBase] load", err);
      return [null, null, null, null];
    });
    if (gen !== loadGen) return;
    practiceLogs = pSnap ? pSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    instruments = iSnap ? iSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    showNotes = sSnap ? sSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    countdowns = cSnap ? cSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    render();
  }

  /* ---------- サブタブ骨格 ---------- */

  function render() {
    // サブタブ切替で DOM を作り直すため、鳴っている音・マイクは必ずここで止める
    stopTools();
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

    const panel = el("div", "mz-base-panel");
    host.appendChild(panel);
    if (activeSub === "practice") renderPractice(panel);
    else if (activeSub === "tools") renderTools(panel);
    else if (activeSub === "instruments") renderInstruments(panel);
    else renderShowNotes(panel);
  }

  /* ---------- 1) 練習ログ ---------- */

  function renderPractice(panel) {
    renderCountdownBlock(panel);
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const weekMinutes = practiceLogs
      .filter((l) => new Date(String(l.date) + "T00:00:00").getTime() >= weekAgo)
      .reduce((sum, l) => sum + (Number(l.minutes) || 0), 0);
    const tagCount = {};
    practiceLogs.forEach((l) => (Array.isArray(l.tags) ? l.tags : []).forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const topTag = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a])[0];

    const stats = el("div", "mz-base-stats");
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

    const addBtn = el("button", "mz-base-add-btn", "+ 練習ログを記録");
    addBtn.type = "button";
    const form = buildPracticeForm();
    form.hidden = true;
    addBtn.addEventListener("click", () => { form.hidden = !form.hidden; });
    panel.appendChild(addBtn);
    panel.appendChild(form);

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
    tagWrap.appendChild(el("span", "mz-base-field-label", "内容"));
    const chipsRow = el("div", "mz-base-tag-chips");
    const selected = new Set();
    PRACTICE_TAGS.forEach((tag) => {
      const chip = el("button", "mz-base-tag-chip", tag);
      chip.type = "button";
      chip.addEventListener("click", () => {
        if (selected.has(tag)) { selected.delete(tag); chip.classList.remove("mz-base-tag-chip--on"); }
        else { selected.add(tag); chip.classList.add("mz-base-tag-chip--on"); }
      });
      chipsRow.appendChild(chip);
    });
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
    form.appendChild(minRow);

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
      try {
        const nowIso = new Date().toISOString();
        await db
          .collection("mll_profiles")
          .doc(mountedUid)
          .collection("base_practice_logs")
          .add({
            date: dateInput.value || todayStr(),
            tags: Array.from(selected),
            minutes: Math.max(0, Math.min(1440, Number(minInput.value) || 0)),
            memo: String(memoInput.value || "").trim().slice(0, 800),
            created_at: nowIso,
            updated_at: nowIso,
          });
        window.MarchinZConfetti?.burst({ count: 40, duration: 700 });
        form.reset();
        selected.clear();
        chipsRow.querySelectorAll(".mz-base-tag-chip--on").forEach((c) => c.classList.remove("mz-base-tag-chip--on"));
        dateInput.value = todayStr();
        form.hidden = true;
        await loadAll(mountedUid);
      } catch (e) {
        console.warn("[MarchinZBase] practice add", e);
        msg.textContent = "保存に失敗しました。時間をおいて再度お試しください。";
        msg.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    return form;
  }

  function buildPracticeRow(log) {
    const li = el("li", "mz-base-practice-row");
    const left = el("div", "mz-base-practice-left");
    left.appendChild(el("span", "mz-base-practice-date", String(log.date || "").replace(/-/g, "/")));
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

  /* ---------- 1b) 本番カウントダウン(練習ログタブ最上部) ---------- */

  function renderCountdownBlock(panel) {
    const wrap = el("div", "mz-base-countdown-wrap");

    const today = todayStr();
    const upcoming = countdowns.filter((c) => String(c.date || "") >= today);
    const next = upcoming[0] || null;

    if (next) {
      const d = daysUntil(next.date);
      const hero = el("div", "mz-base-countdown-hero");
      hero.appendChild(el("span", "mz-base-countdown-icon", "🎺"));
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
    if (makerModel) body.appendChild(el("p", "mz-base-instrument-spec", `🏷 ${makerModel}`));
    if (inst.purchase_date) {
      body.appendChild(
        el("p", "mz-base-instrument-spec", `🛒 購入日 ${String(inst.purchase_date).replace(/-/g, "/")}`),
      );
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

  function openMaintDialog(inst) {
    const kind = window.prompt("メンテ内容(例: オイル差し / リペア / リード交換)", "オイル差し");
    if (kind == null) return;
    const date = window.prompt("実施日 (YYYY-MM-DD)", todayStr()) || todayStr();
    const nextDue = window.prompt("次回目安日 (YYYY-MM-DD・不要なら空欄)", "") || "";
    const memo = window.prompt("メモ(任意)", "") || "";
    const db = getDb();
    if (!db || !mountedUid) return;
    const log = Array.isArray(inst.maintenance_log) ? inst.maintenance_log.slice() : [];
    log.push({ date, kind: String(kind).trim().slice(0, 40), memo: String(memo).trim().slice(0, 200) });
    db.collection("mll_profiles")
      .doc(mountedUid)
      .collection("base_instruments")
      .doc(inst.id)
      .update({
        maintenance_log: log.slice(-100),
        next_due_date: nextDue.trim().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .then(() => loadAll(mountedUid))
      .catch((e) => console.warn("[MarchinZBase] maint add", e));
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
  const METRO_PRESETS = [
    ["基礎練ゆっくり", 60], ["バラード", 72], ["コンサートマーチ", 112],
    ["行進(マーチ)", 120], ["速いマーチ", 132], ["8分音符練習", 144],
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

  function renderTools(panel) {
    /* --- メトロノーム --- */
    const metroSec = el("section", "mz-base-tool-sec");
    metroSec.appendChild(el("p", "mz-base-tool-head", "🥁 メトロノーム"));

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
    });
    metroSec.appendChild(metroBtn);
    panel.appendChild(metroSec);

    /* --- チューナー --- */
    const tunerSec = el("section", "mz-base-tool-sec");
    tunerSec.appendChild(el("p", "mz-base-tool-head", `🎯 チューナー(A4=${TUNER_A4}Hz)`));

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

    const tunerBtn = el("button", "mz-base-submit-btn mz-base-tool-toggle", "🎤 マイクをオンにする");
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
        tunerBtn.textContent = "🎤 マイクをオンにする";
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
      tunerBtn.textContent = "⏹ マイクをオフにする";
      tunerBtn.classList.add("mz-base-tool-toggle--on");
      tunerLoop();
    });
    tunerSec.appendChild(tunerBtn);
    panel.appendChild(tunerSec);
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

  window.MarchinZBase = { mount };
})();
