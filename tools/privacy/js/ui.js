"use strict";
/* ============ UI配線 ============ */

MZ.ui = {};
const $ = id => document.getElementById(id);

MZ.ui.toast = msg => {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(MZ.ui._toastTm);
  MZ.ui._toastTm = setTimeout(() => el.classList.remove("show"), 4000);
};

MZ.ui.fmtTime = s => {
  s = Math.max(0, s || 0);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

MZ.ui.setStatus = (txt, ready) => {
  const el = $("statusPill");
  el.textContent = txt;
  el.classList.toggle("ready", !!ready);
};

MZ.ui.fmtSize = bytes =>
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1e3))}KB`;

MZ.ui.isImageFile = f =>
  /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name);
MZ.ui.isVideoFile = f =>
  /video|quicktime/.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);

MZ.ui.disposeClip = () => {
  MZ.preview.stop();
  // 複数写真ぶんをまとめて破棄
  for (const p of (MZ.S.photos || [])) {
    if (p.img && p.img.close) { try { p.img.close(); } catch (e) {} }
    if (p.url) URL.revokeObjectURL(p.url);
  }
  MZ.S.photos = [];
  MZ.S.photoIdx = 0;
  const c = MZ.S.clip;
  if (c) {
    if (c.video) { try { c.video.pause(); } catch (e) {} c.video.remove(); }
    if (c.img && c.img.close && !(MZ.S.photos || []).includes(c)) { try { c.img.close(); } catch (e) {} }
    if (c.url) URL.revokeObjectURL(c.url);
  }
  MZ.S.clip = null;
  MZ.S.manualBoxes = [];
  MZ.S.suppressedBoxes = [];
};

MZ.ui._enterEditor = (name, kind) => {
  document.body.dataset.kind = kind;
  $("dropSection").hidden = true;
  $("editorSection").hidden = false;
  $("doneCard").hidden = true;
  $("clipName").textContent = name;
  $("exportBtn").textContent = kind === "image"
    ? "モザイクをかけて画像を保存" : "モザイクをかけて動画を保存";
  MZ.ui.setStep(1);
};

/* ---- 範囲選択フェーズ(60秒超・インスタ風トリム) ---- */
MZ.ui.enterRangePhase = () => {
  const clip = MZ.S.clip;
  document.body.dataset.kind = "video";
  $("dropSection").hidden = true;
  $("editorSection").hidden = true;
  $("rangeSection").hidden = false;
  MZ.S.rangeStart = 0;
  MZ.S.rangeDur = Math.min(15, clip.duration);   // 初期は15秒ぶん
  // 範囲プレビューのキャンバスをクリップ比率に
  const cv = $("rangeCanvas");
  const s = Math.min(1, 640 / Math.max(clip.width, clip.height));
  cv.width = Math.max(2, Math.round(clip.width * s));
  cv.height = Math.max(2, Math.round(clip.height * s));
  MZ.ui._updateRangeUi(false);
  void MZ.ui._buildStrip();   // フィルムストリップ生成(完了後に選択フレーム表示)
};

/* ラベルと選択窓を現在の範囲に合わせて描き直す。seekVideo=大プレビューのフレームも更新 */
MZ.ui._updateRangeUi = (seekVideo, whichEnd) => {
  const clip = MZ.S.clip;
  if (!clip) return;
  const end = MZ.rangeEnd();
  $("rangeLabel").textContent =
    `${MZ.ui.fmtTime(MZ.S.rangeStart)} 〜 ${MZ.ui.fmtTime(end)}（${Math.round(end - MZ.S.rangeStart)}秒）`;
  // 選択窓とシェードの位置(%)
  const l = (MZ.S.rangeStart / clip.duration) * 100;
  const w = ((end - MZ.S.rangeStart) / clip.duration) * 100;
  $("trimWindow").style.left = `${l}%`;
  $("trimWindow").style.width = `${w}%`;
  $("trimShadeL").style.left = "0";
  $("trimShadeL").style.width = `${l}%`;
  $("trimShadeR").style.left = `${l + w}%`;
  $("trimShadeR").style.width = `${Math.max(0, 100 - l - w)}%`;
  if (seekVideo) MZ.ui._requestFrame(whichEnd === "r" ? end : MZ.S.rangeStart);
};

/* 大プレビューへのフレーム表示要求(常に最新の要求だけを実行) */
MZ.ui._requestFrame = t => {
  MZ.ui._framePending = t;
  if (MZ.ui._frameBusy || MZ.ui._stripBusy) return;
  MZ.ui._frameBusy = true;
  const v = MZ.S.clip.video;
  const step = () => {
    const want = MZ.ui._framePending;
    MZ.ui._framePending = null;
    v.onseeked = () => {
      const cv = $("rangeCanvas");
      MZ.drawFrame(cv.getContext("2d"), v, v.videoWidth, v.videoHeight, 0, cv.width, cv.height);
      if (MZ.ui._framePending != null) step();
      else { v.onseeked = null; MZ.ui._frameBusy = false; }
    };
    v.currentTime = want;
  };
  step();
};

/* フィルムストリップ: 動画から10コマを等間隔で抜き出して並べる(インスタ風) */
MZ.ui._buildStrip = async () => {
  const clip = MZ.S.clip;
  const strip = $("stripCanvas");
  const host = $("trimStrip");
  const N = 10;
  const gen = (MZ.ui._stripGen = (MZ.ui._stripGen || 0) + 1);
  MZ.ui._stripBusy = true;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(2, Math.round(host.clientWidth * dpr));
  const ch = Math.max(2, Math.round(host.clientHeight * dpr));
  strip.width = cw; strip.height = ch;
  const ctx = strip.getContext("2d");
  ctx.fillStyle = "#1a2029";
  ctx.fillRect(0, 0, cw, ch);
  const v = clip.video;
  const tileW = cw / N;
  try {
    for (let i = 0; i < N; i++) {
      if (gen !== MZ.ui._stripGen || !MZ.S.clip) return;   // 中断(別素材へ)
      const t = clip.duration * (i + 0.5) / N;
      await new Promise(res => {
        v.onseeked = () => { v.onseeked = null; res(); };
        v.currentTime = t;
        setTimeout(res, 1200);   // シークが返らない環境への保険
      });
      if (gen !== MZ.ui._stripGen || !MZ.S.clip) return;
      // コマをカバー配置(縦を合わせて中央を切り出し)
      const vw = v.videoWidth, vh = v.videoHeight;
      const scale = ch / vh;
      const sw = Math.min(vw, tileW / scale);
      ctx.drawImage(v, (vw - sw) / 2, 0, sw, vh, i * tileW, 0, tileW, ch);
    }
  } finally {
    if (gen === MZ.ui._stripGen) {
      MZ.ui._stripBusy = false;
      // 生成完了後、選択位置のフレームを大プレビューへ
      if (MZ.S.clip) MZ.ui._requestFrame(MZ.ui._framePending != null ? MZ.ui._framePending : MZ.S.rangeStart);
    }
  }
};

/* 選択窓のドラッグ(インスタ同様: 左右の取っ手で伸縮・枠の中で移動・外側タップでジャンプ) */
MZ.ui._wireTrim = () => {
  const host = $("trimStrip");
  const MIN = 10, MAX = 60;
  let mode = null, x0 = 0, s0 = 0, d0 = 0;
  host.addEventListener("pointerdown", e => {
    const clip = MZ.S.clip;
    if (!clip) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const handle = e.target.closest("[data-trim]");
    const end = MZ.rangeEnd();
    if (handle) {
      mode = handle.dataset.trim;   // "l" | "r"
    } else {
      const inWin = frac * clip.duration >= MZ.S.rangeStart && frac * clip.duration <= end;
      if (!inWin) {
        // 窓の外タップ: 窓の中心をそこへジャンプ(インスタと同じ)
        MZ.S.rangeStart = Math.max(0, Math.min(clip.duration - MZ.S.rangeDur,
          frac * clip.duration - MZ.S.rangeDur / 2));
      }
      mode = "move";
    }
    x0 = e.clientX; s0 = MZ.S.rangeStart; d0 = MZ.S.rangeDur;
    host.setPointerCapture(e.pointerId);
    MZ.ui._updateRangeUi(true, mode === "r" ? "r" : "l");
    e.preventDefault();
  });
  host.addEventListener("pointermove", e => {
    const clip = MZ.S.clip;
    if (!mode || !clip) return;
    const rect = host.getBoundingClientRect();
    const dt = (e.clientX - x0) / rect.width * clip.duration;
    if (mode === "move") {
      MZ.S.rangeStart = Math.max(0, Math.min(clip.duration - d0, s0 + dt));
    } else if (mode === "l") {
      const end = s0 + d0;   // 右端は固定
      const ns = Math.max(Math.max(0, end - MAX), Math.min(end - MIN, s0 + dt));
      MZ.S.rangeStart = ns;
      MZ.S.rangeDur = end - ns;
    } else {   // "r": 左端は固定
      const ne = Math.max(s0 + MIN, Math.min(Math.min(clip.duration, s0 + MAX), s0 + d0 + dt));
      MZ.S.rangeDur = ne - s0;
    }
    MZ.ui._updateRangeUi(true, mode === "r" ? "r" : "l");
    e.preventDefault();
  });
  const up = e => {
    if (!mode) return;
    mode = null;
    try { host.releasePointerCapture(e.pointerId); } catch (err) {}
    MZ.ui._updateRangeUi(true, "l");   // 離したら開始位置のフレームへ戻す
  };
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
};

/* 範囲確定→エディタへ(シークバーを範囲にマッピング) */
MZ.ui.enterEditorWithRange = () => {
  const clip = MZ.S.clip;
  // サムネ生成が走っていたら中断(プレビューとシーク位置を取り合わないように)
  MZ.ui._stripGen = (MZ.ui._stripGen || 0) + 1;
  MZ.ui._stripBusy = false;
  MZ.ui._frameBusy = false;
  MZ.ui._framePending = null;
  clip.video.onseeked = null;
  $("rangeSection").hidden = true;
  MZ.ui._enterEditor(clip.name, "video");
  const end = MZ.rangeEnd();
  $("seekBar").min = String(MZ.S.rangeStart);
  $("seekBar").max = String(end);
  $("seekBar").value = String(MZ.S.rangeStart);
  clip.video.currentTime = MZ.S.rangeStart;
  $("reRangeBtn").hidden = clip.duration <= 60;
  MZ.preview.setClip(clip);
  MZ.ui.updateTime();
};

/* ---- ステップウィザード(1:確認 / 2:調整 / 3:保存) ---- */
MZ.ui.setStep = n => {
  n = Math.max(1, Math.min(3, n | 0));
  MZ.S.step = n;
  document.querySelectorAll("#stepper [data-step]").forEach(b => {
    const bn = parseInt(b.dataset.step, 10);
    b.classList.toggle("on", bn === n);
    b.classList.toggle("done", bn < n);
  });
  $("panelStep1").hidden = n !== 1;
  $("panelStep2").hidden = n !== 2;
  $("panelStep3").hidden = n !== 3;
};

/* ①ステップの検出状態カード(モデル準備 → 現在の検出人数をライブ表示) */
MZ.ui.updateDetectStatus = () => {
  const el = $("detectStatus");
  if (!el || !MZ.S.clip) return;
  el.classList.remove("ok", "ng", "busy");
  if (!MZ.detect.detector) {
    el.classList.add("busy");
    el.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 顔検出AIを準備しています…';
    return;
  }
  if (MZ.preview.initRunning) {
    el.classList.add("busy");
    el.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> 小さな顔までていねいに探しています… ${Math.round((MZ.preview.initProgress || 0) * 100)}%`;
    return;
  }
  const n = (MZ.preview.boxes || []).length;
  if (n > 0) {
    el.classList.add("ok");
    el.innerHTML = `<i class="fa-solid fa-circle-check"></i> いまの画面で ${n} 人の顔にモザイクをかけています。`;
  } else {
    el.classList.add("ng");
    el.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> いまの画面では顔が見つかっていません。顔が映る位置に再生・シークして確認してください。';
  }
};

