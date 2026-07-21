"use strict";
/* ============ カット切替モード(全画面) ============
   スマホでカットのカメラをまとめて確認・変更するための全画面ビュー。
   タイムラインの帯は375pxでは細かすぎるため、
   「大きなプレビュー + 前/次ナビ + カット一覧(実フレームのサムネ)」で
   1カットずつ確実に切り替えられるようにする(2026-07-21 優さん指示)。

   - プレビューは既存の #cv(描画ループごと)をモーダル内へ移動して使う。
     canvasを2枚にすると描画が二重になりiPhoneの電池を食うため
   - カメラ変更は1タップで確定(このモードは切替が目的なので、
     タイムライン側の「2タップ確定」とは役割が違う)
   - サムネは各カットの開始時点の実フレーム。<video>のseekで直列生成し、
     一気に並列siekしない(iPhoneのデコーダ制限) */

MC.cutmode = { open: false, _thumbs: new Map(), _genQ: null, _cur: 0 };

/* ---------- 開閉 ---------- */
MC.cutmode.openModal = () => {
  if (!MC.S.cutList.length) return;
  MC.cutmode.open = true;
  MC.preview.pause();
  const modal = MC.ui.$("#cutModal");
  modal.hidden = false;
  document.documentElement.style.overflow = "hidden";
  // プレビューを連れてくる(描画ループはそのまま動き続ける)
  MC.ui.$("#cmStage").appendChild(MC.ui.$(".canvas-holder"));
  document.body.classList.add("cutmode-open");
  MC.cutmode._cur = MC.timeline.currentIndex();
  if (MC.cutmode._cur < 0) MC.cutmode._cur = 0;
  MC.cutmode.gotoCut(MC.cutmode._cur);
  MC.cutmode.renderList();
  MC.cutmode.genThumbs();
};

MC.cutmode.close = () => {
  MC.cutmode.open = false;
  const modal = MC.ui.$("#cutModal");
  modal.hidden = true;
  document.documentElement.style.overflow = "";
  document.body.classList.remove("cutmode-open");
  // プレビューを元の場所(.stage の先頭)へ返す
  const stage = document.querySelector(".stage");
  stage.insertBefore(MC.ui.$(".canvas-holder"), stage.firstChild);
};

/* ---------- カット移動 ---------- */
MC.cutmode.cutRange = i => {
  const cl = MC.S.cutList;
  const start = cl[i].t;
  const end = i + 1 < cl.length ? cl[i + 1].t : MC.trimRange()[1];
  return [start, end];
};

MC.cutmode.gotoCut = i => {
  const cl = MC.S.cutList;
  if (!cl.length) return;
  i = Math.max(0, Math.min(cl.length - 1, i));
  MC.cutmode._cur = i;
  const [start] = MC.cutmode.cutRange(i);
  MC.preview.seek(Math.min(start + 0.05, MC.trimRange()[1]));
  MC.cutmode.renderCurrent();
  MC.cutmode.highlightList();
};

/* ---------- 表示 ---------- */
MC.cutmode.renderCurrent = () => {
  const cl = MC.S.cutList;
  const i = MC.cutmode._cur;
  const e = cl[i];
  if (!e) return;
  const [start, end] = MC.cutmode.cutRange(i);
  MC.ui.$("#cmCounter").textContent = `カット ${i + 1} / ${cl.length}`;
  MC.ui.$("#cmTime").textContent = `${MC.ui.fmtTime(start)} 〜 ${MC.ui.fmtTime(end)}`;
  MC.ui.$("#cmPrev").disabled = i === 0;
  MC.ui.$("#cmNext").disabled = i === cl.length - 1;

  /* カメラ選択(1タップ確定)。どれが今のカメラかを色と✓で見せる */
  const box = MC.ui.$("#cmCams");
  box.innerHTML = "";
  MC.S.clips.filter(c => !c.isAudio && !c.isImage).forEach((c, ci) => {
    const b = document.createElement("button");
    const on = c.id === e.clipId;
    b.type = "button";
    b.className = "cm-cam" + (on ? " on" : "");
    b.style.setProperty("--cam", MC.timeline.color(c.id));
    b.innerHTML = `<span class="cm-cam-no">C${ci + 1}</span>`
      + `<span class="cm-cam-name">${MC.ui.esc(MC.timeline.shortName(c.name))}</span>`
      + (on ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : "");
    b.onclick = () => {
      if (on) return;
      e.clipId = c.id;
      MC.saveState();
      MC.timeline.render();
      MC.preview.draw();
      MC.cutmode.renderCurrent();
      MC.cutmode.invalidateThumb(i);
    };
    box.appendChild(b);
  });
};

