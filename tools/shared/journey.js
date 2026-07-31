"use strict";
/* ============ クリエイターツール共通: ジャーニーバー ============
   「どんなフェーズがあるのか / 今どのフェーズか / 今何の作業中か」を
   1本のすりガラスバーで常に見せる。3ツール(Switcher/Privacy/ReAngle)共通。

   使い方:
     MZJourney.init({
       phases: [{ id, label, hint }],   // hint = そのフェーズで次にすること(アイドル時に表示)
       container: HTMLElement,           // この中の先頭へ挿入(sticky)
       onSelect(id),                     // フェーズタップ(省略可)
       canSelect(id) => bool,            // タップ可否(省略可、既定=完了済みのみ)
     });
     MZJourney.set(currentId, doneIds);  // 現在フェーズと完了フェーズを更新

   「今何の作業中か」は MZP(progress.js)の現在の進捗を自動で映す。
   進捗が無いときは現在フェーズの hint を出す(次の一手が常に見える導線)。 */

window.MZJourney = (() => {
  let conf = null, root = null, actText = null, actDot = null;
  let cur = null, done = new Set();
  let watchTm = 0;

  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }

  function render() {
    root = h("nav", "mzj");
    root.setAttribute("aria-label", "作業のながれ");
    const track = h("div", "mzj-track");
    conf.phases.forEach((p, i) => {
      if (i) track.appendChild(h("span", "mzj-link"));
      const b = h("button", "mzj-phase");
      b.type = "button";
      b.dataset.id = p.id;
      b.appendChild(h("span", "mzj-dot",
        `<span class="mzj-num">${i + 1}</span><i class="fa-solid fa-check mzj-check" aria-hidden="true"></i>`));
      /* 現在地は正式名、それ以外は短縮名(狭幅で並べきるため)。
         shortLabel が無ければ label をそのまま使う */
      const lab = h("span", "mzj-label", p.label);
      lab.dataset.full = p.label;
      lab.dataset.short = p.shortLabel || p.label;
      b.appendChild(lab);
      b.onclick = () => {
        const sel = conf.canSelect ? conf.canSelect(p.id)
          : (done.has(p.id) || p.id === cur);
        if (sel && conf.onSelect) conf.onSelect(p.id);
      };
      track.appendChild(b);
    });
    root.appendChild(track);
    /* 活動テキストの行は廃止(2026-07-31 優さん指示)。
       いま何をしているかは画面の下（行動バー・進捗ドック）に出ており、
       上にも同じことを書くと画面の上下で同じ文を2度読ませることになる。
       1行ぶん(実測46px)を返して、プレビューをそのぶん上へ。
       setActivity/refreshActivity は呼び出し側の都合で残し、要素が無ければ
       黙って何もしない(他ツールが同じ journey.js を使っている) */
    conf.container.insertBefore(root, conf.container.firstChild);
  }

  /* バーの実際の高さを CSS 変数へ。フロートするプレビュー等が
     「バーの真下」に着けるようにするため(2026-07-21 実機でプレビューが
     バーの下へ潜り込んで見えなくなっていた) */
  function syncHeight() {
    if (!root) return;
    const hpx = Math.round(root.getBoundingClientRect().height);
    if (hpx > 0) document.documentElement.style.setProperty("--mz-journey-h", hpx + "px");
  }

  function apply() {
    if (!root) return;
    syncHeight();
    root.querySelectorAll(".mzj-phase").forEach(b => {
      const id = b.dataset.id;
      b.classList.toggle("current", id === cur);
      b.classList.toggle("done", done.has(id) && id !== cur);
      const lab = b.querySelector(".mzj-label");
      if (lab) {
        const want = id === cur ? lab.dataset.full : lab.dataset.short;
        if (lab.textContent !== want) lab.textContent = want;
      }
      const sel = conf.canSelect ? conf.canSelect(id) : (done.has(id) || id === cur);
      b.disabled = !sel;
      b.setAttribute("aria-current", id === cur ? "step" : "false");
    });
    centerCurrent();
    refreshActivity();
  }

  /* 工程が増えると狭い画面(375px)では並べきれない。工程名を削るより
     横スクロールにして、現在地を必ず真ん中へ寄せる(2026-07-31)。
     Switcherが7工程になった時点で実測36px溢れ、左端の「動画」が切れ、
     右端の「書出」は名前ごと画面外に出ていた。
     scrollIntoView は sticky バーの外側(ページ)まで動かしうるので、
     scrollLeft を自分で計算する */
  function centerCurrent() {
    const track = root && root.querySelector(".mzj-track");
    if (!track) return;
    const el = track.querySelector(".mzj-phase.current");
    if (!el) return;
    const over = track.scrollWidth - track.clientWidth;
    if (over <= 1) return;                       // 収まっている=動かさない
    const want = el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2;
    const next = Math.max(0, Math.min(over, want));
    if (Math.abs(track.scrollLeft - next) < 2) return;
    /* 必ず behavior:"instant" で。smooth にすると(CSSの scroll-behavior 経由でも)
       工程が続けて変わったとき前のアニメーションが途中で捨てられ、
       **どこへも着かない**まま終わる ─ 正しい left を渡しているのに
       scrollLeft が 0 のままになる現象を実測で確認した */
    try { track.scrollTo({ left: next, behavior: "instant" }); }
    catch (e) { track.scrollLeft = next; }
  }

  /* MZPの現在の進捗を映す。無ければ現在フェーズのヒント */
  function refreshActivity() {
    if (!root) return;
    const p = window.MZP && MZP.current;
    const running = p && !p.closed && (p.state === "run" || p.state === "pulse" || p.state === "frozen");
    if (running) {
      const sub = p.sub ? `　${p.sub}` : "";
      setActivity((p.label || "処理中…") + sub, "busy");
      return;
    }
    const ph = conf.phases.find(x => x.id === cur);
    const allDone = conf.phases.every(x => done.has(x.id));
    if (allDone && conf.doneHint) setActivity(conf.doneHint, "ok");
    else if (ph && ph.hint) setActivity(ph.hint, "idle");
    else setActivity("", "idle");
  }

  let lastMsg = "", lastMode = "";
  function setActivity(msg, mode) {
    if (!actText) return;                     // 活動テキストの行は廃止済み
    if (msg === lastMsg && mode === lastMode) return;
    lastMsg = msg; lastMode = mode;
    actText.textContent = msg;
    root.classList.toggle("busy", mode === "busy");
    root.classList.toggle("alldone", mode === "ok");
    root.querySelector(".mzj-activity").style.display = msg ? "" : "none";
  }

  /* conf.autoState() が返す {current, done[]} を反映(変化があったときだけ) */
  function refreshAuto() {
    if (!conf || !conf.autoState) return;
    const st = conf.autoState();
    if (!st) return;
    const ds = new Set(st.done || []);
    const changed = st.current !== cur || ds.size !== done.size ||
      [...ds].some(x => !done.has(x));
    if (changed) { cur = st.current; done = ds; apply(); }
  }

  return {
    init(o) {
      conf = o;
      render();
      refreshAuto();
      apply();
      clearInterval(watchTm);
      // 状態+MZP進捗のライブ反映。活動テキストの行数でバーの高さが変わるので
      // 高さの同期もここで行う(プレビューの位置がずれないように)
      watchTm = setInterval(() => { refreshAuto(); refreshActivity(); syncHeight(); }, 400);
    },
    set(currentId, doneIds) {
      cur = currentId;
      done = new Set(doneIds || []);
      apply();
    },
    refresh: () => { refreshAuto(); },   // 遷移直後の即時反映用(ポーリングを待たない)
    get current() { return cur; },
  };
})();