/* ---- プレビューのタップでマスクを追加/削除 ----
   ①手動マスク・自動検出マスクの上 → そのマスクを外す(もう一度タップで戻せる)
   ②タップ周辺を高倍率で顔検出 → 見つかれば追跡マスクとして追加
   ③見つからなければ、その場所に固定マスクを追加(検出ボックスの平均サイズ) */
MZ.ui.onCanvasTap = e => {
  const clip = MZ.S.clip;
  if (!clip || MZ.exporter.running) return;
  const cv = $("previewCanvas");
  const r = cv.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width;
  const ny = (e.clientY - r.top) / r.height;
  if (!isFinite(nx) || !isFinite(ny) || nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

  // ① 手動マスクのトグル削除
  const hit = MZ.S.manualBoxes.findIndex(b =>
    nx > b.x - b.w * 0.2 && nx < b.x + b.w * 1.2 && ny > b.y - b.h * 0.2 && ny < b.y + b.h * 1.2);
  if (hit >= 0) {
    MZ.S.manualBoxes.splice(hit, 1);
    MZ.ui.toast("タップしたマスクを外しました");
    return;
  }
  // 自動検出のマスクもタップで外せる(誤検出をその場で取り除ける)。場所は抑制リストへ
  const cands = (MZ.preview.boxes || []).filter(b =>
    nx > b.x - b.w * 0.25 && nx < b.x + b.w * 1.25 &&
    ny > b.y - b.h * 0.25 && ny < b.y + b.h * 1.25);
  if (cands.length) {
    const hitA = cands.sort((a, b) =>
      Math.hypot(a.x + a.w / 2 - nx, a.y + a.h / 2 - ny)
      - Math.hypot(b.x + b.w / 2 - nx, b.y + b.h / 2 - ny))[0];
    MZ.S.suppressedBoxes.push({ x: hitA.x, y: hitA.y, w: hitA.w, h: hitA.h });
    if (hitA.id != null) MZ.preview.tracker.tracks =
      MZ.preview.tracker.tracks.filter(tr => tr.id !== hitA.id);
    MZ.preview.boxes = MZ.preview.boxes.filter(b => b !== hitA);
    MZ.ui.toast("このマスクを外しました(同じ場所をタップすると戻せます)");
    return;
  }
  // 以前ここで外したマスクがあれば抑制を解除(もう一度タップ=戻す)
  MZ.S.suppressedBoxes = MZ.S.suppressedBoxes.filter(s =>
    !(nx > s.x - s.w * 0.3 && nx < s.x + s.w * 1.3 &&
      ny > s.y - s.h * 0.3 && ny < s.y + s.h * 1.3));

  // ② 周辺を高倍率で検出
  const src = clip.kind === "image" ? clip.img : clip.video;
  const rw = clip.kind === "image" ? clip.width : clip.video.videoWidth;
  const rh = clip.kind === "image" ? clip.height : clip.video.videoHeight;
  let found = null;
  try { found = MZ.detect.probeAt(src, rw, rh, 0, nx, ny); } catch (err) { MZ.log("probeAt:", err.message); }
  if (found) {
    if (clip.kind === "image") {
      MZ.preview.boxes.push(found);
    } else {
      // 追跡トラックとして追加(以後は行進の動きにも追従)
      MZ.preview.tracker.tracks.push({
        id: MZ.preview.tracker.nextId++,
        box: { x: found.x, y: found.y, w: found.w, h: found.h },
        vx: 0, vy: 0, lastT: clip.video.currentTime, lastSeen: clip.video.currentTime,
        matched: true, matchedRecently: true,
      });
    }
    MZ.ui.toast("顔を見つけてマスクを追加しました");
    return;
  }
  // ③ 固定マスク(近くの検出サイズに合わせる。無ければ画面幅5%)
  const ref = (MZ.preview.boxes || [])[0];
  const w = ref ? ref.w : 0.05;
  const h = ref ? ref.h : 0.05 * (cv.width / cv.height);
  MZ.S.manualBoxes.push({ x: nx - w / 2, y: ny - h / 2, w, h });
  MZ.ui.toast("この場所にマスクを追加しました(もう一度タップで外せます)");
};

/* ---- 読み込み: 拡張子/MIMEで写真・動画を振り分け ---- */
MZ.ui.loadFile = async file => {
  if (!file) throw new Error("ファイルがありません");
  MZ.ui.disposeClip();
  return MZ.ui.isImageFile(file) ? MZ.ui._loadImages([file]) : MZ.ui._loadVideo(file);
};

/* 複数ファイルの取り込み: 写真は最大4枚、動画は先頭1本。混在は写真を優先 */
MZ.ui.loadFiles = async fileList => {
  const files = [...fileList];
  const imgs = files.filter(MZ.ui.isImageFile);
  const vid = files.find(MZ.ui.isVideoFile);
  MZ.ui.disposeClip();
  if (imgs.length) {
    if (imgs.length > 4) MZ.ui.toast("写真は4枚までです。先頭の4枚を使います");
    return MZ.ui._loadImages(imgs.slice(0, 4));
  }
  if (vid) return MZ.ui._loadVideo(vid);
  throw new Error("動画または写真を入れてください");
};

/* 1ファイルを ImageBitmap(EXIF回転反映)へ。失敗時は<img>フォールバック */
MZ.ui._decodeImage = async file => {
  const url = URL.createObjectURL(file);
  try {
    const img = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { file, url, img, kind: "image", name: file.name, width: img.width, height: img.height, boxes: [], manualBoxes: [], suppressedBoxes: [] };
  } catch (e) {
    MZ.log("createImageBitmap失敗→<img>フォールバック:", e.message);
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error("この画像を読み込めません"));
      el.src = url;
    }).catch(err => { URL.revokeObjectURL(url); throw err; });
    return { file, url, img, kind: "image", name: file.name, width: img.naturalWidth, height: img.naturalHeight, boxes: [], manualBoxes: [], suppressedBoxes: [] };
  }
};

