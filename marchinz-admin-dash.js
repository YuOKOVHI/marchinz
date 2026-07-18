/**
 * MarchinZ 管理ダッシュボード（UGC / UGC（ツール）共通・v1.36.8）
 *
 * YouTube Studio 風の分析ビュー: 期間切替 + KPI カード（前期間比つき）+
 * 折れ線グラフ（SVG 自作・外部ライブラリなし）+ カテゴリ内訳バー。
 * rows は mll_admin_ugc_feed の行（created_at: ISO 文字列, actor_uid, kind / tool_id）。
 * 集計対象は呼び出し側が渡した行のみ（Firestore 取得は直近2000件・呼び出し側の責務）。
 * iOS Safari 16+ / 375px 最優先。タップで各点の値を表示（ホバー非依存）。
 */
(function () {
  "use strict";

  const GUEST_UID = "mll_guest";

  /** [id, ラベル, 期間ミリ秒(0=すべて)] */
  const PERIODS = /** @type {const} */ ([
    ["48h", "48時間", 48 * 3600e3],
    ["7d", "7日間", 7 * 86400e3],
    ["28d", "28日間", 28 * 86400e3],
    ["90d", "90日間", 90 * 86400e3],
    ["all", "すべて", 0],
  ]);

  function loadPeriod(key) {
    try {
      const v = sessionStorage.getItem(`mz_dash_period_${key}`);
      return PERIODS.some(([id]) => id === v) ? v : "28d";
    } catch {
      return "28d";
    }
  }

  function savePeriod(key, v) {
    try {
      sessionStorage.setItem(`mz_dash_period_${key}`, v);
    } catch {
      //
    }
  }

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  /** @param {string} tag @param {Record<string, string>} attrs */
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function parseTime(row) {
    const t = Date.parse(String(row.created_at || ""));
    return Number.isFinite(t) ? t : 0;
  }

  // ── バケット生成(連続軸・空バケットも0で埋める) ──────────

  /** ローカル日付 YYYY-MM-DD */
  function ymd(d) {
    return d.toLocaleDateString("sv-SE");
  }

  /**
   * @param {string} periodId
   * @param {number[]} times 昇順不問のタイムスタンプ列(allの範囲決定用)
   * @returns {{ keys: string[], labels: string[], keyOf: (t: number) => string, unit: string }}
   */
  function buildBuckets(periodId, times) {
    const now = new Date();
    if (periodId === "48h") {
      const keys = [];
      const labels = [];
      const base = new Date(now);
      base.setMinutes(0, 0, 0);
      for (let i = 47; i >= 0; i -= 1) {
        const d = new Date(base.getTime() - i * 3600e3);
        keys.push(`${ymd(d)}T${String(d.getHours()).padStart(2, "0")}`);
        labels.push(`${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}時`);
      }
      return {
        keys,
        labels,
        keyOf: (t) => {
          const d = new Date(t);
          return `${ymd(d)}T${String(d.getHours()).padStart(2, "0")}`;
        },
        unit: "時間",
      };
    }

    /** 日刻み(N日ぶん) */
    const daily = (days) => {
      const keys = [];
      const labels = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(now.getTime() - i * 86400e3);
        keys.push(ymd(d));
        labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      }
      return { keys, labels, keyOf: (t) => ymd(new Date(t)), unit: "日" };
    };

    if (periodId === "7d") return daily(7);
    if (periodId === "28d") return daily(28);
    if (periodId === "90d") return daily(90);

    // all: 範囲が120日以内なら日刻み、超えるなら月刻み
    const valid = times.filter((t) => t > 0);
    const oldest = valid.length ? Math.min(...valid) : now.getTime();
    const spanDays = Math.max(1, Math.ceil((now.getTime() - oldest) / 86400e3) + 1);
    if (spanDays <= 120) return daily(spanDays);

    const keys = [];
    const labels = [];
    const cur = new Date(oldest);
    cur.setDate(1);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    while (cur <= end) {
      keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      labels.push(`${cur.getFullYear()}/${cur.getMonth() + 1}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return {
      keys,
      labels,
      keyOf: (t) => {
        const d = new Date(t);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      },
      unit: "月",
    };
  }

  // ── 集計 ─────────────────────────────────────────────

  /** 期間内/前期間の行に分ける(all は前期間なし) */
  function splitByPeriod(rows, periodMs) {
    const now = Date.now();
    if (!periodMs) return { current: rows.slice(), previous: null };
    const current = [];
    const previous = [];
    for (const r of rows) {
      const t = parseTime(r);
      if (t >= now - periodMs) current.push(r);
      else if (t >= now - 2 * periodMs) previous.push(r);
    }
    return { current, previous };
  }

  function uniqueUsers(rows) {
    const s = new Set();
    for (const r of rows) {
      const uid = String(r.actor_uid || "").trim();
      if (uid && uid !== GUEST_UID) s.add(uid);
    }
    return s.size;
  }

  function guestCount(rows) {
    let n = 0;
    for (const r of rows) if (String(r.actor_uid || "").trim() === GUEST_UID) n += 1;
    return n;
  }

  /** 前期間比: {text, dir} dir=1/0/-1、比較不能は null */
  function delta(cur, prev) {
    if (prev == null) return null;
    if (prev === 0) return cur > 0 ? { text: "+∞%", dir: 1 } : { text: "±0%", dir: 0 };
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct > 0) return { text: `+${pct}%`, dir: 1 };
    if (pct < 0) return { text: `${pct}%`, dir: -1 };
    return { text: "±0%", dir: 0 };
  }

  /** y軸の上限を切りのよい値へ(1,2,5×10^n) */
  function niceMax(v) {
    if (v <= 5) return Math.max(1, v);
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 5, 10]) {
      if (v <= m * pow) return m * pow;
    }
    return 10 * pow;
  }

  // ── 描画部品 ──────────────────────────────────────────

  function renderPeriodTabs(state, onChange) {
    const nav = el("div", "mz-dash-periods");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "集計期間");
    for (const [id, label] of PERIODS) {
      const b = el("button", "mz-dash-period-btn", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", state.period === id ? "true" : "false");
      b.addEventListener("click", () => {
        if (state.period === id) return;
        state.period = id;
        savePeriod(state.key, id);
        onChange();
      });
      nav.appendChild(b);
    }
    return nav;
  }

  function renderKpis(cur, prev, periodMs) {
    const wrap = el("div", "mz-dash-kpis");
    const days = periodMs ? periodMs / 86400e3 : 0;
    const avg = periodMs ? Math.round((cur.length / days) * 10) / 10 : null;
    const prevAvg = prev && periodMs ? Math.round((prev.length / days) * 10) / 10 : null;

    const cards = [
      ["fa-chart-line", "アクティビティ", cur.length, prev ? prev.length : null, "件"],
      ["fa-users", "アクティブユーザー", uniqueUsers(cur), prev ? uniqueUsers(prev) : null, "人"],
      ["fa-user", "ゲスト操作", guestCount(cur), prev ? guestCount(prev) : null, "件"],
      ["fa-gauge-high", "1日あたり", avg == null ? "—" : avg, prevAvg, "件"],
    ];

    for (const [icon, label, value, prevValue, unit] of cards) {
      const card = el("div", "mz-dash-kpi");
      const head = el("p", "mz-dash-kpi-label");
      head.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> `;
      head.appendChild(document.createTextNode(label));
      card.appendChild(head);

      const val = el("p", "mz-dash-kpi-value");
      val.appendChild(document.createTextNode(String(value)));
      val.appendChild(el("span", "mz-dash-kpi-unit", unit));
      card.appendChild(val);

      const d = typeof value === "number" && typeof prevValue === "number" ? delta(value, prevValue) : null;
      const cmp = el("p", "mz-dash-kpi-delta");
      if (d) {
        cmp.classList.add(d.dir > 0 ? "mz-dash-kpi-delta--up" : d.dir < 0 ? "mz-dash-kpi-delta--down" : "mz-dash-kpi-delta--flat");
        cmp.innerHTML =
          d.dir > 0
            ? '<i class="fa-solid fa-caret-up" aria-hidden="true"></i> '
            : d.dir < 0
              ? '<i class="fa-solid fa-caret-down" aria-hidden="true"></i> '
              : "";
        cmp.appendChild(document.createTextNode(`${d.text} 前期間比`));
      } else {
        cmp.classList.add("mz-dash-kpi-delta--flat");
        cmp.textContent = "前期間比 —";
      }
      card.appendChild(cmp);
      wrap.appendChild(card);
    }
    return wrap;
  }

  /** SVG 折れ線グラフ(タップ/ホバーで各点の値を上部に表示) */
  function renderChart(rows, periodId) {
    const card = el("div", "mz-dash-chart-card");

    const buckets = buildBuckets(periodId, rows.map(parseTime));
    const counts = new Array(buckets.keys.length).fill(0);
    const idxByKey = new Map(buckets.keys.map((k, i) => [k, i]));
    for (const r of rows) {
      const t = parseTime(r);
      if (!t) continue;
      const i = idxByKey.get(buckets.keyOf(t));
      if (i != null) counts[i] += 1;
    }

    const readout = el("p", "mz-dash-chart-readout");
    const total = counts.reduce((a, b) => a + b, 0);
    const defaultText = `合計 ${total} 件（${buckets.unit}別の推移・タップで各${buckets.unit}の値）`;
    readout.textContent = defaultText;
    card.appendChild(readout);

    const W = 720;
    const H = 230;
    const L = 44;
    const R = 12;
    const T = 14;
    const B = 30;
    const plotW = W - L - R;
    const plotH = H - T - B;
    const yMax = niceMax(Math.max(...counts, 1));
    const n = counts.length;
    const x = (i) => L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => T + plotH - (v / yMax) * plotH;

    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "mz-dash-chart",
      role: "img",
      "aria-label": `${buckets.unit}別のアクティビティ推移(合計${total}件)`,
    });

    // グラデーション定義
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = svgEl("linearGradient", { id: `mzDashGrad-${periodId}`, x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#be123c", "stop-opacity": "0.28" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#be123c", "stop-opacity": "0" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // 水平グリッド(0, 1/2, max)
    for (const gv of [0, yMax / 2, yMax]) {
      svg.appendChild(
        svgEl("line", {
          x1: String(L), y1: String(y(gv)), x2: String(W - R), y2: String(y(gv)),
          class: "mz-dash-chart-grid",
        }),
      );
      const lbl = svgEl("text", { x: String(L - 7), y: String(y(gv) + 4), class: "mz-dash-chart-ylabel", "text-anchor": "end" });
      lbl.textContent = Number.isInteger(gv) ? String(gv) : String(Math.round(gv * 10) / 10);
      svg.appendChild(lbl);
    }

    // エリア + 折れ線
    if (n > 0) {
      // エリアパス: 折れ線 → 右下 → 左下で閉じる
      const linePath = counts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
      const areaPath = `${linePath} L${x(n - 1)},${T + plotH} L${x(0)},${T + plotH} Z`;
      svg.appendChild(svgEl("path", { d: areaPath, fill: `url(#mzDashGrad-${periodId})`, stroke: "none" }));
      svg.appendChild(svgEl("path", { d: linePath, class: "mz-dash-chart-line", fill: "none" }));
      // 最新点
      svg.appendChild(svgEl("circle", { cx: String(x(n - 1)), cy: String(y(counts[n - 1])), r: "4", class: "mz-dash-chart-dot" }));
    }

    // x軸ラベル(最大5個)
    const tickIdx = new Set([0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor(((n - 1) * 3) / 4), n - 1]);
    for (const i of tickIdx) {
      if (i < 0 || i >= n) continue;
      const tx = svgEl("text", {
        x: String(x(i)), y: String(H - 8), class: "mz-dash-chart-xlabel",
        "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle",
      });
      tx.textContent = buckets.labels[i];
      svg.appendChild(tx);
    }

    // 選択カーソル(タップ帯)
    const cursor = svgEl("line", { x1: "0", y1: String(T), x2: "0", y2: String(T + plotH), class: "mz-dash-chart-cursor" });
    cursor.setAttribute("visibility", "hidden");
    svg.appendChild(cursor);
    const cursorDot = svgEl("circle", { cx: "0", cy: "0", r: "4.5", class: "mz-dash-chart-cursor-dot" });
    cursorDot.setAttribute("visibility", "hidden");
    svg.appendChild(cursorDot);

    const bandW = n > 1 ? plotW / (n - 1) : plotW;
    const select = (i) => {
      cursor.setAttribute("x1", String(x(i)));
      cursor.setAttribute("x2", String(x(i)));
      cursor.setAttribute("visibility", "visible");
      cursorDot.setAttribute("cx", String(x(i)));
      cursorDot.setAttribute("cy", String(y(counts[i])));
      cursorDot.setAttribute("visibility", "visible");
      readout.textContent = `${buckets.labels[i]}: ${counts[i]} 件`;
      readout.classList.add("mz-dash-chart-readout--active");
    };
    for (let i = 0; i < n; i += 1) {
      const band = svgEl("rect", {
        x: String(x(i) - bandW / 2), y: String(T), width: String(bandW), height: String(plotH),
        fill: "transparent",
      });
      band.addEventListener("click", () => select(i));
      band.addEventListener("mouseenter", () => select(i));
      svg.appendChild(band);
    }
    svg.addEventListener("mouseleave", () => {
      cursor.setAttribute("visibility", "hidden");
      cursorDot.setAttribute("visibility", "hidden");
      readout.textContent = defaultText;
      readout.classList.remove("mz-dash-chart-readout--active");
    });

    card.appendChild(svg);
    return card;
  }

  /** カテゴリ内訳(期間連動・件数バー+ユニーク人数) */
  function renderBreakdown(rows, categories, catOf) {
    const wrap = el("div", "mz-dash-cats");
    const head = el("p", "mz-dash-cats-head");
    head.innerHTML = '<i class="fa-solid fa-chart-column" aria-hidden="true"></i> ';
    head.appendChild(document.createTextNode("内訳（選択期間）"));
    wrap.appendChild(head);

    const per = new Map(categories.map(([id]) => [id, { count: 0, users: new Set(), guest: 0 }]));
    for (const r of rows) {
      const p = per.get(catOf(r));
      if (!p) continue;
      p.count += 1;
      const uid = String(r.actor_uid || "").trim();
      if (uid === GUEST_UID) p.guest += 1;
      else if (uid) p.users.add(uid);
    }

    const items = categories
      .map(([id, label, icon]) => ({ id, label, icon, ...(() => { const p = per.get(id); return { count: p.count, users: p.users.size, guest: p.guest }; })() }))
      .sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...items.map((i) => i.count));

    for (const it of items) {
      const row = el("div", "mz-dash-cat-row" + (it.count === 0 ? " mz-dash-cat-row--zero" : ""));

      const name = el("div", "mz-dash-cat-name");
      name.innerHTML = `<i class="fa-solid ${it.icon}" aria-hidden="true"></i>`;
      name.appendChild(el("span", "", it.label));
      row.appendChild(name);

      const barWrap = el("div", "mz-dash-cat-barwrap");
      const bar = el("div", "mz-dash-cat-bar");
      bar.style.width = `${Math.round((it.count / maxCount) * 100)}%`;
      barWrap.appendChild(bar);
      row.appendChild(barWrap);

      const num = el("div", "mz-dash-cat-num");
      num.appendChild(el("span", "mz-dash-cat-count", String(it.count)));
      const subParts = [];
      if (it.users) subParts.push(`登録者 ${it.users}人`);
      if (it.guest) subParts.push(`ゲスト ${it.guest}`);
      num.appendChild(el("span", "mz-dash-cat-sub", subParts.join("・") || "—"));
      row.appendChild(num);

      wrap.appendChild(row);
    }
    return wrap;
  }

  // ── 本体 ─────────────────────────────────────────────

  /**
   * @param {HTMLElement} host
   * @param {Record<string, unknown>[]} rows フィード行(降順・直近2000件)
   * @param {{ key: string, categories: [string, string, string][], catOf: (r: Record<string, unknown>) => string }} opts
   */
  function render(host, rows, opts) {
    if (!(host instanceof HTMLElement)) return;
    // 同一データでの再呼び出しは再構築しない(kindタブ往復でのチラつき防止)
    if (host.__mzDashRows === rows && host.childElementCount > 0) return;
    host.__mzDashRows = rows;

    const state = { key: opts.key, period: loadPeriod(opts.key) };

    const draw = () => {
      host.replaceChildren();

      const tabs = renderPeriodTabs(state, draw);
      host.appendChild(tabs);

      if (!rows.length) {
        host.appendChild(el("p", "mz-dash-empty", "まだ記録がありません。"));
        return;
      }

      const periodMs = PERIODS.find(([id]) => id === state.period)?.[2] || 0;
      const { current, previous } = splitByPeriod(rows, periodMs);

      host.appendChild(renderKpis(current, previous, periodMs));
      host.appendChild(renderChart(current, state.period));
      host.appendChild(renderBreakdown(current, opts.categories, opts.catOf));

      const note = el("p", "mz-dash-note");
      note.textContent =
        "集計対象は直近2000件の記録です（それより古い分は「すべて」にも含まれません）。前期間比は同じ長さの直前期間との比較です。";
      host.appendChild(note);
    };

    draw();
  }

  window.MarchinZAdminDash = { render };
})();
