/*
 * marchinz-base.js (v1.29.0) — MarchinZ Base
 * 現役マーチャー向けの「毎日戻ってくる部室」。プロフィールの本人限定タブ
 * (#prof-pane-base、user-profile-page.js が showOwnerChrome 時に window.MarchinZBase.mount(uid) を呼ぶ)。
 *
 * 完全非公開データ(本人のみ read/write、firestore.rules 参照):
 *   mll_profiles/{uid}/base_practice_logs/{id}  練習ログ（日付・タグ・時間・メモ）
 *   mll_profiles/{uid}/base_instruments/{id}    楽器（メンテ履歴を配列で内包）
 *   mll_profiles/{uid}/base_show_notes/{id}     ショウ覚えメモ（カウント・立ち位置・注意点）
 * 写真: Storage mll_base_media/{uid}/{fileName}（firebase/storage.rules 参照）
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
  let loadGen = 0;

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
    const [pSnap, iSnap, sSnap] = await Promise.all([
      db.collection("mll_profiles").doc(uid).collection("base_practice_logs").orderBy("date", "desc").limit(200).get(),
      db.collection("mll_profiles").doc(uid).collection("base_instruments").limit(50).get(),
      db.collection("mll_profiles").doc(uid).collection("base_show_notes").orderBy("created_at", "desc").limit(100).get(),
    ]).catch((err) => {
      console.warn("[MarchinZBase] load", err);
      return [null, null, null];
    });
    if (gen !== loadGen) return;
    practiceLogs = pSnap ? pSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    instruments = iSnap ? iSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    showNotes = sSnap ? sSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    render();
  }

  /* ---------- サブタブ骨格 ---------- */

  function render() {
    const host = root();
    if (!host) return;
    host.replaceChildren();

    const tabs = el("div", "mz-base-subtabs");
    [
      ["practice", "練習ログ"],
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
    else if (activeSub === "instruments") renderInstruments(panel);
    else renderShowNotes(panel);
  }

  /* ---------- 1) 練習ログ ---------- */

  function renderPractice(panel) {
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

  function mount(uid) {
    uid = String(uid || "").trim();
    if (!uid || !isMe(uid) || !root()) return;
    if (mountedUid === uid) {
      render();
      return;
    }
    mountedUid = uid;
    activeSub = "practice";
    loadAll(uid);
  }

  window.MarchinZBase = { mount };
})();