MZ.ui._loadImages = async files => {
  const photos = [];
  for (const f of files) {
    try { photos.push(await MZ.ui._decodeImage(f)); }
    catch (e) { MZ.ui.toast(`⚠ ${f.name}: ${e.message}`); }
  }
  if (!photos.length) throw new Error("読み込める画像がありませんでした");
  MZ.S.photos = photos;
  MZ.S.photoIdx = 0;
  MZ.S.clip = photos[0];
  MZ.S.manualBoxes = [];
  MZ.S.suppressedBoxes = [];
  MZ.log(`loaded ${photos.length} image(s)`);
  MZ.ui._enterEditor(photos[0].name, "image");
  MZ.ui._buildPhotoTabs();
  MZ.preview.setClip(MZ.S.clip);
};

/* 写真タブ(2枚以上で表示)。各サムネをクリックで切り替え */
MZ.ui._buildPhotoTabs = () => {
  const host = $("photoTabs");
  const photos = MZ.S.photos || [];
  host.replaceChildren();
  if (photos.length < 2) { host.hidden = true; return; }
  host.hidden = false;
  photos.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "photo-tab" + (i === MZ.S.photoIdx ? " on" : "");
    const cv = document.createElement("canvas");
    cv.width = 120; cv.height = 88;
    const ctx = cv.getContext("2d");
    const scale = Math.max(cv.width / p.width, cv.height / p.height);
    const dw = p.width * scale, dh = p.height * scale;
    try { ctx.drawImage(p.img, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh); } catch (e) {}
    btn.appendChild(cv);
    const badge = document.createElement("span");
    badge.className = "photo-tab-badge";
    badge.textContent = `${i + 1}`;
    btn.appendChild(badge);
    btn.addEventListener("click", () => MZ.ui._selectPhoto(i));
    host.appendChild(btn);
  });
};

