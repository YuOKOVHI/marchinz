"use strict";
/* ============ 自動カラーマッチ+フィルター (Phase 3) ============
   GradeMatch(grade_match.py)のReinhard Lab転送を移植:
     ratio = clip(ref_std/src_std, 0.6, 1.8)
     scale = 1 + strength*(ratio-1)
     target_mean = src_mean + strength*(ref_mean - src_mean)
     out = (x - src_mean)*scale + target_mean   (Lab空間)
   適用はWebGLシェーダ(プレビュー/書き出し共通)。 */

MC.color = { STD_CLIP: [0.6, 1.8], STATS_FRAMES: 8, _procs: new Map(), _uploadFallback: false };

MC.color.FILTERS = {
  none:   { name: "なし",     contrast: 1.0,  sat: 1.0,  warm: 0 },
  cinema: { name: "シネマ",   contrast: 1.12, sat: 0.9,  warm: 0.015 },
  vivid:  { name: "ビビッド", contrast: 1.06, sat: 1.28, warm: 0 },
  warm:   { name: "ウォーム", contrast: 1.0,  sat: 1.05, warm: 0.05 },
  cool:   { name: "クール",   contrast: 1.0,  sat: 1.0,  warm: -0.05 },
  mono:   { name: "モノクロ", contrast: 1.08, sat: 0.0,  warm: 0 },
};

/* ---- sRGB→CIELAB (D65)。シェーダと同一の式 ---- */
MC.color.srgbToLab = (r, g, b) => {
  const lin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/* クリップから8フレームをサンプリングしてLab統計 {mean, std} を返す */
MC.color.sampleStats = async clip => {
  const v = clip.video;
  const keep = v.currentTime;
  const cv = document.createElement("canvas");
  const scale = 320 / Math.max(v.videoWidth, 1);
  cv.width = Math.max(2, Math.round(v.videoWidth * scale));
  cv.height = Math.max(2, Math.round(v.videoHeight * scale));
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < MC.color.STATS_FRAMES; i++) {
    const t = clip.duration * (0.1 + 0.8 * i / (MC.color.STATS_FRAMES - 1));
    v.currentTime = t;
    await new Promise((res, rej) => {
      v.onseeked = res; v.onerror = rej;
      setTimeout(res, 2000);
    });
    cx.drawImage(v, 0, 0, cv.width, cv.height);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    for (let p = 0; p < d.length; p += 16) {  // 4画素おき(十分な標本数)
      const lab = MC.color.srgbToLab(d[p] / 255, d[p + 1] / 255, d[p + 2] / 255);
      for (let k = 0; k < 3; k++) { sum[k] += lab[k]; sq[k] += lab[k] * lab[k]; }
      n++;
    }
  }
  v.currentTime = keep;
  const mean = sum.map(s => s / n);
  const std = sq.map((s, k) => Math.sqrt(Math.max(s / n - mean[k] * mean[k], 1e-8)));
  return { mean, std };
};

/* 全カメラの統計→基準(音声カメラ)へのLab変換を計算 */
/* p: MZPの進捗ハンドル(省略可) */
MC.color.run = async p => {
  const clips = MC.S.clips;
  if (clips.length < 2) throw new Error("2本以上のクリップが必要です");
  const ref = MC.getClip(MC.S.audioClipId) || clips[0];
  const stats = new Map();
  let i = 0;
  for (const c of clips) {
    i++;
    if (p) p.count(i, clips.length, { unit: "台目", name: c.name });
    stats.set(c.id, await MC.color.sampleStats(c));
  }
  const refS = stats.get(ref.id);
  for (const c of clips) {
    if (c.id === ref.id) { c.colorT = null; continue; }
    const s = stats.get(c.id);
    const ratio = s.std.map((sd, k) =>
      Math.min(MC.color.STD_CLIP[1], Math.max(MC.color.STD_CLIP[0], refS.std[k] / Math.max(sd, 1e-6))));
    c.colorT = { srcMean: s.mean, ratio, refMean: refS.mean };
    MC.log(`colormatch ${c.name}: dMean=[${refS.mean.map((m, k) => (m - s.mean[k]).toFixed(1)).join(",")}]`);
  }
  MC.S.colorOn = true;
  MC.saveState();
};

MC.color.active = clip =>
  (MC.S.colorOn && clip.colorT) || MC.S.filterId !== "none";

/* ---- WebGLプロセッサ(寸法ごとにキャッシュ、最大1920へ縮小処理) ---- */
const CM_VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

