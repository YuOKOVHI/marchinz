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
      b.appendChild(h("span", "mzj-label", p.label));
      b.onclick = () => {
        const sel = conf.canSelect ? conf.canSelect(p.id)
          : (done.has(p.id) || p.id === cur);
        if (sel && conf.onSelect) conf.onSelect(p.id);
      };
      track.appendChild(b);
    });
    root.appendChild(track);
    const act = h("div", "mzj-activity");
    actDot = h("span", "mzj-pulse");
    actText = h("span", "mzj-activity-text");
    act.appendChild(actDot);
    act.appendChild(actText);
    root.appendChild(act);
    conf.container.insertBefore(root, conf.container.firstChild);
  }

  function apply() {
    if (!root) return;
    root.querySelectorAll(".mzj-phase").forEach(b => {
      const id = b.dataset.id;
      b.classList.toggle("current", id === cur);
      b.classList.toggle("done", done.has(id) && id !== cur);
      const sel = conf.canSelect ? conf.canSelect(id) : (done.has(id) || id === cur);
      b.disabled = !sel;
      b.setAttribute("aria-current", id === cur ? "step" : "false");
    });
    refreshActivity();
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
      watchTm = setInterval(() => { refreshAuto(); refreshActivity(); }, 400);  // 状態+MZP進捗のライブ反映
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