/* 現在表示中の写真へ、検出/手動マスクの最新を退避 */
MZ.ui._syncCurrentPhoto = () => {
  const photos = MZ.S.photos || [];
  const p = photos[MZ.S.photoIdx];
  if (!p) return;
  p.boxes = (MZ.preview.boxes || []).slice();
  p.manualBoxes = (MZ.S.manualBoxes || []).slice();
  p.suppressedBoxes = (MZ.S.suppressedBoxes || []).slice();
};

/* 写真の切り替え(検出結果・手動マスクは写真ごとに保持) */
MZ.ui._selectPhoto = idx => {
  const photos = MZ.S.photos || [];
  if (idx < 0 || idx >= photos.length || idx === MZ.S.photoIdx) {
    if (idx === MZ.S.photoIdx) return;
  }
  MZ.ui._syncCurrentPhoto();
  MZ.S.photoIdx = idx;
  const p = photos[idx];
  MZ.S.clip = p;
  MZ.S.manualBoxes = (p.manualBoxes || []).slice();
  MZ.S.suppressedBoxes = (p.suppressedBoxes || []).slice();
  $("clipName").textContent = p.name;
  MZ.preview.setClip(p);
  // 既に検出済みなら再検出せず復元、未検出なら setClip の imageDirty で検出が走る
  if (p.boxes && p.boxes.length) { MZ.preview.boxes = p.boxes.slice(); MZ.preview.imageDirty = false; }
  MZ.ui._buildPhotoTabs();
  MZ.ui.setStep(1);
};