const CM_FS = `precision mediump float;
varying vec2 uv; uniform sampler2D tex;
uniform vec3 uSrcMean, uScale, uTgtMean;
uniform float uMatch, uContrast, uSat, uWarm;
vec3 s2l(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
float fl(float t){ return t > 0.008856 ? pow(t, 1.0/3.0) : (7.787*t + 16.0/116.0); }
float fi(float t){ float t3 = t*t*t; return t3 > 0.008856 ? t3 : (t - 16.0/116.0)/7.787; }
vec3 rgb2lab(vec3 c){
  vec3 l = s2l(c);
  float x = dot(l, vec3(0.4124564, 0.3575761, 0.1804375)) / 0.95047;
  float y = dot(l, vec3(0.2126729, 0.7151522, 0.0721750));
  float z = dot(l, vec3(0.0193339, 0.1191920, 0.9503041)) / 1.08883;
  float fx = fl(x), fy = fl(y), fz = fl(z);
  return vec3(116.0*fy - 16.0, 500.0*(fx - fy), 200.0*(fy - fz));
}
vec3 lab2rgb(vec3 lab){
  float fy = (lab.x + 16.0)/116.0;
  float fx = fy + lab.y/500.0;
  float fz = fy - lab.z/200.0;
  vec3 xyz = vec3(fi(fx)*0.95047, fi(fy), fi(fz)*1.08883);
  vec3 l = vec3(
    dot(xyz, vec3( 3.2404542, -1.5371385, -0.4985314)),
    dot(xyz, vec3(-0.9692660,  1.8760108,  0.0415560)),
    dot(xyz, vec3( 0.0556434, -0.2040259,  1.0572252)));
  return l2s(clamp(l, 0.0, 1.0));
}
void main(){
  vec3 rgb = texture2D(tex, uv).rgb;
  if (uMatch > 0.5) {
    vec3 lab = rgb2lab(rgb);
    lab = (lab - uSrcMean) * uScale + uTgtMean;
    lab.x = clamp(lab.x, 0.0, 100.0);
    lab.yz = clamp(lab.yz, vec2(-127.0), vec2(127.0));
    rgb = lab2rgb(lab);
  }
  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(lum), rgb, uSat);
  rgb = (rgb - 0.5) * uContrast + 0.5;
  rgb += vec3(uWarm, 0.0, -uWarm);
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

MC.color.getProc = (w, h) => {
  const key = w + "x" + h;
  let p = MC.color._procs.get(key);
  if (p) return p;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, CM_VS));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, CM_FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.viewport(0, 0, w, h);
  const u = n => gl.getUniformLocation(prog, n);
  p = { canvas, gl, w, h,
    uSrcMean: u("uSrcMean"), uScale: u("uScale"), uTgtMean: u("uTgtMean"),
    uMatch: u("uMatch"), uContrast: u("uContrast"), uSat: u("uSat"), uWarm: u("uWarm") };
  MC.color._procs.set(key, p);
  return p;
};

/* srcにカラーマッチ+フィルターを適用したsrcを返す(GL不可なら素通し) */
MC.color.process = (clip, src) => {
  const cap = 1920;
  const scale = Math.min(1, cap / Math.max(src.w, src.h));
  const w = Math.max(2, Math.round(src.w * scale));
  const h = Math.max(2, Math.round(src.h * scale));
  const p = MC.color.getProc(w, h);
  if (!p) return src;
  const gl = p.gl;
  try {
    if (MC.color._uploadFallback) throw new Error("fallback");
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.source);
  } catch (e) {
    // VideoFrame直接アップロード非対応環境: 2D canvas経由
    if (!MC.color._scratch) MC.color._scratch = document.createElement("canvas");
    const sc = MC.color._scratch;
    if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
    sc.getContext("2d").drawImage(src.source, 0, 0, w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sc);
    MC.color._uploadFallback = true;
  }
  const s = MC.S.colorStrength;
  const t = MC.S.colorOn ? clip.colorT : null;
  if (t) {
    gl.uniform1f(p.uMatch, 1);
    gl.uniform3fv(p.uSrcMean, t.srcMean);
    gl.uniform3fv(p.uScale, t.ratio.map(r => 1 + s * (r - 1)));
    gl.uniform3fv(p.uTgtMean, t.srcMean.map((m, k) => m + s * (t.refMean[k] - m)));
  } else {
    gl.uniform1f(p.uMatch, 0);
    gl.uniform3fv(p.uSrcMean, [0, 0, 0]);
    gl.uniform3fv(p.uScale, [1, 1, 1]);
    gl.uniform3fv(p.uTgtMean, [0, 0, 0]);
  }
  const f = MC.color.FILTERS[MC.S.filterId] || MC.color.FILTERS.none;
  gl.uniform1f(p.uContrast, f.contrast);
  gl.uniform1f(p.uSat, f.sat);
  gl.uniform1f(p.uWarm, f.warm);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return { source: p.canvas, w, h, rotation: src.rotation };
};