MC.cutmode.renderList = () => {
  const host = MC.ui.$("#cmList");
  const cl = MC.S.cutList;
  host.innerHTML = cl.map((e, i) => {
    const key = MC.cutmode.thumbKey(i);
    const url = MC.cutmode._thumbs.get(key);
    return `<button type="button" class="cm-item" data-cm-cut="${i}"
      style="--cam:${MC.timeline.color(e.clipId)}">
      ${url ? `<img src="${url}" alt="">` : '<span class="cm-item-ph"></span>'}
      <span class="cm-item-no">${i + 1}</span>
    </button>`;
  }).join("");
  host.querySelectorAll("[data-cm-cut]").forEach(el => {
    el.onclick = () => MC.cutmode.gotoCut(Number(el.getAttribute("data-cm-cut")));
  });
  MC.cutmode.highlightList();
};

MC.cutmode.highlightList = () => {
  const host = MC.ui.$("#cmList");
  host.querySelectorAll(".cm-item").forEach((el, i) => {
    el.classList.toggle("on", i === MC.cutmode._cur);
  });
  const cur = host.querySelector(".cm-item.on");
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
};

/* ---------- サムネ(実フレーム・直列生成) ---------- */
/* キーはカット番号+カメラ+時刻。カメラを変えたらそのカットだけ作り直す */
MC.cutmode.thumbKey = i => {
  const e = MC.S.cutList[i];
  return e ? `${i}|${e.clipId}|${e.t.toFixed(2)}` : String(i);
};

MC.cutmode.invalidateThumb = i => {
  // 古いキーは残っていても参照されないだけなので消さない(単純さ優先)
  MC.cutmode.genThumbs();
};

MC.cutmode.genThumbs = () => {
  /* 直列キュー: 前の生成が終わってから次へ。開いている間だけ進める */
  MC.cutmode._genQ = (MC.cutmode._genQ || Promise.resolve()).then(async () => {
    const cl = MC.S.cutList;
    for (let i = 0; i < cl.length; i++) {
      if (!MC.cutmode.open) return;
      const key = MC.cutmode.thumbKey(i);
      if (MC.cutmode._thumbs.has(key)) continue;
      const url = await MC.cutmode.makeThumb(i).catch(() => null);
      if (url) {
        MC.cutmode._thumbs.set(key, url);
        const el = MC.ui.$(`#cmList [data-cm-cut="${i}"]`);
        if (el) {
          const ph = el.querySelector(".cm-item-ph");
          if (ph) {
            const img = document.createElement("img");
            img.src = url;
            ph.replaceWith(img);
          }
        }
      }
    }
  }).catch(() => {});
};

MC.cutmode.makeThumb = async i => {
  const e = MC.S.cutList[i];
  const clip = MC.getClip(e.clipId);
  if (!clip || !clip.video || clip.isImage) return null;
  const v = clip.video;
  const local = Math.max(0, Math.min(clip.duration - 0.05, e.t + 0.05 - clip.offset));
  if (local < 0) return null;
  /* 再生中のseekは画面が乱れるため、このモードでは常に停止している前提。
     万一再生されていたら生成を諦める(壊すよりまし) */
  if (MC.S.playing) return null;
  await new Promise(res => {
    const done = () => { clearTimeout(tm); v.removeEventListener("seeked", done); res(); };
    const tm = setTimeout(done, 1800);
    v.addEventListener("seeked", done, { once: true });
    v.currentTime = local;
  });
  const cv = document.createElement("canvas");
  cv.width = 168; cv.height = 94;
  const s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
  cv.getContext("2d").drawImage(v,
    (cv.width - v.videoWidth * s) / 2, (cv.height - v.videoHeight * s) / 2,
    v.videoWidth * s, v.videoHeight * s);
  return cv.toDataURL("image/jpeg", 0.6);
};

/* ---------- 結線 ---------- */
MC.cutmode.init = () => {
  const btn = MC.ui.$("#cutModeBtn");
  if (btn) btn.onclick = MC.cutmode.openModal;
  MC.ui.$("#cmClose").onclick = MC.cutmode.close;
  MC.ui.$("#cmPrev").onclick = () => MC.cutmode.gotoCut(MC.cutmode._cur - 1);
  MC.ui.$("#cmNext").onclick = () => MC.cutmode.gotoCut(MC.cutmode._cur + 1);
  MC.ui.$("#cmPlay").onclick = () => {
    /* このカットだけ再生して確かめる(終端で自動停止) */
    const [start, end] = MC.cutmode.cutRange(MC.cutmode._cur);
    MC.preview.seek(start);
    MC.preview.play();
    clearInterval(MC.cutmode._playIv);
    MC.cutmode._playIv = setInterval(() => {
      if (!MC.S.playing || MC.S.t >= end) {
        clearInterval(MC.cutmode._playIv);
        MC.preview.pause();
      }
    }, 100);
  };
  document.addEventListener("keydown", e => {
    if (!MC.cutmode.open) return;
    if (e.key === "Escape") MC.cutmode.close();
    if (e.key === "ArrowLeft") MC.cutmode.gotoCut(MC.cutmode._cur - 1);
    if (e.key === "ArrowRight") MC.cutmode.gotoCut(MC.cutmode._cur + 1);
  });
};