/* 単体写真ロード(後方互換)。内部は複数版に委譲 */
MZ.ui._loadImage = file => MZ.ui._loadImages([file]);

MZ.ui._loadVideo = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.className = "hidden-video";
  document.body.appendChild(video);
  video.onerror = () => reject(new Error("この動画を再生できません"));
  video.onloadedmetadata = () => {
    if (video.duration > 600.5) {
      URL.revokeObjectURL(url);
      video.remove();
      reject(new Error(`動画は10分までです(この動画は${Math.round(video.duration / 60)}分)。短く切り出してからお試しください`));
      return;
    }
    MZ.S.clip = {
      file, url, video, kind: "video",
      name: file.name,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    MZ.log(`loaded video: ${file.name} ${video.videoWidth}x${video.videoHeight} ${video.duration.toFixed(1)}s`);
    if (video.duration > 60) {
      MZ.ui.enterRangePhase();
    } else {
      MZ.S.rangeStart = 0;
      MZ.S.rangeDur = video.duration;
      MZ.ui.enterEditorWithRange();
    }
    resolve();
  };
  video.src = url;
});

MZ.ui.updateTime = () => {
  const c = MZ.S.clip;
  if (!c || c.kind !== "video") return;
  const rs = c.duration > 60 ? MZ.S.rangeStart : 0;
  const re = c.duration > 60 ? MZ.rangeEnd() : c.duration;
  $("timeLabel").textContent =
    `${MZ.ui.fmtTime(Math.max(0, c.video.currentTime - rs))} / ${MZ.ui.fmtTime(re - rs)}`;
  if (!MZ.ui._seeking) $("seekBar").value = c.video.currentTime;
  $("playBtn").innerHTML = c.video.paused
    ? '<i class="fa-solid fa-play"></i> 再生'
    : '<i class="fa-solid fa-pause"></i> 一時停止';
};

/* ---- 書き出し ---- */
MZ.ui.startExport = async () => {
  if (MZ.exporter.running) return;
  const btn = $("exportBtn");
  btn.disabled = true;
  $("progressWrap").hidden = false;
  $("doneCard").hidden = true;
  if (MZ.S.clip.video) MZ.S.clip.video.pause();
  try {
    if (!MZ.detect.detector) {
      $("progressText").textContent = "顔検出モデルを準備中…";
      await MZ.detect.init();
    }
    const res = await MZ.exporter.run((p, txt) => {
      $("progressBar").style.width = `${Math.round(p * 100)}%`;
      $("progressText").textContent = txt;
    });
    MZ.ui.showDone(res);
  } catch (e) {
    MZ.log("export error:", e.message);
    MZ.ui.toast(e.message === "キャンセルしました" ? "書き出しを中止しました" : `⚠ ${e.message}`);
  } finally {
    btn.disabled = false;
    $("progressWrap").hidden = true;
    $("progressBar").style.width = "0%";
  }
};

/* 書き出し完了カードの表示。iOS(共有可)は「保存」ボタンのタップで初めて保存する */
MZ.ui.showDone = res => {
  MZ.ui._shareQueueIdx = 0;   // 写真の「1枚ずつ保存」の進み位置をリセット
  const items = MZ.exporter.lastResults || (res ? [res] : []);
  const isImage = MZ.S.clip && MZ.S.clip.kind === "image";
  const kindWord = isImage ? "写真" : "動画";
  const n = items.length;
  const totalSize = items.reduce((a, it) => a + (it.blob ? it.blob.size : 0), 0);
  const many = n > 1 ? `${n}枚の${kindWord}` : kindWord;
  const share = MZ.exporter.shareMode();
  $("doneCard").hidden = false;
  $("saveBtn").innerHTML = share ? `<i class="fa-solid fa-arrow-up-from-bracket"></i> ${many}を保存` : "もう一度保存";
  if (share) {
    $("doneText").textContent = `準備できました(${MZ.ui.fmtSize(totalSize)})`;
    $("doneNote").textContent = `「${many}を保存」を押すと、共有シートから写真(カメラロール)やファイルに保存できます。`;
    MZ.ui.toast("✔ 準備できました。保存を押してください");
  } else {
    $("doneText").textContent = n > 1
      ? `${n}枚を保存しました(${MZ.ui.fmtSize(totalSize)})`
      : `「${items[0] ? items[0].name : ""}」を保存しました(${MZ.ui.fmtSize(totalSize)})`;
    $("doneNote").textContent = "ダウンロードに保存されています。";
    MZ.ui.toast("✔ 書き出しが完了しました");
  }
};

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ(複数はまとめて共有)、それ以外はダウンロード。
   一括共有が使えない環境では「保存ボタンを押すたびに次の1枚を共有」する
   (navigator.shareはユーザー操作1回につき1回しか呼べないため、ループでの連続共有は不可) */
MZ.ui.saveResult = async () => {
  const items = MZ.exporter.lastResults
    || (MZ.exporter.lastResult ? [MZ.exporter.lastResult] : []);
  if (!items.length) return;
  if (!MZ.exporter.shareMode()) {
    items.forEach(r => MZ.exporter.triggerDownload(r.blob, r.name));
    return;
  }
  const files = items.map(r => new File([r.blob], r.name, { type: r.type || r.blob.type }));
  const canMulti = files.length > 1 && navigator.canShare && navigator.canShare({ files });
  if (files.length === 1 || canMulti) {
    try {
      await navigator.share({ files });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;         // ユーザーがキャンセル
      MZ.log("一括share失敗→1枚ずつ方式へ:", e && e.message);
    }
  }
  // 1枚ずつ方式(押すたびに1枚進む)
  const i = Math.min(MZ.ui._shareQueueIdx || 0, files.length - 1);
  try {
    await navigator.share({ files: [files[i]] });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    MZ.log("share失敗→ダウンロード:", e && e.message);
    items.forEach(r => MZ.exporter.triggerDownload(r.blob, r.name));  // 最後の手段
    return;
  }
  MZ.ui._shareQueueIdx = i + 1;
  const remain = files.length - MZ.ui._shareQueueIdx;
  if (remain > 0) {
    $("saveBtn").innerHTML = `<i class="fa-solid fa-arrow-up-from-bracket"></i> 次の写真を保存（残り${remain}枚）`;
    $("doneNote").textContent = `${MZ.ui._shareQueueIdx}枚目を保存しました。ボタンを押して残り${remain}枚も保存してください。`;
    MZ.ui.toast(`✔ ${MZ.ui._shareQueueIdx} / ${files.length} 枚目を保存しました`);
  } else {
    MZ.ui._shareQueueIdx = 0;
    $("saveBtn").innerHTML = "もう一度保存";
    $("doneNote").textContent = `${files.length}枚すべて保存しました。`;
    MZ.ui.toast("✔ すべての写真を保存しました");
  }
};

/* ---- 起動 ---- */
window.addEventListener("DOMContentLoaded", async () => {
  MZ.preview.init();

  // ファイル選択+ドラッグ&ドロップ
  $("pickBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => { if (e.target.files.length) MZ.ui.loadFiles(e.target.files).catch(err => MZ.ui.toast(`⚠ ${err.message}`)); };
  const dz = $("dropSection");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag");
    const fs = [...e.dataTransfer.files].filter(f => MZ.ui.isImageFile(f) || MZ.ui.isVideoFile(f));
    if (fs.length) MZ.ui.loadFiles(fs).catch(err => MZ.ui.toast(`⚠ ${err.message}`));
    else MZ.ui.toast("動画または写真を入れてください");
  });

  // 再生コントロール
  const togglePlay = () => {
    const v = MZ.S.clip && MZ.S.clip.video;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };
  $("playBtn").onclick = togglePlay;
  $("previewCanvas").addEventListener("click", e => MZ.ui.onCanvasTap(e));
  $("seekBar").addEventListener("input", e => {
    MZ.ui._seeking = true;
    if (MZ.S.clip) MZ.S.clip.video.currentTime = parseFloat(e.target.value);
  });
  $("seekBar").addEventListener("change", () => { MZ.ui._seeking = false; });
  setInterval(MZ.ui.updateTime, 250);

  // 設定
  const bindRange = (id, key, labelId, fmt) => {
    const el = $(id);
    el.addEventListener("input", () => {
      MZ.S[key] = parseFloat(el.value);
      $(labelId).textContent = fmt(MZ.S[key]);
    });
    el.value = MZ.S[key];
    $(labelId).textContent = fmt(MZ.S[key]);
  };
  bindRange("strengthRange", "strength", "strengthVal", v => `${v}`);
  bindRange("expandRange", "expand", "expandVal", v => `${v}%`);
  bindRange("holdRange", "hold", "holdVal", v => `${v.toFixed(1)}秒`);
  document.querySelectorAll("#typeSeg button").forEach(b => {
    b.onclick = () => {
      MZ.S.type = b.dataset.type;
      document.querySelectorAll("#typeSeg button").forEach(x => x.classList.toggle("on", x === b));
    };
  });
  $("resSel").onchange = e => { MZ.S.res = e.target.value; };

  // 範囲選択フェーズ(インスタ風トリム)
  MZ.ui._wireTrim();
  $("rangeOkBtn").onclick = () => MZ.ui.enterEditorWithRange();
  $("rangeBackBtn").onclick = () => {
    MZ.ui.disposeClip();
    $("rangeSection").hidden = true;
    $("dropSection").hidden = false;
    $("fileInput").value = "";
  };
  $("reRangeBtn").onclick = () => {
    if (MZ.exporter.running) return MZ.ui.toast("書き出し中です");
    MZ.preview.stop();
    if (MZ.S.clip.video) MZ.S.clip.video.pause();
    $("editorSection").hidden = true;
    // 現在の範囲値を保ったまま選び直し画面へ
    $("rangeSection").hidden = false;
    MZ.ui._updateRangeUi(false);
    void MZ.ui._buildStrip();
  };

  // ステップウィザード
  document.querySelectorAll("#stepper [data-step]").forEach(b => {
    b.onclick = () => MZ.ui.setStep(parseInt(b.dataset.step, 10));
  });
  $("toStep2Btn").onclick = () => MZ.ui.setStep(2);
  $("toStep3Btn").onclick = () => MZ.ui.setStep(3);
  $("backTo1Btn").onclick = () => MZ.ui.setStep(1);
  $("backTo2Btn").onclick = () => MZ.ui.setStep(2);
  setInterval(() => { if (MZ.S.clip && MZ.S.step === 1) MZ.ui.updateDetectStatus(); }, 400);

  $("exportBtn").onclick = MZ.ui.startExport;
  $("saveBtn").onclick = MZ.ui.saveResult;
  $("cancelBtn").onclick = () => { MZ.exporter.cancelFlag = true; };
  $("backBtn").onclick = () => {
    if (MZ.exporter.running) return MZ.ui.toast("書き出し中です");
    MZ.ui.disposeClip();
    $("editorSection").hidden = true;
    $("rangeSection").hidden = true;
    $("doneCard").hidden = true;
    $("dropSection").hidden = false;
    $("fileInput").value = "";
  };

  // 能力チェック+検出モデル準備
  await MZ.exporter.probeCaps().catch(() => {});
  MZ.ui.setStatus("顔検出AIを準備中…", false);
  MZ.detect.init().then(() => {
    MZ.ui.setStatus(MZ.caps.h264 ? "準備OK(高速書き出し対応)" : "準備OK(実時間書き出し)", true);
  }).catch(e => {
    MZ.ui.setStatus("顔検出を読み込めませんでした", false);
    MZ.ui.toast(`⚠ 顔検出の初期化に失敗: ${e.message}`);
  });

  if (MZ.testMode) MZ.ui.runTest();
});

/* 自動検証(?test): test.mp4を読み込み→書き出し→/saveへPUT */
MZ.ui.runTest = async () => {
  try {
    await MZ.detect.init();
    const r = await fetch("test.mp4");
    if (!r.ok) throw new Error("test.mp4がありません");
    const b = await r.blob();
    await MZ.ui.loadFile(new File([b], "test.mp4", { type: "video/mp4" }));
    await new Promise(r2 => setTimeout(r2, 400));
    await MZ.ui.startExport();
    MZ.log("TEST DONE");
  } catch (e) {
    MZ.log("TEST FAILED:", e.message);
  }
};
